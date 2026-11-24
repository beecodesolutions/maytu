import type { Stay } from '@camping/contracts'

type DatedStay = Pick<Stay, 'closure' | 'estimatedDeparture'>

export function groupStayDepartures<T extends DatedStay>(
  stays: readonly T[],
  date: string,
) {
  const today: T[] = []
  const overdue: T[] = []
  for (const stay of stays) {
    if (stay.closure || !stay.estimatedDeparture) continue
    if (stay.estimatedDeparture === date) today.push(stay)
    else if (stay.estimatedDeparture < date) overdue.push(stay)
  }
  return { today, overdue }
}
