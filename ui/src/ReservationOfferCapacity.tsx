import { Alert, Stack, Typography } from '@mui/material'
import { TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ReservationQuote } from '@camping/contracts'
import { uiProps, uiStyles } from './app/theme'
import LucideIcon from './components/LucideIcon'
export default function ReservationOfferCapacity({
  offer,
}: {
  offer: ReservationQuote
}) {
  const { t } = useTranslation()
  return (
    <Stack {...uiProps.stackSmall}>
      {offer.capacityMatch === 'OVERSIZED' && (
        <Typography component="span" variant="body2" color="warning">
          <Stack
            component="span"
            {...uiProps.rowCompact}
            sx={uiStyles.inlineWarning}
          >
            <LucideIcon
              icon={TriangleAlert}
              fontSize="inherit"
              aria-hidden="true"
              focusable="false"
            />
            <span>
              {t('pricing.oversized', { count: offer.sparePlaces ?? 0 })}
            </span>
          </Stack>
        </Typography>
      )}
      {offer.occupancyWarning && (
        <Alert severity="warning">
          {t('reservationCreate.overCapacity', {
            max: offer.occupancyWarning.maxOccupancy,
            people: offer.occupancyWarning.people,
          })}
        </Alert>
      )}
      {offer.availableBeds !== undefined && (
        <Typography variant="body2">
          {t('pricing.bedsAvailable', {
            count: offer.availableBeds,
            requested: offer.requestedBeds ?? 0,
          })}
        </Typography>
      )}
    </Stack>
  )
}
