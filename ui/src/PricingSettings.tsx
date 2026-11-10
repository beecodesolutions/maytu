import SectionCard from './components/SectionCard'
import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
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
import {
  useAccommodationTypesQuery,
  useAccommodationUnitsQuery,
  useAccommodationBedsQuery,
  useCreateAccommodationTypeMutation,
  useUpdateAccommodationTypeMutation,
  useCreateAccommodationUnitMutation,
  useUpdateAccommodationUnitMutation,
  useSaveAccommodationBedMutation,
  useUpdateOccupancySettingsMutation,
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
  const [selected, setSelected] = useState('')
  const [updateOccupancy, status] = useUpdateOccupancySettingsMutation()
  const type = types.data?.find((x) => x.id === selected)
  return (
    <Stack {...uiProps.stackSection}>
      <SectionCard title={t('settings.accommodationsTab')}>
        <FormControlLabel
          label={t('pricing.infantsCapacity')}
          control={
            <Checkbox
              checked={profile.infantsConsumeCapacity ?? false}
              disabled={status.isLoading}
              onChange={(_event, value) => {
                void updateOccupancy({ infantsConsumeCapacity: value })
              }}
            />
          }
        />
        {status.isError && (
          <Alert severity="error">{t('settings.saveError')}</Alert>
        )}
        {types.isError && (
          <Alert severity="error">{t('settings.saveError')}</Alert>
        )}
        <TextField
          select
          label={t('reservationCreate.type')}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <MenuItem value="">{t('pricing.addType')}</MenuItem>
          {types.data?.map((item) => (
            <MenuItem key={item.id} value={item.id}>
              {item.name}
            </MenuItem>
          ))}
        </TextField>
      </SectionCard>
      <TypePricingEditor
        key={selected}
        type={type}
        profile={profile}
        onSaved={setSelected}
      />
      {type && <UnitSettings key={type.id} type={type} />}
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
  onSaved: (id: string) => void
}) {
  const { t, i18n } = useTranslation()
  const [name, setName] = useState(type?.name ?? '')
  const [inventoryMode, setMode] = useState<AccommodationType['inventoryMode']>(
    type?.inventoryMode ?? 'individual',
  )
  const [capacity, setCapacity] = useState(type?.maxOccupancy ?? 1)
  const [enabled, setEnabled] = useState(type?.enabled ?? true)
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
      valueMinor={value}
      {...moneyProps}
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
      enabled,
      pricing: settings,
    }
    try {
      const result = type
        ? await update({ id: type.id, body }).unwrap()
        : await create(body).unwrap()
      onSaved(result.id)
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
                if (mode === 'shared')
                  setPricing({ ...pricing, basis: 'per_bed' })
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
        <FormControlLabel
          label={t('pricing.enabled')}
          control={
            <Checkbox checked={enabled} onChange={(_e, v) => setEnabled(v)} />
          }
        />
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
        {pricing.basis !== 'per_bed' &&
          categories.map((category) => (
            <Stack key={category} {...uiProps.stackSmall}>
              <Typography>{t(`checkIn.${category}`)}</Typography>
              {pricing.basis === 'per_person' ? (
                money(t('pricing.rate'), pricing.rates[category], (value) =>
                  setPricing({
                    ...pricing,
                    rates: { ...pricing.rates, [category]: value },
                  }),
                )
              ) : (
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
              )}
            </Stack>
          ))}
        {money(t('pricing.pets'), pricing.petNightlyPriceMinor, (value) =>
          setPricing({ ...pricing, petNightlyPriceMinor: value }),
        )}
        <Typography variant="h6">{t('pricing.weekdays')}</Typography>
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
                i === index ? { ...d, rates: { ...d.rates, ...next } } : d,
              ),
            })
          return (
            <Stack key={override.day} {...uiProps.stackSmall}>
              <Typography>
                {new Intl.DateTimeFormat(i18n.language, {
                  weekday: 'long',
                  timeZone: 'UTC',
                }).format(new Date(Date.UTC(2026, 10, 1 + override.day)))}
              </Typography>
              <Box sx={uiStyles.formGrid}>
                {pricing.basis !== 'per_person' &&
                  money(t('pricing.base'), rate.baseNightlyPriceMinor, (v) =>
                    setRate({ baseNightlyPriceMinor: v }),
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
                {money(t('pricing.pets'), rate.petNightlyPriceMinor, (v) =>
                  setRate({ petNightlyPriceMinor: v }),
                )}
              </Box>
              <Button
                onClick={() =>
                  setPricing({
                    ...pricing,
                    weekdays: pricing.weekdays.filter((_, i) => i !== index),
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
            .filter((day) => !pricing.weekdays.some((d) => d.day === day))
            .map((day) => (
              <MenuItem key={day} value={day}>
                {new Intl.DateTimeFormat(i18n.language, {
                  weekday: 'long',
                  timeZone: 'UTC',
                }).format(new Date(Date.UTC(2026, 10, 1 + day)))}
              </MenuItem>
            ))}
        </TextField>
        <Typography variant="h6">{t('pricing.discounts')}</Typography>
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
                    benefit: { type, value: type === 'FREE_NIGHTS' ? 1 : 0 },
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
                          (rule.benefit.type === 'PERCENTAGE' ? 100 : 1),
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
                  discounts: pricing.discounts.filter((_, i) => i !== index),
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
  const units = useAccommodationUnitsQuery(undefined)
  const [name, setName] = useState('')
  const [capacity, setCapacity] = useState(type.maxOccupancy ?? 1)
  const [create, status] = useCreateAccommodationUnitMutation()
  if (type.inventoryMode === 'unlimited') return null
  return (
    <SectionCard title={t('pricing.units')}>
      {units.data
        ?.filter((u) => u.typeId === type.id)
        .map((unit) => (
          <UnitEditor
            key={`${unit.id}:${unit.updatedAt}`}
            unit={unit}
            shared={type.inventoryMode === 'shared'}
          />
        ))}
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
      {status.isError && (
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
    <Box sx={uiStyles.sectionForm}>
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
    </Box>
  )
}
