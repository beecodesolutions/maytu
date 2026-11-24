import { ConfirmReservationsOnCreate1760000008000 } from './migrations/1760000008000-ConfirmReservationsOnCreate'
import { AccommodationBedEntity } from './entities/accommodation-bed.entity'
import { FlexiblePricingAndBeds1760000007000 } from './migrations/1760000007000-FlexiblePricingAndBeds'
import 'reflect-metadata'
import { MoneyPrecision1760000005000 } from './migrations/1760000005000-MoneyPrecision'
import { DataSource } from 'typeorm'
import { CampingEntity } from './entities/camping.entity'
import { UserEntity } from './entities/user.entity'
import { SessionEntity } from './entities/session.entity'
import { StayEntity } from './entities/stay.entity'
import { ExtraTemplateEntity } from './entities/extra-template.entity'
import { AppliedExtraEntity } from './entities/applied-extra.entity'
import { PaymentEntity } from './entities/payment.entity'
import { InitialSchema1760000000000 } from './migrations/1760000000000-InitialSchema'
import { AddPayments1760000001000 } from './migrations/1760000001000-AddPayments'
import { AccommodationPersistence1760000002000 } from './migrations/1760000002000-AccommodationPersistence'
import { AccommodationTypeEntity } from './entities/accommodation-type.entity'
import { AccommodationUnitEntity } from './entities/accommodation-unit.entity'
import { AccommodationBlockEntity } from './entities/accommodation-block.entity'
import { ReservationEntity } from './entities/reservation.entity'
import { OutboxEventEntity } from './entities/outbox-event.entity'
import { AuditLogEntity } from './entities/audit-log.entity'
import { ReservationCreationHash1760000003000 } from './migrations/1760000003000-ReservationCreationHash'
import { ReservationStayPricing1760000004000 } from './migrations/1760000004000-ReservationStayPricing'

import { UnitCapacity1760000006000 } from './migrations/1760000006000-UnitCapacity'

export const entities = [
  CampingEntity,
  UserEntity,
  SessionEntity,
  StayEntity,
  ExtraTemplateEntity,
  AppliedExtraEntity,
  PaymentEntity,
  AccommodationTypeEntity,
  AccommodationUnitEntity,
  AccommodationBedEntity,
  AccommodationBlockEntity,
  ReservationEntity,
  OutboxEventEntity,
  AuditLogEntity,
]

function databaseOptions() {
  const url = process.env.DATABASE_URL
  const ssl = process.env.DATABASE_SSL === 'true'
  const schema = process.env.DB_SCHEMA ?? 'camping_private'
  if (schema !== 'camping_private')
    throw new Error('DB_SCHEMA must be camping_private')
  if (process.env.NODE_ENV === 'production' && (!url || !ssl))
    throw new Error('Production requires DATABASE_URL and DATABASE_SSL=true')
  if (url && new URL(url).searchParams.has('sslmode'))
    throw new Error(
      'Configure TLS through DATABASE_SSL; remove sslmode from DATABASE_URL',
    )
  return url
    ? { schema, url, ssl: ssl ? { rejectUnauthorized: true } : false }
    : {
        schema,
        host: process.env.DB_HOST ?? 'localhost',
        port: Number(process.env.DB_PORT ?? 5434),
        username: process.env.DB_USER ?? 'camping',
        password: process.env.DB_PASSWORD ?? 'camping-local-only',
        database: process.env.DB_NAME ?? 'camping',
        ssl: ssl ? { rejectUnauthorized: true } : false,
      }
}

export function createDataSource() {
  return new DataSource({
    type: 'postgres',
    migrationsTableName: 'camping_migrations',
    ...databaseOptions(),
    entities,
    migrations: [
      InitialSchema1760000000000,
      AddPayments1760000001000,
      AccommodationPersistence1760000002000,
      ReservationCreationHash1760000003000,
      ReservationStayPricing1760000004000,
      MoneyPrecision1760000005000,
      UnitCapacity1760000006000,
      FlexiblePricingAndBeds1760000007000,
      ConfirmReservationsOnCreate1760000008000,
    ],
    synchronize: false,
    migrationsRun: false,
    logging: false,
    extra: {
      max: Number(process.env.DB_POOL_MAX ?? 2),
      connectionTimeoutMillis: Number(
        process.env.DB_CONNECTION_TIMEOUT_MS ?? 10000,
      ),
      keepAlive: true,
    },
  })
}

export const AppDataSource = createDataSource()
