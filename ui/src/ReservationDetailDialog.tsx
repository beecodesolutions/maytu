import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import type { CampingProfile, ReservationResponse } from '@camping/contracts'
import { todayInTimezone } from '@camping/contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { uiProps } from './app/theme'
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
            <Divider />
            {(
              [
                'nationality',
                'document',
                'phone',
                'email',
                'source',
                'notes',
              ] as const
            ).map((name) => (
              <Typography key={name}>
                {t(
                  name === 'source' || name === 'email' || name === 'notes'
                    ? `reservationCreate.${name}`
                    : `checkIn.${name}`,
                )}
                : {reservation[name] || '—'}
              </Typography>
            ))}
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
