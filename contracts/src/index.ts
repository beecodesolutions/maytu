import { z } from 'zod'
import { parsePhoneNumberFromString } from 'libphonenumber-js/min'
import {
  ageRangesSchema,
  countries,
  moneySchema,
  paymentMethodSchema,
  ratesSchema,
  safeCount,
} from './contract-primitives'
import { moneyDecimalsSchema } from './money'
export * from './money'
import { reservationPriceSnapshotSchema } from './reservation-pricing'
export {
  ageRangesSchema,
  countries,
  moneySchema,
  paymentMethodSchema,
  ratesSchema,
  safeCount,
} from './contract-primitives'
export type { AgeRanges, Rates } from './contract-primitives'
export const categories = ['adults', 'children', 'infants'] as const
export function todayInTimezone(timezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const part = (type: string) => parts.find((p) => p.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}
export const checkInRequestSchema = z
  .strictObject({
    responsibleName: z.string().trim().min(1, 'validation.required'),
    document: z.string().trim(),
    nationality: z.union([z.literal(''), z.enum(countries)]),
    phone: z
      .string()
      .refine(
        (v) =>
          v === '' ||
          (/^\+[1-9]\d{1,14}$/.test(v) &&
            !!parsePhoneNumberFromString(v)?.isPossible()),
        'validation.phone',
      ),
    arrivalDate: z.iso.date(),
    estimatedDeparture: z.union([z.literal(''), z.iso.date()]),
    adults: safeCount,
    children: safeCount,
    infants: safeCount,
    pets: safeCount.optional(),
    hasVehicle: z.boolean(),
    vehicleDescription: z.string().trim(),
    licensePlate: z.string().trim(),
    location: z.string().trim(),
  })
  .refine(
    (v) =>
      Number.isSafeInteger(v.adults + v.children + v.infants) &&
      v.adults + v.children + v.infants > 0,
    { path: ['adults'], error: 'validation.peopleRequired' },
  )
  .refine(
    (v) => !v.estimatedDeparture || v.estimatedDeparture >= v.arrivalDate,
    {
      path: ['estimatedDeparture'],
      error: 'validation.departureBeforeArrival',
    },
  )
  .transform((v) => ({
    ...v,
    vehicleDescription: v.hasVehicle ? v.vehicleDescription : '',
    licensePlate: v.hasVehicle ? v.licensePlate : '',
  }))
export type CheckInRequest = z.infer<typeof checkInRequestSchema>
export function checkInSchemaForTimezone(timezone: string) {
  return checkInRequestSchema.refine(
    (v) => v.arrivalDate <= todayInTimezone(timezone),
    { path: ['arrivalDate'], error: 'validation.futureArrival' },
  )
}
export const campingProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  country: z.enum(countries),
  currency: z.string().regex(/^[A-Z]{3}$/),
  timezone: z.string(),
  moneyDecimals: moneyDecimalsSchema.default(0),
  infantsConsumeCapacity: z.boolean().optional(),
  ageRanges: ageRangesSchema,
  rates: ratesSchema,
  activeGroups: safeCount,
  activePeople: safeCount,
  activeVehicles: safeCount,
  pendingAmountMinor: moneySchema,
})
export type CampingProfile = z.infer<typeof campingProfileSchema>

const campingProfileFieldsSchema = z.strictObject({
  name: z.string().trim().min(1, 'Introduce el nombre del camping.').max(160),
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .refine((timezone) => {
      if (/^[+-]/.test(timezone)) return false
      try {
        new Intl.DateTimeFormat('en', { timeZone: timezone })
        return true
      } catch {
        return false
      }
    }, 'Introduce una zona horaria válida.'),
})

export const campingProfileUpdateSchema = campingProfileFieldsSchema.extend({
  expected: campingProfileSchema.pick({ name: true, timezone: true }).strict(),
})
export type CampingProfileUpdate = z.input<typeof campingProfileUpdateSchema>
export const sessionUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  name: z.string(),
})
export type SessionUser = z.infer<typeof sessionUserSchema>
export const loginSchema = z.strictObject({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(256),
})
export const extraTemplateInputSchema = z.strictObject({
  category: z.string().trim().max(100).default(''),
  description: z.string().trim().min(1).max(200),
  unitPriceMinor: moneySchema,
})
export const extraTemplatePatchSchema = extraTemplateInputSchema
  .partial()
  .extend({
    category: z.string().trim().max(100).optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
export const extraTemplateSchema = extraTemplateInputSchema.extend({
  id: z.string(),
  enabled: z.boolean(),
})
export type ExtraTemplate = z.infer<typeof extraTemplateSchema>
export const extraValuesSchema = extraTemplateInputSchema.extend({
  quantity: safeCount.min(1),
})
export const updateExtraSchema = extraValuesSchema.extend({
  category: z.string().trim().max(100).optional(),
})
export const addExtraSchema = z.union([
  z.strictObject({ templateId: z.uuid(), quantity: safeCount.min(1) }),
  extraValuesSchema,
])
export const appliedExtraSchema = extraValuesSchema.extend({
  id: z.string(),
  templateId: z.string().nullable(),
})
export type AppliedExtra = z.infer<typeof appliedExtraSchema>
export const paymentInputSchema = z.strictObject({
  amountMinor: moneySchema.min(1),
  method: paymentMethodSchema,
  paidOn: z.iso.date(),
  note: z.string().trim().max(200).default(''),
  idempotencyKey: z.uuid(),
})
export type PaymentInput = z.input<typeof paymentInputSchema>
export const paymentSchema = z.object({
  id: z.uuid(),
  reservationId: z.uuid().nullable().default(null),
  amountMinor: moneySchema.min(1),
  method: paymentMethodSchema,
  paidOn: z.iso.date(),
  note: z.string(),
  createdAt: z.string(),
  recordedBy: z.string(),
  voidedAt: z.string().nullable().default(null),
  voidedBy: z.string().nullable().default(null),
  voidReason: z.string().nullable().default(null),
})
export type Payment = z.infer<typeof paymentSchema>
export const accountSchema = z.object({
  totalMinor: moneySchema,
  paidMinor: moneySchema,
  balanceMinor: z
    .number()
    .int()
    .min(-Number.MAX_SAFE_INTEGER)
    .max(Number.MAX_SAFE_INTEGER),
  asOfDate: z.iso.date(),
})
export type StayAccount = z.infer<typeof accountSchema>
export const quoteRequestSchema = z.strictObject({
  departureDate: z.iso.date(),
})
export const closeRequestSchema = quoteRequestSchema.extend({
  version: safeCount.min(1),
  payment: paymentInputSchema.optional(),
})
export const costBreakdownSchema = z.object({
  roundingMinor: z
    .number()
    .int()
    .min(-Number.MAX_SAFE_INTEGER)
    .max(Number.MAX_SAFE_INTEGER)
    .optional(),
  departureDate: z.iso.date(),
  nights: safeCount.min(1),
  accommodationMinor: moneySchema,
  extrasMinor: moneySchema,
  totalMinor: moneySchema,
  version: safeCount.min(1),
})
export type CostBreakdown = z.infer<typeof costBreakdownSchema>
export const stayQuoteSchema = costBreakdownSchema.extend({
  account: accountSchema,
})
export type StayQuote = z.infer<typeof stayQuoteSchema>
export const closureSchema = costBreakdownSchema.extend({
  closedAt: z.string(),
  closedBy: z.string(),
})
export const staySchema = z.object({
  id: z.string(),
  reservationId: z.uuid().nullable().default(null),
  moneyDecimals: moneyDecimalsSchema.default(null),
  accommodationPriceSnapshot: reservationPriceSnapshotSchema
    .nullable()
    .default(null),
  responsibleName: z.string(),
  document: z.string(),
  nationality: z.string(),
  phone: z.string(),
  arrivalDate: z.iso.date(),
  estimatedDeparture: z.string(),
  adults: safeCount,
  children: safeCount,
  infants: safeCount,
  pets: safeCount.optional(),
  hasVehicle: z.boolean(),
  vehicleDescription: z.string(),
  licensePlate: z.string(),
  location: z.string(),
  currency: z.string(),
  ageRanges: ageRangesSchema,
  rates: ratesSchema,
  version: safeCount.min(1),
  extras: z.array(appliedExtraSchema),
  payments: z.array(paymentSchema),
  account: accountSchema,
  closure: closureSchema.nullable(),
  createdAt: z.string(),
})
export type Stay = z.infer<typeof staySchema>
export const stayPageSchema = z.object({
  items: z.array(staySchema),
  total: safeCount,
  page: safeCount.min(1),
  pageSize: safeCount.min(1),
})
export type StayPage = z.infer<typeof stayPageSchema>

export { pilotCamping, pilotExtras } from './pilot'
export * from './availability'
export * from './reservations'

export * from './accommodation-pricing'
