import { uiProps, uiStyles } from './app/theme'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import Calendar, { type CalendarDayStatus } from './components/Calendar'
import CalendarLegend from './components/CalendarLegend'
import AccommodationIdentity from './AccommodationIdentity'
import { buildAccommodationIdentity } from './services/accommodationIdentity'
import type {
  AccommodationType,
  CampingProfile,
  ReservationResponse,
} from '@camping/contracts'
import { todayInTimezone } from '@camping/contracts'
import {
  useAccommodationTypesQuery,
  useAccommodationUnitsQuery,
  useAvailabilityQuery,
  useLazyReservationsQuery,
} from './services/api'
import {
  addDays,
  availabilityForDate,
  monthKey,
  monthRange,
  typeNameById,
  type AvailabilitySummary,
} from './services/calendar'

type Props = { profile: CampingProfile; refreshKey?: number }
type SelectedDay = { date: string; typeId: string } | null

type Translate = ReturnType<typeof useTranslation>['t']

function statusLabel(summary: AvailabilitySummary | null, t: Translate) {
  if (!summary) return t('calendar.noData')
  if (summary.tone === 'free') return t('calendar.free')
  if (summary.tone === 'partial') return t('calendar.partial')
  if (summary.tone === 'none') return t('calendar.none')
  return t('calendar.unlimited')
}

function DayDetail({
  selected,
  summary,
  type,
  typeNames,
  typeModes,
  unitNames,
}: {
  selected: SelectedDay
  summary: AvailabilitySummary | null
  type: AccommodationType | undefined
  typeNames: Map<string, string>
  typeModes: Map<string, string>
  unitNames: Map<string, string>
}) {
  const { t, i18n } = useTranslation()
  const [readReservations] = useLazyReservationsQuery()
  const [reservationState, setReservationState] = useState<{
    status: 'idle' | 'loading' | 'ready' | 'error'
    items: ReservationResponse[]
  }>({ status: 'loading', items: [] })
  const selectedDate = selected?.date
  const selectedTypeId = selected?.typeId
  useEffect(() => {
    if (!selectedDate || !selectedTypeId) return
    let active = true
    void (async () => {
      try {
        const items: ReservationResponse[] = []
        const statuses = new Set(['pending', 'confirmed', 'checked_in'])
        let page = 1
        let total = 0
        do {
          const result = await readReservations({
            typeId: selectedTypeId,
            checkInDate: selectedDate,
            checkOutDate: addDays(selectedDate, 1),
            page,
            pageSize: 100,
          }).unwrap()
          total = result.total
          items.push(
            ...result.items.filter((item) => statuses.has(item.status)),
          )
          page += 1
        } while ((page - 1) * 100 < total)
        if (active) setReservationState({ status: 'ready', items })
      } catch {
        if (active) setReservationState({ status: 'error', items: [] })
      }
    })()
    return () => {
      active = false
    }
  }, [readReservations, selectedDate, selectedTypeId])
  if (!selected || !type) return null
  const currentReservations = reservationState.items
  return (
    <Paper
      component="section"
      aria-labelledby="calendar-day-detail-title"
      variant="outlined"
      sx={uiStyles.compactPanel}
    >
      <Stack {...uiProps.row} sx={uiStyles.dayDetailStack}>
        <Box>
          <Typography
            id="calendar-day-detail-title"
            variant="h3"
          >
            {new Intl.DateTimeFormat(i18n.language, {
              dateStyle: 'full',
              timeZone: 'UTC',
            }).format(new Date(`${selected.date}T12:00:00Z`))}
          </Typography>
        </Box>
      </Stack>
      <Box sx={uiStyles.dayDetailBox}>
        {!summary ? (
          <Typography color="text.secondary" sx={uiStyles.bottomGap}>
            {t('common.loading')}
          </Typography>
        ) : summary.tone === 'unlimited' ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={uiStyles.bottomGap}
          >
            {t('calendar.unlimitedReservations', { count: summary.reserved })}
          </Typography>
        ) : (
          <Stack {...uiProps.rowSmall} sx={uiStyles.dayDetailStack2}>
            <Chip
              label={t(
                type?.inventoryMode === 'shared'
                  ? 'pricing.freeBeds'
                  : 'calendar.freeCount',
                {
                  count: summary?.available ?? 0,
                },
              )}
              color="success"
              size="small"
            />
            <Chip
              label={t(
                type?.inventoryMode === 'shared'
                  ? 'pricing.occupiedBeds'
                  : 'calendar.occupiedCount',
                {
                  count: summary?.reserved ?? 0,
                },
              )}
              color="warning"
              size="small"
            />
            <Chip
              label={t(
                type?.inventoryMode === 'shared'
                  ? 'pricing.blockedBeds'
                  : 'calendar.blockedCount',
                {
                  count: summary?.blocked ?? 0,
                },
              )}
              color="error"
              size="small"
            />
          </Stack>
        )}
        {reservationState.status === 'loading' && (
          <Typography color="text.secondary">{t('common.loading')}</Typography>
        )}
        {reservationState.status === 'error' && (
          <Alert severity="error">{t('calendar.detailError')}</Alert>
        )}
        {reservationState.status === 'ready' &&
          currentReservations.length === 0 && (
            <Typography color="text.secondary">
              {t('calendar.noReservations')}
            </Typography>
          )}
        <Stack {...uiProps.stackMedium}>
          {currentReservations.map((reservation) => (
            <Box key={reservation.id} sx={uiStyles.availabilityCalendarBox2}>
              <Stack {...uiProps.row} sx={uiStyles.availabilityCalendarStack}>
                <Typography sx={uiStyles.boldText}>
                  {reservation.responsibleName}
                </Typography>
                <Chip
                  size="small"
                  label={t(`calendar.status.${reservation.status}`)}
                />
              </Stack>
              <AccommodationIdentity
                identity={buildAccommodationIdentity({
                  reservation,
                  typeNames,
                  typeModes,
                  unitNames,
                  labels: {
                    accommodation: t('home.accommodation'),
                    freeCamping: t('home.freeCamping'),
                    unknownUnit: t('home.unknownUnit'),
                  },
                })}
                people={
                  reservation.adults +
                  reservation.children +
                  reservation.infants
                }
              />
              <Typography variant="caption" color="text.secondary">
                {reservation.checkInDate} → {reservation.checkOutDate}
              </Typography>
            </Box>
          ))}
        </Stack>
      </Box>
    </Paper>
  )
}

export default function AvailabilityCalendar({
  profile,
  refreshKey = 0,
}: Props) {
  const { t } = useTranslation()
  const today = todayInTimezone(profile.timezone)
  const [month, setMonth] = useState(monthKey(today))
  const [selectedType, setSelectedType] = useState<string>('')
  const [selectedDay, setSelectedDay] = useState<SelectedDay>(null)
  const range = useMemo(() => monthRange(month), [month])
  const types = useAccommodationTypesQuery()
  const units = useAccommodationUnitsQuery()
  const enabledTypes = useMemo(
    () => (types.data ?? []).filter((type) => type.enabled),
    [types.data],
  )
  const preferredType = useMemo(
    () =>
      enabledTypes.find((type) => type.inventoryMode === 'individual') ??
      enabledTypes[0],
    [enabledTypes],
  )
  const activeTypeId =
    enabledTypes.find((type) => type.id === selectedType)?.id ??
    preferredType?.id ??
    ''
  const availability = useAvailabilityQuery(
    {
      checkInDate: range.start,
      checkOutDate: range.end,
      ...(activeTypeId ? { typeId: activeTypeId } : {}),
    },
    { skip: enabledTypes.length === 0 },
  )
  const displayedType = enabledTypes.find((type) => type.id === activeTypeId)
  const unitNames = useMemo(
    () => new Map((units.data ?? []).map((unit) => [unit.id, unit.name])),
    [units.data],
  )
  const typeNames = useMemo(() => typeNameById(types.data ?? []), [types.data])
  const typeModes = useMemo(
    () =>
      new Map((types.data ?? []).map((type) => [type.id, type.inventoryMode])),
    [types.data],
  )
  const selectedTypeData = availability.currentData?.types ?? []
  const selectedAccommodationType = enabledTypes.find(
    (type) => type.id === selectedDay?.typeId,
  )
  const visibleSelectedDay =
    activeTypeId &&
    selectedAccommodationType?.id === activeTypeId &&
    selectedDay?.date.startsWith(month)
      ? selectedDay
      : activeTypeId
        ? {
            date: month === monthKey(today) ? today : range.start,
            typeId: activeTypeId,
          }
        : null
  const visibleSummary = visibleSelectedDay
    ? availabilityForDate(
        selectedTypeData.find(
          (item) => item.typeId === visibleSelectedDay.typeId,
        ),
        visibleSelectedDay.date,
      )
    : null
  const visibleAccommodationType = enabledTypes.find(
    (type) => type.id === visibleSelectedDay?.typeId,
  )

  return (
    <Stack {...uiProps.stackMedium}>
      <Box sx={uiStyles.availabilityToolbar}>
        {enabledTypes.length > 0 && (
          <ToggleButtonGroup
            value={activeTypeId}
            exclusive
            onChange={(_, value: string | null) =>
              value && setSelectedType(value)
            }
            aria-label={t('calendar.typeFilter')}
            size="small"
            sx={uiStyles.availabilityCalendarToggleButtonGroup}
          >
            {enabledTypes.map((type) => (
              <ToggleButton key={type.id} value={type.id}>
                {type.name}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        )}
        <Button
          size="small"
          disabled={!activeTypeId}
          onClick={() => {
            setMonth(monthKey(today))
            if (activeTypeId)
              setSelectedDay({ date: today, typeId: activeTypeId })
          }}
        >
          {t('calendar.today')}
        </Button>
      </Box>
      {types.isLoading || availability.isLoading ? (
        <Typography color="text.secondary">{t('common.loading')}</Typography>
      ) : null}
      {(types.isError || availability.isError) && (
        <Alert
          severity="error"
          action={
            <Button
              onClick={() => {
                void types.refetch()
                void availability.refetch()
              }}
            >
              {t('common.retry')}
            </Button>
          }
        >
          {t('calendar.loadError')}
        </Alert>
      )}
      {!types.isLoading && enabledTypes.length === 0 && (
        <Alert severity="info">{t('calendar.empty')}</Alert>
      )}
      <Box sx={uiStyles.availabilityWorkspace}>
        <Stack {...uiProps.stackMedium}>
          {displayedType && (
            <Box component="section">
              <Calendar
                mode="single"
                today={today}
                month={month}
                selectedDate={visibleSelectedDay?.date}
                onMonthChange={setMonth}
                onChange={(date) =>
                  setSelectedDay({ date, typeId: displayedType.id })
                }
                days={Object.fromEntries(
                  range.days
                    .filter((day) => day.inMonth)
                    .flatMap((day) => {
                      const summary = availabilityForDate(
                        selectedTypeData.find(
                          (item) => item.typeId === displayedType.id,
                        ),
                        day.date,
                      )
                      return summary
                        ? [
                            [
                              day.date,
                              {
                                tone: summary.tone,
                                label: statusLabel(summary, t),
                              } satisfies CalendarDayStatus,
                            ],
                          ]
                        : []
                    }),
                )}
              />
            </Box>
          )}
          <CalendarLegend />
        </Stack>
        {visibleSelectedDay && (
          <DayDetail
            key={`${visibleSelectedDay.date}:${visibleSelectedDay.typeId}:${refreshKey}`}
            selected={visibleSelectedDay}
            summary={visibleSummary}
            type={visibleAccommodationType}
            typeNames={typeNames}
            typeModes={typeModes}
            unitNames={unitNames}
          />
        )}
      </Box>
    </Stack>
  )
}
