const assert = require('node:assert/strict')
const { after, before, test } = require('node:test')
const { randomUUID } = require('node:crypto')
const argon2 = require('argon2')
const { Client } = require('pg')

process.env.NODE_ENV = 'test'
process.env.DB_SCHEMA = 'camping_private'
process.env.DB_HOST ??= 'localhost'
process.env.DB_PORT ??= '15434'
process.env.DB_USER ??= 'camping'
process.env.DB_PASSWORD ??= 'camping-local-only'
process.env.DB_NAME ??= 'camping_test'
process.env.DB_POOL_MAX = '2'
process.env.ALLOWED_ORIGIN = 'http://localhost:5173'
process.env.REQUIRE_ORIGIN = 'true'

const { createDataSource } = require('../dist/database/data-source')
const { createNestApp } = require('../dist/main')

const ORIGIN = 'http://localhost:5173'
const PASSWORD = 'correct horse battery staple'
const ids = {
  camping: randomUUID(),
  foreignCamping: randomUUID(),
  user: randomUUID(),
  foreignUser: randomUUID(),
  type: randomUUID(),
  unit: randomUUID(),
}
const username = `reservation-stays-${ids.user.slice(0, 8)}`
const foreignUsername = `reservation-stays-foreign-${ids.foreignUser.slice(0, 8)}`
const ageRanges = {
  infants: { min: 0, max: 5 },
  children: { min: 6, max: 17 },
  adults: { min: 18, max: null },
}
const rates = { adults: 1000, children: 500, infants: 100 }

let dataSource
let app
let baseUrl
let cookie
let foreignCookie
let fixture

function dateShift(value, days) {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function todayUtc() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(
    new Date(),
  )
}

async function request(
  path,
  { method = 'GET', body, sessionCookie = cookie } = {},
) {
  const headers = { origin: ORIGIN }
  if (sessionCookie) headers.cookie = sessionCookie
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  return { response, value: text ? JSON.parse(text) : null }
}

async function login(user, password = PASSWORD) {
  const result = await request('/api/auth/login', {
    method: 'POST',
    body: { username: user, password },
    sessionCookie: undefined,
  })
  assert.equal(result.response.status, 201, JSON.stringify(result.value))
  return result.response.headers.get('set-cookie').split(';', 1)[0]
}

function errorCode(result) {
  return result.value?.code ?? result.value?.error?.code
}

async function countRows(sql, parameters = []) {
  const [row] = await dataSource.query(sql, parameters)
  return Number(row.count)
}

async function createAndCheckIn() {
  const today = todayUtc()
  const checkInDate = dateShift(today, -2)
  const checkOutDate = today
  const arrivalDate = dateShift(today, -1)
  const quote = await request('/api/reservations/quote', {
    method: 'POST',
    body: {
      accommodationTypeId: ids.type,
      unitId: ids.unit,
      checkInDate,
      checkOutDate,
      adults: 1,
      children: 0,
      infants: 0,
    },
  })
  assert.equal(quote.response.status, 201, JSON.stringify(quote.value))
  const created = await request('/api/reservations', {
    method: 'POST',
    body: {
      accommodationTypeId: ids.type,
      unitId: ids.unit,
      checkInDate,
      checkOutDate,
      responsibleName: 'Linked stay guest',
      adults: 1,
      children: 0,
      infants: 0,
      idempotencyKey: randomUUID(),
      acceptedTotalMinor: quote.value.priceSnapshot.totalMinor - 200,
      agreedTotalMinor: quote.value.priceSnapshot.totalMinor - 200,
      priceAdjustmentReason: 'Direct booking discount',
    },
  })
  assert.equal(created.response.status, 201, JSON.stringify(created.value))
  const checkInQuote = await request(
    `/api/reservations/${created.value.id}/check-in/quote`,
    {
      method: 'POST',
      body: { version: created.value.version, arrivalDate },
    },
  )
  assert.equal(
    checkInQuote.response.status,
    201,
    JSON.stringify(checkInQuote.value),
  )
  const checkedIn = await request(
    `/api/reservations/${created.value.id}/check-in`,
    {
      method: 'POST',
      body: {
        version: created.value.version,
        arrivalDate,
        acceptedTotalMinor: checkInQuote.value.priceSnapshot.totalMinor,
      },
    },
  )
  assert.equal(checkedIn.response.status, 201, JSON.stringify(checkedIn.value))
  assert.ok(checkedIn.value.stayId)
  return {
    reservation: checkedIn.value,
    stayId: checkedIn.value.stayId,
    departureDate: checkOutDate,
  }
}

before(async () => {
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  })
  await client.connect()
  await client.query('CREATE SCHEMA IF NOT EXISTS camping_private')
  await client.end()
  dataSource = createDataSource()
  await dataSource.initialize()
  await dataSource.runMigrations()
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id })
  await dataSource.query(
    `INSERT INTO camping_private.campings
      (id, stable_key, name, country, currency, timezone, age_ranges, rates)
     VALUES ($1, $2, 'Reservation stays test', 'NI', 'NIO', 'UTC', $3, $4),
            ($5, $6, 'Foreign reservation stays test', 'NI', 'NIO', 'UTC', $3, $4)`,
    [
      ids.camping,
      `reservation-stays-${ids.camping}`,
      ageRanges,
      rates,
      ids.foreignCamping,
      `reservation-stays-${ids.foreignCamping}`,
    ],
  )
  // This suite exercises fractional NIO extras; explicitly opt in to cents.
  await dataSource.query(
    'UPDATE camping_private.campings SET money_decimals = NULL WHERE id = $1',
    [ids.camping],
  )
  await dataSource.query(
    `INSERT INTO camping_private.users
      (id, camping_id, username, name, password_hash, enabled, password_changed_at)
     VALUES ($1, $2, $3, 'Reservation stays owner', $4, true, CURRENT_TIMESTAMP),
            ($5, $6, $7, 'Foreign reservation stays owner', $4, true, CURRENT_TIMESTAMP)`,
    [
      ids.user,
      ids.camping,
      username,
      passwordHash,
      ids.foreignUser,
      ids.foreignCamping,
      foreignUsername,
    ],
  )
  await dataSource.query(
    `INSERT INTO camping_private.accommodation_types
      (id, camping_id, name, inventory_mode, max_occupancy, base_nightly_price_minor)
     VALUES ($1, $2, 'Cabin', 'individual', 4, 1000)`,
    [ids.type, ids.camping],
  )
  await dataSource.query(
    `INSERT INTO camping_private.accommodation_units
      (id, camping_id, accommodation_type_id, name, max_occupancy)
     VALUES ($1, $2, $3, 'A-1', 4)`,
    [ids.unit, ids.camping, ids.type],
  )
  app = await createNestApp()
  app.useLogger(false)
  await app.listen(0, '127.0.0.1')
  baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`
  cookie = await login(username)
  foreignCookie = await login(foreignUsername)
  fixture = await createAndCheckIn()
})

after(async () => {
  if (app) await app.close()
  if (!dataSource?.isInitialized) return
  const campingIds = [ids.camping, ids.foreignCamping]
  await dataSource.query(
    `DELETE FROM camping_private.payments WHERE camping_id = ANY($1::uuid[])`,
    [campingIds],
  )
  await dataSource.query(
    `DELETE FROM camping_private.applied_extras WHERE stay_id IN
      (SELECT id FROM camping_private.stays WHERE camping_id = ANY($1::uuid[]))`,
    [campingIds],
  )
  await dataSource.query(
    `DELETE FROM camping_private.audit_logs WHERE camping_id = ANY($1::uuid[])`,
    [campingIds],
  )
  await dataSource.query(
    `DELETE FROM camping_private.outbox_events WHERE camping_id = ANY($1::uuid[])`,
    [campingIds],
  )
  await dataSource.query(
    `DELETE FROM camping_private.stays WHERE camping_id = ANY($1::uuid[])`,
    [campingIds],
  )
  await dataSource.query(
    `DELETE FROM camping_private.reservations WHERE camping_id = ANY($1::uuid[])`,
    [campingIds],
  )
  await dataSource.query(
    `DELETE FROM camping_private.extra_templates WHERE camping_id = ANY($1::uuid[])`,
    [campingIds],
  )
  await dataSource.query(
    `DELETE FROM camping_private.accommodation_units WHERE camping_id = ANY($1::uuid[])`,
    [campingIds],
  )
  await dataSource.query(
    `DELETE FROM camping_private.accommodation_types WHERE camping_id = ANY($1::uuid[])`,
    [campingIds],
  )
  await dataSource.query(
    `DELETE FROM camping_private.users WHERE camping_id = ANY($1::uuid[])`,
    [campingIds],
  )
  await dataSource.query(
    `DELETE FROM camping_private.campings WHERE id = ANY($1::uuid[])`,
    [campingIds],
  )
  await dataSource.destroy()
})

test('linked stays enforce accepted dates, extras, frozen payments, and close atomically', async () => {
  const wrongQuote = await request(`/api/stays/${fixture.stayId}/quote`, {
    method: 'POST',
    body: { departureDate: dateShift(fixture.departureDate, -1) },
  })
  assert.equal(wrongQuote.response.status, 409)
  assert.equal(errorCode(wrongQuote), 'RESERVATION_DATES_CHANGED')

  const template = await request('/api/extra-templates', {
    method: 'POST',
    body: {
      category: 'service',
      description: 'Linked extra',
      unitPriceMinor: 250,
    },
  })
  assert.equal(template.response.status, 201, JSON.stringify(template.value))
  const extra = await request(`/api/stays/${fixture.stayId}/extras`, {
    method: 'POST',
    body: { templateId: template.value.id, quantity: 2 },
  })
  assert.equal(extra.response.status, 201, JSON.stringify(extra.value))
  assert.equal(extra.value.account.totalMinor, 1300)

  const paymentKey = randomUUID()
  const payment = await request(`/api/stays/${fixture.stayId}/payments`, {
    method: 'POST',
    body: {
      amountMinor: 500,
      method: 'cash',
      paidOn: todayUtc(),
      note: '',
      idempotencyKey: paymentKey,
    },
  })
  assert.equal(payment.response.status, 201, JSON.stringify(payment.value))
  const savedPayment = payment.value.payments.find(
    (value) => value.idempotencyKey === undefined || value.amountMinor === 500,
  )
  assert.ok(savedPayment)
  assert.equal(savedPayment.reservationId, fixture.reservation.id)
  const [paymentRow] = await dataSource.query(
    `SELECT stay_id, reservation_id FROM camping_private.payments
     WHERE camping_id = $1 AND idempotency_key = $2`,
    [ids.camping, paymentKey],
  )
  assert.equal(paymentRow.stay_id, fixture.stayId)
  assert.equal(paymentRow.reservation_id, fixture.reservation.id)

  await dataSource.query(
    `UPDATE camping_private.payments
     SET voided_at = CURRENT_TIMESTAMP, voided_by_id = $1, void_reason = 'Test correction'
     WHERE camping_id = $2 AND stay_id = $3 AND idempotency_key = $4`,
    [ids.user, ids.camping, fixture.stayId, paymentKey],
  )
  const afterVoid = await request(`/api/stays/${fixture.stayId}`)
  assert.equal(afterVoid.value.account.paidMinor, 0)
  assert.equal(afterVoid.value.account.balanceMinor, 1300)
  assert.equal(afterVoid.value.payments[0].voidReason, 'Test correction')

  const rollback = await request(`/api/stays/${fixture.stayId}/close`, {
    method: 'POST',
    body: {
      departureDate: fixture.departureDate,
      version: afterVoid.value.version,
      payment: {
        amountMinor: 1000,
        method: 'cash',
        paidOn: todayUtc(),
        note: '',
        idempotencyKey: randomUUID(),
      },
    },
  })
  assert.equal(rollback.response.status, 409, JSON.stringify(rollback.value))
  assert.equal(errorCode(rollback), 'BALANCE_NOT_ZERO')
  assert.equal(
    await countRows(
      `SELECT count(*) FROM camping_private.payments WHERE stay_id = $1`,
      [fixture.stayId],
    ),
    1,
  )

  const settled = await request(`/api/stays/${fixture.stayId}/payments`, {
    method: 'POST',
    body: {
      amountMinor: 1300,
      method: 'transfer',
      paidOn: todayUtc(),
      note: '',
      idempotencyKey: randomUUID(),
    },
  })
  assert.equal(settled.response.status, 201, JSON.stringify(settled.value))
  const closeBody = {
    departureDate: fixture.departureDate,
    version: settled.value.version,
  }
  const closes = await Promise.all([
    request(`/api/stays/${fixture.stayId}/close`, {
      method: 'POST',
      body: closeBody,
    }),
    request(`/api/stays/${fixture.stayId}/close`, {
      method: 'POST',
      body: closeBody,
    }),
  ])
  assert.deepEqual(
    closes.map((value) => value.response.status).sort(),
    [201, 201],
  )
  const closed = closes[0].value
  assert.equal(closed.account.balanceMinor, 0)
  assert.equal(closed.reservationId, fixture.reservation.id)
  assert.equal(
    await countRows(
      `SELECT count(*) FROM camping_private.outbox_events
       WHERE aggregate_id = $1 AND event_type = 'ReservationCheckedOut'`,
      [fixture.reservation.id],
    ),
    1,
  )
  const reservation = await request(
    `/api/reservations/${fixture.reservation.id}`,
  )
  assert.equal(reservation.value.status, 'checked_out')
  assert.equal(reservation.value.stayId, fixture.stayId)
  assert.equal(reservation.value.account.balanceMinor, 0)
})

test('linked resources remain tenant isolated', async () => {
  const foreignStay = await request(`/api/stays/${fixture.stayId}`, {
    sessionCookie: foreignCookie,
  })
  assert.equal(foreignStay.response.status, 404)
  const foreignPayment = await request(
    `/api/stays/${fixture.stayId}/payments`,
    {
      method: 'POST',
      sessionCookie: foreignCookie,
      body: {
        amountMinor: 1,
        method: 'cash',
        paidOn: todayUtc(),
        note: '',
        idempotencyKey: randomUUID(),
      },
    },
  )
  assert.equal(foreignPayment.response.status, 404)
})
