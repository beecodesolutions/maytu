import SectionCard from './components/SectionCard'
import { useId, useState } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { ArrowLeft, ChevronDown, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  accommodationPricingSchema,
  type AccommodationPricing,
  type AccommodationType,
  type AccommodationUnit,
  type CampingProfile,
  type BlockDiscount,
} from '@camping/contracts'
import { uiProps, uiStyles } from './app/theme'
import MoneyField from './components/MoneyField'
import LucideIcon from './components/LucideIcon'
import {
  useAccommodationTypesQuery,
  useAccommodationUnitsQuery,
  useAccommodationBedsQuery,
  useCreateAccommodationTypeMutation,
  useUpdateAccommodationTypeMutation,
  useCreateAccommodationUnitMutation,
  useUpdateAccommodationUnitMutation,
  useSaveAccommodationBedMutation,
} from './services/api'

const categories = ['adults', 'children', 'infants'] as const
function initialPricing(
  type: AccommodationType | undefined,
  profile: CampingProfile,
): AccommodationPricing {
  return type?.pricing
    ? { ...type.pricing, baseNightlyPriceMinor: type.baseNightlyPriceMinor }
    : {
        basis:
          type?.inventoryMode === 'unlimited'
            ? 'per_person'
            : type?.inventoryMode === 'shared'
              ? 'per_bed'
              : 'per_unit',
        baseNightlyPriceMinor: type?.baseNightlyPriceMinor ?? 0,
        rates: profile.rates,
        extraPersonRates: { adults: 0, children: 0, infants: 0 },
        includedOccupancy: { adults: 0, children: 0, infants: 0 },
        petNightlyPriceMinor: 0,
        weekdays: [],
        discounts: [],
      }
}
export default function PricingSettings({
  profile,
}: {
  profile: CampingProfile
}) {
  const { t } = useTranslation()
  const types = useAccommodationTypesQuery()
  const [selection, setSelection] = useState<
    { mode: 'new' } | { mode: 'edit'; id: string } | null
  >(null)
  const [updateType, typeStatus] = useUpdateAccommodationTypeMutation()
  const type =
    selection?.mode === 'edit'
      ? types.data?.find((item) => item.id === selection.id)
      : undefined

  if (selection) {
    return (
      <Stack {...uiProps.stackSection}>
        <Box>
          <Button
            size="small"
            startIcon={<LucideIcon icon={ArrowLeft} />}
            onClick={() => setSelection(null)}
          >
            {t('pricing.backToTypes')}
          </Button>
        </Box>
        {selection.mode === 'new' || type ? (
          <TypePricingEditor
            key={type?.id ?? 'new'}
            type={type}
            profile={profile}
            onSaved={(saved) => {
              if (selection.mode === 'new') {
                setSelection((current) =>
                  current === selection
                    ? { mode: 'edit', id: saved.id }
                    : current,
                )
              }
            }}
          />
        ) : types.isFetching ? (
          <Typography role="status">{t('common.loading')}</Typography>
        ) : (
          <Alert severity="error">
            {t('reservationCreate.inventoryError')}
          </Alert>
        )}
        {type && type.inventoryMode !== 'unlimited' && (
          <UnitSettings key={`${type.id}:${type.inventoryMode}`} type={type} />
        )}
      </Stack>
    )
  }

  return (
    <Stack {...uiProps.stackSection}>
      <SectionCard
        title={t('settings.accommodationsTab')}
        action={
          <Button
            size="small"
            variant="outlined"
            startIcon={<LucideIcon icon={Plus} />}
            onClick={() => setSelection({ mode: 'new' })}
          >
            {t('pricing.addType')}
          </Button>
        }
      >
        {types.isError && (
          <Alert severity="error">
            {t('reservationCreate.inventoryError')}
          </Alert>
        )}
        {types.isLoading && (
          <Typography role="status">{t('common.loading')}</Typography>
        )}
        {types.data?.length === 0 && (
          <Typography color="text.secondary">{t('pricing.noTypes')}</Typography>
        )}
        {!!types.data?.length && (
          <List disablePadding aria-label={t('settings.accommodationsTab')}>
            {types.data.map((item) => (
              <ListItem key={item.id} disablePadding divider>
                <ListItemButton
                  onClick={() => setSelection({ mode: 'edit', id: item.id })}
                >
                  <ListItemText
                    primary={item.name}
                    secondary={t(`pricing.${item.inventoryMode}`)}
                    slotProps={{ primary: { sx: uiStyles.strongWrappedText } }}
                  />
                </ListItemButton>
                <Switch
                  checked={item.enabled}
                  disabled={typeStatus.isLoading || types.isFetching}
                  slotProps={{
                    input: {
                      'aria-label': t('pricing.enableType', {
                        name: item.name,
                      }),
                    },
                  }}
                  onChange={(_, enabled) => {
                    void updateType({ id: item.id, body: { enabled } })
                  }}
                />
              </ListItem>
            ))}
          </List>
        )}
        {typeStatus.isError && (
          <Alert severity="error">{t('settings.saveError')}</Alert>
        )}
      </SectionCard>
    </Stack>
  )
}
function TypePricingEditor({
  type,
  profile,
  onSaved,
}: {
  type?: AccommodationType
  profile: CampingProfile
  onSaved: (type: AccommodationType) => void
}) {
  const { t, i18n } = useTranslation()
  const editorId = useId()
  const [name, setName] = useState(type?.name ?? '')
  const [inventoryMode, setMode] = useState<AccommodationType['inventoryMode']>(
    type?.inventoryMode ?? 'individual',
  )
  const [capacity, setCapacity] = useState(type?.maxOccupancy ?? 1)
  const [pricing, setPricing] = useState(() => initialPricing(type, profile))
  const [error, setError] = useState(false)
  const [create, creating] = useCreateAccommodationTypeMutation()
  const [update, updating] = useUpdateAccommodationTypeMutation()
  const saving = creating.isLoading || updating.isLoading
  const moneyProps = {
    currency: profile.currency,
    moneyDecimals: profile.moneyDecimals,
  }
  const money = (
    label: string,
    value: number,
    change: (value: number) => void,
  ) => (
    <MoneyField
      label={label}
      fullWidth
      valueMinor={value}
      {...moneyProps}
      showCurrencyInInput
      onChangeMinor={(value) => change(value === '' ? 0 : value)}
    />
  )
  const save = async () => {
    setError(false)
    const parsed = accommodationPricingSchema.safeParse(pricing)
    if (!parsed.success) {
      setError(true)
      return
    }
    const { baseNightlyPriceMinor: _base, ...settings } = parsed.data
    const body = {
      name,
      inventoryMode,
      maxOccupancy: inventoryMode === 'unlimited' ? null : capacity,
      baseNightlyPriceMinor: pricing.baseNightlyPriceMinor,
      pricing: settings,
    }
    try {
      const result = type
        ? await update({ id: type.id, body }).unwrap()
        : await create({ ...body, enabled: true }).unwrap()
      onSaved(result)
    } catch {
      setError(true)
    }
  }
  const setDiscount = (index: number, rule: BlockDiscount) =>
    setPricing({
      ...pricing,
      discounts: pricing.discounts.map((d, i) => (i === index ? rule : d)),
    })
  return (
    <SectionCard title={type ? type.name : t('pricing.addType')}>
      <Stack {...uiProps.stackForm}>
        <TextField
          label={t('pricing.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <Box sx={uiStyles.formGrid}>
          <TextField
            select
            label={t('pricing.inventory')}
            value={inventoryMode}
            onChange={(e) => {
              const mode = e.target.value
              if (
                mode === 'shared' ||
                mode === 'individual' ||
                mode === 'unlimited'
              ) {
                setMode(mode)
                if (mode === 'shared' || inventoryMode === 'shared' || !type) {
                  setPricing({
                    ...pricing,
                    basis:
                      mode === 'shared'
                        ? 'per_bed'
                        : mode === 'unlimited'
                          ? 'per_person'
                          : 'per_unit',
                  })
                }
              }
            }}
          >
            {(['individual', 'unlimited', 'shared'] as const).map((mode) => (
              <MenuItem key={mode} value={mode}>
                {t(`pricing.${mode}`)}
              </MenuItem>
            ))}
          </TextField>
          {inventoryMode !== 'unlimited' && (
            <TextField
              type="number"
              label={t('pricing.capacity')}
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value))}
            />
          )}
        </Box>
        <Box sx={uiStyles.formGrid}>
          <TextField
            select
            label={t('pricing.basis')}
            value={pricing.basis}
            disabled={inventoryMode === 'shared'}
            onChange={(e) => {
              const basis = e.target.value
              if (
                basis === 'per_unit' ||
                basis === 'per_person' ||
                basis === 'per_bed'
              )
                setPricing({ ...pricing, basis })
            }}
          >
            {(['per_unit', 'per_person'] as const).map((basis) => (
              <MenuItem key={basis} value={basis}>
                {t(`pricing.${basis}`)}
              </MenuItem>
            ))}
            {inventoryMode === 'shared' && (
              <MenuItem value="per_bed">{t('pricing.per_bed')}</MenuItem>
            )}
          </TextField>
          {pricing.basis !== 'per_person' &&
            money(t('pricing.base'), pricing.baseNightlyPriceMinor, (value) =>
              setPricing({ ...pricing, baseNightlyPriceMinor: value }),
            )}
        </Box>
        {pricing.basis === 'per_unit' &&
          categories.map((category) => (
            <Stack key={category} {...uiProps.stackSmall}>
              <Typography>{t(`checkIn.${category}`)}</Typography>
              <Box sx={uiStyles.formGrid}>
                <TextField
                  type="number"
                  label={t('pricing.included')}
                  value={pricing.includedOccupancy[category]}
                  onChange={(e) =>
                    setPricing({
                      ...pricing,
                      includedOccupancy: {
                        ...pricing.includedOccupancy,
                        [category]: Number(e.target.value),
                      },
                    })
                  }
                />
                {money(
                  t('pricing.extra'),
                  pricing.extraPersonRates[category],
                  (value) =>
                    setPricing({
                      ...pricing,
                      extraPersonRates: {
                        ...pricing.extraPersonRates,
                        [category]: value,
                      },
                    }),
                )}
              </Box>
            </Stack>
          ))}
        <Box sx={uiStyles.formGrid}>
          {pricing.basis === 'per_person' &&
            categories.map((category) => (
              <Box key={category}>
                {money(
                  t('pricing.nightlyCategoryRate', {
                    category: t(`checkIn.${category}`),
                  }),
                  pricing.rates[category],
                  (value) =>
                    setPricing({
                      ...pricing,
                      rates: { ...pricing.rates, [category]: value },
                    }),
                )}
              </Box>
            ))}
          {money(t('pricing.pets'), pricing.petNightlyPriceMinor, (value) =>
            setPricing({ ...pricing, petNightlyPriceMinor: value }),
          )}
        </Box>
        <Box>
          <Accordion disableGutters>
            <AccordionSummary
              expandIcon={<LucideIcon icon={ChevronDown} />}
              id={`${editorId}-weekdays`}
              aria-controls={`${editorId}-weekdays-content`}
            >
              <Typography component="span" variant="h3">
                {t('pricing.weekdays')}
                {pricing.weekdays.length > 0 && ` (${pricing.weekdays.length})`}
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Stack {...uiProps.stackForm}>
                {pricing.weekdays.map((override, index) => {
                  const rate = {
                    baseNightlyPriceMinor: pricing.baseNightlyPriceMinor,
                    rates: pricing.rates,
                    extraPersonRates: pricing.extraPersonRates,
                    petNightlyPriceMinor: pricing.petNightlyPriceMinor,
                    ...override.rates,
                  }
                  const setRate = (next: typeof override.rates) =>
                    setPricing({
                      ...pricing,
                      weekdays: pricing.weekdays.map((d, i) =>
                        i === index
                          ? { ...d, rates: { ...d.rates, ...next } }
                          : d,
                      ),
                    })
                  return (
                    <Stack key={override.day} {...uiProps.stackSmall}>
                      <Typography>
                        {new Intl.DateTimeFormat(i18n.language, {
                          weekday: 'long',
                          timeZone: 'UTC',
                        }).format(
                          new Date(Date.UTC(2026, 10, 1 + override.day)),
                        )}
                      </Typography>
                      <Box sx={uiStyles.formGrid}>
                        {pricing.basis !== 'per_person' &&
                          money(
                            t('pricing.base'),
                            rate.baseNightlyPriceMinor,
                            (v) => setRate({ baseNightlyPriceMinor: v }),
                          )}
                        {pricing.basis !== 'per_bed' &&
                          categories.map((c) => (
                            <Box key={c}>
                              {money(
                                `${t(`checkIn.${c}`)} · ${t(pricing.basis === 'per_person' ? 'pricing.rate' : 'pricing.extra')}`,
                                pricing.basis === 'per_person'
                                  ? rate.rates[c]
                                  : rate.extraPersonRates[c],
                                (v) =>
                                  setRate(
                                    pricing.basis === 'per_person'
                                      ? { rates: { ...rate.rates, [c]: v } }
                                      : {
                                          extraPersonRates: {
                                            ...rate.extraPersonRates,
                                            [c]: v,
                                          },
                                        },
                                  ),
                              )}
                            </Box>
                          ))}
                        {money(
                          t('pricing.pets'),
                          rate.petNightlyPriceMinor,
                          (v) => setRate({ petNightlyPriceMinor: v }),
                        )}
                      </Box>
                      <Button
                        onClick={() =>
                          setPricing({
                            ...pricing,
                            weekdays: pricing.weekdays.filter(
                              (_, i) => i !== index,
                            ),
                          })
                        }
                      >
                        {t('pricing.remove')}
                      </Button>
                    </Stack>
                  )
                })}
                <TextField
                  select
                  label={t('pricing.addDay')}
                  value=""
                  onChange={(e) =>
                    setPricing({
                      ...pricing,
                      weekdays: [
                        ...pricing.weekdays,
                        { day: Number(e.target.value), rates: {} },
                      ],
                    })
                  }
                >
                  {[0, 1, 2, 3, 4, 5, 6]
                    .filter(
                      (day) => !pricing.weekdays.some((d) => d.day === day),
                    )
                    .map((day) => (
                      <MenuItem key={day} value={day}>
                        {new Intl.DateTimeFormat(i18n.language, {
                          weekday: 'long',
                          timeZone: 'UTC',
                        }).format(new Date(Date.UTC(2026, 10, 1 + day)))}
                      </MenuItem>
                    ))}
                </TextField>
              </Stack>
            </AccordionDetails>
          </Accordion>
          <Accordion disableGutters>
            <AccordionSummary
              expandIcon={<LucideIcon icon={ChevronDown} />}
              id={`${editorId}-discounts`}
              aria-controls={`${editorId}-discounts-content`}
            >
              <Typography component="span" variant="h3">
                {t('pricing.discounts')}
                {pricing.discounts.length > 0 &&
                  ` (${pricing.discounts.length})`}
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Stack {...uiProps.stackForm}>
                {pricing.discounts.map((rule, index) => (
                  <Stack key={index} {...uiProps.stackSmall}>
                    <TextField
                      type="number"
                      label={t('pricing.blockNights')}
                      value={rule.blockNights}
                      onChange={(e) =>
                        setDiscount(index, {
                          ...rule,
                          blockNights: Number(e.target.value),
                        })
                      }
                    />
                    <FormControlLabel
                      label={t('pricing.repeat')}
                      control={
                        <Checkbox
                          checked={rule.repeat}
                          onChange={(_e, v) =>
                            setDiscount(index, { ...rule, repeat: v })
                          }
                        />
                      }
                    />
                    <TextField
                      select
                      label={t('pricing.benefit')}
                      value={rule.benefit.type}
                      onChange={(e) => {
                        const type = e.target.value
                        if (
                          type === 'PERCENTAGE' ||
                          type === 'FIXED_AMOUNT' ||
                          type === 'FIXED_PRICE' ||
                          type === 'FREE_NIGHTS'
                        )
                          setDiscount(index, {
                            ...rule,
                            benefit: {
                              type,
                              value: type === 'FREE_NIGHTS' ? 1 : 0,
                            },
                          })
                      }}
                    >
                      {(
                        [
                          'PERCENTAGE',
                          'FIXED_AMOUNT',
                          'FIXED_PRICE',
                          'FREE_NIGHTS',
                        ] as const
                      ).map((type) => (
                        <MenuItem key={type} value={type}>
                          {t(`pricing.${type}`)}
                        </MenuItem>
                      ))}
                    </TextField>
                    {rule.benefit.type === 'FIXED_AMOUNT' ||
                    rule.benefit.type === 'FIXED_PRICE' ? (
                      money(t('pricing.value'), rule.benefit.value, (v) =>
                        setDiscount(index, {
                          ...rule,
                          benefit: { ...rule.benefit, value: v },
                        }),
                      )
                    ) : (
                      <TextField
                        type="number"
                        label={t('pricing.value')}
                        value={
                          rule.benefit.type === 'PERCENTAGE'
                            ? rule.benefit.value / 100
                            : rule.benefit.value
                        }
                        onChange={(e) =>
                          setDiscount(index, {
                            ...rule,
                            benefit: {
                              ...rule.benefit,
                              value: Math.round(
                                Number(e.target.value) *
                                  (rule.benefit.type === 'PERCENTAGE'
                                    ? 100
                                    : 1),
                              ),
                            },
                          })
                        }
                      />
                    )}
                    <Button
                      onClick={() =>
                        setPricing({
                          ...pricing,
                          discounts: pricing.discounts.filter(
                            (_, i) => i !== index,
                          ),
                        })
                      }
                    >
                      {t('pricing.remove')}
                    </Button>
                  </Stack>
                ))}
                <Button
                  onClick={() =>
                    setPricing({
                      ...pricing,
                      discounts: [
                        ...pricing.discounts,
                        {
                          blockNights: 7,
                          repeat: true,
                          benefit: { type: 'PERCENTAGE', value: 0 },
                        },
                      ],
                    })
                  }
                >
                  {t('pricing.addDiscount')}
                </Button>
              </Stack>
            </AccordionDetails>
          </Accordion>
        </Box>
        {error && <Alert severity="error">{t('settings.saveError')}</Alert>}
        <Button
          variant="contained"
          disabled={saving || !name.trim()}
          onClick={() => void save()}
        >
          {t('common.save')}
        </Button>
      </Stack>
    </SectionCard>
  )
}
function UnitSettings({ type }: { type: AccommodationType }) {
  const { t } = useTranslation()
  const sectionId = useId()
  const [expandedUnit, setExpandedUnit] = useState<string | null>(null)
  const units = useAccommodationUnitsQuery({ typeId: type.id })
  const [name, setName] = useState('')
  const [capacity, setCapacity] = useState(type.maxOccupancy ?? 1)
  const [create, status] = useCreateAccommodationUnitMutation()
  return (
    <SectionCard title={t('pricing.units')}>
      {units.isLoading && (
        <Typography role="status">{t('common.loading')}</Typography>
      )}
      <Box>
        {units.data?.map((unit) => (
          <Accordion
            key={unit.id}
            disableGutters
            expanded={expandedUnit === unit.id}
            onChange={(_, expanded) =>
              setExpandedUnit(expanded ? unit.id : null)
            }
            slotProps={{ transition: { mountOnEnter: true } }}
          >
            <AccordionSummary
              expandIcon={<LucideIcon icon={ChevronDown} />}
              id={`${sectionId}-${unit.id}`}
              aria-controls={`${sectionId}-${unit.id}-content`}
            >
              <Typography component="span" variant="h3">
                {unit.name}
                {!unit.enabled && ` · ${t('pricing.inactive')}`}
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <UnitEditor
                key={unit.updatedAt}
                unit={unit}
                shared={type.inventoryMode === 'shared'}
              />
            </AccordionDetails>
          </Accordion>
        ))}
      </Box>
      <TextField
        label={t('pricing.name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <TextField
        type="number"
        label={t('pricing.capacity')}
        value={capacity}
        onChange={(e) => setCapacity(Number(e.target.value))}
      />
      <Button
        disabled={status.isLoading || !name.trim()}
        onClick={() =>
          void create({
            typeId: type.id,
            name,
            maxOccupancy: capacity,
            enabled: true,
          })
            .unwrap()
            .then(() => setName(''))
            .catch(() => {})
        }
      >
        {t('pricing.addUnit')}
      </Button>
      {(units.isError || status.isError) && (
        <Alert severity="error">{t('settings.saveError')}</Alert>
      )}
    </SectionCard>
  )
}
function BedSettings({ unitId }: { unitId: string }) {
  const { t } = useTranslation()
  const beds = useAccommodationBedsQuery(unitId)
  const [name, setName] = useState('')
  const [save, status] = useSaveAccommodationBedMutation()
  return (
    <Stack {...uiProps.stackSmall}>
      {beds.data?.map((b) => (
        <FormControlLabel
          key={b.id}
          label={b.name}
          control={
            <Checkbox
              checked={b.enabled}
              disabled={status.isLoading}
              onChange={(_e, enabled) => {
                void save({ ...b, enabled })
              }}
            />
          }
        />
      ))}
      <TextField
        label={t('pricing.bed')}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Button
        disabled={status.isLoading || !name.trim()}
        onClick={() =>
          void save({
            unitId,
            name,
            position: beds.data?.length ?? 0,
            enabled: true,
          })
            .unwrap()
            .then(() => setName(''))
            .catch(() => {})
        }
      >
        {t('pricing.addBed')}
      </Button>
      {(beds.isError || status.isError) && (
        <Alert severity="error">{t('settings.saveError')}</Alert>
      )}
    </Stack>
  )
}

function UnitEditor({
  unit,
  shared,
}: {
  unit: AccommodationUnit
  shared: boolean
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(unit.name)
  const [capacity, setCapacity] = useState(unit.maxOccupancy)
  const [enabled, setEnabled] = useState(unit.enabled)
  const [update, status] = useUpdateAccommodationUnitMutation()
  return (
    <Stack {...uiProps.stackForm}>
      <TextField
        label={t('pricing.name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <TextField
        type="number"
        label={t('pricing.capacity')}
        value={capacity}
        onChange={(e) => setCapacity(Number(e.target.value))}
      />
      <FormControlLabel
        label={t('pricing.enabled')}
        control={
          <Checkbox checked={enabled} onChange={(_e, v) => setEnabled(v)} />
        }
      />
      <Button
        disabled={status.isLoading || !name.trim()}
        onClick={() => {
          void update({
            id: unit.id,
            body: { name, maxOccupancy: capacity, enabled },
          })
        }}
      >
        {t('common.save')}
      </Button>
      {status.isError && (
        <Alert severity="error">{t('settings.saveError')}</Alert>
      )}
      {shared && <BedSettings unitId={unit.id} />}
    </Stack>
  )
}
