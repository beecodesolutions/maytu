import { describe, expect, it } from 'vitest'
import type {
  AvailabilityResponse,
  ReservationResponse,
  Stay,
} from '@camping/contracts'
import {
  availabilityForDate,
  dedupeLinkedStays,
  monthRange,
  shiftMonth,
} from './calendar'
import { summarizeOccupancy } from './individualOccupancy'

const individual = {
  typeId: '00000000-0000-4000-8000-000000000001',
  inventoryMode: 'individual',
  nights: [
    {
      date: '2026-10-23',
      totalUnits: 3,
      reservedUnits: 2,
      blockedUnits: 0,
      availableUnits: 1,
    },
    {
      date: '2026-10-24',
      totalUnits: 3,
      reservedUnits: 3,
      blockedUnits: 0,
      availableUnits: 0,
    },
  ],
  availableUnitIds: [],
} satisfies AvailabilityResponse['types'][number]

describe('availability calendar helpers', () => {
  it('builds a complete month grid using calendar dates', () => {
    const range = monthRange('2026-10')
    expect(range.start).toBe('2026-10-01')
    expect(range.end).toBe('2026-11-01')
    expect(range.days.filter((day) => day.inMonth)).toHaveLength(31)
    expect(range.days.length % 7).toBe(0)
  })

  it('shifts months across year boundaries', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
  })

  it('maps individual inventory to free, partial, and none states', () => {
    expect(availabilityForDate(individual, '2026-10-23')).toMatchObject({
      tone: 'partial',
      available: 1,
      reserved: 2,
    })
    expect(availabilityForDate(individual, '2026-10-24')).toMatchObject({
      tone: 'none',
      available: 0,
    })
  })

  it('keeps future inventory bookings out of current occupancy', () => {
    const units = individual.nights[0].totalUnits
    const type = {
      id: individual.typeId,
      enabled: true,
      inventoryMode: 'individual',
    } as const
    const configuredUnits = Array.from({ length: units }, (_, index) => ({
      id: `room-${index}`,
      typeId: type.id,
      enabled: true,
    }))
    const futureReservations = configuredUnits.map((unit) => ({
      id: `reservation-${unit.id}`,
      unitId: unit.id,
      stayId: null,
      status: 'confirmed' as const,
      accommodationTypeId: type.id,
    }))

    const occupancy = summarizeOccupancy(
      [type],
      configuredUnits,
      futureReservations,
      [],
    )
    expect(occupancy.total.groups).toBe(0)
    expect(occupancy.individualUnits).toEqual({
      occupied: 0,
      total: 3,
      unoccupied: 3,
    })
    expect(availabilityForDate(individual, '2026-10-24')).toMatchObject({
      available: 0,
      reserved: 3,
    })
  })

  it('keeps active room and camping stays while removing linked reservation duplicates', () => {
    const activeStays = [
      { id: 'stay-room', reservationId: 'reservation-room' },
      { id: 'stay-camping', reservationId: null },
    ] as Stay[]
    const reservations = [
      { id: 'reservation-room' },
      { id: 'reservation-camping' },
    ] as ReservationResponse[]

    const result = dedupeLinkedStays(activeStays, reservations)

    expect(result.stays.map((stay) => stay.id)).toEqual([
      'stay-room',
      'stay-camping',
    ])
    expect(result.reservations.map((reservation) => reservation.id)).toEqual([
      'reservation-camping',
    ])
  })
})

it('shared calendar counts beds independently of room counts', () => {
  const shared = {
    typeId: 'shared',
    inventoryMode: 'shared',
    units: [
      {
        unitId: 'room',
        availableBeds: 2,
        nights: [
          {
            date: '2030-01-01',
            availableBeds: 2,
            totalBeds: 6,
            reservedBeds: 4,
            blockedBeds: 0,
          },
        ],
      },
    ],
  } satisfies AvailabilityResponse['types'][number]
  expect(availabilityForDate(shared, '2030-01-01')).toEqual({
    tone: 'partial',
    available: 2,
    total: 6,
    reserved: 4,
    blocked: 0,
  })
})
