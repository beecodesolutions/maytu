import { useState, type FormEvent } from 'react'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  campingProfileUpdateSchema,
  campingCurrencies,
  currenciesByCountry,
  timezonesByCountry,
  type CampingProfile,
  type CampingProfileUpdate,
} from '@camping/contracts'
import { useTranslation } from 'react-i18next'
import { uiProps, uiStyles } from './app/theme'
import CountrySelect from './checkIn/CountrySelect'
import SectionCard from './components/SectionCard'
import { useUpdateCampingProfileMutation } from './services/api'

export default function CampingProfileSettings({
  profile,
}: {
  profile: CampingProfile
}) {
  const { t, i18n } = useTranslation()
  const current = {
    name: profile.name,
    country: profile.country,
    timezone: profile.timezone,
    currency: profile.currency,
  }
  const [draft, setDraft] = useState<
    (typeof current & { expected: typeof current }) | null
  >(null)
  const [update, status] = useUpdateCampingProfileMutation()
  const values = draft ?? { ...current, expected: current }
  const parsed = campingProfileUpdateSchema.safeParse(values)
  const changed = Object.keys(current).some((key) => {
    const field = key as keyof typeof current
    return values[field].trim() !== current[field]
  })

  const suggestedTimezones = timezonesByCountry[values.country] ?? []
  const suggestedCurrencies = currenciesByCountry[values.country] ?? []
  const currencyNames = new Intl.DisplayNames([i18n.language], {
    type: 'currency',
  })
  const timezoneOptions = [
    ...new Set([
      ...suggestedTimezones,
      values.timezone,
      ...Intl.supportedValuesOf('timeZone'),
    ]),
  ]
  const currencyOptions = [
    ...new Set([...suggestedCurrencies, values.currency, ...campingCurrencies]),
  ]

  const error = status.error
  const httpStatus = error && 'status' in error ? error.status : undefined
  const data = error && 'data' in error ? error.data : undefined
  const code =
    data && typeof data === 'object' && 'code' in data ? data.code : undefined

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!parsed.success || !changed || status.isLoading) return
    const input: CampingProfileUpdate = { ...parsed.data }
    if (code === 'STALE_CAMPING_PROFILE') {
      if (values.name === values.expected.name) input.name = current.name
      if (values.country === values.expected.country)
        input.country = current.country
      if (values.timezone === values.expected.timezone)
        input.timezone = current.timezone
      if (values.currency === values.expected.currency)
        input.currency = current.currency
      input.expected = current
    }
    const result = await update(input)
    if (result.data) setDraft(null)
  }

  return (
    <SectionCard title={t('settings.campingProfile')}>
      <Stack component="form" {...uiProps.stackStandard} onSubmit={submit}>
        <Box sx={uiStyles.formGrid}>
          <TextField
            label={t('settings.campingName')}
            value={values.name}
            required
            disabled={status.isLoading}
            slotProps={{ htmlInput: { maxLength: 160 } }}
            onChange={(event) =>
              setDraft({ ...values, name: event.target.value })
            }
          />
          <CountrySelect
            label={t('settings.country')}
            value={values.country}
            required
            disabled={status.isLoading}
            onChange={(country) => {
              if (!country || country === values.country) return
              setDraft({
                ...values,
                country,
                timezone: timezonesByCountry[country]?.[0] ?? values.timezone,
                currency: currenciesByCountry[country]?.[0] ?? values.currency,
              })
            }}
          />
          <Autocomplete
            disableClearable
            disabled={status.isLoading}
            options={timezoneOptions}
            value={values.timezone}
            onChange={(_event, timezone) => setDraft({ ...values, timezone })}
            renderInput={(params) => (
              <TextField
                {...params}
                required
                label={t('settings.timezone')}
                helperText={
                  suggestedTimezones.length === 1
                    ? t('settings.suggestedTimezone', {
                        timezone: suggestedTimezones[0],
                      })
                    : suggestedTimezones.length > 1 &&
                      t('settings.suggestedTimezones')
                }
              />
            )}
          />
          <Autocomplete
            disableClearable
            disabled={status.isLoading}
            options={currencyOptions}
            value={values.currency}
            getOptionLabel={(currency) =>
              `${currency} · ${currencyNames.of(currency) ?? currency}`
            }
            onChange={(_event, currency) => setDraft({ ...values, currency })}
            renderInput={(params) => (
              <TextField
                {...params}
                required
                label={t('settings.currency')}
                helperText={
                  suggestedCurrencies.length > 0 &&
                  t('settings.suggestedCurrency', {
                    currency: suggestedCurrencies.join(', '),
                  })
                }
              />
            )}
          />
        </Box>
        <Typography color="text.secondary">
          {t('settings.regionalSettingsImpact')}
        </Typography>
        {status.isError && (
          <Alert severity="error">
            {code === 'ACTIVE_STAYS'
              ? t('settings.activeStayTimezone')
              : code === 'ACTIVE_STAYS_CURRENCY'
                ? t('settings.activeStayCurrency')
                : code === 'OPEN_RESERVATIONS_CURRENCY'
                  ? t('settings.openReservationsCurrency')
                  : code === 'CURRENCY_PRECISION'
                    ? t('settings.currencyPrecision')
                    : code === 'STALE_CAMPING_PROFILE'
                      ? t('settings.staleProfile', current)
                      : httpStatus === 401 || httpStatus === 403
                        ? t('settings.profilePermission')
                        : t('settings.saveError')}
          </Alert>
        )}
        <Box>
          <Button
            type="submit"
            disabled={!changed || !parsed.success || status.isLoading}
          >
            {t('common.save')}
          </Button>
        </Box>
      </Stack>
    </SectionCard>
  )
}
