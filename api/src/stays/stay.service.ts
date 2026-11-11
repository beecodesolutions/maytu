import { baseFromSnapshot } from '../reservations/reservation-pricing'
import { BadRequestException, Injectable } from '@nestjs/common'
import { DataSource, type EntityManager } from 'typeorm'
import {
  roundMoneyMinor,
  hasMoneyPrecision,
  checkInSchemaForTimezone,
  closeRequestSchema,
  paymentInputSchema,
  reservationPriceSnapshotSchema,
  quoteRequestSchema,
  todayInTimezone,
  type AgeRanges,
  type CostBreakdown,
  type Payment,
  type Rates,
  type Stay,
  type StayAccount,
  type StayPage,
  type StayQuote,
} from '@camping/contracts'
import { daysBetween, ensureSafeMoney, validateDeparture } from '../common/date'
import {
  conflict,
  isUniqueViolation,
  notFound,
  zodBadRequest,
} from '../common/errors'
import { CampingEntity } from '../database/entities/camping.entity'
import { StayEntity } from '../database/entities/stay.entity'
import { AppliedExtraEntity } from '../database/entities/applied-extra.entity'
import { PaymentEntity } from '../database/entities/payment.entity'
import { ReservationEntity } from '../database/entities/reservation.entity'
import { AuditLogEntity } from '../database/entities/audit-log.entity'
import { OutboxEventEntity } from '../database/entities/outbox-event.entity'
import { withInventoryTransaction } from '../accommodations/inventory-transaction'
import {
  lockReservation,
  nextReservationVersion,
} from '../reservations/reservation-support'
import type { AuthContext } from '../auth/auth.types'

type ClosureValue = CostBreakdown & { closedAt: string; closedBy: string }
type PaymentValues = {
  amountMinor: number
  method: Payment['method']
  paidOn: string
  note: string
  idempotencyKey: string
}

type PaymentAppendResult = {
  payment: PaymentEntity
  created: boolean
}

@Injectable()
export class StayService {
  constructor(private readonly dataSource: DataSource) {}

  async create(context: AuthContext, raw: unknown): Promise<{ id: string }> {
    return withInventoryTransaction(
      this.dataSource,
      context,
      async (manager) => {
        const camping = await manager.findOneByOrFail(CampingEntity, {
          id: context.camping.id,
        })
        const parsed = checkInSchemaForTimezone(camping.timezone).safeParse(raw)
        if (!parsed.success) throw zodBadRequest(parsed.error)
        const stay = manager.create(StayEntity, {
          ...parsed.data,
          campingId: camping.id,
          createdById: context.user.id,
          estimatedDeparture: parsed.data.estimatedDeparture || null,
          currency: camping.currency,
          moneyDecimals: camping.moneyDecimals,
          ageRanges: camping.ageRanges,
          rates: camping.rates,
          version: 1,
          closedAt: null,
          closedById: null,
          closure: null,
          accommodationPriceSnapshot: null,
        })
        this.calculate(
          { ...stay, extras: [], payments: [] } as StayEntity,
          stay.arrivalDate,
        )
        const saved = await manager.save(StayEntity, stay)
        return { id: saved.id }
      },
    )
  }

  async list(
    context: AuthContext,
    status: string | undefined,
    pageRaw: string | undefined,
    pageSizeRaw: string | undefined,
    accommodation?: string,
  ): Promise<StayPage> {
    const page = this.pageNumber(pageRaw, 1)
    const pageSize = Math.min(this.pageNumber(pageSizeRaw, 25), 100)
    if (!Number.isSafeInteger((page - 1) * pageSize))
      throw new BadRequestException('Paginación inválida')
    if (status && status !== 'active' && status !== 'closed')
      throw new BadRequestException('Estado inválido')
    if (
      accommodation &&
      !['total', 'camping', 'individual'].includes(accommodation)
    )
      throw new BadRequestException('Alojamiento inválido')
    const query = this.dataSource
      .getRepository(StayEntity)
      .createQueryBuilder('stay')
      .leftJoinAndSelect('stay.extras', 'extras')
      .leftJoinAndSelect('stay.payments', 'payments')
      .leftJoinAndSelect('stay.reservation', 'reservation')
      .leftJoin('reservation.accommodationType', 'accommodationType')
      .where('stay.campingId = :campingId', { campingId: context.camping.id })
      .andWhere(
        status === 'closed'
          ? 'stay.closedAt IS NOT NULL'
          : 'stay.closedAt IS NULL',
      )
    if (accommodation === 'individual')
      query.andWhere(
        '(reservation.unitId IS NOT NULL OR accommodationType.inventoryMode = :mode)',
        { mode: 'individual' },
      )
    if (accommodation === 'camping')
      query.andWhere(
        '(stay.reservationId IS NULL OR (reservation.unitId IS NULL AND accommodationType.inventoryMode = :mode))',
        { mode: 'unlimited' },
      )
    const [items, total] = await query
      .orderBy('stay.createdAt', 'DESC')
      .addOrderBy('stay.id', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount()
    return {
      items: items.map((stay) => this.toStay(stay, context.camping.timezone)),
      total,
      page,
      pageSize,
    }
  }

  async get(context: AuthContext, id: string): Promise<Stay> {
    return this.toStay(
      await this.findStay(context.camping.id, id),
      context.camping.timezone,
    )
  }

  async quote(
    context: AuthContext,
    id: string,
    raw: unknown,
  ): Promise<StayQuote> {
    const parsed = quoteRequestSchema.safeParse(raw)
    if (!parsed.success) throw zodBadRequest(parsed.error)
    const stay = await this.findStay(context.camping.id, id)
    this.assertLinkedDeparture(
      stay,
      stay.reservation ?? null,
      parsed.data.departureDate,
    )
    if (stay.closure) {
      const breakdown = this.asBreakdown(stay.closure)
      return {
        ...breakdown,
        account: this.accountForTotal(
          stay,
          breakdown.totalMinor,
          breakdown.departureDate,
        ),
      }
    }
    validateDeparture(
      stay.arrivalDate,
      parsed.data.departureDate,
      context.camping.timezone,
    )
    const breakdown = this.calculate(stay, parsed.data.departureDate)
    return {
      ...breakdown,
      account: this.accountForTotal(
        stay,
        breakdown.totalMinor,
        breakdown.departureDate,
      ),
    }
  }

  async recordPayment(
    context: AuthContext,
    stayId: string,
    raw: unknown,
  ): Promise<Stay> {
    const parsed = paymentInputSchema.safeParse(raw)
    if (!parsed.success) throw zodBadRequest(parsed.error)
    this.validatePaymentDate(parsed.data.paidOn, context.camping.timezone)
    try {
      return await withInventoryTransaction(
        this.dataSource,
        context,
        async (manager) => {
          const { stay, reservation } = await this.lockStayMutation(
            manager,
            context.camping.id,
            stayId,
          )
          if (reservation && reservation.status !== 'checked_in')
            throw conflict(
              'La reserva no está activa',
              'RESERVATION_PAYMENT_FORBIDDEN',
            )
          if (reservation && stay.closure)
            throw conflict('La estadía ya fue cerrada', 'STAY_CLOSED')
          const result = await this.appendPayment(
            manager,
            context,
            stay,
            parsed.data,
          )
          if (result.created && reservation)
            await this.advanceLinkedReservationPayment(
              manager,
              context,
              reservation,
              stay,
              result.payment,
            )
          return this.toStay(stay, context.camping.timezone)
        },
      )
    } catch (error) {
      if (isUniqueViolation(error)) throw this.idempotencyConflict()
      throw error
    }
  }

  async close(context: AuthContext, id: string, raw: unknown): Promise<Stay> {
    const parsed = closeRequestSchema.safeParse(raw)
    if (!parsed.success) throw zodBadRequest(parsed.error)
    if (parsed.data.payment)
      this.validatePaymentDate(
        parsed.data.payment.paidOn,
        context.camping.timezone,
      )
    try {
      return await withInventoryTransaction(
        this.dataSource,
        context,
        async (manager) => {
          const { stay, reservation } = await this.lockStayMutation(
            manager,
            context.camping.id,
            id,
          )
          this.assertLinkedDeparture(
            stay,
            reservation,
            parsed.data.departureDate,
          )
          if (stay.closure) {
            if (stay.closure.departureDate !== parsed.data.departureDate)
              throw conflict(
                'La estadía ya fue cerrada con otra fecha',
                'STAY_CLOSED',
              )
            if (parsed.data.payment) {
              const existing = await this.findIdempotentPayment(
                manager,
                context.camping.id,
                parsed.data.payment.idempotencyKey,
              )
              if (!existing)
                throw conflict(
                  'La estadía ya fue cerrada; registra el pago por separado',
                  'STAY_CLOSED',
                )
              this.assertSamePayment(existing, stay.id, parsed.data.payment)
            }
            return this.toStay(stay, context.camping.timezone)
          }
          if (stay.version !== parsed.data.version)
            throw conflict(
              'La estadía cambió; actualiza el presupuesto',
              'STALE_STAY',
            )
          if (reservation && reservation.status !== 'checked_in')
            throw conflict(
              'La reserva no está activa',
              'INVALID_RESERVATION_STATE',
            )
          validateDeparture(
            stay.arrivalDate,
            parsed.data.departureDate,
            context.camping.timezone,
          )
          let appended: PaymentAppendResult | null = null
          if (parsed.data.payment)
            appended = await this.appendPayment(
              manager,
              context,
              stay,
              parsed.data.payment,
            )
          const breakdown = this.calculate(stay, parsed.data.departureDate)
          const account = this.accountForTotal(
            stay,
            breakdown.totalMinor,
            breakdown.departureDate,
          )
          if (account.balanceMinor !== 0)
            throw conflict(
              'El saldo debe quedar en cero para cerrar la estadía',
              'BALANCE_NOT_ZERO',
            )
          const closedAt = new Date().toISOString()
          stay.closedAt = new Date(closedAt)
          stay.closedById = context.user.id
          stay.closure = { ...breakdown, closedAt, closedBy: context.user.id }
          await manager.save(stay)
          if (reservation) {
            const beforeVersion = reservation.version
            reservation.status = 'checked_out'
            reservation.version = nextReservationVersion(reservation.version)
            reservation.updatedAt = new Date()
            await manager.save(reservation)
            await this.appendLinkedReservationMutation(
              manager,
              context,
              reservation,
              'reservation.checked_out',
              'ReservationCheckedOut',
              {
                reservationId: reservation.id,
                stayId: stay.id,
                status: 'checked_in',
                version: beforeVersion,
              },
              {
                reservationId: reservation.id,
                stayId: stay.id,
                status: reservation.status,
                version: reservation.version,
                ...(appended?.created
                  ? {
                      paymentId: appended.payment.id,
                      paymentAmountMinor: appended.payment.amountMinor,
                      paymentIdempotencyKey: appended.payment.idempotencyKey,
                    }
                  : {}),
              },
            )
          }
          return this.toStay(stay, context.camping.timezone)
        },
      )
    } catch (error) {
      if (isUniqueViolation(error)) throw this.idempotencyConflict()
      throw error
    }
  }

  calculate(stay: StayEntity, departureDate: string): CostBreakdown {
    const nights = daysBetween(stay.arrivalDate, departureDate)
    const accommodationMinor = stay.accommodationPriceSnapshot
      ? this.linkedAccommodationTotal(stay, nights)
      : ensureSafeMoney(
          stay.adults * stay.rates.adults * nights +
            stay.children * stay.rates.children * nights +
            stay.infants * stay.rates.infants * nights,
        )
    const extrasMinor = ensureSafeMoney(
      (stay.extras ?? []).reduce(
        (total, extra) =>
          ensureSafeMoney(total + extra.quantity * extra.unitPriceMinor),
        0,
      ),
    )
    const unroundedTotal = ensureSafeMoney(accommodationMinor + extrasMinor)
    const totalMinor = roundMoneyMinor(
      unroundedTotal,
      stay.currency,
      stay.moneyDecimals,
    )
    const roundingMinor = totalMinor - unroundedTotal
    return {
      departureDate,
      nights,
      accommodationMinor,
      extrasMinor,
      totalMinor,
      ...(roundingMinor === 0 ? {} : { roundingMinor }),
      version: stay.version,
    }
  }

  account(stay: StayEntity, timezone: string): StayAccount {
    const breakdown = stay.closure
      ? this.asBreakdown(stay.closure)
      : this.calculate(
          stay,
          stay.accommodationPriceSnapshot
            ? this.acceptedDeparture(stay)
            : todayInTimezone(timezone),
        )
    return this.accountForTotal(
      stay,
      breakdown.totalMinor,
      breakdown.departureDate,
    )
  }

  async findStay(
    campingId: string,
    id: string,
    manager = this.dataSource.manager,
  ): Promise<StayEntity> {
    const stay = await manager.findOne(StayEntity, {
      where: { id, campingId },
      relations: { extras: true, payments: true, reservation: true },
    })
    if (!stay) throw notFound('Estadía')
    return stay
  }

  toStay(stay: StayEntity, timezone: string): Stay {
    return {
      id: stay.id,
      responsibleName: stay.responsibleName,
      document: stay.document,
      nationality: stay.nationality,
      reservationId: stay.reservationId,
      accommodationPriceSnapshot: stay.accommodationPriceSnapshot
        ? reservationPriceSnapshotSchema.parse(stay.accommodationPriceSnapshot)
        : null,
      phone: stay.phone,
      arrivalDate: stay.arrivalDate,
      estimatedDeparture: stay.estimatedDeparture ?? '',
      adults: stay.adults,
      children: stay.children,
      infants: stay.infants,
      pets: stay.pets,
      hasVehicle: stay.hasVehicle,
      vehicleDescription: stay.vehicleDescription,
      licensePlate: stay.licensePlate,
      location: stay.location,
      currency: stay.currency,
      moneyDecimals: stay.moneyDecimals ?? null,
      ageRanges: stay.ageRanges as AgeRanges,
      rates: stay.rates as Rates,
      version: stay.version,
      extras: (stay.extras ?? []).map((extra) => ({
        id: extra.id,
        templateId: extra.templateId,
        category: extra.category,
        description: extra.description,
        quantity: extra.quantity,
        unitPriceMinor: extra.unitPriceMinor,
      })),
      payments: [...(stay.payments ?? [])]
        .sort(
          (left, right) =>
            left.createdAt.getTime() - right.createdAt.getTime() ||
            left.id.localeCompare(right.id),
        )
        .map((payment) => this.toPayment(payment)),
      account: this.account(stay, timezone),
      closure: stay.closure,
      createdAt: stay.createdAt.toISOString(),
    }
  }

  private async lockStay(
    manager: EntityManager,
    campingId: string,
    id: string,
  ): Promise<StayEntity> {
    const stay = await manager.findOne(StayEntity, {
      where: { id, campingId },
      lock: { mode: 'pessimistic_write' },
    })
    if (!stay) throw notFound('Estadía')
    stay.extras = await manager.find(AppliedExtraEntity, {
      where: { stayId: stay.id },
    })
    stay.payments = await manager.find(PaymentEntity, {
      where: { stayId: stay.id },
    })
    return stay
  }

  private async lockStayMutation(
    manager: EntityManager,
    campingId: string,
    id: string,
  ): Promise<{ stay: StayEntity; reservation: ReservationEntity | null }> {
    const candidate = await manager.findOne(StayEntity, {
      where: { id, campingId },
      select: { id: true, reservationId: true },
    })
    if (!candidate) throw notFound('Estadía')
    const reservation = candidate.reservationId
      ? await lockReservation(manager, campingId, candidate.reservationId)
      : null
    const stay = await this.lockStay(manager, campingId, id)
    if ((stay.reservationId ?? null) !== (reservation?.id ?? null))
      throw conflict(
        'La reserva vinculada cambió; actualiza la pantalla',
        'STALE_STAY',
      )
    stay.reservation = reservation
    return { stay, reservation }
  }

  private async appendPayment(
    manager: EntityManager,
    context: AuthContext,
    stay: StayEntity,
    input: PaymentValues,
  ): Promise<PaymentAppendResult> {
    const existing = await this.findIdempotentPayment(
      manager,
      context.camping.id,
      input.idempotencyKey,
    )
    if (existing) {
      this.assertSamePayment(existing, stay.id, input)
      return { payment: existing, created: false }
    }
    if (
      !hasMoneyPrecision(input.amountMinor, stay.currency, stay.moneyDecimals)
    )
      throw new BadRequestException(
        'Esta estadía no admite centavos en los pagos',
      )
    if (stay.closure) {
      const balance = this.account(stay, context.camping.timezone).balanceMinor
      if (balance <= 0 || input.amountMinor > balance)
        throw conflict(
          'El pago supera el saldo pendiente de la estadía cerrada',
          'OVERPAYMENT',
        )
    }
    const payment = manager.create(PaymentEntity, {
      campingId: context.camping.id,
      stayId: stay.id,
      amountMinor: input.amountMinor,
      method: input.method,
      paidOn: input.paidOn,
      note: input.note,
      recordedById: context.user.id,
      idempotencyKey: input.idempotencyKey,
      reservationId: stay.reservationId,
      voidedAt: null,
      voidedById: null,
      voidReason: null,
    })
    await manager.save(payment)
    stay.payments.push(payment)
    stay.version += 1
    await manager.update(StayEntity, stay.id, { version: stay.version })
    return { payment, created: true }
  }

  private async advanceLinkedReservationPayment(
    manager: EntityManager,
    context: AuthContext,
    reservation: ReservationEntity,
    stay: StayEntity,
    payment: PaymentEntity,
  ): Promise<void> {
    const beforeVersion = reservation.version
    reservation.version = nextReservationVersion(reservation.version)
    reservation.updatedAt = new Date()
    await manager.save(reservation)
    await this.appendLinkedReservationMutation(
      manager,
      context,
      reservation,
      'reservation.payment_recorded',
      'PaymentRecorded',
      {
        reservationId: reservation.id,
        stayId: stay.id,
        version: beforeVersion,
        paymentId: payment.id,
        paymentAmountMinor: payment.amountMinor,
        paymentIdempotencyKey: payment.idempotencyKey,
        method: payment.method,
        paidOn: payment.paidOn,
      },
      {
        reservationId: reservation.id,
        stayId: stay.id,
        version: reservation.version,
        paymentId: payment.id,
        paymentAmountMinor: payment.amountMinor,
        paymentIdempotencyKey: payment.idempotencyKey,
        method: payment.method,
        paidOn: payment.paidOn,
      },
    )
  }

  private async appendLinkedReservationMutation(
    manager: EntityManager,
    context: AuthContext,
    reservation: ReservationEntity,
    action: string,
    eventType: string,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): Promise<void> {
    await manager.save(
      manager.create(AuditLogEntity, {
        campingId: reservation.campingId,
        actorId: context.user.id,
        action,
        entityType: 'Reservation',
        entityId: reservation.id,
        beforeState: before,
        afterState: after,
      }),
    )
    await manager.save(
      manager.create(OutboxEventEntity, {
        campingId: reservation.campingId,
        aggregateType: 'Reservation',
        aggregateId: reservation.id,
        eventType,
        payload: {
          reservationId: reservation.id,
          stayId: after.stayId ?? before.stayId,
          version: reservation.version,
          status: reservation.status,
          ...(after.paymentId
            ? {
                paymentId: after.paymentId,
                paymentAmountMinor: after.paymentAmountMinor,
                paymentIdempotencyKey: after.paymentIdempotencyKey,
              }
            : {}),
        },
        publishedAt: null,
        attempts: 0,
        lastError: null,
      }),
    )
  }

  private async findIdempotentPayment(
    manager: EntityManager,
    campingId: string,
    idempotencyKey: string,
  ): Promise<PaymentEntity | null> {
    return manager.findOne(PaymentEntity, {
      where: { campingId, idempotencyKey },
    })
  }

  private assertSamePayment(
    existing: PaymentEntity,
    stayId: string,
    input: PaymentValues,
  ): void {
    if (
      existing.stayId !== stayId ||
      existing.amountMinor !== input.amountMinor ||
      existing.method !== input.method ||
      existing.paidOn !== input.paidOn ||
      existing.note !== input.note
    )
      throw this.idempotencyConflict()
  }

  private idempotencyConflict() {
    return conflict(
      'La clave de idempotencia ya fue usada con otro pago',
      'IDEMPOTENCY_CONFLICT',
    )
  }

  private accountForTotal(
    stay: StayEntity,
    totalMinor: number,
    asOfDate: string,
  ): StayAccount {
    const paidMinor = (stay.payments ?? []).reduce(
      (total, payment) =>
        payment.voidedAt === null
          ? ensureSafeMoney(total + ensureSafeMoney(payment.amountMinor))
          : total,
      0,
    )
    const balanceMinor = totalMinor - paidMinor
    if (!Number.isSafeInteger(balanceMinor))
      throw new BadRequestException({
        code: 'MONEY_OVERFLOW',
        message: 'Importe inválido',
      })
    return { totalMinor, paidMinor, balanceMinor, asOfDate }
  }

  private toPayment(payment: PaymentEntity): Payment {
    return {
      id: payment.id,
      reservationId: payment.reservationId,
      amountMinor: payment.amountMinor,
      method: payment.method,
      paidOn: payment.paidOn,
      note: payment.note,
      createdAt: payment.createdAt.toISOString(),
      recordedBy: payment.recordedById,
      voidedAt: payment.voidedAt?.toISOString() ?? null,
      voidedBy: payment.voidedById,
      voidReason: payment.voidReason,
    }
  }

  private linkedAccommodationTotal(stay: StayEntity, nights: number): number {
    const snapshot = reservationPriceSnapshotSchema.parse(
      stay.accommodationPriceSnapshot,
    )
    if (snapshot.pricing) {
      const end = new Date(`${stay.arrivalDate}T00:00:00Z`)
      end.setUTCDate(end.getUTCDate() + nights)
      return baseFromSnapshot(
        snapshot,
        stay.arrivalDate,
        end.toISOString().slice(0, 10),
        stay.adults,
        stay.children,
        stay.infants,
        stay.pets,
      ).totalMinor
    }
    let baseMinor: number
    if (snapshot.basis !== 'per_person') {
      baseMinor = this.safeMultiplyMoney(snapshot.baseNightlyPriceMinor, nights)
    } else {
      const nightly = this.safeAddMoney(
        this.safeAddMoney(
          this.safeMultiplyMoney(stay.adults, snapshot.rates.adults),
          this.safeMultiplyMoney(stay.children, snapshot.rates.children),
        ),
        this.safeMultiplyMoney(stay.infants, snapshot.rates.infants),
      )
      baseMinor = this.safeMultiplyMoney(nightly, nights)
    }
    return ensureSafeMoney(baseMinor + (snapshot.adjustmentMinor ?? 0))
  }

  private safeMultiplyMoney(left: number, right: number): number {
    if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right))
      throw new BadRequestException({
        code: 'MONEY_OVERFLOW',
        message: 'Importe inválido',
      })
    return ensureSafeMoney(left * right)
  }

  private safeAddMoney(left: number, right: number): number {
    if (!Number.isSafeInteger(left + right))
      throw new BadRequestException({
        code: 'MONEY_OVERFLOW',
        message: 'Importe inválido',
      })
    return ensureSafeMoney(left + right)
  }

  private acceptedDeparture(stay: StayEntity): string {
    const departure = stay.reservation?.checkOutDate ?? stay.estimatedDeparture
    if (!departure)
      throw conflict(
        'La reserva vinculada no tiene una salida aceptada',
        'RESERVATION_DATES_CHANGED',
      )
    return departure
  }

  private assertLinkedDeparture(
    stay: StayEntity,
    reservation: ReservationEntity | null,
    departureDate: string,
  ): void {
    if (!stay.reservationId) return
    const accepted = reservation?.checkOutDate ?? stay.estimatedDeparture
    if (!accepted || departureDate !== accepted)
      throw conflict(
        'La salida de la reserva cambió; cotiza o actualiza la reserva antes de cerrar la estadía',
        'RESERVATION_DATES_CHANGED',
      )
  }

  private validatePaymentDate(paidOn: string, timezone: string): void {
    if (paidOn > todayInTimezone(timezone))
      throw new BadRequestException({
        code: 'FUTURE_PAYMENT_DATE',
        message: 'La fecha del pago no puede ser futura',
      })
  }

  private asBreakdown(value: ClosureValue): CostBreakdown {
    const { closedAt: _closedAt, closedBy: _closedBy, ...breakdown } = value
    return breakdown
  }

  private pageNumber(value: string | undefined, fallback: number): number {
    if (value === undefined) return fallback
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed) || parsed < 1)
      throw new BadRequestException('Paginación inválida')
    return parsed
  }
}
