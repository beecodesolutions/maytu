import { uiStyles } from './app/theme'
import { useTranslation } from 'react-i18next'
import { Box, Button, Typography } from '@mui/material'
import { LogIn } from 'lucide-react'
import LucideIcon from './components/LucideIcon'
import CampingIllustration from './assets/CampingIllustration'

type HomeHeaderProps = {
  name: string
  greeting: string
  userName?: string
  onCheckIn?: () => void
  checkInDisabled?: boolean
  showCheckIn?: boolean
}

export default function HomeHeader({
  name,
  greeting,
  userName,
  onCheckIn,
  checkInDisabled,
  showCheckIn = true,
}: HomeHeaderProps) {
  const { t } = useTranslation()
  return (
    <Box component="header" sx={uiStyles.pageHeader}>
      <Box sx={uiStyles.pageHeadingRow}>
        <CampingIllustration />
        <Box sx={uiStyles.shrinkable}>
          <Typography variant="overline" sx={uiStyles.campgroundEyebrow}>
            {name}
          </Typography>
          <Typography
            component="h1"
            variant="pageTitle"
            sx={uiStyles.pageTitle}
          >
            {userName?.trim()
              ? t('home.greetingWithName', { greeting, name: userName.trim() })
              : greeting}
          </Typography>
        </Box>
      </Box>
      {showCheckIn && (
        <Button
          type="button"
          onClick={onCheckIn}
          startIcon={<LucideIcon icon={LogIn} />}
          disabled={checkInDisabled}
          variant="contained"
          sx={uiStyles.homeHeaderButton}
        >
          {t('checkIn.register')}
        </Button>
      )}
    </Box>
  )
}
