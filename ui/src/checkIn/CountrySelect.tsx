import { callingCodePopperProps } from '../app/theme'
import type { Ref } from 'react'
import { Autocomplete, createFilterOptions, TextField } from '@mui/material'
import {
  getCountries,
  getCountryCallingCode,
  type CountryCode,
} from 'libphonenumber-js/min'
import { useTranslation } from 'react-i18next'

type CountrySelectProps = {
  label: string
  value: CountryCode | ''
  onChange: (country: CountryCode | '') => void
  onBlur?: () => void
  inputRef?: Ref<HTMLInputElement>
  disabled: boolean
  error?: string
  callingCode?: boolean
  required?: boolean
}

function flag(country: CountryCode) {
  return String.fromCodePoint(
    ...[...country].map((letter) => letter.charCodeAt(0) + 127397),
  )
}

export default function CountrySelect({
  label,
  value,
  onChange,
  onBlur,
  inputRef,
  disabled,
  error,
  callingCode = false,
  required = false,
}: CountrySelectProps) {
  const { t, i18n } = useTranslation()
  const names = new Intl.DisplayNames([i18n.language], { type: 'region' })
  const name = (country: CountryCode) => names.of(country) ?? country
  const options = getCountries().sort((a, b) =>
    name(a).localeCompare(name(b), i18n.language),
  )
  return (
    <Autocomplete
      fullWidth
      openOnFocus={callingCode}
      disableClearable={callingCode || required}
      slotProps={callingCode ? callingCodePopperProps : undefined}
      disabled={disabled}
      options={options}
      value={value || null}
      getOptionKey={(country) => country}
      getOptionLabel={(country) =>
        callingCode
          ? `${flag(country)} +${getCountryCallingCode(country)}`
          : name(country)
      }
      filterOptions={createFilterOptions({
        stringify: (country: CountryCode) =>
          `${name(country)} ${country} +${getCountryCallingCode(country)}`,
      })}
      renderOption={({ key, ...props }, country) => (
        <li key={key} {...props}>
          {callingCode ? `${flag(country)} ` : ''}
          {name(country)}
          {callingCode ? ` (+${getCountryCallingCode(country)})` : ''}
        </li>
      )}
      onBlur={onBlur}
      onChange={(_event, country) => onChange(country ?? '')}
      noOptionsText={t('checkIn.noCountries')}
      clearText={t('common.clear')}
      openText={t('common.open')}
      closeText={t('common.close')}
      renderInput={(params) => (
        <TextField
          {...params}
          inputRef={inputRef}
          label={label}
          required={required}
          slotProps={{
            ...params.slotProps,
            htmlInput: { ...params.slotProps.htmlInput, 'aria-label': label },
          }}
          error={!!error}
          helperText={error}
        />
      )}
    />
  )
}
