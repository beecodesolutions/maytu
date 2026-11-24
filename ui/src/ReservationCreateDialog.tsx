import { CapacitySearchOption } from './CapacitySearchOption'
import ReservationOfferCapacity from './ReservationOfferCapacity'
import GuestCountFields from './components/GuestCountFields'
import { uiProps, uiStyles } from './app/theme'
import { useEffect, useReducer, useRef, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
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
  Checkbox,
  FormControlLabel,
  MobileStepper,
  Radio,
  RadioGroup,
  MenuItem,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { BedDouble, Tent } from 'lucide-react'
import LucideIcon from './components/LucideIcon'
import {
  reservationSearchSchema,
  reservationCreateSchema,
  type ReservationResponse,
  type CampingProfile,
  type ReservationCreate,
  todayInTimezone,
} from '@camping/contracts'
import DateRangeCalendar from './components/DateRangeCalendar'
import CountrySelect from './checkIn/CountrySelect'
import ReservationReview from './ReservationReview'
import { departureForNights, reservationNights } from './reservations/dates'
import {
  useReservationSearchMutation,
  useAccommodationTypesQuery,
  useAccommodationUnitsQuery,
  useReservationCreateMutation,
  useReservationQuoteCreateMutation,
} from './services/api'
import { formatMoney } from './services/money'
import { createUuid } from './services/uuid'
import {
  creationReducer,
  initialCreationState,
  reservationFailure,
  type CreationQuote,
} from './reservations/creationState'
import {
  reservationContact,
  reservationDefaults,
  reservationFormSchema,
  reservationQuoteInput,
  reservationValidationFields,
  type ReservationFormValues,
} from './reservations/schema'

type Props = {
  open: boolean
  profile: CampingProfile
  onClose: () => void
  onSuccess: (reservation: ReservationResponse) => void
}

// Kept mounted by the workspace so Back/reopening preserves uncertain attempts.
export default function ReservationCreateDialog({
  open,
  profile,
  onClose,
  onSuccess,
}: Props) {
  const { t, i18n } = useTranslation()
  const theme = useTheme()
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'))
  const typesQuery = useAccommodationTypesQuery(undefined, { skip: !open })
  const unitsQuery = useAccommodationUnitsQuery(undefined, { skip: !open })
  const types = typesQuery.data ?? []
  const units = unitsQuery.data ?? []
  const usableTypes = types.filter(
    (type) =>
      type.enabled &&
      (type.inventoryMode === 'unlimited' ||
        units.some((unit) => unit.enabled && unit.typeId === type.id)),
  )
  const [state, dispatch] = useReducer(creationReducer, initialCreationState)
  const [requestQuote, quoteRequest] = useReservationQuoteCreateMutation()
  const [createReservation] = useReservationCreateMutation()
  const [step, setStep] = useState(0)
  const [offers, setOffers] = useState<CreationQuote[] | null>(null)
  const [selected, setSelected] = useState<CreationQuote | null>(null)
  const [includeInsufficientCapacity, setIncludeInsufficientCapacity] =
    useState(false)
  const [typeFilter, setTypeFilter] = useState('')
  const [unitFilter, setUnitFilter] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const [searchOffers] = useReservationSearchMutation()
  const searchRevision = useRef(0)
  const searchingRef = useRef(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const sending = useRef(false)
  const {
    register,
    control,
    handleSubmit,
    setValue,
    getFieldState,
    getValues,
    setError,
    clearErrors,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ReservationFormValues>({
    resolver: zodResolver(reservationFormSchema(types, units)),
    defaultValues: reservationDefaults(profile.timezone),
  })
  const typeId = useWatch({ control, name: 'accommodationTypeId' })
  const checkInDate = useWatch({ control, name: 'checkInDate' })
  const checkOutDate = useWatch({ control, name: 'checkOutDate' })
  const [nightsDraft, setNightsDraft] = useState<string | null>(null)
  const nights = reservationNights(checkInDate, checkOutDate)
  const invalidNights =
    nightsDraft !== null &&
    departureForNights(checkInDate, nightsDraft) === null
  const selectedType = types.find((type) => type.id === typeId)
  const filterUnits = typeFilter
    ? units.filter((unit) => unit.enabled && unit.typeId === typeFilter)
    : []
  const showUnitFilter = filterUnits.length > 1
  const activeUnitFilter =
    showUnitFilter && filterUnits.some((unit) => unit.id === unitFilter)
      ? unitFilter
      : ''
  const visibleOffers = (offers ?? []).filter(
    ({ input }) =>
      (!typeFilter || input.accommodationTypeId === typeFilter) &&
      (!activeUnitFilter || input.unitId === activeUnitFilter),
  )
  const offerGroups = [
    {
      title: 'reservationCreate.campingOptions' as const,
      kind: 'camping' as const,
      icon: Tent,
      offers: visibleOffers.filter(({ input }) => !input.unitId),
    },
    {
      title: 'reservationCreate.roomOptions' as const,
      kind: 'individual' as const,
      icon: BedDouble,
      offers: visibleOffers.filter(({ input }) => input.unitId),
    },
  ].filter((group) => group.offers.length > 0)
  const locked = state.attempt !== null
  const saving = state.phase === 'saving'
  const loading = typesQuery.isLoading || unitsQuery.isLoading
  const inventoryError = typesQuery.isError || unitsQuery.isError
  const noInventory = !loading && !inventoryError && usableTypes.length === 0
  const quote = state.quote
  const reviewing = step === 2 || step === 3
  useEffect(() => {
    if (open) {
      contentRef.current?.scrollTo({ top: 0 })
      if (reviewing) contentRef.current?.focus({ preventScroll: true })
    }
  }, [open, reviewing, step])
  const changed = () => {
    dispatch({ type: 'change' })
    setAccepted(false)
  }
  const searchChanged = () => {
    searchRevision.current += 1
    setOffers(null)
    setSelected(null)
    setValue('accommodationTypeId', '')
    setValue('unitId', '')
    setValue('capacityOverrideReason', '')
    setSearchError(false)
    changed()
  }
  const search = async () => {
    if (searchingRef.current) return
    if (offers?.length) {
      setStep(1)
      return
    }
    const values = getValues()
    const searchInput = reservationSearchSchema.safeParse({
      checkInDate: values.checkInDate,
      checkOutDate: values.checkOutDate,
      adults: values.adults,
      children: values.children,
      infants: values.infants,
      pets: values.pets ?? 0,
      includeInsufficientCapacity,
    })
    if (
      !searchInput.success ||
      searchInput.data.checkInDate < todayInTimezone(profile.timezone)
    ) {
      setSearchError(true)
      return
    }
    const revision = searchRevision.current
    searchingRef.current = true
    setSearching(true)
    setSearchError(false)
    try {
      const { offers: results } = await searchOffers(searchInput.data).unwrap()
      if (revision !== searchRevision.current) return
      setOffers(results.map((offer) => ({ ...offer, responsibleName: '' })))
      if (results.length) setStep(1)
    } catch {
      if (revision === searchRevision.current) setSearchError(true)
    } finally {
      searchingRef.current = false
      setSearching(false)
    }
  }
  const datesChanged = (arrival: string, departure: string) => {
    setNightsDraft(null)
    setValue('checkInDate', arrival, { shouldDirty: true })
    setValue('checkOutDate', departure, { shouldDirty: true })
    searchChanged()
  }
  const nightsChanged = (value: string) => {
    searchChanged()
    const departure = departureForNights(checkInDate, value)
    setNightsDraft(departure ? null : value)
    if (departure)
      setValue('checkOutDate', departure, {
        shouldDirty: true,
        shouldValidate: true,
      })
  }
  const errorText = (message?: string) =>
    message ? t(message, { defaultValue: t('validation.invalid') }) : undefined

  const quoteValues = async () => {
    const values = getValues()
    if (!selected || !selectedType || locked) return
    clearErrors('capacityOverrideReason')
    const revision = state.revision
    if ((values.capacityOverrideReason?.length ?? 0) > 500) {
      setError('capacityOverrideReason', {
        type: 'validate',
        message: 'validation.invalid',
      })
      return
    }
    const input = reservationQuoteInput(values, selectedType)
    setAccepted(false)
    dispatch({ type: 'quote-start' })
    try {
      const result = await requestQuote(input).unwrap()
      const refreshedQuote: CreationQuote = {
        ...result,
        input,
        responsibleName: '',
        accommodationName: selected.accommodationName,
      }
      dispatch({ type: 'quote-success', revision, quote: refreshedQuote })
      if (
        result.priceSnapshot.totalMinor === selected.priceSnapshot.totalMinor &&
        result.priceSnapshot.currency === selected.priceSnapshot.currency
      ) {
        setStep(3)
      }
    } catch (error) {
      for (const name of reservationValidationFields(error))
        setError(name, { type: 'server', message: 'validation.invalid' })
      const failure = reservationFailure(error)
      dispatch({
        type: 'quote-error',
        revision,
        error: failure.uncertain
          ? 'reservationCreate.quoteError'
          : failure.message,
      })
    }
  }

  const saveAttempt = async (attempt: ReservationCreate) => {
    if (sending.current) return
    sending.current = true
    dispatch({ type: 'save-start', attempt })
    try {
      const result = await createReservation(attempt).unwrap()
      dispatch({ type: 'reset' })
      reset(reservationDefaults(profile.timezone))
      setStep(0)
      setOffers(null)
      setSelected(null)
      setTypeFilter('')
      setUnitFilter('')
      setAccepted(false)
      onSuccess(result)
    } catch (error) {
      for (const name of reservationValidationFields(error))
        setError(name, { type: 'server', message: 'validation.invalid' })
      const failure = reservationFailure(error)
      if (!failure.uncertain) {
        setAccepted(false)
        setStep(2)
      }
      dispatch({
        type: 'save-error',
        uncertain: failure.uncertain,
        error: failure.message,
      })
    } finally {
      sending.current = false
    }
  }

  const saveValues = () =>
    handleSubmit(async (values) => {
      if (!quote || !accepted || sending.current) return
      const attempt = reservationCreateSchema.parse({
        ...quote.input,
        ...reservationContact(values),
        acceptedTotalMinor: quote.priceSnapshot.totalMinor,
        idempotencyKey: createUuid(),
      })
      await saveAttempt(attempt)
    })()

  const money = (amount: number) =>
    formatMoney(
      amount,
      quote?.priceSnapshot.currency ?? profile.currency,
      i18n.language,
    )
  const retryInventory = () => {
    void typesQuery.refetch()
    void unitsQuery.refetch()
  }

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      fullScreen={fullScreen}
      aria-labelledby="reservation-create-title"
    >
      <DialogTitle component="div">
        <MobileStepper
          variant="dots"
          steps={4}
          activeStep={step}
          position="static"
          sx={uiStyles.reservationStepHeader}
          nextButton={null}
          backButton={
            <Box>
              <Typography
                id="reservation-create-title"
                component="p"
                variant="subtitle2"
                color="text.secondary"
              >
                {t('reservationCreate.title')}
              </Typography>
              <Typography component="h2" variant="h5" aria-live="polite">
                {t(
                  (
                    [
                      'reservationCreate.step1',
                      'reservationCreate.step2',
                      'reservationCreate.step3',
                      'reservationCreate.step4',
                    ] as const
                  )[step],
                )}
              </Typography>
            </Box>
          }
        />
      </DialogTitle>
      <Box
        component="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          if (
            saving ||
            searching ||
            quoteRequest.isLoading ||
            isSubmitting ||
            invalidNights
          )
            return
          if (step === 0) void search()
          else if (step === 1 && selected) setStep(2)
          else if (step === 2) {
            if (quote) setStep(3)
            else void quoteValues()
          } else if (step === 3) {
            if (state.attempt) void saveAttempt(state.attempt)
            else if (quote && accepted) void saveValues()
          }
        }}
        sx={uiStyles.formColumn}
      >
        <DialogContent
          dividers
          ref={contentRef}
          tabIndex={-1}
          sx={uiStyles.reservationCreateDialogDialogContent}
        >
          <Stack {...uiProps.stackForm}>
            {searchError && (
              <Alert severity="error">
                {t('reservationCreate.searchError')}
              </Alert>
            )}
            {offers?.length === 0 && (
              <Alert severity="info">{t('reservationCreate.noOffers')}</Alert>
            )}
            {step === 1 && offers && (
              <Stack {...uiProps.stackForm}>
                <Box sx={uiStyles.reservationOfferFilters}>
                  <TextField
                    select
                    fullWidth
                    label={t('reservationCreate.type')}
                    slotProps={uiProps.selectWithEmptyOption}
                    value={typeFilter}
                    onChange={(event) => {
                      setTypeFilter(event.target.value)
                      setUnitFilter('')
                    }}
                  >
                    <MenuItem value="">{t('reservationCreate.all')}</MenuItem>
                    {usableTypes.map((type) => (
                      <MenuItem key={type.id} value={type.id}>
                        {type.name}
                      </MenuItem>
                    ))}
                  </TextField>
                  {showUnitFilter && (
                    <TextField
                      select
                      fullWidth
                      label={t('reservationCreate.unit')}
                      slotProps={uiProps.selectWithEmptyOption}
                      value={activeUnitFilter}
                      onChange={(event) => setUnitFilter(event.target.value)}
                    >
                      <MenuItem value="">{t('reservationCreate.all')}</MenuItem>
                      {filterUnits.map((unit) => (
                        <MenuItem key={unit.id} value={unit.id}>
                          {unit.name}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                </Box>
                {offers.length > 0 && offerGroups.length === 0 && (
                  <Alert severity="info">
                    {t('reservationCreate.noOffers')}
                  </Alert>
                )}
                <RadioGroup
                  aria-label={t('reservationCreate.step2')}
                  sx={uiStyles.reservationOfferGroups}
                  value={
                    selected
                      ? `${selected.input.accommodationTypeId}:${selected.input.unitId ?? ''}`
                      : ''
                  }
                >
                  {offerGroups.map((group) => (
                    <Box key={group.title} sx={uiStyles.reservationOfferGroup}>
                      {offerGroups.length > 1 && (
                        <Typography variant="h3">
                          <Stack
                            component="span"
                            {...uiProps.rowSmall}
                            sx={uiStyles.alignCenter}
                          >
                            <LucideIcon
                              icon={group.icon}
                              aria-hidden="true"
                              focusable="false"
                              sx={uiStyles.accommodationIdentityLucideIcon(
                                group.kind,
                              )}
                            />
                            <span>{t(group.title)}</span>
                          </Stack>
                        </Typography>
                      )}
                      {group.offers.map((offer) => {
                        const { accommodationTypeId, unitId } = offer.input
                        const key = `${accommodationTypeId}:${unitId ?? ''}`
                        const typeName = types.find(
                          ({ id }) => id === accommodationTypeId,
                        )?.name
                        const unitName = units.find(
                          ({ id }) => id === unitId,
                        )?.name
                        return (
                          <FormControlLabel
                            key={key}
                            value={key}
                            disableTypography
                            sx={uiStyles.reservationOfferRow}
                            control={<Radio size="small" />}
                            label={
                              <Box sx={uiStyles.reservationOfferDetails}>
                                <Typography
                                  component="span"
                                  variant="subtitle2"
                                >
                                  {unitName ?? offer.accommodationName}
                                </Typography>
                                <Typography
                                  component="span"
                                  variant="subtitle2"
                                  sx={uiStyles.tariffBreakdownAmount}
                                >
                                  {formatMoney(
                                    offer.priceSnapshot.totalMinor,
                                    offer.priceSnapshot.currency,
                                    i18n.language,
                                  )}
                                </Typography>
                                <Box sx={uiStyles.reservationOfferDescription}>
                                  {unitName &&
                                    typeName &&
                                    unitName !== typeName && (
                                      <Typography
                                        variant="body2"
                                        color="text.secondary"
                                      >
                                        {typeName}
                                      </Typography>
                                    )}
                                  <ReservationOfferCapacity offer={offer} />
                                </Box>
                              </Box>
                            }
                            onChange={() => {
                              setSelected(offer)
                              setValue(
                                'accommodationTypeId',
                                offer.input.accommodationTypeId,
                              )
                              setValue('unitId', offer.input.unitId ?? '')
                              if (offer !== selected) {
                                setValue('capacityOverrideReason', '')
                                clearErrors('capacityOverrideReason')
                              }
                              changed()
                            }}
                          />
                        )
                      })}
                    </Box>
                  ))}
                </RadioGroup>
              </Stack>
            )}

            {step === 2 && quoteRequest.isLoading && (
              <Typography role="status">{t('checkIn.quoting')}</Typography>
            )}
            {state.error && (
              <Alert severity="error">{errorText(state.error)}</Alert>
            )}
            {!locked && loading && (
              <Typography role="status">{t('common.loading')}</Typography>
            )}
            {!locked && inventoryError && (
              <Alert
                severity="error"
                action={
                  <Button onClick={retryInventory}>{t('common.retry')}</Button>
                }
              >
                {t('reservationCreate.inventoryError')}
              </Alert>
            )}
            {!locked && noInventory && (
              <Alert severity="info">
                {t('reservationCreate.noInventory')}
              </Alert>
            )}
            <Box
              component="fieldset"
              hidden={step === 1}
              disabled={
                locked ||
                loading ||
                inventoryError ||
                noInventory ||
                quoteRequest.isLoading
              }
              sx={uiStyles.fieldsetReset}
            >
              <Stack {...uiProps.stackForm}>
                <Box hidden={step !== 0}>
                  <Stack {...uiProps.stackForm}>
                    <DateRangeCalendar
                      editable
                      startDate={checkInDate}
                      endDate={checkOutDate}
                      today={todayInTimezone(profile.timezone)}
                      minDate={todayInTimezone(profile.timezone)}
                      disabled={
                        locked ||
                        loading ||
                        inventoryError ||
                        noInventory ||
                        searching
                      }
                      onChange={datesChanged}
                      summaryField={
                        <TextField
                          name="nights"
                          label={t('reservationCreate.nightsField')}
                          sx={uiStyles.dateRangeNightsField}
                          id="reservation-nights"
                          type="number"
                          required
                          fullWidth
                          value={nightsDraft ?? nights}
                          onChange={(event) =>
                            nightsChanged(event.target.value)
                          }
                          disabled={locked || !checkInDate}
                          error={invalidNights}
                          slotProps={{
                            inputLabel: { shrink: true },
                            htmlInput: {
                              'aria-describedby': invalidNights
                                ? 'reservation-nights-error'
                                : undefined,
                              min: 1,
                              max: 366,
                              step: 1,
                              inputMode: 'numeric',
                            },
                          }}
                        />
                      }
                    />
                    {invalidNights && (
                      <Typography
                        id="reservation-nights-error"
                        role="alert"
                        variant="caption"
                        color="error"
                      >
                        {t('reservationCreate.invalidNights')}
                      </Typography>
                    )}
                    <Box sx={uiStyles.reservationGuestCountGrid}>
                      <GuestCountFields
                        ageRanges={profile.ageRanges}
                        register={register}
                        errors={errors}
                        onChange={searchChanged}
                      />
                    </Box>
                    <CapacitySearchOption
                      checked={includeInsufficientCapacity}
                      onChange={(value) => {
                        setIncludeInsufficientCapacity(value)
                        searchChanged()
                      }}
                    />
                  </Stack>
                </Box>
                {step === 2 && selected && (
                  <Stack {...uiProps.stackForm}>
                    <ReservationReview
                      quote={quote ?? selected}
                      ageRanges={profile.ageRanges}
                      today={todayInTimezone(profile.timezone)}
                    />
                    {selected.capacityMatch === 'INSUFFICIENT' && (
                      <TextField
                        fullWidth
                        label={t('pricing.capacityOverride')}
                        error={!!errors.capacityOverrideReason}
                        helperText={errorText(
                          errors.capacityOverrideReason?.message,
                        )}
                        slotProps={{
                          htmlInput: register('capacityOverrideReason', {
                            onChange: () => changed(),
                          }),
                        }}
                      />
                    )}
                  </Stack>
                )}
                <Box hidden={step !== 3}>
                  <Stack {...uiProps.stackForm}>
                    <Typography>
                      {quote?.accommodationName} · {checkInDate} →{' '}
                      {checkOutDate}
                    </Typography>
                    <TextField
                      label={t('checkIn.responsibleName')}
                      required
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
                            disabled={
                              locked || loading || inventoryError || noInventory
                            }
                            error={errorText(errors.nationality?.message)}
                            onChange={(country) => {
                              field.onChange(country)
                              if (!getFieldState('phoneCountry').isDirty)
                                setValue('phoneCountry', country)
                            }}
                          />
                        )}
                      />
                      <TextField
                        label={t('checkIn.document')}
                        fullWidth
                        error={!!errors.document}
                        helperText={errorText(errors.document?.message)}
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
                            disabled={
                              locked || loading || inventoryError || noInventory
                            }
                            error={errorText(errors.phoneCountry?.message)}
                            callingCode
                          />
                        )}
                      />
                      <TextField
                        label={t('checkIn.phone')}
                        type="tel"
                        fullWidth
                        autoComplete="tel-national"
                        error={!!errors.phone}
                        helperText={errorText(errors.phone?.message)}
                        slotProps={{ htmlInput: register('phone') }}
                      />
                    </Box>
                    <TextField
                      label={t('reservationCreate.email')}
                      type="email"
                      fullWidth
                      autoComplete="email"
                      error={!!errors.email}
                      helperText={errorText(errors.email?.message)}
                      slotProps={{ htmlInput: register('email') }}
                    />
                    <TextField
                      label={t('reservationCreate.source')}
                      fullWidth
                      required
                      error={!!errors.source}
                      helperText={errorText(errors.source?.message)}
                      slotProps={{ htmlInput: register('source') }}
                    />
                    <TextField
                      label={t('reservationCreate.notes')}
                      multiline
                      minRows={2}
                      fullWidth
                      error={!!errors.notes}
                      helperText={errorText(errors.notes?.message)}
                      slotProps={{ htmlInput: register('notes') }}
                    />
                  </Stack>
                </Box>
              </Stack>
            </Box>
            {step === 3 && quote && (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={accepted}
                    disabled={locked}
                    onChange={(event) => setAccepted(event.target.checked)}
                  />
                }
                label={t('reservationCreate.acceptAmount', {
                  amount: money(quote.priceSnapshot.totalMinor),
                })}
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={uiStyles.reservationCreateDialogDialogActions}>
          <Button
            onClick={() => {
              if (step > 0 && !locked) {
                if (step === 3) setAccepted(false)
                else changed()
                setStep(step - 1)
              } else onClose()
            }}
            disabled={saving || searching || quoteRequest.isLoading}
          >
            {t(step > 0 && !locked ? 'reservationCreate.back' : 'common.close')}
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={
              searching ||
              (step === 0 && !nights) ||
              (step === 1 && !selected) ||
              (step === 3 && !!quote && !accepted && !locked) ||
              saving ||
              invalidNights ||
              isSubmitting ||
              quoteRequest.isLoading ||
              (!locked && (loading || inventoryError || noInventory))
            }
          >
            {saving
              ? t('checkIn.saving')
              : state.phase === 'uncertain'
                ? t('reservationCreate.retrySave')
                : step === 3 && quote
                  ? t('reservationCreate.createFor', {
                      amount: money(quote.priceSnapshot.totalMinor),
                    })
                  : quoteRequest.isLoading
                    ? t('checkIn.quoting')
                    : t(
                        step === 0
                          ? 'reservationCreate.search'
                          : step === 2
                            ? 'reservationCreate.enterDetails'
                            : 'reservationCreate.continue',
                      )}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
