import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ThemeProvider } from '@mui/material/styles'
import DateRangeCalendar from './DateRangeCalendar'
import { darkTheme, lightTheme } from '../app/theme'
import { i18nReady } from '../app/i18n'

await i18nReady

it.each([lightTheme, darkTheme])(
  'renders a localized, accessible range and dates in the shared theme',
  (theme) => {
    const markup = renderToStaticMarkup(
      <ThemeProvider theme={theme}>
        <DateRangeCalendar
          startDate="2026-10-31"
          endDate="2026-11-02"
          today="2026-10-31"
          onChange={() => {}}
        />
      </ThemeProvider>,
    )
    expect(markup).toContain('Seleccionar rango de fechas')
    expect(markup).toContain('31 de octubre')
    expect(markup).toContain('2 de noviembre')
    expect(markup).toContain('rdp-range_start')
    expect(markup).toContain('aria-selected="true"')
    expect(markup).not.toContain('type="date"')
  },
)

it('keeps an incomplete range visible while asking for its end', () => {
  const markup = renderToStaticMarkup(
    <ThemeProvider theme={lightTheme}>
      <DateRangeCalendar
        startDate="2026-10-31"
        endDate=""
        today="2026-10-31"
        onChange={() => {}}
      />
    </ThemeProvider>,
  )
  expect(markup).toContain('31 de octubre')
  expect(markup).toContain('Elige una fecha')
  expect(markup).not.toContain('Invalid Date')
})

it('disables days before the supplied camping date while allowing today', () => {
  const markup = renderToStaticMarkup(
    <ThemeProvider theme={lightTheme}>
      <DateRangeCalendar
        startDate="2026-10-31"
        endDate="2026-11-02"
        today="2026-10-31"
        minDate="2026-10-31"
        onChange={() => {}}
      />
    </ThemeProvider>,
  )
  const buttons = [
    ...markup.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g),
  ].map((match) => match[0])
  const yesterday = buttons.find((button) =>
    button.includes('30 de octubre de 2026'),
  )
  const today = buttons.find((button) =>
    button.includes('31 de octubre de 2026'),
  )
  expect(yesterday).toContain('disabled')
  expect(today).toBeDefined()
  expect(today).not.toContain('disabled')
})
