import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import type { CampingProfile } from '@camping/contracts'
import { todayInTimezone } from '@camping/contracts'
import { useTranslation } from 'react-i18next'
import { uiProps } from './app/theme'
import {
  useAccommodationTypesQuery,
  useAccommodationUnitsQuery,
  useReservationQuery,
} from './services/api'
import ReservationReview from './ReservationReview'

type Props = { id: string; profile: CampingProfile; onClose: () => void }

export default function ReservationDetailDialog({
  id,
  profile,
  onClose,
}: Props) {
  const { t } = useTranslation()
  const theme = useTheme()
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'))
  const query = useReservationQuery(id)
  const types = useAccommodationTypesQuery()
  const units = useAccommodationUnitsQuery()
  const reservation = query.data
  const type = types.data?.find(
    (item) => item.id === reservation?.accommodationTypeId,
  )
  const unit = units.data?.find((item) => item.id === reservation?.unitId)
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
        {t('reservationCreate.createdDetail')}
      </DialogTitle>
      <DialogContent dividers>
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
              today={todayInTimezone(profile.timezone)}
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
      </DialogActions>
    </Dialog>
  )
}
