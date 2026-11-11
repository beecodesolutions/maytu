import type { CampingProfile } from '@camping/contracts'
import SectionCard from './components/SectionCard'
import { uiStyles } from './app/theme'
import { useTranslation } from 'react-i18next'
import { Box, Typography } from '@mui/material'
import { PiggyBank } from 'lucide-react'
import LucideIcon from './components/LucideIcon'
import { formatMoney } from './services/money'

type PendingBalanceCardProps = Pick<
  CampingProfile,
  'pendingAmountMinor' | 'pendingBalances' | 'currency'
>

export default function PendingBalanceCard({
  pendingAmountMinor,
  pendingBalances,
  currency,
}: PendingBalanceCardProps) {
  const { t, i18n } = useTranslation()
  const balances = pendingBalances?.length
    ? pendingBalances
    : [{ currency, amountMinor: pendingAmountMinor }]
  return (
    <SectionCard
      titleId="balance-title"
      height="100%"
      title={
        <>
          <LucideIcon
            icon={PiggyBank}
            sx={uiStyles.goldIcon}
            aria-hidden="true"
          />{' '}
          {t('home.pendingBalance')}
        </>
      }
    >
      <Box>
        {balances.map(({ currency, amountMinor }) => (
          <Typography
            key={currency}
            component="p"
            variant="metricLarge"
            sx={uiStyles.pageTitle}
          >
            {formatMoney(amountMinor, currency, i18n.language, {
              hideCurrency: true,
            })}{' '}
            <Typography
              component="span"
              variant="body2"
              color="text.secondary"
              sx={uiStyles.pendingBalanceCardTypography3}
            >
              {currency}
            </Typography>
          </Typography>
        ))}
        <Typography color="text.secondary">
          {t('home.accumulatedBalance')}
        </Typography>
      </Box>
    </SectionCard>
  )
}
