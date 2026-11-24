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
  individual: randomUUID(),
  unit: randomUUID(),
  foreignType: randomUUID(),
  foreignUnit: randomUUID(),
}
const username = `reservation-payments-${ids.user.slice(0, 8)}`
const foreignUsername = `reservation-payments-${ids.foreignUser.slice(0, 8)}`
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
let reservationCounter = 0

function assertTestDatabase() {
  const database = process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL).pathname.slice(1)
    : process.env.DB_NAME
  assert.equal(database, 'camping_test')
}

async function request(
  path,
  { method = 'GET', body, sessionCookie = cookie } = {},
) {
  const headers = {}
  if (sessionCookie) headers.cookie = sessionCookie
  headers.origin = ORIGIN
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  return { response, value: text ? JSON.parse(text) : null }
}

async function login(user = username, password = PASSWORD) {
  const result = await request('/api/auth/login', {
    method: 'POST',
    body: { username: user, password },
    sessionCookie: undefined,
  })
  assert.equal(result.response.status, 201, JSON.stringify(result.value))
  return result.response.headers.get('set-cookie').split(';', 1)[0]
}

function payment(key, amountMinor = 1000, paidOn = '2026-10-23') {
  return {
    amountMinor,
    method: 'cash',
    paidOn,
    note: '',
    idempotencyKey: key,
  }
}

async function createReservation({
  idempotencyKey = randomUUID(),
  cookieValue = cookie,
} = {}) {
  const offset = reservationCounter++ * 3
  const checkInDate = new Date(Date.UTC(2026, 11, 1 + offset))
    .toISOString()
    .slice(0, 10)
  const checkOutDate = new Date(Date.UTC(2026, 11, 3 + offset))
    .toISOString()
    .slice(0, 10)
  const quote = await request('/api/reservations/quote', {
    method: 'POST',
    body: {
      accommodationTypeId: ids.individual,
      unitId: ids.unit,
      checkInDate,
      checkOutDate,
      adults: 1,
      children: 0,
      infants: 0,
    },
    sessionCookie: cookieValue,
  })
  assert.equal(quote.response.status, 201, JSON.stringify(quote.value))
  const created = await request('/api/reservations', {
    method: 'POST',
    body: {
      accommodationTypeId: ids.individual,
      unitId: ids.unit,
      checkInDate,
      checkOutDate,
      responsibleName: 'Payment fixture',
      adults: 1,
      children: 0,
      infants: 0,
      idempotencyKey,
      acceptedTotalMinor: quote.value.priceSnapshot.totalMinor,
    },
    sessionCookie: cookieValue,
  })
  assert.equal(created.response.status, 201, JSON.stringify(created.value))
  return created.value
}

async function paymentFor(reservation, body, cookieValue = cookie) {
  return request(`/api/reservations/${reservation.id}/payments`, {
    method: 'POST',
    body,
    sessionCookie: cookieValue,
  })
}

async function countRows(sql, params = []) {
  const [row] = await dataSource.query(sql, params)
  return Number(row.count)
}

before(async () => {
  assertTestDatabase()
  const clientOptions = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
      }
  const client = new Client(clientOptions)
  await client.connect()
  await client.query('CREATE SCHEMA IF NOT EXISTS camping_private')
  await client.end()
  dataSource = createDataSource()
  await dataSource.initialize()
  await dataSource.runMigrations()
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id })
  await dataSource.query(
    `INSERT INTO camping_private.campings
      (id, stable_key, name, country, currency, timezone, age_ranges, rates)
     VALUES ($1, $2, 'Reservation payments test', 'NI', 'NIO', 'America/Managua', $5, $6),
            ($3, $4, 'Foreign reservation payments test', 'NI', 'NIO', 'UTC', $5, $6)`,
    [
      ids.camping,
      `reservation-payments-${ids.camping}`,
      ids.foreignCamping,
      `reservation-payments-${ids.foreignCamping}`,
      ageRanges,
      rates,
    ],
  )
  await dataSource.query(
    `INSERT INTO camping_private.users
      (id, camping_id, username, name, password_hash, enabled, password_changed_at)
     VALUES ($1, $2, $3, 'Reservation payments owner', $4, true, CURRENT_TIMESTAMP),
            ($5, $6, $7, 'Foreign reservation payments owner', $4, true, CURRENT_TIMESTAMP)`,
    [
      ids.user,
      ids.camping,
      username,
      hash,
      ids.foreignUser,
      ids.foreignCamping,
      foreignUsername,
    ],
  )
  await dataSource.query(
    `INSERT INTO camping_private.accommodation_types
      (id, camping_id, name, inventory_mode, max_occupancy, base_nightly_price_minor, enabled)
     VALUES ($1, $2, 'Cabin', 'individual', 4, 1000, true),
            ($3, $4, 'Foreign cabin', 'individual', 4, 1000, true)`,
    [ids.individual, ids.camping, ids.foreignType, ids.foreignCamping],
  )
  await dataSource.query(
    `INSERT INTO camping_private.accommodation_units
      (id, camping_id, accommodation_type_id, name, enabled, max_occupancy)
     VALUES ($1, $2, $3, 'A1', true, 4), ($4, $5, $6, 'B1', true, 4)`,
    [
      ids.unit,
      ids.camping,
      ids.individual,
      ids.foreignUnit,
      ids.foreignCamping,
      ids.foreignType,
    ],
  )
  app = await createNestApp()
  app.useLogger(false)
  await app.listen(0, '127.0.0.1')
  baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`
  cookie = await login()
})

after(async () => {
  if (app) await app.close()
  if (dataSource?.isInitialized) {
    const campingIds = [ids.camping, ids.foreignCamping]
    await dataSource.query(
      `DELETE FROM camping_private.audit_logs WHERE camping_id = ANY($1::uuid[])`,
      [campingIds],
    )
    await dataSource.query(
      `DELETE FROM camping_private.outbox_events WHERE camping_id = ANY($1::uuid[])`,
      [campingIds],
    )
    await dataSource.query(
      `DELETE FROM camping_private.payments WHERE camping_id = ANY($1::uuid[])`,
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
  }
})

test('records multiple payments, supports overpayment, and restores balance after void', async () => {
  const reservation = await createReservation()
  const first = paymentFor(reservation, payment(randomUUID(), 1500))
  const second = paymentFor(
    reservation,
    payment(randomUUID(), 2000, '2026-10-22'),
  )
  assert.equal((await first).response.status, 201)
  const secondResult = await second
  assert.equal(secondResult.response.status, 201)
  assert.equal(secondResult.value.account.paidMinor, 3500)
  assert.equal(secondResult.value.account.balanceMinor, -1500)
  assert.equal(secondResult.value.payments.length, 2)
  const voided = await request(
    `/api/reservations/${reservation.id}/payments/${secondResult.value.payments[1].id}/void`,
    {
      method: 'POST',
      body: { voidReason: 'Duplicate entry' },
    },
  )
  assert.equal(voided.response.status, 201)
  assert.equal(voided.value.account.paidMinor, 1500)
  assert.equal(voided.value.account.balanceMinor, 500)
  assert.equal(voided.value.payments.length, 2)
  assert.equal(voided.value.payments[1].voidReason, 'Duplicate entry')
  const conflictingVoid = await request(
    `/api/reservations/${reservation.id}/payments/${secondResult.value.payments[1].id}/void`,
    { method: 'POST', body: { voidReason: 'Different reason' } },
  )
  assert.equal(conflictingVoid.response.status, 409)
})

test('replays the same key after void or cancellation without new rows or events', async () => {
  const reservation = await createReservation()
  const key = randomUUID()
  const recorded = await paymentFor(reservation, payment(key))
  assert.equal(recorded.response.status, 201)
  const before = await countRows(
    `SELECT count(*) FROM camping_private.outbox_events WHERE aggregate_id = $1`,
    [reservation.id],
  )
  const voided = await request(
    `/api/reservations/${reservation.id}/payments/${recorded.value.payments[0].id}/void`,
    { method: 'POST', body: { voidReason: 'Test replay' } },
  )
  assert.equal(voided.response.status, 201)
  const replay = await paymentFor(reservation, payment(key))
  assert.equal(replay.response.status, 201)
  assert.equal(
    await countRows(
      `SELECT count(*) FROM camping_private.payments WHERE reservation_id = $1`,
      [reservation.id],
    ),
    1,
  )
  assert.equal(
    await countRows(
      `SELECT count(*) FROM camping_private.outbox_events WHERE aggregate_id = $1`,
      [reservation.id],
    ),
    before + 1,
  )

  const cancelled = await createReservation()
  const cancelledKey = randomUUID()
  const cancelledPayment = await paymentFor(cancelled, payment(cancelledKey))
  assert.equal(cancelledPayment.response.status, 201)
  const cancel = await request(`/api/reservations/${cancelled.id}/cancel`, {
    method: 'POST',
    body: { version: cancelledPayment.value.version },
  })
  assert.equal(cancel.response.status, 201)
  const cancelledCounts = {
    payments: await countRows(
      `SELECT count(*) FROM camping_private.payments WHERE reservation_id = $1`,
      [cancelled.id],
    ),
    events: await countRows(
      `SELECT count(*) FROM camping_private.outbox_events WHERE aggregate_id = $1`,
      [cancelled.id],
    ),
  }
  assert.equal(
    (await paymentFor(cancelled, payment(cancelledKey))).response.status,
    201,
  )
  assert.equal(
    await countRows(
      `SELECT count(*) FROM camping_private.payments WHERE reservation_id = $1`,
      [cancelled.id],
    ),
    cancelledCounts.payments,
  )
  assert.equal(
    await countRows(
      `SELECT count(*) FROM camping_private.outbox_events WHERE aggregate_id = $1`,
      [cancelled.id],
    ),
    cancelledCounts.events,
  )
})

test('rejects conflicting keys, foreign resources, and future dates', async () => {
  const reservation = await createReservation()
  const key = randomUUID()
  assert.equal(
    (await paymentFor(reservation, payment(key))).response.status,
    201,
  )
  assert.equal(
    (await paymentFor(reservation, { ...payment(key), amountMinor: 101 }))
      .response.status,
    409,
  )
  const otherReservation = await createReservation()
  assert.equal(
    (await paymentFor(otherReservation, payment(key))).response.status,
    409,
  )
  const foreignReservationId = randomUUID()
  await dataSource.query(
    `INSERT INTO camping_private.reservations
      (id, camping_id, accommodation_type_id, unit_id, responsible_name,
       check_in_date, check_out_date, adults, children, infants, status,
       price_snapshot, idempotency_key)
     VALUES ($1, $2, $3, $4, 'Foreign reservation', '2027-02-01', '2027-02-03',
       1, 0, 0, 'confirmed', $5, $6)`,
    [
      foreignReservationId,
      ids.foreignCamping,
      ids.foreignType,
      ids.foreignUnit,
      {
        basis: 'per_unit',
        currency: 'NIO',
        baseNightlyPriceMinor: 1000,
        nights: 2,
        totalMinor: 2000,
      },
      randomUUID(),
    ],
  )
  const foreignPaymentId = randomUUID()
  await dataSource.query(
    `INSERT INTO camping_private.payments
      (id, camping_id, reservation_id, amount_minor, method, paid_on, note,
       recorded_by_id, idempotency_key)
     VALUES ($1, $2, $3, 1000, 'cash', CURRENT_DATE, '', $4, $5)`,
    [
      foreignPaymentId,
      ids.foreignCamping,
      foreignReservationId,
      ids.foreignUser,
      randomUUID(),
    ],
  )
  assert.equal(
    (await paymentFor({ id: foreignReservationId }, payment(randomUUID())))
      .response.status,
    404,
  )
  assert.equal(
    (
      await request(
        `/api/reservations/${reservation.id}/payments/${foreignPaymentId}/void`,
        { method: 'POST', body: { voidReason: 'Foreign payment' } },
      )
    ).response.status,
    404,
  )
  assert.equal(
    (await paymentFor(reservation, payment(randomUUID(), 1000, '2099-01-01')))
      .response.status,
    409,
  )
})

test('cancelled reservations keep existing cobros but reject a new payment', async () => {
  const reservation = await createReservation()
  const recorded = await paymentFor(reservation, payment(randomUUID()))
  assert.equal(recorded.response.status, 201)
  const cancelled = await request(
    `/api/reservations/${reservation.id}/cancel`,
    { method: 'POST', body: { version: recorded.value.version } },
  )
  assert.equal(cancelled.response.status, 201)
  assert.equal(
    (await paymentFor(reservation, payment(randomUUID()))).response.status,
    409,
  )
  assert.equal(
    (await request(`/api/reservations/${reservation.id}`)).value.payments
      .length,
    1,
  )
})

test('concurrent duplicate recording and voiding produce one mutation each', async () => {
  const reservation = await createReservation()
  const key = randomUUID()
  const results = await Promise.all([
    paymentFor(reservation, payment(key)),
    paymentFor(reservation, payment(key)),
  ])
  assert.deepEqual(
    results.map((result) => result.response.status).sort(),
    [201, 201],
  )
  assert.equal(
    await countRows(
      `SELECT count(*) FROM camping_private.payments WHERE reservation_id = $1`,
      [reservation.id],
    ),
    1,
  )
  const latest = await request(`/api/reservations/${reservation.id}`)
  const paymentId = latest.value.payments[0].id
  const versionBeforeVoid = latest.value.version
  const voids = await Promise.all([
    request(`/api/reservations/${reservation.id}/payments/${paymentId}/void`, {
      method: 'POST',
      body: { voidReason: 'Concurrent test' },
    }),
    request(`/api/reservations/${reservation.id}/payments/${paymentId}/void`, {
      method: 'POST',
      body: { voidReason: 'Concurrent test' },
    }),
  ])
  assert.deepEqual(
    voids.map((result) => result.response.status).sort(),
    [201, 201],
  )
  assert.equal(
    (await request(`/api/reservations/${reservation.id}`)).value.version,
    versionBeforeVoid + 1,
  )
  assert.equal(
    await countRows(
      `SELECT count(*) FROM camping_private.outbox_events WHERE aggregate_id = $1 AND event_type = 'PaymentVoided'`,
      [reservation.id],
    ),
    1,
  )
})

test('linked stays reject reservation payments without mutating the legacy flow', async () => {
  const reservation = await createReservation()
  await dataSource.query(
    `INSERT INTO camping_private.stays
      (id, camping_id, created_by_id, reservation_id, responsible_name, arrival_date,
       adults, children, infants, currency, age_ranges, rates)
     VALUES ($1, $2, $3, $4, 'Linked stay', CURRENT_DATE, 1, 0, 0, 'NIO', $5, $6)`,
    [randomUUID(), ids.camping, ids.user, reservation.id, ageRanges, rates],
  )
  assert.equal(
    (await paymentFor(reservation, payment(randomUUID()))).response.status,
    409,
  )
})

test('overflow and outbox failure roll back payment and reservation version', async () => {
  const reservation = await createReservation()
  const normal = await createReservation()
  await dataSource.query(
    `UPDATE camping_private.reservations SET price_snapshot = jsonb_set(price_snapshot, '{totalMinor}', '9007199254740991') WHERE id = $1`,
    [reservation.id],
  )
  await dataSource.query(
    `INSERT INTO camping_private.payments
      (camping_id, reservation_id, amount_minor, method, paid_on, note, recorded_by_id, idempotency_key)
     VALUES ($1, $2, 9007199254740991, 'cash', CURRENT_DATE, '', $3, $4)`,
    [ids.camping, reservation.id, ids.user, randomUUID()],
  )
  const overflow = await paymentFor(reservation, payment(randomUUID(), 1))
  assert.equal(overflow.response.status, 409)
  const before = await request(`/api/reservations/${reservation.id}`)
  const normalAuditCount = await countRows(
    `SELECT count(*) FROM camping_private.audit_logs WHERE entity_id = $1`,
    [normal.id],
  )
  await dataSource.query(
    `CREATE OR REPLACE FUNCTION camping_private.reservation_payment_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test outbox failure'; END; $$`,
  )
  await dataSource.query(
    `CREATE TRIGGER reservation_payment_test_fail BEFORE INSERT ON camping_private.outbox_events FOR EACH ROW EXECUTE FUNCTION camping_private.reservation_payment_test_fail()`,
  )
  const failed = await paymentFor(normal, payment(randomUUID()))
  assert.equal(failed.response.status, 500)
  assert.equal(
    await countRows(
      `SELECT count(*) FROM camping_private.payments WHERE reservation_id = $1`,
      [normal.id],
    ),
    0,
  )
  assert.equal(
    (await request(`/api/reservations/${normal.id}`)).value.version,
    normal.version,
  )
  assert.equal(
    await countRows(
      `SELECT count(*) FROM camping_private.audit_logs WHERE entity_id = $1`,
      [normal.id],
    ),
    normalAuditCount,
  )
  await dataSource.query(
    `DROP TRIGGER reservation_payment_test_fail ON camping_private.outbox_events`,
  )
  await dataSource.query(
    `DROP FUNCTION camping_private.reservation_payment_test_fail()`,
  )
  assert.equal(before.value.version, reservation.version)
})
