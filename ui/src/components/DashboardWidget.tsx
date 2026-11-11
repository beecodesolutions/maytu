import { uiProps } from '../app/theme'
import type { CSSProperties, ReactNode } from 'react'
import { Stack } from '@mui/material'
import SectionCard from './SectionCard'

type DashboardWidgetProps = {
  title: ReactNode
  titleId: string
  subtitle?: ReactNode
  action?: ReactNode
  children: ReactNode
  height?: CSSProperties['height']
  contentSpacing?: number | string
}

export default function DashboardWidget({
  title,
  titleId,
  subtitle,
  action,
  children,
  height,
  contentSpacing = uiProps.stackStandard.spacing,
}: DashboardWidgetProps) {
  return (
    <SectionCard
      title={title}
      titleId={titleId}
      subtitle={subtitle}
      action={action}
      height={height}
    >
      <Stack spacing={contentSpacing}>{children}</Stack>
    </SectionCard>
  )
}
