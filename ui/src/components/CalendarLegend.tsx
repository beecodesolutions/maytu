import { Stack, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { uiProps, uiStyles } from '../app/theme'

export default function CalendarLegend() {
  const { t } = useTranslation()
  return (
    <Stack {...uiProps.rowMedium} sx={uiStyles.wrapRow}>
      <Typography
        variant="caption"
        sx={uiStyles.availabilityCalendarTypography5}
      >
        ● {t('calendar.free')}
      </Typography>
      <Typography variant="caption" sx={uiStyles.goldIcon}>
        ● {t('calendar.partial')}
      </Typography>
      <Typography
        variant="caption"
        sx={uiStyles.availabilityCalendarTypography7}
      >
        ● {t('calendar.none')}
      </Typography>
    </Stack>
  )
}
