import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  Relation,
  Unique,
} from 'typeorm'
import { CampingEntity } from './camping.entity'
import { AccommodationTypeEntity } from './accommodation-type.entity'
import { AccommodationUnitEntity } from './accommodation-unit.entity'
import { StayEntity } from './stay.entity'
import { PaymentEntity } from './payment.entity'
import type { ReservationPriceSnapshot } from '@camping/contracts'

export type ReservationStatus =
  'confirmed' | 'checked_in' | 'checked_out' | 'cancelled' | 'no_show'

@Entity({ name: 'reservations' })
@Unique('uq_reservations_camping_id', ['campingId', 'id'])
@Unique('uq_reservations_camping_idempotency', ['campingId', 'idempotencyKey'])
export class ReservationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ name: 'camping_id', type: 'uuid' })
  campingId!: string

  @Column({ name: 'accommodation_type_id', type: 'uuid' })
  accommodationTypeId!: string

  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId!: string | null

  @ManyToOne(() => CampingEntity, (camping) => camping.reservations, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'camping_id' })
  camping!: CampingEntity

  @ManyToOne(
    () => AccommodationTypeEntity,
    (accommodationType) => accommodationType.reservations,
    { onDelete: 'RESTRICT' },
  )
  @JoinColumn({ name: 'accommodation_type_id' })
  accommodationType!: AccommodationTypeEntity

  @ManyToOne(() => AccommodationUnitEntity, (unit) => unit.reservations, {
    onDelete: 'RESTRICT',
    nullable: true,
  })
  @JoinColumn({ name: 'unit_id' })
  unit!: AccommodationUnitEntity | null

  @Column({ name: 'responsible_name', type: 'text' })
  responsibleName!: string

  @Column({ type: 'varchar', length: 254, nullable: true })
  email!: string | null

  @Column({ type: 'varchar', length: 40, nullable: true })
  phone!: string | null

  @Column({ type: 'varchar', length: 100, nullable: true })
  document!: string | null

  @Column({ type: 'varchar', length: 2, nullable: true })
  nationality!: string | null

  @Column({ name: 'check_in_date', type: 'date' })
  checkInDate!: string

  @Column({ name: 'check_out_date', type: 'date' })
  checkOutDate!: string

  @Column({ type: 'integer' })
  adults!: number

  @Column({ type: 'integer' })
  children!: number

  @Column({ type: 'integer' })
  infants!: number

  @Column({ type: 'integer', default: 0 })
  pets!: number

  @Column({ name: 'capacity_override_reason', type: 'text', nullable: true })
  capacityOverrideReason!: string | null

  @Column({ type: 'varchar', length: 16, default: 'confirmed' })
  status!: ReservationStatus

  @Column({ type: 'varchar', length: 100, default: 'manual' })
  source!: string

  @Column({ type: 'varchar', length: 500, default: '' })
  notes!: string

  @Column({ name: 'price_snapshot', type: 'jsonb' })
  priceSnapshot!: ReservationPriceSnapshot

  @Column({ type: 'integer', default: 1 })
  version!: number

  @Column({ name: 'idempotency_key', type: 'uuid' })
  idempotencyKey!: string

  @Column({
    name: 'create_request_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  createRequestHash!: string | null

  @Column({
    name: 'created_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date

  @Column({
    name: 'updated_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  updatedAt!: Date

  @OneToOne(() => StayEntity, (stay) => stay.reservation)
  stay!: Relation<StayEntity> | null

  @OneToMany(() => PaymentEntity, (payment) => payment.reservation)
  payments!: Relation<PaymentEntity>[]
}
