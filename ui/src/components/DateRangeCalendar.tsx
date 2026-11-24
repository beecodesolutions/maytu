import { useId, useState, type ReactNode } from 'react'
import { Box, Stack, TextField, Typography } from '@mui/material'
import Calendar, { type CalendarDayStatus } from './Calendar'
import { useTranslation } from 'react-i18next'
import { uiProps, uiStyles } from '../app/theme'
import { addDays, dateFromIso } from '../services/calendar'
import { z } from 'zod'

type Props = {
  startDate: string
  endDate: string
  today: string
  minDate?: string
  month?: string
  onMonthChange?: (month: string) => void
  days?: Record<string, CalendarDayStatus>
  summaryField?: ReactNode
  editable?: boolean
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
  editable = false,
  disabled = false,
  onChange,
}: Props) {
  const { t, i18n } = useTranslation()
  const fieldId = useId()
  const [editedMonth, setEditedMonth] = useState<string>()
  const validStart = z.iso.date().safeParse(startDate).success
  const validEnd = z.iso.date().safeParse(endDate).success
  const pastStart = Boolean(minDate && validStart && startDate < minDate)
  const invalidEnd = validStart && validEnd && endDate <= startDate
  const firstDeparture =
    validStart && startDate < '9999-12-31' ? addDays(startDate, 1) : minDate
  const changeMonth = (nextMonth: string) => {
    setEditedMonth(nextMonth)
    onMonthChange?.(nextMonth)
  }
  const editDate = (name: 'start' | 'end', value: string) => {
    if (z.iso.date().safeParse(value).success) changeMonth(value.slice(0, 7))
    onChange(
      name === 'start' ? value : startDate,
      name === 'end' ? value : endDate,
    )
  }
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
        {(['start', 'end'] as const).map((name) => {
          const isStart = name === 'start'
          const value = isStart ? startDate : endDate
          const id = `${fieldId}-${name}`
          return editable ? (
            <TextField
              key={name}
              id={id}
              label={t(`dateRange.${name}`)}
              type="date"
              required
              fullWidth
              disabled={disabled}
              error={isStart ? pastStart : invalidEnd}
              value={value}
              onChange={(event) => editDate(name, event.target.value)}
              sx={uiStyles.dateRangeDateField}
              slotProps={{
                inputLabel: { shrink: true },
                htmlInput: {
                  min: isStart ? minDate : firstDeparture,
                  max: '9999-12-31',
                  'aria-describedby':
                    !isStart && invalidEnd ? `${fieldId}-error` : undefined,
                },
              }}
            />
          ) : (
            <Box key={name} aria-live="polite">
              <Typography variant="subtitle2" color="primary.main">
                {t(`dateRange.${name}`)}
              </Typography>
              <Typography>{date(value)}</Typography>
            </Box>
          )
        })}
        {summaryField}
      </Box>
      {editable && invalidEnd && (
        <Typography
          id={`${fieldId}-error`}
          role="alert"
          variant="caption"
          color="error"
        >
          {t('reservationCreate.invalidDeparture')}
        </Typography>
      )}
      <Calendar
        mode="range"
        startDate={validStart && !pastStart ? startDate : ''}
        endDate={validEnd && !invalidEnd ? endDate : ''}
        today={today}
        minDate={minDate}
        month={month ?? editedMonth}
        onMonthChange={editable ? changeMonth : onMonthChange}
        days={days}
        disabled={disabled}
        onChange={onChange}
      />
    </Stack>
  )
}
