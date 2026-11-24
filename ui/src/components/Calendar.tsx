import { Box } from '@mui/material'
import { DayPicker } from '@daypicker/react'
import { es } from '@daypicker/react/locale/es'
import { useTranslation } from 'react-i18next'
import { uiProps, uiStyles } from '../app/theme'
import { dateFromIso, isoDate } from '../services/calendar'

export type CalendarDayStatus = {
  tone?: 'free' | 'partial' | 'none' | 'unlimited'
  label?: string
}

type CommonProps = {
  today: string
  disabled?: boolean
  minDate?: string
  days?: Record<string, CalendarDayStatus>
}
type RangeProps = CommonProps & {
  mode: 'range'
  month?: string
  onMonthChange?: (month: string) => void
  startDate: string
  endDate: string
  onChange: (startDate: string, endDate: string) => void
}
type SingleProps = CommonProps & {
  mode: 'single'
  month: string
  selectedDate?: string
  days: Record<string, CalendarDayStatus>
  onMonthChange: (month: string) => void
  onChange: (date: string) => void
}

/** ISO calendar dates stay independent of the browser's timezone and picker library. */
export default function Calendar(props: RangeProps | SingleProps) {
  const { t } = useTranslation()
  const common = {
    locale: es,
    timeZone: 'UTC',
    today: dateFromIso(props.today),
    showOutsideDays: true,
    fixedWeeks: true,
    navLayout: 'around' as const,
    modifiers: {
      free: (date: Date) => props.days?.[isoDate(date)]?.tone === 'free',
      partial: (date: Date) => props.days?.[isoDate(date)]?.tone === 'partial',
      none: (date: Date) => props.days?.[isoDate(date)]?.tone === 'none',
      unlimited: (date: Date) =>
        props.days?.[isoDate(date)]?.tone === 'unlimited',
    },
    modifiersClassNames: uiProps.calendarStatusClasses,
    labels: props.days
      ? {
          labelDayButton: (date: Date, modifiers: Record<string, boolean>) => {
            const iso = isoDate(date)
            const status = props.days?.[iso]
            const label = status ? status.label : t('calendar.noData')
            const day = modifiers.today ? `${iso}, ${t('calendar.today')}` : iso
            return label ? `${day}: ${label}` : day
          },
        }
      : undefined,
    disabled: props.disabled
      ? true
      : props.minDate
        ? { before: dateFromIso(props.minDate) }
        : false,
  }
  if (props.mode === 'range')
    return (
      <Box
        sx={
          props.days
            ? uiStyles.availabilityDateCalendar
            : uiStyles.dateRangeCalendar
        }
      >
        <DayPicker
          {...common}
          mode="range"
          defaultMonth={dateFromIso(props.startDate || props.today)}
          month={props.month ? dateFromIso(`${props.month}-01`) : undefined}
          onMonthChange={
            props.onMonthChange
              ? (month) => props.onMonthChange?.(isoDate(month).slice(0, 7))
              : undefined
          }
          selected={
            props.startDate
              ? {
                  from: dateFromIso(props.startDate),
                  to: props.endDate ? dateFromIso(props.endDate) : undefined,
                }
              : undefined
          }
          onSelect={(range) =>
            props.onChange(
              range?.from ? isoDate(range.from) : '',
              range?.to ? isoDate(range.to) : '',
            )
          }
          min={1}
          max={366}
          resetOnSelect
          required
          aria-label={t('dateRange.label')}
        />
      </Box>
    )

  return (
    <Box sx={uiStyles.availabilityDateCalendar}>
      <DayPicker
        {...common}
        mode="single"
        month={dateFromIso(`${props.month}-01`)}
        onMonthChange={(month) =>
          props.onMonthChange(isoDate(month).slice(0, 7))
        }
        selected={
          props.selectedDate ? dateFromIso(props.selectedDate) : undefined
        }
        onSelect={(date) => {
          if (date) props.onChange(isoDate(date))
        }}
        required
        disabled={
          props.disabled
            ? true
            : (date) =>
                !props.days[isoDate(date)] ||
                !isoDate(date).startsWith(props.month)
        }
        aria-label={t('calendar.title')}
      />
    </Box>
  )
}
