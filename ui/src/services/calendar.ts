import type {
  AccommodationType,
  AvailabilityResponse,
  IndividualAvailability,
  ReservationResponse,
  Stay,
} from '@camping/contracts'

export type CalendarDay = {
  date: string
  day: number
  inMonth: boolean
}

export type AvailabilityTone = 'free' | 'partial' | 'none' | 'unlimited'

export type AvailabilitySummary = {
  tone: AvailabilityTone
  available: number | null
  total: number | null
  reserved: number
  blocked: number
}
type AvailabilityType = AvailabilityResponse['types'][number]

const dayMs = 86_400_000

export function dateFromIso(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day, 12))
}

export function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export function addDays(value: string, days: number): string {
  return isoDate(new Date(dateFromIso(value).getTime() + days * dayMs))
}

export function monthRange(value: string): {
  start: string
  end: string
  days: CalendarDay[]
} {
  const first = dateFromIso(`${value}-01`)
  const year = first.getUTCFullYear()
  const month = first.getUTCMonth()
  const start = isoDate(first)
  const end = isoDate(new Date(Date.UTC(year, month + 1, 1, 12)))
  const leading = first.getUTCDay()
  const totalDays = Math.round(
    (dateFromIso(end).getTime() - first.getTime()) / dayMs,
  )
  const cells: CalendarDay[] = []
  for (let index = 0; index < leading; index += 1) {
    const date = isoDate(new Date(first.getTime() - (leading - index) * dayMs))
    cells.push({ date, day: dateFromIso(date).getUTCDate(), inMonth: false })
  }
  for (let index = 0; index < totalDays; index += 1) {
    const date = addDays(start, index)
    cells.push({ date, day: index + 1, inMonth: true })
  }
  while (cells.length % 7 !== 0) {
    const date = addDays(cells[cells.length - 1]!.date, 1)
    cells.push({ date, day: dateFromIso(date).getUTCDate(), inMonth: false })
  }
  return { start, end, days: cells }
}

export function monthKey(value: string): string {
  return value.slice(0, 7)
}

export function shiftMonth(value: string, amount: number): string {
  const current = dateFromIso(`${value}-01`)
  return isoDate(
    new Date(
      Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + amount, 1, 12),
    ),
  ).slice(0, 7)
}

export function availabilityForDate(
  value: AvailabilityType | undefined,
  date: string,
): AvailabilitySummary | null {
  if (!value) return null
  if (value.inventoryMode === 'shared') {
    const nights = value.units.flatMap((u) =>
      u.nights.filter((n) => n.date === date),
    )
    if (!nights.length) return null
    const available = nights.reduce((sum, n) => sum + n.availableBeds, 0)
    const total = nights.reduce((sum, n) => sum + n.totalBeds, 0)
    const reserved = nights.reduce((sum, n) => sum + n.reservedBeds, 0)
    const blocked = nights.reduce((sum, n) => sum + n.blockedBeds, 0)
    return {
      tone: available === 0 ? 'none' : available === total ? 'free' : 'partial',
      available,
      total,
      reserved,
      blocked,
    }
  }
  const night = value.nights.find((item) => item.date === date)
  if (!night) return null
  if (value.inventoryMode === 'unlimited') {
    const night = value.nights.find((item) => item.date === date)
    if (!night || !('reservations' in night)) return null
    return {
      tone: 'unlimited',
      available: null,
      total: null,
      reserved: night.reservations,
      blocked: 0,
    }
  }
  if (!('availableUnits' in night)) return null
  const tone: AvailabilityTone =
    night.availableUnits === 0
      ? 'none'
      : night.availableUnits === night.totalUnits
        ? 'free'
        : 'partial'
  return {
    tone,
    available: night.availableUnits,
    total: night.totalUnits,
    reserved: night.reservedUnits,
    blocked: night.blockedUnits,
  }
}

export function aggregateAvailabilityTone(
  summaries: AvailabilitySummary[],
): AvailabilityTone | undefined {
  if (!summaries.length) return undefined
  const limited = summaries.filter(({ tone }) => tone !== 'unlimited')
  const unlimited = summaries.filter(({ tone }) => tone === 'unlimited')
  const hasUnlimitedReservations = unlimited.some(
    ({ reserved }) => reserved > 0,
  )

  if (!limited.length) return hasUnlimitedReservations ? 'partial' : 'unlimited'
  if (!unlimited.length && limited.every(({ tone }) => tone === 'none'))
    return 'none'
  if (!hasUnlimitedReservations && limited.every(({ tone }) => tone === 'free'))
    return 'free'
  return 'partial'
}

export function typeNameById(types: AccommodationType[]): Map<string, string> {
  return new Map(types.map((type) => [type.id, type.name]))
}

export function dedupeLinkedStays(
  stays: Stay[],
  reservations: ReservationResponse[],
): { stays: Stay[]; reservations: ReservationResponse[] } {
  const reservationIds = new Set(
    stays.map((stay) => stay.reservationId).filter(Boolean),
  )
  return {
    stays,
    reservations: reservations.filter(
      (reservation) => !reservationIds.has(reservation.id),
    ),
  }
}

export function individualAvailability(
  value: AvailabilityType | undefined,
): IndividualAvailability | undefined {
  return value?.inventoryMode === 'individual' ? value : undefined
}
