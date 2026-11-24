import { Injectable } from '@nestjs/common'
import { DataSource, type EntityManager } from 'typeorm'
import {
  hasMoneyPrecision,
  reservationPaymentInputSchema,
  reservationPaymentVoidSchema,
  type ReservationPaymentInput,
  type ReservationResponse,
} from '@camping/contracts'
import type { AuthContext } from '../auth/auth.types'
import { withInventoryTransaction } from '../accommodations/inventory-transaction'
import { todayInTimezone } from '@camping/contracts'
import { conflict, notFound, zodBadRequest } from '../common/errors'
import { PaymentEntity } from '../database/entities/payment.entity'
import { StayEntity } from '../database/entities/stay.entity'
import { ReservationEntity } from '../database/entities/reservation.entity'
import {
  appendReservationMutation,
  lockReservation,
  lockReservationStay,
  nextReservationVersion,
  reservationView,
} from './reservation-support'

type PaymentInput = ReservationPaymentInput & { note: string }

function safeMoney(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw conflict(`Importe inválido: ${label}`, 'MONEY_OVERFLOW')
  return value
}

function safeAdd(left: number, right: number, label: string): number {
  const result = left + right
  return safeMoney(result, label)
}

function safeBalance(value: number): number {
  if (!Number.isSafeInteger(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)
    throw conflict('Importe inválido: balance', 'MONEY_OVERFLOW')
  return value
}

function inputWithDefaultNote(input: ReservationPaymentInput): PaymentInput {
  return { ...input, note: input.note ?? '' }
}

function paymentConflict(): ReturnType<typeof conflict> {
  return conflict(
    'La clave de idempotencia ya fue usada con otro pago',
    'IDEMPOTENCY_CONFLICT',
  )
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
export class ReservationPaymentsService {
  constructor(private readonly dataSource: DataSource) {}

  async recordPayment(
    context: AuthContext,
    reservationId: string,
    raw: unknown,
  ): Promise<ReservationResponse> {
    const parsed = reservationPaymentInputSchema.safeParse(raw)
    if (!parsed.success) throw zodBadRequest(parsed.error)
    const input = inputWithDefaultNote(parsed.data)

    return withInventoryTransaction(
      this.dataSource,
      context,
      async (manager) => {
        const reservation = await lockReservation(
          manager,
          context.camping.id,
          reservationId,
        )
        const existing = await manager.findOne(PaymentEntity, {
          where: {
            campingId: context.camping.id,
            idempotencyKey: input.idempotencyKey,
          },
        })
        if (existing) {
          this.assertReplay(existing, reservation.id, input)
          return reservationView(manager, context, reservation)
        }

        await this.assertReservationCanRecordPayment(manager, reservation)
        this.assertPaymentDate(input.paidOn, context.camping.timezone)
        const payments = await manager.find(PaymentEntity, {
          where: {
            campingId: context.camping.id,
            reservationId: reservation.id,
          },
        })
        const before = {
          reservationId: reservation.id,
          version: reservation.version,
          amountMinor: input.amountMinor,
          idempotencyKey: input.idempotencyKey,
          method: input.method,
          paidOn: input.paidOn,
        }
        if (
          !hasMoneyPrecision(
            input.amountMinor,
            reservation.priceSnapshot.currency,
            reservation.priceSnapshot.moneyDecimals,
          )
        )
          throw conflict(
            'Esta reserva no admite centavos en los pagos',
            'MONEY_PRECISION_INVALID',
          )
        this.assertAccountSafe(reservation, payments, input.amountMinor)

        const payment = manager.create(PaymentEntity, {
          campingId: context.camping.id,
          reservationId: reservation.id,
          stayId: null,
          amountMinor: input.amountMinor,
          method: input.method,
          paidOn: input.paidOn,
          note: input.note,
          recordedById: context.user.id,
          idempotencyKey: input.idempotencyKey,
          voidedAt: null,
          voidedById: null,
          voidReason: null,
        })
        await manager.save(payment)

        const oldVersion = reservation.version
        reservation.version = nextReservationVersion(reservation.version)
        reservation.updatedAt = new Date()
        await manager.save(reservation)
        const after = {
          ...before,
          version: reservation.version,
          paymentId: payment.id,
        }
        await appendReservationMutation(
          manager,
          context,
          reservation,
          'reservation.payment_recorded',
          'PaymentRecorded',
          { ...before, version: oldVersion },
          after,
        )
        return reservationView(manager, context, reservation)
      },
    )
  }

  async voidPayment(
    context: AuthContext,
    reservationId: string,
    paymentId: string,
    raw: unknown,
  ): Promise<ReservationResponse> {
    const parsed = reservationPaymentVoidSchema.safeParse(raw)
    if (!parsed.success) throw zodBadRequest(parsed.error)
    const input = parsed.data

    return withInventoryTransaction(
      this.dataSource,
      context,
      async (manager) => {
        const reservation = await lockReservation(
          manager,
          context.camping.id,
          reservationId,
        )
        const payment = await manager.findOne(PaymentEntity, {
          where: {
            id: paymentId,
            campingId: context.camping.id,
            reservationId: reservation.id,
          },
        })
        if (!payment) throw notFound('Pago')
        if (payment.voidedAt !== null) {
          if (payment.voidReason === input.voidReason)
            return reservationView(manager, context, reservation)
          throw conflict(
            'El pago ya fue anulado con otro motivo',
            'PAYMENT_ALREADY_VOIDED',
          )
        }

        const linkedStay = await this.assertReservationCanVoidPayment(
          manager,
          reservation,
          payment,
        )
        const before = {
          reservationId: reservation.id,
          version: reservation.version,
          paymentId: payment.id,
          amountMinor: payment.amountMinor,
          idempotencyKey: payment.idempotencyKey,
          method: payment.method,
          paidOn: payment.paidOn,
        }
        const oldVersion = reservation.version
        payment.voidedAt = new Date()
        payment.voidedById = context.user.id
        payment.voidReason = input.voidReason
        await manager.save(payment)
        if (linkedStay) {
          linkedStay.version = nextStayVersion(linkedStay.version)
          await manager.save(linkedStay)
        }
        reservation.version = nextReservationVersion(reservation.version)
        reservation.updatedAt = new Date()
        await manager.save(reservation)
        const after = {
          ...before,
          version: reservation.version,
          ...(linkedStay
            ? { stayId: linkedStay.id, stayVersion: linkedStay.version }
            : {}),
          voidedAt: payment.voidedAt?.toISOString() ?? null,
          voidedBy: payment.voidedById,
          voidReason: payment.voidReason,
        }
        await appendReservationMutation(
          manager,
          context,
          reservation,
          'reservation.payment_voided',
          'PaymentVoided',
          {
            ...before,
            version: oldVersion,
            ...(linkedStay ? { stayId: linkedStay.id } : {}),
          },
          after,
        )
        return reservationView(manager, context, reservation)
      },
    )
  }

  private assertReplay(
    existing: PaymentEntity,
    reservationId: string,
    input: PaymentInput,
  ): void {
    if (
      existing.reservationId !== reservationId ||
      existing.amountMinor !== input.amountMinor ||
      existing.method !== input.method ||
      existing.paidOn !== input.paidOn ||
      existing.note !== input.note
    )
      throw paymentConflict()
  }

  private assertPaymentDate(paidOn: string, timezone: string): void {
    if (paidOn > todayInTimezone(timezone))
      throw conflict(
        'La fecha del pago no puede ser futura',
        'FUTURE_PAYMENT_DATE',
      )
  }

  private async linkedStayFor(
    manager: EntityManager,
    reservation: ReservationEntity,
  ): Promise<StayEntity | null> {
    return manager.findOne(StayEntity, {
      where: {
        campingId: reservation.campingId,
        reservationId: reservation.id,
      },
    })
  }

  private async assertReservationCanRecordPayment(
    manager: EntityManager,
    reservation: ReservationEntity,
  ): Promise<void> {
    const linkedStay = await this.linkedStayFor(manager, reservation)
    if (linkedStay)
      throw conflict(
        'La reserva ya está vinculada a una estadía',
        'RESERVATION_LINKED_STAY',
      )
    if (
      reservation.status === 'checked_in' ||
      reservation.status === 'checked_out'
    )
      throw conflict(
        'La reserva ya ingresó o fue cerrada',
        'RESERVATION_STATUS_CLOSED',
      )
    if (reservation.status !== 'confirmed')
      throw conflict(
        'La reserva cancelada o no presentada no admite nuevos pagos',
        'RESERVATION_PAYMENT_FORBIDDEN',
      )
  }

  private async assertReservationCanVoidPayment(
    manager: EntityManager,
    reservation: ReservationEntity,
    payment: PaymentEntity,
  ): Promise<StayEntity | null> {
    if (reservation.status === 'checked_out')
      throw conflict('La reserva ya fue cerrada', 'RESERVATION_STATUS_CLOSED')
    if (reservation.status === 'checked_in') {
      const stay = await lockReservationStay(
        manager,
        reservation.campingId,
        reservation.id,
      )
      if (stay.closure)
        throw conflict('La estadía ya fue cerrada', 'STAY_CLOSED')
      if (payment.stayId !== null && payment.stayId !== stay.id)
        throw conflict(
          'El pago no pertenece a la estadía vinculada',
          'RESERVATION_LINKED_STAY',
        )
      return stay
    }
    if (
      payment.stayId !== null ||
      (await this.linkedStayFor(manager, reservation)) !== null
    )
      throw conflict(
        'La reserva ya está vinculada a una estadía',
        'RESERVATION_LINKED_STAY',
      )
    if (
      reservation.status !== 'confirmed' &&
      reservation.status !== 'cancelled' &&
      reservation.status !== 'no_show'
    )
      throw conflict(
        'La reserva no admite anulaciones',
        'RESERVATION_PAYMENT_FORBIDDEN',
      )
    return null
  }

  private assertAccountSafe(
    reservation: ReservationEntity,
    payments: PaymentEntity[],
    newAmount: number,
  ): void {
    safeMoney(reservation.priceSnapshot.totalMinor, 'total')
    let paid = 0
    for (const payment of payments) {
      safeMoney(payment.amountMinor, 'payment')
      if (payment.voidedAt === null)
        paid = safeAdd(paid, payment.amountMinor, 'paid')
    }
    safeBalance(reservation.priceSnapshot.totalMinor - paid)
    safeAdd(paid, newAmount, 'paid')
    safeMoney(reservation.version, 'version')
  }
}
