const assert = require('node:assert/strict')
const { after, before, test } = require('node:test')
const { randomUUID } = require('node:crypto')

process.env.NODE_ENV = 'test'
process.env.DB_SCHEMA = 'camping_private'
process.env.DB_HOST ??= 'localhost'
process.env.DB_PORT ??= '5434'
process.env.DB_USER ??= 'camping'
process.env.DB_PASSWORD ??= 'camping-local-only'
process.env.DB_NAME ??= 'camping_test'

const { createDataSource } = require('../dist/database/data-source')
const {
  InitialSchema1760000000000,
} = require('../dist/database/migrations/1760000000000-InitialSchema')
const {
  AddPayments1760000001000,
} = require('../dist/database/migrations/1760000001000-AddPayments')
const {
  AccommodationPersistence1760000002000,
} = require('../dist/database/migrations/1760000002000-AccommodationPersistence')
const {
  ReservationCreationHash1760000003000,
} = require('../dist/database/migrations/1760000003000-ReservationCreationHash')
const {
  ReservationStayPricing1760000004000,
} = require('../dist/database/migrations/1760000004000-ReservationStayPricing')
const {
  MoneyPrecision1760000005000,
} = require('../dist/database/migrations/1760000005000-MoneyPrecision')
const { CampingEntity } = require('../dist/database/entities/camping.entity')
const {
  AccommodationTypeEntity,
} = require('../dist/database/entities/accommodation-type.entity')
const {
  AccommodationUnitEntity,
} = require('../dist/database/entities/accommodation-unit.entity')
const {
  AccommodationBlockEntity,
} = require('../dist/database/entities/accommodation-block.entity')
const {
  ReservationEntity,
} = require('../dist/database/entities/reservation.entity')
const {
  OutboxEventEntity,
} = require('../dist/database/entities/outbox-event.entity')
const { AuditLogEntity } = require('../dist/database/entities/audit-log.entity')
const { StayEntity } = require('../dist/database/entities/stay.entity')
const { PaymentEntity } = require('../dist/database/entities/payment.entity')

const ids = {
  campingA: randomUUID(),
  campingB: randomUUID(),
  userA: randomUUID(),
  userB: randomUUID(),
  stay: randomUUID(),
  payment: randomUUID(),
  linkedPayment: randomUUID(),
  typeA: randomUUID(),
  typeB: randomUUID(),
  typeUnlimited: randomUUID(),
  unitA: randomUUID(),
  unitB: randomUUID(),
  reservationA: randomUUID(),
  reservationB: randomUUID(),
  reservationUnlimited: randomUUID(),
  legacyKey: `persistence-test-${randomUUID()}`,
}

const ageRanges = {
  infants: { min: 0, max: 5 },
  children: { min: 6, max: 17 },
  adults: { min: 18, max: null },
}

let dataSource

before(async () => {
  const database = process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL).pathname.slice(1)
    : process.env.DB_NAME
  assert.equal(
    database,
    'camping_test',
    'migration tests refuse non-test databases',
  )
  dataSource = createDataSource()
  await dataSource.initialize()
  await dataSource.query('DROP SCHEMA IF EXISTS camping_private CASCADE')
  const runner = dataSource.createQueryRunner()
  await runner.connect()
  await runner.startTransaction()
  const execute = (query, parameters) => runner.query(query, parameters)
  await new InitialSchema1760000000000().up(runner)
  await new AddPayments1760000001000().up(runner)
  await execute(
    `INSERT INTO camping_private.campings
      (id, stable_key, name, country, currency, timezone, age_ranges, rates)
     VALUES ($1, $2, 'Persistence A', 'CL', 'CLP', 'UTC', $3, $4),
            ($5, $6, 'Persistence B', 'CL', 'CLP', 'UTC', $3, $4)`,
    [
      ids.campingA,
      ids.legacyKey,
      ageRanges,
      { adults: 1000, children: 500, infants: 0 },
      ids.campingB,
      `${ids.legacyKey}-b`,
    ],
  )
  await execute(
    `INSERT INTO camping_private.users
      (id, camping_id, username, name, password_hash)
     VALUES ($1, $2, $3, 'Persistence A', 'test-hash'),
            ($4, $5, $6, 'Persistence B', 'test-hash')`,
    [
      ids.userA,
      ids.campingA,
      `${ids.legacyKey}-a`,
      ids.userB,
      ids.campingB,
      `${ids.legacyKey}-b-user`,
    ],
  )
  await execute(
    `INSERT INTO camping_private.stays
      (id, camping_id, created_by_id, responsible_name, arrival_date,
       adults, children, infants, currency, age_ranges, rates, closed_at,
       closed_by_id, closure)
     VALUES ($1, $2, $3, 'Legacy guest', '2026-10-01', 1, 0, 0, 'CLP', $4, $5,
       '2026-10-02T12:00:00Z', $3, $6)`,
    [
      ids.stay,
      ids.campingA,
      ids.userA,
      ageRanges,
      { adults: 1000, children: 500, infants: 0 },
      {
        departureDate: '2026-10-02',
        nights: 1,
        accommodationMinor: 1000,
        extrasMinor: 0,
        totalMinor: 1000,
        version: 1,
        closedAt: '2026-10-02T12:00:00Z',
        closedBy: ids.userA,
      },
    ],
  )
  await execute(
    `INSERT INTO camping_private.payments
      (id, camping_id, stay_id, amount_minor, method, paid_on,
       recorded_by_id, idempotency_key)
     VALUES ($1, $2, $3, 1000, 'cash', '2026-10-02', $4, $5)`,
    [ids.payment, ids.campingA, ids.stay, ids.userA, randomUUID()],
  )
  await new AccommodationPersistence1760000002000().up(runner)
  await new ReservationCreationHash1760000003000().up(runner)
  await new ReservationStayPricing1760000004000().up(runner)
  await new MoneyPrecision1760000005000().up(runner)
  await execute(`
    CREATE TABLE camping_private.camping_migrations (
      id SERIAL PRIMARY KEY,
      timestamp bigint NOT NULL,
      name varchar NOT NULL
    )
  `)
  await execute(
    `INSERT INTO camping_private.camping_migrations (timestamp, name)
     VALUES (1760000000000, $1), (1760000001000, $2), (1760000002000, $3), (1760000003000, $4), (1760000004000, $5), (1760000005000, $6)`,
    [
      'InitialSchema1760000000000',
      'AddPayments1760000001000',
      'AccommodationPersistence1760000002000',
      'ReservationCreationHash1760000003000',
      'ReservationStayPricing1760000004000',
      'MoneyPrecision1760000005000',
    ],
  )
  await runner.commitTransaction()
  await runner.release()
  await dataSource.query(
    `INSERT INTO camping_private.accommodation_types
      (id, camping_id, name, inventory_mode, max_occupancy,
       base_nightly_price_minor)
     VALUES ($1, $2, 'Cabin A', 'individual', 4, 1000),
            ($3, $4, 'Cabin B', 'individual', 4, 1000),
            ($5, $2, 'Open field', 'unlimited', NULL, 500)`,
    [ids.typeA, ids.campingA, ids.typeB, ids.campingB, ids.typeUnlimited],
  )
  await dataSource.query(
    `INSERT INTO camping_private.accommodation_units
      (id, camping_id, accommodation_type_id, name)
     VALUES ($1, $2, $3, 'A-1'), ($4, $5, $6, 'B-1')`,
    [ids.unitA, ids.campingA, ids.typeA, ids.unitB, ids.campingB, ids.typeB],
  )
  await dataSource.runMigrations({ transaction: 'all' })
})

after(async () => {
  if (!dataSource?.isInitialized) return
  const campings = [ids.campingA, ids.campingB]
  await dataSource.query(
    `DELETE FROM camping_private.payments WHERE camping_id = ANY($1::uuid[])`,
    [campings],
  )
  await dataSource.query(
    `DELETE FROM camping_private.stays WHERE camping_id = ANY($1::uuid[])`,
    [campings],
  )
  await dataSource.query(
    `DELETE FROM camping_private.reservations WHERE camping_id = ANY($1::uuid[])`,
    [campings],
  )
  await dataSource.query(
    `DELETE FROM camping_private.accommodation_blocks WHERE camping_id = ANY($1::uuid[])`,
    [campings],
  )
  await dataSource.query(
    `DELETE FROM camping_private.outbox_events WHERE camping_id = ANY($1::uuid[])`,
    [campings],
  )
  await dataSource.query(
    `DELETE FROM camping_private.audit_logs WHERE camping_id = ANY($1::uuid[])`,
    [campings],
  )
  await dataSource.query(
    `DELETE FROM camping_private.accommodation_units WHERE camping_id = ANY($1::uuid[])`,
    [campings],
  )
  await dataSource.query(
    `DELETE FROM camping_private.accommodation_types WHERE camping_id = ANY($1::uuid[])`,
    [campings],
  )
  await dataSource.query(
    `DELETE FROM camping_private.users WHERE camping_id = ANY($1::uuid[])`,
    [campings],
  )
  await dataSource.query(
    `DELETE FROM camping_private.campings WHERE id = ANY($1::uuid[])`,
    [campings],
  )
  await dataSource.destroy()
})

test('persistence migration preserves legacy closure and payment data', async () => {
  const [stay] = await dataSource.query(
    `SELECT closed_at, closure FROM camping_private.stays WHERE id = $1`,
    [ids.stay],
  )
  const [payment] = await dataSource.query(
    `SELECT stay_id, reservation_id, amount_minor FROM camping_private.payments WHERE id = $1`,
    [ids.payment],
  )
  assert.equal(stay.closed_at.toISOString(), '2026-10-02T12:00:00.000Z')
  assert.equal(stay.closure.totalMinor, 1000)
  assert.equal(payment.stay_id, ids.stay)
  assert.equal(payment.reservation_id, null)
  assert.equal(payment.amount_minor, '1000')
})

test('tenant composite foreign keys reject cross-camping reservation links', async () => {
  const price = {
    basis: 'per_unit',
    currency: 'CLP',
    baseNightlyPriceMinor: 1000,
    nights: 1,
    totalMinor: 1000,
  }
  const reservationValues = [
    ids.reservationA,
    ids.campingA,
    ids.typeA,
    ids.unitA,
    '2026-11-01',
    '2026-11-02',
    price,
    randomUUID(),
  ]
  await dataSource.query(
    `INSERT INTO camping_private.reservations
      (id, camping_id, accommodation_type_id, unit_id, responsible_name,
       check_in_date, check_out_date, adults, children, infants, price_snapshot,
       idempotency_key)
     VALUES ($1, $2, $3, $4, 'Guest A', $5, $6, 1, 0, 0, $7, $8)`,
    reservationValues,
  )

  await dataSource.query(
    `INSERT INTO camping_private.reservations
      (id, camping_id, accommodation_type_id, responsible_name,
       check_in_date, check_out_date, adults, children, infants, price_snapshot,
       idempotency_key)
     VALUES ($1, $2, $3, 'Unlimited guest', $4, $5, 1, 0, 0, $6, $7)`,
    [
      ids.reservationUnlimited,
      ids.campingA,
      ids.typeUnlimited,
      '2026-11-01',
      '2026-11-02',
      price,
      randomUUID(),
    ],
  )

  await assert.rejects(
    dataSource.query(
      `INSERT INTO camping_private.reservations
        (id, camping_id, accommodation_type_id, responsible_name,
         check_in_date, check_out_date, adults, children, infants, price_snapshot,
         idempotency_key)
       VALUES ($1, $2, $3, 'Missing snapshot fields', $4, $5, 1, 0, 0, $6, $7)`,
      [
        randomUUID(),
        ids.campingA,
        ids.typeUnlimited,
        '2026-11-01',
        '2026-11-02',
        { basis: 'per_unit', currency: 'CLP', totalMinor: 1000 },
        randomUUID(),
      ],
    ),
  )

  await assert.rejects(
    dataSource.query(
      `INSERT INTO camping_private.reservations
        (id, camping_id, accommodation_type_id, responsible_name,
         check_in_date, check_out_date, adults, children, infants, price_snapshot,
         idempotency_key)
       VALUES ($1, $2, $3, 'Incomplete adjustment', $4, $5, 1, 0, 0, $6, $7)`,
      [
        randomUUID(),
        ids.campingA,
        ids.typeUnlimited,
        '2026-11-01',
        '2026-11-02',
        {
          basis: 'per_unit',
          currency: 'CLP',
          baseNightlyPriceMinor: 1000,
          nights: 1,
          adjustmentMinor: 100,
          totalMinor: 1100,
        },
        randomUUID(),
      ],
    ),
  )

  await assert.rejects(
    dataSource.query(
      `INSERT INTO camping_private.reservations
        (id, camping_id, accommodation_type_id, responsible_name,
         check_in_date, check_out_date, adults, children, infants, price_snapshot,
         idempotency_key)
       VALUES ($1, $2, $3, 'Missing unit', $4, $5, 1, 0, 0, $6, $7)`,
      [
        randomUUID(),
        ids.campingA,
        ids.typeA,
        '2026-11-01',
        '2026-11-02',
        price,
        randomUUID(),
      ],
    ),
  )

  await assert.rejects(
    dataSource.query(
      `INSERT INTO camping_private.reservations
        (id, camping_id, accommodation_type_id, unit_id, responsible_name,
         check_in_date, check_out_date, adults, children, infants, price_snapshot,
         idempotency_key)
       VALUES ($1, $2, $3, $4, 'Foreign type', $5, $6, 1, 0, 0, $7, $8)`,
      [
        ids.reservationB,
        ids.campingA,
        ids.typeB,
        ids.unitB,
        '2026-11-01',
        '2026-11-02',
        price,
        randomUUID(),
      ],
    ),
  )

  await dataSource.query(
    `UPDATE camping_private.stays SET reservation_id = $1 WHERE id = $2`,
    [ids.reservationA, ids.stay],
  )
  await dataSource.query(
    `INSERT INTO camping_private.payments
      (id, camping_id, stay_id, reservation_id, amount_minor, method, paid_on,
       recorded_by_id, idempotency_key)
     VALUES ($1, $2, $3, $4, 1000, 'cash', '2026-11-01', $5, $6)`,
    [
      ids.linkedPayment,
      ids.campingA,
      ids.stay,
      ids.reservationA,
      ids.userA,
      randomUUID(),
    ],
  )
  await assert.rejects(
    dataSource.query(
      `UPDATE camping_private.stays SET reservation_id = $1 WHERE id = $2`,
      [ids.reservationUnlimited, ids.stay],
    ),
  )
  await assert.rejects(
    dataSource.query(
      `INSERT INTO camping_private.payments
        (id, camping_id, stay_id, reservation_id, amount_minor, method, paid_on,
         recorded_by_id, idempotency_key)
       VALUES ($1, $2, $3, $4, 1000, 'cash', '2026-11-01', $5, $6)`,
      [
        randomUUID(),
        ids.campingA,
        ids.stay,
        ids.reservationUnlimited,
        ids.userA,
        randomUUID(),
      ],
    ),
  )
  await dataSource.query(`DELETE FROM camping_private.payments WHERE id = $1`, [
    ids.linkedPayment,
  ])
})

test('new entity mappings resolve every migrated column', async () => {
  const repositories = [
    [CampingEntity, { id: ids.campingA }],
    [StayEntity, { id: ids.stay }],
    [PaymentEntity, { id: ids.payment }],
    [AccommodationTypeEntity, { id: ids.typeA }],
    [AccommodationUnitEntity, { id: ids.unitA }],
    [AccommodationBlockEntity, { campingId: ids.campingA }],
    [ReservationEntity, { campingId: ids.campingA }],
    [OutboxEventEntity, { campingId: ids.campingA }],
    [AuditLogEntity, { campingId: ids.campingA }],
  ]
  for (const [entity, where] of repositories) {
    const rows = await dataSource.getRepository(entity).find({ where })
    assert.ok(Array.isArray(rows))
  }
})

test('migration down refuses void metadata', async () => {
  const runner = dataSource.createQueryRunner()
  await runner.connect()
  const clearReservationFixture = async () => {
    await runner.query(
      `DELETE FROM camping_private.reservations WHERE camping_id = $1`,
      [ids.campingA],
    )
    await runner.query(
      `DELETE FROM camping_private.accommodation_blocks WHERE camping_id = $1`,
      [ids.campingA],
    )
    await runner.query(
      `DELETE FROM camping_private.outbox_events WHERE camping_id = $1`,
      [ids.campingA],
    )
    await runner.query(
      `DELETE FROM camping_private.audit_logs WHERE camping_id = $1`,
      [ids.campingA],
    )
    await runner.query(
      `DELETE FROM camping_private.accommodation_units WHERE camping_id = $1`,
      [ids.campingA],
    )
    await runner.query(
      `DELETE FROM camping_private.accommodation_types WHERE camping_id = $1`,
      [ids.campingA],
    )
  }
  const clearFixture = async () => {
    await runner.query(
      `DELETE FROM camping_private.payments WHERE camping_id = $1`,
      [ids.campingA],
    )
    await runner.query(
      `DELETE FROM camping_private.stays WHERE camping_id = $1`,
      [ids.campingA],
    )
    await clearReservationFixture()
  }

  try {
    await runner.startTransaction()
    await clearReservationFixture()
    await runner.query(
      `UPDATE camping_private.payments
       SET voided_at = CURRENT_TIMESTAMP, voided_by_id = $1, void_reason = 'test'
       WHERE id = $2`,
      [ids.userA, ids.payment],
    )
    await assert.rejects(
      new AccommodationPersistence1760000002000().down(runner),
      /Refusing to revert accommodation persistence/,
    )
    await runner.rollbackTransaction()
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction()
    await runner.release()
  }
})

test('unit capacity migrates from its type and stays required and positive', async () => {
  const rows = await dataSource.query(
    'SELECT max_occupancy FROM camping_private.accommodation_units WHERE id = $1',
    [ids.unitA],
  )
  assert.equal(rows[0].max_occupancy, 4)
  for (const capacity of [null, 0, -1]) {
    await assert.rejects(
      dataSource.query(
        'UPDATE camping_private.accommodation_units SET max_occupancy = $1 WHERE id = $2',
        [capacity, ids.unitA],
      ),
    )
  }
})

test('unused flexible pricing migration can downgrade and reapply without changing existing records', async () => {
  const {
    FlexiblePricingAndBeds1760000007000,
  } = require('../dist/database/migrations/1760000007000-FlexiblePricingAndBeds')
  const runner = dataSource.createQueryRunner()
  await runner.connect()
  await runner.startTransaction()
  try {
    const migration = new FlexiblePricingAndBeds1760000007000()
    await migration.down(runner)
    await migration.up(runner)
    const [row] = await runner.query(
      'SELECT max_occupancy FROM camping_private.accommodation_units WHERE id=$1',
      [ids.unitA],
    )
    assert.equal(row.max_occupancy, 4)
  } finally {
    await runner.rollbackTransaction()
    await runner.release()
  }
})

test('reservation migration confirms existing pending reservations and rejects the old status', async () => {
  const {
    ConfirmReservationsOnCreate1760000008000,
  } = require('../dist/database/migrations/1760000008000-ConfirmReservationsOnCreate')
  const runner = dataSource.createQueryRunner()
  await runner.connect()
  await runner.startTransaction()
  try {
    const migration = new ConfirmReservationsOnCreate1760000008000()
    await migration.down(runner)
    await runner.query(
      'UPDATE reservations SET status = DEFAULT, version = 3 WHERE id = $1',
      [ids.reservationA],
    )
    const [pending] = await runner.query(
      'SELECT status, version, price_snapshot FROM reservations WHERE id = $1',
      [ids.reservationA],
    )
    assert.equal(pending.status, 'pending')
    await migration.up(runner)
    const [confirmed] = await runner.query(
      'SELECT status, version, price_snapshot FROM reservations WHERE id = $1',
      [ids.reservationA],
    )
    assert.deepEqual(confirmed, { ...pending, status: 'confirmed', version: 4 })
    const [unchanged] = await runner.query(
      'SELECT status, version FROM reservations WHERE id = $1',
      [ids.reservationUnlimited],
    )
    assert.deepEqual(unchanged, { status: 'confirmed', version: 1 })
    await assert.rejects(
      runner.query("UPDATE reservations SET status = 'pending' WHERE id = $1", [
        ids.reservationA,
      ]),
      { code: '23514' },
    )
  } finally {
    await runner.rollbackTransaction()
    await runner.release()
  }
})
