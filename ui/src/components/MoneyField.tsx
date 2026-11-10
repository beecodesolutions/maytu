import { useState } from 'react'
import { InputAdornment, TextField, type TextFieldProps } from '@mui/material'
import { useTranslation } from 'react-i18next'
import type { MoneyDecimals } from '@camping/contracts'
import { moneyInputFromMinor, moneyInputToMinor } from '../services/moneyInput'

type Props = Omit<
  TextFieldProps,
  'value' | 'onChange' | 'type' | 'defaultValue'
> & {
  valueMinor: number | ''
  currency: string
  showCurrencyInInput?: boolean
  moneyDecimals?: MoneyDecimals
  onChangeMinor: (value: number | '') => void
}

export default function MoneyField({
  valueMinor,
  currency,
  showCurrencyInInput = false,
  moneyDecimals = null,
  onChangeMinor,
  helperText,
  error,
  ...props
}: Props) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const invalid = valueMinor !== '' && !Number.isSafeInteger(valueMinor)
  return (
    <TextField
      {...props}
      type="text"
      value={
        editing || invalid ? draft : moneyInputFromMinor(valueMinor, currency)
      }
      error={Boolean(error || invalid)}
      helperText={
        invalid
          ? t('validation.money', { currency })
          : (helperText ?? (showCurrencyInInput ? undefined : currency))
      }
      onFocus={() => {
        if (!invalid) setDraft(moneyInputFromMinor(valueMinor, currency))
        setEditing(true)
      }}
      onBlur={() => setEditing(false)}
      onChange={(event) => {
        setDraft(event.target.value)
        onChangeMinor(
          moneyInputToMinor(event.target.value, currency, moneyDecimals),
        )
      }}
      slotProps={{
        input: showCurrencyInInput
          ? {
              endAdornment: (
                <InputAdornment position="end">{currency}</InputAdornment>
              ),
            }
          : undefined,
        htmlInput: { inputMode: moneyDecimals === 0 ? 'numeric' : 'decimal' },
      }}
    />
  )
}
