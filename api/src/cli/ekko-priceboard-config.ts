import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  ratesSchema,
  accommodationTypeCreateSchema,
  accommodationUnitCreateSchema,
  accommodationBedInputSchema,
  extraTemplateInputSchema,
  type AccommodationPricingSettings,
} from '@camping/contracts'
import type { DataSource, EntityManager } from 'typeorm'
import { CampingEntity } from '../database/entities/camping.entity'
import { AccommodationTypeEntity } from '../database/entities/accommodation-type.entity'
import { AccommodationUnitEntity } from '../database/entities/accommodation-unit.entity'
import { AccommodationBedEntity } from '../database/entities/accommodation-bed.entity'
import { ExtraTemplateEntity } from '../database/entities/extra-template.entity'
import { AuditLogEntity } from '../database/entities/audit-log.entity'
import { OutboxEventEntity } from '../database/entities/outbox-event.entity'
import { withInventoryTransaction } from '../accommodations/inventory-transaction'
import { inputError } from './common'

const count = z.number().int().min(0).max(1000)
/**
 * OWNER QUESTIONS — intentionally unresolved; never replace null with guesses.
 * - How many reservable beds are in the mixed and female dormitories?
 * - What do children/infants pay for camping and as extra private-room guests?
 * - Can the two included private-room places mix adults and children, and do
 *   free infants consume included places? The current engine has category slots.
 * - Are kit prices $300/$500 equipment surcharges or totals including camping?
 * Confirmed: one Jungle/UFO/Portal; kits are unlimited-stock extras; camping
 * week is per person; rental extras and pets are charged per night.
 * Dormitory pet admission/prices are also absent from the board (not inferred).
 */
export const ekkoPriceboardConfigSchema = z.strictObject({
  mixedBeds: count.min(1).nullable(),
  femaleBeds: count.min(1).nullable(),
  humanPricing: z
    .strictObject({
      campingRates: ratesSchema,
      privateExtraRates: ratesSchema,
      includedOccupancy: z.strictObject({
        adults: count.min(0),
        children: count.min(0),
        infants: count.min(0),
      }),
    })
    .refine(
      (v) =>
        v.campingRates.adults === 15000 && v.privateExtraRates.adults === 25000,
      'Adult prices must match the photographed board',
    )
    .nullable(),
  kitPricesIncludeCamping: z.boolean().nullable(),
})
export type EkkoPriceboardConfig = z.infer<typeof ekkoPriceboardConfigSchema>

export function ownerQuestions(config: EkkoPriceboardConfig): string[] {
  const questions: string[] = []
  if (config.mixedBeds === null)
    questions.push('¿Cuántas camas reservables tiene el dormitorio mixto?')
  if (config.femaleBeds === null)
    questions.push('¿Cuántas camas reservables tiene el dormitorio femenino?')
  if (config.humanPricing === null)
    questions.push(
      '¿Qué pagan niños y bebés en camping, dormitorios y como adicionales en privadas? ¿Desde qué edades?',
      '¿Las dos personas incluidas en privadas pueden combinar adultos y niños? ¿Los bebés gratuitos consumen cupos incluidos?',
      '¿Los bebés necesitan cama propia o pueden compartir sin ocupar una plaza?',
    )
  if (config.kitPricesIncludeCamping === null)
    questions.push(
      '¿Los kits de $300/$500 son un adicional al camping o el total con camping incluido?',
    )
  questions.push(
    '¿Se admiten mascotas en dormitorios compartidos y qué tarifa corresponde? El cartel solo indica camping y privadas.',
  )
  return questions
}

type DesiredType = {
  key: string
  name: string
  inventoryMode: 'individual' | 'shared' | 'unlimited'
  capacity: number | null
  base: number
  pricing: AccommodationPricingSettings
  units: number
}
export type ConfigurationChange = {
  resource: string
  name: string
  id: string
  action: 'create' | 'update'
  before: Record<string, unknown> | null
  after: Record<string, unknown>
}
export type ConfigurationReport = {
  campingId: string
  campingKey: string
  applied: boolean
  changes: ConfigurationChange[]
  retainedTypes: string[]
  pendingQuestions: string[]
  deferred: string[]
  deploymentSha?: string
}

function stableId(scope: string, key: string): string {
  const hash = createHash('sha256')
    .update(`ekko-priceboard-v1:${scope}:${key}`)
    .digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`
  return JSON.stringify(value) ?? 'undefined'
}
const money = (pesos: number) => pesos * 100
export function priceboardTypes(config: EkkoPriceboardConfig): DesiredType[] {
  const human = config.humanPricing
  // Until the owner confirms minor rates and included places, do not publish
  // partially defined accommodation tariffs. Confirmed rental extras can apply.
  if (human === null) return []
  const settings = (
    basis: AccommodationPricingSettings['basis'],
    pets: number,
  ): AccommodationPricingSettings => ({
    basis,
    rates: human.campingRates,
    extraPersonRates: human.privateExtraRates,
    includedOccupancy: human.includedOccupancy,
    petNightlyPriceMinor: money(pets),
    weekdays: [],
    discounts: [],
  })
  const dorm = (key: string, name: string, beds: number): DesiredType => ({
    key,
    name,
    inventoryMode: 'shared',
    capacity: beds,
    base: money(250),
    units: 1,
    pricing: {
      ...settings('per_bed', 0),
      discounts: [
        {
          blockNights: 7,
          repeat: true,
          benefit: { type: 'FIXED_PRICE', value: money(1400) },
        },
      ],
    },
  })
  const privateRoom = (
    key: string,
    name: string,
    capacity: number,
    base: number,
    weekend: number,
  ): DesiredType => ({
    key,
    name,
    inventoryMode: 'individual',
    capacity,
    base: money(base),
    units: 1,
    pricing: {
      ...settings('per_unit', 100),
      weekdays: [5, 6, 0].map((day) => ({
        day,
        rates: { baseNightlyPriceMinor: money(weekend) },
      })),
    },
  })
  const types: DesiredType[] = [
    privateRoom('jungle', 'Jungle', 2, 800, 950),
    privateRoom('ufo', 'UFO', 3, 800, 950),
    privateRoom('portal', 'Portal', 6, 900, 1100),
    {
      key: 'own-camping',
      name: 'Camping con equipo propio',
      inventoryMode: 'unlimited',
      capacity: null,
      base: 0,
      units: 0,
      pricing: {
        ...settings('per_person', 50),
        discounts: [
          {
            blockNights: 7,
            repeat: true,
            benefit: { type: 'FREE_NIGHTS', value: 1 },
          },
        ],
      },
    },
  ]
  if (config.mixedBeds !== null)
    types.push(dorm('mixed', 'Dormitorio mixto', config.mixedBeds))
  if (config.femaleBeds !== null)
    types.push(dorm('female', 'Dormitorio femenino', config.femaleBeds))
  return types
}
export function priceboardExtras(
  config: EkkoPriceboardConfig,
): readonly (readonly [string, string, number])[] {
  const extras: (readonly [string, string, number])[] = [
    ['tent', 'Casa de camping', 100],
    ['mat', 'Aislante térmico', 30],
    ['sleeping-bag', 'Sleepingbag', 50],
    ['blanket', 'Cobija', 50],
    ['pillow', 'Almohada', 30],
    ['towel', 'Toalla', 30],
  ]
  // Kits use the existing extras system, with no physical inventory limit.
  // If the printed amount is a total, store only the equipment supplement so
  // that the separately priced camping is not charged twice (adult reference).
  if (config.kitPricesIncludeCamping !== null) {
    extras.push(
      [
        'kit-one',
        'Kit Ekko 1 persona',
        config.kitPricesIncludeCamping ? 150 : 300,
      ],
      [
        'kit-two',
        'Kit Ekko 2 personas',
        config.kitPricesIncludeCamping ? 200 : 500,
      ],
    )
  }
  return extras
}

export async function configureEkkoPriceboard(
  ds: DataSource,
  options: {
    campingKey: string
    config: EkkoPriceboardConfig
    apply: boolean
    expectedCampingId?: string
    deploymentSha?: string
  },
): Promise<ConfigurationReport> {
  const config = ekkoPriceboardConfigSchema.parse(options.config)
  const run = async (manager: EntityManager): Promise<ConfigurationReport> => {
    const camping = await manager.findOneBy(CampingEntity, {
      stableKey: options.campingKey,
    })
    if (!camping) inputError('The selected camping does not exist')
    if (options.expectedCampingId && camping.id !== options.expectedCampingId)
      inputError('The selected camping ID does not match the expected target')
    if (
      camping.name !== 'Ekko Hostel' ||
      camping.currency !== 'MXN' ||
      camping.country !== 'MX'
    )
      inputError(
        'This priceboard requires Ekko Hostel in Mexico with MXN; no tenant identity or currency will be changed',
      )
    const migrations = await manager.query(
      `SELECT name FROM camping_private.camping_migrations WHERE name='FlexiblePricingAndBeds1760000007000'`,
    )
    if (!migrations.length)
      inputError(
        'Deploy and migrate flexible pricing before configuring this priceboard',
      )
    const changes: ConfigurationChange[] = []
    function changed(
      resource: string,
      name: string,
      id: string,
      before: Record<string, unknown> | null,
      after: Record<string, unknown>,
    ): boolean {
      if (before !== null && canonical(before) === canonical(after))
        return false
      changes.push({
        resource,
        name,
        id,
        action: before ? 'update' : 'create',
        before,
        after,
      })
      return true
    }
    const selectedTypeIds = new Set<string>()
    for (const desired of priceboardTypes(config)) {
      const byName = await manager.findOneBy(AccommodationTypeEntity, {
        campingId: camping.id,
        name: desired.name,
      })
      const byId = await manager.findOneBy(AccommodationTypeEntity, {
        campingId: camping.id,
        id: stableId(camping.id, `type:${desired.key}`),
      })
      if (byName && byId && byName.id !== byId.id)
        inputError(`Conflicting managed identity for ${desired.name}`)
      const existing = byId ?? byName
      if (existing && existing.inventoryMode !== desired.inventoryMode)
        inputError(
          `Inventory mode conflict for ${desired.name}; map existing accommodation explicitly before applying`,
        )
      const fields = accommodationTypeCreateSchema.parse({
        name: desired.name,
        inventoryMode: desired.inventoryMode,
        maxOccupancy: desired.capacity,
        baseNightlyPriceMinor: desired.base,
        enabled: true,
        pricing: desired.pricing,
      })
      const typeId = existing?.id ?? stableId(camping.id, `type:${desired.key}`)
      selectedTypeIds.add(typeId)
      const before = existing
        ? {
            name: existing.name,
            inventoryMode: existing.inventoryMode,
            maxOccupancy: existing.maxOccupancy,
            baseNightlyPriceMinor: existing.baseNightlyPriceMinor,
            enabled: existing.enabled,
            pricing: existing.pricing,
          }
        : null
      if (
        changed('type', desired.name, typeId, before, fields) &&
        options.apply
      )
        await manager.save(
          AccommodationTypeEntity,
          manager.create(AccommodationTypeEntity, {
            ...existing,
            ...fields,
            id: typeId,
            campingId: camping.id,
            updatedAt: new Date(),
          }),
        )
      if (desired.inventoryMode === 'unlimited') continue
      const capacity = desired.capacity
      if (capacity === null)
        inputError('Quantified inventory requires a capacity')
      const existingUnits = await manager.find(AccommodationUnitEntity, {
        where: { campingId: camping.id, typeId },
        order: { name: 'ASC', id: 'ASC' },
      })
      if (existingUnits.length > desired.units)
        inputError(
          `Existing ${desired.name} units exceed the requested inventory; no units will be removed or silently disabled`,
        )
      for (let index = 0; index < desired.units; index++) {
        const unit = existingUnits[index]
        const unitId =
          unit?.id ?? stableId(camping.id, `unit:${desired.key}:${index + 1}`)
        const name =
          unit?.name ??
          (desired.units === 1 ? desired.name : `${desired.name} ${index + 1}`)
        const unitFields = accommodationUnitCreateSchema.parse({
          typeId,
          name,
          maxOccupancy: desired.capacity,
          enabled: true,
        })
        if (unit && unit.maxOccupancy !== desired.capacity) {
          const active = await manager.query(
            `SELECT 1 FROM camping_private.reservations WHERE camping_id=$1 AND unit_id=$2 AND status IN ('confirmed','checked_in') LIMIT 1`,
            [camping.id, unitId],
          )
          if (active.length)
            inputError(
              `Capacity change would affect active reservations in ${name}`,
            )
        }
        const unitBefore = unit
          ? {
              typeId: unit.typeId,
              name: unit.name,
              maxOccupancy: unit.maxOccupancy,
              enabled: unit.enabled,
            }
          : null
        if (
          changed('unit', name, unitId, unitBefore, unitFields) &&
          options.apply
        )
          await manager.save(
            AccommodationUnitEntity,
            manager.create(AccommodationUnitEntity, {
              ...unit,
              ...unitFields,
              id: unitId,
              campingId: camping.id,
              updatedAt: new Date(),
            }),
          )
        if (desired.inventoryMode !== 'shared') continue
        const beds = await manager.find(AccommodationBedEntity, {
          where: { campingId: camping.id, unitId },
          order: { position: 'ASC', name: 'ASC', id: 'ASC' },
        })
        if (beds.length > capacity)
          inputError(
            `Existing beds exceed requested inventory in ${name}; reconcile beds explicitly before applying`,
          )
        for (let bedIndex = 0; bedIndex < capacity; bedIndex++) {
          const bed = beds[bedIndex]
          const bedId = bed?.id ?? stableId(unitId, `bed:${bedIndex + 1}`)
          const bedFields = accommodationBedInputSchema.parse({
            name: bed?.name ?? `Cama ${bedIndex + 1}`,
            position: bed?.position ?? bedIndex,
            enabled: true,
          })
          const bedBefore = bed
            ? { name: bed.name, position: bed.position, enabled: bed.enabled }
            : null
          if (
            changed('bed', bedFields.name, bedId, bedBefore, bedFields) &&
            options.apply
          )
            await manager.save(
              AccommodationBedEntity,
              manager.create(AccommodationBedEntity, {
                ...bed,
                ...bedFields,
                id: bedId,
                campingId: camping.id,
                unitId,
              }),
            )
        }
      }
    }
    for (const [key, name, pesos] of priceboardExtras(config)) {
      const seedKey = `ekko-priceboard-v1:${key}`
      const existing = await manager.findOneBy(ExtraTemplateEntity, {
        campingId: camping.id,
        seedKey,
      })
      const description = `${name} · por noche`
      if (
        !existing &&
        (await manager.existsBy(ExtraTemplateEntity, {
          campingId: camping.id,
          description,
        }))
      )
        inputError(
          `Existing extra ${description} requires explicit adoption; refusing a duplicate`,
        )
      const fields = {
        ...extraTemplateInputSchema.parse({
          category: 'Renta extra',
          description,
          unitPriceMinor: money(pesos),
        }),
        enabled: true,
      }
      const id = existing?.id ?? stableId(camping.id, `extra:${key}`)
      const before = existing
        ? {
            category: existing.category,
            description: existing.description,
            unitPriceMinor: existing.unitPriceMinor,
            enabled: existing.enabled,
          }
        : null
      if (changed('extra', description, id, before, fields) && options.apply)
        await manager.save(
          ExtraTemplateEntity,
          manager.create(ExtraTemplateEntity, {
            ...existing,
            ...fields,
            id,
            campingId: camping.id,
            seedKey,
            updatedAt: new Date(),
          }),
        )
    }
    const allTypes = await manager.find(AccommodationTypeEntity, {
      where: { campingId: camping.id, enabled: true },
      order: { name: 'ASC' },
    })
    const report = {
      campingId: camping.id,
      campingKey: camping.stableKey,
      applied: options.apply,
      changes,
      pendingQuestions: ownerQuestions(config),
      deferred: [
        ...(config.humanPricing === null
          ? [
              'Tarifas de alojamientos pendientes de política de menores y cupos incluidos',
            ]
          : []),
        ...(config.mixedBeds === null
          ? ['Inventario del dormitorio mixto']
          : []),
        ...(config.femaleBeds === null
          ? ['Inventario del dormitorio femenino']
          : []),
        ...(config.kitPricesIncludeCamping === null
          ? ['Precio de los kits como extras']
          : []),
      ],
      retainedTypes: allTypes
        .filter((t) => !selectedTypeIds.has(t.id))
        .map((t) => t.name),
      ...(options.deploymentSha
        ? { deploymentSha: options.deploymentSha }
        : {}),
    }
    if (options.apply && changes.length) {
      await manager.save(
        AuditLogEntity,
        manager.create(AuditLogEntity, {
          campingId: camping.id,
          actorId: null,
          action: 'camping.priceboard_configured',
          entityType: 'Camping',
          entityId: camping.id,
          beforeState: {
            changes: changes.map((c) => ({
              resource: c.resource,
              id: c.id,
              before: c.before,
            })),
          },
          afterState: {
            source: 'ekko-priceboard-v1',
            config,
            changes: changes.map((c) => ({
              resource: c.resource,
              id: c.id,
              after: c.after,
            })),
            deploymentSha: options.deploymentSha ?? null,
          },
        }),
      )
      await manager.save(
        OutboxEventEntity,
        manager.create(OutboxEventEntity, {
          campingId: camping.id,
          aggregateType: 'Camping',
          aggregateId: camping.id,
          eventType: 'InventoryChanged',
          payload: {
            source: 'ekko-priceboard-v1',
            changedRecords: changes.length,
          },
        }),
      )
    }
    return report
  }
  if (!options.apply) return ds.transaction('REPEATABLE READ', run)
  const camping = await ds
    .getRepository(CampingEntity)
    .findOneBy({ stableKey: options.campingKey })
  if (!camping) inputError('The selected camping does not exist')
  return withInventoryTransaction(ds, { campingId: camping.id }, run)
}
