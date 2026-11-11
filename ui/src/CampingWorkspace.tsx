import TabbedSection from './components/TabbedSection'
import SectionTabs from './components/SectionTabs'
import SectionCard from './components/SectionCard'
import PricingSettings from './PricingSettings'
import CampingProfileSettings from './CampingProfileSettings'
import { uiProps, uiStyles } from './app/theme'
import AccommodationFilter from './AccommodationFilter'
import { useAppDispatch, useAppSelector } from './app/hooks'
import {
  accommodationFilterChanged,
  selectAccommodationFilter,
} from './app/accommodationFilterSlice'
import { scrollWorkspaceToTop } from './app/workspaceScroll'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Fab,
  FormControlLabel,
  Switch,
  IconButton,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  Tab,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  ChevronDown,
  Pencil,
  Plus,
  RotateCcw,
  Settings,
  Trash2,
} from 'lucide-react'
import LucideIcon from './components/LucideIcon'
import MoneyField from './components/MoneyField'
import { ageRangesSchema, paymentInputSchema } from '@camping/contracts'
import type {
  CampingProfile,
  PaymentInput,
  StayQuote,
  ExtraTemplate,
  SessionUser,
  Stay,
  ReservationResponse,
} from '@camping/contracts'
import { formatMoney } from './services/money'
import {
  useAccommodationTypesQuery,
  useAccommodationUnitsQuery,
  useLazyReservationQuery,
  useAddExtraMutation,
  useAddPaymentMutation,
  useCampingQuery,
  useCloseStayMutation,
  useCreateExtraTemplateMutation,
  useExtraTemplatesQuery,
  useDeleteExtraMutation,
  useLogoutMutation,
  useQuoteMutation,
  useStayQuery,
  useInfiniteStaysInfiniteQuery,
  useUpdateExtraMutation,
  useUpdateExtraTemplateMutation,
  useUpdateRatesMutation,
  useUpdateMoneySettingsMutation,
  useUpdateOccupancySettingsMutation,
} from './services/api'
import CheckInDialog from './CheckInDialog'
import ReservationCreateDialog from './ReservationCreateDialog'
import ReservationDetailDialog from './ReservationDetailDialog'
import { todayInTimezone } from './checkIn/schema'
import HomeHeader from './HomeHeader'
import WorkspaceLayout from './WorkspaceLayout'
import MaytuBrand from './components/MaytuBrand'
import StayList, { type StayAction, type StaySelection } from './StayList'
import OccupancyCard from './OccupancyCard'
import WorkspaceNavigation from './WorkspaceNavigation'
import WorkspaceUserMenu from './WorkspaceUserMenu'
import {
  navigateWorkspace,
  settingsTabHref,
  useSettingsTab,
  useWorkspaceSection,
  workspaceHref,
} from './app/workspaceLocation'
import PendingBalanceCard from './PendingBalanceCard'
import { useTimeOfDay } from './app/timeOfDay'
import AvailabilityCalendar from './AvailabilityCalendar'
import DashboardToday from './DashboardToday'
import { createUuid } from './services/uuid'
import {
  useWorkspaceDialog,
  openWorkspaceDialog,
  replaceWorkspaceDialog,
  closeWorkspaceDialog,
} from './app/workspaceDialog'

type WorkspaceProps = {
  user: SessionUser
  themeMode: 'light' | 'dark'
  onToggleTheme: () => void
}

function countPeople(stay: Stay) {
  return stay.adults + stay.children + stay.infants
}
function ageLabel(range: { min: number; max: number | null }) {
  return range.max === null ? `${range.min}+` : `${range.min}–${range.max}`
}
function errorStatus(error: unknown) {
  return typeof error === 'object' && error !== null && 'status' in error
    ? String(error.status)
    : ''
}

export default function CampingWorkspace({
  user,
  themeMode,
  onToggleTheme,
}: WorkspaceProps) {
  const { t } = useTranslation()
  const { greeting } = useTimeOfDay()
  const section = useWorkspaceSection()
  const [stayStatus, setStayStatus] = useState<'active' | 'closed'>('active')
  const dispatch = useAppDispatch()
  const accommodation = useAppSelector(selectAccommodationFilter)
  const dialog = useWorkspaceDialog()
  const selection = dialog?.kind === 'stay' ? dialog : null
  const setSelection = (value: StaySelection) =>
    openWorkspaceDialog({ kind: 'stay', ...value })
  const [todayRefreshKey, setTodayRefreshKey] = useState(0)
  const checkInOpen = dialog?.kind === 'check-in'
  const [reservedName, setReservedName] = useState<string | null>(null)
  const [registeredName, setRegisteredName] = useState<string | null>(null)
  const camping = useCampingQuery()
  const stays = useInfiniteStaysInfiniteQuery(
    { status: stayStatus, accommodation },
    { skip: section !== 'stays' },
  )
  const [logout, logoutState] = useLogoutMutation()
  const profile = camping.data

  if (camping.isError && errorStatus(camping.error) === '401') return null
  if (camping.isError)
    return (
      <Box sx={uiStyles.campingWorkspaceBox}>
        <Alert
          severity="error"
          action={
            <Button onClick={() => void camping.refetch()}>
              {t('common.retry')}
            </Button>
          }
        >
          {t('home.loadError')}
        </Alert>
      </Box>
    )

  return (
    <>
      {checkInOpen && profile && (
        <CheckInDialog
          ageRanges={profile.ageRanges}
          timezone={profile.timezone}
          onClose={() => closeWorkspaceDialog()}
          onSuccess={(name) => {
            closeWorkspaceDialog()
            setRegisteredName(name)
            setTodayRefreshKey((value) => value + 1)
          }}
        />
      )}
      {profile && (
        <ReservationCreateDialog
          key={`${user.id}:${profile.id}`}
          open={dialog?.kind === 'reservation-create'}
          profile={profile}
          onClose={closeWorkspaceDialog}
          onSuccess={(reservation) => {
            replaceWorkspaceDialog({
              kind: 'reservation-detail',
              id: reservation.id,
            })
            setReservedName(reservation.responsibleName)
            setTodayRefreshKey((value) => value + 1)
          }}
        />
      )}
      {dialog?.kind === 'reservation-detail' && profile && (
        <ReservationDetailDialog
          id={dialog.id}
          profile={profile}
          onClose={closeWorkspaceDialog}
        />
      )}
      <WorkspaceNavigation
        section={section}
        controls={
          <>
            <WorkspaceUserMenu
              themeMode={themeMode}
              onToggleTheme={onToggleTheme}
              onLogout={() => void logout()}
              logoutPending={logoutState.isLoading}
            />
          </>
        }
      />
      <Paper component="header" square elevation={0} sx={uiStyles.mobileAppBar}>
        <MaytuBrand inverse />
        <Stack {...uiProps.rowCompact}>
          <Tooltip title={t('navigation.settings')}>
            <IconButton
              href={workspaceHref('settings')}
              aria-label={t('navigation.settings')}
              aria-current={section === 'settings' ? 'page' : undefined}
              onClick={navigateWorkspace}
              sx={uiStyles.mobileSettings(section)}
            >
              <LucideIcon icon={Settings} />
            </IconButton>
          </Tooltip>
          <WorkspaceUserMenu
            themeMode={themeMode}
            onToggleTheme={onToggleTheme}
            onLogout={() => void logout()}
            logoutPending={logoutState.isLoading}
          />
        </Stack>
      </Paper>
      <WorkspaceLayout
        notices={
          <>
            {logoutState.isError && (
              <Alert severity="error">{t('auth.logoutError')}</Alert>
            )}
            {reservedName && (
              <Alert severity="success" onClose={() => setReservedName(null)}>
                {t('reservationCreate.success', { name: reservedName })}
              </Alert>
            )}
            {registeredName && (
              <Alert severity="success" onClose={() => setRegisteredName(null)}>
                {t('checkIn.success', { name: registeredName })}
              </Alert>
            )}
          </>
        }
        header={
          profile && (
            <HomeHeader
              name={profile.name}
              greeting={
                section === 'home' ? t(greeting) : t(`navigation.${section}`)
              }
              userName={section === 'home' ? user.name : undefined}
              showCheckIn={false}
            />
          )
        }
      >
        {section === 'home' &&
          (profile ? (
            <>
              <Box sx={uiStyles.campingWorkspaceBox2}>
                <Box sx={uiStyles.campingWorkspaceBox3}>
                  <OccupancyCard profile={profile} />
                </Box>
                <Box sx={uiStyles.shrinkable}>
                  <PendingBalanceCard
                    pendingAmountMinor={profile.pendingAmountMinor}
                    pendingBalances={profile.pendingBalances}
                    currency={profile.currency}
                  />
                </Box>
              </Box>
              <Box sx={uiStyles.sectionTopGap}>
                <DashboardToday
                  profile={profile}
                  onSelect={setSelection}
                  refreshKey={todayRefreshKey}
                />
              </Box>
            </>
          ) : (
            <LoadingPanel />
          ))}
        {section === 'reservations' &&
          (profile ? (
            <AvailabilityCalendar
              profile={profile}
              refreshKey={todayRefreshKey}
            />
          ) : (
            <LoadingPanel />
          ))}
        {section === 'settings' ? (
          profile ? (
            <SettingsPanel profile={profile} />
          ) : (
            <LoadingPanel />
          )
        ) : section === 'stays' ? (
          <TabbedSection
            tabs={
              <SectionTabs
                value={stayStatus}
                onChange={(_, value: 'active' | 'closed') => {
                  setStayStatus(value)
                  scrollWorkspaceToTop()
                }}
                aria-label={t('navigation.stayViews')}
              >
                <Tab value="active" label={t('navigation.inProgress')} />
                <Tab value="closed" label={t('home.closedStays')} />
              </SectionTabs>
            }
          >
            <SectionCard>
              <AccommodationFilter
                value={accommodation}
                onChange={(value) => {
                  dispatch(accommodationFilterChanged(value))
                  scrollWorkspaceToTop()
                }}
              />
              {stays.isError && (
                <Alert severity="error">
                  {t('home.loadError')}{' '}
                  <Button
                    onClick={() =>
                      void (stays.currentData && stays.hasNextPage
                        ? stays.fetchNextPage()
                        : stays.refetch())
                    }
                  >
                    {t('common.retry')}
                  </Button>
                </Alert>
              )}
              {stays.currentData && profile && (
                <EnrichedStayList
                  items={stays.currentData.pages.flatMap((page) => page.items)}
                  timezone={profile.timezone}
                  onSelect={setSelection}
                />
              )}
              {stays.isFetching && (
                <Stack
                  role="status"
                  aria-label={t('home.loading')}
                  {...uiProps.stackStandard}
                >
                  {Array.from(
                    { length: stays.currentData ? 2 : 4 },
                    (_, index) => (
                      <Stack
                        key={index}
                        {...uiProps.rowStandard}

                        sx={uiStyles.campingWorkspaceStack3}
                      >
                        <Box sx={uiStyles.campingWorkspaceBox6}>
                          <Skeleton
                            variant="text"
                            {...uiProps.guestNamePlaceholder}
                          />
                          <Skeleton
                            variant="text"
                            {...uiProps.guestDetailsPlaceholder}
                          />
                        </Box>
                        <Skeleton
                          variant="text"
                          {...uiProps.amountPlaceholder}

                          sx={uiStyles.desktopBlock}
                        />
                        <Skeleton
                          variant="rounded"
                          {...uiProps.actionPlaceholder}
                        />
                      </Stack>
                    ),
                  )}
                </Stack>
              )}
              <InfiniteStayLoader
                hasMore={Boolean(stays.hasNextPage)}
                loading={stays.isFetching}
                failed={stays.isError}
                onLoad={() => void stays.fetchNextPage()}
              />
            </SectionCard>
          </TabbedSection>
        ) : null}
      </WorkspaceLayout>
      {(section === 'home' ||
        section === 'stays' ||
        section === 'reservations') && (
        <Fab
          color="primary"
          variant="extended"
          disabled={!profile}
          onClick={() =>
            openWorkspaceDialog({
              kind:
                section === 'reservations' ? 'reservation-create' : 'check-in',
            })
          }
          sx={uiStyles.campingWorkspaceFab}
        >
          <LucideIcon icon={Plus} />
          {t(
            section === 'reservations'
              ? 'reservationCreate.title'
              : 'checkIn.register',
          )}
        </Fab>
      )}
      {selection && profile && (
        <StayDetail
          id={selection.id}
          action={selection.action}
          timezone={profile.timezone}
          onClose={closeWorkspaceDialog}
          onChanged={() => setTodayRefreshKey((value) => value + 1)}
        />
      )}
    </>
  )
}

function EnrichedStayList({
  items,
  timezone,
  onSelect,
}: {
  items: Stay[]
  timezone: string
  onSelect: (selection: StaySelection) => void
}) {
  const types = useAccommodationTypesQuery()
  const units = useAccommodationUnitsQuery()
  const [readReservation] = useLazyReservationQuery()
  const [reservations, setReservations] = useState<ReservationResponse[]>([])
  useEffect(() => {
    let active = true
    const ids = [
      ...new Set(
        items.flatMap((stay) =>
          stay.reservationId ? [stay.reservationId] : [],
        ),
      ),
    ]
    void Promise.all(
      ids.map((id) =>
        readReservation(id, true)
          .unwrap()
          .catch(() => null),
      ),
    ).then((values) => {
      if (active)
        setReservations(
          values.filter(
            (value): value is ReservationResponse => value !== null,
          ),
        )
    })
    return () => {
      active = false
    }
  }, [items, readReservation])
  return (
    <StayList
      items={items}
      timezone={timezone}
      onSelect={onSelect}
      typeNames={
        new Map((types.data ?? []).map((type) => [type.id, type.name]))
      }
      typeModes={
        new Map((types.data ?? []).map((type) => [type.id, type.inventoryMode]))
      }
      unitNames={
        new Map((units.data ?? []).map((unit) => [unit.id, unit.name]))
      }
      reservationsById={
        new Map(
          reservations.map((reservation) => [reservation.id, reservation]),
        )
      }
    />
  )
}

function LoadingPanel() {
  return (
    <Box sx={uiStyles.loadingPanelBox}>
      <Typography color="text.secondary">Cargando…</Typography>
    </Box>
  )
}

function InfiniteStayLoader({
  hasMore,
  loading,
  failed,
  onLoad,
}: {
  hasMore: boolean
  loading: boolean
  failed: boolean
  onLoad: () => void
}) {
  const { t } = useTranslation()
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = sentinel.current
    if (!element || !hasMore || loading || failed) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) onLoad()
      },
      { rootMargin: '200px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [hasMore, loading, failed, onLoad])
  return (
    <Box ref={sentinel} sx={uiStyles.infiniteStayLoaderBox}>
      {hasMore && !loading && (
        <Button disabled={loading} onClick={onLoad}>
          {t('common.loadMore')}
        </Button>
      )}
    </Box>
  )
}

function StayDetail({
  id,
  action,
  timezone,
  onClose,
  onChanged,
}: {
  id: string
  action: StayAction
  timezone: string
  onClose: () => void
  onChanged?: () => void
}) {
  const { t, i18n } = useTranslation()
  const stayQuery = useStayQuery(id)
  const templates = useExtraTemplatesQuery()
  const [addExtra, addState] = useAddExtraMutation()
  const [updateExtra] = useUpdateExtraMutation()
  const [deleteExtra] = useDeleteExtraMutation()
  const [quote, quoteState] = useQuoteMutation()
  const [closeStay, closeState] = useCloseStayMutation()
  const [addPayment, paymentState] = useAddPaymentMutation()
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [category, setCategory] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [description, setDescription] = useState('')
  const [unitPriceMinor, setUnitPriceMinor] = useState(0)
  const [departureDate, setDepartureDate] = useState(
    action === 'close' ? todayInTimezone(timezone) : '',
  )
  const [preview, setPreview] = useState<StayQuote | null>(null)
  const [paymentAmountMinor, setPaymentAmountMinor] = useState<number | ''>('')
  const [paymentMethod, setPaymentMethod] =
    useState<PaymentInput['method']>('cash')
  const [paymentDate, setPaymentDate] = useState('')
  const [paymentNote, setPaymentNote] = useState('')
  const [paymentKey, setPaymentKey] = useState(createUuid)
  const [error, setError] = useState('')
  const stay = stayQuery.data
  const editable = !!stay && !stay.closure
  const minDeparture = stay?.arrivalDate ?? ''
  const effectivePaymentAmount =
    paymentAmountMinor === '' && stay?.closure && stay.account.balanceMinor > 0
      ? stay.account.balanceMinor
      : paymentAmountMinor
  const submitExtra = async () => {
    if (!stay) return
    setError('')
    try {
      const input = selectedTemplate
        ? { templateId: selectedTemplate, quantity }
        : {
            category,
            description: description.trim(),
            unitPriceMinor,
            quantity,
          }
      await addExtra({ id: stay.id, input }).unwrap()
      setPreview(null)
      setDescription('')
      setCategory('')
      setUnitPriceMinor(0)
      setSelectedTemplate('')
      if (action === 'extras') onClose()
    } catch {
      setError(t('stay.extraError'))
    }
  }
  const paymentInput = (): PaymentInput | undefined => {
    if (
      !stay ||
      typeof effectivePaymentAmount !== 'number' ||
      !Number.isSafeInteger(effectivePaymentAmount) ||
      effectivePaymentAmount < 1
    )
      return undefined
    const paidOn = paymentDate || todayInTimezone(timezone)
    if (paidOn > todayInTimezone(timezone)) return undefined
    const result = paymentInputSchema.safeParse({
      amountMinor: effectivePaymentAmount,
      method: paymentMethod,
      paidOn,
      note: paymentNote.trim(),
      idempotencyKey: paymentKey,
    })
    return result.success ? result.data : undefined
  }
  const requestQuote = async () => {
    if (!stay || !departureDate) return
    setError('')
    try {
      const result = await quote({ id: stay.id, departureDate }).unwrap()
      setPreview(result)
      setPaymentAmountMinor(
        result.account.balanceMinor > 0 ? result.account.balanceMinor : '',
      )
      setPaymentKey(createUuid())
    } catch (e) {
      setPreview(null)
      setError(
        errorStatus(e) === '409'
          ? t('stay.versionConflict')
          : t('stay.quoteError'),
      )
    }
  }
  const submitPayment = async () => {
    if (!stay) return
    const input = paymentInput()
    if (!input) {
      setError(t('stay.paymentValidation'))
      return
    }
    if (
      stay.closure &&
      stay.account.balanceMinor > 0 &&
      input.amountMinor > stay.account.balanceMinor
    ) {
      setError(t('stay.paymentTooLarge'))
      return
    }
    setError('')
    try {
      const updated = await addPayment({ id: stay.id, input }).unwrap()
      setPaymentAmountMinor(
        updated.account.balanceMinor > 0 ? updated.account.balanceMinor : '',
      )
      setPaymentKey(createUuid())
      setPreview(null)
      onChanged?.()
      if (action === 'payment') onClose()
    } catch (e) {
      setError(
        errorStatus(e) === '409'
          ? t('stay.versionConflict')
          : t('stay.paymentError'),
      )
    }
  }
  const confirmClose = async () => {
    if (!stay || !preview) return
    const balance = preview.account.balanceMinor
    const payment = balance > 0 ? paymentInput() : undefined
    if (balance < 0) {
      setError(t('stay.closeCredit'))
      return
    }
    if (balance > 0) {
      if (!payment) {
        setError(t('stay.paymentValidation'))
        return
      }
      if (payment.amountMinor !== balance) {
        setError(t('stay.closeBalanceRequired'))
        return
      }
    }
    setError('')
    try {
      await closeStay({
        id: stay.id,
        departureDate: preview.departureDate,
        version: preview.version,
        ...(payment && balance > 0 ? { payment } : {}),
      }).unwrap()
      onChanged?.()
      onClose()
    } catch (e) {
      setError(
        errorStatus(e) === '409'
          ? t('stay.versionConflict')
          : t('stay.closeError'),
      )
      setPreview(null)
    }
  }
  const handleUpdateExtra = async (arg: UpdateExtraArg) => {
    try {
      await updateExtra(arg).unwrap()
      setPreview(null)
    } catch {
      setError(t('stay.extraError'))
    }
  }
  const handleDeleteExtra = async (arg: DeleteExtraArg) => {
    try {
      await deleteExtra(arg).unwrap()
      setPreview(null)
    } catch {
      setError(t('stay.extraError'))
    }
  }
  const closePanel =
    stay && editable ? (
      <Stack {...uiProps.stackStandard}>
        <Divider />
        <Typography variant="h6">{t('stay.closeTitle')}</Typography>
        <Stack
          {...uiProps.responsiveRowSmall}

          sx={uiStyles.stayDetailStack}
        >
          <TextField
            type="date"
            label={t('stay.departureDate')}
            value={departureDate}
            onChange={(e) => {
              setDepartureDate(e.target.value)
              setPreview(null)
            }}
            slotProps={{
              inputLabel: { shrink: true },
              htmlInput: {
                min: minDeparture,
                max: todayInTimezone(timezone),
              },
            }}
          />
          <Button
            variant="outlined"
            onClick={() => void requestQuote()}
            disabled={!departureDate || quoteState.isLoading}
          >
            {t('stay.previewTotal')}
          </Button>
        </Stack>
        {preview && (
          <Paper variant="outlined" sx={uiStyles.panelPadding}>
            <Stack {...uiProps.stackCompact}>
              <Info label={t('stay.nights')} value={String(preview.nights)} />
              <Info
                label={t('stay.accommodation')}
                value={formatMoney(
                  preview.accommodationMinor,
                  stay.currency,
                  i18n.language,
                )}
              />
              <Info
                label={t('stay.extrasTotal')}
                value={formatMoney(
                  preview.extrasMinor,
                  stay.currency,
                  i18n.language,
                )}
              />
              {preview.roundingMinor !== undefined && (
                <Info
                  label={t('stay.rounding')}
                  value={formatMoney(
                    preview.roundingMinor,
                    stay.currency,
                    i18n.language,
                  )}
                />
              )}
              <Typography variant="h6">
                {t('stay.total')}:{' '}
                {formatMoney(preview.totalMinor, stay.currency, i18n.language)}
              </Typography>
              {preview.account.balanceMinor > 0 && (
                <Typography variant="body2" color="text.secondary">
                  {t('stay.closePaymentHelp', {
                    amount: formatMoney(
                      preview.account.balanceMinor,
                      stay.currency,
                      i18n.language,
                    ),
                  })}
                </Typography>
              )}
              {preview.account.balanceMinor < 0 && (
                <Typography variant="body2" color="error">
                  {t('stay.closeCredit')}
                </Typography>
              )}
              <Button
                variant="contained"
                onClick={() => void confirmClose()}
                disabled={
                  closeState.isLoading ||
                  preview.account.balanceMinor < 0 ||
                  (preview.account.balanceMinor > 0 &&
                    (typeof effectivePaymentAmount !== 'number' ||
                      effectivePaymentAmount !== preview.account.balanceMinor))
                }
              >
                {preview.account.balanceMinor > 0
                  ? t('stay.confirmPaymentClose')
                  : t('stay.confirmClose')}
              </Button>
            </Stack>
          </Paper>
        )}
      </Stack>
    ) : null
  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="md"
      slotProps={{
        paper: {
          sx: uiStyles.stayDialogPaper,
        },
      }}
    >
      <DialogTitle sx={uiStyles.wrappedText}>
        {action === 'payment'
          ? `${t('stay.recordPayment')} · `
          : action === 'extras'
            ? `${t('stay.addExtraAction')} · `
            : action === 'close'
              ? `${t('stay.closeTitle')} · `
              : ''}
        {stay?.responsibleName ?? t('home.loading')}
      </DialogTitle>
      <DialogContent dividers>
        {stayQuery.isError && (
          <Alert severity="error">{t('stay.loadError')}</Alert>
        )}
        {stay && (
          <Stack {...uiProps.stackStandard}>
            {action === 'close' && closePanel}
            {action === 'detail' && (
              <>
                <Stack {...uiProps.responsiveRow}>
                  <Info
                    label={t('checkIn.arrivalDate')}
                    value={formatDate(stay.arrivalDate, i18n.language)}
                  />
                  <Info
                    label={t('checkIn.estimatedDeparture')}
                    value={
                      stay.estimatedDeparture
                        ? formatDate(stay.estimatedDeparture, i18n.language)
                        : t('stay.unscheduled')
                    }
                  />
                  <Info
                    label={t('stay.people')}
                    value={String(countPeople(stay))}
                  />
                </Stack>
                {stay.closure && (
                  <Paper variant="outlined" sx={uiStyles.panelPadding}>
                    <Typography variant="h6">
                      {t('stay.closedSummary')}
                    </Typography>
                    <Box sx={uiStyles.stayDetailBox}>
                      <Info
                        label={t('stay.departureDate')}
                        value={formatDate(
                          stay.closure.departureDate,
                          i18n.language,
                        )}
                      />
                      <Info
                        label={t('stay.nights')}
                        value={String(stay.closure.nights)}
                      />
                      <Info
                        label={t('stay.accommodation')}
                        value={formatMoney(
                          stay.closure.accommodationMinor,
                          stay.currency,
                          i18n.language,
                        )}
                      />
                      <Info
                        label={t('stay.extrasTotal')}
                        value={formatMoney(
                          stay.closure.extrasMinor,
                          stay.currency,
                          i18n.language,
                        )}
                      />
                      <Info
                        label={t('stay.total')}
                        value={formatMoney(
                          stay.closure.totalMinor,
                          stay.currency,
                          i18n.language,
                        )}
                      />
                      <Info
                        label={t('stay.closedAt')}
                        value={formatDate(
                          stay.closure.closedAt.slice(0, 10),
                          i18n.language,
                        )}
                      />
                    </Box>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={uiStyles.smallTopGap}
                    >
                      {t('stay.totalCalculated')}
                    </Typography>
                  </Paper>
                )}
              </>
            )}
            {action !== 'extras' && (
              <>
                <Paper variant="outlined" sx={uiStyles.panelPadding}>
                  <Typography variant="h6">{t('stay.account')}</Typography>
                  <Stack
                    {...uiProps.responsiveRow}

                    sx={uiStyles.smallTopGap}
                  >
                    <Info
                      label={t('stay.total')}
                      value={formatMoney(
                        stay.account.totalMinor,
                        stay.currency,
                        i18n.language,
                      )}
                    />
                    <Info
                      label={t('stay.paid')}
                      value={formatMoney(
                        stay.account.paidMinor,
                        stay.currency,
                        i18n.language,
                      )}
                    />
                    <Info
                      label={
                        stay.account.balanceMinor < 0
                          ? t('stay.credit')
                          : t('stay.remaining')
                      }
                      value={formatMoney(
                        Math.abs(stay.account.balanceMinor),
                        stay.currency,
                        i18n.language,
                      )}
                    />
                    <Info
                      label={t('stay.asOfDate')}
                      value={formatDate(stay.account.asOfDate, i18n.language)}
                    />
                  </Stack>
                  {stay.account.balanceMinor < 0 && (
                    <Typography color="info.main" sx={uiStyles.smallTopGap}>
                      {t('stay.creditHelp')}
                    </Typography>
                  )}
                </Paper>
                <Paper variant="outlined" sx={uiStyles.panelPadding}>
                  <Typography variant="h6">{t('stay.payments')}</Typography>
                  {action === 'detail' &&
                    (stay.payments.length === 0 ? (
                      <Typography color="text.secondary">
                        {t('stay.noPayments')}
                      </Typography>
                    ) : (
                      <Stack {...uiProps.stackSmall} sx={uiStyles.smallTopGap}>
                        {stay.payments.map((payment) => (
                          <Stack
                            key={payment.id}
                            {...uiProps.responsiveRowSmall}

                            sx={uiStyles.campingWorkspaceStack4}
                          >
                            <Typography>
                              {formatDate(payment.paidOn, i18n.language)} ·{' '}
                              {t(`stay.paymentMethods.${payment.method}`)}
                            </Typography>
                            <Typography sx={uiStyles.boldText}>
                              {formatMoney(
                                payment.amountMinor,
                                stay.currency,
                                i18n.language,
                              )}
                            </Typography>
                            {payment.note && (
                              <Typography color="text.secondary">
                                {payment.note}
                              </Typography>
                            )}
                          </Stack>
                        ))}
                      </Stack>
                    ))}
                  <Stack {...uiProps.stackSmall} sx={uiStyles.topGap}>
                    <Box sx={uiStyles.formGrid}>
                      <MoneyField
                        label={t('stay.paymentAmount')}
                        currency={stay.currency}
                        moneyDecimals={stay.moneyDecimals}
                        valueMinor={effectivePaymentAmount}
                        onChangeMinor={(value) => {
                          setPaymentAmountMinor(value)
                          setPaymentKey(createUuid())
                        }}
                        disabled={
                          paymentAmountMinor === '' &&
                          stay.closure !== null &&
                          stay.account.balanceMinor <= 0
                        }
                        slotProps={{
                          htmlInput: {
                            min: 1,
                            max:
                              stay.closure && stay.account.balanceMinor > 0
                                ? stay.account.balanceMinor
                                : undefined,
                          },
                        }}
                      />
                      <TextField
                        select
                        label={t('stay.paymentMethod')}
                        value={paymentMethod}
                        onChange={(e) => {
                          setPaymentMethod(
                            e.target.value as PaymentInput['method'],
                          )
                          setPaymentKey(createUuid())
                        }}
                        disabled={
                          stay.closure !== null &&
                          stay.account.balanceMinor <= 0
                        }
                      >
                        <MenuItem value="cash">
                          {t('stay.paymentMethods.cash')}
                        </MenuItem>
                        <MenuItem value="transfer">
                          {t('stay.paymentMethods.transfer')}
                        </MenuItem>
                        <MenuItem value="card">
                          {t('stay.paymentMethods.card')}
                        </MenuItem>
                      </TextField>
                      <TextField
                        type="date"
                        label={t('stay.paymentDate')}
                        value={paymentDate || todayInTimezone(timezone)}
                        onChange={(e) => {
                          setPaymentDate(e.target.value)
                          setPaymentKey(createUuid())
                        }}
                        slotProps={{
                          inputLabel: { shrink: true },
                          htmlInput: { max: todayInTimezone(timezone) },
                        }}
                        disabled={
                          stay.closure !== null &&
                          stay.account.balanceMinor <= 0
                        }
                      />
                    </Box>
                    <TextField
                      label={t('stay.paymentNote')}
                      value={paymentNote}
                      onChange={(e) => {
                        setPaymentNote(e.target.value)
                        setPaymentKey(createUuid())
                      }}
                      slotProps={{ htmlInput: { maxLength: 200 } }}
                      disabled={
                        stay.closure !== null && stay.account.balanceMinor <= 0
                      }
                    />
                    <Button
                      variant="outlined"
                      onClick={() => void submitPayment()}
                      disabled={
                        paymentState.isLoading ||
                        typeof effectivePaymentAmount !== 'number' ||
                        !Number.isSafeInteger(effectivePaymentAmount) ||
                        effectivePaymentAmount < 1 ||
                        (stay.closure !== null &&
                          stay.account.balanceMinor <= 0) ||
                        (stay.closure !== null &&
                          stay.account.balanceMinor > 0 &&
                          effectivePaymentAmount > stay.account.balanceMinor)
                      }
                    >
                      {t('stay.recordPayment')}
                    </Button>
                  </Stack>
                </Paper>
              </>
            )}
            {(action === 'detail' || action === 'extras') && (
              <>
                <Typography variant="body2" color="text.secondary">
                  {stay.location || t('stay.noLocation')} ·{' '}
                  {stay.hasVehicle
                    ? `${t('checkIn.vehicleSection')}: ${stay.vehicleDescription || t('stay.vehicleYes')}`
                    : t('checkIn.withoutVehicle')}
                </Typography>
                <Divider />
                <Typography variant="h6">{t('stay.extras')}</Typography>
                {stay.extras.length === 0 && (
                  <Typography color="text.secondary">
                    {t('stay.noExtras')}
                  </Typography>
                )}
                {stay.extras.map((extra) => (
                  <ExtraRow
                    key={extra.id}
                    stay={stay}
                    extra={extra}
                    editable={editable}
                    onUpdate={handleUpdateExtra}
                    onDelete={handleDeleteExtra}
                  />
                ))}
                {editable && (
                  <Box sx={uiStyles.formGrid}>
                    <TextField
                      select
                      label={t('stay.template')}
                      value={selectedTemplate}
                      onChange={(e) => setSelectedTemplate(e.target.value)}
                    >
                      <MenuItem value="">{t('stay.freeExtra')}</MenuItem>
                      {(templates.data ?? [])
                        .filter((template) => template.enabled)
                        .map((template) => (
                          <MenuItem key={template.id} value={template.id}>
                            {template.description} ·{' '}
                            {formatMoney(
                              template.unitPriceMinor,
                              stay.currency,
                              i18n.language,
                            )}
                          </MenuItem>
                        ))}
                    </TextField>
                    {!selectedTemplate && (
                      <>
                        <TextField
                          label={t('stay.category')}
                          value={category}
                          onChange={(e) => setCategory(e.target.value)}
                        />
                        <TextField
                          label={t('stay.description')}
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                        />
                        <MoneyField
                          label={t('stay.unitPrice')}
                          currency={stay.currency}
                          moneyDecimals={stay.moneyDecimals}
                          valueMinor={unitPriceMinor}
                          onChangeMinor={(value) =>
                            setUnitPriceMinor(value === '' ? NaN : value)
                          }
                        />
                      </>
                    )}
                    <TextField
                      type="number"
                      label={t('stay.quantity')}
                      value={quantity}
                      onChange={(e) =>
                        setQuantity(Math.max(1, Number(e.target.value)))
                      }
                    />
                    <Button
                      variant="outlined"
                      onClick={() => void submitExtra()}
                      disabled={
                        addState.isLoading ||
                        !Number.isSafeInteger(quantity) ||
                        quantity < 1 ||
                        (!selectedTemplate &&
                          (!description.trim() ||
                            !Number.isSafeInteger(unitPriceMinor) ||
                            unitPriceMinor < 0))
                      }
                    >
                      {t('stay.addExtra')}
                    </Button>
                  </Box>
                )}
              </>
            )}
            {action === 'detail' && closePanel}
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}

type UpdateExtraArg = {
  stayId: string
  extraId: string
  input: {
    category?: string
    description: string
    unitPriceMinor: number
    quantity: number
  }
}
type DeleteExtraArg = { stayId: string; extraId: string }
type UpdateExtra = (arg: UpdateExtraArg) => Promise<unknown>
type DeleteExtra = (arg: DeleteExtraArg) => Promise<unknown>

function Info({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={uiStyles.flexContent}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography sx={uiStyles.wrappedText}>{value}</Typography>
    </Box>
  )
}
function ExtraRow({
  stay,
  extra,
  editable,
  onUpdate,
  onDelete,
}: {
  stay: Stay
  extra: Stay['extras'][number]
  editable: boolean
  onUpdate: UpdateExtra
  onDelete: DeleteExtra
}) {
  const { t, i18n } = useTranslation()
  const [quantity, setQuantity] = useState(extra.quantity)
  const [price, setPrice] = useState(extra.unitPriceMinor)
  const [description, setDescription] = useState(extra.description)
  const [category, setCategory] = useState(extra.category ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const save = async () => {
    setSaving(true)
    setError(false)
    try {
      await onUpdate({
        stayId: stay.id,
        extraId: extra.id,
        input: { category, description, unitPriceMinor: price, quantity },
      })
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }
  const remove = async () => {
    setSaving(true)
    setError(false)
    try {
      await onDelete({ stayId: stay.id, extraId: extra.id })
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }
  return (
    <Box sx={uiStyles.formGrid}>
      <TextField
        size="small"
        label={t('stay.category')}
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        disabled={!editable || saving}
      />
      <TextField
        size="small"
        label={t('stay.description')}
        value={description}
        disabled={!editable || saving}
        onChange={(e) => setDescription(e.target.value)}
      />
      <MoneyField
        size="small"
        label={t('stay.unitPrice')}
        currency={stay.currency}
        moneyDecimals={stay.moneyDecimals}
        valueMinor={price}
        onChangeMinor={(value) => setPrice(value === '' ? NaN : value)}
        disabled={!editable || saving}
      />
      <TextField
        size="small"
        type="number"
        label={t('stay.quantity')}
        value={quantity}
        disabled={!editable || saving}
        onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
      />
      <Stack {...uiProps.row} useFlexGap sx={uiStyles.extraRowStack}>
        <Typography sx={uiStyles.extraRowTypography}>
          {formatMoney(price * quantity, stay.currency, i18n.language)}
        </Typography>
        {error && <Typography color="error">{t('stay.extraError')}</Typography>}
        {editable && (
          <>
            <Button
              size="small"
              onClick={() => void save()}
              disabled={saving || !Number.isSafeInteger(price) || price < 0}
            >
              {t('common.save')}
            </Button>
            <IconButton
              aria-label={t('common.delete')}
              onClick={() => void remove()}
              disabled={saving}
            >
              ×
            </IconButton>
          </>
        )}
      </Stack>
    </Box>
  )
}

function SettingsPanel({ profile }: { profile: CampingProfile }) {
  const { t, i18n } = useTranslation()
  const tab = useSettingsTab()
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null)
  const [createExtraOpen, setCreateExtraOpen] = useState(false)
  const createExtraButton = useRef<HTMLButtonElement>(null)
  const [inlineCategory, setInlineCategory] = useState<string | null>(null)
  const templates = useExtraTemplatesQuery()
  const [update] = useUpdateExtraTemplateMutation()
  const [updateRates, ratesState] = useUpdateRatesMutation()
  const [rates, setRates] = useState(profile.rates)
  const [editingRate, setEditingRate] = useState<
    keyof typeof profile.rates | null
  >(null)
  const [moneyDecimals, setMoneyDecimals] = useState(profile.moneyDecimals)
  const [updateMoneySettings, moneyState] = useUpdateMoneySettingsMutation()
  const [updateOccupancy, occupancyState] = useUpdateOccupancySettingsMutation()
  const [updateAges, ageState] = useUpdateOccupancySettingsMutation()
  const [expectedAgeRanges, setExpectedAgeRanges] = useState<
    CampingProfile['ageRanges'] | null
  >(null)
  const [ageDraft, setAgeDraft] = useState<{
    infants: string
    children: string
  } | null>(null)
  const ageLimits = ageDraft ?? {
    infants: String(profile.ageRanges.infants.max),
    children: String(profile.ageRanges.children.max),
  }
  const infantMax =
    ageLimits.infants.trim() === '' ? NaN : Number(ageLimits.infants)
  const childMax =
    ageLimits.children.trim() === '' ? NaN : Number(ageLimits.children)
  const ages = ageRangesSchema.safeParse({
    infants: { min: 0, max: infantMax },
    children: { min: infantMax + 1, max: childMax },
    adults: { min: childMax + 1, max: null },
  })
  const ageConflict = errorStatus(ageState.error) === '409'
  const agesChanged =
    infantMax !== profile.ageRanges.infants.max ||
    childMax !== profile.ageRanges.children.max
  const [error, setError] = useState('')
  const saveRates = async () => {
    try {
      setError('')
      await updateRates(rates).unwrap()
      setEditingRate(null)
    } catch {
      setError(t('settings.saveError'))
    }
  }
  const extrasByCategory = new Map<string, ExtraTemplate[]>()
  for (const template of templates.data ?? []) {
    const key = template.category?.trim() ?? ''
    const items = extrasByCategory.get(key) ?? []
    items.push(template)
    extrasByCategory.set(key, items)
  }
  const categories = [...extrasByCategory.keys()].sort((a, b) =>
    a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, i18n.language),
  )
  return (
    <TabbedSection
      tabs={
        <SectionTabs value={tab} aria-label={t('settings.title')}>
          <Tab
            value="general"
            href={settingsTabHref('general')}
            onClick={navigateWorkspace}
            label={t('settings.generalTab')}
            id="settings-general-tab"
            aria-controls="settings-general-panel"
          />
          <Tab
            value="accommodations"
            href={settingsTabHref('accommodations')}
            onClick={navigateWorkspace}
            label={t('settings.accommodationsTab')}
            id="settings-accommodations-tab"
            aria-controls="settings-accommodations-panel"
          />
          <Tab
            value="extras"
            href={settingsTabHref('extras')}
            onClick={navigateWorkspace}
            label={t('settings.templates')}
            id="settings-extras-tab"
            aria-controls="settings-extras-panel"
          />
        </SectionTabs>
      }
    >
      {error && <Alert severity="error">{error}</Alert>}
      <Box
        role="tabpanel"
        id="settings-accommodations-panel"
        aria-labelledby="settings-accommodations-tab"
        hidden={tab !== 'accommodations'}
      >
        <PricingSettings profile={profile} />
      </Box>
      <Box
        role="tabpanel"
        id="settings-general-panel"
        aria-labelledby="settings-general-tab"
        hidden={tab !== 'general'}
      >
        <Stack {...uiProps.stackSection}>
          <CampingProfileSettings profile={profile} />
          <SectionCard
            title={t('settings.money')}
            subtitle={t('settings.moneyHelp')}
          >
            <FormControlLabel
              control={
                <Switch
                  checked={moneyDecimals === null}
                  onChange={(_, checked) =>
                    setMoneyDecimals(checked ? null : 0)
                  }
                />
              }
              label={t('settings.useCents')}
            />
            <Box>
              <Button
                disabled={
                  moneyState.isLoading ||
                  moneyDecimals === profile.moneyDecimals
                }
                onClick={async () => {
                  try {
                    await updateMoneySettings({ moneyDecimals }).unwrap()
                  } catch {
                    setError(t('settings.saveError'))
                  }
                }}
              >
                {t('common.save')}
              </Button>
            </Box>
          </SectionCard>
          <SectionCard
            title={t('settings.guestAges')}
            subtitle={t('settings.guestAgesHelp')}
          >
            <FormControlLabel
              control={
                <Switch
                  checked={profile.infantsConsumeCapacity ?? false}
                  disabled={occupancyState.isLoading}
                  onChange={(_, checked) => {
                    void updateOccupancy({ infantsConsumeCapacity: checked })
                  }}
                />
              }
              label={t('settings.infantsCapacity')}
            />
            <Box sx={uiStyles.formGrid}>
              {(['infants', 'children'] as const).map((category) => (
                <TextField
                  key={category}
                  type="number"
                  label={t(`settings.maxAge.${category}`)}
                  value={ageLimits[category]}
                  disabled={ageState.isLoading}
                  onChange={(event) => {
                    if (!ageDraft) setExpectedAgeRanges(profile.ageRanges)
                    setAgeDraft({
                      ...ageLimits,
                      [category]: event.target.value,
                    })
                  }}
                />
              ))}
            </Box>
            {ages.success ? (
              <Typography variant="body2" color="text.secondary">
                {t('settings.adultAge', { age: ages.data.adults.min })}
              </Typography>
            ) : (
              <Typography variant="body2" color="error">
                {t('settings.invalidAges')}
              </Typography>
            )}
            {occupancyState.isError && (
              <Alert severity="error">{t('settings.saveError')}</Alert>
            )}
            {ageState.isError && (
              <Alert severity="error">
                {ageConflict
                  ? t('settings.staleAges', {
                      infants: String(profile.ageRanges.infants.max),
                      children: String(profile.ageRanges.children.max),
                    })
                  : t('settings.saveError')}
              </Alert>
            )}
            <Box>
              <Button
                disabled={ageState.isLoading || !agesChanged || !ages.success}
                onClick={async () => {
                  if (!ages.success) return
                  const result = await updateAges({
                    ageRanges: ages.data,
                    expectedAgeRanges: ageConflict
                      ? profile.ageRanges
                      : (expectedAgeRanges ?? profile.ageRanges),
                  })
                  if (result.data) {
                    setAgeDraft(null)
                    setExpectedAgeRanges(null)
                  }
                }}
              >
                {t('common.save')}
              </Button>
            </Box>
          </SectionCard>
          <SectionCard
            title={t('settings.rates')}
            subtitle={t('settings.ratesHelp')}
          >
            <Stack {...uiProps.stackStandard}>
              {(['adults', 'children', 'infants'] as const).map((category) => (
                <Stack
                  key={category}
                  {...uiProps.responsiveRow}

                  sx={uiStyles.tabletAlignCenter}
                >
                  <Typography sx={uiStyles.flexGrow}>
                    {t(`checkIn.${category}`)} (
                    {ageLabel(profile.ageRanges[category])})
                  </Typography>
                  {editingRate === category ? (
                    <Stack
                      {...uiProps.responsiveRowSmall}

                      sx={uiStyles.tabletAlignCenter}
                    >
                      <MoneyField
                        autoFocus
                        size="small"
                        label={`${t('stay.unitPrice')} (${profile.currency})`}
                        helperText=""
                        currency={profile.currency}
                        moneyDecimals={profile.moneyDecimals}
                        valueMinor={rates[category]}
                        disabled={ratesState.isLoading}
                        onChangeMinor={(value) =>
                          setRates({
                            ...rates,
                            [category]: value === '' ? NaN : value,
                          })
                        }
                      />
                      <Stack {...uiProps.rowSmall}>
                        <Button
                          variant="contained"
                          color="primary"
                          onClick={() => void saveRates()}
                          disabled={
                            ratesState.isLoading ||
                            !Number.isSafeInteger(rates[category]) ||
                            rates[category] < 0
                          }
                        >
                          {t('common.save')}
                        </Button>
                        <Button
                          variant="text"
                          color="error"
                          sx={uiStyles.campingWorkspaceButton2}
                          disabled={ratesState.isLoading}
                          onClick={() => {
                            setEditingRate(null)
                            setError('')
                          }}
                        >
                          {t('common.cancel')}
                        </Button>
                      </Stack>
                    </Stack>
                  ) : (
                    <Stack
                      {...uiProps.rowStandard}

                      sx={uiStyles.alignCenter}
                    >
                      <Typography>
                        {formatMoney(
                          profile.rates[category],
                          profile.currency,
                          i18n.language,
                        )}
                      </Typography>
                      <Tooltip title={t('settings.editRate')}>
                        <span>
                          <IconButton
                            size="small"
                            color="primary"
                            aria-label={t('settings.editRate')}
                            disabled={
                              editingRate !== null || ratesState.isLoading
                            }
                            onClick={() => {
                              setRates(profile.rates)
                              setError('')
                              setEditingRate(category)
                            }}
                          >
                            <LucideIcon icon={Pencil} fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                  )}
                </Stack>
              ))}
            </Stack>
          </SectionCard>
        </Stack>
      </Box>
      <Box
        role="tabpanel"
        id="settings-extras-panel"
        aria-labelledby="settings-extras-tab"
        hidden={tab !== 'extras'}
      >
        <Stack {...uiProps.stackStandard}>
          {createExtraOpen ? (
            <CreateExtraForm
              profile={profile}
              categories={categories}
              onClose={() => {
                setCreateExtraOpen(false)
                requestAnimationFrame(() => createExtraButton.current?.focus())
              }}
            />
          ) : (
            <Stack {...uiProps.row} sx={uiStyles.trailingActions}>
              <Button
                ref={createExtraButton}
                size="small"
                variant="outlined"
                startIcon={<LucideIcon icon={Plus} />}
                onClick={() => setCreateExtraOpen(true)}
              >
                {t('settings.createTemplate')}
              </Button>
            </Stack>
          )}
          {templates.isError && (
            <Alert severity="error">{t('settings.loadError')}</Alert>
          )}
          <Box>
            {categories.map((category, index) => {
              const items = extrasByCategory.get(category) ?? []
              return (
                <Accordion
                  key={category}
                  disableGutters
                  expanded={expandedCategory === category}
                  onChange={(_, expanded) =>
                    setExpandedCategory(expanded ? category : null)
                  }
                >
                  <AccordionSummary
                    expandIcon={<LucideIcon icon={ChevronDown} />}
                    id={`settings-extra-category-${index}`}
                    aria-controls={`settings-extra-items-${index}`}
                  >
                    <Typography component="span" variant="h3">
                      {category || t('settings.uncategorized')} ({items.length})
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Stack {...uiProps.stackSmall}>
                      {items.map((template) => (
                        <TemplateRow
                          key={template.id}
                          template={template}
                          currency={profile.currency}
                          moneyDecimals={profile.moneyDecimals}
                          onSave={update}
                        />
                      ))}
                      {inlineCategory === category ? (
                        <CreateExtraForm
                          profile={profile}
                          categories={categories}
                          fixedCategory={category}
                          onClose={() =>
                            setInlineCategory((current) =>
                              current === category ? null : current,
                            )
                          }
                        />
                      ) : (
                        <Box>
                          <Button
                            variant="text"
                            color="primary"
                            size="small"
                            sx={uiStyles.inlineActionLink}
                            onClick={() => setInlineCategory(category)}
                          >
                            + {t('settings.createTemplate')}
                          </Button>
                        </Box>
                      )}
                    </Stack>
                  </AccordionDetails>
                </Accordion>
              )
            })}
          </Box>
        </Stack>
      </Box>
    </TabbedSection>
  )
}
function CreateExtraForm({
  profile,
  categories,
  fixedCategory,
  onClose,
}: {
  profile: CampingProfile
  categories: string[]
  fixedCategory?: string
  onClose?: () => void
}) {
  const { t } = useTranslation()
  const [create, createState] = useCreateExtraTemplateMutation()
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [unitPriceMinor, setUnitPriceMinor] = useState(0)
  const [error, setError] = useState(false)
  const saveTemplate = async () => {
    if (!description.trim()) return
    setError(false)
    try {
      await create({
        category: fixedCategory ?? category.trim(),
        description: description.trim(),
        unitPriceMinor,
      }).unwrap()
      setDescription('')
      setCategory('')
      setUnitPriceMinor(0)
      onClose?.()
    } catch {
      setError(true)
    }
  }
  return (
    <Box sx={uiStyles.formGrid}>
      {fixedCategory === undefined && (
        <Autocomplete
          freeSolo
          forcePopupIcon
          openOnFocus
          options={categories.filter(Boolean)}
          value={null}
          inputValue={category}
          onInputChange={(_, value, reason) => {
            if (reason === 'input' || reason === 'clear') setCategory(value)
          }}
          onChange={(_, value) => setCategory(value ?? '')}
          clearText={t('common.clear')}
          openText={t('common.open')}
          closeText={t('common.close')}
          renderInput={(params) => (
            <TextField {...params} label={t('stay.category')} />
          )}
        />
      )}
      <TextField
        autoFocus
        label={t('stay.description')}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <MoneyField
        label={t('stay.unitPrice')}
        currency={profile.currency}
        moneyDecimals={profile.moneyDecimals}
        valueMinor={unitPriceMinor}
        showCurrencyInInput
        onChangeMinor={(value) => setUnitPriceMinor(value === '' ? NaN : value)}
      />
      <Stack {...uiProps.rowSmall} sx={uiStyles.trailingActions}>
        <Button
          variant="contained"
          color="primary"
          onClick={() => void saveTemplate()}
          disabled={
            createState.isLoading ||
            !description.trim() ||
            !Number.isSafeInteger(unitPriceMinor) ||
            unitPriceMinor < 0
          }
        >
          {t('common.save')}
        </Button>
        {onClose && (
          <Button onClick={onClose} disabled={createState.isLoading}>
            {t('common.cancel')}
          </Button>
        )}
      </Stack>
      {error && <Alert severity="error">{t('settings.saveError')}</Alert>}
    </Box>
  )
}

function TemplateRow({
  template,
  currency,
  moneyDecimals,
  onSave,
}: {
  template: ExtraTemplate
  currency: string
  moneyDecimals: 0 | null
  onSave: ReturnType<typeof useUpdateExtraTemplateMutation>[0]
}) {
  const { t, i18n } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [description, setDescription] = useState(template.description)
  const [category, setCategory] = useState(template.category ?? '')
  const [price, setPrice] = useState(template.unitPriceMinor)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const save = async (patch: {
    category?: string
    description?: string
    unitPriceMinor?: number
    enabled?: boolean
  }) => {
    setSaving(true)
    setError(false)
    try {
      await onSave({ id: template.id, patch }).unwrap()
      setEditing(false)
      setConfirmRemove(false)
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }
  return (
    <Box>
      {editing ? (
        <Box sx={uiStyles.templateRowBox}>
          <TextField
            size="small"
            label={t('stay.category')}
            value={category}
            disabled={saving}
            onChange={(event) => setCategory(event.target.value)}
          />
          <TextField
            autoFocus
            size="small"
            label={t('stay.description')}
            value={description}
            disabled={saving}
            onChange={(event) => setDescription(event.target.value)}
          />
          <MoneyField
            size="small"
            label={`${t('stay.unitPrice')} (${currency})`}
            helperText=""
            currency={currency}
            moneyDecimals={moneyDecimals}
            valueMinor={price}
            disabled={saving}
            onChangeMinor={(value) => setPrice(value === '' ? NaN : value)}
          />
          <Stack {...uiProps.rowSmall}>
            <Button
              variant="contained"
              color="primary"
              disabled={
                saving ||
                !description.trim() ||
                !Number.isSafeInteger(price) ||
                price < 0
              }
              onClick={() =>
                void save({
                  category: category.trim(),
                  description: description.trim(),
                  unitPriceMinor: price,
                })
              }
            >
              {t('common.save')}
            </Button>
            <Button
              variant="text"
              color="error"
              sx={uiStyles.templateRowButton}
              disabled={saving}
              onClick={() => {
                setEditing(false)
                setError(false)
              }}
            >
              {t('common.cancel')}
            </Button>
          </Stack>
        </Box>
      ) : (
        <Stack {...uiProps.rowStandard} sx={uiStyles.templateRowStack}>
          <Box sx={uiStyles.campingWorkspaceBox6}>
            <Typography sx={uiStyles.templateRowTypography(template.enabled)}>
              {template.description}
            </Typography>
            {!template.enabled && (
              <Typography variant="caption" color="text.secondary">
                {t('settings.inactive')}
              </Typography>
            )}
          </Box>
          <Typography sx={uiStyles.templateRowTypography2}>
            {formatMoney(template.unitPriceMinor, currency, i18n.language)}
          </Typography>
          <Stack {...uiProps.row}>
            <Tooltip title={t('settings.editExtra')}>
              <span>
                <IconButton
                  size="small"
                  color="primary"
                  aria-label={t('settings.editExtra')}
                  disabled={saving}
                  onClick={() => {
                    setDescription(template.description)
                    setCategory(template.category ?? '')
                    setPrice(template.unitPriceMinor)
                    setError(false)
                    setEditing(true)
                  }}
                >
                  <LucideIcon icon={Pencil} fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip
              title={t(
                template.enabled ? 'settings.deactivate' : 'settings.activate',
              )}
            >
              <span>
                <IconButton
                  size="small"
                  color={template.enabled ? 'error' : 'success'}
                  aria-label={t(
                    template.enabled
                      ? 'settings.deactivate'
                      : 'settings.activate',
                  )}
                  disabled={saving}
                  onClick={() => {
                    if (template.enabled) {
                      setError(false)
                      setConfirmRemove(true)
                    } else void save({ enabled: true })
                  }}
                >
                  <LucideIcon
                    icon={template.enabled ? Trash2 : RotateCcw}
                    fontSize="small"
                  />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        </Stack>
      )}
      {error && !confirmRemove && (
        <Alert severity="error" sx={uiStyles.topGap}>
          {t('settings.saveError')}
        </Alert>
      )}
      <Dialog
        open={confirmRemove}
        onClose={() => {
          if (!saving) setConfirmRemove(false)
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>{t('settings.deactivateExtra')}</DialogTitle>
        <DialogContent>
          <Typography>
            {t('settings.deactivateHelp', { name: template.description })}
          </Typography>
          {error && (
            <Alert severity="error" sx={uiStyles.topGap}>
              {t('settings.saveError')}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button disabled={saving} onClick={() => setConfirmRemove(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={saving}
            color="error"
            onClick={() => void save({ enabled: false })}
          >
            {t('settings.deactivate')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

function formatDate(value: string, locale: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
