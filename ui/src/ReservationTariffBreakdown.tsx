import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Stack,
  Typography,
} from '@mui/material'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  BlockDiscount,
  ReservationPriceSnapshot,
} from '@camping/contracts'
import type { CreationQuote } from './reservations/creationState'
import {
  reservationGuestGroups,
  reservationReviewDate,
} from './reservations/review'
import { addDays } from './services/calendar'
import { formatMoney } from './services/money'
import { uiProps, uiStyles } from './app/theme'

type Breakdown = NonNullable<ReservationPriceSnapshot['breakdown']>

type Night = Breakdown['nights'][number]

function groupNightlyRates(nights: Night[]) {
  const groups: { night: Night; endDate: string; count: number }[] = []
  for (const night of nights.toSorted((a, b) => a.date.localeCompare(b.date))) {
    const previous = groups.at(-1)
    if (
      previous &&
      night.date === addDays(previous.endDate, 1) &&
      night.baseMinor === previous.night.baseMinor &&
      night.humanMinor === previous.night.humanMinor &&
      night.petMinor === previous.night.petMinor
    ) {
      previous.endDate = night.date
      previous.count++
    } else {
      groups.push({ night, endDate: night.date, count: 1 })
    }
  }
  return groups
}

function ChargeRow({
  label,
  amount,
  detail,
}: {
  label: string
  amount: string
  detail?: string
}) {
  return (
    <Box sx={uiStyles.tariffBreakdownRow}>
      <Box>
        <Typography variant="body2">{label}</Typography>
        {detail && (
          <Typography variant="caption" color="text.secondary">
            {detail}
          </Typography>
        )}
      </Box>
      <Typography variant="body2" sx={uiStyles.tariffBreakdownAmount}>
        {amount}
      </Typography>
    </Box>
  )
}
export default function ReservationTariffBreakdown({
  quote,
  breakdown,
  today,
}: {
  quote: CreationQuote
  breakdown: Breakdown
  today: string
}) {
  const { t, i18n } = useTranslation()
  const price = quote.priceSnapshot
  const money = (amount: number) =>
    formatMoney(amount, price.currency, i18n.language)
  const displayDate = (date: string) =>
    reservationReviewDate(date, today, i18n.language)
  const nightlyGroups = groupNightlyRates(breakdown.nights)
  const guests = reservationGuestGroups(quote.input)
  const pets = quote.input.pets ?? price.pets ?? 0
  const dailyDetail = (amounts: number[], quantity = 1): string => {
    if (amounts.length !== price.nights) return t('pricing.actualNightRates')
    if (!amounts.every((value) => value === amounts[0]))
      return t('pricing.variableNightRates')
    // Presentation of an already quoted nightly charge, never a price calculation.
    if (quantity > 1 && amounts[0] % quantity === 0)
      return t('pricing.quantityNightlyFormula', {
        quantity,
        amount: money(amounts[0] / quantity),
        count: price.nights,
      })
    return t('pricing.nightlyFormula', {
      amount: money(amounts[0]),
      count: price.nights,
    })
  }
  const discountRule =
    breakdown.discountRuleIndex === null
      ? undefined
      : price.pricing?.discounts[breakdown.discountRuleIndex]
  const benefitText = (benefit: BlockDiscount['benefit']): string => {
    switch (benefit.type) {
      case 'PERCENTAGE':
        return t('pricing.percentOff', {
          percent: new Intl.NumberFormat(i18n.language).format(
            benefit.value / 100,
          ),
        })
      case 'FIXED_AMOUNT':
        return t('pricing.fixedReduction', { amount: money(benefit.value) })
      case 'FIXED_PRICE':
        return t('pricing.blockPrice', {
          amount: money(benefit.value),
          basis: t(
            price.basis === 'per_bed'
              ? 'pricing.perBedLabel'
              : 'pricing.perReservationLabel',
          ),
        })
      case 'FREE_NIGHTS':
        return t('pricing.freeNights', { count: benefit.value })
    }
  }
  const includedOccupancy =
    price.basis === 'per_unit' ? price.pricing?.includedOccupancy : undefined
  const included = includedOccupancy
    ? (['adults', 'children', 'infants'] as const)
        .filter((name) => includedOccupancy[name] > 0)
        .map((name) =>
          t(`reservationCreate.guest_${name}`, {
            count: includedOccupancy[name],
          }),
        )
        .join(' · ')
    : ''

  return (
    <Stack {...uiProps.stackSmall} aria-label={t('pricing.tariffBreakdown')}>
      <Typography variant="body2" color="text.secondary">
        {t(`pricing.${price.basis}`)}
        {price.basis === 'per_bed' && quote.requestedBeds !== undefined
          ? ` · ${t('pricing.reservedBeds', { count: quote.requestedBeds })}`
          : ''}
      </Typography>
      {included && (
        <Typography variant="body2" color="text.secondary">
          {t('pricing.includedGuests', { guests: included })}
        </Typography>
      )}
      {price.basis !== 'per_person' && (
        <ChargeRow
          label={t('pricing.baseAccommodation')}
          amount={money(breakdown.accommodationMinor)}
          detail={dailyDetail(
            breakdown.nights.map((n) => n.baseMinor),
            price.basis === 'per_bed' ? (quote.requestedBeds ?? 1) : 1,
          )}
        />
      )}
      {(price.basis === 'per_person' || breakdown.humanMinor > 0) &&
        !breakdown.categoryCharges && (
          <ChargeRow
            label={t(
              price.basis === 'per_person'
                ? 'pricing.personCharges'
                : 'pricing.additionalGuests',
            )}
            amount={money(breakdown.humanMinor)}
          />
        )}
      {breakdown.categoryCharges &&
        guests.map(({ name, count }) => {
          const extraCount =
            price.basis === 'per_unit' && price.pricing
              ? Math.max(0, count - price.pricing.includedOccupancy[name])
              : count
          if (price.basis === 'per_bed' || extraCount === 0) return null
          const amount = breakdown.categoryCharges?.[name]
          if (amount === undefined) return null
          const categoryAmounts = breakdown.nights.flatMap((n) =>
            n.categoryCharges ? [n.categoryCharges[name]] : [],
          )
          return (
            <ChargeRow
              key={name}
              label={
                price.basis === 'per_unit'
                  ? t('pricing.additionalCategory', {
                      count: extraCount,
                      guests: t(`reservationCreate.guest_${name}`, {
                        count: extraCount,
                      }),
                    })
                  : t(`reservationCreate.guest_${name}`, { count })
              }
              amount={amount === 0 ? t('pricing.noCharge') : money(amount)}
              detail={
                amount === 0
                  ? undefined
                  : dailyDetail(categoryAmounts, extraCount)
              }
            />
          )
        })}
      {breakdown.discountMinor > 0 && (
        <ChargeRow
          label={t('pricing.discount')}
          amount={`−${money(breakdown.discountMinor)}`}
          detail={
            discountRule
              ? t('pricing.discountDescription', {
                  nights: discountRule.blockNights,
                  benefit: benefitText(discountRule.benefit),
                })
              : undefined
          }
        />
      )}
      {(pets > 0 || breakdown.petMinor > 0) && (
        <ChargeRow
          label={t('pricing.petQuantity', { count: pets })}
          amount={
            breakdown.petMinor === 0
              ? t('pricing.noCharge')
              : money(breakdown.petMinor)
          }
          detail={
            breakdown.petMinor === 0
              ? undefined
              : dailyDetail(
                  breakdown.nights.map((n) => n.petMinor),
                  pets,
                )
          }
        />
      )}
      {!!price.adjustmentMinor && (
        <ChargeRow
          label={t('pricing.adjustment')}
          amount={`${price.adjustmentMinor < 0 ? '−' : '+'}${money(Math.abs(price.adjustmentMinor))}`}
          detail={price.adjustmentReason}
        />
      )}
      <Accordion>
        <AccordionSummary expandIcon={<ChevronDown aria-hidden="true" />}>
          {t('pricing.nightlyDetail')}
        </AccordionSummary>
        <AccordionDetails>
          <Stack {...uiProps.stackForm}>
            {nightlyGroups.map(({ night, endDate, count }) => (
              <Stack key={night.date} {...uiProps.stackSmall}>
                <Typography variant="body2" sx={uiStyles.semiboldText}>
                  {count === 1
                    ? displayDate(night.date)
                    : t('pricing.nightlyDateRange', {
                        start: displayDate(night.date),
                        end: displayDate(endDate),
                        count,
                      })}
                </Typography>
                {price.basis !== 'per_person' && (
                  <ChargeRow
                    label={t('pricing.baseAccommodation')}
                    amount={money(night.baseMinor)}
                  />
                )}
                {(night.humanMinor > 0 || price.basis === 'per_person') && (
                  <ChargeRow
                    label={t('pricing.humanCharges')}
                    amount={money(night.humanMinor)}
                  />
                )}
                {pets > 0 && (
                  <ChargeRow
                    label={t('pricing.pets')}
                    amount={money(night.petMinor)}
                  />
                )}
              </Stack>
            ))}
            {breakdown.discountMinor > 0 && (
              <Typography variant="caption" color="text.secondary">
                {t('pricing.nightlyBeforeDiscount')}
              </Typography>
            )}
          </Stack>
        </AccordionDetails>
      </Accordion>
    </Stack>
  )
}
