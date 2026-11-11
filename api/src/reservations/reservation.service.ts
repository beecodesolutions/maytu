import { capacitySuitability, humanOccupancy } from '@camping/contracts'
import { availableBeds, assignBeds } from '../accommodations/bed-inventory'
import { createHash } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { DataSource, In, type EntityManager } from 'typeorm'
import {
  reservationSearchSchema,
  reservationSearchResponseSchema,
  type ReservationSearchResponse,
  reservationCreateSchema,
  reservationListQuerySchema,
  reservationPageSchema,
  reservationPatchSchema,
  reservationPriceSnapshotSchema,
  reservationQuoteCreateSchema,
  reservationQuoteSchema,
  reservationQuoteUpdateSchema,
  reservationUpdateQuoteSchema,
  reservationStatusCommandSchema,
  type ReservationCreate,
  type ReservationPage,
  type ReservationPatch,
  type ReservationQuote,
  type ReservationQuoteCreate,
  type ReservationQuoteUpdate,
  type ReservationResponse,
  type ReservationUpdateQuote,
} from '@camping/contracts'
import type { AuthContext } from '../auth/auth.types'
import { conflict, notFound, zodBadRequest } from '../common/errors'
import { todayInTimezone } from '@camping/contracts'
import { CampingEntity } from '../database/entities/camping.entity'
import { AccommodationTypeEntity } from '../database/entities/accommodation-type.entity'
import { AccommodationUnitEntity } from '../database/entities/accommodation-unit.entity'
import { StayEntity } from '../database/entities/stay.entity'
import { PaymentEntity } from '../database/entities/payment.entity'
import {
  ReservationEntity,
  type ReservationStatus,
} from '../database/entities/reservation.entity'
import { withInventoryTransaction } from '../accommodations/inventory-transaction'
import { AvailabilityService } from '../accommodations/availability.service'
import { assertUnitAvailable } from '../accommodations/accommodations.service'
import {
  baseFromSnapshot,
  priceAffectsReservation,
  priceSnapshotFor,
  snapshotWithoutInternalBase,
  type PriceSnapshot,
} from './reservation-pricing'
import {
  appendReservationMutation,
  lockReservation,
  lockReservationStay,
  nextReservationVersion,
  reservationView,
  reservationViews,
} from './reservation-support'

type QuoteInput = ReservationQuoteCreate
type CreateInput = ReservationCreate
type PatchInput = ReservationPatch

function state(row: ReservationEntity): Record<string, unknown> {
  return {
    reservationId: row.id,
    version: row.version,
    status: row.status,
    checkInDate: row.checkInDate,
    checkOutDate: row.checkOutDate,
    accommodationTypeId: row.accommodationTypeId,
    unitId: row.unitId,
    adults: row.adults,
    children: row.children,
    infants: row.infants,
    pets: row.pets,
    capacityOverrideReason: row.capacityOverrideReason,
    priceSnapshot: reservationPriceSnapshotSchema.parse(row.priceSnapshot),
    source: row.source,
  }
}

function hashCreate(value: CreateInput): string {
  const normalized = {
    ...value,
    unitId: value.unitId ?? null,
    email: value.email ?? null,
    phone: value.phone ?? null,
    document: value.document ?? null,
    nationality: value.nationality ?? null,
    source: value.source ?? 'manual',
    notes: value.notes ?? '',
  }
  const ordered = Object.fromEntries(
    Object.entries(normalized).sort(([a], [b]) => a.localeCompare(b)),
  )
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex')
}

function ensureAccepted(
  value:
    | Pick<CreateInput, 'acceptedTotalMinor'>
    | Pick<PatchInput, 'acceptedTotalMinor'>,
  total: number,
): void {
  const accepted = value.acceptedTotalMinor
  if (accepted === undefined || !Number.isSafeInteger(accepted) || accepted < 0)
    throw conflict('Debe aceptar el total cotizado', 'PRICE_CHANGED')
  if (accepted !== total)
    throw conflict('El precio cambió; cotiza nuevamente', 'PRICE_CHANGED')
}

function parseCreate(raw: unknown): CreateInput {
  const parsed = reservationCreateSchema.safeParse(raw)
  if (!parsed.success) throw zodBadRequest(parsed.error)
  const value: CreateInput = parsed.data
  if (
    !Number.isSafeInteger(value.acceptedTotalMinor) ||
    value.acceptedTotalMinor < 0
  )
    throw conflict('Debe aceptar el total cotizado', 'PRICE_CHANGED')
  return value
}

function parsePatch(raw: unknown): PatchInput {
  const parsed = reservationPatchSchema.safeParse(raw)
  if (!parsed.success) throw zodBadRequest(parsed.error)
  return parsed.data
}

function parseQuoteUpdate(raw: unknown): ReservationQuoteUpdate {
  const parsed = reservationQuoteUpdateSchema.safeParse(raw)
  if (!parsed.success) throw zodBadRequest(parsed.error)
  return parsed.data
}

function parseQuote(raw: unknown): QuoteInput {
  const parsed = reservationQuoteCreateSchema.safeParse(raw)
  if (!parsed.success) throw zodBadRequest(parsed.error)
  return parsed.data
}

function checkPeople(
  value: Pick<QuoteInput, 'adults' | 'children' | 'infants'>,
): void {
  if (!Number.isSafeInteger(value.adults + value.children + value.infants))
    throw conflict('Ocupación fuera de rango', 'OCCUPANCY_INVALID')
}

function nextStayVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value >= 2_147_483_647)
    throw conflict(
      'La versión de la estadía está fuera de rango',
      'VERSION_OVERFLOW',
    )
  return value + 1
}

@Injectable()
export class ReservationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly availabilityService: AvailabilityService,
  ) {}

  async search(
    context: AuthContext,
    raw: unknown,
  ): Promise<ReservationSearchResponse> {
    const parsed = reservationSearchSchema.safeParse(raw)
    if (!parsed.success) throw zodBadRequest(parsed.error)
    const input = parsed.data
    if (input.checkInDate < todayInTimezone(context.camping.timezone))
      throw conflict(
        'La entrada no puede ser anterior a hoy',
        'RESERVATION_DATE_PAST',
      )
    const campingId = context.camping.id
    // One consistent snapshot, with a fixed number of reads regardless of unit count.
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      const availability = await this.availabilityService.readSnapshot(
        manager,
        context,
        input,
      )
      const camping = await manager.findOneOrFail(CampingEntity, {
        where: { id: campingId },
      })
      const types = await manager.find(AccommodationTypeEntity, {
        where: { campingId, enabled: true },
      })
      const units = await manager.find(AccommodationUnitEntity, {
        where: { campingId, enabled: true },
      })
      const typesById = new Map(types.map((type) => [type.id, type]))
      const unitsById = new Map(units.map((unit) => [unit.id, unit]))
      const offers: ReservationSearchResponse['offers'] = []
      for (const available of availability.types) {
        const type = typesById.get(available.typeId)
        if (!type) continue
        const { includeInsufficientCapacity: _filter, ...composition } = input
        const quoteInput = { ...composition, accommodationTypeId: type.id }
        if (type.inventoryMode === 'unlimited') {
          offers.push({
            input: quoteInput,
            accommodationName: type.name,
            capacityMatch: 'EXACT',
            sparePlaces: 0,
            priceSnapshot: snapshotWithoutInternalBase(
              this.calculateSnapshot(quoteInput, type, camping, undefined),
            ),
          })
          continue
        }
        const candidateIds =
          available.inventoryMode === 'individual'
            ? available.availableUnitIds
            : available.inventoryMode === 'shared'
              ? available.units.map((u) => u.unitId)
              : []
        for (const id of candidateIds) {
          const unit = unitsById.get(id)
          if (!unit || unit.typeId !== type.id) continue
          const fit = capacitySuitability(
            input,
            unit.maxOccupancy,
            camping.infantsConsumeCapacity,
          )
          let bedInfo = {}
          if (type.inventoryMode === 'shared') {
            const beds =
              available.inventoryMode === 'shared'
                ? (available.units.find((u) => u.unitId === id)
                    ?.availableBeds ?? 0)
                : 0
            const required = humanOccupancy(
              input,
              camping.infantsConsumeCapacity,
            )
            if (input.adults < 1 || beds < required) continue
            bedInfo = { availableBeds: beds, requestedBeds: required }
            fit.capacityMatch = 'EXACT'
            fit.sparePlaces = 0
          } else if (
            fit.capacityMatch === 'INSUFFICIENT' &&
            !fit.childrenOverflow &&
            !input.includeInsufficientCapacity
          )
            continue
          const unitInput = { ...quoteInput, unitId: id }
          offers.push({
            input: unitInput,
            accommodationName: `${type.name} · ${unit.name}`,
            capacityMatch: fit.capacityMatch,
            sparePlaces: fit.sparePlaces,
            ...bedInfo,
            ...(fit.capacityMatch === 'INSUFFICIENT'
              ? {
                  occupancyWarning: {
                    maxOccupancy: unit.maxOccupancy,
                    people: fit.people,
                  },
                }
              : {}),
            priceSnapshot: snapshotWithoutInternalBase(
              this.calculateSnapshot(unitInput, type, camping, undefined),
            ),
          })
        }
      }
      const rank = { EXACT: 0, OVERSIZED: 1, INSUFFICIENT: 2 }
      offers.sort(
        (a, b) =>
          rank[a.capacityMatch ?? 'EXACT'] - rank[b.capacityMatch ?? 'EXACT'] ||
          a.priceSnapshot.totalMinor - b.priceSnapshot.totalMinor ||
          a.accommodationName.localeCompare(b.accommodationName) ||
          (a.input.unitId ?? '').localeCompare(b.input.unitId ?? ''),
      )

      return reservationSearchResponseSchema.parse({ offers })
    })
  }

  async quote(context: AuthContext, raw: unknown): Promise<ReservationQuote> {
    const input = parseQuote(raw)
    return withInventoryTransaction(
      this.dataSource,
      { campingId: context.camping.id },
      async (manager) => {
        const type = await this.validateInventory(
          manager,
          context.camping.id,
          input,
          undefined,
        )
        const camping = await manager.findOneOrFail(CampingEntity, {
          where: { id: context.camping.id },
        })
        const snapshot = this.calculateSnapshot(input, type, camping, undefined)
        const unit = input.unitId
          ? await manager.findOneOrFail(AccommodationUnitEntity, {
              where: { id: input.unitId, campingId: context.camping.id },
            })
          : null
        const people = humanOccupancy(input, camping.infantsConsumeCapacity)
        const bedInfo =
          type.inventoryMode === 'shared' && input.unitId
            ? {
                requestedBeds: people,
                availableBeds: (
                  await availableBeds(
                    manager,
                    context.camping.id,
                    input.unitId,
                    input.checkInDate,
                    input.checkOutDate,
                  )
                ).length,
              }
            : {}
        return reservationQuoteSchema.parse({
          ...bedInfo,
          ...(unit && people > unit.maxOccupancy
            ? { occupancyWarning: { maxOccupancy: unit.maxOccupancy, people } }
            : {}),
          ...(unit
            ? {
                capacityMatch:
                  type.inventoryMode === 'shared'
                    ? 'EXACT'
                    : capacitySuitability(
                        input,
                        unit.maxOccupancy,
                        camping.infantsConsumeCapacity,
                      ).capacityMatch,
                sparePlaces:
                  type.inventoryMode === 'shared'
                    ? 0
                    : Math.max(0, unit.maxOccupancy - people),
              }
            : {}),
          priceSnapshot: snapshotWithoutInternalBase(snapshot),
        })
      },
    )
  }

  async create(
    context: AuthContext,
    raw: unknown,
  ): Promise<ReservationResponse> {
    const input = parseCreate(raw)
    checkPeople(input)
    const requestHash = hashCreate(input)
    return withInventoryTransaction(
      this.dataSource,
      { campingId: context.camping.id },
      async (manager) => {
        const existing = await manager.findOne(ReservationEntity, {
          where: {
            campingId: context.camping.id,
            idempotencyKey: input.idempotencyKey,
          },
          lock: { mode: 'pessimistic_write' },
        })
        if (existing) {
          if (existing.createRequestHash !== requestHash)
            throw conflict(
              'La clave de idempotencia ya fue utilizada con otros datos',
              'IDEMPOTENCY_CONFLICT',
            )
          return reservationView(manager, context, existing)
        }
        const type = await this.validateInventory(
          manager,
          context.camping.id,
          input,
          undefined,
        )
        const camping = await manager.findOneOrFail(CampingEntity, {
          where: { id: context.camping.id },
        })
        const snapshot = this.calculateSnapshot(input, type, camping, undefined)
        ensureAccepted(input, snapshot.totalMinor)
        const row = manager.create(ReservationEntity, {
          ...input,
          campingId: context.camping.id,
          unitId: input.unitId ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          document: input.document ?? null,
          nationality: input.nationality ?? null,
          source: input.source ?? 'manual',
          notes: input.notes ?? '',
          status: 'pending',
          priceSnapshot: snapshotWithoutInternalBase(snapshot),
          createRequestHash: requestHash,
          version: 1,
        })
        const saved = await manager.save(row)
        if (['pending', 'confirmed', 'checked_in'].includes(saved.status))
          await assignBeds(
            manager,
            saved,
            humanOccupancy(
              saved,
              saved.priceSnapshot.infantsConsumeCapacity ?? false,
            ),
          )
        await appendReservationMutation(
          manager,
          context,
          saved,
          'reservation.created',
          'ReservationCreated',
          null,
          state(saved),
        )
        return reservationView(manager, context, saved)
      },
    )
  }

  async list(context: AuthContext, raw: unknown): Promise<ReservationPage> {
    const parsed = reservationListQuerySchema.safeParse(raw)
    if (!parsed.success) throw zodBadRequest(parsed.error)
    const query = parsed.data
    const runner = this.dataSource.createQueryRunner()
    await runner.connect()
    await runner.startTransaction('REPEATABLE READ')
    try {
      const repository = runner.manager.getRepository(ReservationEntity)
      if (query.typeId) {
        const type = await runner.manager.findOne(AccommodationTypeEntity, {
          where: { id: query.typeId, campingId: context.camping.id },
          select: { id: true },
        })
        if (!type) throw notFound('Tipo de alojamiento')
      }
      const builder = repository
        .createQueryBuilder('reservation')
        .where('reservation.camping_id = :campingId', {
          campingId: context.camping.id,
        })
      if (query.status)
        builder.andWhere('reservation.status = :status', {
          status: query.status,
        })
      if (query.typeId)
        builder.andWhere('reservation.accommodation_type_id = :typeId', {
          typeId: query.typeId,
        })
      if (query.checkInDate)
        builder.andWhere(
          'reservation.check_in_date < :checkOutDate AND reservation.check_out_date > :checkInDate',
          query,
        )
      const [rows, total] = await builder
        .orderBy('reservation.check_in_date', 'ASC')
        .addOrderBy('reservation.created_at', 'DESC')
        .addOrderBy('reservation.id', 'ASC')
        .skip((query.page - 1) * query.pageSize)
        .take(query.pageSize)
        .getManyAndCount()
      if (rows.length) {
        const payments = await runner.manager.find(PaymentEntity, {
          where: {
            campingId: context.camping.id,
            reservationId: In(rows.map((row) => row.id)),
          },
          order: { createdAt: 'ASC', id: 'ASC' },
        })
        const paymentsByReservation = new Map<string, PaymentEntity[]>()
        for (const payment of payments) {
          const list = paymentsByReservation.get(payment.reservationId!) ?? []
          list.push(payment)
          paymentsByReservation.set(payment.reservationId!, list)
        }
        for (const row of rows)
          row.payments = paymentsByReservation.get(row.id) ?? []
      }
      const items = await reservationViews(runner.manager, context, rows)
      await runner.commitTransaction()
      return reservationPageSchema.parse({
        items,
        total,
        page: query.page,
        pageSize: query.pageSize,
      })
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction()
      throw error
    } finally {
      await runner.release()
    }
  }

  async get(context: AuthContext, id: string): Promise<ReservationResponse> {
    const runner = this.dataSource.createQueryRunner()
    await runner.connect()
    await runner.startTransaction('REPEATABLE READ')
    try {
      const row = await lockReservation(runner.manager, context.camping.id, id)
      const value = await reservationView(runner.manager, context, row)
      await runner.commitTransaction()
      return value
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction()
      throw error
    } finally {
      await runner.release()
    }
  }

  async quoteEdit(
    context: AuthContext,
    id: string,
    raw: unknown,
  ): Promise<ReservationUpdateQuote> {
    const patch = parseQuoteUpdate(raw)
    return withInventoryTransaction(
      this.dataSource,
      { campingId: context.camping.id },
      async (manager) => {
        const row = await lockReservation(manager, context.camping.id, id)
        if (row.status === 'checked_in')
          return this.quoteCheckedIn(manager, context, row, patch)
        if (row.status !== 'pending' && row.status !== 'confirmed')
          throw conflict(
            'La reserva no se puede editar',
            'INVALID_RESERVATION_STATE',
          )
        if (row.version !== patch.version)
          throw conflict(
            'La reserva cambió; actualiza la pantalla',
            'STALE_RESERVATION',
          )
        const replacement = this.replacement(row, patch)
        const type = await this.validateInventory(
          manager,
          context.camping.id,
          replacement,
          row.id,
        )
        const camping = await manager.findOneOrFail(CampingEntity, {
          where: { id: context.camping.id },
        })
        const snapshot = this.calculateSnapshot(replacement, type, camping, row)
        return reservationUpdateQuoteSchema.parse({
          reservationId: row.id,
          version: row.version,
          priceSnapshot: snapshotWithoutInternalBase(snapshot),
        })
      },
    )
  }

  async update(
    context: AuthContext,
    id: string,
    raw: unknown,
  ): Promise<ReservationResponse> {
    const patch = parsePatch(raw)
    return withInventoryTransaction(
      this.dataSource,
      { campingId: context.camping.id },
      async (manager) => {
        const row = await lockReservation(manager, context.camping.id, id)
        if (row.status === 'checked_in')
          return this.updateCheckedIn(manager, context, row, patch)
        if (row.status !== 'pending' && row.status !== 'confirmed')
          throw conflict(
            'La reserva no se puede editar',
            'INVALID_RESERVATION_STATE',
          )
        if (row.version !== patch.version)
          throw conflict(
            'La reserva cambió; actualiza la pantalla',
            'STALE_RESERVATION',
          )
        const replacement = this.replacement(row, patch)
        const pricing = priceAffectsReservation(patch)
        const before = state(row)
        let nextSnapshot: PriceSnapshot | null = null
        if (pricing) {
          const type = await this.validateInventory(
            manager,
            context.camping.id,
            replacement,
            row.id,
          )
          const camping = await manager.findOneOrFail(CampingEntity, {
            where: { id: context.camping.id },
          })
          nextSnapshot = this.calculateSnapshot(replacement, type, camping, row)
          ensureAccepted(patch, nextSnapshot.totalMinor)
        }
        Object.assign(row, {
          ...replacement,
          unitId: replacement.unitId ?? null,
          email: replacement.email ?? null,
          phone: replacement.phone ?? null,
          document: replacement.document ?? null,
          nationality: replacement.nationality ?? null,
          notes: replacement.notes ?? '',
          priceSnapshot:
            pricing && nextSnapshot
              ? snapshotWithoutInternalBase(nextSnapshot)
              : row.priceSnapshot,
          version: nextReservationVersion(row.version),
          updatedAt: new Date(),
        })
        const saved = await manager.save(row)
        if (['pending', 'confirmed', 'checked_in'].includes(saved.status))
          await assignBeds(
            manager,
            saved,
            humanOccupancy(
              saved,
              saved.priceSnapshot.infantsConsumeCapacity ?? false,
            ),
          )
        await appendReservationMutation(
          manager,
          context,
          saved,
          'reservation.updated',
          'ReservationUpdated',
          before,
          state(saved),
        )
        return reservationView(manager, context, saved)
      },
    )
  }

  async command(
    context: AuthContext,
    id: string,
    action: 'confirm' | 'cancel' | 'no-show',
    raw: unknown,
  ): Promise<ReservationResponse> {
    const parsed = reservationStatusCommandSchema.safeParse(raw)
    if (!parsed.success) throw zodBadRequest(parsed.error)
    return withInventoryTransaction(
      this.dataSource,
      { campingId: context.camping.id },
      async (manager) => {
        const row = await lockReservation(manager, context.camping.id, id)
        const target: ReservationStatus =
          action === 'confirm'
            ? 'confirmed'
            : action === 'cancel'
              ? 'cancelled'
              : 'no_show'
        if (row.status === target) return reservationView(manager, context, row)
        if (row.version !== parsed.data.version)
          throw conflict(
            'La reserva cambió; actualiza la pantalla',
            'STALE_RESERVATION',
          )
        const allowed =
          action === 'confirm'
            ? row.status === 'pending'
            : row.status === 'pending' || row.status === 'confirmed'
        if (!allowed)
          throw conflict(
            'La transición de estado no es válida',
            'INVALID_RESERVATION_STATE',
          )
        if (
          action === 'no-show' &&
          todayInTimezone(context.camping.timezone) < row.checkInDate
        )
          throw conflict(
            'Todavía no corresponde marcar no presentado',
            'NO_SHOW_TOO_EARLY',
          )
        const before = state(row)
        row.status = target
        row.version = nextReservationVersion(row.version)
        row.updatedAt = new Date()
        const saved = await manager.save(row)
        if (['pending', 'confirmed', 'checked_in'].includes(saved.status))
          await assignBeds(
            manager,
            saved,
            humanOccupancy(
              saved,
              saved.priceSnapshot.infantsConsumeCapacity ?? false,
            ),
          )
        await appendReservationMutation(
          manager,
          context,
          saved,
          `reservation.${action}`,
          `Reservation${action[0].toUpperCase()}${action.slice(1).replace('-', '')}`,
          before,
          state(saved),
        )
        return reservationView(manager, context, saved)
      },
    )
  }

  private checkedInEditKeys = new Set([
    'version',
    'checkOutDate',
    'acceptedTotalMinor',
    'agreedTotalMinor',
    'priceAdjustmentReason',
  ])

  private assertCheckedInEditShape(patch: ReservationPatch): void {
    const keys = Object.keys(patch)
    if (
      !patch.checkOutDate ||
      keys.some((key) => !this.checkedInEditKeys.has(key))
    )
      throw conflict(
        'Una reserva ingresada solo permite cambiar checkOutDate y precio',
        'RESERVATION_CHECKED_IN_FIELDS_FORBIDDEN',
      )
  }

  private checkedInCheckout(
    row: ReservationEntity,
    checkOutDate: string,
    timezone: string,
  ): void {
    if (
      checkOutDate <= row.checkInDate ||
      Date.parse(checkOutDate) - Date.parse(row.checkInDate) > 366 * 86400000
    )
      throw conflict(
        'La salida debe ser posterior al ingreso real',
        'VALIDATION_ERROR',
      )
    const today = todayInTimezone(timezone)
    if (checkOutDate < today)
      throw conflict('La salida no puede quedar en el pasado', 'PAST_CHECKOUT')
    if (checkOutDate > row.checkOutDate && checkOutDate <= today)
      throw conflict(
        'La extensión debe terminar después de hoy',
        'FUTURE_CHECKOUT_REQUIRED',
      )
  }

  private checkedInSnapshot(
    row: ReservationEntity,
    patch: ReservationPatch,
  ): PriceSnapshot {
    const checkOutDate = patch.checkOutDate!
    const current = reservationPriceSnapshotSchema.parse(row.priceSnapshot)
    const explicitOverride =
      patch.agreedTotalMinor !== undefined ||
      patch.priceAdjustmentReason !== undefined
    if (!explicitOverride)
      return baseFromSnapshot(
        current,
        row.checkInDate,
        checkOutDate,
        row.adults,
        row.children,
        row.infants,
      )
    return priceSnapshotFor({
      inventoryMode:
        current.basis === 'per_bed'
          ? 'shared'
          : current.basis === 'per_unit'
            ? 'individual'
            : 'unlimited',
      pricing: current.pricing,
      infantsConsumeCapacity: current.infantsConsumeCapacity,
      pets: row.pets,
      currency: current.currency,
      moneyDecimals: current.moneyDecimals,
      baseNightlyPriceMinor:
        current.basis !== 'per_person'
          ? current.baseNightlyPriceMinor
          : undefined,
      rates: current.basis === 'per_person' ? current.rates : undefined,
      ageRanges: current.basis === 'per_person' ? current.ageRanges : undefined,
      checkInDate: row.checkInDate,
      checkOutDate,
      adults: row.adults,
      children: row.children,
      infants: row.infants,
      agreedTotalMinor: patch.agreedTotalMinor,
      priceAdjustmentReason: patch.priceAdjustmentReason,
    })
  }

  private async quoteCheckedIn(
    manager: EntityManager,
    context: AuthContext,
    row: ReservationEntity,
    patch: ReservationQuoteUpdate,
  ): Promise<ReservationUpdateQuote> {
    this.assertCheckedInEditShape(patch)
    if (row.version !== patch.version)
      throw conflict(
        'La reserva cambió; actualiza la pantalla',
        'STALE_RESERVATION',
      )
    this.checkedInCheckout(row, patch.checkOutDate!, context.camping.timezone)
    const stay = await lockReservationStay(manager, context.camping.id, row.id)
    if (stay.closure) throw conflict('La estadía ya fue cerrada', 'STAY_CLOSED')
    const snapshot = this.checkedInSnapshot(row, patch)
    await this.validateInventory(
      manager,
      context.camping.id,
      {
        accommodationTypeId: row.accommodationTypeId,
        unitId: row.unitId ?? undefined,
        checkInDate: row.checkInDate,
        checkOutDate: patch.checkOutDate!,
        adults: row.adults,
        children: row.children,
        infants: row.infants,
        pets: row.pets,
        capacityOverrideReason: row.capacityOverrideReason ?? undefined,
      },
      row.id,
    )
    return reservationUpdateQuoteSchema.parse({
      reservationId: row.id,
      version: row.version,
      priceSnapshot: snapshotWithoutInternalBase(snapshot),
    })
  }

  private async updateCheckedIn(
    manager: EntityManager,
    context: AuthContext,
    row: ReservationEntity,
    patch: ReservationPatch,
  ): Promise<ReservationResponse> {
    this.assertCheckedInEditShape(patch)
    if (row.version !== patch.version)
      throw conflict(
        'La reserva cambió; actualiza la pantalla',
        'STALE_RESERVATION',
      )
    this.checkedInCheckout(row, patch.checkOutDate!, context.camping.timezone)
    const stay = await lockReservationStay(manager, context.camping.id, row.id)
    if (stay.closure) throw conflict('La estadía ya fue cerrada', 'STAY_CLOSED')
    const snapshot = this.checkedInSnapshot(row, patch)
    await this.validateInventory(
      manager,
      context.camping.id,
      {
        accommodationTypeId: row.accommodationTypeId,
        unitId: row.unitId ?? undefined,
        checkInDate: row.checkInDate,
        checkOutDate: patch.checkOutDate!,
        adults: row.adults,
        children: row.children,
        infants: row.infants,
        pets: row.pets,
        capacityOverrideReason: row.capacityOverrideReason ?? undefined,
      },
      row.id,
    )
    ensureAccepted(patch, snapshot.totalMinor)
    const before = state(row)
    const stayValue = stay as StayEntity & {
      accommodationPriceSnapshot: ReturnType<
        typeof reservationPriceSnapshotSchema.parse
      >
    }
    stay.estimatedDeparture = patch.checkOutDate!
    stayValue.accommodationPriceSnapshot = snapshotWithoutInternalBase(snapshot)
    stay.version = nextStayVersion(stay.version)
    await manager.save(stay)
    row.checkOutDate = patch.checkOutDate!
    row.priceSnapshot = snapshotWithoutInternalBase(snapshot)
    row.version = nextReservationVersion(row.version)
    row.updatedAt = new Date()
    const saved = await manager.save(row)
    if (['pending', 'confirmed', 'checked_in'].includes(saved.status))
      await assignBeds(
        manager,
        saved,
        humanOccupancy(
          saved,
          saved.priceSnapshot.infantsConsumeCapacity ?? false,
        ),
      )
    await appendReservationMutation(
      manager,
      context,
      saved,
      'reservation.checked_in_updated',
      'InventoryChanged',
      { ...before, stayId: stay.id },
      {
        ...state(saved),
        stayId: stay.id,
        stay: {
          stayId: stay.id,
          estimatedDeparture: stay.estimatedDeparture,
          accommodationPriceSnapshot: snapshotWithoutInternalBase(snapshot),
          version: stay.version,
        },
      },
    )
    return reservationView(manager, context, saved)
  }

  private replacement(
    row: ReservationEntity,
    patch: PatchInput | ReservationQuoteUpdate,
  ): QuoteInput & Partial<ReservationCreate> {
    return {
      accommodationTypeId: patch.accommodationTypeId ?? row.accommodationTypeId,
      unitId:
        patch.unitId !== undefined
          ? (patch.unitId ?? undefined)
          : (row.unitId ?? undefined),
      checkInDate: patch.checkInDate ?? row.checkInDate,
      checkOutDate: patch.checkOutDate ?? row.checkOutDate,
      adults: patch.adults ?? row.adults,
      children: patch.children ?? row.children,
      infants: patch.infants ?? row.infants,
      pets: patch.pets ?? row.pets,
      capacityOverrideReason:
        patch.capacityOverrideReason ?? row.capacityOverrideReason ?? undefined,
      agreedTotalMinor: patch.agreedTotalMinor,
      priceAdjustmentReason: patch.priceAdjustmentReason,
      responsibleName: patch.responsibleName ?? row.responsibleName,
      email:
        patch.email !== undefined
          ? (patch.email ?? undefined)
          : (row.email ?? undefined),
      phone:
        patch.phone !== undefined
          ? (patch.phone ?? undefined)
          : (row.phone ?? undefined),
      document:
        patch.document !== undefined
          ? (patch.document ?? undefined)
          : (row.document ?? undefined),
      nationality: (patch.nationality !== undefined
        ? (patch.nationality ?? undefined)
        : (row.nationality ?? undefined)) as ReservationCreate['nationality'],
      source: patch.source ?? row.source,
      notes: patch.notes !== undefined ? (patch.notes ?? undefined) : row.notes,
    }
  }

  private calculateSnapshot(
    input: QuoteInput,
    type: AccommodationTypeEntity,
    camping: CampingEntity,
    row: ReservationEntity | undefined,
  ): PriceSnapshot {
    const sameType = row && row.accommodationTypeId === type.id
    const prior = sameType ? row.priceSnapshot : undefined
    const explicitOverride =
      input.agreedTotalMinor !== undefined ||
      input.priceAdjustmentReason !== undefined
    if (sameType && prior) {
      const frozen = baseFromSnapshot(
        prior,
        input.checkInDate,
        input.checkOutDate,
        input.adults,
        input.children,
        input.infants,
        input.pets ?? 0,
      )
      if (explicitOverride)
        return priceSnapshotFor({
          ...input,
          inventoryMode: type.inventoryMode,
          pricing: prior.pricing,
          infantsConsumeCapacity: prior.infantsConsumeCapacity,
          currency: prior.currency,
          moneyDecimals: prior.moneyDecimals,
          baseNightlyPriceMinor:
            prior.basis !== 'per_person'
              ? prior.baseNightlyPriceMinor
              : undefined,
          rates: prior.basis === 'per_person' ? prior.rates : undefined,
          ageRanges: prior.basis === 'per_person' ? prior.ageRanges : undefined,
        })
      return frozen
    }
    const result = priceSnapshotFor({
      ...input,
      inventoryMode: type.inventoryMode,
      pricing: type.pricing
        ? { ...type.pricing, baseNightlyPriceMinor: type.baseNightlyPriceMinor }
        : undefined,
      infantsConsumeCapacity: camping.infantsConsumeCapacity,
      currency: camping.currency,
      moneyDecimals: row
        ? row.priceSnapshot.moneyDecimals
        : camping.moneyDecimals,
      baseNightlyPriceMinor: type.baseNightlyPriceMinor,
      rates: camping.rates,
      ageRanges: camping.ageRanges,
    })
    return result
  }

  private async validateInventory(
    manager: EntityManager,
    campingId: string,
    input: QuoteInput,
    excludeReservationId: string | undefined,
  ): Promise<AccommodationTypeEntity> {
    checkPeople(input)
    if (
      input.checkOutDate <= input.checkInDate ||
      Date.parse(input.checkOutDate) - Date.parse(input.checkInDate) >
        366 * 86400000
    )
      throw conflict(
        'checkOutDate must be after checkInDate',
        'VALIDATION_ERROR',
      )
    const type = await manager.findOne(AccommodationTypeEntity, {
      where: { id: input.accommodationTypeId, campingId },
    })
    if (!type) throw notFound('Tipo de alojamiento')
    if (!type.enabled)
      throw conflict(
        'El tipo de alojamiento no está habilitado',
        'INVENTORY_UNAVAILABLE',
      )
    if (type.inventoryMode === 'unlimited') {
      if (input.unitId)
        throw conflict('El camping no admite unidad', 'UNIT_NOT_ALLOWED')
      return type
    }
    if (!input.unitId)
      throw conflict('La reserva requiere una unidad', 'UNIT_REQUIRED')
    const unit = await manager.findOne(AccommodationUnitEntity, {
      where: { id: input.unitId, campingId },
    })
    if (!unit) throw notFound('Unidad')
    if (unit.typeId !== type.id)
      throw conflict(
        'La unidad no pertenece al tipo indicado',
        'UNIT_TYPE_MISMATCH',
      )
    if (!unit.enabled)
      throw conflict('La unidad no está habilitada', 'INVENTORY_UNAVAILABLE')
    const camping = await manager.findOneByOrFail(CampingEntity, {
      id: campingId,
    })
    const previous = excludeReservationId
      ? await manager.findOneBy(ReservationEntity, {
          campingId,
          id: excludeReservationId,
        })
      : null
    const infantsConsumeCapacity =
      previous?.accommodationTypeId === type.id
        ? (previous.priceSnapshot.infantsConsumeCapacity ??
          camping.infantsConsumeCapacity)
        : camping.infantsConsumeCapacity
    if (type.inventoryMode === 'shared') {
      if (input.adults < 1)
        throw conflict(
          'Los dormitorios requieren al menos un adulto',
          'VALIDATION_ERROR',
        )
      const beds = await availableBeds(
        manager,
        campingId,
        unit.id,
        input.checkInDate,
        input.checkOutDate,
        excludeReservationId,
      )
      if (beds.length < humanOccupancy(input, infantsConsumeCapacity))
        throw conflict('No hay suficientes camas', 'INVENTORY_UNAVAILABLE')
      return type
    }
    const fit = capacitySuitability(
      input,
      unit.maxOccupancy,
      infantsConsumeCapacity,
    )
    if (
      fit.capacityMatch === 'INSUFFICIENT' &&
      !fit.childrenOverflow &&
      !input.capacityOverrideReason?.trim()
    )
      throw conflict(
        'Indica el motivo para exceder la capacidad',
        'CAPACITY_OVERRIDE_REQUIRED',
      )
    await assertUnitAvailable(
      manager,
      campingId,
      input.unitId,
      input.checkInDate,
      input.checkOutDate,
      undefined,
      excludeReservationId,
    )
    return type
  }
}
