import { isDeepStrictEqual } from 'node:util'
import { occupancySettingsSchema } from '@camping/contracts'
import { BadRequestException, Injectable } from '@nestjs/common'
import { DataSource, In } from 'typeorm'
import {
  ageRangesSchema,
  campingProfileSchema,
  campingProfileUpdateSchema,
  ratesSchema,
  moneySettingsSchema,
  hasMoneyPrecision,
  currencyDecimals,
  type CampingProfile,
} from '@camping/contracts'
import { ensureSafeMoney } from '../common/date'
import { conflict, zodBadRequest, notFound } from '../common/errors'
import { withInventoryTransaction } from '../accommodations/inventory-transaction'
import { AuditLogEntity } from '../database/entities/audit-log.entity'
import { CampingEntity } from '../database/entities/camping.entity'
import { ReservationEntity } from '../database/entities/reservation.entity'
import { StayEntity } from '../database/entities/stay.entity'
import type { AuthContext } from '../auth/auth.types'
import { StayService } from '../stays/stay.service'

@Injectable()
export class CampingService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly stayService: StayService,
  ) {}

  async profile(context: AuthContext): Promise<CampingProfile> {
    const camping = await this.dataSource
      .getRepository(CampingEntity)
      .findOne({ where: { id: context.camping.id } })
    if (!camping) throw notFound('Camping')
    const row = await this.dataSource
      .getRepository(StayEntity)
      .createQueryBuilder('stay')
      .select('COUNT(stay.id)', 'groups')
      .addSelect(
        'COALESCE(SUM(stay.adults + stay.children + stay.infants), 0)',
        'people',
      )
      .addSelect(
        'COALESCE(SUM(CASE WHEN stay.has_vehicle THEN 1 ELSE 0 END), 0)',
        'vehicles',
      )
      .where('stay.camping_id = :campingId', { campingId: camping.id })
      .andWhere('stay.closed_at IS NULL')
      .getRawOne<{ groups: string; people: string; vehicles: string }>()
    const stays = await this.dataSource.getRepository(StayEntity).find({
      where: { campingId: camping.id },
      relations: { extras: true, payments: true },
    })
    const balances = new Map<string, number>()
    for (const stay of stays) {
      const amount = this.stayService.account(
        stay,
        camping.timezone,
      ).balanceMinor
      if (amount > 0)
        balances.set(
          stay.currency,
          ensureSafeMoney((balances.get(stay.currency) ?? 0) + amount),
        )
    }
    return campingProfileSchema.parse({
      id: camping.id,
      name: camping.name,
      country: camping.country,
      currency: camping.currency,
      timezone: camping.timezone,
      moneyDecimals: camping.moneyDecimals,
      infantsConsumeCapacity: camping.infantsConsumeCapacity,
      ageRanges: ageRangesSchema.parse(camping.ageRanges),
      rates: ratesSchema.parse(camping.rates),
      activeGroups: Number(row?.groups ?? 0),
      activePeople: Number(row?.people ?? 0),
      activeVehicles: Number(row?.vehicles ?? 0),
      pendingAmountMinor: balances.get(camping.currency) ?? 0,
      pendingBalances: [...balances]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([currency, amountMinor]) => ({ currency, amountMinor })),
    })
  }

  async updateProfile(
    context: AuthContext,
    raw: unknown,
  ): Promise<CampingProfile> {
    const parsed = campingProfileUpdateSchema.safeParse(raw)
    if (!parsed.success) throw zodBadRequest(parsed.error)
    const { expected, ...next } = parsed.data
    await withInventoryTransaction(
      this.dataSource,
      context,
      async (manager) => {
        const camping = await manager.findOneByOrFail(CampingEntity, {
          id: context.camping.id,
        })
        const before = {
          name: camping.name,
          timezone: camping.timezone,
          country: camping.country,
          currency: camping.currency,
        }
        const after = { ...before, ...next }
        const changingTimezone = after.timezone !== before.timezone
        const changingCurrency = after.currency !== before.currency
        if (
          after.name === before.name &&
          after.country === before.country &&
          !changingTimezone &&
          !changingCurrency
        )
          return
        if (
          before.name !== expected.name ||
          before.timezone !== expected.timezone ||
          (expected.country !== undefined &&
            before.country !== expected.country) ||
          (expected.currency !== undefined &&
            before.currency !== expected.currency)
        )
          throw conflict(
            'La configuración cambió. Revisa los datos actuales.',
            'STALE_CAMPING_PROFILE',
          )
        if (changingTimezone || changingCurrency) {
          const hasActiveStay = await manager
            .createQueryBuilder(StayEntity, 'stay')
            .where('stay.camping_id = :campingId', { campingId: camping.id })
            .andWhere('stay.closed_at IS NULL')
            .getExists()
          if (hasActiveStay)
            throw changingCurrency
              ? conflict(
                  'Cierra las estadías activas antes de cambiar la moneda.',
                  'ACTIVE_STAYS_CURRENCY',
                )
              : conflict(
                  'Cierra las estadías activas antes de cambiar la zona horaria.',
                  'ACTIVE_STAYS',
                )
        }
        if (changingCurrency) {
          if (
            currencyDecimals(after.currency) !==
            currencyDecimals(before.currency)
          )
            throw conflict(
              'La nueva moneda debe tener la misma cantidad de decimales para conservar las tarifas configuradas.',
              'CURRENCY_PRECISION',
            )
          const hasOpenReservation = await manager.existsBy(ReservationEntity, {
            campingId: camping.id,
            status: In(['pending', 'confirmed', 'checked_in']),
          })
          if (hasOpenReservation)
            throw conflict(
              'Finaliza las reservas abiertas antes de cambiar la moneda.',
              'OPEN_RESERVATIONS_CURRENCY',
            )
        }
        await manager.update(CampingEntity, camping.id, {
          ...next,
          updatedAt: new Date(),
        })
        await manager.save(
          AuditLogEntity,
          manager.create(AuditLogEntity, {
            campingId: camping.id,
            actorId: context.user.id,
            action: 'camping.profile_updated',
            entityType: 'Camping',
            entityId: camping.id,
            beforeState: before,
            afterState: after,
          }),
        )
      },
    )
    return this.profile(context)
  }

  async updateOccupancySettings(
    context: AuthContext,
    raw: unknown,
  ): Promise<CampingProfile> {
    const parsed = occupancySettingsSchema.safeParse(raw)
    if (!parsed.success) throw zodBadRequest(parsed.error)
    const { expectedAgeRanges, ...settings } = parsed.data
    await withInventoryTransaction(
      this.dataSource,
      context,
      async (manager) => {
        const camping = await manager.findOneByOrFail(CampingEntity, {
          id: context.camping.id,
        })
        const agesChanged =
          settings.ageRanges !== undefined &&
          !isDeepStrictEqual(settings.ageRanges, camping.ageRanges)
        if (
          agesChanged &&
          expectedAgeRanges &&
          !isDeepStrictEqual(expectedAgeRanges, camping.ageRanges)
        )
          throw conflict(
            'Los rangos de edad cambiaron. Revisa los valores actuales.',
            'STALE_AGE_RANGES',
          )
        if (
          !agesChanged &&
          (settings.infantsConsumeCapacity === undefined ||
            settings.infantsConsumeCapacity === camping.infantsConsumeCapacity)
        )
          return
        await manager.update(CampingEntity, camping.id, {
          ...settings,
          updatedAt: new Date(),
        })
        await manager.save(
          AuditLogEntity,
          manager.create(AuditLogEntity, {
            campingId: camping.id,
            actorId: context.user.id,
            action: 'camping.occupancy_settings_updated',
            entityType: 'Camping',
            entityId: camping.id,
            beforeState: {
              infantsConsumeCapacity: camping.infantsConsumeCapacity,
              ageRanges: camping.ageRanges,
            },
            afterState: {
              infantsConsumeCapacity:
                settings.infantsConsumeCapacity ??
                camping.infantsConsumeCapacity,
              ageRanges: settings.ageRanges ?? camping.ageRanges,
            },
          }),
        )
      },
    )
    return this.profile(context)
  }

  async updateMoneySettings(
    context: AuthContext,
    raw: unknown,
  ): Promise<CampingProfile> {
    const parsed = moneySettingsSchema.safeParse(raw)
    if (!parsed.success) throw zodBadRequest(parsed.error)
    await withInventoryTransaction(
      this.dataSource,
      context,
      async (manager) => {
        const camping = await manager.findOneByOrFail(CampingEntity, {
          id: context.camping.id,
        })
        if (camping.moneyDecimals === parsed.data.moneyDecimals) return
        await manager.update(CampingEntity, camping.id, {
          moneyDecimals: parsed.data.moneyDecimals,
          updatedAt: new Date(),
        })
        await manager.save(
          AuditLogEntity,
          manager.create(AuditLogEntity, {
            campingId: camping.id,
            actorId: context.user.id,
            action: 'camping.money_settings_updated',
            entityType: 'Camping',
            entityId: camping.id,
            beforeState: { moneyDecimals: camping.moneyDecimals },
            afterState: { moneyDecimals: parsed.data.moneyDecimals },
          }),
        )
      },
    )
    return this.profile(context)
  }

  async updateRates(
    context: AuthContext,
    raw: unknown,
  ): Promise<CampingProfile> {
    const parsed = ratesSchema.safeParse(raw)
    if (!parsed.success) throw zodBadRequest(parsed.error)
    const camping = await this.dataSource
      .getRepository(CampingEntity)
      .findOneByOrFail({ id: context.camping.id })
    if (
      (Object.keys(parsed.data) as Array<keyof typeof parsed.data>).some(
        (category) =>
          parsed.data[category] !== camping.rates[category] &&
          !hasMoneyPrecision(
            parsed.data[category],
            camping.currency,
            camping.moneyDecimals,
          ),
      )
    )
      throw new BadRequestException(
        'Este camping no admite centavos en las tarifas',
      )
    await this.dataSource
      .getRepository(CampingEntity)
      .update(
        { id: context.camping.id },
        { rates: parsed.data, updatedAt: new Date() },
      )
    return this.profile(context)
  }
}
