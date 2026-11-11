import ReservationTariffBreakdown from './ReservationTariffBreakdown'
import { uiProps, uiStyles } from './app/theme'
import { Alert, Box, Divider, Stack, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import type { CreationQuote } from './reservations/creationState'
import {
  reservationGuestGroups,
  reservationReviewDate,
} from './reservations/review'
import { formatMoney } from './services/money'

type Props = { quote: CreationQuote; today: string; held?: boolean }

export default function ReservationReview({
  quote,
  today,
  held = false,
}: Props) {
  const { t, i18n } = useTranslation()
  const price = quote.priceSnapshot
  const guests = reservationGuestGroups(quote.input)
  const money = (amount: number) =>
    formatMoney(amount, price.currency, i18n.language)
  const date = (value: string) =>
    reservationReviewDate(value, today, i18n.language)
  return (
    <Stack
      {...uiProps.stackSection}
      aria-label={t('reservationCreate.summary')}
    >
      <Box>
        <Typography variant="overline" color="text.secondary">
          {t('reservationCreate.accommodationLabel')}
        </Typography>
        <Typography variant="h3">
          {quote.accommodationName}
        </Typography>
        <Typography variant="body1" sx={uiStyles.smallTopGap}>
          {quote.responsibleName}
        </Typography>
      </Box>
      <Box sx={uiStyles.reservationReviewBox}>
        <Box>
          <Typography variant="body2" color="text.secondary">
            {t('reservationCreate.checkIn')}
          </Typography>
          <Typography sx={uiStyles.semiboldText}>
            {date(quote.input.checkInDate)}
          </Typography>
        </Box>
        <Box>
          <Typography variant="body2" color="text.secondary">
            {t('reservationCreate.checkOut')}
          </Typography>
          <Typography sx={uiStyles.semiboldText}>
            {date(quote.input.checkOutDate)}
          </Typography>
        </Box>
      </Box>
      <Stack
        {...uiProps.rowSmall}

        useFlexGap
        sx={uiStyles.reservationReviewStack}
      >
        <Typography sx={uiStyles.semiboldText}>
          {t('reservationCreate.nights', { count: price.nights })}
        </Typography>
        <Typography color="text.secondary">·</Typography>
        <Typography>
          {guests
            .map(({ name, count }) =>
              t(`reservationCreate.guest_${name}`, { count }),
            )
            .join(' · ')}
        </Typography>
      </Stack>
      {!!quote.input.pets && (
        <Typography>
          {t('pricing.pets')}: {quote.input.pets}
        </Typography>
      )}
      <Divider />
      <Stack {...uiProps.stackSmall}>
        <Typography component="h4" variant="h6">
          {t('pricing.tariffBreakdown')}
        </Typography>
        {price.breakdown ? (
          <ReservationTariffBreakdown
            quote={quote}
            breakdown={price.breakdown}
            today={today}
          />
        ) : price.basis !== 'per_person' ? (
          <Typography color="text.secondary">
            {t('reservationCreate.unitRate', {
              amount: money(price.baseNightlyPriceMinor),
            })}
          </Typography>
        ) : (
          guests.map(({ name, count }) => (
            <Stack
              key={name}
              {...uiProps.row}
              sx={uiStyles.reservationReviewStack2}
            >
              <Typography color="text.secondary">
                {t(`reservationCreate.guest_${name}`, { count })}
              </Typography>
              <Typography sx={uiStyles.reservationReviewTypography6}>
                {count} × {money(price.rates[name])} ×{' '}
                {t('reservationCreate.nights', { count: price.nights })}
              </Typography>
            </Stack>
          ))
        )}
        {!price.breakdown && !!price.adjustmentMinor && (
          <Typography variant="body2" color="text.secondary">
            {t('pricing.adjustment')}: {money(price.adjustmentMinor)} ·{' '}
            {price.adjustmentReason}
          </Typography>
        )}
        {!!price.roundingMinor && (
          <Typography variant="body2" color="text.secondary">
            {t('reservationCreate.rounding', {
              amount: money(price.roundingMinor),
            })}
          </Typography>
        )}
      </Stack>
      <Box sx={uiStyles.reservationReviewBox2}>
        <Typography color="text.secondary">
          {t('reservationCreate.totalLabel')}
        </Typography>
        <Typography
          variant="metricLarge"
          sx={uiStyles.reservationReviewTypography7}
        >
          {money(price.totalMinor)}
        </Typography>
      </Box>
      {quote.occupancyWarning && (
        <Alert severity="warning">
          {t('reservationCreate.overCapacity', {
            max: quote.occupancyWarning.maxOccupancy,
            people: quote.occupancyWarning.people,
          })}
        </Alert>
      )}
      {!held && (
        <Typography variant="body2" color="text.secondary">
          {t('reservationCreate.notHeld')}
        </Typography>
      )}
    </Stack>
  )
}
