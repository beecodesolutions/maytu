import { availableBeds, assignBeds } from '../accommodations/bed-inventory'
import { humanOccupancy } from '@camping/contracts'
import { Injectable } from '@nestjs/common'
import { DataSource, type EntityManager } from 'typeorm'
import {
  reservationCheckInQuoteSchema,
  reservationCheckInSchema,
  reservationPriceSnapshotSchema,
  type ReservationCheckIn,
  type ReservationCheckInQuote,
  type ReservationQuote,
  type ReservationResponse,
} from '@camping/contracts'
import { todayInTimezone } from '@camping/contracts'
import type { AuthContext } from '../auth/auth.types'
import { conflict, notFound, zodBadRequest } from '../common/errors'
import { AccommodationTypeEntity } from '../database/entities/accommodation-type.entity'
import { AccommodationUnitEntity } from '../database/entities/accommodation-unit.entity'
import { CampingEntity } from '../database/entities/camping.entity'
import { PaymentEntity } from '../database/entities/payment.entity'
import { ReservationEntity } from '../database/entities/reservation.entity'
import { StayEntity } from '../database/entities/stay.entity'
import { withInventoryTransaction } from '../accommodations/inventory-transaction'
import { assertUnitAvailable } from '../accommodations/accommodations.service'
import {
  appendReservationMutation,
  lockReservation,
  lockReservationStay,
  nextReservationVersion,
  reservationView,
} from './reservation-support'
import {
  baseFromSnapshot,
  snapshotWithoutInternalBase,
  type PriceSnapshot,
} from './reservation-pricing'

type StayLifecycleFields = StayEntity & {
  accommodationTypeId: string
  unitId: string | null
  accommodationPriceSnapshot: ReturnType<
    typeof reservationPriceSnapshotSchema.parse
  >
}

function parseQuote(raw: unknown): ReservationCheckInQuote {
  const parsed = reservationCheckInQuoteSchema.safeParse(raw)
  if (!parsed.success) throw zodBadRequest(parsed.error)
  return parsed.data
}

function parseCheckIn(raw: unknown): ReservationCheckIn {
  const parsed = reservationCheckInSchema.safeParse(raw)
  if (!parsed.success) throw zodBadRequest(parsed.error)
  return parsed.data
}

function acceptedTotal(value: number, expected: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value !== expected)
    throw conflict('El precio cambió; cotiza nuevamente', 'PRICE_CHANGED')
}

function reservationBefore(row: ReservationEntity): Record<string, unknown> {
  return {
    reservationId: row.id,
    stayId: null,
    version: row.version,
    status: row.status,
    checkInDate: row.checkInDate,
    checkOutDate: row.checkOutDate,
    accommodationTypeId: row.accommodationTypeId,
    unitId: row.unitId,
    adults: row.adults,
    children: row.children,
    infants: row.infants,
    responsibleName: row.responsibleName,
    email: row.email,
    phone: row.phone,
    document: row.document,
    nationality: row.nationality,
    source: row.source,
    notes: row.notes,
    priceSnapshot: row.priceSnapshot,
  }
}

function reservationAfter(
  row: ReservationEntity,
  stayId: string,
  stay: StayEntity,
): Record<string, unknown> {
  return {
    ...reservationBefore(row),
    stayId,
    stay: stateOfStay(stay),
  }
}

function lifecycleFields(stay: StayEntity): StayLifecycleFields {
  return stay as StayLifecycleFields
}

function dateError(
  arrivalDate: string,
  reservedDate: string,
  today: string,
  checkout: string,
): void {
  if (arrivalDate < reservedDate)
    throw conflict(
      'La fecha de ingreso es anterior a la reserva',
      'CHECKIN_TOO_EARLY',
    )
  if (arrivalDate > today)
    throw conflict('La fecha de ingreso no puede ser futura', 'FUTURE_CHECKIN')
  if (arrivalDate >= checkout)
    throw conflict(
      'La fecha de ingreso debe ser anterior a la salida',
      'CHECKIN_AFTER_CHECKOUT',
    )
}

function stateOfStay(stay: StayEntity): Record<string, unknown> {
  const value = lifecycleFields(stay)
  return {
    stayId: stay.id,
    reservationId: stay.reservationId,
    arrivalDate: stay.arrivalDate,
    estimatedDeparture: stay.estimatedDeparture,
    unitId: value.unitId ?? null,
    accommodationPriceSnapshot: value.accommodationPriceSnapshot,
    version: stay.version,
  }
}

@Injectable()
export class ReservationCheckInService {
  constructor(private readonly dataSource: DataSource) {}

  async quote(
    context: AuthContext,
    reservationId: string,
    raw: unknown,
  ): Promise<ReservationQuote> {
    const input = parseQuote(raw)
    return withInventoryTransaction(
      this.dataSource,
      { campingId: context.camping.id },
      async (manager) => {
        const reservation = await lockReservation(
          manager,
          context.camping.id,
          reservationId,
        )
        if (reservation.status !== 'confirmed')
          throw conflict(
            'Solo se puede cotizar el ingreso de una reserva confirmada',
            'INVALID_RESERVATION_STATE',
          )
        if (reservation.version !== input.version)
          throw conflict(
            'La reserva cambió; actualiza la pantalla',
            'STALE_RESERVATION',
          )
        const snapshot = await this.snapshotForArrival(
          manager,
          context,
          reservation,
          input.arrivalDate,
        )
        return {
          priceSnapshot: snapshotWithoutInternalBase(snapshot),
        }
      },
    )
  }

  async checkIn(
    context: AuthContext,
    reservationId: string,
    raw: unknown,
  ): Promise<ReservationResponse> {
    const input = parseCheckIn(raw)
    return withInventoryTransaction(
      this.dataSource,
      { campingId: context.camping.id },
      async (manager) => {
        const reservation = await lockReservation(
          manager,
          context.camping.id,
          reservationId,
        )
        const existingStay = await manager.findOne(StayEntity, {
          where: {
            campingId: context.camping.id,
            reservationId: reservation.id,
          },
        })
        if (reservation.status === 'checked_in') {
          if (!existingStay)
            throw conflict(
              'La reserva no tiene una estadía vinculada',
              'CHECKIN_STATE_INVALID',
            )
          return this.replay(context, manager, reservation, input)
        }
        if (reservation.status === 'checked_out')
          throw conflict(
            'La reserva ya fue cerrada',
            'RESERVATION_ALREADY_CLOSED',
          )
        if (reservation.status !== 'confirmed')
          throw conflict(
            'Solo se puede ingresar una reserva confirmada',
            'INVALID_RESERVATION_STATE',
          )
        if (reservation.version !== input.version)
          throw conflict(
            'La reserva cambió; actualiza la pantalla',
            'STALE_RESERVATION',
          )

        const snapshot = await this.snapshotForArrival(
          manager,
          context,
          reservation,
          input.arrivalDate,
        )
        acceptedTotal(input.acceptedTotalMinor, snapshot.totalMinor)
        await this.validateTypeAndUnit(manager, context.camping.id, reservation)
        const unit = reservation.unitId
          ? await manager.findOne(AccommodationUnitEntity, {
              where: { id: reservation.unitId, campingId: context.camping.id },
            })
          : null
        const location = input.location || unit?.name || ''
        const rowBefore = reservationBefore(reservation)
        const camping = await manager.findOneOrFail(CampingEntity, {
          where: { id: context.camping.id },
        })
        const stay = manager.create(StayEntity, {
          campingId: context.camping.id,
          createdById: context.user.id,
          reservationId: reservation.id,
          responsibleName: reservation.responsibleName,
          document: reservation.document ?? '',
          nationality: reservation.nationality ?? '',
          phone: reservation.phone ?? '',
          arrivalDate: input.arrivalDate,
          estimatedDeparture: reservation.checkOutDate,
          adults: reservation.adults,
          children: reservation.children,
          infants: reservation.infants,
          pets: reservation.pets,
          hasVehicle: input.hasVehicle,
          vehicleDescription: input.vehicleDescription,
          licensePlate: input.licensePlate,
          location,
          currency: snapshot.currency,
          moneyDecimals: snapshot.moneyDecimals ?? null,
          ageRanges:
            snapshot.basis === 'per_person'
              ? snapshot.ageRanges
              : camping.ageRanges,
          rates:
            snapshot.basis === 'per_person' ? snapshot.rates : camping.rates,
          version: 1,
          closedAt: null,
          closedById: null,
          closure: null,
          ...({
            accommodationTypeId: reservation.accommodationTypeId,
            unitId: reservation.unitId,
            accommodationPriceSnapshot: snapshotWithoutInternalBase(snapshot),
          } as Record<string, unknown>),
        } as StayEntity)
        // The check-in transaction owns the physical occupancy check. It runs
        // after the reservation lock and before creating the linked stay.
        await this.assertPhysicalUnitFree(
          manager,
          context.camping.id,
          reservation.unitId,
        )
        await manager.save(stay)
        const payments = await manager.find(PaymentEntity, {
          where: {
            campingId: context.camping.id,
            reservationId: reservation.id,
          },
        })
        for (const payment of payments) {
          payment.stayId = stay.id
          await manager.save(payment)
        }
        reservation.checkInDate = input.arrivalDate
        reservation.priceSnapshot = snapshotWithoutInternalBase(snapshot)
        reservation.status = 'checked_in'
        reservation.version = nextReservationVersion(reservation.version)
        reservation.updatedAt = new Date()
        const saved = await manager.save(reservation)
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
          'reservation.checked_in',
          'InventoryChanged',
          rowBefore,
          reservationAfter(saved, stay.id, stay),
        )
        return reservationView(manager, context, saved)
      },
    )
  }

  async snapshotForArrival(
    manager: EntityManager,
    context: AuthContext,
    reservation: ReservationEntity,
    arrivalDate: string,
  ): Promise<PriceSnapshot> {
    const today = todayInTimezone(context.camping.timezone)
    dateError(
      arrivalDate,
      reservation.checkInDate,
      today,
      reservation.checkOutDate,
    )
    if (
      reservation.status !== 'confirmed' &&
      reservation.status !== 'checked_in'
    )
      throw conflict(
        'La reserva no está lista para ingresar',
        'INVALID_RESERVATION_STATE',
      )
    await this.validateTypeAndUnit(manager, context.camping.id, reservation)
    if (reservation.unitId && reservation.priceSnapshot.basis !== 'per_bed')
      await assertUnitAvailable(
        manager,
        context.camping.id,
        reservation.unitId,
        arrivalDate,
        reservation.checkOutDate,
        undefined,
        reservation.id,
      )
    await this.assertPhysicalUnitFree(
      manager,
      context.camping.id,
      reservation.unitId,
    )
    if (reservation.unitId && reservation.priceSnapshot.basis === 'per_bed') {
      const beds = await availableBeds(
        manager,
        context.camping.id,
        reservation.unitId,
        arrivalDate,
        reservation.checkOutDate,
        reservation.id,
      )
      if (
        beds.length <
        humanOccupancy(
          reservation,
          reservation.priceSnapshot.infantsConsumeCapacity ?? false,
        )
      )
        throw conflict('No hay suficientes camas', 'INVENTORY_UNAVAILABLE')
    }
    const snapshot = baseFromSnapshot(
      reservationPriceSnapshotSchema.parse(reservation.priceSnapshot),
      arrivalDate,
      reservation.checkOutDate,
      reservation.adults,
      reservation.children,
      reservation.infants,
    )
    return snapshot
  }

  private async validateTypeAndUnit(
    manager: EntityManager,
    campingId: string,
    reservation: ReservationEntity,
  ): Promise<AccommodationTypeEntity> {
    const type = await manager.findOne(AccommodationTypeEntity, {
      where: { id: reservation.accommodationTypeId, campingId },
    })
    if (!type) throw notFound('Tipo de alojamiento')
    if (!type.enabled)
      throw conflict(
        'El tipo de alojamiento no está habilitado',
        'INVENTORY_UNAVAILABLE',
      )
    if (type.inventoryMode === 'unlimited') {
      if (reservation.unitId)
        throw conflict('El camping no admite unidad', 'UNIT_NOT_ALLOWED')
      return type
    }
    if (!reservation.unitId)
      throw conflict('La reserva requiere una unidad', 'UNIT_REQUIRED')
    const unit = await manager.findOne(AccommodationUnitEntity, {
      where: {
        id: reservation.unitId,
        campingId,
        typeId: reservation.accommodationTypeId,
      },
    })
    if (!unit) throw notFound('Unidad')
    if (!unit.enabled)
      throw conflict('La unidad no está habilitada', 'INVENTORY_UNAVAILABLE')
    return type
  }

  private async assertPhysicalUnitFree(
    manager: EntityManager,
    campingId: string,
    unitId: string | null,
    excludeStayId?: string,
  ): Promise<void> {
    if (!unitId) return
    const shared = await manager.query(
      `SELECT 1 FROM camping_private.accommodation_units u JOIN camping_private.accommodation_types t ON t.id=u.accommodation_type_id AND t.camping_id=u.camping_id WHERE u.camping_id=$1 AND u.id=$2 AND t.inventory_mode='shared'`,
      [campingId, unitId],
    )
    if (shared.length) return
    const unit = await manager.findOne(AccommodationUnitEntity, {
      where: { id: unitId, campingId },
      select: { id: true, name: true },
    })
    if (!unit) throw notFound('Unidad')
    const builder = manager
      .createQueryBuilder(StayEntity, 'stay')
      .select('stay.id')
      .leftJoin(
        ReservationEntity,
        'linkedReservation',
        'linkedReservation.id = stay.reservation_id AND linkedReservation.camping_id = :campingId',
      )
      .where('stay.camping_id = :campingId', { campingId })
      .andWhere('stay.closed_at IS NULL')
      .andWhere('linkedReservation.unit_id = :unitId', { unitId })
    if (excludeStayId)
      builder.andWhere('stay.id <> :excludeStayId', { excludeStayId })
    const occupied = await builder.getOne()
    if (occupied)
      throw conflict('La unidad ya está ocupada', 'INVENTORY_UNAVAILABLE')
  }

  private async replay(
    context: AuthContext,
    manager: EntityManager,
    reservation: ReservationEntity,
    input: ReservationCheckIn,
  ): Promise<ReservationResponse> {
    const stay = await lockReservationStay(
      manager,
      context.camping.id,
      reservation.id,
    )
    const fields = lifecycleFields(stay)
    if (stay.arrivalDate !== input.arrivalDate)
      throw conflict(
        'La reserva ya ingresó con otra fecha',
        'CHECKIN_REPLAY_MISMATCH',
      )
    if (
      stay.hasVehicle !== input.hasVehicle ||
      stay.vehicleDescription !== input.vehicleDescription ||
      stay.licensePlate !== input.licensePlate ||
      (input.location !== '' && stay.location !== input.location)
    )
      throw conflict(
        'La reserva ya ingresó con otros datos',
        'CHECKIN_REPLAY_MISMATCH',
      )
    if (fields.accommodationPriceSnapshot == null)
      throw conflict(
        'La estadía vinculada no tiene precio',
        'CHECKIN_STATE_INVALID',
      )
    return reservationView(manager, context, reservation)
  }
}
