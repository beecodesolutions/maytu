import { uiStyles } from './app/theme'
import { Checkbox, FormControlLabel } from '@mui/material'
import { useTranslation } from 'react-i18next'

export function CapacitySearchOption({
  checked = false,
  onChange,
}: {
  checked?: boolean
  onChange: (value: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <FormControlLabel
      sx={uiStyles.capacitySearchOption}
      control={
        <Checkbox checked={checked} onChange={(_e, value) => onChange(value)} />
      }
      label={t('pricing.includeInsufficient')}
    />
  )
}
