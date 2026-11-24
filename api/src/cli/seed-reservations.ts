import { createHash } from 'node:crypto'
import { parseArgs } from 'node:util'
import { todayInTimezone, type ReservationResponse } from '@camping/contracts'
import { AvailabilityService } from '../accommodations/availability.service'
import { AccommodationTypeEntity } from '../database/entities/accommodation-type.entity'
import { AccommodationUnitEntity } from '../database/entities/accommodation-unit.entity'
import { CampingEntity } from '../database/entities/camping.entity'
import { ReservationEntity } from '../database/entities/reservation.entity'
import { PaymentEntity } from '../database/entities/payment.entity'
import { StayEntity } from '../database/entities/stay.entity'
import { UserEntity } from '../database/entities/user.entity'
import { ReservationCheckInService } from '../reservations/reservation-checkin.service'
import { ReservationPaymentsService } from '../reservations/reservation-payments.service'
import { ReservationService } from '../reservations/reservation.service'
import { StayService } from '../stays/stay.service'
import type { AuthContext } from '../auth/auth.types'
import { destroy, inputError, reportCliFailure } from './common'
import { DataSource } from 'typeorm'

const DEFAULT_CAMPING_KEY = 'la-izuelina'
const PRIVATE_SCHEMA = 'camping_private'
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

const HELP = `Usage:
  pnpm seed:reservations [--camping-key=<stable-key>]

Seeds local-only reservation and accommodation examples for the selected
camping. The default is ${DEFAULT_CAMPING_KEY}. It is safe to rerun; existing
rows and operator changes are preserved.`

type SeedStatus = 'confirmed' | 'checked-in'

type ReservationSeed = {
  key: string
  type: 'room' | 'free'
  unit: string | null
  startOffset: number
  endOffset: number
  status: SeedStatus
  adults: number
  children: number
  payment?: { amountMinor: number; method: 'cash' | 'transfer' | 'card' }
}

const RESPONSIBLE_NAMES: Record<string, string> = {
  'room-1-active': 'María José Araya',
  'room-1-future': 'Tomás Bustos',
  'room-2-confirmed': 'Valentina Pizarro',
  'room-2-pending': 'Nicolás Vera',
  'room-3-active': 'Daniela Muñoz',
  'room-3-future': 'Joaquín Leiva',
  'free-active': 'Camila Rojas',
  'free-future': 'Felipe Soto',
  'free-pending': 'Sofía Cisternas',
  'free-today-arrival': 'Martín Saavedra',
  'free-departure-today': 'Paula González',
  'free-overdue': 'Andrés Navarro',
}

const FREE_LOCATIONS: Record<string, string> = {
  'free-active': 'Área Maitén',
  'free-future': 'Área Los Pinos',
  'free-pending': 'Área El Arrayán',
  'free-today-arrival': 'Área Los Robles',
  'free-departure-today': 'Área Los Pinos',
  'free-overdue': 'Área El Canelo',
}

const RESERVATIONS: readonly ReservationSeed[] = [
  {
    key: 'room-1-active',
    type: 'room',
    unit: 'Habitación 1',
    startOffset: -2,
    endOffset: 2,
    status: 'checked-in',
    adults: 2,
    children: 1,
    payment: { amountMinor: 45000, method: 'transfer' },
  },
  {
    key: 'room-1-future',
    type: 'room',
    unit: 'Habitación 1',
    startOffset: 3,
    endOffset: 5,
    status: 'confirmed',
    adults: 2,
    children: 0,
    payment: { amountMinor: 45000, method: 'card' },
  },
  {
    key: 'room-2-confirmed',
    type: 'room',
    unit: 'Habitación 2',
    startOffset: 1,
    endOffset: 4,
    status: 'confirmed',
    adults: 3,
    children: 0,
    payment: { amountMinor: 30000, method: 'cash' },
  },
  {
    key: 'room-2-pending',
    type: 'room',
    unit: 'Habitación 2',
    startOffset: 6,
    endOffset: 8,
    status: 'confirmed',
    adults: 2,
    children: 1,
  },
  {
    key: 'room-3-active',
    type: 'room',
    unit: 'Habitación 3',
    startOffset: -1,
    endOffset: 1,
    status: 'checked-in',
    adults: 2,
    children: 0,
    payment: { amountMinor: 30000, method: 'cash' },
  },
  {
    key: 'room-3-future',
    type: 'room',
    unit: 'Habitación 3',
    startOffset: 3,
    endOffset: 5,
    status: 'confirmed',
    adults: 1,
    children: 1,
    payment: { amountMinor: 30000, method: 'card' },
  },
  {
    key: 'free-active',
    type: 'free',
    unit: null,
    startOffset: -1,
    endOffset: 2,
    status: 'checked-in',
    adults: 2,
    children: 1,
    payment: { amountMinor: 20000, method: 'transfer' },
  },
  {
    key: 'free-future',
    type: 'free',
    unit: null,
    startOffset: 2,
    endOffset: 5,
    status: 'confirmed',
    adults: 2,
    children: 0,
    payment: { amountMinor: 14000, method: 'cash' },
  },
  {
    key: 'free-pending',
    type: 'free',
    unit: null,
    startOffset: 5,
    endOffset: 7,
    status: 'confirmed',
    adults: 3,
    children: 0,
  },
  {
    key: 'free-today-arrival',
    type: 'free',
    unit: null,
    startOffset: 0,
    endOffset: 2,
    status: 'confirmed',
    adults: 2,
    children: 0,
    payment: { amountMinor: 12000, method: 'cash' },
  },
  {
    key: 'free-departure-today',
    type: 'free',
    unit: null,
    startOffset: -2,
    endOffset: 0,
    status: 'checked-in',
    adults: 1,
    children: 1,
    payment: { amountMinor: 16000, method: 'card' },
  },
  {
    key: 'free-overdue',
    type: 'free',
    unit: null,
    startOffset: -4,
    endOffset: -1,
    status: 'checked-in',
    adults: 2,
    children: 0,
    payment: { amountMinor: 24000, method: 'transfer' },
  },
] as const

function seededUuid(scope: string, key: string): string {
  const hash = createHash('sha256')
    .update(`camping-local-reservations-v1:${scope}:${key}`)
    .digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

function dateFrom(anchor: string, offset: number): string {
  const value = new Date(`${anchor}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + offset)
  return value.toISOString().slice(0, 10)
}

function localOnlyGuard(): void {
  if (process.env.NODE_ENV === 'production')
    inputError('Local reservation seed refuses NODE_ENV=production')
  if (process.env.DATABASE_ADMIN_URL?.trim())
    inputError('Local reservation seed refuses DATABASE_ADMIN_URL')
  const configuredUrl = process.env.DATABASE_URL
  const host = configuredUrl
    ? new URL(configuredUrl).hostname
    : (process.env.DB_HOST ?? 'localhost')
  if (!LOCAL_HOSTS.has(host))
    inputError(
      `Local reservation seed requires a loopback database host, got ${host}`,
    )
  if ((process.env.DB_SCHEMA ?? PRIVATE_SCHEMA) !== PRIVATE_SCHEMA)
    inputError(`DB_SCHEMA must be ${PRIVATE_SCHEMA}`)
}

function errorCode(error: unknown): string {
  if (
    error &&
    typeof error === 'object' &&
    'getResponse' in error &&
    typeof error.getResponse === 'function'
  ) {
    const response = error.getResponse()
    if (response && typeof response === 'object' && 'code' in response)
      return String(response.code)
  }
  return error instanceof Error ? error.name : 'UNKNOWN_ERROR'
}

function typeIdFor(campingId: string, type: string): string {
  return seededUuid('type', `${campingId}:${type}`)
}

function unitIdFor(campingId: string, name: string): string {
  return seededUuid('unit', `${campingId}:${name}`)
}

function responsibleNameFor(seed: ReservationSeed): string {
  return RESPONSIBLE_NAMES[seed.key] ?? 'Visitante registrado'
}

function locationFor(seed: ReservationSeed): string {
  if (seed.type === 'room') return seed.unit ?? 'Habitación privada'
  return FREE_LOCATIONS[seed.key] ?? 'Área Los Pinos'
}

async function ensureAccommodation(
  dataSource: DataSource,
  camping: CampingEntity,
): Promise<{
  room: AccommodationTypeEntity
  free: AccommodationTypeEntity
  units: Map<string, AccommodationUnitEntity>
}> {
  return dataSource.transaction(async (manager) => {
    const campingRow = await manager.findOne(CampingEntity, {
      where: { id: camping.id },
      lock: { mode: 'pessimistic_write' },
    })
    if (!campingRow) inputError(`Camping ${camping.stableKey} no longer exists`)

    const typeRepository = manager.getRepository(AccommodationTypeEntity)
    const unitRepository = manager.getRepository(AccommodationUnitEntity)
    const findOrCreateType = async (
      name: string,
      inventoryMode: 'individual' | 'unlimited',
      maxOccupancy: number | null,
      baseNightlyPriceMinor: number,
      key: string,
    ): Promise<AccommodationTypeEntity> => {
      let type = await typeRepository.findOne({
        where: { id: typeIdFor(camping.id, key), campingId: camping.id },
      })
      type ??= await typeRepository.findOne({
        where: { campingId: camping.id, name },
      })
      if (type) return type
      return typeRepository.save(
        typeRepository.create({
          id: typeIdFor(camping.id, key),
          campingId: camping.id,
          name,
          inventoryMode,
          maxOccupancy,
          baseNightlyPriceMinor,
          enabled: true,
        }),
      )
    }

    const room = await findOrCreateType(
      'Habitación privada',
      'individual',
      4,
      45000,
      'room',
    )
    const free = await findOrCreateType('Camping', 'unlimited', null, 0, 'free')
    const units = new Map<string, AccommodationUnitEntity>()
    for (const name of ['Habitación 1', 'Habitación 2', 'Habitación 3']) {
      let unit = await unitRepository.findOne({
        where: {
          id: unitIdFor(camping.id, name),
          campingId: camping.id,
        },
      })
      unit ??= await unitRepository.findOne({
        where: { campingId: camping.id, typeId: room.id, name },
      })
      if (!unit)
        unit = await unitRepository.save(
          unitRepository.create({
            id: unitIdFor(camping.id, name),
            campingId: camping.id,
            typeId: room.id,
            maxOccupancy: room.maxOccupancy ?? 1,
            name,
            enabled: true,
          }),
        )
      units.set(name, unit)
    }
    return { room, free, units }
  })
}

async function loadCampingContext(
  dataSource: DataSource,
  campingKey: string,
): Promise<AuthContext> {
  const camping = await dataSource.getRepository(CampingEntity).findOne({
    where: { stableKey: campingKey },
  })
  if (!camping) inputError(`Camping ${campingKey} was not found`)
  const user = await dataSource.getRepository(UserEntity).findOne({
    where: { campingId: camping.id, enabled: true },
    order: { createdAt: 'ASC', id: 'ASC' },
  })
  if (!user) inputError(`Camping ${campingKey} has no enabled user`)
  return { camping, user }
}

async function existingReservation(
  dataSource: DataSource,
  campingId: string,
  idempotencyKey: string,
): Promise<ReservationEntity | null> {
  return dataSource.getRepository(ReservationEntity).findOne({
    where: { campingId, idempotencyKey },
  })
}

async function createOrLoadReservation(
  dataSource: DataSource,
  context: AuthContext,
  type: AccommodationTypeEntity,
  unit: AccommodationUnitEntity | null,
  seed: ReservationSeed,
  anchor: string,
  reservationService: ReservationService,
): Promise<ReservationResponse> {
  const idempotencyKey = seededUuid(
    'reservation',
    `${context.camping.id}:${seed.key}`,
  )
  const existing = await existingReservation(
    dataSource,
    context.camping.id,
    idempotencyKey,
  )
  if (existing) return reservationService.get(context, existing.id)
  const checkInDate = dateFrom(anchor, seed.startOffset)
  const checkOutDate = dateFrom(anchor, seed.endOffset)
  const quote = await reservationService.quote(context, {
    accommodationTypeId: type.id,
    ...(unit ? { unitId: unit.id } : {}),
    checkInDate,
    checkOutDate,
    adults: seed.adults,
    children: seed.children,
    infants: 0,
  })
  return reservationService.create(context, {
    accommodationTypeId: type.id,
    ...(unit ? { unitId: unit.id } : {}),
    checkInDate,
    checkOutDate,
    responsibleName: responsibleNameFor(seed),
    adults: seed.adults,
    children: seed.children,
    infants: 0,
    source: 'local-seed',
    notes: 'Reserva por teléfono',
    idempotencyKey,
    acceptedTotalMinor: quote.priceSnapshot.totalMinor,
  })
}

async function ensurePayment(
  dataSource: DataSource,
  context: AuthContext,
  reservation: ReservationResponse,
  seed: ReservationSeed,
  paymentService: ReservationPaymentsService,
): Promise<ReservationResponse> {
  if (!seed.payment) return reservation
  const idempotencyKey = seededUuid(
    'payment',
    `${context.camping.id}:${seed.key}`,
  )
  const existing = await dataSource.getRepository(PaymentEntity).findOne({
    where: { campingId: context.camping.id, idempotencyKey },
  })
  if (existing) return reservation
  const amountMinor = Math.min(
    seed.payment.amountMinor,
    reservation.account.totalMinor,
  )
  if (amountMinor < 1) return reservation
  return paymentService.recordPayment(context, reservation.id, {
    amountMinor,
    method: seed.payment.method,
    paidOn: todayInTimezone(context.camping.timezone),
    note: 'Abono inicial',
    idempotencyKey,
  })
}

async function ensureLifecycle(
  context: AuthContext,
  reservation: ReservationResponse,
  seed: ReservationSeed,
  checkInService: ReservationCheckInService,
): Promise<ReservationResponse> {
  if (seed.status !== 'checked-in' || reservation.status === 'checked_in')
    return reservation
  if (reservation.status !== 'confirmed') return reservation
  const arrivalDate = reservation.checkInDate
  const today = todayInTimezone(context.camping.timezone)
  if (arrivalDate > today || arrivalDate >= reservation.checkOutDate)
    return reservation
  const quote = await checkInService.quote(context, reservation.id, {
    version: reservation.version,
    arrivalDate,
  })
  return checkInService.checkIn(context, reservation.id, {
    version: reservation.version,
    arrivalDate,
    acceptedTotalMinor: quote.priceSnapshot.totalMinor,
    location: locationFor(seed),
  })
}

async function printReadSummary(
  dataSource: DataSource,
  context: AuthContext,
  types: { room: AccommodationTypeEntity; free: AccommodationTypeEntity },
): Promise<void> {
  const availability = await new AvailabilityService(dataSource).read(context, {
    checkInDate: dateFrom(todayInTimezone(context.camping.timezone), -2),
    checkOutDate: dateFrom(todayInTimezone(context.camping.timezone), 9),
  })
  const stays = await new StayService(dataSource).list(
    context,
    'active',
    '1',
    '100',
  )
  const reservations = await dataSource.getRepository(ReservationEntity).find({
    where: { campingId: context.camping.id },
  })
  const allPayments = await dataSource.getRepository(PaymentEntity).find({
    where: { campingId: context.camping.id },
  })
  const own = reservations.filter((row) => row.source === 'local-seed')
  const localIds = new Set(own.map((row) => row.id))
  const localPayments = allPayments.filter((payment) =>
    localIds.has(payment.reservationId ?? ''),
  )
  const allStays = await dataSource.getRepository(StayEntity).find({
    where: { campingId: context.camping.id },
  })
  const localStays = allStays.filter((stay) =>
    localIds.has(stay.reservationId ?? ''),
  )
  console.log(
    JSON.stringify(
      {
        camping: context.camping.name,
        types: { room: types.room.name, free: types.free.name },
        localReservations: own.length,
        localStatuses: Object.fromEntries(
          [...new Set(own.map((row) => row.status))].map((status) => [
            status,
            own.filter((row) => row.status === status).length,
          ]),
        ),
        campingReservations: reservations.length,
        localPayments: localPayments.length,
        localPaymentMinor: localPayments.reduce(
          (total, payment) => total + payment.amountMinor,
          0,
        ),
        localStays: localStays.length,
        campingPayments: allPayments.length,
        campingStays: allStays.length,
        activeStaysRead: stays.total,
        availabilityTypes: availability.types.map((type) => ({
          typeId: type.typeId,
          inventoryMode: type.inventoryMode,
          nights: type.inventoryMode === 'shared' ? type.units : type.nights,
        })),
      },
      null,
      2,
    ),
  )
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      'camping-key': { type: 'string' },
    },
  })
  if (values.help) {
    console.log(HELP)
    return
  }
  if (positionals.length) inputError(`Unknown argument.\n\n${HELP}`)
  localOnlyGuard()
  const campingKey =
    values['camping-key'] ?? process.env.CAMPING_KEY ?? DEFAULT_CAMPING_KEY
  const { createDataSource } = await import('../database/data-source')
  const dataSource = createDataSource()
  let skipped = 0
  try {
    await dataSource.initialize()
    const context = await loadCampingContext(dataSource, campingKey)
    const { room, free, units } = await ensureAccommodation(
      dataSource,
      context.camping,
    )
    const firstKey = seededUuid(
      'reservation',
      `${context.camping.id}:${RESERVATIONS[0].key}`,
    )
    const first = await existingReservation(
      dataSource,
      context.camping.id,
      firstKey,
    )
    const anchor = first
      ? dateFrom(first.checkInDate, -RESERVATIONS[0].startOffset)
      : todayInTimezone(context.camping.timezone)
    const reservationService = new ReservationService(
      dataSource,
      new AvailabilityService(dataSource),
    )
    const paymentService = new ReservationPaymentsService(dataSource)
    const checkInService = new ReservationCheckInService(dataSource)
    let added = 0
    for (const seed of RESERVATIONS) {
      try {
        const type = seed.type === 'room' ? room : free
        const unit = seed.unit ? (units.get(seed.unit) ?? null) : null
        const key = seededUuid(
          'reservation',
          `${context.camping.id}:${seed.key}`,
        )
        const existed = await existingReservation(
          dataSource,
          context.camping.id,
          key,
        )
        let reservation = await createOrLoadReservation(
          dataSource,
          context,
          type,
          unit,
          seed,
          anchor,
          reservationService,
        )
        if (!existed) added++
        reservation = await ensurePayment(
          dataSource,
          context,
          reservation,
          seed,
          paymentService,
        )
        reservation = await ensureLifecycle(
          context,
          reservation,
          seed,
          checkInService,
        )
        console.log(`${seed.key}: ${reservation.status}`)
      } catch (error) {
        skipped++
        console.error(`${seed.key}: skipped (${errorCode(error)})`)
      }
    }
    console.log(
      `Local reservation seed: ${added} added; ${skipped} skipped; rerun is safe.`,
    )
    await printReadSummary(dataSource, context, { room, free })
    if (skipped)
      throw new Error(`${skipped} local reservation seed step(s) were skipped`)
  } finally {
    await destroy(dataSource)
  }
}

void main().catch((error: unknown) => {
  reportCliFailure('Local reservation seed', error)
  process.exitCode = 1
})
