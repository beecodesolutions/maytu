import { describe, expect, it } from 'vitest'
import {
  summarizeIndividualOccupancy,
  summarizeOccupancy,
} from './individualOccupancy'
import { readAllPages } from './pagination'

const types = [
  { id: 'rooms', enabled: true, inventoryMode: 'individual' },
  { id: 'camping', enabled: true, inventoryMode: 'unlimited' },
  { id: 'disabled', enabled: false, inventoryMode: 'individual' },
] as const

describe('individual occupancy', () => {
  it('derives total, camping, and individual metrics from the same active data', () => {
    const result = summarizeOccupancy(
      types,
      [
        { id: 'room-1', typeId: 'rooms', enabled: true },
        { id: 'room-2', typeId: 'rooms', enabled: true },
      ],
      [
        {
          id: 'reservation-room',
          status: 'checked_in',
          stayId: 'stay-room',
          unitId: 'room-1',
          accommodationTypeId: 'rooms',
        },
        {
          id: 'reservation-camping',
          status: 'checked_in',
          stayId: 'stay-camping',
          unitId: null,
          accommodationTypeId: 'camping',
        },
        {
          id: 'reservation-confirmed',
          status: 'confirmed',
          stayId: null,
          unitId: 'room-2',
          accommodationTypeId: 'rooms',
        },
        {
          id: 'reservation-closed',
          status: 'checked_out',
          stayId: 'stay-closed',
          unitId: 'room-2',
          accommodationTypeId: 'rooms',
        },
      ],
      [
        {
          id: 'stay-room',
          reservationId: 'reservation-room',
          adults: 2,
          children: 1,
          infants: 0,
          hasVehicle: true,
        },
        {
          id: 'stay-camping',
          reservationId: 'reservation-camping',
          adults: 2,
          children: 0,
          infants: 1,
          hasVehicle: false,
        },
        {
          id: 'stay-legacy',
          reservationId: null,
          adults: 1,
          children: 0,
          infants: 0,
          hasVehicle: true,
        },
        {
          id: 'stay-unknown',
          reservationId: 'missing-reservation',
          adults: 9,
          children: 0,
          infants: 0,
          hasVehicle: true,
        },
        {
          id: 'stay-room',
          reservationId: 'reservation-room',
          adults: 99,
          children: 0,
          infants: 0,
          hasVehicle: false,
        },
      ],
    )

    expect(result.total).toEqual({ groups: 4, people: 16, vehicles: 3 })
    expect(result.camping).toEqual({ groups: 2, people: 4, vehicles: 1 })
    expect(result.individual).toEqual({ groups: 1, people: 3, vehicles: 1 })
    expect(result.individualUnits).toMatchObject({
      occupied: 1,
      total: 2,
      unoccupied: 1,
    })
  })

  it('reads every page before calculating the aggregate', async () => {
    const pages: Record<
      number,
      { items: string[]; total: number; pageSize: number }
    > = {
      1: { items: ['room-1'], total: 3, pageSize: 1 },
      2: { items: ['room-2'], total: 3, pageSize: 1 },
      3: { items: ['room-3'], total: 3, pageSize: 1 },
    }

    await expect(readAllPages(async (page) => pages[page]!)).resolves.toEqual([
      'room-1',
      'room-2',
      'room-3',
    ])
  })

  it('counts only unique checked-in units with active linked stays', () => {
    const result = summarizeIndividualOccupancy(
      types,
      [
        { id: 'room-1', typeId: 'rooms', enabled: true },
        { id: 'room-2', typeId: 'rooms', enabled: true },
        { id: 'disabled-room', typeId: 'disabled', enabled: false },
      ],
      [
        {
          status: 'checked_in',
          stayId: 'stay-1',
          unitId: 'room-1',
          accommodationTypeId: 'rooms',
        },
        {
          status: 'checked_in',
          stayId: 'stay-1',
          unitId: 'room-1',
          accommodationTypeId: 'rooms',
        },
        {
          status: 'confirmed',
          stayId: null,
          unitId: 'room-2',
          accommodationTypeId: 'rooms',
        },
        {
          status: 'checked_out',
          stayId: 'stay-closed',
          unitId: 'room-2',
          accommodationTypeId: 'rooms',
        },
        {
          status: 'checked_in',
          stayId: 'stay-camping',
          unitId: null,
          accommodationTypeId: 'camping',
        },
        {
          status: 'checked_in',
          stayId: 'stay-2',
          unitId: 'disabled-room',
          accommodationTypeId: 'disabled',
        },
      ],
      [{ id: 'stay-1' }, { id: 'stay-2' }],
    )

    expect(result).toEqual({ occupied: 2, total: 3, unoccupied: 1 })
  })
})
