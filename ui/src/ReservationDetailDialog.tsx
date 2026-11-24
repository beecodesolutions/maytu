import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Paper,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import type { CampingProfile, ReservationResponse } from '@camping/contracts'
import { todayInTimezone } from '@camping/contracts'
import {
  IdCard,
  Mail,
  NotebookPen,
  Phone,
  Signpost,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { uiProps, uiStyles } from './app/theme'
import LucideIcon from './components/LucideIcon'
import { countryFlag } from './services/countryFlag'
import { formatMoney } from './services/money'
import {
  useAccommodationTypesQuery,
  useAccommodationUnitsQuery,
  useReservationQuery,
} from './services/api'
import ReservationReview from './ReservationReview'
import ReservationCheckInDialog from './ReservationCheckInDialog'

type Props = {
  id: string
  profile: CampingProfile
  onClose: () => void
  onCheckInSuccess: () => void
}

const guestFields = [
  { name: 'phone', label: 'checkIn.phone', icon: Phone },
  { name: 'email', label: 'reservationCreate.email', icon: Mail },
] as const

const reservationFields = [
  { name: 'source', label: 'reservationCreate.source', icon: Signpost },
  { name: 'notes', label: 'reservationCreate.notes', icon: NotebookPen },
] as const

type DetailField =
  | (typeof guestFields)[number]
  | (typeof reservationFields)[number]

export default function ReservationDetailDialog({
  id,
  profile,
  onClose,
  onCheckInSuccess,
}: Props) {
  const { t, i18n } = useTranslation()
  const [checkInReservation, setCheckInReservation] =
    useState<ReservationResponse | null>(null)
  const [checkedInName, setCheckedInName] = useState<string>()
  const theme = useTheme()
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'))
  const query = useReservationQuery(id)
  const types = useAccommodationTypesQuery()
  const units = useAccommodationUnitsQuery()
  const reservation = query.currentData
  const document = reservation?.document?.trim()
  const country = reservation?.nationality
  const countryName = country
    ? new Intl.DisplayNames(i18n.language, { type: 'region' }).of(country) ??
      country
    : null
  const renderFields = (fields: readonly DetailField[]) =>
    fields.flatMap(({ name, label, icon }) => {
      const value = reservation?.[name]?.trim()
      if (!value) return []
      return (
        <Box
          key={name}
          sx={
            name === 'email'
              ? uiStyles.reservationDetailFullWidthField
              : undefined
          }
        >
          <Tooltip title={t(label)}>
            <Stack
              {...uiProps.rowSmall}
              role="group"
              sx={uiStyles.reservationDetailField}
            >
              <LucideIcon icon={icon} fontSize="small" aria-hidden />
              <Typography sx={uiStyles.wrappedText}>{value}</Typography>
            </Stack>
          </Tooltip>
        </Box>
      )
    })
  const guestDetails = renderFields(guestFields)
  const reservationDetails = renderFields(reservationFields)
  const today = todayInTimezone(profile.timezone)
  const canCheckIn =
    reservation?.status === 'confirmed' &&
    reservation.checkInDate <= today &&
    today < reservation.checkOutDate &&
    !checkedInName
  const formatPaymentDate = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  })
  const type = types.data?.find(
    (item) => item.id === reservation?.accommodationTypeId,
  )
  const unit = units.data?.find((item) => item.id === reservation?.unitId)
  const money = (amountMinor: number, currencyCode: string) =>
    formatMoney(amountMinor, currencyCode, i18n.language)
  return (
    <Dialog
      open
      fullWidth
      maxWidth="sm"
      fullScreen={fullScreen}
      onClose={onClose}
      aria-labelledby="reservation-detail-title"
    >
      <DialogTitle id="reservation-detail-title">
        {t('reservationCreate.detailTitle')}
      </DialogTitle>
      <DialogContent dividers>
        {checkedInName && (
          <Alert severity="success">
            {t('checkIn.success', { name: checkedInName })}
          </Alert>
        )}
        {query.isLoading && (
          <Typography role="status">{t('common.loading')}</Typography>
        )}
        {query.isError && (
          <Alert
            severity="error"
            action={
              <Button onClick={() => void query.refetch()}>
                {t('common.retry')}
              </Button>
            }
          >
            {t('home.loadError')}
          </Alert>
        )}
        {reservation && (
          <Stack {...uiProps.stackForm}>
            <Typography>
              {t('reservationCreate.reference', { id: reservation.id })}
            </Typography>
            {!!reservation.allocatedBeds?.length && (
              <Typography>
                {t('pricing.allocatedBeds')}:{' '}
                {reservation.allocatedBeds.map((b) => b.name).join(' · ')}
              </Typography>
            )}
            <Typography>
              {t(`calendar.status.${reservation.status}`)}
            </Typography>
            <ReservationReview
              today={today}
              showResponsibleName={false}
              quote={{
                priceSnapshot: reservation.priceSnapshot,
                responsibleName: reservation.responsibleName,
                accommodationName: [
                  type?.name ?? t('home.accommodation'),
                  unit?.name,
                ]
                  .filter(Boolean)
                  .join(' · '),
                input: {
                  accommodationTypeId: reservation.accommodationTypeId,
                  ...(reservation.unitId ? { unitId: reservation.unitId } : {}),
                  checkInDate: reservation.checkInDate,
                  checkOutDate: reservation.checkOutDate,
                  adults: reservation.adults,
                  children: reservation.children,
                  infants: reservation.infants,
                  pets: reservation.pets ?? 0,
                },
              }}
            />
            <Divider />
            <Stack {...uiProps.stackSmall}>
              <Typography component="h3" variant="subtitle1">
                {t('stay.payments')}
              </Typography>
              {reservation.payments.length === 0 && (
                <Typography color="text.secondary">
                  {t('stay.noPayments')}
                </Typography>
              )}
              {reservation.payments.map((payment) => (
                <Stack key={payment.id} {...uiProps.stackSmall}>
                  <Typography variant="body2">
                    {formatPaymentDate.format(new Date(payment.paidOn))} ·{' '}
                    {t(`stay.paymentMethods.${payment.method}`)} ·{' '}
                    {money(
                      payment.amountMinor,
                      reservation.priceSnapshot.currency,
                    )}
                    {payment.voidedAt && ` · ${t('stay.voidedPayment')}`}
                  </Typography>
                  {payment.note && (
                    <Typography variant="body2" color="text.secondary">
                      {payment.note}
                    </Typography>
                  )}
                </Stack>
              ))}
              <Typography>
                {t('stay.total')}:{' '}
                {money(
                  reservation.account.totalMinor,
                  reservation.priceSnapshot.currency,
                )}
              </Typography>
              <Typography>
                {t('stay.paid')}:{' '}
                {money(
                  reservation.account.paidMinor,
                  reservation.priceSnapshot.currency,
                )}
              </Typography>
              <Typography>
                {t(
                  reservation.account.balanceMinor < 0
                    ? 'stay.credit'
                    : 'stay.balance',
                )}
                :{' '}
                {money(
                  Math.abs(reservation.account.balanceMinor),
                  reservation.priceSnapshot.currency,
                )}
              </Typography>
            </Stack>
            <Stack
              component="section"
              aria-labelledby="reservation-details-heading"
              {...uiProps.stackSmall}
            >
              <Typography
                id="reservation-details-heading"
                component="h3"
                variant="subtitle1"
              >
                {t('reservationCreate.detailsSection')}
              </Typography>
              <Paper variant="outlined" sx={uiStyles.reservationGuestCard}>
                <Stack {...uiProps.stackSmall}>
                  <Stack
                    {...uiProps.rowSmall}
                    sx={uiStyles.reservationDetailHeader}
                  >
                    <Stack {...uiProps.stackTight}>
                      <Typography variant="subtitle1" sx={uiStyles.wrappedText}>
                        {reservation.responsibleName}
                      </Typography>
                      {country && (
                        <Tooltip title={t('checkIn.nationality')}>
                          <Stack {...uiProps.rowSmall} role="group">
                            <span aria-hidden>{countryFlag(country)}</span>
                            <Typography variant="body2" sx={uiStyles.wrappedText}>
                              {countryName}
                            </Typography>
                          </Stack>
                        </Tooltip>
                      )}
                    </Stack>
                    {document && (
                      <Tooltip title={t('checkIn.document')}>
                        <Stack
                          {...uiProps.rowSmall}
                          role="group"
                          sx={uiStyles.reservationDetailIdentity}
                        >
                          <LucideIcon icon={IdCard} fontSize="small" aria-hidden />
                          <Typography variant="body2" sx={uiStyles.wrappedText}>
                            {document}
                          </Typography>
                        </Stack>
                      </Tooltip>
                    )}
                  </Stack>
                  {guestDetails.length > 0 && (
                    <>
                      <Divider />
                      <Box sx={uiStyles.reservationDetailFields}>
                        {guestDetails}
                      </Box>
                    </>
                  )}
                </Stack>
              </Paper>
            </Stack>
            {reservationDetails.length > 0 && (
              <Stack {...uiProps.stackSmall}>{reservationDetails}</Stack>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
        {canCheckIn && (
          <Button
            variant="contained"
            disabled={query.isFetching || query.isError}
            onClick={() => setCheckInReservation(reservation)}
          >
            {t('home.checkInAction')}
          </Button>
        )}
      </DialogActions>
      {checkInReservation && (
        <ReservationCheckInDialog
          reservation={checkInReservation}
          timezone={profile.timezone}
          onClose={() => setCheckInReservation(null)}
          onSuccess={(name) => {
            setCheckInReservation(null)
            setCheckedInName(name)
            onCheckInSuccess()
          }}
        />
      )}
    </Dialog>
  )
}
