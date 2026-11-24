import type { ReactNode } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import Calendar, { type CalendarDayStatus } from './Calendar'
import { useTranslation } from 'react-i18next'
import { uiProps, uiStyles } from '../app/theme'
import { dateFromIso } from '../services/calendar'

type Props = {
  startDate: string
  endDate: string
  today: string
  minDate?: string
  month?: string
  onMonthChange?: (month: string) => void
  days?: Record<string, CalendarDayStatus>
  summaryField?: ReactNode
  disabled?: boolean
  onChange: (startDate: string, endDate: string) => void
}

export default function DateRangeCalendar({
  startDate,
  endDate,
  today,
  minDate,
  month,
  onMonthChange,
  days,
  summaryField,
  disabled = false,
  onChange,
}: Props) {
  const { t, i18n } = useTranslation()
  const date = (value: string) =>
    value
      ? new Intl.DateTimeFormat(i18n.language, {
          day: 'numeric',
          month: 'long',
          ...(value.slice(0, 4) !== today.slice(0, 4)
            ? { year: 'numeric' }
            : {}),
          timeZone: 'UTC',
        }).format(dateFromIso(value))
      : t('dateRange.selectDate')
  return (
    <Stack {...uiProps.stackStandard}>
      <Box
        sx={
          summaryField
            ? uiStyles.dateRangeSummary
            : uiStyles.reservationReviewBox
        }
      >
        <Box aria-live="polite">
          <Typography variant="subtitle2" color="primary.main">
            {t('dateRange.start')}
          </Typography>
          <Typography
            sx={summaryField ? uiStyles.dateRangeSummaryValue : undefined}
          >
            {date(startDate)}
          </Typography>
        </Box>
        <Box aria-live="polite">
          <Typography variant="subtitle2" color="primary.main">
            {t('dateRange.end')}
          </Typography>
          <Typography
            sx={summaryField ? uiStyles.dateRangeSummaryValue : undefined}
          >
            {date(endDate)}
          </Typography>
        </Box>
        {summaryField}
      </Box>
      <Calendar
        mode="range"
        startDate={startDate}
        endDate={endDate}
        today={today}
        minDate={minDate}
        month={month}
        onMonthChange={onMonthChange}
        days={days}
        disabled={disabled}
        onChange={onChange}
      />
    </Stack>
  )
}
