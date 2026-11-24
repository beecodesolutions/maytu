import { uiProps, uiStyles } from './app/theme'
import { Controller, useForm, useWatch } from 'react-hook-form'
import type { AgeRanges } from '@camping/contracts'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import GuestCountFields from './components/GuestCountFields'
import CountrySelect from './checkIn/CountrySelect'
import { useCreateStayMutation } from './services/api'
import {
  checkInDefaults,
  checkInSchemaForTimezone,
  todayInTimezone,
  type CheckInValues,
  type CheckInRequest,
} from './checkIn/schema'

type CheckInDialogProps = {
  onClose: () => void
  onSuccess: (name: string) => void
  timezone?: string
  ageRanges?: AgeRanges
}

export default function CheckInDialog({
  onClose,
  onSuccess,
  timezone = 'America/Santiago',
  ageRanges,
}: CheckInDialogProps) {
  const { t } = useTranslation()
  const theme = useTheme()
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'))
  const [createStay, { isError }] = useCreateStayMutation()
  const {
    register,
    control,
    setValue,
    getFieldState,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CheckInValues, undefined, CheckInRequest>({
    resolver: zodResolver(checkInSchemaForTimezone(timezone)),
    defaultValues: checkInDefaults(timezone),
  })
  const hasVehicle = useWatch({ control, name: 'hasVehicle' })
  const arrivalDate = useWatch({ control, name: 'arrivalDate' })
  const errorText = (message: string | undefined) =>
    message ? t(message, { defaultValue: t('validation.invalid') }) : undefined

  const submit = handleSubmit(async (values) => {
    try {
      await createStay(values).unwrap()
      onSuccess(values.responsibleName)
    } catch {
      // The mutation error is shown below; entered values remain available to retry.
    }
  })

  return (
    <Dialog
      open
      onClose={isSubmitting ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      fullScreen={fullScreen}
      aria-labelledby="check-in-title"
    >
      <DialogTitle id="check-in-title">{t('checkIn.title')}</DialogTitle>
      <Box
        component="form"
        noValidate
        onSubmit={submit}
        sx={uiStyles.formColumn}
      >
        <DialogContent dividers>
          <Stack {...uiProps.stackForm}>
            {isError && (
              <Alert severity="error">{t('checkIn.saveError')}</Alert>
            )}
            <Box
              component="fieldset"
              disabled={isSubmitting}
              sx={uiStyles.fieldsetReset}
            >
              <Stack {...uiProps.stackForm}>
                <Stack
                  component="section"
                  aria-labelledby="check-in-responsible-title"
                  {...uiProps.stackStandard}
                >
                  <Typography
                    id="check-in-responsible-title"
                    component="h2"
                    variant="subtitle1"
                    sx={uiStyles.boldText}
                  >
                    {t('checkIn.responsibleSection')}
                  </Typography>
                  <TextField
                    label={t('checkIn.responsibleName')}
                    required
                    autoFocus
                    fullWidth
                    autoComplete="name"
                    error={!!errors.responsibleName}
                    helperText={errorText(errors.responsibleName?.message)}
                    slotProps={{ htmlInput: register('responsibleName') }}
                  />
                  <Stack {...uiProps.responsiveRow}>
                    <Controller
                      name="nationality"
                      control={control}
                      render={({ field }) => (
                        <CountrySelect
                          label={t('checkIn.nationality')}
                          value={field.value}
                          inputRef={field.ref}
                          onBlur={field.onBlur}
                          disabled={isSubmitting}
                          error={errorText(errors.nationality?.message)}
                          onChange={(country) => {
                            field.onChange(country)
                            if (!getFieldState('phoneCountry').isDirty)
                              setValue('phoneCountry', country, {
                                shouldValidate: true,
                              })
                          }}
                        />
                      )}
                    />
                    <TextField
                      label={t('checkIn.document')}
                      fullWidth
                      slotProps={{ htmlInput: register('document') }}
                    />
                  </Stack>
                  <Box sx={uiStyles.contactFields}>
                    <Controller
                      name="phoneCountry"
                      control={control}
                      render={({ field }) => (
                        <CountrySelect
                          label={t('checkIn.phoneCountryCode')}
                          value={field.value}
                          inputRef={field.ref}
                          onBlur={field.onBlur}
                          onChange={field.onChange}
                          disabled={isSubmitting}
                          error={errorText(errors.phoneCountry?.message)}
                          callingCode
                        />
                      )}
                    />
                    <TextField
                      label={t('checkIn.phone')}
                      type="tel"
                      autoComplete="tel-national"
                      fullWidth
                      error={!!errors.phone}
                      helperText={errorText(errors.phone?.message)}
                      slotProps={{ htmlInput: register('phone') }}
                    />
                  </Box>
                </Stack>
                <Divider />
                <Stack
                  component="section"
                  aria-labelledby="check-in-reservation-title"
                  {...uiProps.stackStandard}
                >
                  <Typography
                    id="check-in-reservation-title"
                    component="h2"
                    variant="subtitle1"
                    sx={uiStyles.boldText}
                  >
                    {t('checkIn.reservationSection')}
                  </Typography>
                  <Stack {...uiProps.responsiveRow}>
                    <TextField
                      label={t('checkIn.arrivalDate')}
                      type="date"
                      required
                      fullWidth
                      error={!!errors.arrivalDate}
                      helperText={errorText(errors.arrivalDate?.message)}
                      slotProps={{
                        inputLabel: { shrink: true },
                        htmlInput: {
                          ...register('arrivalDate'),
                          max: todayInTimezone(timezone),
                        },
                      }}
                    />
                    <TextField
                      label={t('checkIn.estimatedDeparture')}
                      type="date"
                      fullWidth
                      error={!!errors.estimatedDeparture}
                      helperText={errorText(errors.estimatedDeparture?.message)}
                      slotProps={{
                        inputLabel: { shrink: true },
                        htmlInput: {
                          ...register('estimatedDeparture'),
                          min: arrivalDate,
                        },
                      }}
                    />
                  </Stack>
                  <Box>
                    <Box sx={uiStyles.guestCountGrid}>
                      <GuestCountFields
                        ageRanges={ageRanges}
                        register={register}
                        errors={errors}
                      />
                    </Box>
                  </Box>
                </Stack>
                <Divider />
                <Stack
                  component="section"
                  aria-labelledby="check-in-vehicle-title"
                  {...uiProps.stackStandard}
                >
                  <Stack
                    {...uiProps.rowSmall}

                    sx={uiStyles.rowBetween}
                  >
                    <Typography
                      id="check-in-vehicle-title"
                      component="h2"
                      variant="subtitle1"
                      sx={uiStyles.boldText}
                    >
                      {t('checkIn.vehicleSection')}
                    </Typography>
                    <Button
                      type="button"
                      size="small"
                      variant="outlined"
                      disabled={isSubmitting}
                      onClick={() =>
                        setValue('hasVehicle', !hasVehicle, {
                          shouldDirty: true,
                          shouldValidate: true,
                        })
                      }
                    >
                      {t(
                        hasVehicle
                          ? 'checkIn.withoutVehicle'
                          : 'checkIn.addVehicle',
                      )}
                    </Button>
                  </Stack>
                  {hasVehicle && (
                    <Stack {...uiProps.responsiveRow}>
                      <TextField
                        label={t('checkIn.vehicleDescription')}
                        fullWidth
                        slotProps={{
                          htmlInput: register('vehicleDescription'),
                        }}
                      />
                      <TextField
                        label={t('checkIn.licensePlate')}
                        fullWidth
                        slotProps={{ htmlInput: register('licensePlate') }}
                      />
                    </Stack>
                  )}
                </Stack>
                <Divider />
                <Stack
                  component="section"
                  aria-labelledby="check-in-notes-title"
                  {...uiProps.stackStandard}
                >
                  <Typography
                    id="check-in-notes-title"
                    component="h2"
                    variant="subtitle1"
                    sx={uiStyles.boldText}
                  >
                    {t('checkIn.notesSection')}
                  </Typography>
                  <TextField
                    label={t('checkIn.location')}
                    fullWidth
                    helperText={t('checkIn.locationHint')}
                    slotProps={{ htmlInput: register('location') }}
                  />
                </Stack>
              </Stack>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={uiStyles.checkInDialogDialogActions}>
          <Button onClick={onClose} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="contained" disabled={isSubmitting}>
            {t(isSubmitting ? 'checkIn.saving' : 'checkIn.submit')}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
