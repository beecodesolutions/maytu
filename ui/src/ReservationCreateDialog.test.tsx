import { it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { useForm } from 'react-hook-form'
import { CapacitySearchOption } from './CapacitySearchOption'
import GuestCountFields from './components/GuestCountFields'
import {
  reservationDefaults,
  type ReservationFormValues,
} from './reservations/schema'
import { i18nReady } from './app/i18n'
await i18nReady
function GuestForm() {
  const {
    register,
    formState: { errors },
  } = useForm<ReservationFormValues>({
    defaultValues: reservationDefaults('UTC'),
  })
  return (
    <GuestCountFields
      ageRanges={{
        adults: { min: 16, max: null },
        children: { min: 3, max: 15 },
        infants: { min: 0, max: 2 },
      }}
      register={register}
      errors={errors}
      onChange={() => {}}
    />
  )
}
it('shows an icon for each guest input and reuses configured age labels', () => {
  const html = renderToStaticMarkup(<GuestForm />)
  for (const name of ['adults', 'children', 'infants', 'pets'])
    expect(html).toContain(`name="${name}"`)
  expect(html.match(/<svg\b/g)).toHaveLength(4)
  for (const text of ['Mascotas', '16+', '3–15', '0–2'])
    expect(html).toContain(text)
})
it('insufficient-capacity filter defaults off and can be enabled', () => {
  const off = renderToStaticMarkup(<CapacitySearchOption onChange={() => {}} />)
  expect(off).toContain('Incluir alojamientos con capacidad insuficiente')
  expect(off).not.toContain('checked=""')
  const on = renderToStaticMarkup(
    <CapacitySearchOption checked onChange={() => {}} />,
  )
  expect(on).toContain('checked=""')
})
