import { Tabs, type TabsProps } from '@mui/material'
import { uiStyles } from '../app/theme'

export default function SectionTabs(
  props: Omit<TabsProps, 'sx' | 'variant' | 'scrollButtons'>,
) {
  return (
    <Tabs
      {...props}
      variant="scrollable"
      scrollButtons={false}
      sx={uiStyles.sectionTabs}
    />
  )
}
