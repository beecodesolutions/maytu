import { AccommodationBedEntity } from '../database/entities/accommodation-bed.entity'
import {
  accommodationBedInputSchema,
  accommodationBedSchema,
  type AccommodationPricingSettings,
} from '@camping/contracts'
import { CampingEntity } from '../database/entities/camping.entity'
import { assertMoneyPrecision } from '../common/money'
import { Injectable } from '@nestjs/common'
import { DataSource, In, LessThan, MoreThan, type EntityManager } from 'typeorm'
import {
  accommodationTypeCreateSchema,
  accommodationTypeListQuerySchema,
  accommodationTypePatchSchema,
  accommodationTypeSchema,
  accommodationUnitListQuerySchema,
  accommodationUnitCreateSchema,
  accommodationUnitPatchSchema,
  accommodationUnitSchema,
  reservationBlockListQuerySchema,
  reservationBlockCreateSchema,
  reservationBlockPatchSchema,
  reservationBlockSchema,
  todayInTimezone,
  type AccommodationType,
  type AccommodationUnit,
  type ReservationBlock,
  type ReservationBlockListQuery,
} from '@camping/contracts'
import type { AuthContext } from '../auth/auth.types'
import {
  conflict,
  isUniqueViolation,
  notFound,
  zodBadRequest,
} from '../common/errors'
import { AccommodationBlockEntity } from '../database/entities/accommodation-block.entity'
import { AccommodationTypeEntity } from '../database/entities/accommodation-type.entity'
import { AccommodationUnitEntity } from '../database/entities/accommodation-unit.entity'
import { AuditLogEntity } from '../database/entities/audit-log.entity'
import { OutboxEventEntity } from '../database/entities/outbox-event.entity'
import { ReservationEntity } from '../database/entities/reservation.entity'
import {
  withInventoryTransaction,
  type InventoryTransactionContext,
} from './inventory-transaction'

function assertPricingPrecision(
  pricing: AccommodationPricingSettings | null | undefined,
  camping: CampingEntity,
) {
  if (!pricing) return
  const check = (amount: number) =>
    assertMoneyPrecision(amount, camping.currency, camping.moneyDecimals)
  check(pricing.petNightlyPriceMinor)
  for (const rates of [pricing.rates, pricing.extraPersonRates])
    for (const amount of Object.values(rates)) check(amount)
  for (const override of pricing.weekdays) {
    if (override.rates.baseNightlyPriceMinor !== undefined)
      check(override.rates.baseNightlyPriceMinor)
    if (override.rates.petNightlyPriceMinor !== undefined)
      check(override.rates.petNightlyPriceMinor)
    for (const rates of [override.rates.rates, override.rates.extraPersonRates])
      if (rates) for (const amount of Object.values(rates)) check(amount)
  }
  for (const rule of pricing.discounts)
    if (
      rule.benefit.type === 'FIXED_AMOUNT' ||
      rule.benefit.type === 'FIXED_PRICE'
    )
      check(rule.benefit.value)
}

const activeReservationStatuses = ['confirmed', 'checked_in'] as const
const reservationStatusFilter = In([...activeReservationStatuses])

const dateRangeOverlap = (start: string, end: string) => ({
  checkInDate: LessThan(end),
  checkOutDate: MoreThan(start),
})

function contextFor(context: AuthContext): InventoryTransactionContext {
  return { campingId: context.camping.id }
}

function errorForAvailability(resource: string): never {
  throw conflict(`${resource} no está disponible`, 'INVENTORY_UNAVAILABLE')
}

/**
 * Validate a unit and all active reservations/blocks for a half-open date
 * range. The caller must already be inside withInventoryTransaction.
 */
export async function assertUnitAvailable(
  manager: EntityManager,
  campingId: string,
  unitId: string,
  checkInDate: string,
  checkOutDate: string,
  excludeBlockId?: string,
  excludeReservationId?: string,
): Promise<void> {
  const unit = await manager.findOne(AccommodationUnitEntity, {
    where: { id: unitId, campingId },
  })
  if (!unit) throw notFound('Unidad')
  const type = await manager.findOne(AccommodationTypeEntity, {
    where: { id: unit.typeId, campingId },
  })
  if (!type) throw notFound('Tipo de alojamiento')
  if (!unit.enabled || !type.enabled || type.inventoryMode === 'unlimited')
    errorForAvailability('La unidad')

  const reservations = await manager.find(ReservationEntity, {
    where: {
      campingId,
      unitId,
      status: reservationStatusFilter,
      ...dateRangeOverlap(checkInDate, checkOutDate),
    },
    select: { id: true },
  })
  if (
    reservations.some((reservation) => reservation.id !== excludeReservationId)
  )
    errorForAvailability('La unidad')

  const blocks = await manager.find(AccommodationBlockEntity, {
    where: {
      campingId,
      unitId,
      ...dateRangeOverlap(checkInDate, checkOutDate),
    },
    select: { id: true },
  })
  if (blocks.some((block) => block.id !== excludeBlockId))
    errorForAvailability('La unidad')
}

@Injectable()
export class AccommodationsService {
  constructor(private readonly dataSource: DataSource) {}

  async listBeds(context: AuthContext, unitId: string) {
    await this.readUnit(context, unitId)
    const beds = await this.dataSource
      .getRepository(AccommodationBedEntity)
      .find({
        where: { campingId: context.camping.id, unitId },
        order: { position: 'ASC', name: 'ASC', id: 'ASC' },
      })
    return beds.map(({ id, unitId, name, position, enabled }) =>
      accommodationBedSchema.parse({ id, unitId, name, position, enabled }),
    )
  }
  async saveBed(
    context: AuthContext,
    unitId: string,
    raw: unknown,
    id?: string,
  ) {
    const parsed = accommodationBedInputSchema.safeParse(raw)
    if (!parsed.success) throw zodBadRequest(parsed.error)
    try {
      return await withInventoryTransaction(
        this.dataSource,
        context,
        async (manager) => {
          const unit = await manager.findOneBy(AccommodationUnitEntity, {
            id: unitId,
            campingId: context.camping.id,
          })
          if (!unit) throw notFound('Unidad')
          const type = await manager.findOneByOrFail(AccommodationTypeEntity, {
            id: unit.typeId,
            campingId: context.camping.id,
          })
          if (type.inventoryMode !== 'shared')
            throw conflict('La unidad no es un dormitorio', 'VALIDATION_ERROR')
          const [before] = id
            ? await manager.query(
                `SELECT id,unit_id AS "unitId",name,position,enabled FROM camping_private.accommodation_beds WHERE camping_id=$1 AND unit_id=$2 AND id=$3`,
                [context.camping.id, unitId, id],
              )
            : []
          if (id && !before) throw notFound('Cama')
          if (id && !parsed.data.enabled) {
            const occupied = await manager.query(
              `SELECT 1 FROM camping_private.bed_occupancy WHERE camping_id=$1 AND bed_id=$2 LIMIT 1`,
              [context.camping.id, id],
            )
            if (occupied.length)
              throw conflict(
                'La cama tiene reservas activas',
                'INVENTORY_UNAVAILABLE',
              )
          }
          const enabled = await manager.query(
            `SELECT count(*)::int AS count FROM camping_private.accommodation_beds WHERE camping_id=$1 AND unit_id=$2 AND enabled AND ($3::uuid IS NULL OR id<>$3)`,
            [context.camping.id, unitId, id ?? null],
          )
          if (parsed.data.enabled && enabled[0].count >= unit.maxOccupancy)
            throw conflict(
              'Las camas exceden la capacidad del dormitorio',
              'VALIDATION_ERROR',
            )
          const values = [
            context.camping.id,
            unitId,
            parsed.data.name,
            parsed.data.position,
            parsed.data.enabled,
          ]
          const rows = id
            ? await manager.query(
                `UPDATE camping_private.accommodation_beds SET name=$3,position=$4,enabled=$5 WHERE camping_id=$1 AND unit_id=$2 AND id=$6 RETURNING id,unit_id AS "unitId",name,position,enabled`,
                [...values, id],
              )
            : await manager.query(
                `INSERT INTO camping_private.accommodation_beds(camping_id,unit_id,name,position,enabled) VALUES($1,$2,$3,$4,$5) RETURNING id,unit_id AS "unitId",name,position,enabled`,
                values,
              )
          const result = accommodationBedSchema.parse(rows[0])
          await this.recordMutation(
            manager,
            context,
            'accommodation_bed.updated',
            'AccommodationBed',
            result.id,
            before ?? null,
            result,
            'InventoryChanged',
            result,
          )
          return result
        },
      )
    } catch (error) {
      this.rethrowUnique(error, 'Ya existe una cama con ese nombre')
      throw error
    }
  }

  async listTypes(
    context: AuthContext,
    rawQuery: unknown,
  ): Promise<AccommodationType[]> {
    const parsedQuery = accommodationTypeListQuerySchema.safeParse(rawQuery)
    if (!parsedQuery.success) throw zodBadRequest(parsedQuery.error)
    const rows = await this.dataSource
      .getRepository(AccommodationTypeEntity)
      .find({
        where: { campingId: context.camping.id },
        order: { name: 'ASC', id: 'ASC' },
      })
    return rows.map((row) => this.toType(row))
  }

  async readType(context: AuthContext, id: string): Promise<AccommodationType> {
    const row = await this.dataSource
      .getRepository(AccommodationTypeEntity)
      .findOne({ where: { id, campingId: context.camping.id } })
    if (!row) throw notFound('Tipo de alojamiento')
    return this.toType(row)
  }

  async createType(
    context: AuthContext,
    raw: unknown,
  ): Promise<AccommodationType> {
    const parsed = accommodationTypeCreateSchema.safeParse(raw)
    if (!parsed.success) throw zodBadRequest(parsed.error)
    try {
      return await withInventoryTransaction(
        this.dataSource,
        contextFor(context),
        async (manager) => {
          const camping = await manager.findOneByOrFail(CampingEntity, {
            id: context.camping.id,
          })
          assertMoneyPrecision(
            parsed.data.baseNightlyPriceMinor,
            camping.currency,
            camping.moneyDecimals,
          )
          assertPricingPrecision(parsed.data.pricing, camping)
          const row = manager.create(AccommodationTypeEntity, {
            ...parsed.data,
            campingId: context.camping.id,
          })
          const saved = await manager.save(row)
          const result = this.toType(saved)
          await this.recordMutation(
            manager,
            context,
            'accommodation_type.created',
            'AccommodationType',
            saved.id,
            null,
            result,
            'InventoryChanged',
            result,
          )
          return result
        },
      )
    } catch (error) {
      this.rethrowUnique(
        error,
        'Ya existe un tipo de alojamiento con ese nombre',
      )
      throw error
    }
  }

  async updateType(
    context: AuthContext,
    id: string,
    raw: unknown,
  ): Promise<AccommodationType> {
    const parsed = accommodationTypePatchSchema.safeParse(raw)
    if (!parsed.success) throw zodBadRequest(parsed.error)
    try {
      return await withInventoryTransaction(
        this.dataSource,
        contextFor(context),
        async (manager) => {
          const row = await manager.findOne(AccommodationTypeEntity, {
            where: { id, campingId: context.camping.id },
            lock: { mode: 'pessimistic_write' },
          })
          if (!row) throw notFound('Tipo de alojamiento')
          if (
            parsed.data.baseNightlyPriceMinor !== undefined &&
            parsed.data.baseNightlyPriceMinor !== row.baseNightlyPriceMinor
          ) {
            const camping = await manager.findOneByOrFail(CampingEntity, {
              id: context.camping.id,
            })
            assertMoneyPrecision(
              parsed.data.baseNightlyPriceMinor,
              camping.currency,
              camping.moneyDecimals,
            )
          }
          const merged = accommodationTypeCreateSchema.safeParse({
            pricing:
              parsed.data.pricing !== undefined
                ? parsed.data.pricing
                : row.pricing,
            name: parsed.data.name ?? row.name,
            inventoryMode: parsed.data.inventoryMode ?? row.inventoryMode,
            maxOccupancy:
              parsed.data.maxOccupancy !== undefined
                ? parsed.data.maxOccupancy
                : row.maxOccupancy,
            baseNightlyPriceMinor:
              parsed.data.baseNightlyPriceMinor ?? row.baseNightlyPriceMinor,
            enabled: parsed.data.enabled ?? row.enabled,
          })
          if (!merged.success) throw zodBadRequest(merged.error)
          if (parsed.data.pricing)
            assertPricingPrecision(
              parsed.data.pricing,
              await manager.findOneByOrFail(CampingEntity, {
                id: context.camping.id,
              }),
            )

          if (merged.data.inventoryMode !== row.inventoryMode) {
            const [units, reservations] = await Promise.all([
              manager.count(AccommodationUnitEntity, {
                where: { campingId: context.camping.id, typeId: row.id },
              }),
              manager.count(ReservationEntity, {
                where: {
                  campingId: context.camping.id,
                  accommodationTypeId: row.id,
                },
              }),
            ])
            if (units || reservations)
              throw conflict(
                'No se puede cambiar el modo de inventario con unidades o reservas asociadas',
                'INVENTORY_MODE_LOCKED',
              )
          }
          if (row.enabled && !merged.data.enabled)
            await this.assertCanDisableTypeForId(manager, context, row.id)

          const before = this.toType(row)
          Object.assign(row, merged.data, { updatedAt: new Date() })
          const saved = await manager.save(row)
          const result = this.toType(saved)
          await this.recordMutation(
            manager,
            context,
            'accommodation_type.updated',
            'AccommodationType',
            saved.id,
            before,
            result,
            'InventoryChanged',
            result,
          )
          if (
            before.baseNightlyPriceMinor !== result.baseNightlyPriceMinor ||
            JSON.stringify(before.pricing) !== JSON.stringify(result.pricing)
          )
            await this.recordEvent(
              manager,
              context.camping.id,
              'AccommodationType',
              saved.id,
              'RateChanged',
              {
                before: {
                  baseNightlyPriceMinor: before.baseNightlyPriceMinor,
                  pricing: before.pricing,
                },
                after: {
                  baseNightlyPriceMinor: result.baseNightlyPriceMinor,
                  pricing: result.pricing,
                },
              },
            )
          return result
        },
      )
    } catch (error) {
      this.rethrowUnique(
        error,
        'Ya existe un tipo de alojamiento con ese nombre',
      )
      throw error
    }
  }

  async listUnits(
    context: AuthContext,
    rawQuery: unknown,
  ): Promise<AccommodationUnit[]> {
    const parsedQuery = accommodationUnitListQuerySchema.safeParse(rawQuery)
    if (!parsedQuery.success) throw zodBadRequest(parsedQuery.error)
    const typeId = parsedQuery.data.typeId
    if (typeId !== undefined) {
      const type = await this.dataSource
        .getRepository(AccommodationTypeEntity)
        .findOne({ where: { id: typeId, campingId: context.camping.id } })
      if (!type) throw notFound('Tipo de alojamiento')
    }
    const rows = await this.dataSource
      .getRepository(AccommodationUnitEntity)
      .find({
        where: typeId
          ? { campingId: context.camping.id, typeId }
          : { campingId: context.camping.id },
        order: { name: 'ASC', id: 'ASC' },
      })
    return rows.map((row) => this.toUnit(row))
  }

  async readUnit(context: AuthContext, id: string): Promise<AccommodationUnit> {
    const row = await this.dataSource
      .getRepository(AccommodationUnitEntity)
      .findOne({ where: { id, campingId: context.camping.id } })
    if (!row) throw notFound('Unidad')
    return this.toUnit(row)
  }

  async createUnit(
    context: AuthContext,
    raw: unknown,
  ): Promise<AccommodationUnit> {
    const parsed = accommodationUnitCreateSchema.safeParse(raw)
    if (!parsed.success) throw zodBadRequest(parsed.error)
    try {
      return await withInventoryTransaction(
        this.dataSource,
        contextFor(context),
        async (manager) => {
          const type = await this.requireIndividualType(
            manager,
            context.camping.id,
            parsed.data.typeId,
          )
          if (!type.enabled) errorForAvailability('El tipo de alojamiento')
          const row = manager.create(AccommodationUnitEntity, {
            ...parsed.data,
            campingId: context.camping.id,
          })
          const saved = await manager.save(row)
          const result = this.toUnit(saved)
          await this.recordMutation(
            manager,
            context,
            'accommodation_unit.created',
            'AccommodationUnit',
            saved.id,
            null,
            result,
            'InventoryChanged',
            result,
          )
          return result
        },
      )
    } catch (error) {
      this.rethrowUnique(error, 'Ya existe una unidad con ese nombre')
      throw error
    }
  }

  async updateUnit(
    context: AuthContext,
    id: string,
    raw: unknown,
  ): Promise<AccommodationUnit> {
    const parsed = accommodationUnitPatchSchema.safeParse(raw)
    if (!parsed.success) throw zodBadRequest(parsed.error)
    try {
      return await withInventoryTransaction(
        this.dataSource,
        contextFor(context),
        async (manager) => {
          const row = await manager.findOne(AccommodationUnitEntity, {
            where: { id, campingId: context.camping.id },
            lock: { mode: 'pessimistic_write' },
          })
          if (!row) throw notFound('Unidad')
          const targetTypeId = parsed.data.typeId ?? row.typeId
          const targetType = await this.requireIndividualType(
            manager,
            context.camping.id,
            targetTypeId,
          )
          if (
            parsed.data.typeId !== undefined &&
            parsed.data.typeId !== row.typeId
          ) {
            const [reservations, blocks] = await Promise.all([
              manager.count(ReservationEntity, {
                where: { campingId: context.camping.id, unitId: row.id },
              }),
              manager.count(AccommodationBlockEntity, {
                where: { campingId: context.camping.id, unitId: row.id },
              }),
            ])
            if (reservations || blocks)
              throw conflict(
                'No se puede mover una unidad con reservas o bloqueos asociados',
                'UNIT_TYPE_LOCKED',
              )
          }
          if (
            (parsed.data.typeId !== undefined ||
              parsed.data.enabled === true) &&
            !targetType.enabled
          )
            errorForAvailability('El tipo de alojamiento')
          if (row.enabled && parsed.data.enabled === false)
            await this.assertCanDisableUnit(manager, context, row.id)

          if (
            targetType.inventoryMode === 'shared' &&
            parsed.data.maxOccupancy !== undefined
          ) {
            const [beds] = await manager.query(
              `SELECT count(*)::int AS count FROM camping_private.accommodation_beds WHERE camping_id=$1 AND unit_id=$2 AND enabled`,
              [context.camping.id, row.id],
            )
            if (beds.count > parsed.data.maxOccupancy)
              throw conflict(
                'La capacidad no puede ser menor al inventario de camas habilitadas',
                'VALIDATION_ERROR',
              )
          }
          const before = this.toUnit(row)
          Object.assign(row, parsed.data, { updatedAt: new Date() })
          const saved = await manager.save(row)
          const result = this.toUnit(saved)
          await this.recordMutation(
            manager,
            context,
            'accommodation_unit.updated',
            'AccommodationUnit',
            saved.id,
            before,
            result,
            'InventoryChanged',
            result,
          )
          return result
        },
      )
    } catch (error) {
      this.rethrowUnique(error, 'Ya existe una unidad con ese nombre')
      throw error
    }
  }

  async listBlocks(
    context: AuthContext,
    rawQuery: unknown,
  ): Promise<ReservationBlock[]> {
    const parsedQuery = reservationBlockListQuerySchema.safeParse(rawQuery)
    if (!parsedQuery.success) throw zodBadRequest(parsedQuery.error)
    const query = parsedQuery.data
    await this.validateBlockFilters(context, query)
    const where: Record<string, unknown> = { campingId: context.camping.id }
    if (query.typeId) where.typeId = query.typeId
    if (query.unitId) where.unitId = query.unitId
    if (query.checkInDate && query.checkOutDate)
      Object.assign(
        where,
        dateRangeOverlap(query.checkInDate, query.checkOutDate),
      )
    const rows = await this.dataSource
      .getRepository(AccommodationBlockEntity)
      .find({
        where,
        order: { checkInDate: 'ASC', checkOutDate: 'ASC', id: 'ASC' },
      })
    return rows.map((row) => this.toBlock(row))
  }

  async readBlock(context: AuthContext, id: string): Promise<ReservationBlock> {
    const row = await this.dataSource
      .getRepository(AccommodationBlockEntity)
      .findOne({ where: { id, campingId: context.camping.id } })
    if (!row) throw notFound('Bloqueo')
    return this.toBlock(row)
  }

  async createBlock(
    context: AuthContext,
    raw: unknown,
  ): Promise<ReservationBlock> {
    const parsed = reservationBlockCreateSchema.safeParse(raw)
    if (!parsed.success) throw zodBadRequest(parsed.error)
    return withInventoryTransaction(
      this.dataSource,
      contextFor(context),
      async (manager) => {
        await this.assertBlockInventory(
          manager,
          context.camping.id,
          parsed.data.typeId,
          parsed.data.unitId,
        )
        await assertUnitAvailable(
          manager,
          context.camping.id,
          parsed.data.unitId,
          parsed.data.checkInDate,
          parsed.data.checkOutDate,
        )
        const row = manager.create(AccommodationBlockEntity, {
          ...parsed.data,
          campingId: context.camping.id,
        })
        try {
          const saved = await manager.save(row)
          const result = this.toBlock(saved)
          await this.recordMutation(
            manager,
            context,
            'accommodation_block.created',
            'AccommodationBlock',
            saved.id,
            null,
            result,
            'InventoryBlocked',
            result,
          )
          return result
        } catch (error) {
          this.rethrowUnique(error, 'El bloqueo ya existe')
          throw error
        }
      },
    )
  }

  async updateBlock(
    context: AuthContext,
    id: string,
    raw: unknown,
  ): Promise<ReservationBlock> {
    const parsed = reservationBlockPatchSchema.safeParse(raw)
    if (!parsed.success) throw zodBadRequest(parsed.error)
    return withInventoryTransaction(
      this.dataSource,
      contextFor(context),
      async (manager) => {
        const row = await manager.findOne(AccommodationBlockEntity, {
          where: { id, campingId: context.camping.id },
          lock: { mode: 'pessimistic_write' },
        })
        if (!row) throw notFound('Bloqueo')
        const merged = reservationBlockCreateSchema.safeParse({
          typeId: parsed.data.typeId ?? row.typeId,
          unitId: parsed.data.unitId ?? row.unitId,
          checkInDate: parsed.data.checkInDate ?? row.checkInDate,
          checkOutDate: parsed.data.checkOutDate ?? row.checkOutDate,
          reason: parsed.data.reason ?? row.reason,
        })
        if (!merged.success) throw zodBadRequest(merged.error)
        await this.assertBlockInventory(
          manager,
          context.camping.id,
          merged.data.typeId,
          merged.data.unitId,
        )
        await assertUnitAvailable(
          manager,
          context.camping.id,
          merged.data.unitId,
          merged.data.checkInDate,
          merged.data.checkOutDate,
          row.id,
        )
        const before = this.toBlock(row)
        Object.assign(row, merged.data, { updatedAt: new Date() })
        const saved = await manager.save(row)
        const result = this.toBlock(saved)
        await this.recordMutation(
          manager,
          context,
          'accommodation_block.updated',
          'AccommodationBlock',
          saved.id,
          before,
          result,
          'InventoryBlocked',
          result,
        )
        return result
      },
    )
  }

  async deleteBlock(context: AuthContext, id: string): Promise<{ ok: true }> {
    return withInventoryTransaction(
      this.dataSource,
      contextFor(context),
      async (manager) => {
        const row = await manager.findOne(AccommodationBlockEntity, {
          where: { id, campingId: context.camping.id },
          lock: { mode: 'pessimistic_write' },
        })
        if (!row) throw notFound('Bloqueo')
        const before = this.toBlock(row)
        const blockId = row.id
        await manager.remove(row)
        await this.recordMutation(
          manager,
          context,
          'accommodation_block.deleted',
          'AccommodationBlock',
          blockId,
          before,
          null,
          'InventoryReleased',
          { block: before },
        )
        return { ok: true as const }
      },
    )
  }

  private async validateBlockFilters(
    context: AuthContext,
    query: ReservationBlockListQuery,
  ): Promise<void> {
    if (query.typeId) {
      const type = await this.dataSource
        .getRepository(AccommodationTypeEntity)
        .findOne({
          where: { id: query.typeId, campingId: context.camping.id },
        })
      if (!type) throw notFound('Tipo de alojamiento')
    }
    if (query.unitId) {
      const unit = await this.dataSource
        .getRepository(AccommodationUnitEntity)
        .findOne({
          where: { id: query.unitId, campingId: context.camping.id },
        })
      if (!unit) throw notFound('Unidad')
    }
  }

  private async requireIndividualType(
    manager: EntityManager,
    campingId: string,
    typeId: string,
  ): Promise<AccommodationTypeEntity> {
    const type = await manager.findOne(AccommodationTypeEntity, {
      where: { id: typeId, campingId },
    })
    if (!type) throw notFound('Tipo de alojamiento')
    if (type.inventoryMode === 'unlimited')
      throw conflict(
        'Las unidades requieren inventario individual',
        'INVENTORY_MODE_INVALID',
      )
    return type
  }

  private async assertBlockInventory(
    manager: EntityManager,
    campingId: string,
    typeId: string,
    unitId: string,
  ): Promise<void> {
    const type = await manager.findOne(AccommodationTypeEntity, {
      where: { id: typeId, campingId },
    })
    if (!type) throw notFound('Tipo de alojamiento')
    if (type.inventoryMode === 'unlimited' || !type.enabled)
      errorForAvailability('El tipo de alojamiento')
    const unit = await manager.findOne(AccommodationUnitEntity, {
      where: { id: unitId, campingId },
    })
    if (!unit) throw notFound('Unidad')
    if (unit.typeId !== typeId)
      throw conflict(
        'La unidad no pertenece al tipo indicado',
        'UNIT_TYPE_MISMATCH',
      )
    if (!unit.enabled) errorForAvailability('La unidad')
  }

  private async assertCanDisableUnit(
    manager: EntityManager,
    context: AuthContext,
    unitId: string,
  ): Promise<void> {
    const reservations = await manager.find(ReservationEntity, {
      where: {
        campingId: context.camping.id,
        unitId,
        status: reservationStatusFilter,
      },
      select: { status: true, checkOutDate: true },
    })
    const today = todayInTimezone(context.camping.timezone)
    if (
      reservations.some(
        (reservation) =>
          reservation.status === 'checked_in' ||
          reservation.checkOutDate > today,
      )
    )
      throw conflict(
        'No se puede desactivar una unidad con reservas activas',
        'UNIT_HAS_ACTIVE_RESERVATIONS',
      )
  }

  private async assertCanDisableTypeForId(
    manager: EntityManager,
    context: AuthContext,
    typeId: string,
  ): Promise<void> {
    const reservations = await manager.find(ReservationEntity, {
      where: {
        campingId: context.camping.id,
        accommodationTypeId: typeId,
        status: reservationStatusFilter,
      },
      select: { status: true, checkOutDate: true },
    })
    const today = todayInTimezone(context.camping.timezone)
    if (
      reservations.some(
        (reservation) =>
          reservation.status === 'checked_in' ||
          reservation.checkOutDate > today,
      )
    )
      throw conflict(
        'No se puede desactivar un tipo con reservas activas',
        'TYPE_HAS_ACTIVE_RESERVATIONS',
      )
  }

  private async recordMutation(
    manager: EntityManager,
    context: AuthContext,
    action: string,
    entityType: string,
    entityId: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const audit = manager.create(AuditLogEntity, {
      campingId: context.camping.id,
      actorId: context.user.id,
      action,
      entityType,
      entityId,
      beforeState: before,
      afterState: after,
    })
    await manager.save(audit)
    await this.recordEvent(
      manager,
      context.camping.id,
      entityType,
      entityId,
      eventType,
      payload,
    )
  }

  private async recordEvent(
    manager: EntityManager,
    campingId: string,
    aggregateType: string,
    aggregateId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await manager.save(
      manager.create(OutboxEventEntity, {
        campingId,
        aggregateType,
        aggregateId,
        eventType,
        payload,
        publishedAt: null,
        attempts: 0,
        lastError: null,
      }),
    )
  }

  private rethrowUnique(error: unknown, message: string): void {
    if (isUniqueViolation(error))
      throw conflict(message, 'DUPLICATE_ACCOMMODATION')
  }

  private toType(row: AccommodationTypeEntity): AccommodationType {
    return accommodationTypeSchema.parse({
      id: row.id,
      campingId: row.campingId,
      name: row.name,
      inventoryMode: row.inventoryMode,
      pricing: row.pricing,
      maxOccupancy: row.maxOccupancy,
      baseNightlyPriceMinor: row.baseNightlyPriceMinor,
      enabled: row.enabled,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })
  }

  private toUnit(row: AccommodationUnitEntity): AccommodationUnit {
    return accommodationUnitSchema.parse({
      id: row.id,
      campingId: row.campingId,
      typeId: row.typeId,
      maxOccupancy: row.maxOccupancy,
      name: row.name,
      enabled: row.enabled,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })
  }

  private toBlock(row: AccommodationBlockEntity): ReservationBlock {
    return reservationBlockSchema.parse({
      id: row.id,
      campingId: row.campingId,
      typeId: row.typeId,
      unitId: row.unitId,
      checkInDate: row.checkInDate,
      checkOutDate: row.checkOutDate,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })
  }
}
