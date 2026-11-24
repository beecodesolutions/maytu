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
  for (const table of [
    'bed_occupancy',
    'reservation_beds',
    'accommodation_beds',
    'stays',
  ])
    await dataSource.query(
      `DELETE FROM camping_private.${table} WHERE camping_id=$1`,
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

const pricing = {
  basis: 'per_bed',
  rates: { adults: 0, children: 0, infants: 0 },
  extraPersonRates: { adults: 0, children: 0, infants: 0 },
  includedOccupancy: { adults: 0, children: 0, infants: 0 },
  petNightlyPriceMinor: 100,
  weekdays: [],
  discounts: [
    {
      blockNights: 7,
      repeat: true,
      benefit: { type: 'FIXED_PRICE', value: 1400 },
    },
  ],
}
const api = (path, body, method = 'POST') =>
  request(path, { cookie, origin: ORIGIN, method, body })
let sharedType, sharedUnit
const composition = {
  checkInDate: '2035-01-01',
  checkOutDate: '2035-01-08',
  adults: 2,
  children: 0,
  infants: 1,
  pets: 1,
}
test('admin creates shared room with stable beds and per-bed pricing', async () => {
  const type = await api('/api/accommodations/types', {
    name: 'Shared dorm',
    inventoryMode: 'shared',
    maxOccupancy: 3,
    baseNightlyPriceMinor: 250,
    enabled: true,
    pricing,
  })
  assert.equal(type.response.status, 201, JSON.stringify(type.value))
  sharedType = type.value.id
  const unit = await api('/api/accommodations/units', {
    typeId: sharedType,
    name: 'Dorm A',
    maxOccupancy: 3,
    enabled: true,
  })
  assert.equal(unit.response.status, 201)
  sharedUnit = unit.value.id
  for (let i = 0; i < 3; i++) {
    const bed = await api(`/api/accommodations/units/${sharedUnit}/beds`, {
      name: `Bed ${i + 1}`,
      position: i,
      enabled: true,
    })
    assert.equal(bed.response.status, 201, JSON.stringify(bed.value))
  }
  const beds = await request(`/api/accommodations/units/${sharedUnit}/beds`, {
    cookie,
  })
  assert.equal(beds.value.length, 3)
})
test('multiple beds quote, allocation, partial occupancy and pets', async () => {
  const result = await api('/api/reservations/search', composition)
  const offer = result.value.offers.find((o) => o.input.unitId === sharedUnit)
  assert.equal(offer.availableBeds, 3)
  assert.equal(offer.requestedBeds, 2)
  assert.equal(offer.capacityMatch, 'EXACT')
  assert.equal(offer.priceSnapshot.totalMinor, 3500)
  const booking = await api('/api/reservations', {
    ...offer.input,
    responsibleName: 'Bed guest',
    idempotencyKey: randomUUID(),
    acceptedTotalMinor: 3500,
  })
  assert.equal(booking.response.status, 201, JSON.stringify(booking.value))
  assert.equal(booking.value.allocatedBeds.length, 2)
  assert.equal(booking.value.pets, 1)
  const left = await api('/api/reservations/search', {
    ...composition,
    adults: 1,
  })
  const remaining = left.value.offers.find((o) => o.input.unitId === sharedUnit)
  assert.equal(remaining.availableBeds, 1)
  const unavailable = await api('/api/reservations/search', composition)
  assert.equal(
    unavailable.value.offers.some((o) => o.input.unitId === sharedUnit),
    false,
  )
  const bedId = booking.value.allocatedBeds[0].id
  const disable = await api(
    `/api/accommodations/units/${sharedUnit}/beds/${bedId}`,
    { name: 'Bed occupied', position: 0, enabled: false },
    'PATCH',
  )
  assert.equal(disable.response.status, 409)
  const racers = await Promise.all(
    [1, 2].map(() =>
      api('/api/reservations', {
        ...remaining.input,
        responsibleName: 'Race',
        idempotencyKey: randomUUID(),
        acceptedTotalMinor: remaining.priceSnapshot.totalMinor,
      }),
    ),
  )
  assert.deepEqual(racers.map((r) => r.response.status).sort(), [201, 409])
  const occupied = await dataSource.query(
    'SELECT bed_id,night,count(*) FROM camping_private.bed_occupancy WHERE camping_id=$1 GROUP BY bed_id,night HAVING count(*)>1',
    [ids.camping],
  )
  assert.equal(occupied.length, 0)
  const cancelled = await api(`/api/reservations/${booking.value.id}/cancel`, {
    version: 1,
  })
  assert.equal(cancelled.response.status, 201)
  const reopened = await api('/api/reservations/search', composition)
  assert.equal(
    reopened.value.offers.find((o) => o.input.unitId === sharedUnit)
      .availableBeds,
    2,
  )
})
test('search capacity filter defaults off; children overflow bypasses filter; oversized retained', async () => {
  const normal = {
    ...composition,
    adults: 2,
    infants: 0,
    pets: 50,
    checkInDate: '2037-01-01',
    checkOutDate: '2037-01-03',
  }
  const oversized = await api('/api/reservations/search', normal)
  assert.equal(
    oversized.value.offers.find((o) => o.input.unitId === ids.unit)
      .capacityMatch,
    'OVERSIZED',
  )
  const insufficient = await api('/api/reservations/search', {
    ...normal,
    adults: 5,
  })
  assert.equal(
    insufficient.value.offers.some((o) => o.input.unitId === ids.unit),
    false,
  )
  const included = await api('/api/reservations/search', {
    ...normal,
    adults: 5,
    includeInsufficientCapacity: true,
  })
  assert.equal(
    included.value.offers.find((o) => o.input.unitId === ids.unit)
      .capacityMatch,
    'INSUFFICIENT',
  )
  const children = await api('/api/reservations/search', {
    ...normal,
    adults: 4,
    children: 1,
  })
  const offer = children.value.offers.find((o) => o.input.unitId === ids.unit)
  assert.equal(offer.occupancyWarning.people, 5)
  const booked = await api('/api/reservations', {
    ...offer.input,
    responsibleName: 'Children overflow',
    idempotencyKey: randomUUID(),
    acceptedTotalMinor: offer.priceSnapshot.totalMinor,
  })
  assert.equal(booked.response.status, 201)
  const adultQuote = await api('/api/reservations/quote', {
    ...normal,
    adults: 5,
    accommodationTypeId: ids.type,
    unitId: ids.unit,
  })
  assert.equal(adultQuote.response.status, 409)
  const exception = await api('/api/reservations/quote', {
    ...normal,
    adults: 5,
    accommodationTypeId: ids.type,
    unitId: ids.unit,
    checkInDate: '2038-01-01',
    checkOutDate: '2038-01-03',
    capacityOverrideReason: 'Approved manual exception',
  })
  assert.equal(exception.response.status, 201)
})
test('infant occupancy is configurable and cannot overbook beds', async () => {
  const setting = await api(
    '/api/camping/occupancy-settings',
    { infantsConsumeCapacity: true },
    'PATCH',
  )
  assert.equal(setting.response.status, 200)
  const result = await api('/api/reservations/search', {
    ...composition,
    checkInDate: '2039-01-01',
    checkOutDate: '2039-01-08',
  })
  const offer = result.value.offers.find((o) => o.input.unitId === sharedUnit)
  assert.equal(offer.requestedBeds, 3)
  assert.equal(offer.priceSnapshot.totalMinor, 4900)
  const onlyInfants = await api('/api/reservations/search', {
    ...composition,
    adults: 0,
    children: 0,
    infants: 1,
  })
  assert.equal(
    onlyInfants.value.offers.some((o) => o.input.unitId === sharedUnit),
    false,
  )
})

test('shared check-in allows separate guests in one room; checkout retains pricing and releases beds', async () => {
  await api(
    '/api/camping/occupancy-settings',
    { infantsConsumeCapacity: false },
    'PATCH',
  )
  const today = new Date().toISOString().slice(0, 10)
  const start = new Date(`${today}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - 7)
  const input = {
    accommodationTypeId: sharedType,
    unitId: sharedUnit,
    checkInDate: start.toISOString().slice(0, 10),
    checkOutDate: today,
    adults: 1,
    children: 0,
    infants: 0,
    pets: 1,
  }
  const arrivals = []
  for (let index = 0; index < 2; index++) {
    const q = await api('/api/reservations/quote', input)
    assert.equal(q.response.status, 201, JSON.stringify(q.value))
    assert.equal(q.value.priceSnapshot.totalMinor, 2100)
    const booked = await api('/api/reservations', {
      ...input,
      responsibleName: `Arrival ${index}`,
      idempotencyKey: randomUUID(),
      acceptedTotalMinor: 2100,
    })
    assert.equal(booked.response.status, 201)
    const arrived = await api(`/api/reservations/${booked.value.id}/check-in`, {
      version: booked.value.version,
      arrivalDate: input.checkInDate,
      acceptedTotalMinor: 2100,
    })
    assert.equal(arrived.response.status, 201, JSON.stringify(arrived.value))
    arrivals.push(arrived.value)
  }
  assert.notEqual(
    arrivals[0].allocatedBeds[0].id,
    arrivals[1].allocatedBeds[0].id,
  )
  const stay = await request(`/api/stays/${arrivals[0].stayId}`, { cookie })
  assert.equal(stay.value.pets, 1)
  const extra = await api(`/api/stays/${stay.value.id}/extras`, {
    description: 'Firewood',
    category: 'Services',
    unitPriceMinor: 100,
    quantity: 1,
  })
  assert.equal(extra.response.status, 201)
  const q = await api(`/api/stays/${stay.value.id}/quote`, {
    departureDate: today,
  })
  assert.equal(q.value.accommodationMinor, 2100)
  assert.equal(q.value.extrasMinor, 100)
  assert.equal(q.value.totalMinor, 2200)
  const settled = await api(`/api/stays/${stay.value.id}/payments`, {
    amountMinor: 2200,
    method: 'cash',
    paidOn: today,
    idempotencyKey: randomUUID(),
  })
  assert.equal(settled.response.status, 201)
  const closed = await api(`/api/stays/${stay.value.id}/close`, {
    departureDate: today,
    version: settled.value.version,
  })
  assert.equal(closed.response.status, 201, JSON.stringify(closed.value))
  const occupied = await dataSource.query(
    'SELECT * FROM camping_private.bed_occupancy WHERE camping_id=$1 AND reservation_id=$2',
    [ids.camping, arrivals[0].id],
  )
  assert.equal(occupied.length, 0)
  const historical = await request(`/api/reservations/${arrivals[0].id}`, {
    cookie,
  })
  assert.equal(historical.value.allocatedBeds.length, 1)
})
test('database uniqueness rejects raw overlapping bed occupancy and rollback refuses data loss', async () => {
  const [existing] = await dataSource.query(
    'SELECT * FROM camping_private.bed_occupancy WHERE camping_id=$1 LIMIT 1',
    [ids.camping],
  )
  await assert.rejects(
    () =>
      dataSource.query(
        'INSERT INTO camping_private.bed_occupancy(camping_id,reservation_id,bed_id,night) VALUES($1,$2,$3,$4)',
        [
          existing.camping_id,
          existing.reservation_id,
          existing.bed_id,
          existing.night,
        ],
      ),
    (e) => e.code === '23505',
  )
  const {
    FlexiblePricingAndBeds1760000007000,
  } = require('../dist/database/migrations/1760000007000-FlexiblePricingAndBeds')
  const runner = dataSource.createQueryRunner()
  await runner.connect()
  await runner.startTransaction()
  try {
    await assert.rejects(
      () => new FlexiblePricingAndBeds1760000007000().down(runner),
      /Cannot downgrade/,
    )
  } finally {
    await runner.rollbackTransaction()
    await runner.release()
  }
})

test('editing a shared reservation moves allocations atomically and adjacent stays reuse beds', async () => {
  const unit = await api('/api/accommodations/units', {
    typeId: sharedType,
    name: 'Dorm B',
    maxOccupancy: 1,
    enabled: true,
  })
  assert.equal(unit.response.status, 201)
  const bed = await api(`/api/accommodations/units/${unit.value.id}/beds`, {
    name: 'Only bed',
    position: 0,
    enabled: true,
  })
  assert.equal(bed.response.status, 201)
  const input = {
    accommodationTypeId: sharedType,
    unitId: sharedUnit,
    checkInDate: '2040-01-01',
    checkOutDate: '2040-01-08',
    adults: 1,
    children: 0,
    infants: 0,
    pets: 0,
  }
  const original = await api('/api/reservations', {
    ...input,
    responsibleName: 'Moved',
    idempotencyKey: randomUUID(),
    acceptedTotalMinor: 1400,
  })
  assert.equal(original.response.status, 201)
  const moved = await api(
    `/api/reservations/${original.value.id}`,
    { version: 1, unitId: unit.value.id, acceptedTotalMinor: 1400 },
    'PATCH',
  )
  assert.equal(moved.response.status, 200, JSON.stringify(moved.value))
  assert.equal(moved.value.allocatedBeds[0].id, bed.value.id)
  const adjacent = await api('/api/reservations', {
    ...input,
    unitId: unit.value.id,
    checkInDate: '2040-01-08',
    checkOutDate: '2040-01-15',
    responsibleName: 'Adjacent',
    idempotencyKey: randomUUID(),
    acceptedTotalMinor: 1400,
  })
  assert.equal(adjacent.response.status, 201)
  const privateQuote = await api(
    `/api/reservations/${original.value.id}/quote`,
    {
      version: moved.value.version,
      accommodationTypeId: ids.type,
      unitId: ids.unit,
    },
  )
  assert.equal(privateQuote.response.status, 201)
  const privateBooking = await api(
    `/api/reservations/${original.value.id}`,
    {
      version: moved.value.version,
      accommodationTypeId: ids.type,
      unitId: ids.unit,
      acceptedTotalMinor: privateQuote.value.priceSnapshot.totalMinor,
    },
    'PATCH',
  )
  assert.equal(
    privateBooking.response.status,
    200,
    JSON.stringify(privateBooking.value),
  )
  assert.equal(privateBooking.value.allocatedBeds.length, 0)
  const occupied = await dataSource.query(
    'SELECT * FROM camping_private.bed_occupancy WHERE camping_id=$1 AND reservation_id=$2',
    [ids.camping, original.value.id],
  )
  assert.equal(occupied.length, 0)
})

test('shared availability returns per-night bed inventory without multiplying rooms', async () => {
  const result = await request(
    `/api/availability?checkInDate=2035-01-01&checkOutDate=2035-01-08&typeId=${sharedType}`,
    { cookie },
  )
  assert.equal(result.response.status, 200)
  const unit = result.value.types[0].units.find((u) => u.unitId === sharedUnit)
  assert.equal(unit.availableBeds, 2)
  assert.equal(unit.nights.length, 7)
  for (const night of unit.nights) {
    assert.equal(night.totalBeds, 3)
    assert.equal(night.availableBeds, 2)
    assert.equal(night.reservedBeds, 1)
    assert.equal(night.blockedBeds, 0)
  }
})
