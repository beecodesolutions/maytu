import type { MigrationInterface, QueryRunner } from 'typeorm'

export class ConfirmReservationsOnCreate1760000008000 implements MigrationInterface {
  name = 'ConfirmReservationsOnCreate1760000008000'

  async up(runner: QueryRunner): Promise<void> {
    await runner.query('SET LOCAL search_path TO camping_private, public')
    await runner.query('LOCK TABLE reservations IN ACCESS EXCLUSIVE MODE')
    await runner.query(`
      UPDATE reservations
      SET status = 'confirmed', version = version + 1, updated_at = now()
      WHERE status = 'pending'
    `)
    await runner.query(`
      ALTER TABLE reservations
        ALTER COLUMN status SET DEFAULT 'confirmed',
        DROP CONSTRAINT reservations_status_check,
        ADD CONSTRAINT reservations_status_check
          CHECK (status IN ('confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show'))
    `)
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('SET LOCAL search_path TO camping_private, public')
    // Restore the previous schema without reverting confirmed reservations.
    await runner.query(`
      ALTER TABLE reservations
        ALTER COLUMN status SET DEFAULT 'pending',
        DROP CONSTRAINT reservations_status_check,
        ADD CONSTRAINT reservations_status_check
          CHECK (status IN ('pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show'))
    `)
  }
}
