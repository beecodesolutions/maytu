import type { CountryCode } from 'libphonenumber-js/min'

export function countryFlag(country: CountryCode): string {
  return String.fromCodePoint(
    ...[...country].map((letter) => letter.charCodeAt(0) + 127397),
  )
}
