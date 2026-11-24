import { Baby, PawPrint, PersonStanding, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgeRanges } from '@camping/contracts'
import type { FieldError, UseFormRegisterReturn } from 'react-hook-form'
import IconNumberField from './IconNumberField'

const guestCounts = ['adults', 'children', 'infants', 'pets'] as const
type GuestCount = (typeof guestCounts)[number]

const icons = {
  adults: UserRound,
  children: PersonStanding,
  infants: Baby,
  pets: PawPrint,
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
    const range = name === 'pets' ? null : ageRanges?.[name]
    const message = errors[name]?.message
    return (
      <IconNumberField
        key={name}
        label={
          range
            ? `${t(`checkIn.${name}`)} (${range.max === null ? `${range.min}+` : `${range.min}–${range.max}`})`
            : t(`checkIn.${name}`)
        }
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
