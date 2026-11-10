import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ReservationReview from './ReservationReview'
import type { CreationQuote } from './reservations/creationState'
import { i18nReady } from './app/i18n'

await i18nReady
const quote = {
  accommodationName: 'Habitación privada · Habitación 1',
  responsibleName: 'Ana',
  input: {
    accommodationTypeId: '00000000-0000-4000-8000-000000000001',
    checkInDate: '2026-10-30',
    checkOutDate: '2026-11-09',
    adults: 1,
    children: 0,
    infants: 0,
  },
  priceSnapshot: {
    basis: 'per_unit',
    currency: 'MXN',
    baseNightlyPriceMinor: 90000,
    totalMinor: 900000,
    nights: 10,
  },
} satisfies CreationQuote

it('shows singular guests, readable dates and one formatted total with no empty groups', () => {
  const markup = renderToStaticMarkup(
    <ReservationReview quote={quote} today="2026-10-30" />,
  )
  for (const text of [
    'Habitación privada',
    'Ana',
    '1 adulto',
    '30 de octubre',
    '9 de noviembre',
    '10 noches',
    'Total de la reserva',
  ])
    expect(markup).toContain(text)
  expect(markup).not.toContain('0 niños')
  expect(markup).not.toContain('0 bebés')
  expect(markup).not.toContain('2026-10-30')
  expect(markup).not.toContain('MXN 9.000 MXN')
})

it('also omits empty groups from person pricing and retains an advisory capacity warning', () => {
  const personQuote = {
    ...quote,
    occupancyWarning: { maxOccupancy: 2, people: 3 },
    priceSnapshot: {
      basis: 'per_person',
      currency: 'CLP',
      totalMinor: 12000,
      nights: 1,
      ageRanges: {
        adults: { min: 18, max: null },
        children: { min: 6, max: 17 },
        infants: { min: 0, max: 5 },
      },
      rates: { adults: 12000, children: 6000, infants: 0 },
    },
  } satisfies CreationQuote
  const markup = renderToStaticMarkup(
    <ReservationReview quote={personQuote} today="2026-10-30" />,
  )
  expect(markup).toContain('1 ×')
  expect(markup).not.toMatch(/>0 ×/)
  expect(markup).toContain('Podés crear la reserva igualmente')
})

it('renders authoritative nightly breakdown, pets and block discounts', () => {
  const detailed = {
    ...quote,
    input: { ...quote.input, pets: 1 },
    priceSnapshot: {
      ...quote.priceSnapshot,
      totalMinor: 850000,
      breakdown: {
        nights: [
          {
            date: '2026-10-30',
            baseMinor: 900000,
            humanMinor: 10000,
            petMinor: 5000,
          },
        ],
        accommodationMinor: 900000,
        humanMinor: 10000,
        discountMinor: 65000,
        petMinor: 5000,
        discountRuleIndex: 0,
      },
    },
  } satisfies CreationQuote
  const markup = renderToStaticMarkup(
    <ReservationReview quote={detailed} today="2026-10-30" />,
  )
  for (const text of [
    'Alojamiento',
    'Personas adicionales',
    'Descuento por bloques',
    'Mascotas',
    '30 de octubre',
  ])
    expect(markup).toContain(text)
})

const unitBreakdownQuote = {
  ...quote,
  input: {
    ...quote.input,
    checkOutDate: '2026-11-01',
    adults: 3,
    infants: 1,
    pets: 1,
  },
  priceSnapshot: {
    basis: 'per_unit',
    currency: 'MXN',
    baseNightlyPriceMinor: 80000,
    nights: 2,
    totalMinor: 218000,
    adjustmentMinor: -2000,
    adjustmentReason: 'Precio acordado',
    pricing: {
      basis: 'per_unit',
      baseNightlyPriceMinor: 80000,
      rates: { adults: 25000, children: 12500, infants: 0 },
      includedOccupancy: { adults: 2, children: 0, infants: 0 },
      extraPersonRates: { adults: 25000, children: 12500, infants: 0 },
      petNightlyPriceMinor: 10000,
      weekdays: [],
      discounts: [
        {
          blockNights: 2,
          repeat: true,
          benefit: { type: 'FIXED_AMOUNT', value: 10000 },
        },
      ],
    },
    breakdown: {
      nights: ['2026-10-30', '2026-10-31'].map((date) => ({
        date,
        baseMinor: 80000,
        humanMinor: 25000,
        petMinor: 10000,
        categoryCharges: { adults: 25000, children: 0, infants: 0 },
      })),
      accommodationMinor: 160000,
      humanMinor: 50000,
      categoryCharges: { adults: 50000, children: 0, infants: 0 },
      discountMinor: 10000,
      discountRuleIndex: 0,
      petMinor: 20000,
    },
  },
} satisfies CreationQuote

it('explains included guests, additional guests, pets, discount and agreed adjustment without duplicating charges', () => {
  const html = renderToStaticMarkup(
    <ReservationReview quote={unitBreakdownQuote} today="2026-10-30" />,
  ).replaceAll('\u00a0', ' ')
  for (const text of [
    'Desglose de tarifa',
    'Incluye por noche: 2 adultos',
    '1 adulto adicional',
    'Sin cargo',
    'MXN 800 por noche × 2 noches',
    'Bloques de 2 noches',
    'Precio acordado',
    '1 mascota',
  ])
    expect(html).toContain(text)
  expect(html).not.toContain('3 adultos adicionales')
  expect(html).not.toContain('Personas adicionales')
  expect(html).toContain('2.180')
})

it('shows actual nightly variation instead of a misleading constant-rate formula', () => {
  const varied = {
    ...unitBreakdownQuote,
    priceSnapshot: {
      ...unitBreakdownQuote.priceSnapshot,
      breakdown: {
        ...unitBreakdownQuote.priceSnapshot.breakdown,
        nights: [
          {
            ...unitBreakdownQuote.priceSnapshot.breakdown.nights[0],
            baseMinor: 95000,
          },
          {
            ...unitBreakdownQuote.priceSnapshot.breakdown.nights[1],
            baseMinor: 80000,
          },
        ],
        accommodationMinor: 175000,
      },
      totalMinor: 233000,
    },
  } satisfies CreationQuote
  const html = renderToStaticMarkup(
    <ReservationReview quote={varied} today="2026-10-30" />,
  )
  expect(html).toContain('Tarifa variable según la noche')
  expect(html).not.toContain('MXN 800 por noche × 2 noches')
  expect(html).toContain('antes del descuento por bloques')
})

it('groups only consecutive nights with matching charges in chronological order', () => {
  const breakdown = unitBreakdownQuote.priceSnapshot.breakdown
  const firstNight = breakdown.nights[0]
  const varied = {
    ...unitBreakdownQuote,
    priceSnapshot: {
      ...unitBreakdownQuote.priceSnapshot,
      nights: 6,
      breakdown: {
        ...breakdown,
        nights: [
          { ...firstNight, date: '2026-11-04' },
          { ...firstNight, date: '2026-10-31' },
          { ...firstNight, date: '2026-11-02', petMinor: 20000 },
          { ...firstNight, date: '2026-11-01' },
          firstNight,
          { ...firstNight, date: '2026-11-06' },
        ],
      },
    },
  } satisfies CreationQuote
  const html = renderToStaticMarkup(
    <ReservationReview quote={varied} today="2026-10-30" />,
  )
  expect(html).toMatch(
    /30 de octubre al 1 de noviembre · 3 noches.*2 de noviembre.*4 de noviembre.*6 de noviembre/,
  )
  expect(html).not.toContain('31 de octubre')
  expect(html).not.toContain('4 de noviembre al 6 de noviembre')
})

it('identifies per-bed fixed-price block discounts and the number of reserved beds', () => {
  const bed = {
    ...unitBreakdownQuote,
    requestedBeds: 2,
    priceSnapshot: {
      ...unitBreakdownQuote.priceSnapshot,
      basis: 'per_bed',
      pricing: {
        ...unitBreakdownQuote.priceSnapshot.pricing,
        basis: 'per_bed',
        discounts: [
          {
            blockNights: 7,
            repeat: true,
            benefit: { type: 'FIXED_PRICE', value: 140000 },
          },
        ],
      },
    },
  } satisfies CreationQuote
  const html = renderToStaticMarkup(
    <ReservationReview quote={bed} today="2026-10-30" />,
  )
  expect(html).toContain('Por cama')
  expect(html).toContain('2 camas reservadas')
  expect(html).toContain('por cama')
  expect(html).toContain('Bloques de 7 noches')
  expect(html).not.toContain('Incluye por noche')
})

it('uses backend category charges for person pricing and explains free infants', () => {
  const person = {
    ...quote,
    input: { ...quote.input, infants: 1 },
    priceSnapshot: {
      basis: 'per_person',
      currency: 'MXN',
      nights: 1,
      totalMinor: 12345,
      rates: { adults: 12345, children: 0, infants: 0 },
      ageRanges: {
        adults: { min: 18, max: null },
        children: { min: 4, max: 17 },
        infants: { min: 0, max: 3 },
      },
      breakdown: {
        nights: [
          {
            date: '2026-10-30',
            baseMinor: 0,
            humanMinor: 12345,
            petMinor: 0,
            categoryCharges: { adults: 12345, children: 0, infants: 0 },
          },
        ],
        accommodationMinor: 0,
        humanMinor: 12345,
        discountMinor: 0,
        discountRuleIndex: null,
        petMinor: 0,
        categoryCharges: { adults: 12345, children: 0, infants: 0 },
      },
    },
  } satisfies CreationQuote
  const html = renderToStaticMarkup(
    <ReservationReview quote={person} today="2026-10-30" />,
  )
  expect(html).toContain('Por persona')
  expect(html).toContain('Sin cargo')
  expect(html).toContain('123,45')
  expect(html).not.toContain('Alojamiento base')
  expect(html).not.toContain('0 mascotas')
  expect(html).not.toContain('Descuento por bloques')
})

it('explains the per-bed quantity without calculating a different total in the browser', () => {
  const bed = {
    ...unitBreakdownQuote,
    requestedBeds: 2,
    priceSnapshot: {
      ...unitBreakdownQuote.priceSnapshot,
      basis: 'per_bed',
      totalMinor: 200001,
      breakdown: {
        ...unitBreakdownQuote.priceSnapshot.breakdown,
        accommodationMinor: 100000,
        nights: ['2026-10-30', '2026-10-31'].map((date) => ({
          date,
          baseMinor: 50000,
          humanMinor: 0,
          petMinor: 10000,
        })),
      },
    },
  } satisfies CreationQuote
  const html = renderToStaticMarkup(
    <ReservationReview quote={bed} today="2026-10-30" />,
  ).replaceAll('\u00a0', ' ')
  expect(html).toContain('2 × MXN 250 por noche × 2 noches')
  expect(html).toContain('2.000,01')
})

it('retains negotiated adjustments on existing snapshots without a nightly breakdown', () => {
  const adjusted = {
    ...quote,
    priceSnapshot: {
      ...quote.priceSnapshot,
      totalMinor: 899000,
      adjustmentMinor: -1000,
      adjustmentReason: 'Acuerdo con recepción',
    },
  } satisfies CreationQuote
  const html = renderToStaticMarkup(
    <ReservationReview quote={adjusted} today="2026-10-30" />,
  )
  expect(html).toContain('Ajuste acordado')
  expect(html).toContain('Acuerdo con recepción')
})
