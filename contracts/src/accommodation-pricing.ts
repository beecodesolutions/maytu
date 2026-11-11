import { z } from 'zod'
import {
  ageRangesSchema,
  moneySchema,
  ratesSchema,
  safeCount,
} from './contract-primitives'

export const guestCompositionSchema = z.strictObject({
  adults: safeCount,
  children: safeCount,
  infants: safeCount,
  pets: safeCount,
})
export type GuestComposition = z.infer<typeof guestCompositionSchema>

export const blockDiscountSchema = z
  .strictObject({
    blockNights: safeCount.min(1).max(366),
    repeat: z.boolean(),
    benefit: z.discriminatedUnion('type', [
      z.strictObject({
        type: z.literal('PERCENTAGE'),
        value: z.number().int().min(0).max(10000),
      }),
      z.strictObject({ type: z.literal('FIXED_AMOUNT'), value: moneySchema }),
      z.strictObject({ type: z.literal('FIXED_PRICE'), value: moneySchema }),
      z.strictObject({
        type: z.literal('FREE_NIGHTS'),
        value: safeCount.min(1),
      }),
    ]),
  })
  .refine(
    (v) => v.benefit.type !== 'FREE_NIGHTS' || v.benefit.value <= v.blockNights,
    {
      path: ['benefit', 'value'],
      message: 'Free nights cannot exceed block nights',
    },
  )
export type BlockDiscount = z.infer<typeof blockDiscountSchema>

const nightlyRateSchema = z.strictObject({
  baseNightlyPriceMinor: moneySchema,
  rates: ratesSchema,
  extraPersonRates: ratesSchema,
  petNightlyPriceMinor: moneySchema,
})
export const accommodationPricingSchema = nightlyRateSchema.extend({
  basis: z.enum(['per_unit', 'per_person', 'per_bed']),
  includedOccupancy: z.strictObject({
    adults: safeCount,
    children: safeCount,
    infants: safeCount,
  }),
  weekdays: z
    .array(
      z.strictObject({
        day: z.number().int().min(0).max(6),
        rates: nightlyRateSchema.partial(),
      }),
    )
    .max(7)
    .refine(
      (v) => new Set(v.map((d) => d.day)).size === v.length,
      'Duplicate weekday',
    ),
  discounts: z.array(blockDiscountSchema).max(50),
})
export type AccommodationPricing = z.infer<typeof accommodationPricingSchema>

export type CapacityMatch = 'EXACT' | 'OVERSIZED' | 'INSUFFICIENT'
export function humanOccupancy(
  guests: Pick<GuestComposition, 'adults' | 'children' | 'infants'>,
  infantsConsumeCapacity: boolean,
): number {
  return (
    guests.adults +
    guests.children +
    (infantsConsumeCapacity ? guests.infants : 0)
  )
}
export function capacitySuitability(
  guests: Pick<GuestComposition, 'adults' | 'children' | 'infants'>,
  capacity: number,
  infantsConsumeCapacity: boolean,
) {
  const people = humanOccupancy(guests, infantsConsumeCapacity)
  const capacityMatch: CapacityMatch =
    people === capacity
      ? 'EXACT'
      : people < capacity
        ? 'OVERSIZED'
        : 'INSUFFICIENT'
  return {
    capacityMatch,
    people,
    sparePlaces: Math.max(0, capacity - people),
    childrenOverflow:
      people > capacity &&
      guests.children > 0 &&
      people - guests.children <= capacity,
  }
}

export const accommodationBedInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  position: safeCount,
  enabled: z.boolean(),
})
export const accommodationBedSchema = accommodationBedInputSchema.extend({
  id: z.uuid(),
  unitId: z.uuid(),
})
export const occupancySettingsSchema = z
  .strictObject({
    infantsConsumeCapacity: z.boolean().optional(),
    ageRanges: ageRangesSchema.optional(),
    expectedAgeRanges: ageRangesSchema.optional(),
  })
  .refine(
    (settings) =>
      settings.infantsConsumeCapacity !== undefined ||
      settings.ageRanges !== undefined,
    'Indica al menos un ajuste de ocupación.',
  )
  .refine(
    ({ ageRanges, expectedAgeRanges }) => !expectedAgeRanges || !!ageRanges,
    'Indica los nuevos rangos de edad.',
  )
export type OccupancySettings = z.infer<typeof occupancySettingsSchema>

/** The type's existing baseNightlyPriceMinor remains the canonical base rate. */
export const accommodationPricingSettingsSchema =
  accommodationPricingSchema.omit({ baseNightlyPriceMinor: true })
export type AccommodationPricingSettings = z.infer<
  typeof accommodationPricingSettingsSchema
>
