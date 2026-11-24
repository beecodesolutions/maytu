import { InputAdornment, TextField, type TextFieldProps } from '@mui/material'
import type { LucideIcon as Icon } from 'lucide-react'
import LucideIcon from './LucideIcon'

type Props = Omit<TextFieldProps, 'type' | 'slotProps'> & {
  icon: Icon
  slotProps?: Pick<NonNullable<TextFieldProps['slotProps']>, 'htmlInput'>
}

export default function IconNumberField({ icon, slotProps, ...props }: Props) {
  return (
    <TextField
      {...props}
      type="number"
      slotProps={{
        ...slotProps,
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <LucideIcon
                icon={icon}
                fontSize="small"
                color="action"
                aria-hidden
              />
            </InputAdornment>
          ),
        },
      }}
    />
  )
}
