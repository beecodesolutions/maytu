import { useContext, useId, type ReactNode, type CSSProperties } from 'react'
import { Box, Paper, Stack, Typography } from '@mui/material'
import { uiProps, uiStyles } from '../app/theme'
import { FlatSectionsContext } from './flatSectionsContext'

type Props = {
  title?: ReactNode
  titleId?: string
  subtitle?: ReactNode
  action?: ReactNode
  children: ReactNode
  height?: CSSProperties['height']
}

export default function SectionCard({
  title,
  titleId,
  subtitle,
  action,
  children,
  height,
}: Props) {
  const flat = useContext(FlatSectionsContext)
  const generatedId = useId()
  const headingId = titleId ?? generatedId
  const content = (
    <Stack {...uiProps.stackStandard}>
      {(title || subtitle || action) && (
        <Stack {...uiProps.row} sx={uiStyles.sectionCardHeader}>
          <Stack {...uiProps.stackTight} sx={uiStyles.flexContent}>
            {title && (
              <Typography
                id={headingId}
                component="h2"
                variant="h6"
                sx={uiStyles.sectionCardTitle}
              >
                {title}
              </Typography>
            )}
            {subtitle && (
              <Typography variant="body2" color="text.secondary">
                {subtitle}
              </Typography>
            )}
          </Stack>
          {action}
        </Stack>
      )}
      {children}
    </Stack>
  )
  return flat ? (
    <Box
      component="section"
      aria-labelledby={title ? headingId : undefined}
      sx={uiStyles.fileSection}
    >
      {content}
    </Box>
  ) : (
    <Paper
      component="section"
      variant="outlined"
      aria-labelledby={title ? headingId : undefined}
      sx={uiStyles.sectionCard(height)}
    >
      {content}
    </Paper>
  )
}
