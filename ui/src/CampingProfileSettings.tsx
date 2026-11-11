import { useState, type FormEvent } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  TextField,
} from '@mui/material'
import {
  campingProfileUpdateSchema,
  type CampingProfile,
  type CampingProfileUpdate,
} from '@camping/contracts'
import { useTranslation } from 'react-i18next'
import { uiProps, uiStyles } from './app/theme'
import SectionCard from './components/SectionCard'
import { useUpdateCampingProfileMutation } from './services/api'

export default function CampingProfileSettings({
  profile,
}: {
  profile: CampingProfile
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<CampingProfileUpdate | null>(null)
  const [confirmation, setConfirmation] = useState<CampingProfileUpdate | null>(
    null,
  )
  const [update, status] = useUpdateCampingProfileMutation()
  const current = { name: profile.name, timezone: profile.timezone }
  const values = draft ?? { ...current, expected: current }
  const parsed = campingProfileUpdateSchema.safeParse(values)
  const invalidTimezone =
    !parsed.success &&
    parsed.error.issues.some((issue) => issue.path[0] === 'timezone')
  const changed =
    values.name.trim() !== current.name ||
    values.timezone.trim() !== current.timezone

  const error = status.error
  const httpStatus = error && 'status' in error ? error.status : undefined
  const data = error && 'data' in error ? error.data : undefined
  const code =
    data && typeof data === 'object' && 'code' in data ? data.code : undefined

  async function save(input: CampingProfileUpdate) {
    setConfirmation(null)
    const result = await update(input)
    if (result.data) setDraft(null)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!parsed.success || !changed || status.isLoading) return
    const input = { ...parsed.data }
    if (httpStatus === 409 && code !== 'ACTIVE_STAYS') {
      if (input.name === input.expected.name) input.name = current.name
      if (input.timezone === input.expected.timezone)
        input.timezone = current.timezone
      input.expected = current
    }
    if (input.timezone !== current.timezone) setConfirmation(input)
    else void save(input)
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
          <TextField
            label={t('settings.timezone')}
            value={values.timezone}
            required
            disabled={status.isLoading}
            error={invalidTimezone}
            helperText={
              invalidTimezone
                ? t('settings.invalidTimezone')
                : t('settings.timezoneExample')
            }
            slotProps={{ htmlInput: { maxLength: 64 } }}
            onChange={(event) =>
              setDraft({ ...values, timezone: event.target.value })
            }
          />
          <TextField
            label={t('settings.currency')}
            value={profile.currency}
            helperText={t('settings.fixedCurrency')}
            slotProps={{ input: { readOnly: true } }}
          />
        </Box>
        {status.isError && (
          <Alert severity="error">
            {code === 'ACTIVE_STAYS'
              ? t('settings.activeStayTimezone')
              : httpStatus === 409
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
      <Dialog
        open={confirmation !== null}
        onClose={() => setConfirmation(null)}
      >
        <DialogTitle>{t('settings.confirmTimezone')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {confirmation &&
              t('settings.timezoneImpact', { timezone: confirmation.timezone })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmation(null)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => confirmation && void save(confirmation)}>
            {t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>
    </SectionCard>
  )
}
