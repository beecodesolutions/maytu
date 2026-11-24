import { Baby, PawPrint, PersonStanding, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Box, Stack, Typography } from '@mui/material'
import { uiProps, uiStyles } from '../app/theme'
import type { AgeRanges } from '@camping/contracts'
import type { FieldError, UseFormRegisterReturn } from 'react-hook-form'
import IconNumberField from './IconNumberField'
import LucideIcon from './LucideIcon'

const guestCounts = ['adults', 'children', 'infants', 'pets'] as const
type GuestCount = (typeof guestCounts)[number]

const icons = {
  adults: UserRound,
  children: PersonStanding,
  infants: Baby,
  pets: PawPrint,
}

function guestCountLabel(
  label: string,
  name: GuestCount,
  ageRanges?: AgeRanges,
) {
  const range = name === 'pets' ? undefined : ageRanges?.[name]
  if (!range) return label
  const ages = range.max === null ? `${range.min}+` : `${range.min}–${range.max}`
  return `${label} (${ages})`
}

export function GuestCountSummary({
  counts,
  ageRanges,
}: {
  counts: Partial<Record<GuestCount, number>>
  ageRanges?: AgeRanges
}) {
  const { t } = useTranslation()
  const groups = guestCounts.flatMap((name) => {
    const count = counts[name] ?? 0
    return count > 0 ? [{ name, count }] : []
  })
  if (groups.length === 0) return null

  return (
    <Box sx={uiStyles.reservationGuestCountGrid}>
      {groups.map(({ name, count }) => (
        <Box key={name}>
          <Typography variant="body2" color="text.secondary">
            {guestCountLabel(t(`checkIn.${name}`), name, ageRanges)}
          </Typography>
          <Stack {...uiProps.rowSmall} sx={uiStyles.alignCenter}>
            <LucideIcon icon={icons[name]} fontSize="small" aria-hidden />
            <Typography sx={uiStyles.semiboldText}>{count}</Typography>
          </Stack>
        </Box>
      ))}
    </Box>
  )
}

export default function GuestCountFields({
  ageRanges,
  register,
  errors,
  onChange,
}: {
  ageRanges?: AgeRanges
  register: (
    name: GuestCount,
    options: { valueAsNumber: true },
  ) => UseFormRegisterReturn
  errors: Partial<Record<GuestCount, FieldError>>
  onChange?: () => void
}) {
  const { t } = useTranslation()
  return guestCounts.map((name) => {
    const message = errors[name]?.message
    return (
      <IconNumberField
        key={name}
        label={guestCountLabel(t(`checkIn.${name}`), name, ageRanges)}
        onChange={onChange}
        icon={icons[name]}
        required
        fullWidth
        error={!!errors[name]}
        helperText={
          message
            ? t(message, { defaultValue: t('validation.invalid') })
            : undefined
        }
        slotProps={{
          htmlInput: {
            ...register(name, { valueAsNumber: true }),
            min: 0,
            step: 1,
            inputMode: 'numeric',
          },
        }}
      />
    )
  })
}
