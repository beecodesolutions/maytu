import type { ReactNode } from 'react'
import { Box, Paper } from '@mui/material'
import { uiStyles } from '../app/theme'
import { FlatSectionsContext } from './flatSectionsContext'

export default function TabbedSection({
  tabs,
  children,
}: {
  tabs: ReactNode
  children: ReactNode
}) {
  return (
    <Box sx={uiStyles.tabbedSection}>
      {tabs}
      <Paper variant="outlined" sx={uiStyles.fileCard}>
        <FlatSectionsContext.Provider value={true}>
          {children}
        </FlatSectionsContext.Provider>
      </Paper>
    </Box>
  )
}
