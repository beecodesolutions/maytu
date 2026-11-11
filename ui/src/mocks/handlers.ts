import { delay, http, HttpResponse } from 'msw'
import {
  campingProfileUpdateSchema,
  pilotCamping,
  pilotExtras,
  paymentInputSchema,
  addExtraSchema,
  checkInRequestSchema,
  closeRequestSchema,
  extraTemplateInputSchema,
  updateExtraSchema,
  extraTemplatePatchSchema,
  loginSchema,
  quoteRequestSchema,
  ratesSchema,
  moneySettingsSchema,
  todayInTimezone,
} from '@camping/contracts'
import type {
  CampingProfile,
  ExtraTemplate,
  Stay,
  StayAccount,
} from '@camping/contracts'
import { createUuid } from '../services/uuid'

const user = { id: 'demo-user', username: 'demo', name: 'Lucía' }
let loggedIn = true
const freshProfile = (): CampingProfile => ({
  id: pilotCamping.key,
  ...structuredClone(pilotCamping),
  activeGroups: 0,
  activePeople: 0,
  activeVehicles: 0,
  pendingAmountMinor: 0,
  moneyDecimals: 0,
})
let profile: CampingProfile = freshProfile()
let stays: Stay[] = []
let paymentKeys = new Map<string, Map<string, string>>()
const freshTemplates = (): ExtraTemplate[] =>
  pilotExtras.map((item, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    category: item.category,
    description: item.description,
    unitPriceMinor: item.unitPriceMinor,
    enabled: true,
  }))
let templates: ExtraTemplate[] = freshTemplates()

export function resetDemoStays() {
  loggedIn = true
  profile = freshProfile()
  stays = []
  paymentKeys = new Map()
  templates = freshTemplates()
}
function stayTotal(stay: Stay): number {
  if (stay.closure) return stay.closure.totalMinor
  const accommodationMinor =
    stay.adults * stay.rates.adults +
    stay.children * stay.rates.children +
    stay.infants * stay.rates.infants
  const extrasMinor = stay.extras.reduce(
    (sum, extra) => sum + extra.unitPriceMinor * extra.quantity,
    0,
  )
  return accommodationMinor + extrasMinor
}
function stayAccount(stay: Stay, totalMinor?: number): StayAccount {
  const total = totalMinor ?? stayTotal(stay)
  const paidMinor = stay.payments.reduce(
    (sum, payment) => sum + payment.amountMinor,
    0,
  )
  return {
    totalMinor: total,
    paidMinor,
    balanceMinor: total - paidMinor,
    asOfDate: stay.closure?.departureDate ?? stay.arrivalDate,
  }
}
function updateProfile() {
  profile.pendingAmountMinor = stays.reduce((sum, stay) => {
    const balance = stayAccount(stay).balanceMinor
    return sum + Math.max(0, balance)
  }, 0)
  profile.activeGroups = stays.filter((stay) => !stay.closure).length
  profile.activePeople = stays
    .filter((stay) => !stay.closure)
    .reduce((sum, stay) => sum + stay.adults + stay.children + stay.infants, 0)
  profile.activeVehicles = stays.filter(
    (stay) => !stay.closure && stay.hasVehicle,
  ).length
}
function jsonError(status: number) {
  return new HttpResponse(null, { status })
}
function nights(arrival: string, departure: string) {
  return Math.max(
    1,
    Math.round(
      (Date.parse(`${departure}T12:00:00Z`) -
        Date.parse(`${arrival}T12:00:00Z`)) /
        86400000,
    ),
  )
}
function quote(stay: Stay, departureDate: string) {
  const n = nights(stay.arrivalDate, departureDate)
  const accommodationMinor =
    n *
    (stay.adults * stay.rates.adults +
      stay.children * stay.rates.children +
      stay.infants * stay.rates.infants)
  const extrasMinor = stay.extras.reduce(
    (sum, extra) => sum + extra.unitPriceMinor * extra.quantity,
    0,
  )
  const totalMinor = accommodationMinor + extrasMinor
  return {
    departureDate,
    nights: n,
    accommodationMinor,
    extrasMinor,
    totalMinor,
    version: stay.version,
    account: stayAccount(stay, totalMinor),
  }
}

export const handlers = [
  http.get('*/api/auth/session', async () => {
    await delay(10)
    return loggedIn ? HttpResponse.json(user) : jsonError(401)
  }),
  http.post('*/api/auth/login', async ({ request }) => {
    const result = loginSchema.safeParse(await request.json())
    if (!result.success) return jsonError(400)
    loggedIn = true
    return HttpResponse.json(user)
  }),
  http.post('*/api/auth/logout', async () => {
    loggedIn = false
    return new HttpResponse(null, { status: 204 })
  }),
  http.get('*/api/camping', async () => {
    await delay(20)
    if (!loggedIn) return jsonError(401)
    updateProfile()
    return HttpResponse.json(profile)
  }),
  http.get('*/api/stays', async ({ request }) => {
    if (!loggedIn) return jsonError(401)
    const url = new URL(request.url)
    const status =
      url.searchParams.get('status') === 'closed' ? 'closed' : 'active'
    const page = Math.max(1, Number(url.searchParams.get('page') ?? 1))
    const pageSize = Math.max(1, Number(url.searchParams.get('pageSize') ?? 8))
    const accommodation = url.searchParams.get('accommodation')
    // Demo stays are walk-ins without an individual accommodation reservation.
    const filtered = stays.filter((stay) =>
      accommodation === 'individual'
        ? false
        : status === 'closed'
          ? !!stay.closure
          : !stay.closure,
    )
    return HttpResponse.json({
      items: filtered.slice((page - 1) * pageSize, page * pageSize),
      total: filtered.length,
      page,
      pageSize,
    })
  }),
  http.get('*/api/stays/:id', ({ params }) => {
    if (!loggedIn) return jsonError(401)
    const stay = stays.find((item) => item.id === params.id)
    return stay ? HttpResponse.json(stay) : jsonError(404)
  }),
  http.post('*/api/stays', async ({ request }) => {
    if (!loggedIn) return jsonError(401)
    const result = checkInRequestSchema.safeParse(await request.json())
    if (
      !result.success ||
      result.data.arrivalDate > todayInTimezone(profile.timezone)
    )
      return jsonError(400)
    const stay: Stay = {
      ...result.data,
      id: `demo-stay-${Date.now()}`,
      reservationId: null,
      accommodationPriceSnapshot: null,
      currency: profile.currency,
      moneyDecimals: profile.moneyDecimals,
      ageRanges: structuredClone(profile.ageRanges),
      rates: structuredClone(profile.rates),
      version: 1,
      extras: [],
      payments: [],
      account: {
        totalMinor: 0,
        paidMinor: 0,
        balanceMinor: 0,
        asOfDate: result.data.arrivalDate,
      },
      closure: null,
      createdAt: new Date().toISOString(),
    }
    stays.push(stay)
    updateProfile()
    return HttpResponse.json({ id: stay.id }, { status: 201 })
  }),
  http.post('*/api/stays/:id/quote', async ({ params, request }) => {
    const stay = stays.find((item) => item.id === params.id)
    const result = quoteRequestSchema.safeParse(await request.json())
    if (
      !loggedIn ||
      !stay ||
      !result.success ||
      result.data.departureDate < stay.arrivalDate
    )
      return jsonError(400)
    return HttpResponse.json(quote(stay, result.data.departureDate))
  }),
  http.post('*/api/stays/:id/close', async ({ params, request }) => {
    const stay = stays.find((item) => item.id === params.id)
    const result = closeRequestSchema.safeParse(await request.json())
    if (!loggedIn || !stay || !result.success) return jsonError(400)
    if (
      stay.closure &&
      stay.closure.departureDate === result.data.departureDate
    )
      return HttpResponse.json(stay)
    if (stay.version !== result.data.version) return jsonError(409)
    const breakdown = quote(stay, result.data.departureDate)
    const payment = result.data.payment
    const nextBalance =
      breakdown.account.balanceMinor - (payment?.amountMinor ?? 0)
    if (nextBalance !== 0) return jsonError(409)
    if (payment) {
      const keys = paymentKeys.get(stay.id) ?? new Map<string, string>()
      const fingerprint = JSON.stringify(payment)
      if (
        keys.has(payment.idempotencyKey) &&
        keys.get(payment.idempotencyKey) !== fingerprint
      )
        return jsonError(409)
      if (!keys.has(payment.idempotencyKey)) {
        keys.set(payment.idempotencyKey, fingerprint)
        paymentKeys.set(stay.id, keys)
        stay.payments.push({
          ...payment,
          id: createUuid(),
          reservationId: null,
          createdAt: new Date().toISOString(),
          recordedBy: user.id,
          voidedAt: null,
          voidedBy: null,
          voidReason: null,
        })
      }
    }
    stay.closure = {
      ...breakdown,
      closedAt: new Date().toISOString(),
      closedBy: user.id,
    }
    stay.account = stayAccount(stay, breakdown.totalMinor)
    stay.estimatedDeparture = result.data.departureDate
    stay.version += 1
    updateProfile()
    return HttpResponse.json(stay)
  }),
  http.post('*/api/stays/:id/payments', async ({ params, request }) => {
    const stay = stays.find((item) => item.id === params.id)
    const result = paymentInputSchema.safeParse(await request.json())
    if (!loggedIn || !stay || !result.success) return jsonError(400)
    const keys = paymentKeys.get(stay.id) ?? new Map<string, string>()
    const fingerprint = JSON.stringify(result.data)
    if (keys.has(result.data.idempotencyKey)) {
      return keys.get(result.data.idempotencyKey) === fingerprint
        ? HttpResponse.json(stay)
        : jsonError(409)
    }
    const balance = stayAccount(stay).balanceMinor
    if (stay.closure && (balance <= 0 || result.data.amountMinor > balance))
      return jsonError(409)
    keys.set(result.data.idempotencyKey, fingerprint)
    paymentKeys.set(stay.id, keys)
    stay.payments.push({
      ...result.data,
      id: createUuid(),
      reservationId: null,
      createdAt: new Date().toISOString(),
      recordedBy: user.id,
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
    })
    stay.account = stayAccount(stay)
    updateProfile()
    return HttpResponse.json(stay)
  }),
  http.get('*/api/extra-templates', () => HttpResponse.json(templates)),
  http.post('*/api/extra-templates', async ({ request }) => {
    const result = extraTemplateInputSchema.safeParse(await request.json())
    if (!result.success) return jsonError(400)
    const template = {
      ...result.data,
      id: `00000000-0000-4000-8000-${String(templates.length + 1).padStart(12, '0')}`,
      enabled: true,
    }
    templates.push(template)
    return HttpResponse.json(template, { status: 201 })
  }),
  http.patch('*/api/extra-templates/:id', async ({ params, request }) => {
    const template = templates.find((item) => item.id === params.id)
    const result = extraTemplatePatchSchema.safeParse(await request.json())
    if (!template || !result.success) return jsonError(400)
    Object.assign(template, result.data)
    return HttpResponse.json(template)
  }),
  http.post('*/api/stays/:id/extras', async ({ params, request }) => {
    const stay = stays.find((item) => item.id === params.id)
    const body = await request.json()
    if (!stay || stay.closure) return jsonError(409)
    const input = addExtraSchema.safeParse(body)
    if (!input.success) return jsonError(400)
    const id = `extra-${Date.now()}`
    let applied: Stay['extras'][number]
    if ('templateId' in input.data) {
      const templateIdValue = input.data.templateId
      const template = templates.find(
        (item) => item.id === templateIdValue && item.enabled,
      )
      if (!template) return jsonError(400)
      applied = {
        category: template.category,
        description: template.description,
        unitPriceMinor: template.unitPriceMinor,
        quantity: input.data.quantity,
        id,
        templateId: template.id,
      }
    } else {
      applied = { ...input.data, id, templateId: null }
    }
    stay.extras.push(applied)
    stay.version += 1
    return HttpResponse.json(stay)
  }),
  http.patch(
    '*/api/stays/:stayId/extras/:extraId',
    async ({ params, request }) => {
      const stay = stays.find((item) => item.id === params.stayId)
      const extra = stay?.extras.find((item) => item.id === params.extraId)
      const result = updateExtraSchema.safeParse(await request.json())
      if (!stay || !extra || stay.closure || !result.success)
        return jsonError(400)
      Object.assign(extra, result.data)
      extra.templateId = null
      stay.version += 1
      return HttpResponse.json(stay)
    },
  ),
  http.delete('*/api/stays/:stayId/extras/:extraId', ({ params }) => {
    const stay = stays.find((item) => item.id === params.stayId)
    if (!stay || stay.closure) return jsonError(400)
    stay.extras = stay.extras.filter((extra) => extra.id !== params.extraId)
    stay.version += 1
    return HttpResponse.json(stay)
  }),
  http.patch('*/api/camping', async ({ request }) => {
    if (!loggedIn) return jsonError(401)
    const parsed = campingProfileUpdateSchema.safeParse(await request.json())
    if (!parsed.success) return jsonError(400)
    const { expected, name, timezone } = parsed.data
    if (name === profile.name && timezone === profile.timezone)
      return HttpResponse.json(profile)
    if (
      expected.name !== profile.name ||
      expected.timezone !== profile.timezone
    )
      return HttpResponse.json(
        { code: 'STALE_CAMPING_PROFILE' },
        { status: 409 },
      )
    if (timezone !== profile.timezone && stays.some((stay) => !stay.closure))
      return HttpResponse.json({ code: 'ACTIVE_STAYS' }, { status: 409 })
    Object.assign(profile, { name, timezone })
    return HttpResponse.json(profile)
  }),
  http.patch('*/api/camping/money-settings', async ({ request }) => {
    if (!loggedIn) return jsonError(401)
    const parsed = moneySettingsSchema.safeParse(await request.json())
    if (!parsed.success) return jsonError(400)
    profile.moneyDecimals = parsed.data.moneyDecimals
    return HttpResponse.json(profile)
  }),
  http.patch('*/api/camping/rates', async ({ request }) => {
    const result = ratesSchema.safeParse(await request.json())
    if (!result.success) return jsonError(400)
    profile.rates = structuredClone(result.data)
    return HttpResponse.json(profile)
  }),
]
