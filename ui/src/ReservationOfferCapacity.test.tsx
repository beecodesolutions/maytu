import { it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ThemeProvider } from '@mui/material/styles'
import { darkTheme, lightTheme } from './app/theme'
import ReservationOfferCapacity from './ReservationOfferCapacity'
import { i18nReady } from './app/i18n'
import type { ReservationQuote } from '@camping/contracts'
await i18nReady
const priceSnapshot = {
  basis: 'per_unit',
  currency: 'MXN',
  baseNightlyPriceMinor: 80000,
  nights: 1,
  totalMinor: 80000,
} satisfies ReservationQuote['priceSnapshot']
it.each([lightTheme, darkTheme])(
  'oversized capacity uses the $palette.mode warning color without an alert box',
  (theme) => {
    const html = renderToStaticMarkup(
      <ThemeProvider theme={theme}>
        <ReservationOfferCapacity
          offer={{ priceSnapshot, capacityMatch: 'OVERSIZED', sparePlaces: 4 }}
        />
      </ThemeProvider>,
    )
    expect(html).toContain('sobran 4 plazas')
    expect(html).toContain(`color:${theme.palette.warning.main}`)
    expect(html).toContain('lucide-triangle-alert')
    expect(html).not.toContain('MuiAlert')
  },
)
it('shows the singular when one place is spare', () => {
  const html = renderToStaticMarkup(
    <ReservationOfferCapacity
      offer={{ priceSnapshot, capacityMatch: 'OVERSIZED', sparePlaces: 1 }}
    />,
  )
  expect(html).toContain('sobra 1 plaza</span>')
})
it('children overflow is a warning without an acceptance checkbox', () => {
  const html = renderToStaticMarkup(
    <ReservationOfferCapacity
      offer={{
        priceSnapshot,
        capacityMatch: 'INSUFFICIENT',
        occupancyWarning: { people: 3, maxOccupancy: 2 },
      }}
    />,
  )
  expect(html).toContain('Puedes crear la reserva igualmente')
  expect(html).not.toContain('type="checkbox"')
})
it('shared dormitories show available beds and requested quantity', () => {
  const html = renderToStaticMarkup(
    <ReservationOfferCapacity
      offer={{
        priceSnapshot,
        capacityMatch: 'EXACT',
        availableBeds: 4,
        requestedBeds: 3,
      }}
    />,
  )
  expect(html).toContain('4 camas disponibles')
  expect(html).toContain('3 solicitadas')
  expect(html).not.toContain('Más grande')
})
