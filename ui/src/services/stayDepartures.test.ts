import { todayInTimezone } from '@camping/contracts'
import { expect, it } from 'vitest'
import { groupStayDepartures } from './stayDepartures'

const activeStay = { closure: null, estimatedDeparture: '2026-11-23' }
const tomorrowStay = { closure: null, estimatedDeparture: '2026-11-24' }

it('uses the camping date when UTC has already crossed midnight', () => {
  const now = new Date('2026-11-24T02:00:00Z')
  const stays = [activeStay, tomorrowStay]
  expect(
    groupStayDepartures(stays, todayInTimezone('America/Mexico_City', now)),
  ).toEqual({ today: [activeStay], overdue: [] })
  expect(groupStayDepartures(stays, todayInTimezone('UTC', now))).toEqual({
    today: [tomorrowStay],
    overdue: [activeStay],
  })
})

it('reports no departures today when stays are undated, closed, overdue or due later', () => {
  const overdue = { closure: null, estimatedDeparture: '2026-11-22' }
  const closed = {
    estimatedDeparture: '2026-11-23',
    closure: {
      closedAt: '2026-11-23T12:00:00Z',
      closedBy: 'operator',
      departureDate: '2026-11-23',
      nights: 1,
      accommodationMinor: 0,
      extrasMinor: 0,
      totalMinor: 0,
      version: 1,
    },
  }
  expect(
    groupStayDepartures(
      [
        overdue,
        tomorrowStay,
        closed,
        { closure: null, estimatedDeparture: '' },
      ],
      '2026-11-23',
    ),
  ).toEqual({ today: [], overdue: [overdue] })
})
