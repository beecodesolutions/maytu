const assert = require('node:assert/strict')
const { test } = require('node:test')

const { createOfflineOpenApiDocument } = require('../dist/openapi/document')
const { openApiEnabled } = require('../dist/main')

const expectedRoutes = [
  'GET /api/accommodations/units/{id}/beds',
  'POST /api/accommodations/units/{id}/beds',
  'PATCH /api/accommodations/units/{id}/beds/{bedId}',
  'PATCH /api/camping/occupancy-settings',
  'POST /api/auth/login',
  'GET /api/auth/session',
  'POST /api/auth/logout',
  'GET /api/camping',
  'PATCH /api/camping',
  'PATCH /api/camping/rates',
  'PATCH /api/camping/money-settings',
  'POST /api/stays',
  'GET /api/stays',
  'GET /api/stays/{id}',
  'POST /api/stays/{id}/quote',
  'POST /api/stays/{id}/payments',
  'POST /api/stays/{id}/close',
  'GET /api/extra-templates',
  'POST /api/extra-templates',
  'PATCH /api/extra-templates/{id}',
  'POST /api/stays/{id}/extras',
  'PATCH /api/stays/{id}/extras/{extraId}',
  'DELETE /api/stays/{id}/extras/{extraId}',
  'GET /api/accommodations/types',
  'POST /api/accommodations/types',
  'GET /api/accommodations/types/{id}',
  'PATCH /api/accommodations/types/{id}',
  'GET /api/accommodations/units',
  'POST /api/accommodations/units',
  'GET /api/accommodations/units/{id}',
  'PATCH /api/accommodations/units/{id}',
  'GET /api/accommodations/blocks',
  'POST /api/accommodations/blocks',
  'GET /api/accommodations/blocks/{id}',
  'PATCH /api/accommodations/blocks/{id}',
  'DELETE /api/accommodations/blocks/{id}',
  'GET /api/availability',
  'POST /api/reservations/quote',
  'POST /api/reservations/search',
  'POST /api/reservations',
  'GET /api/reservations',
  'GET /api/reservations/{id}',
  'POST /api/reservations/{id}/quote',
  'PATCH /api/reservations/{id}',
  'POST /api/reservations/{id}/confirm',
  'POST /api/reservations/{id}/cancel',
  'POST /api/reservations/{id}/no-show',
  'POST /api/reservations/{id}/check-in/quote',
  'POST /api/reservations/{id}/check-in',
  'POST /api/reservations/{id}/payments',
  'POST /api/reservations/{id}/payments/{paymentId}/void',
]

function operations(document) {
  return Object.entries(document.paths).flatMap(([path, item]) =>
    Object.entries(item)
      .filter(([method]) => ['get', 'post', 'patch', 'delete'].includes(method))
      .map(([method, operation]) => ({
        key: `${method.toUpperCase()} ${path}`,
        operation,
      })),
  )
}

test('offline OpenAPI document describes implemented pilot and inventory routes', async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL
  delete process.env.DATABASE_URL
  try {
    const document = await createOfflineOpenApiDocument()
    const routeKeys = operations(document)
      .map(({ key }) => key)
      .sort()
    assert.deepEqual(routeKeys, [...expectedRoutes].sort())

    const ops = operations(document)
    const operationIds = ops.map(({ operation }) => operation.operationId)
    assert.equal(new Set(operationIds).size, operationIds.length)
    assert.ok(operationIds.every(Boolean))

    const stayList = document.paths['/api/stays'].get
    assert.equal(
      stayList.responses[200].content['application/json'].schema.$ref,
      '#/components/schemas/StayPage',
    )
    assert.deepEqual(
      stayList.parameters.map((parameter) => parameter.name).sort(),
      ['accommodation', 'page', 'pageSize', 'status'],
    )
    assert.equal(
      stayList.parameters.find((parameter) => parameter.name === 'pageSize')
        .schema.maximum,
      undefined,
    )
    assert.ok(document.paths['/api/stays/{id}'].get.responses[400])
    assert.ok(
      document.paths['/api/stays/{id}/extras/{extraId}'].delete.responses[400],
    )
    assert.equal(document.paths['/api/stays/{id}'].get.parameters[0].name, 'id')
    assert.equal(
      document.paths['/api/extra-templates'].get.responses[200].content[
        'application/json'
      ].schema.type,
      'array',
    )

    const protectedOperation = document.paths['/api/camping'].get
    assert.deepEqual(protectedOperation.security, [{ camping_session: [] }])
    assert.equal(document.paths['/api/auth/login'].post.security, undefined)
    assert.equal(
      document.components.securitySchemes.camping_session.type,
      'apiKey',
    )
    assert.equal(
      document.components.securitySchemes.camping_session.in,
      'cookie',
    )
    const unitSchema = document.components.schemas.AccommodationUnit
    assert.ok(unitSchema.required.includes('maxOccupancy'))
    assert.equal(unitSchema.properties.maxOccupancy.minimum, 1)
    assert.ok(
      document.components.schemas.AccommodationUnitCreate.required.includes(
        'maxOccupancy',
      ),
    )
    assert.ok(
      document.components.schemas.ReservationQuote.properties.occupancyWarning,
    )
    assert.ok(document.components.schemas.Reservation)
    assert.ok(document.components.schemas.ReservationPayment)
    assert.ok(document.components.schemas.ReservationQuote)
    assert.ok(document.components.schemas.ReservationQuoteCreate)
    assert.ok(document.components.schemas.ReservationQuoteUpdate)
    assert.ok(document.components.schemas.ReservationUpdateQuote)
    assert.ok(document.components.schemas.ReservationStatusCommand)
    assert.ok(document.components.schemas.ReservationCheckInQuote)
    assert.ok(document.components.schemas.ReservationCheckIn)
    assert.ok(document.components.schemas.ReservationListQuery)
    assert.ok(document.components.schemas.ReservationPage)
    assert.ok(document.components.schemas.ReservationAccount)
    assert.ok(document.components.schemas.AvailabilityQuery)
    assert.ok(document.components.schemas.AvailabilityResponse)

    const staySchema = document.components.schemas.Stay
    assert.ok(staySchema.properties.reservationId)
    assert.ok(staySchema.properties.accommodationPriceSnapshot)
    const stayPaymentSchema = staySchema.properties.payments.items
    assert.ok(stayPaymentSchema.properties.voidedAt)
    assert.ok(stayPaymentSchema.properties.voidedBy)
    assert.ok(stayPaymentSchema.properties.voidReason)

    const reservationList = document.paths['/api/reservations'].get
    assert.equal(
      reservationList.responses[200].content['application/json'].schema.$ref,
      '#/components/schemas/ReservationPage',
    )
    assert.deepEqual(
      reservationList.parameters.map((parameter) => parameter.name).sort(),
      ['checkInDate', 'checkOutDate', 'page', 'pageSize', 'status', 'typeId'],
    )
    assert.deepEqual(
      [
        'reservationQuoteCreate',
        'reservationSearch',
        'reservationCreate',
        'reservationList',
        'reservationRead',
        'reservationQuoteUpdate',
        'reservationUpdate',
        'reservationConfirm',
        'reservationCancel',
        'reservationNoShow',
        'reservationCheckInQuote',
        'reservationCheckIn',
        'reservationPaymentRecord',
        'reservationPaymentVoid',
      ].sort(),
      ops
        .filter(({ key }) => key.includes('/api/reservations'))
        .map(({ operation }) => operation.operationId)
        .sort(),
    )
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
  }
})

test('production OpenAPI exposure is opt-in', () => {
  const previousNodeEnv = process.env.NODE_ENV
  const previousOpenApiEnabled = process.env.OPENAPI_ENABLED
  try {
    process.env.NODE_ENV = 'production'
    delete process.env.OPENAPI_ENABLED
    assert.equal(openApiEnabled(), false)
    process.env.OPENAPI_ENABLED = 'true'
    assert.equal(openApiEnabled(), true)
    process.env.NODE_ENV = 'development'
    delete process.env.OPENAPI_ENABLED
    assert.equal(openApiEnabled(), true)
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
    if (previousOpenApiEnabled === undefined) delete process.env.OPENAPI_ENABLED
    else process.env.OPENAPI_ENABLED = previousOpenApiEnabled
  }
})
