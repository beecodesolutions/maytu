import { uiProps, uiStyles, checkoutActionStyles } from './app/theme'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  IconButton,
  Tooltip,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  Menu,
  MenuItem,
  Stack,
  Typography,
} from '@mui/material'
import {
  Banknote,
  EllipsisVertical,
  LogOut,
  ShoppingBasket,
} from 'lucide-react'
import type { ReservationResponse, Stay } from '@camping/contracts'
import LucideIcon from './components/LucideIcon'
import AccommodationIdentity from './AccommodationIdentity'
import { buildAccommodationIdentity } from './services/accommodationIdentity'
import { todayInTimezone } from './checkIn/schema'
import { relativeDay } from './services/relativeDay'
import { formatMoney } from './services/money'

export type StayAction = 'detail' | 'payment' | 'close' | 'extras'
export type StaySelection = { id: string; action: StayAction }

type Props = {
  items: Stay[]
  onRegisterCheckIn?: () => void
  timezone: string
  onSelect: (selection: StaySelection) => void
  typeNames?: Map<string, string>
  typeModes?: Map<string, string>
  unitNames?: Map<string, string>
  reservationsById?: Map<string, ReservationResponse>
}

export default function StayList({
  items,
  onRegisterCheckIn,
  timezone,
  onSelect,
  typeNames,
  typeModes,
  unitNames,
  reservationsById,
}: Props) {
  const { t, i18n } = useTranslation()
  const today = todayInTimezone(timezone)
  const menuId = useId()
  const [menu, setMenu] = useState<{
    anchor: HTMLElement
    stayId: string
  } | null>(null)
  const menuStay = items.find((stay) => stay.id === menu?.stayId)
  const chooseAction = (action: 'extras' | 'payment') => {
    if (!menuStay) return
    setMenu(null)
    onSelect({ id: menuStay.id, action })
  }
  if (!items.length)
    return (
      <Stack {...uiProps.stackSmall} sx={uiStyles.panelPadding}>
        <Typography color="text.secondary">{t('home.noStays')}</Typography>
        {onRegisterCheckIn && (
          <Button onClick={onRegisterCheckIn}>{t('checkIn.register')}</Button>
        )}
      </Stack>
    )
  return (
    <>
      <List disablePadding aria-label={t('home.staysList')}>
        {items.map((stay) => {
          const reservation = stay.reservationId
            ? reservationsById?.get(stay.reservationId)
            : undefined
          const identity = buildAccommodationIdentity({
            reservation,
            hasReservation: Boolean(stay.reservationId),
            location: stay.location,
            typeNames,
            typeModes,
            unitNames,
            labels: {
              accommodation: t('home.accommodation'),
              freeCamping: t('home.freeCamping'),
              unknownUnit: t('home.unknownUnit'),
            },
          })
          return (
            <ListItem
              key={stay.id}
              disablePadding
              divider
              sx={uiStyles.stayListListItem}
            >
              <ListItemButton
                onClick={() => onSelect({ id: stay.id, action: 'detail' })}
                sx={uiStyles.stayListListItemButton}
              >
                <ListItemText
                  primary={stay.responsibleName}
                  secondary={
                    <AccommodationIdentity
                      identity={identity}
                      compactMobile
                      meta={relativeDay(stay.arrivalDate, today, i18n.language)}
                      people={stay.adults + stay.children + stay.infants}
                    />
                  }
                  slotProps={{
                    primary: {
                      sx: uiStyles.strongWrappedText,
                    },
                    secondary: {
                      component: 'div',
                      sx: uiStyles.wrappedText,
                    },
                  }}
                />
                {stay.closure && (
                  <Typography variant="body2" sx={uiStyles.stayListTypography2}>
                    {formatMoney(
                      stay.closure.totalMinor,
                      stay.currency,
                      i18n.language,
                    )}
                  </Typography>
                )}
              </ListItemButton>
              <Stack sx={uiStyles.stayListStack}>
                <Stack
                  {...uiProps.rowCompact}

                  sx={uiStyles.stayListStack2}
                >
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={uiStyles.desktopBlock}
                  >
                    {stay.extras.length > 0
                      ? t('stay.extrasCount', { count: stay.extras.length })
                      : t('stay.noExtrasLabel')}
                  </Typography>
                </Stack>
                {(!stay.closure || stay.account.balanceMinor > 0) && (
                  <Stack
                    {...uiProps.rowCompact}

                    sx={uiStyles.stayListStack3}
                  >
                    <Typography
                      variant="h6"
                      component="span"
                      aria-label={`${t(stay.account.balanceMinor < 0 ? 'stay.credit' : 'stay.balance')}: ${formatMoney(Math.abs(stay.account.balanceMinor), stay.currency, i18n.language)}`}
                      sx={uiStyles.stayListTypography4(
                        stay.account.balanceMinor,
                      )}
                    >
                      {formatMoney(
                        Math.abs(stay.account.balanceMinor),
                        stay.currency,
                        i18n.language,
                      )}
                    </Typography>
                  </Stack>
                )}
                {(!stay.closure || stay.account.balanceMinor > 0) && (
                  <Tooltip title={t('stay.moreActions')}>
                    <IconButton
                      id={`${menuId}-${stay.id}-button`}
                      aria-label={`${t('stay.moreActions')}: ${stay.responsibleName}`}
                      aria-haspopup="menu"
                      aria-controls={
                        menu?.stayId === stay.id ? menuId : undefined
                      }
                      aria-expanded={
                        menu?.stayId === stay.id ? true : undefined
                      }
                      onClick={(event) =>
                        setMenu({
                          anchor: event.currentTarget,
                          stayId: stay.id,
                        })
                      }
                      sx={uiStyles.stayListIconButton}
                    >
                      <LucideIcon icon={EllipsisVertical} />
                    </IconButton>
                  </Tooltip>
                )}
                {!stay.closure && (
                  <Tooltip title={t('stay.closeTitle')}>
                    <IconButton
                      aria-label={t('stay.closeTitle')}
                      onClick={() => onSelect({ id: stay.id, action: 'close' })}
                      sx={checkoutActionStyles}
                    >
                      <LucideIcon icon={LogOut} />
                    </IconButton>
                  </Tooltip>
                )}
              </Stack>
            </ListItem>
          )
        })}
      </List>
      <Menu
        id={menuId}
        anchorEl={menu?.anchor ?? null}
        open={Boolean(menu && menuStay)}
        onClose={() => setMenu(null)}
        slotProps={{
          list: {
            'aria-labelledby': menuStay
              ? `${menuId}-${menuStay.id}-button`
              : undefined,
          },
        }}
      >
        {menuStay && !menuStay.closure && (
          <MenuItem onClick={() => chooseAction('extras')}>
            <ListItemIcon>
              <LucideIcon icon={ShoppingBasket} />
            </ListItemIcon>
            <ListItemText>{t('stay.addExtraAction')}</ListItemText>
          </MenuItem>
        )}
        {menuStay &&
          (!menuStay.closure || menuStay.account.balanceMinor > 0) && (
            <MenuItem onClick={() => chooseAction('payment')}>
              <ListItemIcon>
                <LucideIcon icon={Banknote} />
              </ListItemIcon>
              <ListItemText>{t('stay.recordPayment')}</ListItemText>
            </MenuItem>
          )}
      </Menu>
    </>
  )
}
