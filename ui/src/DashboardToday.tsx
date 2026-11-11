import SectionCard from './components/SectionCard'
import { navigateWorkspace, workspaceHref } from './app/workspaceLocation'
import { uiProps, uiStyles, checkoutActionStyles } from './app/theme'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Box,
  Button,
  Divider,
  IconButton,
  List,
  ListItem,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { ChevronDown, LogIn, LogOut } from 'lucide-react'
import type {
  AccommodationType,
  CampingProfile,
  ReservationResponse,
  Stay,
} from '@camping/contracts'
import { todayInTimezone } from '@camping/contracts'
import {
  useAccommodationTypesQuery,
  useAccommodationUnitsQuery,
  useLazyReservationsQuery,
  useLazyStaysQuery,
} from './services/api'
import { addDays, typeNameById } from './services/calendar'
import AccommodationIdentity from './AccommodationIdentity'
import {
  buildAccommodationIdentity,
  indexReservationsById,
} from './services/accommodationIdentity'
import StayList, { type StaySelection } from './StayList'
import ReservationCheckInDialog from './ReservationCheckInDialog'
import {
  useWorkspaceDialog,
  openWorkspaceDialog,
  closeWorkspaceDialog,
} from './app/workspaceDialog'
import LucideIcon from './components/LucideIcon'
import DashboardWidget from './components/DashboardWidget'
import AccommodationFilter from './AccommodationFilter'
import { useAppDispatch, useAppSelector } from './app/hooks'
import {
  accommodationFilterChanged,
  selectAccommodationFilter,
} from './app/accommodationFilterSlice'

type DashboardProps = {
  profile: CampingProfile
  onSelect: (selection: StaySelection) => void
  refreshKey?: number
}
type DashboardState = {
  arrivals: ReservationResponse[]
  stays: Stay[]
  checkedInReservations: ReservationResponse[]
}
type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: DashboardState }
  | { status: 'error' }
type Page<T> = { items: T[]; total: number; pageSize: number }
type DepartureItem = Pick<
  Stay,
  | 'id'
  | 'responsibleName'
  | 'location'
  | 'adults'
  | 'children'
  | 'infants'
  | 'estimatedDeparture'
  | 'reservationId'
> & { reservation?: ReservationResponse; canCheckOut?: boolean }

function formatDate(value: string, language: string) {
  return new Intl.DateTimeFormat(language, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`))
}

function guestCount(reservation: ReservationResponse) {
  return reservation.adults + reservation.children + reservation.infants
}

async function allPages<T>(
  readPage: (page: number) => Promise<Page<T>>,
): Promise<T[]> {
  const first = await readPage(1)
  const pages = Math.ceil(first.total / first.pageSize)
  const items = [...first.items]
  for (let page = 2; page <= pages; page += 1) {
    const next = await readPage(page)
    items.push(...next.items)
  }
  return items
}

function useTodayData(
  profile: CampingProfile,
  refreshKey: number,
): LoadState & { retry: () => void } {
  const [readReservations] = useLazyReservationsQuery()
  const [readStays] = useLazyStaysQuery()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => {
    setState({ status: 'loading' })
    setAttempt((value) => value + 1)
  }, [])

  useEffect(() => {
    let active = true
    const today = todayInTimezone(profile.timezone)
    const tomorrow = addDays(today, 1)
    void Promise.all([
      allPages((page) =>
        readReservations({
          status: 'pending',
          checkInDate: today,
          checkOutDate: tomorrow,
          page,
          pageSize: 100,
        }).unwrap(),
      ),
      allPages((page) =>
        readReservations({
          status: 'confirmed',
          checkInDate: today,
          checkOutDate: tomorrow,
          page,
          pageSize: 100,
        }).unwrap(),
      ),
      allPages((page) =>
        readReservations({
          status: 'checked_in',
          page,
          pageSize: 100,
        }).unwrap(),
      ),
      allPages((page) =>
        readStays({ status: 'active', page, pageSize: 100 }).unwrap(),
      ),
    ])
      .then(([pending, confirmed, checkedInReservations, stays]) => {
        if (!active) return
        setState({
          status: 'ready',
          data: {
            arrivals: [...pending, ...confirmed]
              .filter(
                (reservation) =>
                  reservation.checkInDate === today &&
                  reservation.status === 'confirmed',
              )
              .sort((left, right) =>
                left.responsibleName.localeCompare(right.responsibleName),
              ),
            stays,
            checkedInReservations,
          },
        })
      })
      .catch(() => {
        if (active) setState({ status: 'error' })
      })
    return () => {
      active = false
    }
  }, [
    attempt,
    refreshKey,
    profile.activeGroups,
    profile.activePeople,
    profile.pendingAmountMinor,
    profile.timezone,
    readReservations,
    readStays,
  ])

  return { ...state, retry }
}

function TodaySectionHeading({
  title,
  count,
  overdue = false,
}: {
  title: string
  count: number
  overdue?: boolean
}) {
  return (
    <Box component="summary" sx={uiStyles.dashboardTodaySummary}>
      <Typography variant="h3" sx={uiStyles.dashboardTodayHeading(overdue)}>
        {title}
        <Typography
          component="span"
          variant="subtitle2"
          sx={uiStyles.dashboardTodayCount}
        >
          {count}
        </Typography>
        <ChevronDown aria-hidden="true" />
      </Typography>
    </Box>
  )
}

function ReservationRow({
  reservation,
  typeNames,
  typeModes,
  unitNames,
  language,
  onCheckIn,
}: {
  reservation: ReservationResponse
  typeNames: Map<string, string>
  typeModes: Map<string, string>
  unitNames: Map<string, string>
  language: string
  onCheckIn: () => void
}) {
  const { t } = useTranslation()
  const identity = buildAccommodationIdentity({
    reservation,
    typeNames,
    typeModes,
    unitNames,
    labels: {
      accommodation: t('home.accommodation'),
      freeCamping: t('home.freeCamping'),
      unknownUnit: t('home.unknownUnit'),
    },
  })
  return (
    <ListItem disableGutters divider sx={uiStyles.operationalListRow}>
      <Box sx={uiStyles.flexContent}>
        <Typography sx={uiStyles.strongWrappedText}>
          {reservation.responsibleName}
        </Typography>
        <AccommodationIdentity
          identity={identity}
          compactMobile
          people={guestCount(reservation)}
        />
      </Box>
      <Stack {...uiProps.rowSmall} sx={uiStyles.trailingActions}>
        <Tooltip title={t('home.checkInAction')}>
          <IconButton
            aria-label={t('home.checkInAction')}
            onClick={onCheckIn}
            sx={uiStyles.reservationRowIconButton}
          >
            <LucideIcon icon={LogIn} />
          </IconButton>
        </Tooltip>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={uiStyles.desktopBlock}
        >
          {formatDate(reservation.checkOutDate, language)}
        </Typography>
      </Stack>
    </ListItem>
  )
}

function DepartureRow({
  stay,
  typeNames,
  typeModes,
  unitNames,
  onCheckOut,
}: {
  stay: DepartureItem
  typeNames: Map<string, string>
  typeModes: Map<string, string>
  unitNames: Map<string, string>
  onCheckOut: () => void
}) {
  const { t } = useTranslation()
  const identity = buildAccommodationIdentity({
    reservation: stay.reservation,
    hasReservation: Boolean(stay.reservationId || stay.reservation),
    location: stay.location,
    typeNames,
    typeModes,
    unitNames,
    labels: {
      accommodation: t('home.accommodation'),
      freeCamping: t('home.freeCamping'),
      unknownUnit: t('home.unknownUnit'),
    },
  })
  return (
    <ListItem disableGutters divider sx={uiStyles.operationalListRow}>
      <Box sx={uiStyles.flexContent}>
        <Typography sx={uiStyles.strongWrappedText}>
          {stay.responsibleName}
        </Typography>
        <AccommodationIdentity
          identity={identity}
          compactMobile
          people={stay.adults + stay.children + stay.infants}
        />
      </Box>
      <Stack {...uiProps.rowSmall} sx={uiStyles.trailingActions}>
        {stay.canCheckOut && (
          <Tooltip title={t('home.checkOutAction')}>
            <IconButton
              aria-label={t('home.checkOutAction')}
              onClick={onCheckOut}
              sx={checkoutActionStyles}
            >
              <LucideIcon icon={LogOut} />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
    </ListItem>
  )
}

export default function DashboardToday({
  profile,
  onSelect,
  refreshKey = 0,
}: DashboardProps) {
  const { t, i18n } = useTranslation()
  const query = useTodayData(profile, refreshKey)
  const dispatch = useAppDispatch()
  const activeFilter = useAppSelector(selectAccommodationFilter)
  const dialog = useWorkspaceDialog()
  const dashboard = query.status === 'ready' ? query.data : null
  const checkInReservation =
    dialog?.kind === 'reservation-check-in'
      ? dashboard?.arrivals.find((reservation) => reservation.id === dialog.id)
      : null
  const types = useAccommodationTypesQuery()
  const units = useAccommodationUnitsQuery()
  const typeNames = useMemo(
    () => typeNameById((types.data ?? []) as AccommodationType[]),
    [types.data],
  )
  const typeModes = useMemo(
    () =>
      new Map((types.data ?? []).map((type) => [type.id, type.inventoryMode])),
    [types.data],
  )
  const unitNames = useMemo(
    () => new Map((units.data ?? []).map((unit) => [unit.id, unit.name])),
    [units.data],
  )
  const reservationsById = useMemo(
    () => indexReservationsById(dashboard?.checkedInReservations ?? []),
    [dashboard?.checkedInReservations],
  )
  const activeStays = (dashboard?.stays ?? []).filter((stay) => {
    if (activeFilter === 'total') return true
    const reservation = stay.reservationId
      ? reservationsById.get(stay.reservationId)
      : undefined
    const identity = buildAccommodationIdentity({
      reservation,
      hasReservation: Boolean(stay.reservationId),
      location: stay.location,
      typeModes,
      labels: {
        accommodation: t('home.accommodation'),
        freeCamping: t('home.freeCamping'),
        unknownUnit: t('home.unknownUnit'),
      },
    })
    return identity.kind === activeFilter
  })
  const today = todayInTimezone(profile.timezone)
  const linkedReservationIds = useMemo(
    () =>
      new Set(
        (dashboard?.stays ?? [])
          .map((stay) => stay.reservationId)
          .filter(Boolean),
      ),
    [dashboard?.stays],
  )
  const departures = useMemo(() => {
    if (!dashboard) return { today: [], overdue: [] }
    const todayStays = dashboard.stays.filter(
      (stay) => stay.estimatedDeparture === today,
    )
    const overdueStays = dashboard.stays.filter(
      (stay) =>
        Boolean(stay.estimatedDeparture) && stay.estimatedDeparture < today,
    )
    const unlinkedReservations: DepartureItem[] =
      dashboard.checkedInReservations
        .filter((reservation) => !linkedReservationIds.has(reservation.id))
        .map((reservation) => ({
          id: reservation.stayId ?? reservation.id,
          reservationId: null,
          responsibleName: reservation.responsibleName,
          location: '',
          adults: reservation.adults,
          children: reservation.children,
          infants: reservation.infants,
          pets: reservation.pets ?? 0,
          estimatedDeparture: reservation.checkOutDate,
          reservation,
          canCheckOut: Boolean(reservation.stayId),
        }))
    const withReservations = (items: Stay[]) =>
      items.map((stay) => ({
        ...stay,
        canCheckOut: true,
        reservation: stay.reservationId
          ? reservationsById.get(stay.reservationId)
          : undefined,
      }))
    return {
      today: [
        ...withReservations(todayStays),
        ...unlinkedReservations.filter(
          (item) => item.estimatedDeparture === today,
        ),
      ],
      overdue: [
        ...withReservations(overdueStays),
        ...unlinkedReservations.filter(
          (item) => item.estimatedDeparture < today,
        ),
      ],
    }
  }, [dashboard, linkedReservationIds, reservationsById, today])

  if (query.status === 'loading')
    return <Typography color="text.secondary">{t('home.loading')}</Typography>
  if (query.status === 'error')
    return (
      <Alert
        severity="error"
        action={<Button onClick={query.retry}>{t('common.retry')}</Button>}
      >
        {t('home.todayLoadError')}
      </Alert>
    )
  if (!dashboard) return null

  return (
    <Stack {...uiProps.stackSection}>
      <SectionCard
        title={t('home.todayTitle')}
        subtitle={`${formatDate(today, i18n.language)} · ${profile.timezone}`}
      >
        <Stack {...uiProps.stackSmall} divider={<Divider />}>
          <Box component="details" open>
            <TodaySectionHeading
              title={t('home.expectedArrivals')}
              count={dashboard.arrivals.length}
            />
            {dashboard.arrivals.length ? (
              <List disablePadding>
                {dashboard.arrivals.map((reservation) => (
                  <ReservationRow
                    key={reservation.id}
                    reservation={reservation}
                    typeNames={typeNames}
                    typeModes={typeModes}
                    unitNames={unitNames}
                    language={i18n.language}
                    onCheckIn={() =>
                      openWorkspaceDialog({
                        kind: 'reservation-check-in',
                        id: reservation.id,
                      })
                    }
                  />
                ))}
              </List>
            ) : (
              <Typography variant="body2" color="text.secondary">
                {t('home.noArrivals')}
              </Typography>
            )}
          </Box>
          <Box component="details" open>
            <TodaySectionHeading
              title={t('home.expectedDepartures')}
              count={departures.today.length}
            />
            {departures.today.length ? (
              <List disablePadding>
                {departures.today.map((stay) => (
                  <DepartureRow
                    key={stay.id}
                    stay={stay}
                    typeNames={typeNames}
                    typeModes={typeModes}
                    unitNames={unitNames}
                    onCheckOut={() =>
                      onSelect({ id: stay.id, action: 'close' })
                    }
                  />
                ))}
              </List>
            ) : (
              <Typography variant="body2" color="text.secondary">
                {t('home.noDepartures')}
              </Typography>
            )}
          </Box>
          {departures.overdue.length > 0 && (
            <Box component="details" open>
              <TodaySectionHeading
                title={t('home.overdueDepartures')}
                count={departures.overdue.length}
                overdue
              />
              <List disablePadding>
                {departures.overdue.map((stay) => (
                  <DepartureRow
                    key={stay.id}
                    stay={stay}
                    typeNames={typeNames}
                    typeModes={typeModes}
                    unitNames={unitNames}
                    onCheckOut={() =>
                      onSelect({ id: stay.id, action: 'close' })
                    }
                  />
                ))}
              </List>
            </Box>
          )}
        </Stack>
      </SectionCard>
      {checkInReservation && (
        <ReservationCheckInDialog
          reservation={checkInReservation}
          timezone={profile.timezone}
          onClose={() => closeWorkspaceDialog()}
          onSuccess={() => {
            closeWorkspaceDialog()
            query.retry()
          }}
        />
      )}
      <DashboardWidget
        titleId="active-stays-title"
        title={t('home.activeStays')}
        subtitle={t('home.activeStaysCount', { count: activeStays.length })}
        action={
          <AccommodationFilter
            value={activeFilter}
            onChange={(value) => dispatch(accommodationFilterChanged(value))}
          />
        }
      >
        <StayList
          items={activeStays}
          timezone={profile.timezone}
          onSelect={onSelect}
          typeNames={typeNames}
          typeModes={typeModes}
          unitNames={unitNames}
          reservationsById={reservationsById}
        />
        <Box>
          <Button href={workspaceHref('stays')} onClick={navigateWorkspace}>
            {t('navigation.allStays')}
          </Button>
        </Box>
      </DashboardWidget>
    </Stack>
  )
}
