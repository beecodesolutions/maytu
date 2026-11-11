import { uiProps, uiStyles } from './app/theme'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Box,
  Button,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import MaytuBrand from './components/MaytuBrand'
import { useLoginMutation } from './services/api'

export default function LoginScreen() {
  const { t } = useTranslation()
  const [login, state] = useLoginMutation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    await login({ username, password })
  }
  return (
    <Box component="main" sx={uiStyles.centeredPage}>
      <Paper
        component="form"
        onSubmit={submit}
        variant="outlined"
        sx={uiStyles.loginScreenPaper}
      >
        <Stack {...uiProps.stackStandard}>
          <MaytuBrand />
          <Typography variant="h4" component="h1" sx={uiStyles.boldText}>
            {t('auth.title')}
          </Typography>
          <Typography color="text.secondary">{t('auth.subtitle')}</Typography>
          {state.isError && <Alert severity="error">{t('auth.invalid')}</Alert>}
          <TextField
            label={t('auth.username')}
            slotProps={{ inputLabel: { shrink: true } }}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
            autoFocus
          />
          <TextField
            label={t('auth.password')}
            slotProps={{ inputLabel: { shrink: true } }}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete="current-password"
            required
          />
          <Button type="submit" variant="contained" disabled={state.isLoading}>
            {t(state.isLoading ? 'auth.loading' : 'auth.login')}
          </Button>
        </Stack>
      </Paper>
    </Box>
  )
}
