const assert = require('node:assert/strict')
const { test, before, after } = require('node:test')
const { randomUUID } = require('node:crypto')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const path = require('node:path')
process.env.NODE_ENV = 'test'
process.env.DB_NAME = 'camping_test'
process.env.DB_PORT ??= '15434'
process.env.DB_POOL_MAX = '2'
assert.equal(
  process.env.DATABASE_ADMIN_URL
    ? new URL(process.env.DATABASE_ADMIN_URL).pathname.slice(1)
    : process.env.DATABASE_URL
      ? new URL(process.env.DATABASE_URL).pathname.slice(1)
      : process.env.DB_NAME,
  'camping_test',
)
const { DataSource } = require('typeorm')
const { createDataSource } = require('../dist/database/data-source')
const { CampingEntity } = require('../dist/database/entities/camping.entity')
const { UserEntity } = require('../dist/database/entities/user.entity')
const {
  AccommodationsService,
} = require('../dist/accommodations/accommodations.service')
const {
  AvailabilityService,
} = require('../dist/accommodations/availability.service')
const {
  ReservationService,
} = require('../dist/reservations/reservation.service')
const { CampingService } = require('../dist/camping/camping.service')
const { StayService } = require('../dist/stays/stay.service')
const role = `pricing_runtime_${randomUUID().replaceAll('-', '')}`
let admin, runtime, context, types, bookings, campingId
const pricing = {
  basis: 'per_bed',
  rates: { adults: 0, children: 0, infants: 0 },
  extraPersonRates: { adults: 0, children: 0, infants: 0 },
  includedOccupancy: { adults: 0, children: 0, infants: 0 },
  petNightlyPriceMinor: 10000,
  weekdays: [],
  discounts: [],
}
before(async () => {
  admin = createDataSource()
  await admin.initialize()
  await admin.query('CREATE SCHEMA IF NOT EXISTS camping_private')
  await admin.runMigrations()
  await admin.query(`CREATE ROLE ${role} NOLOGIN`)
  await promisify(execFile)(
    process.execPath,
    [
      path.join(__dirname, '../dist/cli/provision-runtime-role.js'),
      `--role=${role}`,
    ],
    {
      env: {
        ...process.env,
        DATABASE_ADMIN_URL: process.env.DATABASE_URL ?? '',
        NODE_ENV: 'test',
      },
      timeout: 10000,
    },
  )
  const camping = await admin.getRepository(CampingEntity).save({
    stableKey: `runtime-${randomUUID()}`,
    name: 'Runtime pricing test',
    country: 'MX',
    currency: 'MXN',
    timezone: 'America/Mexico_City',
    ageRanges: {
      adults: { min: 18, max: null },
      children: { min: 4, max: 17 },
      infants: { min: 0, max: 3 },
    },
    rates: { adults: 25000, children: 25000, infants: 0 },
  })
  campingId = camping.id
  const user = await admin.getRepository(UserEntity).save({
    campingId,
    username: `runtime-${randomUUID()}`,
    name: 'Runtime test',
    passwordHash: 'not-a-login',
    enabled: true,
  })
  context = { camping, user }
  runtime = new DataSource({
    ...createDataSource().options,
    extra: { max: 2, options: `-c role=${role}` },
  })
  await runtime.initialize()
  const [identity] = await runtime.query('SELECT current_user')
  assert.equal(identity.current_user, role)
  types = new AccommodationsService(runtime)
  bookings = new ReservationService(runtime, new AvailabilityService(runtime))
})
after(async () => {
  if (runtime?.isInitialized) await runtime.destroy()
  if (admin?.isInitialized) {
    if (campingId) {
      for (const table of [
        'bed_occupancy',
        'reservation_beds',
        'payments',
        'stays',
        'reservations',
        'accommodation_beds',
        'accommodation_blocks',
        'accommodation_units',
        'accommodation_types',
        'outbox_events',
        'audit_logs',
        'users',
      ])
        await admin.query(
          `DELETE FROM camping_private.${table} WHERE camping_id=$1`,
          [campingId],
        )
      await admin.query('DELETE FROM camping_private.campings WHERE id=$1', [
        campingId,
      ])
    }
    await admin.query(`DROP OWNED BY ${role}`)
    await admin.query(`DROP ROLE ${role}`)
    await admin.destroy()
  }
})
test('runtime provisioning grants only the required bed and configuration privileges', async () => {
  const [p] = await admin.query(
    `SELECT has_table_privilege($1,'camping_private.accommodation_beds','SELECT,INSERT,UPDATE') AS beds,has_table_privilege($1,'camping_private.accommodation_beds','DELETE') AS delete_beds,has_table_privilege($1,'camping_private.reservation_beds','SELECT,INSERT,DELETE') AS allocations,has_table_privilege($1,'camping_private.bed_occupancy','SELECT,INSERT,DELETE') AS occupancy,has_table_privilege($1,'camping_private.bed_occupancy','UPDATE') AS update_occupancy,has_column_privilege($1,'camping_private.campings','infants_consume_capacity','UPDATE') AS infants,has_column_privilege($1,'camping_private.accommodation_types','pricing','UPDATE') AS pricing,has_column_privilege($1,'camping_private.campings','stable_key','UPDATE') AS stable_key`,
    [role],
  )
  assert.deepEqual(p, {
    beds: true,
    delete_beds: false,
    allocations: true,
    occupancy: true,
    update_occupancy: false,
    infants: true,
    pricing: true,
    stable_key: false,
  })
  await assert.rejects(
    () =>
      runtime.query(
        'DELETE FROM camping_private.accommodation_beds WHERE false',
      ),
    (e) => e.code === '42501',
  )
})
test('restricted runtime supports pricing settings, allocation, edits and cancellation trigger', async () => {
  const stayService = new StayService(runtime)
  const campingService = new CampingService(runtime, stayService)
  const expected = {
    name: context.camping.name,
    timezone: context.camping.timezone,
  }
  const next = { name: 'Maytu runtime', timezone: 'America/Managua' }
  const updated = await campingService.updateProfile(context, {
    ...next,
    expected,
  })
  assert.equal(updated.name, next.name)
  assert.equal(updated.timezone, next.timezone)
  assert.equal(updated.currency, context.camping.currency)
  await assert.rejects(
    campingService.updateProfile(context, {
      ...next,
      name: 'Conflicting edit',
      expected,
    }),
    {
      response: {
        code: 'STALE_CAMPING_PROFILE',
        message: 'La configuración cambió. Revisa los datos actuales.',
      },
    },
  )
  await assert.rejects(
    campingService.updateProfile(context, {
      ...next,
      timezone: 'Mars/Olympus',
      expected: next,
    }),
    { status: 400 },
  )
  await assert.rejects(
    campingService.updateProfile(context, {
      ...next,
      currency: 'USD',
      expected: next,
    }),
    { status: 400 },
  )
  await campingService.updateProfile(context, { ...expected, expected: next })
  await campingService.updateOccupancySettings(context, {
    infantsConsumeCapacity: false,
  })
  const previousAges = context.camping.ageRanges
  const campingType = await types.createType(context, {
    name: 'Runtime camping',
    inventoryMode: 'unlimited',
    maxOccupancy: null,
    baseNightlyPriceMinor: 0,
    enabled: true,
  })
  const reservationInput = {
    accommodationTypeId: campingType.id,
    checkInDate: '2035-02-01',
    checkOutDate: '2035-02-02',
    adults: 1,
    children: 0,
    infants: 0,
  }
  const initialQuote = await bookings.quote(context, reservationInput)
  const reservation = await bookings.create(context, {
    ...reservationInput,
    responsibleName: 'Guest with frozen rates',
    idempotencyKey: randomUUID(),
    acceptedTotalMinor: initialQuote.priceSnapshot.totalMinor,
  })
  const stayInput = {
    responsibleName: 'Guest with frozen ages',
    document: '',
    nationality: '',
    phone: '',
    arrivalDate: '2025-01-01',
    estimatedDeparture: '',
    adults: 1,
    children: 0,
    infants: 0,
    hasVehicle: false,
    vehicleDescription: '',
    licensePlate: '',
    location: '',
  }
  const { id: stayId } = await stayService.create(context, stayInput)
  const openStay = await stayService.get(context, stayId)
  await assert.rejects(
    campingService.updateProfile(context, { ...next, expected }),
    (error) => error.getResponse().code === 'ACTIVE_STAYS',
  )
  const ageRanges = {
    infants: { min: 0, max: 2 },
    children: { min: 3, max: 11 },
    adults: { min: 12, max: null },
  }
  const profile = await campingService.updateOccupancySettings(context, {
    ageRanges,
    expectedAgeRanges: previousAges,
  })
  assert.deepEqual(profile.ageRanges, ageRanges)
  assert.equal(profile.infantsConsumeCapacity, false)
  await assert.rejects(
    campingService.updateOccupancySettings(context, {
      ageRanges: previousAges,
      expectedAgeRanges: previousAges,
    }),
    (error) => error.getResponse().code === 'STALE_AGE_RANGES',
  )
  const newQuote = await bookings.quote(context, reservationInput)
  assert.deepEqual(newQuote.priceSnapshot.ageRanges, ageRanges)
  assert.deepEqual(
    (await bookings.get(context, reservation.id)).priceSnapshot,
    reservation.priceSnapshot,
  )
  assert.deepEqual(
    (await stayService.get(context, stayId)).ageRanges,
    previousAges,
  )
  const closed = await stayService.close(context, stayId, {
    version: openStay.version,
    departureDate: '2025-01-02',
    payment: {
      amountMinor: openStay.rates.adults,
      paidOn: '2025-01-02',
      method: 'cash',
      idempotencyKey: randomUUID(),
    },
  })
  await campingService.updateProfile(context, { ...next, expected })
  const historical = await stayService.get(context, stayId)
  assert.deepEqual(historical.closure, closed.closure)
  assert.deepEqual(historical.account, closed.account)
  assert.deepEqual(
    (await bookings.get(context, reservation.id)).priceSnapshot,
    reservation.priceSnapshot,
  )
  const { id: newStayId } = await stayService.create(context, stayInput)
  assert.deepEqual(
    (await stayService.get(context, newStayId)).ageRanges,
    ageRanges,
  )
  await campingService.updateOccupancySettings(context, {
    ageRanges: previousAges,
    expectedAgeRanges: ageRanges,
  })
  const type = await types.createType(context, {
    name: 'Runtime dorm',
    inventoryMode: 'shared',
    maxOccupancy: 2,
    baseNightlyPriceMinor: 25000,
    enabled: true,
    pricing,
  })
  await types.updateType(context, type.id, {
    pricing: { ...pricing, petNightlyPriceMinor: 5000 },
  })
  const unit = await types.createUnit(context, {
    typeId: type.id,
    name: 'Runtime room',
    maxOccupancy: 2,
    enabled: true,
  })
  await types.saveBed(context, unit.id, {
    name: 'Bed 1',
    position: 0,
    enabled: true,
  })
  await types.saveBed(context, unit.id, {
    name: 'Bed 2',
    position: 1,
    enabled: true,
  })
  const input = {
    accommodationTypeId: type.id,
    unitId: unit.id,
    checkInDate: '2035-01-01',
    checkOutDate: '2035-01-03',
    adults: 1,
    children: 0,
    infants: 1,
    pets: 1,
  }
  const quote = await bookings.quote(context, input)
  assert.equal(quote.priceSnapshot.totalMinor, 60000)
  const created = await bookings.create(context, {
    ...input,
    responsibleName: 'Runtime guest',
    idempotencyKey: randomUUID(),
    acceptedTotalMinor: 60000,
  })
  assert.equal(created.allocatedBeds.length, 1)
  const edited = await bookings.update(context, created.id, {
    version: 1,
    adults: 2,
    acceptedTotalMinor: 110000,
  })
  assert.equal(edited.allocatedBeds.length, 2)
  const cancelled = await bookings.command(context, created.id, 'cancel', {
    version: edited.version,
  })
  assert.equal(cancelled.status, 'cancelled')
  const rows = await runtime.query(
    'SELECT * FROM camping_private.bed_occupancy WHERE camping_id=$1 AND reservation_id=$2',
    [campingId, created.id],
  )
  assert.equal(rows.length, 0)
})
