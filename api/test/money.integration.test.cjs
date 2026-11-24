const assert = require('node:assert/strict')
const { before, after, test } = require('node:test')
const { randomUUID } = require('node:crypto')
const argon2 = require('argon2')
process.env.NODE_ENV = 'test'
process.env.DB_SCHEMA = 'camping_private'
process.env.DB_PORT ??= '5434'
process.env.DB_NAME ??= 'camping_test'
process.env.ALLOWED_ORIGIN = 'http://localhost:5173'
process.env.REQUIRE_ORIGIN = 'true'
assert.equal(
  process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL).pathname.slice(1)
    : process.env.DB_NAME,
  'camping_test',
)
const { createDataSource } = require('../dist/database/data-source')
const { createNestApp } = require('../dist/main')
const { CampingEntity } = require('../dist/database/entities/camping.entity')
const { UserEntity } = require('../dist/database/entities/user.entity')
const { StayEntity } = require('../dist/database/entities/stay.entity')
const {
  AccommodationTypeEntity,
} = require('../dist/database/entities/accommodation-type.entity')
const {
  AccommodationUnitEntity,
} = require('../dist/database/entities/accommodation-unit.entity')
const id = randomUUID(),
  foreignId = randomUUID(),
  userId = randomUUID()
const username = `money-${id}`
const ageRanges = {
  infants: { min: 0, max: 5 },
  children: { min: 6, max: 17 },
  adults: { min: 18, max: null },
}
const today = new Date().toISOString().slice(0, 10)
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
let db, app, base, cookie, wholeStay, centsStay
async function request(
  path,
  body,
  method = body === undefined ? 'GET' : 'POST',
) {
  const response = await fetch(base + '/api' + path, {
    method,
    headers: {
      origin: process.env.ALLOWED_ORIGIN,
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  return {
    status: response.status,
    value: text ? JSON.parse(text) : null,
    headers: response.headers,
  }
}
async function setting(value) {
  const result = await request(
    '/camping/money-settings',
    { moneyDecimals: value },
    'PATCH',
  )
  assert.equal(result.status, 200, JSON.stringify(result.value))
  return result.value
}
async function createStay() {
  const result = await request('/stays', {
    responsibleName: 'Money test',
    document: '',
    nationality: '',
    phone: '',
    arrivalDate: today,
    estimatedDeparture: '',
    adults: 1,
    children: 0,
    infants: 0,
    hasVehicle: false,
    vehicleDescription: '',
    licensePlate: '',
    location: '',
  })
  assert.equal(result.status, 201, JSON.stringify(result.value))
  return (await request('/stays/' + result.value.id)).value
}
before(async () => {
  db = createDataSource()
  await db.initialize()
  await db.runMigrations()
  for (const campingId of [id, foreignId])
    await db.getRepository(CampingEntity).save({
      id: campingId,
      stableKey: `money-${campingId}`,
      name: 'Money test',
      country: 'MX',
      currency: 'MXN',
      timezone: 'UTC',
      ageRanges,
      rates: { adults: 120050, children: 0, infants: 0 },
    })
  await db.getRepository(UserEntity).save({
    id: userId,
    campingId: id,
    username,
    name: 'Money tester',
    passwordHash: await argon2.hash('test-only-money-password'),
    enabled: true,
    passwordChangedAt: new Date(),
  })
  app = await createNestApp()
  app.useLogger(false)
  await app.listen(0, '127.0.0.1')
  base = `http://127.0.0.1:${app.getHttpServer().address().port}`
  const login = await request('/auth/login', {
    username,
    password: 'test-only-money-password',
  })
  assert.equal(login.status, 201)
  cookie = login.headers.get('set-cookie').split(';')[0]
})
after(async () => {
  if (app) await app.close()
  if (db?.isInitialized) await db.destroy()
})
test('default zero decimals rounds a new stay exactly once and exposes its adjustment', async () => {
  assert.equal((await request('/camping')).value.moneyDecimals, 0)
  wholeStay = await createStay()
  assert.equal(wholeStay.moneyDecimals, 0)
  assert.equal(wholeStay.account.totalMinor, 120100)
  const quote = await request('/stays/' + wholeStay.id + '/quote', {
    departureDate: today,
  })
  assert.equal(quote.value.accommodationMinor, 120050)
  assert.equal(quote.value.roundingMinor, 50)
  assert.equal(quote.value.totalMinor, 120100)
})
test('settings are strict, tenant scoped, audited, and do not rewrite existing prices', async () => {
  assert.equal(
    (await request('/camping/money-settings', { moneyDecimals: 2 }, 'PATCH'))
      .status,
    400,
  )
  assert.equal(
    (
      await request(
        '/camping/money-settings',
        { moneyDecimals: null, campingId: foreignId },
        'PATCH',
      )
    ).status,
    400,
  )
  await setting(null)
  centsStay = await createStay()
  assert.equal(centsStay.account.totalMinor, 120050)
  assert.equal(centsStay.moneyDecimals, null)
  await setting(0)
  assert.equal(
    (await request('/stays/' + centsStay.id)).value.account.totalMinor,
    120050,
  )
  assert.equal(
    (await request('/stays/' + wholeStay.id)).value.account.totalMinor,
    120100,
  )
  assert.equal(
    (await db.getRepository(CampingEntity).findOneByOrFail({ id: foreignId }))
      .moneyDecimals,
    0,
  )
  const [audit] = await db.query(
    "SELECT count(*)::int AS count FROM camping_private.audit_logs WHERE camping_id=$1 AND action='camping.money_settings_updated'",
    [id],
  )
  assert.equal(audit.count, 2)
})
test('new whole-unit records reject fractional prices/payments; old precision still accepts exact cents', async () => {
  const payment = {
    amountMinor: 50,
    method: 'cash',
    paidOn: today,
    note: '',
    idempotencyKey: randomUUID(),
  }
  assert.equal(
    (await request('/stays/' + wholeStay.id + '/payments', payment)).status,
    400,
  )
  assert.equal(
    (await request('/stays/' + centsStay.id + '/payments', payment)).status,
    201,
  )
  assert.equal(
    (
      await request('/extra-templates', {
        description: 'Fraction',
        category: '',
        unitPriceMinor: 50,
      })
    ).status,
    400,
  )
  assert.equal(
    (
      await request(
        '/camping/rates',
        { adults: 120051, children: 0, infants: 0 },
        'PATCH',
      )
    ).status,
    400,
  )
  // Simulate a pre-migration stay: NULL must retain the original exact account.
  await db
    .getRepository(StayEntity)
    .update(wholeStay.id, { moneyDecimals: null })
  assert.equal(
    (await request('/stays/' + wholeStay.id)).value.account.totalMinor,
    120050,
  )
})
test('reservation and linked stay retain the accepted rounding policy across configuration changes', async () => {
  const type = await db.getRepository(AccommodationTypeEntity).save({
    campingId: id,
    name: 'Existing fractional tariff',
    inventoryMode: 'individual',
    maxOccupancy: 2,
    baseNightlyPriceMinor: 120050,
    enabled: true,
  })
  const unit = await db.getRepository(AccommodationUnitEntity).save({
    campingId: id,
    typeId: type.id,
    maxOccupancy: 2,
    name: 'Unit',
    enabled: true,
  })
  const input = {
    accommodationTypeId: type.id,
    unitId: unit.id,
    checkInDate: today,
    checkOutDate: tomorrow,
    adults: 1,
    children: 0,
    infants: 0,
  }
  const quoted = await request('/reservations/quote', input)
  assert.equal(quoted.status, 201, JSON.stringify(quoted.value))
  assert.equal(quoted.value.priceSnapshot.totalMinor, 120100)
  const created = await request('/reservations', {
    ...input,
    responsibleName: 'Reservation money',
    idempotencyKey: randomUUID(),
    acceptedTotalMinor: 120100,
  })
  assert.equal(created.status, 201, JSON.stringify(created.value))
  const reservation = created.value
  await setting(null)
  const quote = await request(
    '/reservations/' + reservation.id + '/check-in/quote',
    { version: reservation.version, arrivalDate: today },
  )
  assert.equal(quote.value.priceSnapshot.totalMinor, 120100)
  assert.equal(quote.value.priceSnapshot.moneyDecimals, 0)
  const checked = await request(
    '/reservations/' + reservation.id + '/check-in',
    {
      version: reservation.version,
      arrivalDate: today,
      acceptedTotalMinor: 120100,
    },
  )
  assert.equal(checked.status, 201, JSON.stringify(checked.value))
  const stay = (await request('/stays/' + checked.value.stayId)).value
  assert.equal(stay.moneyDecimals, 0)
  assert.equal(stay.account.totalMinor, 120100)
})
