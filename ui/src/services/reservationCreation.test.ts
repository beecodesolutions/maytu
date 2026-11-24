import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import type {
  ReservationCreate,
  ReservationQuote,
  ReservationResponse,
} from '@camping/contracts'
import { createAppStore } from '../app/store'
import { api } from './api'

const server = setupServer()
let store = createAppStore()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  store.dispatch(api.util.resetApiState())
  store = createAppStore()
  server.resetHandlers()
})
afterAll(() => server.close())
const input = {
  accommodationTypeId: '00000000-0000-4000-8000-000000000001',
  unitId: '00000000-0000-4000-8000-000000000003',
  checkInDate: '2026-11-01',
  checkOutDate: '2026-11-02',
  adults: 3,
  children: 1,
  infants: 1,
}
const quote = {
  priceSnapshot: {
    basis: 'per_unit',
    currency: 'CLP',
    baseNightlyPriceMinor: 1000,
    nights: 1,
    totalMinor: 1000,
  },
  occupancyWarning: { maxOccupancy: 2, people: 5 },
} satisfies ReservationQuote
const body = {
  ...input,
  responsibleName: 'Ana',
  acceptedTotalMinor: 1000,
  idempotencyKey: '00000000-0000-4000-8000-000000000002',
} satisfies ReservationCreate
const response = {
  ...input,
  id: '00000000-0000-4000-8000-000000000004',
  campingId: '00000000-0000-4000-8000-000000000005',
  stayId: null,
  responsibleName: 'Ana',
  email: null,
  phone: null,
  document: null,
  nationality: null,
  status: 'confirmed',
  source: 'manual',
  notes: '',
  priceSnapshot: quote.priceSnapshot,
  payments: [],
  account: { totalMinor: 1000, paidMinor: 0, balanceMinor: 1000 },
  version: 1,
  createdAt: '2026-10-30T12:00:00Z',
  updatedAt: '2026-10-30T12:00:00Z',
} satisfies ReservationResponse

it('quotes with the shared contract, keeps the warning and creates using the accepted total', async () => {
  const received: unknown[] = []
  let reads = 0
  server.use(
    http.get('*/api/reservations', () => {
      reads++
      return HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 25 })
    }),
    http.post('*/api/reservations/quote', async ({ request }) => {
      expect(await request.json()).toEqual(input)
      return HttpResponse.json(quote)
    }),
    http.post('*/api/reservations', async ({ request }) => {
      received.push(await request.json())
      return HttpResponse.json(response, { status: 201 })
    }),
  )
  const list = store.dispatch(
    api.endpoints.reservations.initiate({ page: 1, pageSize: 25 }),
  )
  await list.unwrap()
  const quoted = await store
    .dispatch(api.endpoints.reservationQuoteCreate.initiate(input))
    .unwrap()
  expect(quoted.occupancyWarning).toEqual({ maxOccupancy: 2, people: 5 })
  const created = await store
    .dispatch(api.endpoints.reservationCreate.initiate(body))
    .unwrap()
  expect(created.status).toBe('confirmed')
  expect(received).toEqual([body])
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(reads).toBe(2)
  list.unsubscribe()
})

it('exposes conflicts and retries the exact request after an ambiguous server failure', async () => {
  const received: unknown[] = []
  let count = 0
  server.use(
    http.post('*/api/reservations', async ({ request }) => {
      received.push(await request.json())
      count++
      return count === 1
        ? HttpResponse.json({ code: 'SERVER_ERROR' }, { status: 503 })
        : HttpResponse.json(response)
    }),
  )
  await expect(
    store.dispatch(api.endpoints.reservationCreate.initiate(body)).unwrap(),
  ).rejects.toMatchObject({ status: 503 })
  await expect(
    store.dispatch(api.endpoints.reservationCreate.initiate(body)).unwrap(),
  ).resolves.toMatchObject({ id: response.id })
  expect(received).toEqual([body, body])
  server.use(
    http.post('*/api/reservations', () =>
      HttpResponse.json({ code: 'PRICE_CHANGED' }, { status: 409 }),
    ),
  )
  await expect(
    store.dispatch(api.endpoints.reservationCreate.initiate(body)).unwrap(),
  ).rejects.toMatchObject({ status: 409, data: { code: 'PRICE_CHANGED' } })
})

it('searches all priced offers in one request without per-unit quotation calls', async () => {
  let searches = 0
  server.use(
    http.post('*/api/reservations/search', async ({ request }) => {
      searches++
      expect(await request.json()).toEqual({
        checkInDate: input.checkInDate,
        checkOutDate: input.checkOutDate,
        adults: input.adults,
        children: input.children,
        infants: input.infants,
      })
      return HttpResponse.json({
        offers: [
          { ...quote, input, accommodationName: 'Cabin A' },
          {
            ...quote,
            input: { ...input, unitId: '00000000-0000-4000-8000-000000000099' },
            accommodationName: 'Cabin B',
          },
        ],
      })
    }),
  )
  const { checkInDate, checkOutDate, adults, children, infants } = input
  const result = await store
    .dispatch(
      api.endpoints.reservationSearch.initiate({
        checkInDate,
        checkOutDate,
        adults,
        children,
        infants,
      }),
    )
    .unwrap()
  expect(searches).toBe(1)
  expect(result.offers).toHaveLength(2)
  expect(result.offers[0].priceSnapshot.totalMinor).toBe(1000)
  expect(result.offers[0].occupancyWarning).toEqual(quote.occupancyWarning)
})
