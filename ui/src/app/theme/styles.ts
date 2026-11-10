import { dateRangeCalendar } from './calendar'
import { alpha, type Theme } from '@mui/material/styles'
import type { SxProps } from '@mui/material'
import type { CSSProperties } from 'react'
import { workspaceSpacing } from '../workspaceSpacing'
import type { AvailabilitySummary } from '../../services/calendar'

export const formGridStyles = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
  gap: 2,
  alignItems: 'start',
  '& > .MuiTextField-root': { width: '100%', minWidth: 0 },
}

export function availabilityTone(
  tone: AvailabilitySummary['tone'],
  theme: Theme,
) {
  const dark = theme.palette.mode === 'dark'
  if (tone === 'free')
    return {
      backgroundColor: alpha(theme.palette.primary.main, dark ? 0.16 : 0.1),
      color: dark ? theme.palette.primary.light : theme.palette.primary.dark,
    }
  if (tone === 'partial')
    return {
      backgroundColor: alpha(theme.palette.secondary.main, dark ? 0.22 : 0.2),
      color: dark ? theme.palette.secondary.main : theme.palette.secondary.dark,
    }
  if (tone === 'none')
    return {
      backgroundColor: alpha(theme.palette.accent.main, dark ? 0.18 : 0.1),
      color: theme.palette.accent.main,
    }
  return {
    backgroundColor: theme.palette.action.hover,
    color: theme.palette.text.secondary,
  }
}

export const checkoutActionStyles = (theme: Theme) => {
  const palette = theme.palette.warning
  const dark = theme.palette.mode === 'dark'
  const background = dark ? palette.light : theme.palette.secondary.main
  return {
    width: 44,
    height: 44,
    bgcolor: background,
    color: theme.palette.getContrastText(background),
    '&:hover': {
      bgcolor: dark ? palette.main : theme.palette.secondary.dark,
      color: theme.palette.getContrastText(
        dark ? palette.main : theme.palette.secondary.dark,
      ),
    },
  }
}

export const uiStyles = {
  availabilityWorkspace: {
    display: 'grid',
    gridTemplateColumns: {
      xs: 'minmax(0, 1fr)',
      md: 'minmax(0, 1.3fr) minmax(0, 1fr)',
    },
    gap: 2,
    alignItems: 'start',
    '& > *': { minWidth: 0 },
  } satisfies SxProps<Theme>,
  dateRangeCalendar,
  availabilityToolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 1,
    flexWrap: 'wrap',
  } satisfies SxProps<Theme>,
  availabilityDateCalendar: (theme: Theme) => ({
    ...dateRangeCalendar(theme),
    ...Object.fromEntries(
      (['free', 'partial', 'none', 'unlimited'] as const).map((tone) => [
        `& .calendar-${tone}:not(.rdp-range_middle):not(.rdp-range_start):not(.rdp-range_end) .rdp-day_button`,
        {
          ...availabilityTone(tone, theme),
          '&:hover:not(:disabled)': {
            ...availabilityTone(tone, theme),
            filter: 'brightness(0.97)',
          },
        },
      ]),
    ),
    '& .rdp-day:not(.rdp-range_start):not(.rdp-range_end):not(.rdp-range_middle)':
      { padding: theme.spacing(0.25) },
  }),
  strongWrappedText: {
    fontWeight: 700,
    overflowWrap: 'anywhere',
  } satisfies SxProps<Theme>,
  wrappedText: { overflowWrap: 'anywhere' } satisfies SxProps<Theme>,
  stayDialogPaper: {
    m: { xs: 1, sm: 4 },
    width: { xs: 'calc(100% - 16px)', sm: 'calc(100% - 64px)' },
  } satisfies SxProps<Theme>,
  accommodationFilterToggleButtonGroup: {
    flexShrink: 0,
    '& .MuiToggleButton-root.Mui-selected': {
      bgcolor: 'primary.main',
      color: 'primary.contrastText',
      '&:hover': { bgcolor: 'primary.dark' },
    },
  } satisfies SxProps<Theme>,
  accommodationFilterLucideIcon: {
    mr: { xs: 0, sm: 0.5 },
    fontSize: 17,
  } satisfies SxProps<Theme>,
  desktopInline: {
    display: { xs: 'none', sm: 'inline' },
  } satisfies SxProps<Theme>,
  accommodationIdentityStack: (compactMobile: boolean): SxProps<Theme> => ({
    alignItems: 'center',
    flexWrap: compactMobile ? { xs: 'nowrap', sm: 'wrap' } : 'wrap',
    minWidth: 0,
    typography: 'body2',
    color: 'text.secondary',
  }),
  accommodationIdentityLucideIcon:
    (identityKind: 'camping' | 'individual' | 'neutral'): SxProps<Theme> =>
    (theme) => ({
      fontSize: 18,
      flexShrink: 0,
      color:
        identityKind === 'camping'
          ? theme.palette.mode === 'dark'
            ? 'primary.main'
            : 'primary.dark'
          : identityKind === 'individual'
            ? theme.palette.mode === 'dark'
              ? 'secondary.main'
              : 'secondary.dark'
            : 'text.secondary',
    }),
  accommodationIdentityBox: (compactMobile: boolean): SxProps<Theme> => ({
    minWidth: 0,
    overflow: compactMobile ? { xs: 'hidden', sm: 'visible' } : undefined,
    textOverflow: 'ellipsis',
    whiteSpace: compactMobile ? { xs: 'nowrap', sm: 'normal' } : undefined,
    typography: 'body2',
    color: 'text.secondary',
  }),
  mobileOnlyInline: {
    display: { xs: 'inline', sm: 'none' },
  } satisfies SxProps<Theme>,
  accommodationIdentityBox4: (compactMobile: boolean): SxProps<Theme> => ({
    display: compactMobile ? { xs: 'none', sm: 'inline' } : undefined,
  }),
  accommodationIdentityStack2: {
    alignItems: 'center',
    flexShrink: 0,
  } satisfies SxProps<Theme>,
  accommodationIdentityLucideIcon2: {
    fontSize: 16,
    color: 'text.secondary',
  } satisfies SxProps<Theme>,
  brand: (inverse: boolean): SxProps<Theme> => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 1,
    color: inverse ? 'navigation.contrastText' : 'primary.main',
    whiteSpace: 'nowrap',
  }),
  brandMark: {
    width: 32,
    height: 32,
    flexShrink: 0,
  } satisfies SxProps<Theme>,
  brandWordmark: {
    typography: 'brand',
  } satisfies SxProps<Theme>,
  centeredPage: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    px: 2,
  } satisfies SxProps<Theme>,
  loginScreenPaper: {
    p: 3,
    width: '100%',
    maxWidth: 380,
  } satisfies SxProps<Theme>,
  boldText: { fontWeight: 700 } satisfies SxProps<Theme>,
  formColumn: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  } satisfies SxProps<Theme>,
  fieldsetReset: {
    m: 0,
    p: 0,
    border: 0,
    minWidth: 0,
  } satisfies SxProps<Theme>,
  contactFields: {
    display: 'grid',
    gridTemplateColumns: 'minmax(140px, 2fr) minmax(0, 3fr)',
    gap: 1,
  } satisfies SxProps<Theme>,
  checkInDialogBox4: {
    display: 'grid',
    gridTemplateColumns: {
      xs: '1fr',
      sm: 'repeat(2, minmax(0, 1fr))',
    },
    gap: 2,
  } satisfies SxProps<Theme>,
  rowBetween: {
    alignItems: 'center',
    justifyContent: 'space-between',
  } satisfies SxProps<Theme>,
  checkInDialogDialogActions: { px: 3, py: 2, gap: 1 } satisfies SxProps<Theme>,
  smallTopGap: { mt: 1 } satisfies SxProps<Theme>,
  reservationReviewBox: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 2,
  } satisfies SxProps<Theme>,
  semiboldText: { fontWeight: 600 } satisfies SxProps<Theme>,
  reservationReviewStack: {
    flexWrap: 'wrap',
    alignItems: 'center',
  } satisfies SxProps<Theme>,
  tariffBreakdownRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    alignItems: 'baseline',
    gap: 2,
  } satisfies SxProps<Theme>,
  tariffBreakdownAmount: {
    textAlign: 'right',
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
  } satisfies SxProps<Theme>,
  reservationReviewStack2: {
    justifyContent: 'space-between',
    gap: 2,
  } satisfies SxProps<Theme>,
  reservationReviewTypography6: { textAlign: 'right' } satisfies SxProps<Theme>,
  reservationReviewBox2: {
    p: 2.5,
    borderRadius: 2,
    bgcolor: 'action.hover',
  } satisfies SxProps<Theme>,
  reservationReviewTypography7: {
    fontWeight: 800,
    mt: 0.5,
  } satisfies SxProps<Theme>,
  reservationCreateDialogDialogContent: {
    outline: 'none',
  } satisfies SxProps<Theme>,
  reservationCreateDialogTypography: {
    fontWeight: 700,
  } satisfies SxProps<Theme>,
  reservationCreateDialogBox3: {
    display: 'grid',
    gridTemplateColumns: {
      xs: 'minmax(0, 1fr)',
      sm: 'minmax(0, 1fr) minmax(0, 1fr) 100px',
    },
    gap: 2,
  } satisfies SxProps<Theme>,
  reservationCreateDialogBox4: {
    display: 'grid',
    gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
    gap: 2,
  } satisfies SxProps<Theme>,
  reservationCreateDialogDialogActions: {
    px: 3,
    py: 2,
    gap: 1,
    flexWrap: 'wrap',
  } satisfies SxProps<Theme>,
  campingIllustrationBox: {
    width: { xs: 72, sm: 100 },
    height: 'auto',
    flexShrink: 0,
    color: 'primary.main',
  } satisfies SxProps<Theme>,
  campingIllustrationBox2: ((theme) => ({
    fill: theme.palette.secondary.main,
    stroke: theme.palette.secondary.dark,
    strokeWidth: 3,
  })) satisfies SxProps<Theme>,
  campingIllustrationBox3: ((theme) => ({
    fill: theme.palette.secondary.main,
  })) satisfies SxProps<Theme>,
  campingIllustrationBox4: ((theme) => ({
    fill: theme.palette.secondary.light,
  })) satisfies SxProps<Theme>,
  campingIllustrationBox5: ((theme) => ({
    fill: theme.palette.primary.dark,
  })) satisfies SxProps<Theme>,
  pageHeader: {
    color: 'text.primary',
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    flexDirection: { xs: 'column', md: 'row' },
  } satisfies SxProps<Theme>,
  pageHeadingRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    flex: 1,
    minWidth: 0,
    width: '100%',
  } satisfies SxProps<Theme>,
  shrinkable: { minWidth: 0 } satisfies SxProps<Theme>,
  campgroundEyebrow: {
    display: 'block',
    mb: 0,
    lineHeight: 1.5,
    color: 'primary.main',
    letterSpacing: 2,
  } satisfies SxProps<Theme>,
  pageTitle: {
    overflowWrap: 'anywhere',
  } satisfies SxProps<Theme>,
  homeHeaderButton: {
    width: { xs: '100%', md: 'auto' },
    flexShrink: 0,
    minHeight: 44,
  } satisfies SxProps<Theme>,
  workspaceScroll: ((theme) => ({
    position: { md: 'fixed' },
    top: { md: theme.spacing(workspaceSpacing.desktopNavigationHeight) },
    bottom: { md: 0 },
    left: { md: 0 },
    right: { md: 0 },
    overflowY: { md: 'auto' },
  })) satisfies SxProps<Theme>,
  workspaceContent: ((theme) => ({
    maxWidth: 980,
    mx: 'auto',
    px: { xs: 2, sm: 3 },
    pt: {
      xs: 3,
      md: 5,
    },
    pb: {
      xs: `calc(${theme.spacing(workspaceSpacing.mobileNavigationHeight + workspaceSpacing.floatingActionGap + workspaceSpacing.floatingActionHeight + workspaceSpacing.contentBottomGap)} + env(safe-area-inset-bottom))`,
      md: 4,
    },
  })) satisfies SxProps<Theme>,
  panelPadding: { p: 2 } satisfies SxProps<Theme>,
  stayListListItem: {
    '&:last-child': { borderBottom: 0 },
    alignItems: { xs: 'center', sm: 'stretch' },
    flexDirection: { xs: 'row', sm: 'column', md: 'row' },
  } satisfies SxProps<Theme>,
  stayListListItemButton: {
    minWidth: 0,
    flex: 1,
    borderRadius: 1,
    px: 0,
  } satisfies SxProps<Theme>,
  stayListTypography2: {
    ml: 2,
    flexShrink: 0,
    display: { xs: 'none', sm: 'block' },
  } satisfies SxProps<Theme>,
  stayListStack: {
    display: { xs: 'flex', sm: 'grid' },
    flexDirection: 'row',
    gridTemplateColumns: {
      xs: 'minmax(0, 1fr) 44px',
      sm: 'minmax(0, 1fr) minmax(0, 1.3fr) 44px 44px',
      md: '100px 132px 44px 44px',
    },
    columnGap: { xs: 0.5, sm: 1, md: 3 },
    rowGap: 1,
    width: { xs: 'auto', sm: '100%', md: 'auto' },
    alignItems: 'center',
    pr: { xs: 0, sm: 1 },
    pl: { xs: 0, sm: 2, md: 0 },
    pb: { xs: 0, sm: 1, md: 0 },
    justifyContent: 'flex-end',
    flexShrink: 0,
  } satisfies SxProps<Theme>,
  stayListStack2: {
    alignItems: 'center',
    display: { xs: 'none', sm: 'flex' },
    justifyContent: { xs: 'flex-start', sm: 'flex-end' },
    gridColumn: { xs: '1 / -1', sm: 'auto' },
    minWidth: 0,
  } satisfies SxProps<Theme>,
  desktopBlock: {
    display: { xs: 'none', sm: 'block' },
  } satisfies SxProps<Theme>,
  stayListStack3: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    display: { xs: 'none', sm: 'flex' },
  } satisfies SxProps<Theme>,
  stayListTypography4: (stayAccountBalanceMinor: number): SxProps<Theme> => ({
    display: { xs: 'none', sm: 'inline' },
    fontWeight: 700,
    overflowWrap: 'anywhere',
    minWidth: 0,
    fontVariantNumeric: 'tabular-nums',
    color:
      stayAccountBalanceMinor < 0
        ? 'success.main'
        : stayAccountBalanceMinor > 0
          ? 'error.main'
          : 'text.secondary',
  }),
  stayListIconButton: {
    width: 44,
    height: 44,
    flexShrink: 0,
    color: 'text.secondary',
  } satisfies SxProps<Theme>,
  dashboardWidgetPaper: (height: CSSProperties['height']): SxProps<Theme> => ({
    p: 2,
    ...(height === undefined ? {} : { height }),
  }),
  dashboardWidgetStack: {
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 1,
  } satisfies SxProps<Theme>,
  flexContent: { minWidth: 0, flex: 1 } satisfies SxProps<Theme>,
  dashboardWidgetTypography: {
    display: 'flex',
    alignItems: 'center',
    gap: 1,
    minWidth: 0,
    overflowWrap: 'anywhere',
    fontWeight: 700,
  } satisfies SxProps<Theme>,
  alignCenter: { alignItems: 'center' } satisfies SxProps<Theme>,
  liveOccupancyCardBox: {
    display: 'grid',
    gridTemplateColumns: {
      xs: 'minmax(0, 1fr)',
      sm: 'minmax(0, 1.35fr) minmax(130px, 0.65fr)',
    },
    gap: { xs: 2, sm: 3 },
    alignItems: 'start',
  } satisfies SxProps<Theme>,
  occupancyMetricGrid: (showUnits: boolean): SxProps<Theme> => ({
    display: 'grid',
    gridTemplateColumns: showUnits
      ? 'repeat(2, minmax(0, 1fr))'
      : 'minmax(0, 1fr)',
    gap: { xs: 1.5, sm: 2 },
    alignItems: 'start',
  }),
  liveOccupancyCardBox5: {
    display: 'grid',
    gridTemplateColumns: {
      xs: 'max-content max-content max-content max-content',
      sm: 'max-content max-content',
    },
    justifyContent: { xs: 'start', sm: 'end' },
    alignItems: 'center',
    columnGap: 1,
    rowGap: 0.5,
    '& .occupancy-count': {
      color: 'accent.main',
      typography: 'metricSmall',

      textAlign: 'right',
    },
  } satisfies SxProps<Theme>,
  unitMetricTypography: {
    display: 'flex',
    alignItems: 'center',

    color: 'primary.main',
  } satisfies SxProps<Theme>,
  unitMetricBox2: {
    typography: 'metricSeparator',
    mx: '0.12em',
    lineHeight: 1,
  } satisfies SxProps<Theme>,
  wrapRow: { flexWrap: 'wrap' } satisfies SxProps<Theme>,
  metricTypography: (primary: boolean): SxProps<Theme> => ({
    color: primary ? 'primary.main' : 'accent.main',
  }),
  navigationBar: (barVisible: boolean): SxProps<Theme> => ({
    bgcolor: 'navigation.main',
    color: 'navigation.contrastText',
    '& .MuiIconButton-root': { color: 'inherit' },
    '& :focus-visible': {
      outlineColor: 'navigation.contrastText',
      outlineOffset: -4,
    },
    position: 'fixed',
    zIndex: (theme) => theme.zIndex.appBar,
    bottom: { xs: 0, md: 'auto' },
    left: 0,
    right: 0,
    top: { md: 0 },
    height: (theme) => ({
      md: theme.spacing(workspaceSpacing.desktopNavigationHeight),
    }),
    display: { md: 'flex' },
    alignItems: { md: 'center' },
    gap: { md: 4 },
    border: 0,
    pb: { xs: 'env(safe-area-inset-bottom)', md: 0 },
    px: { md: 3 },
    transform: {
      xs: barVisible ? 'translateY(0)' : 'translateY(100%)',
      md: 'none',
    },
    visibility: { xs: barVisible ? 'visible' : 'hidden', md: 'visible' },
    transition: barVisible
      ? 'transform 180ms ease-out'
      : 'transform 180ms ease-out, visibility 0s 180ms',
    '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
  }),
  desktopBrand: {
    display: { xs: 'none', md: 'block' },
    minWidth: 0,
    maxWidth: '35%',
  } satisfies SxProps<Theme>,
  flexGrow: { flex: 1 } satisfies SxProps<Theme>,
  navigationItem: (
    value: 'home' | 'settings' | 'stays' | 'reservations',
    activeSection: 'home' | 'settings' | 'stays' | 'reservations',
  ): SxProps<Theme> => ({
    display:
      value === 'settings' ? { xs: 'none', md: 'inline-flex' } : undefined,
    flex: { xs: 1, md: 'initial' },
    minWidth: 0,
    minHeight: (theme) => ({
      xs: theme.spacing(workspaceSpacing.mobileNavigationHeight),
      md: theme.spacing(workspaceSpacing.desktopNavigationHeight),
    }),
    ml: { md: value === 'settings' ? 'auto !important' : undefined },
    flexDirection: { xs: 'column', md: 'row' },
    justifyContent: 'center',
    gap: { xs: 0.5, md: 1.5 },
    px: { xs: 0.5, md: 1.5 },
    py: 1,
    borderRadius: 0,
    textTransform: 'none',
    borderBottom: '3px solid',
    borderBottomColor: activeSection === value ? 'accent.light' : 'transparent',
    color: activeSection === value ? 'accent.light' : 'navigation.contrastText',
    '&.Mui-focusVisible': {
      outlineColor: 'navigation.contrastText',
      outlineOffset: -4,
    },
    '&:hover': {
      bgcolor: (theme) => alpha(theme.palette.navigation.contrastText, 0.14),
    },
    typography: 'navigation',
    fontWeight: activeSection === value ? 700 : 500,
  }),
  navigationLabel: (
    value: 'home' | 'settings' | 'stays' | 'reservations',
  ): SxProps<Theme> => ({
    display: value === 'settings' ? { xs: 'inline', md: 'none' } : 'inline',
  }),
  workspaceNavigationStack2: {
    display: { xs: 'none', md: 'flex' },
    alignItems: 'center',
  } satisfies SxProps<Theme>,
  pendingBalanceCardPaper: {
    p: 2,
    borderRadius: 2,
    height: '100%',
  } satisfies SxProps<Theme>,
  goldIcon: {
    color: 'secondary.dark',
  } satisfies SxProps<Theme>,
  pendingBalanceCardTypography3: { fontWeight: 500 } satisfies SxProps<Theme>,
  compactPanel: { p: 1.5, borderRadius: 2 } satisfies SxProps<Theme>,
  availabilityGridBox: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
    gap: 0.5,
  } satisfies SxProps<Theme>,
  availabilityCalendarTypography: {
    textAlign: 'center',
    textTransform: 'capitalize',
    py: 0.5,
  } satisfies SxProps<Theme>,
  availabilityCalendarButton: (
    cellInMonth: boolean,
    colorsColor: any,
    colorsBackgroundColor: any,
    isSelected: boolean,
    theme: Theme,
  ): SxProps<Theme> => ({
    position: 'relative',
    minWidth: 0,
    minHeight: 44,
    p: 0.5,
    borderRadius: 1.25,
    color: cellInMonth ? colorsColor : 'text.disabled',
    backgroundColor: cellInMonth ? colorsBackgroundColor : 'transparent',
    border: '3px solid transparent',
    borderColor: isSelected ? 'selection.main' : 'transparent',
    boxShadow: 'none',
    '&:focus-visible': {
      outline: `2px solid ${theme.palette.selection.main}`,
      outlineOffset: 2,
    },
    '&:hover': {
      backgroundColor: cellInMonth ? colorsBackgroundColor : undefined,
      filter: 'brightness(0.97)',
    },
    '&.Mui-disabled': {
      color: cellInMonth ? colorsColor : 'text.disabled',
      backgroundColor: cellInMonth ? colorsBackgroundColor : 'transparent',
      opacity: cellInMonth ? 0.86 : 0.5,
    },
  }),
  availabilityCalendarTypography2: (
    isToday: boolean,
    isSelected: boolean,
  ): SxProps<Theme> => ({
    fontWeight: isToday || isSelected ? 800 : 600,
    display: 'grid',
    placeItems: 'center',
    width: 24,
    height: 24,
  }),
  availabilityCalendarBox: {
    position: 'absolute',
    top: 4,
    left: '50%',
    transform: 'translateX(-50%)',
    width: 4,
    height: 4,
    borderRadius: '50%',
    bgcolor: 'selection.main',
  } satisfies SxProps<Theme>,
  dayDetailStack: {
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 1,
  } satisfies SxProps<Theme>,
  dayDetailBox: { mt: 1.5 } satisfies SxProps<Theme>,
  bottomGap: { mb: 2 } satisfies SxProps<Theme>,
  dayDetailStack2: { flexWrap: 'wrap', mb: 2 } satisfies SxProps<Theme>,
  availabilityCalendarBox2: {
    borderTop: 1,
    borderColor: 'divider',
    pt: 1,
  } satisfies SxProps<Theme>,
  availabilityCalendarStack: {
    justifyContent: 'space-between',
    gap: 1,
  } satisfies SxProps<Theme>,
  availabilityCalendarStack2: {
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: { xs: 'center', sm: 'flex-start' },
    maxWidth: '100%',
  } satisfies SxProps<Theme>,
  availabilityCalendarTypography4: {
    minWidth: { xs: 100, sm: 130 },
    flex: '1 1 100px',
    textAlign: 'center',
    fontWeight: 700,
    textTransform: 'capitalize',
  } satisfies SxProps<Theme>,
  availabilityCalendarToggleButtonGroup: {
    flexWrap: 'wrap',
  } satisfies SxProps<Theme>,
  availabilityCalendarTypography5: {
    color: 'primary.dark',
  } satisfies SxProps<Theme>,
  availabilityCalendarTypography7: {
    color: 'accent.main',
  } satisfies SxProps<Theme>,
  reservationCheckInDialogButton: {
    alignSelf: 'flex-start',
  } satisfies SxProps<Theme>,
  reservationCheckInDialogBox: {
    p: 2,
    borderRadius: 1,
    bgcolor: 'action.hover',
  } satisfies SxProps<Theme>,
  reservationCheckInDialogDialogActions: {
    px: 3,
    py: 2,
    gap: 1,
  } satisfies SxProps<Theme>,
  operationalListRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 1,
    py: 1.25,
    '&:last-child': { borderBottom: 0 },
  } satisfies SxProps<Theme>,
  trailingActions: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexShrink: 0,
  } satisfies SxProps<Theme>,
  reservationRowIconButton: {
    width: 44,
    height: 44,
    bgcolor: 'success.main',
    color: 'success.contrastText',
    '&:hover': { bgcolor: 'success.dark' },
  } satisfies SxProps<Theme>,
  dashboardTodayPaper: { p: 2, borderRadius: 2 } satisfies SxProps<Theme>,
  dashboardTodayTypography3: ((theme) => ({
    mb: 0.5,
    fontWeight: 700,
    color: theme.palette.mode === 'dark' ? 'success.light' : 'success.dark',
  })) satisfies SxProps<Theme>,
  dashboardTodayTypography4: ((theme) => ({
    mb: 0.5,
    fontWeight: 700,
    color: theme.palette.mode === 'dark' ? 'warning.light' : 'warning.dark',
  })) satisfies SxProps<Theme>,
  dashboardTodayTypography5: ((theme) => ({
    mb: 0.5,
    fontWeight: 700,
    color: theme.palette.mode === 'dark' ? 'error.light' : 'error.dark',
  })) satisfies SxProps<Theme>,
  campingWorkspaceBox: {
    maxWidth: 640,
    mx: 'auto',
    px: 2,
    pt: 8,
  } satisfies SxProps<Theme>,
  mobileAppBar: {
    display: { xs: 'flex', md: 'none' },
    alignItems: 'center',
    justifyContent: 'space-between',
    px: 2,
    pt: 'env(safe-area-inset-top)',
    minHeight: 48,
    bgcolor: 'navigation.main',
    color: 'navigation.contrastText',
    border: 0,
    '& svg': { width: 24, height: 24 },
    '& [role=img] span': { typography: 'brandCompact' },
    '& .MuiIconButton-root': { width: 44, height: 44 },
    '& button.MuiIconButton-root': { color: 'inherit' },
    '& :focus-visible': { outlineColor: 'navigation.contrastText' },
  } satisfies SxProps<Theme>,
  mobileSettings: (
    section: 'home' | 'settings' | 'stays' | 'reservations',
  ): SxProps<Theme> => ({
    color: section === 'settings' ? 'accent.light' : 'inherit',
    borderBottom: '3px solid',
    borderBottomColor: section === 'settings' ? 'accent.light' : 'transparent',
    borderRadius: 0,
  }),
  campingWorkspaceBox2: {
    display: 'grid',
    gridTemplateColumns: {
      xs: 'minmax(0, 1fr)',
      sm: 'repeat(2, minmax(0, 1fr))',
      lg: 'repeat(3, minmax(0, 1fr))',
    },
    gap: 2,
    mb: 2,
  } satisfies SxProps<Theme>,
  campingWorkspaceBox3: {
    minWidth: 0,
    gridColumn: { sm: 'span 2', lg: 'span 2' },
  } satisfies SxProps<Theme>,
  topGap: { mt: 2 } satisfies SxProps<Theme>,
  staysFilters: { p: { xs: 2, sm: 3 } } satisfies SxProps<Theme>,
  campingWorkspaceTabs: {
    minWidth: 0,
    '& .MuiTab-root': { minWidth: 0, px: { xs: 1, sm: 2 } },
  } satisfies SxProps<Theme>,
  campingWorkspaceStack3: {
    alignItems: 'center',
    py: 1,
  } satisfies SxProps<Theme>,
  campingWorkspaceBox6: { flex: 1, minWidth: 0 } satisfies SxProps<Theme>,
  campingWorkspaceFab: {
    position: 'fixed',
    right: (theme) => ({ xs: theme.spacing(2), md: theme.spacing(4) }),
    bottom: (theme) => ({
      xs: `calc(${theme.spacing(workspaceSpacing.mobileNavigationHeight + workspaceSpacing.floatingActionGap)} + env(safe-area-inset-bottom))`,
      md: theme.spacing(3),
    }),
    minHeight: (theme) => theme.spacing(workspaceSpacing.floatingActionHeight),
    gap: 1,
    zIndex: (theme) => theme.zIndex.appBar,
  } satisfies SxProps<Theme>,
  loadingPanelBox: { py: 5 } satisfies SxProps<Theme>,
  infiniteStayLoaderBox: {
    textAlign: 'center',
    minHeight: 1,
  } satisfies SxProps<Theme>,
  stayDetailStack: { alignItems: 'stretch' } satisfies SxProps<Theme>,
  stayDetailBox: { ...formGridStyles, mt: 1 } satisfies SxProps<Theme>,
  campingWorkspaceStack4: {
    justifyContent: 'space-between',
  } satisfies SxProps<Theme>,
  formGrid: formGridStyles satisfies SxProps<Theme>,
  extraRowStack: {
    gridColumn: '1 / -1',
    gap: 1,
    alignItems: 'center',
    flexWrap: 'wrap',
  } satisfies SxProps<Theme>,
  extraRowTypography: {
    mr: 'auto',
    overflowWrap: 'anywhere',
  } satisfies SxProps<Theme>,
  settingsPanelStack: { mt: 3 } satisfies SxProps<Theme>,
  tabletAlignCenter: {
    alignItems: { sm: 'center' },
  } satisfies SxProps<Theme>,
  campingWorkspaceButton2: {
    textDecoration: 'underline',
  } satisfies SxProps<Theme>,
  settingsPanelDivider: { my: 2 } satisfies SxProps<Theme>,
  templateRowBox: {
    ...formGridStyles,
    gridTemplateColumns: {
      xs: 'minmax(0, 1fr)',
      sm: 'repeat(2, minmax(0, 1fr))',
      md: 'minmax(0, 1fr) minmax(0, 1.5fr) minmax(0, 0.8fr) auto',
    },
  } satisfies SxProps<Theme>,
  templateRowButton: { textDecoration: 'underline' } satisfies SxProps<Theme>,
  templateRowStack: {
    alignItems: 'center',
    minWidth: 0,
  } satisfies SxProps<Theme>,
  templateRowTypography: (templateEnabled: boolean): SxProps<Theme> => ({
    overflowWrap: 'anywhere',
    color: templateEnabled ? 'text.primary' : 'text.secondary',
  }),
  templateRowTypography2: { whiteSpace: 'nowrap' } satisfies SxProps<Theme>,
  sessionThemeControl: {
    position: 'fixed',
    top: 4,
    right: 8,
    zIndex: 10,
  } satisfies SxProps<Theme>,
  appBox2: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
  } satisfies SxProps<Theme>,
  occupancyChartPaper: {
    p: 2,
    borderRadius: 2,
    gridColumn: '1 / -1',
    minWidth: 0,
    bgcolor: 'secondary.light',
    color: 'secondary.contrastText',
    borderColor: 'divider',
  } satisfies SxProps<Theme>,
  occupancyChartTypography2: { mt: 0.5, mb: 3 } satisfies SxProps<Theme>,
  occupancyChartBox: { height: 240 } satisfies SxProps<Theme>,
}

export const lucideIconStyles = (
  sx: SxProps<Theme> | undefined,
): SxProps<Theme> => [
  { fill: 'none', stroke: 'currentColor' },
  ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
]

export const callingCodePopperProps = { popper: { style: { minWidth: 280 } } }
