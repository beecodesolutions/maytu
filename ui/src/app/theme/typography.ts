import type { CSSProperties } from '@mui/material/styles'
import type { TypographyVariantsOptions } from '@mui/material/styles'

export const editorialFont = '"Source Serif 4", Georgia, serif'
export const operationalFont =
  '"Source Sans 3", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'

export type MaytuTypographyVariant =
  | 'pageTitle'
  | 'metric'
  | 'metricLarge'
  | 'metricSmall'
  | 'metricSecondary'
  | 'metricSeparator'
  | 'navigation'
  | 'brand'
  | 'brandCompact'
  | 'chartLabel'
  | 'chartTick'

declare module '@mui/material/styles' {
  interface TypographyVariants extends Record<
    MaytuTypographyVariant,
    CSSProperties
  > {}
  interface TypographyVariantsOptions extends Partial<
    Record<MaytuTypographyVariant, CSSProperties>
  > {}
}
declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides extends Record<
    MaytuTypographyVariant,
    true
  > {}
}

export const typography: TypographyVariantsOptions = {
  fontFamily: operationalFont,
  h1: {
    fontFamily: editorialFont,
    fontSize: '2.75rem',
    fontWeight: 600,
    lineHeight: 1.15,
  },
  h2: {
    fontFamily: editorialFont,
    fontSize: '2.25rem',
    fontWeight: 600,
    lineHeight: 1.2,
  },
  h3: {
    fontFamily: operationalFont,
    fontSize: '1rem',
    fontWeight: 700,
    lineHeight: 1.75,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  h4: {
    fontFamily: editorialFont,
    fontSize: '1.875rem',
    fontWeight: 600,
    lineHeight: 1.2,
  },
  h5: {
    fontFamily: operationalFont,
    fontSize: '1.25rem',
    fontWeight: 600,
    lineHeight: 1.35,
  },
  h6: {
    fontFamily: operationalFont,
    fontSize: '1.125rem',
    fontWeight: 600,
    lineHeight: 1.4,
  },
  subtitle1: {
    fontFamily: operationalFont,
    fontSize: '1rem',
    fontWeight: 700,
    lineHeight: 1.75,
  },
  subtitle2: {
    fontFamily: operationalFont,
    fontSize: '0.875rem',
    fontWeight: 600,
    lineHeight: 1.57,
  },
  body1: {
    fontFamily: operationalFont,
    fontSize: '0.9375rem',
    fontWeight: 400,
    lineHeight: 1.6,
  },
  body2: {
    fontFamily: operationalFont,
    fontSize: '0.875rem',
    fontWeight: 400,
    lineHeight: 1.5,
  },
  button: {
    fontFamily: operationalFont,
    fontSize: '0.875rem',
    fontWeight: 600,
    lineHeight: 1.75,
    textTransform: 'none',
  },
  caption: {
    fontFamily: operationalFont,
    fontSize: '0.75rem',
    fontWeight: 400,
    lineHeight: 1.66,
  },
  overline: {
    fontFamily: operationalFont,
    fontSize: '0.6875rem',
    fontWeight: 400,
    lineHeight: 2.66,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
  },
  pageTitle: {
    fontFamily: editorialFont,
    fontSize: '1.8rem',
    fontWeight: 650,
    lineHeight: 1.2,
    '@media (min-width:600px)': { fontSize: '2.125rem' },
  },
  metric: {
    fontFamily: operationalFont,
    fontSize: '2rem',
    fontWeight: 650,
    lineHeight: 1.2,
    fontVariantNumeric: 'tabular-nums',
  },
  metricLarge: {
    fontFamily: operationalFont,
    fontSize: '2rem',
    fontWeight: 650,
    lineHeight: 1.2,
    fontVariantNumeric: 'tabular-nums',
    '@media (min-width:600px)': { fontSize: '2.5rem' },
  },
  metricSmall: {
    fontFamily: operationalFont,
    fontSize: '1.5rem',
    fontWeight: 700,
    lineHeight: 1.2,
    fontVariantNumeric: 'tabular-nums',
  },
  metricSecondary: {
    fontFamily: operationalFont,
    fontSize: '1.25rem',
    fontWeight: 700,
    lineHeight: 1.35,
    fontVariantNumeric: 'tabular-nums',
  },
  metricSeparator: {
    fontFamily: operationalFont,
    fontSize: '0.65em',
    fontWeight: 650,
    lineHeight: 1,
  },
  navigation: {
    fontFamily: operationalFont,
    fontSize: '0.75rem',
    fontWeight: 500,
    lineHeight: 1.75,
    '@media (min-width:900px)': { fontSize: '0.875rem' },
  },
  brand: {
    fontFamily: editorialFont,
    fontSize: '2rem',
    fontWeight: 700,
    letterSpacing: '-0.04em',
    lineHeight: 1,
  },
  brandCompact: {
    fontFamily: editorialFont,
    fontSize: '1.5rem',
    fontWeight: 700,
    letterSpacing: '-0.04em',
    lineHeight: 1,
  },
  chartLabel: {
    fontFamily: operationalFont,
    fontSize: 13,
    fontWeight: 400,
    lineHeight: 1.5,
  },
  chartTick: {
    fontFamily: operationalFont,
    fontSize: 12,
    fontWeight: 400,
    lineHeight: 1.5,
  },
}

export const fontFaces = `
@font-face {
  font-family: 'Source Sans 3';
  font-style: normal;
  font-weight: 200 900;
  font-display: swap;
  src: url('/fonts/source-sans-3-latin-variable.woff2') format('woff2');
}
@font-face {
  font-family: 'Source Serif 4';
  font-style: normal;
  font-weight: 200 900;
  font-display: swap;
  src: url('/fonts/source-serif-4-latin-variable.woff2') format('woff2');
}
`
