const assert = require('node:assert/strict')
const { after, before, test } = require('node:test')
const { randomUUID } = require('node:crypto')
const argon2 = require('argon2')

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
  type: randomUUID(),
  unit: randomUUID(),
  unlimitedType: randomUUID(),
  foreignType: randomUUID(),
}
const username = `reservation-owner-${ids.camping.slice(0, 8)}`
let dataSource
let app
let baseUrl
let cookie

async function request(path, options = {}) {
  const headers = { ...(options.cookie ? { cookie: options.cookie } : {}) }
  if (options.origin) headers.origin = options.origin
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const text = await response.text()
  return { response, value: text ? JSON.parse(text) : null }
}

async function login() {
  const result = await request('/api/auth/login', {
    method: 'POST',
    origin: ORIGIN,
    body: { username, password: PASSWORD },
  })
  assert.equal(result.response.status, 201)
  return result.response.headers.get('set-cookie').split(';', 1)[0]
}

function quoteBody(extra = {}) {
  return {
    accommodationTypeId: ids.type,
    unitId: ids.unit,
    checkInDate: '2030-11-01',
    checkOutDate: '2030-11-04',
    adults: 2,
    children: 0,
    infants: 0,
    ...extra,
  }
}

function createBody(extra = {}) {
  return {
    ...quoteBody(),
    responsibleName: 'Reservation guest',
    email: 'guest@example.com',
    phone: '+56912345678',
    document: '',
    nationality: 'CL',
    source: 'manual',
    notes: '',
    idempotencyKey: randomUUID(),
    acceptedTotalMinor: 3000,
    ...extra,
  }
}

async function createReservation(extra = {}) {
  const body = createBody(extra)
  const result = await request('/api/reservations', {
    method: 'POST',
    origin: ORIGIN,
    cookie,
    body,
  })
  return { ...result, body }
}

before(async () => {
  dataSource = createDataSource()
  await dataSource.initialize()
  await dataSource.query(
    `INSERT INTO camping_private.campings
      (id, stable_key, name, country, currency, timezone, age_ranges, rates)
     VALUES ($1, $2, 'Reservation test', 'CL', 'CLP', 'UTC', $3, $4)`,
    [
      ids.camping,
      `reservation-${ids.camping}`,
      {
        infants: { min: 0, max: 5 },
        children: { min: 6, max: 17 },
        adults: { min: 18, max: null },
      },
      { adults: 1000, children: 500, infants: 100 },
    ],
  )
  await dataSource.query(
    `INSERT INTO camping_private.campings
      (id, stable_key, name, country, currency, timezone, age_ranges, rates)
     VALUES ($1, $2, 'Foreign reservation test', 'CL', 'CLP', 'UTC', $3, $4)`,
    [
      ids.foreignCamping,
      `reservation-foreign-${ids.foreignCamping}`,
      {
        infants: { min: 0, max: 5 },
        children: { min: 6, max: 17 },
        adults: { min: 18, max: null },
      },
      { adults: 1000, children: 500, infants: 100 },
    ],
  )
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id })
  await dataSource.query(
    `INSERT INTO camping_private.users
      (id, camping_id, username, name, password_hash, enabled, password_changed_at)
     VALUES ($1, $2, $3, 'Reservation owner', $4, true, CURRENT_TIMESTAMP)`,
    [ids.user, ids.camping, username, passwordHash],
  )
  await dataSource.query(
    `INSERT INTO camping_private.accommodation_types
      (id, camping_id, name, inventory_mode, max_occupancy, base_nightly_price_minor)
     VALUES ($1, $2, 'Cabin', 'individual', 4, 1000)`,
    [ids.type, ids.camping],
  )
  await dataSource.query(
    `INSERT INTO camping_private.accommodation_types
      (id, camping_id, name, inventory_mode, max_occupancy, base_nightly_price_minor)
     VALUES ($1, $2, 'Open field', 'unlimited', NULL, 0)`,
    [ids.unlimitedType, ids.camping],
  )
  await dataSource.query(
    `INSERT INTO camping_private.accommodation_types
      (id, camping_id, name, inventory_mode, max_occupancy, base_nightly_price_minor)
     VALUES ($1, $2, 'Foreign cabin', 'individual', 4, 1000)`,
    [ids.foreignType, ids.foreignCamping],
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
  cookie = await login()
})

after(async () => {
  if (app) await app.close()
  if (!dataSource?.isInitialized) return
  await dataSource.query(
    'DELETE FROM camping_private.payments WHERE camping_id = $1',
    [ids.camping],
  )
  await dataSource.query(
    'DELETE FROM camping_private.reservations WHERE camping_id = $1',
    [ids.camping],
  )
  await dataSource.query(
    'DELETE FROM camping_private.accommodation_blocks WHERE camping_id = $1',
    [ids.camping],
  )
  await dataSource.query(
    'DELETE FROM camping_private.outbox_events WHERE camping_id = $1',
    [ids.camping],
  )
  await dataSource.query(
    'DELETE FROM camping_private.audit_logs WHERE camping_id = $1',
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
  await dataSource.query(
    'DELETE FROM camping_private.accommodation_types WHERE camping_id = $1',
    [ids.foreignCamping],
  )
  await dataSource.query('DELETE FROM camping_private.campings WHERE id = $1', [
    ids.foreignCamping,
  ])
  await dataSource.destroy()
})

test('search returns all priced offers, advisory warnings and tenant isolation without persisting', async () => {
  const body = {
    checkInDate: '2030-01-01',
    checkOutDate: '2030-01-04',
    adults: 4,
    children: 2,
    infants: 0,
  }
  const search = (extra = {}, auth = cookie) =>
    request('/api/reservations/search', {
      method: 'POST',
      origin: ORIGIN,
      cookie: auth,
      body: { ...body, ...extra },
    })
  assert.equal((await search({}, null)).response.status, 401)
  const past = await search({
    checkInDate: '2000-01-01',
    checkOutDate: '2000-01-02',
  })
  assert.equal(past.response.status, 409)
  assert.equal(past.value.code, 'RESERVATION_DATE_PAST')
  assert.equal((await search({ adults: 0, children: 0 })).response.status, 400)
  assert.equal(
    (await search({ checkOutDate: body.checkInDate })).response.status,
    400,
  )
  const result = await search()
  assert.equal(result.response.status, 201)
  assert.equal(result.value.offers.length, 2)
  const cabin = result.value.offers.find(
    (offer) => offer.input.unitId === ids.unit,
  )
  const field = result.value.offers.find(
    (offer) => offer.input.accommodationTypeId === ids.unlimitedType,
  )
  assert.equal(cabin.priceSnapshot.totalMinor, 3000)
  assert.equal(field.priceSnapshot.totalMinor, 15000)
  assert.deepEqual(cabin.occupancyWarning, { maxOccupancy: 4, people: 6 })
  for (const offer of result.value.offers) {
    assert.notEqual(offer.input.accommodationTypeId, ids.foreignType)
    const quoted = await request('/api/reservations/quote', {
      method: 'POST',
      origin: ORIGIN,
      cookie,
      body: offer.input,
    })
    assert.equal(quoted.response.status, 201)
    assert.deepEqual(quoted.value.priceSnapshot, offer.priceSnapshot)
  }
  const rows = await dataSource.query(
    'SELECT id FROM camping_private.reservations WHERE camping_id = $1',
    [ids.camping],
  )
  assert.equal(rows.length, 0)
  await dataSource.query(
    'UPDATE camping_private.accommodation_units SET enabled = false WHERE id = $1',
    [ids.unit],
  )
  try {
    assert.equal(
      (await search()).value.offers.some(
        (offer) => offer.input.unitId === ids.unit,
      ),
      false,
    )
  } finally {
    await dataSource.query(
      'UPDATE camping_private.accommodation_units SET enabled = true WHERE id = $1',
      [ids.unit],
    )
  }
})

test('quotes and creates a confirmed reservation with a frozen price', async () => {
  const quote = await request('/api/reservations/quote', {
    method: 'POST',
    origin: ORIGIN,
    cookie,
    body: quoteBody(),
  })
  assert.equal(quote.response.status, 201)
  assert.equal(quote.value.priceSnapshot.totalMinor, 3000)
  const created = await request('/api/reservations', {
    method: 'POST',
    origin: ORIGIN,
    cookie,
    body: createBody({
      acceptedTotalMinor: quote.value.priceSnapshot.totalMinor,
    }),
  })
  assert.equal(created.response.status, 201)
  assert.equal(created.value.status, 'confirmed')
  assert.equal(created.value.priceSnapshot.totalMinor, 3000)
  assert.equal(created.value.account.totalMinor, 3000)
  const offers = await request('/api/reservations/search', {
    method: 'POST',
    origin: ORIGIN,
    cookie,
    body: {
      checkInDate: '2030-11-01',
      checkOutDate: '2030-11-04',
      adults: 2,
      children: 0,
      infants: 0,
    },
  })
  assert.equal(offers.response.status, 201)
  assert.equal(
    offers.value.offers.some((offer) => offer.input.unitId === ids.unit),
    false,
  )

  const audit = await dataSource.query(
    `SELECT after_state FROM camping_private.audit_logs
     WHERE camping_id = $1 AND entity_id = $2 AND action = 'reservation.created'
     ORDER BY created_at DESC LIMIT 1`,
    [ids.camping, created.value.id],
  )
  assert.equal(audit[0].after_state.priceSnapshot.totalMinor, 3000)
  assert.equal(audit[0].after_state.adults, 2)
})

test('idempotent retry replays and changed payload conflicts', async () => {
  const idempotencyKey = randomUUID()
  const body = createBody({
    idempotencyKey,
    checkInDate: '2027-01-01',
    checkOutDate: '2027-01-03',
    acceptedTotalMinor: 2000,
  })
  const first = await request('/api/reservations', {
    method: 'POST',
    origin: ORIGIN,
    cookie,
    body,
  })
  assert.equal(first.response.status, 201)
  const retry = await request('/api/reservations', {
    method: 'POST',
    origin: ORIGIN,
    cookie,
    body,
  })
  assert.equal(retry.response.status, 201)
  assert.equal(retry.value.id, first.value.id)
  const changed = await request('/api/reservations', {
    method: 'POST',
    origin: ORIGIN,
    cookie,
    body: { ...body, responsibleName: 'Changed' },
  })
  assert.equal(changed.response.status, 409)
})

test('pricing mismatch and stale edit are rejected', async () => {
  const body = createBody({
    idempotencyKey: randomUUID(),
    checkInDate: '2028-01-01',
    checkOutDate: '2028-01-03',
    acceptedTotalMinor: 1,
  })
  const rejected = await request('/api/reservations', {
    method: 'POST',
    origin: ORIGIN,
    cookie,
    body,
  })
  assert.equal(rejected.response.status, 409)
  const list = await request('/api/reservations?page=1&pageSize=10', { cookie })
  assert.equal(list.response.status, 200)
  const row = list.value.items[0]
  const stale = await request(`/api/reservations/${row.id}`, {
    method: 'PATCH',
    origin: ORIGIN,
    cookie,
    body: { version: row.version + 1, responsibleName: 'Stale' },
  })
  assert.equal(stale.response.status, 409)
})

test('manual override survives edit and original create retry replays current row', async () => {
  const created = await createReservation({
    checkInDate: '2030-01-01',
    checkOutDate: '2030-01-04',
    acceptedTotalMinor: 2500,
    agreedTotalMinor: 2500,
    priceAdjustmentReason: 'Manual agreement',
    idempotencyKey: randomUUID(),
  })
  assert.equal(created.response.status, 201)
  assert.equal(created.value.priceSnapshot.adjustmentMinor, -500)
  const mismatch = await request(`/api/reservations/${created.value.id}`, {
    method: 'PATCH',
    origin: ORIGIN,
    cookie,
    body: {
      version: created.value.version,
      checkOutDate: '2030-01-05',
      acceptedTotalMinor: 2500,
    },
  })
  assert.equal(mismatch.response.status, 409)
  const edited = await request(`/api/reservations/${created.value.id}`, {
    method: 'PATCH',
    origin: ORIGIN,
    cookie,
    body: { version: created.value.version, responsibleName: 'Edited guest' },
  })
  assert.equal(edited.response.status, 200)
  const retry = await request('/api/reservations', {
    method: 'POST',
    origin: ORIGIN,
    cookie,
    body: created.body,
  })
  assert.equal(retry.response.status, 201)
  assert.equal(retry.value.id, created.value.id)
  assert.equal(retry.value.version, edited.value.version)
})

test('self modification excludes its own reservation and permits exceeding capacity', async () => {
  const created = await createReservation({
    checkInDate: '2031-01-01',
    checkOutDate: '2031-01-03',
    acceptedTotalMinor: 2000,
    idempotencyKey: randomUUID(),
  })
  assert.equal(created.response.status, 201)
  const quote = await request(`/api/reservations/${created.value.id}/quote`, {
    method: 'POST',
    origin: ORIGIN,
    cookie,
    body: {
      version: created.value.version,
      checkInDate: '2031-01-02',
      checkOutDate: '2031-01-04',
    },
  })
  assert.equal(quote.response.status, 201)
  assert.equal(quote.value.priceSnapshot.totalMinor, 2000)
  const edited = await request(`/api/reservations/${created.value.id}`, {
    method: 'PATCH',
    origin: ORIGIN,
    cookie,
    body: {
      version: created.value.version,
      adults: 5,
      capacityOverrideReason: 'Reserva administrativa autorizada',
      acceptedTotalMinor: 2000,
    },
  })
  assert.equal(edited.response.status, 200)
  const current = await request(`/api/reservations/${created.value.id}`, {
    cookie,
  })
  assert.equal(current.response.status, 200)
  assert.equal(current.value.adults, 5)
  assert.equal(current.value.version, created.value.version + 1)
})

test('simultaneous creates for one unit have one winner', async () => {
  const first = createBody({
    checkInDate: '2033-01-01',
    checkOutDate: '2033-01-02',
    acceptedTotalMinor: 1000,
    idempotencyKey: randomUUID(),
  })
  const second = { ...first, idempotencyKey: randomUUID() }
  const results = await Promise.all([
    request('/api/reservations', {
      method: 'POST',
      origin: ORIGIN,
      cookie,
      body: first,
    }),
    request('/api/reservations', {
      method: 'POST',
      origin: ORIGIN,
      cookie,
      body: second,
    }),
  ])
  assert.deepEqual(
    results.map((result) => result.response.status).sort(),
    [201, 409],
  )
})

test('inventory block competes with reservation creation', async () => {
  const block = await request('/api/accommodations/blocks', {
    method: 'POST',
    origin: ORIGIN,
    cookie,
    body: {
      typeId: ids.type,
      unitId: ids.unit,
      checkInDate: '2034-01-01',
      checkOutDate: '2034-01-03',
      reason: 'Maintenance',
    },
  })
  assert.equal(block.response.status, 201)
  const search = await request('/api/reservations/search', {
    method: 'POST',
    origin: ORIGIN,
    cookie,
    body: {
      checkInDate: '2034-01-01',
      checkOutDate: '2034-01-03',
      adults: 1,
      children: 0,
      infants: 0,
    },
  })
  assert.equal(search.response.status, 201)
  assert.equal(
    search.value.offers.some((offer) => offer.input.unitId === ids.unit),
    false,
  )

  const reservation = await request('/api/reservations', {
    method: 'POST',
    origin: ORIGIN,
    cookie,
    body: createBody({
      checkInDate: '2034-01-01',
      checkOutDate: '2034-01-03',
      acceptedTotalMinor: 2000,
      idempotencyKey: randomUUID(),
    }),
  })
  assert.equal(reservation.response.status, 409)
})

test('concurrent block and reservation compete under the same inventory lock', async () => {
  const blockBody = {
    typeId: ids.type,
    unitId: ids.unit,
    checkInDate: '2038-01-01',
    checkOutDate: '2038-01-03',
    reason: 'Concurrent maintenance',
  }
  const reservationBody = createBody({
    checkInDate: '2038-01-01',
    checkOutDate: '2038-01-03',
    acceptedTotalMinor: 2000,
    idempotencyKey: randomUUID(),
  })
  const results = await Promise.all([
    request('/api/accommodations/blocks', {
      method: 'POST',
      origin: ORIGIN,
      cookie,
      body: blockBody,
    }),
    request('/api/reservations', {
      method: 'POST',
      origin: ORIGIN,
      cookie,
      body: reservationBody,
    }),
  ])
  assert.deepEqual(
    results.map((result) => result.response.status).sort(),
    [201, 409],
  )
})

test('cancel and no-show use versions and cancellation releases inventory', async () => {
  const created = await createReservation({
    checkInDate: '2035-01-01',
    checkOutDate: '2035-01-02',
    acceptedTotalMinor: 1000,
    idempotencyKey: randomUUID(),
  })
  assert.equal(created.response.status, 201)
  const cancelled = await request(
    `/api/reservations/${created.value.id}/cancel`,
    {
      method: 'POST',
      origin: ORIGIN,
      cookie,
      body: { version: created.value.version },
    },
  )
  assert.equal(cancelled.response.status, 201)
  const released = await createReservation({
    checkInDate: '2035-01-01',
    checkOutDate: '2035-01-02',
    acceptedTotalMinor: 1000,
    idempotencyKey: randomUUID(),
  })
  assert.equal(released.response.status, 201)

  const today = new Date().toISOString().slice(0, 10)
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  const future = await createReservation({
    checkInDate: '2035-02-01',
    checkOutDate: '2035-02-02',
    acceptedTotalMinor: 1000,
    idempotencyKey: randomUUID(),
  })
  const early = await request(`/api/reservations/${future.value.id}/no-show`, {
    method: 'POST',
    origin: ORIGIN,
    cookie,
    body: { version: future.value.version },
  })
  assert.equal(early.response.status, 409)
  const noShow = await createReservation({
    accommodationTypeId: ids.unlimitedType,
    unitId: undefined,
    checkInDate: today,
    checkOutDate: tomorrow,
    acceptedTotalMinor: 2000,
    idempotencyKey: randomUUID(),
  })
  assert.equal(noShow.response.status, 201)
  const marked = await request(`/api/reservations/${noShow.value.id}/no-show`, {
    method: 'POST',
    origin: ORIGIN,
    cookie,
    body: { version: noShow.value.version },
  })
  assert.equal(marked.response.status, 201)
  assert.equal(marked.value.status, 'no_show')
})

test('unlimited reservations freeze the original rates across a later rate change', async () => {
  const created = await createReservation({
    accommodationTypeId: ids.unlimitedType,
    unitId: undefined,
    checkInDate: '2036-01-01',
    checkOutDate: '2036-01-04',
    adults: 2,
    acceptedTotalMinor: 6000,
    idempotencyKey: randomUUID(),
  })
  assert.equal(created.response.status, 201)
  assert.equal(created.value.priceSnapshot.rates.adults, 1000)
  const rates = await request('/api/camping/rates', {
    method: 'PATCH',
    origin: ORIGIN,
    cookie,
    body: { adults: 2000, children: 500, infants: 100 },
  })
  assert.equal(rates.response.status, 200)
  const edited = await request(`/api/reservations/${created.value.id}`, {
    method: 'PATCH',
    origin: ORIGIN,
    cookie,
    body: {
      version: created.value.version,
      checkOutDate: '2036-01-05',
      acceptedTotalMinor: 8000,
    },
  })
  assert.equal(edited.response.status, 200)
  assert.equal(edited.value.priceSnapshot.rates.adults, 1000)
  assert.equal(edited.value.priceSnapshot.totalMinor, 8000)
})

test('foreign reservation identifiers remain tenant isolated', async () => {
  const missing = await request(`/api/reservations/${randomUUID()}`, { cookie })
  assert.equal(missing.response.status, 404)
  const foreignQuote = await request('/api/reservations/quote', {
    method: 'POST',
    origin: ORIGIN,
    cookie,
    body: quoteBody({
      accommodationTypeId: ids.foreignType,
      unitId: randomUUID(),
    }),
  })
  assert.equal(foreignQuote.response.status, 404)
})

test('outbox failure rolls back reservation and audit atomically', async () => {
  await dataSource.query(`
    CREATE FUNCTION camping_private.fail_reservation_outbox()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.aggregate_type = 'Reservation' THEN
        RAISE EXCEPTION 'forced reservation outbox failure';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER fail_reservation_outbox
    BEFORE INSERT ON camping_private.outbox_events
    FOR EACH ROW EXECUTE FUNCTION camping_private.fail_reservation_outbox();
  `)
  const body = createBody({
    checkInDate: '2037-01-01',
    checkOutDate: '2037-01-02',
    acceptedTotalMinor: 1000,
    idempotencyKey: randomUUID(),
  })
  const failed = await request('/api/reservations', {
    method: 'POST',
    origin: ORIGIN,
    cookie,
    body,
  })
  assert.equal(failed.response.status, 500)
  const rows = await dataSource.query(
    `SELECT count(*)::int AS count FROM camping_private.reservations
     WHERE camping_id = $1 AND idempotency_key = $2`,
    [ids.camping, body.idempotencyKey],
  )
  assert.equal(rows[0].count, 0)
  await dataSource.query(
    'DROP TRIGGER fail_reservation_outbox ON camping_private.outbox_events',
  )
  await dataSource.query(
    'DROP FUNCTION camping_private.fail_reservation_outbox()',
  )
})

test('children overflow is advisory and infants do not consume capacity by default', async () => {
  await dataSource.query(
    'UPDATE camping_private.accommodation_units SET max_occupancy = 2 WHERE id = $1',
    [ids.unit],
  )
  const input = quoteBody({
    checkInDate: '2098-07-01',
    checkOutDate: '2098-07-03',
    adults: 2,
    children: 1,
    infants: 1,
  })
  const quote = await request('/api/reservations/quote', {
    method: 'POST',
    origin: ORIGIN,
    cookie,
    body: input,
  })
  assert.equal(quote.response.status, 201)
  assert.deepEqual(quote.value.occupancyWarning, { maxOccupancy: 2, people: 3 })
  const created = await createReservation({
    ...input,
    acceptedTotalMinor: quote.value.priceSnapshot.totalMinor,
  })
  assert.equal(created.response.status, 201)
  assert.equal(created.value.status, 'confirmed')
  const normal = await request('/api/reservations/quote', {
    method: 'POST',
    origin: ORIGIN,
    cookie,
    body: quoteBody({ checkInDate: '2098-08-01', checkOutDate: '2098-08-02' }),
  })
  assert.equal(normal.response.status, 201)
  assert.equal(normal.value.occupancyWarning, undefined)
})
