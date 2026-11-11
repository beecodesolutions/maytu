import { parseArgs } from 'node:util'
import {
  createAdminDataSource,
  destroy,
  inputError,
  PRIVATE_SCHEMA,
  quoteIdentifier,
  readPassword,
  reportCliFailure,
} from './common'

const HELP = `Usage:
  pnpm runtime:provision -- --role=camping_runtime
  pnpm runtime:provision -- --role=camping_runtime --create-role [--password-stdin]

The first form grants least-privilege access to an existing PostgreSQL role. The second creates a missing login role using RUNTIME_PASSWORD or --password-stdin. Existing passwords are never changed.`

type RoleSecurity = {
  rolname: string
  rolsuper: boolean
  rolcreaterole: boolean
  rolcreatedb: boolean
  rolreplication: boolean
  rolbypassrls: boolean
  isCurrentIdentity: boolean
  ownsSchema: boolean
  ownsTable: boolean
  readsAllData: boolean
  writesAllData: boolean
  canCreateDatabaseObjects: boolean
}

function runtimeRole(value: string | undefined): string {
  if (!value || !/^[a-z_][a-z0-9_]{0,62}$/.test(value)) {
    inputError(
      'role must be a lowercase PostgreSQL identifier containing only letters, digits, and underscores',
    )
  }
  return value
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args[0] === '--') args.shift()
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      role: { type: 'string' },
      'create-role': { type: 'boolean' },
      'password-stdin': { type: 'boolean' },
    },
  })
  if (values.help) {
    console.log(HELP)
    return
  }

  const role = runtimeRole(values.role ?? process.env.DATABASE_RUNTIME_ROLE)
  const roleIdentifier = quoteIdentifier(role)
  const schemaIdentifier = quoteIdentifier(PRIVATE_SCHEMA)
  const dataSource = await createAdminDataSource()
  try {
    await dataSource.initialize()
    const [existing] = (await dataSource.query(
      'SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS "exists"',
      [role],
    )) as Array<{ exists: boolean }>
    if (!existing?.exists) {
      if (!values['create-role']) {
        inputError(
          `PostgreSQL role ${role} does not exist; create it separately or pass --create-role`,
        )
      }
      const password = readPassword(
        values['password-stdin'] ?? false,
        'RUNTIME_PASSWORD',
      )
      const [literal] = (await dataSource.query(
        'SELECT quote_literal($1) AS value',
        [password],
      )) as Array<{ value: string }>
      await dataSource.query(
        `CREATE ROLE ${roleIdentifier} LOGIN PASSWORD ${literal.value}`,
      )
    }

    const [security] = (await dataSource.query(
      `SELECT
        r.rolname,
        r.rolsuper,
        r.rolcreaterole,
        r.rolcreatedb,
        r.rolreplication,
        r.rolbypassrls,
        r.rolname IN (current_user, session_user) AS "isCurrentIdentity",
        EXISTS (
          SELECT 1 FROM pg_namespace n
          WHERE n.nspname = $2 AND n.nspowner = r.oid
        ) AS "ownsSchema",
        EXISTS (
          SELECT 1
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $2 AND c.relowner = r.oid
        ) AS "ownsTable",
        pg_has_role(r.rolname, 'pg_read_all_data', 'MEMBER') AS "readsAllData",
        pg_has_role(r.rolname, 'pg_write_all_data', 'MEMBER') AS "writesAllData",
        has_database_privilege(r.rolname, current_database(), 'CREATE') AS "canCreateDatabaseObjects"
      FROM pg_roles r
      WHERE r.rolname = $1`,
      [role, PRIVATE_SCHEMA],
    )) as RoleSecurity[]
    if (
      !security ||
      security.rolsuper ||
      security.rolcreaterole ||
      security.rolcreatedb ||
      security.rolreplication ||
      security.rolbypassrls ||
      security.isCurrentIdentity ||
      security.ownsSchema ||
      security.ownsTable ||
      security.readsAllData ||
      security.writesAllData ||
      security.canCreateDatabaseObjects
    ) {
      inputError(
        `Role ${role} is privileged or owns database objects; refusing to label it as the runtime role`,
      )
    }

    await dataSource.transaction(async (manager) => {
      await manager.query(
        `REVOKE ALL ON SCHEMA ${schemaIdentifier} FROM PUBLIC`,
      )
      await manager.query(
        `REVOKE ALL ON ALL TABLES IN SCHEMA ${schemaIdentifier} FROM PUBLIC`,
      )
      for (const exposedRole of ['anon', 'authenticated']) {
        const [exposed] = (await manager.query(
          'SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS "exists"',
          [exposedRole],
        )) as Array<{ exists: boolean }>
        if (exposed?.exists) {
          const exposedIdentifier = quoteIdentifier(exposedRole)
          await manager.query(
            `REVOKE ALL ON SCHEMA ${schemaIdentifier} FROM ${exposedIdentifier}`,
          )
          await manager.query(
            `REVOKE ALL ON ALL TABLES IN SCHEMA ${schemaIdentifier} FROM ${exposedIdentifier}`,
          )
        }
      }

      await manager.query(
        `REVOKE ALL ON SCHEMA ${schemaIdentifier} FROM ${roleIdentifier}`,
      )
      await manager.query(
        `REVOKE ALL ON ALL TABLES IN SCHEMA ${schemaIdentifier} FROM ${roleIdentifier}`,
      )
      await manager.query(
        `GRANT USAGE ON SCHEMA ${schemaIdentifier} TO ${roleIdentifier}`,
      )
      await manager.query(
        `GRANT SELECT ON TABLE ${schemaIdentifier}.campings TO ${roleIdentifier}`,
      )
      await manager.query(
        `GRANT UPDATE (name, timezone, rates, money_decimals, infants_consume_capacity, age_ranges, updated_at) ON TABLE ${schemaIdentifier}.campings TO ${roleIdentifier}`,
      )
      await manager.query(
        `GRANT SELECT ON TABLE ${schemaIdentifier}.users TO ${roleIdentifier}`,
      )
      await manager.query(
        `GRANT UPDATE (failed_login_count, login_blocked_until) ON TABLE ${schemaIdentifier}.users TO ${roleIdentifier}`,
      )
      await manager.query(
        `GRANT SELECT, INSERT, DELETE ON TABLE ${schemaIdentifier}.sessions TO ${roleIdentifier}`,
      )
      await manager.query(
        `GRANT SELECT, INSERT ON TABLE ${schemaIdentifier}.stays TO ${roleIdentifier}`,
      )
      await manager.query(
        `GRANT UPDATE (version, estimated_departure, closed_at, closed_by_id, closure, reservation_id, accommodation_price_snapshot) ON TABLE ${schemaIdentifier}.stays TO ${roleIdentifier}`,
      )
      await manager.query(
        `GRANT SELECT, INSERT ON TABLE ${schemaIdentifier}.extra_templates TO ${roleIdentifier}`,
      )
      await manager.query(
        `GRANT UPDATE (category, description, unit_price_minor, enabled, updated_at) ON TABLE ${schemaIdentifier}.extra_templates TO ${roleIdentifier}`,
      )
      await manager.query(
        `GRANT SELECT, INSERT ON TABLE ${schemaIdentifier}.payments TO ${roleIdentifier}`,
      )
      await manager.query(
        `GRANT UPDATE (voided_at, voided_by_id, void_reason) ON TABLE ${schemaIdentifier}.payments TO ${roleIdentifier}`,
      )
      await manager.query(
        `GRANT UPDATE (stay_id) ON TABLE ${schemaIdentifier}.payments TO ${roleIdentifier}`,
      )
      await manager.query(
        `GRANT SELECT, INSERT, DELETE ON TABLE ${schemaIdentifier}.applied_extras TO ${roleIdentifier}`,
      )
      await manager.query(
        `GRANT UPDATE (category, description, quantity, unit_price_minor) ON TABLE ${schemaIdentifier}.applied_extras TO ${roleIdentifier}`,
      )
      await manager.query(
        `GRANT SELECT, INSERT ON TABLE ${schemaIdentifier}.accommodation_types TO ${roleIdentifier}`,
      )
      await manager.query(
        `GRANT UPDATE (name, inventory_mode, max_occupancy, base_nightly_price_minor, enabled, pricing, updated_at) ON TABLE ${schemaIdentifier}.accommodation_types TO ${roleIdentifier}`,
      )
      await manager.query(
        `GRANT SELECT, INSERT ON TABLE ${schemaIdentifier}.accommodation_units TO ${roleIdentifier}`,
      )
      await manager.query(
        `GRANT UPDATE (accommodation_type_id, name, max_occupancy, enabled, updated_at) ON TABLE ${schemaIdentifier}.accommodation_units TO ${roleIdentifier}`,
      )
      await manager.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${schemaIdentifier}.accommodation_blocks TO ${roleIdentifier}`,
      )
      await manager.query(
        `GRANT SELECT, INSERT, UPDATE ON TABLE ${schemaIdentifier}.accommodation_beds TO ${roleIdentifier}`,
      )
      await manager.query(
        `GRANT SELECT, INSERT, DELETE ON TABLE ${schemaIdentifier}.reservation_beds, ${schemaIdentifier}.bed_occupancy TO ${roleIdentifier}`,
      )
      await manager.query(
        `GRANT SELECT, INSERT, UPDATE ON TABLE ${schemaIdentifier}.reservations TO ${roleIdentifier}`,
      )
      await manager.query(
        `GRANT SELECT, INSERT, UPDATE ON TABLE ${schemaIdentifier}.outbox_events TO ${roleIdentifier}`,
      )
      await manager.query(
        `GRANT SELECT, INSERT ON TABLE ${schemaIdentifier}.audit_logs TO ${roleIdentifier}`,
      )
      await manager.query(
        `ALTER ROLE ${roleIdentifier} SET search_path TO ${schemaIdentifier}, public`,
      )
    })
    console.log(
      `Provisioned least-privilege runtime access for ${role}; no ownership, migration, seed, or future-table privileges were granted`,
    )
  } finally {
    await destroy(dataSource)
  }
}

void main().catch((error: unknown) => {
  reportCliFailure('Runtime role provisioning', error)
  process.exitCode = 1
})
