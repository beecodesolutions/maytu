import { occupancySettingsSchema } from '@camping/contracts'
import { BadRequestException, Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import {
  ageRangesSchema,
  campingProfileSchema,
  campingProfileUpdateSchema,
  ratesSchema,
  moneySettingsSchema,
  hasMoneyPrecision,
  type CampingProfile,
} from '@camping/contracts'
import { ensureSafeMoney } from '../common/date'
import { conflict, zodBadRequest, notFound } from '../common/errors'
import { withInventoryTransaction } from '../accommodations/inventory-transaction'
import { AuditLogEntity } from '../database/entities/audit-log.entity'
import { CampingEntity } from '../database/entities/camping.entity'
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
    const pendingAmountMinor = stays.reduce(
      (total, stay) =>
        ensureSafeMoney(
          total +
            Math.max(
              this.stayService.account(stay, camping.timezone).balanceMinor,
              0,
            ),
        ),
      0,
    )
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
      pendingAmountMinor,
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
        const before = { name: camping.name, timezone: camping.timezone }
        if (before.name === next.name && before.timezone === next.timezone)
          return
        if (
          before.name !== expected.name ||
          before.timezone !== expected.timezone
        )
          throw conflict(
            'La configuración cambió. Revisa los datos actuales.',
            'STALE_CAMPING_PROFILE',
          )
        if (before.timezone !== next.timezone) {
          const hasActiveStay = await manager
            .createQueryBuilder(StayEntity, 'stay')
            .where('stay.camping_id = :campingId', { campingId: camping.id })
            .andWhere('stay.closed_at IS NULL')
            .getExists()
          if (hasActiveStay)
            throw conflict(
              'Cierra las estadías activas antes de cambiar la zona horaria.',
              'ACTIVE_STAYS',
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
            afterState: next,
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
    await withInventoryTransaction(
      this.dataSource,
      context,
      async (manager) => {
        const camping = await manager.findOneByOrFail(CampingEntity, {
          id: context.camping.id,
        })
        await manager.update(CampingEntity, camping.id, {
          ...parsed.data,
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
                parsed.data.infantsConsumeCapacity ??
                camping.infantsConsumeCapacity,
              ageRanges: parsed.data.ageRanges ?? camping.ageRanges,
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
