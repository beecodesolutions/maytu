const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const argon2 = require('argon2')
const { after, before, test } = require('node:test')

const ORIGIN = 'http://localhost:5173'
const PASSWORD = 'correct horse battery staple'

process.env.NODE_ENV = 'test'
process.env.DB_SCHEMA = 'camping_private'
process.env.DB_HOST ??= 'localhost'
process.env.DB_PORT ??= '5434'
process.env.DB_USER ??= 'camping'
process.env.DB_PASSWORD ??= 'camping-local-only'
process.env.DB_NAME ??= 'camping_test'
process.env.DB_POOL_MAX = '2'
process.env.ALLOWED_ORIGIN = ORIGIN
process.env.REQUIRE_ORIGIN = 'true'

const database = process.env.DATABASE_URL
  ? new URL(process.env.DATABASE_URL).pathname.slice(1)
  : process.env.DB_NAME
assert.equal(database, 'camping_test', 'tests must use camping_test')

const { createDataSource } = require('../dist/database/data-source')
const { createNestApp } = require('../dist/main')

const ids = {
  camping: randomUUID(),
  campingB: randomUUID(),
  user: randomUUID(),
  userB: randomUUID(),
  type: randomUUID(),
  typeB: randomUUID(),
  typeMove: randomUUID(),
  unit: randomUUID(),
}
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
let cookieB

async function request(
  path,
  { method = 'GET', body, origin = ORIGIN, sessionCookie = cookie } = {},
) {
  const headers = {}
  if (sessionCookie) headers.cookie = sessionCookie
  if (origin) headers.origin = origin
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  return { response, value: text ? JSON.parse(text) : null }
}

before(async () => {
  dataSource = createDataSource()
  await dataSource.initialize()
  await dataSource.runMigrations()
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id })
  await dataSource.query(
    `INSERT INTO camping_private.campings
      (id, stable_key, name, country, currency, timezone, age_ranges, rates)
     VALUES ($1, $2, 'Inventory test', 'CL', 'CLP', 'UTC', $3, $4),
            ($5, $6, 'Inventory test B', 'CL', 'CLP', 'UTC', $3, $4)`,
    [
      ids.camping,
      `inventory-${ids.camping}`,
      ageRanges,
      rates,
      ids.campingB,
      `inventory-${ids.campingB}`,
    ],
  )
  await dataSource.query(
    `INSERT INTO camping_private.users
      (id, camping_id, username, name, password_hash, enabled, password_changed_at)
     VALUES ($1, $2, $3, 'Inventory owner', $4, true, CURRENT_TIMESTAMP),
            ($5, $6, $7, 'Inventory owner B', $4, true, CURRENT_TIMESTAMP)`,
    [
      ids.user,
      ids.camping,
      `inventory-${ids.user}`,
      passwordHash,
      ids.userB,
      ids.campingB,
      `inventory-${ids.userB}`,
    ],
  )
  app = await createNestApp()
  app.useLogger(false)
  await app.listen(0, '127.0.0.1')
  const address = app.getHttpServer().address()
  baseUrl = `http://127.0.0.1:${address.port}`
  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { username: `inventory-${ids.user}`, password: PASSWORD },
  })
  assert.equal(login.response.status, 201)
  cookie = login.response.headers.get('set-cookie').split(';', 1)[0]
  const loginB = await request('/api/auth/login', {
    method: 'POST',
    body: { username: `inventory-${ids.userB}`, password: PASSWORD },
  })
  assert.equal(loginB.response.status, 201)
  cookieB = loginB.response.headers.get('set-cookie').split(';', 1)[0]
})

async function dropOutboxFailureTrigger() {
  await dataSource.query(
    `DROP TRIGGER IF EXISTS accommodation_test_fail_outbox ON camping_private.outbox_events`,
  )
  await dataSource.query(
    `DROP FUNCTION IF EXISTS camping_private.accommodation_test_fail_outbox()`,
  )
}

after(async () => {
  if (app) await app.close()
  if (dataSource?.isInitialized) {
    await dropOutboxFailureTrigger()
    const campingIds = [ids.camping, ids.campingB]
    const userIds = [ids.user, ids.userB]
    await dataSource.query(
      `DELETE FROM camping_private.audit_logs WHERE camping_id = ANY($1) OR actor_id = ANY($1)`,
      [campingIds],
    )
    await dataSource.query(
      `DELETE FROM camping_private.outbox_events WHERE camping_id = ANY($1)`,
      [campingIds],
    )
    await dataSource.query(
      `DELETE FROM camping_private.accommodation_blocks WHERE camping_id = ANY($1)`,
      [campingIds],
    )
    await dataSource.query(
      `DELETE FROM camping_private.reservations WHERE camping_id = ANY($1)`,
      [campingIds],
    )
    await dataSource.query(
      `DELETE FROM camping_private.accommodation_units WHERE camping_id = ANY($1)`,
      [campingIds],
    )
    await dataSource.query(
      `DELETE FROM camping_private.accommodation_types WHERE camping_id = ANY($1)`,
      [campingIds],
    )
    await dataSource.query(
      `DELETE FROM camping_private.sessions WHERE user_id = ANY($1)`,
      [userIds],
    )
    await dataSource.query(
      `DELETE FROM camping_private.users WHERE id = ANY($1)`,
      [userIds],
    )
    await dataSource.query(
      `DELETE FROM camping_private.campings WHERE id = ANY($1)`,
      [campingIds],
    )
    await dataSource.destroy()
  }
})

test('block creation rolls back inventory, audit, and outbox when outbox insert fails', async () => {
  const type = await request('/api/accommodations/types', {
    method: 'POST',
    body: {
      name: 'Test plot type',
      inventoryMode: 'individual',
      maxOccupancy: 4,
      baseNightlyPriceMinor: 1000,
      enabled: true,
    },
  })
  assert.equal(type.response.status, 201)
  ids.type = type.value.id

  const unit = await request('/api/accommodations/units', {
    method: 'POST',
    body: { typeId: ids.type, name: 'A-1', maxOccupancy: 4, enabled: true },
  })
  assert.equal(unit.response.status, 201)
  ids.unit = unit.value.id

  try {
    await dataSource.query(`
      CREATE OR REPLACE FUNCTION camping_private.accommodation_test_fail_outbox()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = 'InventoryBlocked' THEN
          RAISE EXCEPTION 'forced outbox failure';
        END IF;
        RETURN NEW;
      END;
      $$
    `)
    await dataSource.query(`
      CREATE TRIGGER accommodation_test_fail_outbox
      BEFORE INSERT ON camping_private.outbox_events
      FOR EACH ROW EXECUTE FUNCTION camping_private.accommodation_test_fail_outbox()
    `)

    const result = await request('/api/accommodations/blocks', {
      method: 'POST',
      body: {
        typeId: ids.type,
        unitId: ids.unit,
        checkInDate: '2099-01-01',
        checkOutDate: '2099-01-03',
        reason: 'maintenance',
      },
    })
    assert.equal(result.response.status, 500)

    const [{ count: blocks }, { count: audits }, { count: events }] =
      await Promise.all([
        dataSource
          .query(
            `SELECT count(*)::int AS count FROM camping_private.accommodation_blocks WHERE camping_id = $1`,
            [ids.camping],
          )
          .then((rows) => rows[0]),
        dataSource
          .query(
            `SELECT count(*)::int AS count FROM camping_private.audit_logs WHERE camping_id = $1 AND entity_type = 'AccommodationBlock'`,
            [ids.camping],
          )
          .then((rows) => rows[0]),
        dataSource
          .query(
            `SELECT count(*)::int AS count FROM camping_private.outbox_events WHERE camping_id = $1 AND event_type = 'InventoryBlocked'`,
            [ids.camping],
          )
          .then((rows) => rows[0]),
      ])
    assert.equal(blocks, 0)
    assert.equal(audits, 0)
    assert.equal(events, 0)
  } finally {
    await dropOutboxFailureTrigger()
  }
})

test('accommodation CRUD isolates tenants and enforces inventory constraints', async () => {
  const duplicate = await request('/api/accommodations/types', {
    method: 'POST',
    body: {
      name: 'Test plot type',
      inventoryMode: 'individual',
      maxOccupancy: 4,
      baseNightlyPriceMinor: 1000,
      enabled: true,
    },
  })
  assert.equal(duplicate.response.status, 409)

  const typeB = await request('/api/accommodations/types', {
    method: 'POST',
    sessionCookie: cookieB,
    body: {
      name: 'Foreign type',
      inventoryMode: 'individual',
      maxOccupancy: 4,
      baseNightlyPriceMinor: 1000,
      enabled: true,
    },
  })
  assert.equal(typeB.response.status, 201)
  ids.typeB = typeB.value.id

  const typeMove = await request('/api/accommodations/types', {
    method: 'POST',
    body: {
      name: 'Move target',
      inventoryMode: 'individual',
      maxOccupancy: 4,
      baseNightlyPriceMinor: 1000,
      enabled: true,
    },
  })
  assert.equal(typeMove.response.status, 201)
  ids.typeMove = typeMove.value.id

  const foreignRead = await request(`/api/accommodations/types/${ids.type}`, {
    sessionCookie: cookieB,
  })
  assert.equal(foreignRead.response.status, 404)
  const malformedQuery = await request('/api/accommodations/units?typeId=bad')
  assert.equal(malformedQuery.response.status, 400)
  const foreignBody = await request('/api/accommodations/units', {
    method: 'POST',
    body: {
      typeId: ids.typeB,
      name: 'cross-tenant',
      maxOccupancy: 4,
      enabled: true,
    },
  })
  assert.equal(foreignBody.response.status, 404)
  const foreignMove = await request(`/api/accommodations/units/${ids.unit}`, {
    method: 'PATCH',
    body: { typeId: ids.typeB },
  })
  assert.equal(foreignMove.response.status, 404)

  await dataSource.query(
    `INSERT INTO camping_private.reservations
      (id, camping_id, accommodation_type_id, unit_id, responsible_name,
       check_in_date, check_out_date, adults, children, infants, status,
       source, notes, price_snapshot, version, idempotency_key)
     VALUES ($1, $2, $3, $4, 'Active guest', '2099-02-01', '2099-02-03',
       2, 0, 0, 'confirmed', 'manual', '', $5, 1, $6)`,
    [
      randomUUID(),
      ids.camping,
      ids.type,
      ids.unit,
      {
        basis: 'per_unit',
        currency: 'CLP',
        totalMinor: 2000,
        baseNightlyPriceMinor: 1000,
        nights: 2,
      },
      randomUUID(),
    ],
  )

  const reservationOverlap = await request('/api/accommodations/blocks', {
    method: 'POST',
    body: {
      typeId: ids.type,
      unitId: ids.unit,
      checkInDate: '2099-02-01',
      checkOutDate: '2099-02-03',
      reason: 'reservation overlap',
    },
  })
  assert.equal(reservationOverlap.response.status, 409)

  const adjacent = await request('/api/accommodations/blocks', {
    method: 'POST',
    body: {
      typeId: ids.type,
      unitId: ids.unit,
      checkInDate: '2099-02-03',
      checkOutDate: '2099-02-05',
      reason: 'adjacent maintenance',
    },
  })
  assert.equal(adjacent.response.status, 201)
  const adjacentId = adjacent.value.id
  const sameBlockPatch = await request(
    `/api/accommodations/blocks/${adjacentId}`,
    { method: 'PATCH', body: { reason: 'adjacent maintenance updated' } },
  )
  assert.equal(sameBlockPatch.response.status, 200)

  const maxReduction = await request(`/api/accommodations/types/${ids.type}`, {
    method: 'PATCH',
    body: { maxOccupancy: 1 },
  })
  assert.equal(maxReduction.response.status, 200)
  const modeChange = await request(`/api/accommodations/types/${ids.type}`, {
    method: 'PATCH',
    body: { inventoryMode: 'unlimited', maxOccupancy: null },
  })
  assert.equal(modeChange.response.status, 409)
  const disableUnit = await request(`/api/accommodations/units/${ids.unit}`, {
    method: 'PATCH',
    body: { enabled: false },
  })
  assert.equal(disableUnit.response.status, 409)
  const disableType = await request(`/api/accommodations/types/${ids.type}`, {
    method: 'PATCH',
    body: { enabled: false },
  })
  assert.equal(disableType.response.status, 409)
  const moveUnit = await request(`/api/accommodations/units/${ids.unit}`, {
    method: 'PATCH',
    body: { typeId: ids.typeMove },
  })
  assert.equal(moveUnit.response.status, 409)

  const releaseBefore = await dataSource.query(
    `SELECT count(*)::int AS count FROM camping_private.audit_logs
     WHERE camping_id = $1 AND entity_type = 'AccommodationBlock'`,
    [ids.camping],
  )
  const release = await request(`/api/accommodations/blocks/${adjacentId}`, {
    method: 'DELETE',
  })
  assert.deepEqual(release.value, { ok: true })
  assert.equal(release.response.status, 200)
  const releaseAfter = await dataSource.query(
    `SELECT count(*)::int AS count FROM camping_private.audit_logs
     WHERE camping_id = $1 AND entity_type = 'AccommodationBlock'`,
    [ids.camping],
  )
  assert.equal(
    Number(releaseAfter[0].count),
    Number(releaseBefore[0].count) + 1,
  )
  const releasedEvent = await dataSource.query(
    `SELECT event_type FROM camping_private.outbox_events
     WHERE camping_id = $1 AND aggregate_id = $2 ORDER BY occurred_at DESC LIMIT 1`,
    [ids.camping, adjacentId],
  )
  assert.equal(releasedEvent[0].event_type, 'InventoryReleased')

  const concurrentBody = {
    typeId: ids.type,
    unitId: ids.unit,
    checkInDate: '2099-03-01',
    checkOutDate: '2099-03-03',
    reason: 'concurrent maintenance',
  }
  const concurrent = await Promise.all([
    request('/api/accommodations/blocks', {
      method: 'POST',
      body: concurrentBody,
    }),
    request('/api/accommodations/blocks', {
      method: 'POST',
      body: concurrentBody,
    }),
  ])
  assert.deepEqual(
    concurrent.map((result) => result.response.status).sort((a, b) => a - b),
    [201, 409],
  )
})

test('unit maximum is required on creation, positive on update and independently editable', async () => {
  for (const capacity of [undefined, null, 0, -1, 1.5]) {
    const result = await request('/api/accommodations/units', {
      method: 'POST',
      body: {
        typeId: ids.type,
        name: 'Invalid capacity',
        enabled: true,
        ...(capacity === undefined ? {} : { maxOccupancy: capacity }),
      },
    })
    assert.equal(result.response.status, 400)
  }
  const result = await request(`/api/accommodations/units/${ids.unit}`, {
    method: 'PATCH',
    body: { maxOccupancy: 2 },
  })
  assert.equal(result.response.status, 200)
  assert.equal(result.value.maxOccupancy, 2)
  const invalid = await request(`/api/accommodations/units/${ids.unit}`, {
    method: 'PATCH',
    body: { maxOccupancy: 0 },
  })
  assert.equal(invalid.response.status, 400)
})
