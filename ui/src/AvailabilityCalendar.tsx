import SectionCard from './components/SectionCard'
import { uiProps, uiStyles } from './app/theme'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Box,
  Button,
  Chip,
  MenuItem,
  Stack,
  TextField,
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
  aggregateAvailabilityTone,
  availabilityForDate,
  monthKey,
  monthRange,
  typeNameById,
  type AvailabilitySummary,
} from './services/calendar'

type Props = { profile: CampingProfile; refreshKey?: number }
const allTypes = 'all'

type TypeAvailability = {
  type: AccommodationType
  summary: AvailabilitySummary
}

type Translate = ReturnType<typeof useTranslation>['t']

function statusLabel(
  tone: Exclude<AvailabilitySummary['tone'], 'unlimited'>,
  t: Translate,
) {
  if (tone === 'free') return t('calendar.free')
  if (tone === 'partial') return t('calendar.partial')
  return t('calendar.none')
}

function TypeSummary({ type, summary }: TypeAvailability) {
  const { t } = useTranslation()
  return summary.tone === 'unlimited' ? (
    <Typography variant="body2" color="text.secondary">
      {t('calendar.unlimitedReservations', { count: summary.reserved })}
    </Typography>
  ) : (
    <Box sx={uiStyles.dayDetailChips}>
      <Chip
        label={t(
          type.inventoryMode === 'shared'
            ? 'pricing.freeBeds'
            : 'calendar.freeCount',
          {
            count: summary.available ?? 0,
          },
        )}
        color="success"
        size="small"
      />
      <Chip
        label={t(
          type.inventoryMode === 'shared'
            ? 'pricing.occupiedBeds'
            : 'calendar.occupiedCount',
          {
            count: summary.reserved,
          },
        )}
        color="warning"
        size="small"
      />
      <Chip
        label={t(
          type.inventoryMode === 'shared'
            ? 'pricing.blockedBeds'
            : 'calendar.blockedCount',
          {
            count: summary.blocked,
          },
        )}
        color="error"
        size="small"
      />
    </Box>
  )
}

function DayDetail({
  date,
  typeId,
  availability,
  availabilityPending,
  typeNames,
  typeModes,
  unitNames,
}: {
  date: string
  typeId: string | undefined
  availability: TypeAvailability[]
  availabilityPending: boolean
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
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const items: ReservationResponse[] = []
        const statuses = new Set(['confirmed', 'checked_in'])
        let page = 1
        let total = 0
        do {
          const result = await readReservations({
            ...(typeId === undefined ? {} : { typeId }),
            checkInDate: date,
            checkOutDate: addDays(date, 1),
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
  }, [readReservations, date, typeId])
  const currentReservations = reservationState.items
  return (
    <SectionCard
      titleId="calendar-day-detail-title"
      title={new Intl.DateTimeFormat(i18n.language, {
        dateStyle: 'full',
        timeZone: 'UTC',
      }).format(new Date(`${date}T12:00:00Z`))}
    >
      <Box sx={uiStyles.dayDetailBox}>
        {availabilityPending && (
          <Typography color="text.secondary">{t('common.loading')}</Typography>
        )}
        {availability.length > 0 && (
          <Box sx={uiStyles.dayDetailTypes(typeId === undefined)}>
            {availability.map(({ type, summary }) => (
              <Stack key={type.id} {...uiProps.stackSmall}>
                {typeId === undefined && (
                  <Typography sx={uiStyles.boldText}>{type.name}</Typography>
                )}
                <TypeSummary type={type} summary={summary} />
              </Stack>
            ))}
          </Box>
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
    </SectionCard>
  )
}

export default function AvailabilityCalendar({
  profile,
  refreshKey = 0,
}: Props) {
  const { t } = useTranslation()
  const today = todayInTimezone(profile.timezone)
  const [month, setMonth] = useState(monthKey(today))
  const [selectedType, setSelectedType] = useState(allTypes)
  const [selectedDate, setSelectedDate] = useState('')
  const range = useMemo(() => monthRange(month), [month])
  const types = useAccommodationTypesQuery()
  const units = useAccommodationUnitsQuery()
  const enabledTypes = (types.data ?? []).filter((type) => type.enabled)
  const displayedType = enabledTypes.find((type) => type.id === selectedType)
  const activeTypeId = displayedType?.id
  const availability = useAvailabilityQuery(
    {
      checkInDate: range.start,
      checkOutDate: range.end,
      ...(activeTypeId === undefined ? {} : { typeId: activeTypeId }),
    },
    { skip: !types.data?.length },
  )
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
  const visibleDate = selectedDate.startsWith(month)
    ? selectedDate
    : month === monthKey(today)
      ? today
      : range.start
  const displayedTypes = displayedType ? [displayedType] : enabledTypes
  const availabilityByType = new Map(
    availability.currentData?.types.map((item) => [item.typeId, item]),
  )
  const availabilityByDate = range.days
    .filter((day) => day.inMonth)
    .map(({ date }) => ({
      date,
      typeSummaries: displayedTypes.flatMap((type) => {
        const summary = availabilityForDate(
          availabilityByType.get(type.id),
          date,
        )
        return summary ? [{ type, summary }] : []
      }),
    }))

  const days: Record<string, CalendarDayStatus> = {}
  for (const { date, typeSummaries } of availabilityByDate) {
    const summaries = typeSummaries.map(({ summary }) => summary)
    const tone = displayedType
      ? summaries[0]?.tone
      : aggregateAvailabilityTone(summaries)
    if (tone === 'unlimited') {
      days[date] = {}
    } else if (tone) {
      days[date] = { tone, label: statusLabel(tone, t) }
    } else if (!displayedType && availability.currentData) {
      days[date] = { label: t('calendar.noData') }
    }
  }

  return (
    <Box sx={uiStyles.availabilityWorkspace}>
      <SectionCard
        title={t('calendar.title')}
        subtitle={t('navigation.reservationsHelp')}
      >
        <Box sx={uiStyles.availabilityToolbar}>
          {Boolean(types.data?.length) && (
            <Box sx={uiStyles.availabilityTypeFilters}>
              <Button
                variant={activeTypeId ? 'outlined' : 'contained'}
                size="small"
                aria-pressed={!activeTypeId}
                onClick={() => setSelectedType(allTypes)}
              >
                {t('calendar.allTypes')}
              </Button>
              <TextField
                select
                size="small"
                fullWidth
                label={t('reservationCreate.type')}
                value={activeTypeId ?? ''}
                disabled={enabledTypes.length === 0}
                onChange={(event) => setSelectedType(event.target.value)}
              >
                {enabledTypes.map((type) => (
                  <MenuItem key={type.id} value={type.id}>
                    {type.name}
                  </MenuItem>
                ))}
              </TextField>
            </Box>
          )}
          <Button
            size="small"
            disabled={!types.data?.length}
            onClick={() => {
              setMonth(monthKey(today))
              setSelectedDate(today)
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
                  if (!availability.isUninitialized) void availability.refetch()
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
        <Stack {...uiProps.stackMedium}>
          {Boolean(types.data?.length) && (
            <Box component="section">
              <Calendar
                mode="single"
                today={today}
                month={month}
                selectedDate={visibleDate}
                onMonthChange={setMonth}
                onChange={setSelectedDate}
                days={days}
              />
            </Box>
          )}
          <CalendarLegend />
        </Stack>
      </SectionCard>
      {Boolean(types.data?.length) && (
        <DayDetail
          key={`${visibleDate}:${activeTypeId ?? allTypes}:${refreshKey}`}
          date={visibleDate}
          typeId={activeTypeId}
          availability={
            availabilityByDate.find(({ date }) => date === visibleDate)
              ?.typeSummaries ?? []
          }
          availabilityPending={
            availability.isFetching && !availability.currentData
          }
          typeNames={typeNames}
          typeModes={typeModes}
          unitNames={unitNames}
        />
      )}
    </Box>
  )
}
