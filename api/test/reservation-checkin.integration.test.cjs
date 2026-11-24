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
  user: randomUUID(),
  type: randomUUID(),
  unlimitedType: randomUUID(),
  units: Array.from({ length: 8 }, () => randomUUID()),
}
const username = `reservation-checkin-${ids.user.slice(0, 8)}`
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

async function request(path, { method = 'GET', body } = {}) {
  const headers = { origin: ORIGIN, cookie }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  return { response, value: text ? JSON.parse(text) : null }
}

function errorCode(result) {
  return result.value?.code ?? result.value?.error?.code
}

async function login() {
  const result = await request('/api/auth/login', {
    method: 'POST',
    body: { username, password: PASSWORD },
  })
  assert.equal(result.response.status, 201, JSON.stringify(result.value))
  return result.response.headers.get('set-cookie').split(';', 1)[0]
}

function reservationDates() {
  const today = todayUtc()
  return {
    today,
    checkInDate: dateShift(today, -1),
    checkOutDate: dateShift(today, 2),
  }
}

async function makeConfirmed({
  typeId = ids.type,
  unitId,
  checkInDate,
  checkOutDate,
  adults = 1,
} = {}) {
  const dates = reservationDates()
  checkInDate ??= dates.checkInDate
  checkOutDate ??= dates.checkOutDate
  const quoteBody = {
    accommodationTypeId: typeId,
    ...(unitId ? { unitId } : {}),
    checkInDate,
    checkOutDate,
    adults,
    children: 0,
    infants: 0,
  }
  const quote = await request('/api/reservations/quote', {
    method: 'POST',
    body: quoteBody,
  })
  assert.equal(quote.response.status, 201, JSON.stringify(quote.value))
  const created = await request('/api/reservations', {
    method: 'POST',
    body: {
      ...quoteBody,
      responsibleName: 'Check-in integration guest',
      email: 'checkin@example.test',
      idempotencyKey: randomUUID(),
      acceptedTotalMinor: quote.value.priceSnapshot.totalMinor,
    },
  })
  assert.equal(created.response.status, 201, JSON.stringify(created.value))
  return { reservation: created.value, quote: quote.value }
}

async function checkIn(reservation, arrivalDate = todayUtc(), details = {}) {
  const quote = await request(
    `/api/reservations/${reservation.id}/check-in/quote`,
    { method: 'POST', body: { version: reservation.version, arrivalDate } },
  )
  assert.equal(quote.response.status, 201, JSON.stringify(quote.value))
  const result = await request(`/api/reservations/${reservation.id}/check-in`, {
    method: 'POST',
    body: {
      version: reservation.version,
      arrivalDate,
      acceptedTotalMinor: quote.value.priceSnapshot.totalMinor,
      ...details,
    },
  })
  assert.equal(result.response.status, 201, JSON.stringify(result.value))
  return { result, quote: quote.value }
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
     VALUES ($1, $2, 'Reservation check-in test', 'NI', 'NIO', 'UTC', $3, $4)`,
    [ids.camping, `reservation-checkin-${ids.camping}`, ageRanges, rates],
  )
  await dataSource.query(
    `INSERT INTO camping_private.users
      (id, camping_id, username, name, password_hash, enabled, password_changed_at)
     VALUES ($1, $2, $3, 'Check-in test owner', $4, true, CURRENT_TIMESTAMP)`,
    [ids.user, ids.camping, username, passwordHash],
  )
  await dataSource.query(
    `INSERT INTO camping_private.accommodation_types
      (id, camping_id, name, inventory_mode, max_occupancy, base_nightly_price_minor)
     VALUES ($1, $2, 'Check-in cabin', 'individual', 4, 1000),
            ($3, $2, 'Check-in field', 'unlimited', NULL, 500)`,
    [ids.type, ids.camping, ids.unlimitedType],
  )
  await dataSource.query(
    `INSERT INTO camping_private.accommodation_units
      (id, camping_id, accommodation_type_id, name, max_occupancy)
     SELECT value, $1, $2, 'Check-in unit ' || row_number() OVER (), 4
     FROM unnest($3::uuid[]) AS value`,
    [ids.camping, ids.type, ids.units],
  )
  app = await createNestApp()
  app.useLogger(false)
  await app.listen(0, '127.0.0.1')
  baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`
  cookie = await login()
})

after(async () => {
  if (app) await app.close()
  if (!dataSource?.isInitialized) return
  await dataSource.query(
    `DELETE FROM camping_private.payments WHERE camping_id = $1`,
    [ids.camping],
  )
  await dataSource.query(
    `DELETE FROM camping_private.applied_extras WHERE stay_id IN
      (SELECT id FROM camping_private.stays WHERE camping_id = $1)`,
    [ids.camping],
  )
  await dataSource.query(
    `DELETE FROM camping_private.audit_logs WHERE camping_id = $1`,
    [ids.camping],
  )
  await dataSource.query(
    `DELETE FROM camping_private.outbox_events WHERE camping_id = $1`,
    [ids.camping],
  )
  await dataSource.query(
    'DELETE FROM camping_private.stays WHERE camping_id = $1',
    [ids.camping],
  )
  await dataSource.query(
    'DELETE FROM camping_private.reservations WHERE camping_id = $1',
    [ids.camping],
  )
  await dataSource.query(
    'DELETE FROM camping_private.accommodation_units WHERE camping_id = $1',
    [ids.camping],
  )
  await dataSource.query(
    'DELETE FROM camping_private.accommodation_types WHERE camping_id = $1',
    [ids.camping],
  )
  await dataSource.query(
    'DELETE FROM camping_private.users WHERE camping_id = $1',
    [ids.camping],
  )
  await dataSource.query('DELETE FROM camping_private.campings WHERE id = $1', [
    ids.camping,
  ])
  await dataSource.destroy()
})

test('check-in quote enforces date bounds and accepted price', async () => {
  const { reservation } = await makeConfirmed({ unitId: ids.units[0] })
  const today = todayUtc()
  const tooEarly = await request(
    `/api/reservations/${reservation.id}/check-in/quote`,
    {
      method: 'POST',
      body: { version: reservation.version, arrivalDate: dateShift(today, -2) },
    },
  )
  assert.equal(tooEarly.response.status, 409)
  assert.equal(errorCode(tooEarly), 'CHECKIN_TOO_EARLY')
  const future = await request(
    `/api/reservations/${reservation.id}/check-in/quote`,
    {
      method: 'POST',
      body: { version: reservation.version, arrivalDate: dateShift(today, 1) },
    },
  )
  assert.equal(future.response.status, 409)
  assert.equal(errorCode(future), 'FUTURE_CHECKIN')
  const { reservation: checkoutReservation } = await makeConfirmed({
    unitId: ids.units[6],
    checkOutDate: today,
  })
  const afterCheckout = await request(
    `/api/reservations/${checkoutReservation.id}/check-in/quote`,
    {
      method: 'POST',
      body: {
        version: checkoutReservation.version,
        arrivalDate: today,
      },
    },
  )
  assert.equal(afterCheckout.response.status, 409)
  assert.equal(errorCode(afterCheckout), 'CHECKIN_AFTER_CHECKOUT')
  const quote = await request(
    `/api/reservations/${reservation.id}/check-in/quote`,
    {
      method: 'POST',
      body: { version: reservation.version, arrivalDate: today },
    },
  )
  const mismatch = await request(
    `/api/reservations/${reservation.id}/check-in`,
    {
      method: 'POST',
      body: {
        version: reservation.version,
        arrivalDate: today,
        acceptedTotalMinor: quote.value.priceSnapshot.totalMinor + 1,
      },
    },
  )
  assert.equal(mismatch.response.status, 409)
  assert.equal(errorCode(mismatch), 'PRICE_CHANGED')
})

test('check-in replay keeps one stay and preserves payment links', async () => {
  const { reservation } = await makeConfirmed({ unitId: ids.units[1] })
  const paymentKey = randomUUID()
  const payment = await request(
    `/api/reservations/${reservation.id}/payments`,
    {
      method: 'POST',
      body: {
        amountMinor: 100,
        method: 'cash',
        paidOn: todayUtc(),
        note: 'anticipation',
        idempotencyKey: paymentKey,
      },
    },
  )
  assert.equal(payment.response.status, 201, JSON.stringify(payment.value))
  const checked = await checkIn(payment.value, todayUtc(), {
    hasVehicle: true,
    vehicleDescription: 'van',
    licensePlate: 'ABC-123',
  })
  const firstStayId = checked.result.value.stayId
  const firstPayment = payment.value.payments.find(
    (value) => value.amountMinor === 100,
  )
  assert.ok(firstPayment)
  const paymentReplay = await request(
    `/api/reservations/${reservation.id}/payments`,
    {
      method: 'POST',
      body: {
        amountMinor: 100,
        method: 'cash',
        paidOn: todayUtc(),
        note: 'anticipation',
        idempotencyKey: paymentKey,
      },
    },
  )
  assert.equal(
    paymentReplay.response.status,
    201,
    JSON.stringify(paymentReplay.value),
  )
  assert.equal(paymentReplay.value.version, checked.result.value.version)
  const replay = await request(`/api/reservations/${reservation.id}/check-in`, {
    method: 'POST',
    body: {
      version: reservation.version,
      arrivalDate: todayUtc(),
      acceptedTotalMinor: 1,
      hasVehicle: true,
      vehicleDescription: 'van',
      licensePlate: 'ABC-123',
    },
  })
  assert.equal(replay.response.status, 201, JSON.stringify(replay.value))
  assert.equal(replay.value.stayId, firstStayId)
  assert.equal(
    await dataSource
      .query(
        'SELECT count(*) FROM camping_private.stays WHERE reservation_id = $1',
        [reservation.id],
      )
      .then(([row]) => Number(row.count)),
    1,
  )
  const [paymentRow] = await dataSource.query(
    'SELECT id, stay_id FROM camping_private.payments WHERE id = $1',
    [firstPayment.id],
  )
  assert.equal(paymentRow.stay_id, firstStayId)
})

test('simultaneous check-ins converge on one stay', async () => {
  const { reservation } = await makeConfirmed({ unitId: ids.units[2] })
  const today = todayUtc()
  const quote = await request(
    `/api/reservations/${reservation.id}/check-in/quote`,
    {
      method: 'POST',
      body: { version: reservation.version, arrivalDate: today },
    },
  )
  const body = {
    version: reservation.version,
    arrivalDate: today,
    acceptedTotalMinor: quote.value.priceSnapshot.totalMinor,
  }
  const results = await Promise.all([
    request(`/api/reservations/${reservation.id}/check-in`, {
      method: 'POST',
      body,
    }),
    request(`/api/reservations/${reservation.id}/check-in`, {
      method: 'POST',
      body,
    }),
  ])
  assert.deepEqual(
    results.map((value) => value.response.status).sort(),
    [201, 201],
  )
  assert.equal(results[0].value.stayId, results[1].value.stayId)
  assert.equal(
    await dataSource
      .query(
        'SELECT count(*) FROM camping_private.stays WHERE reservation_id = $1',
        [reservation.id],
      )
      .then(([row]) => Number(row.count)),
    1,
  )
})

test('physical overstay blocks the next linked reservation by unit id', async () => {
  const { reservation: first } = await makeConfirmed({ unitId: ids.units[3] })
  const checked = await checkIn(first)
  const oldStart = dateShift(todayUtc(), -2)
  const oldEnd = dateShift(todayUtc(), -1)
  await dataSource.query(
    `UPDATE camping_private.reservations
     SET check_in_date = $1, check_out_date = $2
     WHERE id = $3`,
    [oldStart, oldEnd, first.id],
  )
  const { reservation: next } = await makeConfirmed({
    unitId: ids.units[3],
    checkInDate: todayUtc(),
    checkOutDate: dateShift(todayUtc(), 1),
  })
  const quote = await request(`/api/reservations/${next.id}/check-in/quote`, {
    method: 'POST',
    body: { version: next.version, arrivalDate: todayUtc() },
  })
  assert.equal(quote.response.status, 409)
  assert.equal(errorCode(quote), 'INVENTORY_UNAVAILABLE')
  assert.ok(checked.result.value.stayId)
})

test('unlimited accommodation has no physical occupancy limit', async () => {
  const first = await makeConfirmed({ typeId: ids.unlimitedType })
  const second = await makeConfirmed({ typeId: ids.unlimitedType })
  const [one, two] = await Promise.all([
    checkIn(first.reservation),
    checkIn(second.reservation),
  ])
  assert.ok(one.result.value.stayId)
  assert.ok(two.result.value.stayId)
  assert.notEqual(one.result.value.stayId, two.result.value.stayId)
})

test('checked-in date edit synchronizes the linked stay and detects conflicts', async () => {
  const tomorrow = dateShift(todayUtc(), 1)
  const dayAfter = dateShift(todayUtc(), 2)
  const { reservation } = await makeConfirmed({
    unitId: ids.units[4],
    checkOutDate: tomorrow,
  })
  const checked = await checkIn(reservation)
  const quote = await request(`/api/reservations/${reservation.id}/quote`, {
    method: 'POST',
    body: { version: checked.result.value.version, checkOutDate: dayAfter },
  })
  assert.equal(quote.response.status, 201, JSON.stringify(quote.value))
  const edited = await request(`/api/reservations/${reservation.id}`, {
    method: 'PATCH',
    body: {
      version: checked.result.value.version,
      checkOutDate: dayAfter,
      acceptedTotalMinor: quote.value.priceSnapshot.totalMinor,
    },
  })
  assert.equal(edited.response.status, 200, JSON.stringify(edited.value))
  const [stay] = await dataSource.query(
    'SELECT estimated_departure, version FROM camping_private.stays WHERE id = $1',
    [checked.result.value.stayId],
  )
  assert.equal(
    new Date(stay.estimated_departure).toISOString().slice(0, 10),
    dayAfter,
  )
  assert.equal(stay.version, 2)

  const conflict = await makeConfirmed({
    unitId: ids.units[4],
    checkInDate: dayAfter,
    checkOutDate: dateShift(dayAfter, 1),
  })
  const blockedQuote = await request(
    `/api/reservations/${reservation.id}/quote`,
    {
      method: 'POST',
      body: {
        version: edited.value.version,
        checkOutDate: dateShift(dayAfter, 1),
      },
    },
  )
  assert.equal(blockedQuote.response.status, 409)
  assert.equal(errorCode(blockedQuote), 'INVENTORY_UNAVAILABLE')
  assert.equal(conflict.reservation.status, 'confirmed')
})

test('voiding a linked payment advances both versions and replays idempotently', async () => {
  const { reservation } = await makeConfirmed({ unitId: ids.units[5] })
  const paid = await request(`/api/reservations/${reservation.id}/payments`, {
    method: 'POST',
    body: {
      amountMinor: 100,
      method: 'cash',
      paidOn: todayUtc(),
      note: '',
      idempotencyKey: randomUUID(),
    },
  })
  assert.equal(paid.response.status, 201, JSON.stringify(paid.value))
  const payment = paid.value.payments.find((value) => value.amountMinor === 100)
  assert.ok(payment)
  const checked = await checkIn(paid.value)
  const before = await request(`/api/reservations/${reservation.id}`)
  const voided = await request(
    `/api/reservations/${reservation.id}/payments/${payment.id}/void`,
    { method: 'POST', body: { voidReason: 'Correction' } },
  )
  assert.equal(voided.response.status, 201, JSON.stringify(voided.value))
  assert.equal(voided.value.version, before.value.version + 1)
  const [stayAfterVoid] = await dataSource.query(
    'SELECT version FROM camping_private.stays WHERE id = $1',
    [checked.result.value.stayId],
  )
  assert.equal(stayAfterVoid.version, 2)
  const replay = await request(
    `/api/reservations/${reservation.id}/payments/${payment.id}/void`,
    { method: 'POST', body: { voidReason: 'Correction' } },
  )
  assert.equal(replay.response.status, 201, JSON.stringify(replay.value))
  assert.equal(replay.value.version, voided.value.version)
  const [stayAfterReplay] = await dataSource.query(
    'SELECT version FROM camping_private.stays WHERE id = $1',
    [checked.result.value.stayId],
  )
  assert.equal(stayAfterReplay.version, 2)
})
