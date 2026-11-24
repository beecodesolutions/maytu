import { Injectable } from '@nestjs/common'
import { DataSource, type EntityManager } from 'typeorm'
import {
  availabilityQuerySchema,
  availabilityResponseSchema,
  type AvailabilityResponse,
} from '@camping/contracts'
import { notFound, zodBadRequest } from '../common/errors'
import type { AuthContext } from '../auth/auth.types'

type AvailabilityQuery = ReturnType<typeof availabilityQuerySchema.parse>

type TypeRow = {
  id: string
  name: string
  inventory_mode: 'individual' | 'unlimited' | 'shared'
  enabled: boolean
}

type UnitRow = {
  id: string
  accommodation_type_id: string
  name: string
  enabled: boolean
}

type ReservationRow = {
  accommodation_type_id: string
  unit_id: string | null
  check_in_date: string
  check_out_date: string
  adults: number
  children: number
  infants: number
}

type BlockRow = {
  accommodation_type_id: string
  unit_id: string
  check_in_date: string
  check_out_date: string
}

type IndividualNight = {
  date: string
  totalUnits: number
  reservedUnits: number
  blockedUnits: number
  availableUnits: number
}

type UnlimitedNight = {
  date: string
  reservations: number
  adults: number
  children: number
  infants: number
}

const activeReservationStatuses = ['confirmed', 'checked_in']
const databaseSchema = 'camping_private'

function dateList(checkInDate: string, checkOutDate: string): string[] {
  const dates: string[] = []
  const cursor = new Date(`${checkInDate}T00:00:00.000Z`)
  const end = Date.parse(`${checkOutDate}T00:00:00.000Z`)
  while (cursor.getTime() < end) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

function overlapsDate(
  date: string,
  checkInDate: string,
  checkOutDate: string,
): boolean {
  return date >= checkInDate && date < checkOutDate
}

function overlapsRequestedRange(
  row: { check_in_date: string; check_out_date: string },
  query: AvailabilityQuery,
): boolean {
  return (
    row.check_in_date < query.checkOutDate &&
    row.check_out_date > query.checkInDate
  )
}

@Injectable()
export class AvailabilityService {
  constructor(private readonly dataSource: DataSource) {}

  async read(
    context: AuthContext,
    raw: unknown,
  ): Promise<AvailabilityResponse> {
    const parsed = availabilityQuerySchema.safeParse(raw)
    if (!parsed.success) throw zodBadRequest(parsed.error)

    const query = parsed.data
    const runner = this.dataSource.createQueryRunner()
    await runner.connect()
    try {
      await runner.startTransaction('REPEATABLE READ')
      const result = await this.readSnapshot(runner.manager, context, query)
      await runner.commitTransaction()
      return result
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction()
      throw error
    } finally {
      await runner.release()
    }
  }

  async readSnapshot(
    manager: EntityManager,
    context: AuthContext,
    query: AvailabilityQuery,
  ): Promise<AvailabilityResponse> {
    const campingId = context.camping.id
    const typeRows = (await manager.query(
      `SELECT id, name, inventory_mode, enabled
       FROM ${databaseSchema}.accommodation_types
       WHERE camping_id = $1
       ORDER BY name ASC, id ASC`,
      [campingId],
    )) as TypeRow[]

    const selectedTypes = query.typeId
      ? typeRows.filter((type) => type.id === query.typeId)
      : typeRows
    if (query.typeId && selectedTypes.length === 0)
      throw notFound('Accommodation type')

    const typeIds = selectedTypes.map((type) => type.id)
    const units = (await manager.query(
      `SELECT id, accommodation_type_id, name, enabled
       FROM ${databaseSchema}.accommodation_units
       WHERE camping_id = $1 AND accommodation_type_id = ANY($2::uuid[])
       ORDER BY name ASC, id ASC`,
      [campingId, typeIds],
    )) as UnitRow[]

    const reservations = (await manager.query(
      `SELECT accommodation_type_id, unit_id,
              check_in_date::text AS check_in_date,
              check_out_date::text AS check_out_date,
              adults, children, infants
       FROM ${databaseSchema}.reservations
       WHERE camping_id = $1
         AND accommodation_type_id = ANY($2::uuid[])
         AND check_in_date < $4::date
         AND check_out_date > $3::date
         AND status = ANY($5::varchar[])
       ORDER BY check_in_date ASC, check_out_date ASC, id ASC`,
      [
        campingId,
        typeIds,
        query.checkInDate,
        query.checkOutDate,
        activeReservationStatuses,
      ],
    )) as ReservationRow[]

    const blocks = (await manager.query(
      `SELECT accommodation_type_id, unit_id,
              check_in_date::text AS check_in_date,
              check_out_date::text AS check_out_date
       FROM ${databaseSchema}.accommodation_blocks
       WHERE camping_id = $1
         AND accommodation_type_id = ANY($2::uuid[])
         AND check_in_date < $4::date
         AND check_out_date > $3::date
       ORDER BY check_in_date ASC, check_out_date ASC, unit_id ASC`,
      [campingId, typeIds, query.checkInDate, query.checkOutDate],
    )) as BlockRow[]

    const dates = dateList(query.checkInDate, query.checkOutDate)
    const unitsByType = new Map<string, UnitRow[]>()
    for (const unit of units) {
      const typeUnits = unitsByType.get(unit.accommodation_type_id) ?? []
      typeUnits.push(unit)
      unitsByType.set(unit.accommodation_type_id, typeUnits)
    }
    const reservationsByType = new Map<string, ReservationRow[]>()
    for (const reservation of reservations) {
      const typeReservations =
        reservationsByType.get(reservation.accommodation_type_id) ?? []
      typeReservations.push(reservation)
      reservationsByType.set(
        reservation.accommodation_type_id,
        typeReservations,
      )
    }
    const blocksByType = new Map<string, BlockRow[]>()
    for (const block of blocks) {
      const typeBlocks = blocksByType.get(block.accommodation_type_id) ?? []
      typeBlocks.push(block)
      blocksByType.set(block.accommodation_type_id, typeBlocks)
    }

    const hasShared = selectedTypes.some((t) => t.inventory_mode === 'shared')
    const bedRows = hasShared
      ? ((await manager.query(
          `SELECT b.id,b.unit_id FROM camping_private.accommodation_beds b JOIN camping_private.accommodation_units u ON u.id=b.unit_id AND u.camping_id=b.camping_id WHERE b.camping_id=$1 AND u.accommodation_type_id=ANY($2::uuid[]) AND b.enabled`,
          [campingId, typeIds],
        )) as { id: string; unit_id: string }[])
      : []
    const occupiedBeds = hasShared
      ? ((await manager.query(
          `SELECT bed_id,night::text AS night FROM camping_private.bed_occupancy WHERE camping_id=$1 AND night >= $2::date AND night < $3::date`,
          [campingId, query.checkInDate, query.checkOutDate],
        )) as { bed_id: string; night: string }[])
      : []
    const occupiedByDate = new Map<string, Set<string>>()
    for (const row of occupiedBeds) {
      const set = occupiedByDate.get(row.night) ?? new Set<string>()
      set.add(row.bed_id)
      occupiedByDate.set(row.night, set)
    }
    const occupiedForStay = new Set(occupiedBeds.map((b) => b.bed_id))
    const response = {
      checkInDate: query.checkInDate,
      checkOutDate: query.checkOutDate,
      types: selectedTypes.map((type) => {
        if (type.inventory_mode === 'shared') {
          const sharedUnits = type.enabled
            ? (unitsByType.get(type.id) ?? []).filter((u) => u.enabled)
            : []
          return {
            typeId: type.id,
            inventoryMode: 'shared' as const,
            units: sharedUnits.map((unit) => {
              const beds = bedRows.filter((b) => b.unit_id === unit.id)
              const unitBlocks = (blocksByType.get(type.id) ?? []).filter(
                (b) => b.unit_id === unit.id,
              )
              return {
                unitId: unit.id,
                availableBeds: unitBlocks.length
                  ? 0
                  : beds.filter((b) => !occupiedForStay.has(b.id)).length,
                nights: dates.map((date) => {
                  const blocked = unitBlocks.some((b) =>
                    overlapsDate(date, b.check_in_date, b.check_out_date),
                  )
                  const reservedBeds = beds.filter((b) =>
                    occupiedByDate.get(date)?.has(b.id),
                  ).length
                  return {
                    date,
                    totalBeds: beds.length,
                    reservedBeds,
                    blockedBeds: blocked ? beds.length : 0,
                    availableBeds: blocked ? 0 : beds.length - reservedBeds,
                  }
                }),
              }
            }),
          }
        }
        if (type.inventory_mode === 'unlimited') {
          return {
            typeId: type.id,
            inventoryMode: 'unlimited' as const,
            nights: this.unlimitedNights(
              dates,
              reservationsByType.get(type.id) ?? [],
            ),
          }
        }
        const enabledUnits = type.enabled
          ? (unitsByType.get(type.id) ?? []).filter((unit) => unit.enabled)
          : []
        return {
          typeId: type.id,
          inventoryMode: 'individual' as const,
          nights: this.individualNights(
            dates,
            enabledUnits,
            reservationsByType.get(type.id) ?? [],
            blocksByType.get(type.id) ?? [],
          ),
          availableUnitIds: this.availableUnitIds(
            enabledUnits,
            reservationsByType.get(type.id) ?? [],
            blocksByType.get(type.id) ?? [],
            query,
          ),
        }
      }),
    }
    return availabilityResponseSchema.parse(response)
  }

  private individualNights(
    dates: string[],
    enabledUnits: UnitRow[],
    reservations: ReservationRow[],
    blocks: BlockRow[],
  ): IndividualNight[] {
    const enabledUnitIds = new Set(enabledUnits.map((unit) => unit.id))
    return dates.map((date) => {
      const reserved = new Set<string>()
      const blocked = new Set<string>()
      for (const reservation of reservations) {
        if (
          reservation.unit_id &&
          enabledUnitIds.has(reservation.unit_id) &&
          overlapsDate(
            date,
            reservation.check_in_date,
            reservation.check_out_date,
          )
        )
          reserved.add(reservation.unit_id)
      }
      for (const block of blocks) {
        if (
          enabledUnitIds.has(block.unit_id) &&
          overlapsDate(date, block.check_in_date, block.check_out_date)
        )
          blocked.add(block.unit_id)
      }
      const unavailable = new Set([...reserved, ...blocked])
      return {
        date,
        totalUnits: enabledUnits.length,
        reservedUnits: reserved.size,
        blockedUnits: blocked.size,
        availableUnits: enabledUnits.length - unavailable.size,
      }
    })
  }

  private unlimitedNights(
    dates: string[],
    reservations: ReservationRow[],
  ): UnlimitedNight[] {
    return dates.map((date) => {
      const covering = reservations.filter((reservation) =>
        overlapsDate(
          date,
          reservation.check_in_date,
          reservation.check_out_date,
        ),
      )
      return {
        date,
        reservations: covering.length,
        adults: covering.reduce((total, row) => total + row.adults, 0),
        children: covering.reduce((total, row) => total + row.children, 0),
        infants: covering.reduce((total, row) => total + row.infants, 0),
      }
    })
  }

  private availableUnitIds(
    enabledUnits: UnitRow[],
    reservations: ReservationRow[],
    blocks: BlockRow[],
    query: AvailabilityQuery,
  ): string[] {
    const reservedUnitIds = new Set(
      reservations
        .filter(
          (reservation) =>
            reservation.unit_id && overlapsRequestedRange(reservation, query),
        )
        .map((reservation) => reservation.unit_id)
        .filter((unitId): unitId is string => unitId !== null),
    )
    const blockedUnitIds = new Set(
      blocks
        .filter((block) => overlapsRequestedRange(block, query))
        .map((block) => block.unit_id),
    )
    return enabledUnits
      .filter(
        (unit) => !reservedUnitIds.has(unit.id) && !blockedUnitIds.has(unit.id),
      )
      .map((unit) => unit.id)
  }
}
