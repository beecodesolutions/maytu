# Camping production

Frontend: https://www.maytu.app (`https://maytu.app` redirects to the canonical `www` origin).

- Vercel project `camping`, root directory `ui`, Hobby plan. Production `VITE_ENABLE_MOCKS=false`; API defaults to `/api`.
- `ui/vercel.json` proxies `/api` to API Gateway and falls back to the SPA. Login requires the canonical frontend origin above; set CloudFormation `AllowedOrigin=https://www.maytu.app` so Lambda origin validation and API Gateway CORS agree.
- AWS account `048834125079`, region `us-east-1`, CloudFormation stack `camping-production`. Use named CLI profile `camping`; never the workstation default profile.
- Supabase Free project `xpnleaxbatypnbbwzeku`, region `us-east-1`. Private schema `camping_private`; TLS enforced. Runtime uses restricted `camping_runtime` through transaction pooler port 6543; administration uses session pooler port 5432.
- Database URL is in AWS Secrets Manager `camping/production/database`, never Vercel or Git. Public database CA is bundled in Lambda; see `api/certs/README.md`.

## Publish API

Authenticate with AWS CLI 2.32+ using `aws login --profile beecode`. Check account identity before writes. Run `pnpm package:lambda` (Docker, zip, and unzip required), which verifies the extracted ZIP and Node 24 async handler signature, then `aws cloudformation package` with `infra/template.yaml` and the private bucket `camping-deploy-048834125079-us-east-1`. Deploy the packaged template to `camping-production` with `CAPABILITY_IAM CAPABILITY_AUTO_EXPAND`, the canonical `AllowedOrigin`, and existing `DatabaseSecretArn`.

No migrations or seeds run on Lambda startup. Set `NODE_EXTRA_CA_CERTS` to the absolute path of `api/certs/supabase-ca.crt`, `DATABASE_SSL=true`, and supply `DATABASE_ADMIN_URL` privately for administration. Never put database passwords on the command line or in Git.

## Fictional test camping

`Camping Valle Escondido` is isolated from `Camping La Izuelina`. Bootstrap with:

```sh
pnpm --filter @camping/api seed:test --config-only
pnpm user -- create --username=USER --name='Display name' --camping-key=valle-escondido --password-stdin
pnpm --filter @camping/api seed:test
```

Password is read from stdin. Seed inserts missing records only; reruns preserve existing stays, payments, extras, and operator edits. It creates three active and three historical stays with payments and extras. No demo markers appear in user-facing data. The original local-only `db:seed:demo` remains separate and must not be used in production.

## Checks and rollback

After API/frontend deployment, verify login, Secure/HttpOnly/SameSite cookies, active and historical stays, session persistence, logout, rejection without authentication, and rejected foreign origins. Check that La Izuelina contains no fictional stays.

For frontend rollback, promote a known-good Vercel deployment; the former mock deployment is `camping-1n4f3vkyk-federico-alois-projects.vercel.app`. API rollback uses the prior packaged CloudFormation template/artifact. Do not revert database migrations as an automatic rollback.

AWS paid account had $100 signup credits at deployment; no paid upgrades were selected. Credits are not a permanent spending cap. Check remaining credits and actual billing before further operation. Supabase Free has no managed backup guarantee; establish and test encrypted backups before entering real guest data. Enable root-account MFA manually and use a non-root deployment identity for subsequent operations.

## Automatic production API deployment

`.github/workflows/production-api.yml` runs on every push to `main` and via
`workflow_dispatch` on `main` only. A single `camping-production` concurrency group
covers installation, packaging, database changes, publication, deployment and HTTP
checks; `cancel-in-progress: false` preserves an active run. GitHub keeps at most
one pending run per group and may supersede older pending runs; it does not promise
FIFO or deployment of every intermediate commit. All operators must avoid concurrent
manual database/stack changes while this workflow runs.

Node is selected from `package.json` (`24.x`); pnpm from `packageManager`
(`10.30.1`). Dependencies use `--frozen-lockfile`. `pnpm package:lambda` verifies the
ZIP in the Lambda Node 24 image before database changes. Administrative credentials
exist only in the migration/provision step. Its configuration check requires the
production session pooler, port **5432**, administrative production project user,
`DATABASE_SSL=true`, and `NODE_EXTRA_CA_CERTS=api/certs/supabase-ca.crt` (absolute path).
The URL must have no query string, including `sslmode`, so pg cannot override the
verified TLS configuration. Never use the runtime transaction pooler (6543) here.

`pnpm db:migrate` runs before `pnpm runtime:provision`; either failure stops the
job before publishing/deploying. Provisioning updates the existing `camping_runtime`
role, including column-scoped `UPDATE (rates, money_decimals, updated_at)` on
`camping_private.campings`. It neither creates roles nor rotates passwords.
There are no seeds, automatic migration reverts or database rollback hooks.

### Initial setup (account/repository administrator, outside the workflow)

1. Verify AWS account `048834125079`, region `us-east-1`, stack identity and a usable
   database backup/recovery procedure. Inspect current physical resources:

   ```sh
   aws sts get-caller-identity --profile beecode
   aws cloudformation describe-stack-resources --profile beecode --region us-east-1 --stack-name camping-production
   aws cloudformation describe-stacks --profile beecode --region us-east-1 --stack-name camping-production --query 'Stacks[0].Parameters'
   aws cloudformation get-template --profile beecode --region us-east-1 --stack-name camping-production --template-stage Original
   ```

2. Reuse the account IAM OIDC provider `https://token.actions.githubusercontent.com`
   with audience `sts.amazonaws.com`, or create it once if absent. Do not duplicate
   a provider that other repositories use. `infra/production-oidc.yaml` creates two
   separate roles: GitHub can publish to the existing bucket's `production/` prefix
   and operate change sets on `camping-production`; CloudFormation can update the
   exact existing function, Lambda role, HTTP API and log group, and resolve only
   the existing runtime database secret. The GitHub role cannot read that secret
   or assume the CloudFormation role directly. No permanent AWS keys are required.

3. Review and deploy the bootstrap template as an administrator, separately from
   the application stack. Pass the existing provider ARN, `ApiFunctionName`,
   `ApiExecutionRoleName`, `HttpApiId`, and the current `DatabaseSecretArn` from step 1.
   Also pass `CurrentArtifactKey`, the existing Lambda S3 key from the deployed
   template, so CloudFormation can restore the pre-CI artifact on first-run rollback.
   They must be the exact physical resources, not newly created replacements.
   Example (shell variables below contain identifiers, never database passwords):

   ```sh
   aws cloudformation deploy --profile beecode --region us-east-1 \
     --stack-name camping-production-delivery \
     --template-file infra/production-oidc.yaml --capabilities CAPABILITY_IAM \
     --parameter-overrides OidcProviderArn="$OIDC_PROVIDER_ARN" \
       ApiFunctionName="$API_FUNCTION_NAME" ApiExecutionRoleName="$API_EXECUTION_ROLE_NAME" \
       HttpApiId="$HTTP_API_ID" DatabaseSecretArn="$DATABASE_SECRET_ARN" \
       CurrentArtifactKey="$CURRENT_ARTIFACT_KEY"
   aws cloudformation describe-stacks --profile beecode --region us-east-1 \
     --stack-name camping-production-delivery --query 'Stacks[0].Outputs'
   ```

   This template intentionally supports updates to existing resources, not general
   infrastructure creation/deletion. Future resource changes require a separate
   review of the template and IAM scope. If the bucket or secret uses a custom KMS
   key, add only the required key-scoped permissions after reviewing its policy;
   this baseline assumes the existing default encryption. The deployment attaches
   the dedicated service role to `camping-production`; later manual deployments
   must account for that persistent role association.

4. Create GitHub Environment **production** in `beecodesolutions/maytu` (the existing
   environment is displayed as **Production**, which the workflow reuses; GitHub
   environment names are case-insensitive). Restrict
   deployment branches to **main only**, with no matching tags. OIDC trust uses
   exact `aud=sts.amazonaws.com` and
   `sub=repo:beecodesolutions@193028516/maytu@1377905327:environment:Production`; with environments,
   branch restriction must also be enforced by environment protection. Set required
   reviewers if desired (that makes each automatic run wait for approval).
   Add environment variables `AWS_DEPLOY_ROLE_ARN` and `CF_EXECUTION_ROLE_ARN` from
   the bootstrap outputs. Add environment secret **SUPABASE_ADMIN_URL**, a privately
   supplied URL for `postgres.xpnleaxbatypnbbwzeku` at
   `aws-0-us-east-1.pooler.supabase.com:5432/postgres`, with a URL-encoded password
   and no URL parameters. Supply it through GitHub's secret editor or private stdin;
   never paste its value into a command argument, issue, PR, log or committed file.
   Keep the runtime AWS `DatabaseSecretArn` and its restricted credentials unchanged.

5. Check the bucket is private, the resource parameters match production, environment
   protection is active, and repository Actions permissions allow the pinned actions.
   Merge the reviewed PR only after setup; merging triggers a real production run.
   None of these external setup operations are performed by local validation.

### Execution evidence and failure recovery

The workflow reads the existing stack first and passes `UsePreviousValue` for every
parameter except `AllowedOrigin=https://www.maytu.app`, including
`DatabaseSecretArn` and `ReservedConcurrency`. It refuses absent/unhealthy stacks;
there is no create-stack fallback. Change sets must contain only in-place resource
modifications; additions, removals and replacements stop before execution.
The existing application template/resources remain the source of deployment.

S3 stores packaged artifacts below `production/<commit SHA>/`; the GitHub artifact
`production-<SHA>-<attempt>` retains the ZIP, packaged template and previous-value
parameter instructions for 30 days. Preserve known-good release artifacts separately
before that retention expires. The change set is `github-<run ID>-<attempt>`.
Do not upload local `.env`, credentials or stack secret values as run artifacts.

Use Actions **Production API** (or `gh run list --workflow production-api.yml` and
`gh run view RUN_ID --log-failed`) to verify the exact SHA and each completed step.
Read CloudFormation events for the matching change set. Success requires final
`UPDATE_COMPLETE` (or `CREATE_COMPLETE` for a no-op), canonical origin, direct API
session `401 UNAUTHORIZED`, canonical CORS/preflight `204`, and foreign-origin
logout `403 ORIGIN_NOT_ALLOWED`. HTTP checks retry briefly for propagation and never
send a valid mutation or login credentials. They verify routing, Lambda startup and
origin enforcement; they do not prove authenticated database reads or all user flows.
Perform the authenticated operational checks above separately after rollout.

- Install/package/configuration failure: fix the failure and rerun; production DB
  and stack have not changed.
- Migration failure: deployment stops. Inspect `camping_private.camping_migrations`
  with the admin connection before retrying. The current migration runner uses an
  all-migrations transaction, but never assume arbitrary future migrations or lost
  connections left no effects. Reconcile first; do not seed or automatically revert.
- Provision failure: deployment stops; migrations may already be committed. Grants
  are transactional and provisioning can be rerun after diagnosing the cause.
- Publication/change-set failure: DB changes remain applied, old API remains live.
  Fix permissions/configuration and rerun the same commit. Use additive, compatible
  migrations because the previous API remains active through DB changes/deployment.
- Stack failure: inspect events and status before retrying. If rollback is stuck,
  an administrator must repair it/continue rollback; this workflow cannot escalate
  privileges or automatically repair infrastructure. A no-change change set still
  runs final stack and HTTP checks.
- HTTP failure after `UPDATE_COMPLETE`: code may already be deployed. Inspect API
  logs privately, repair forward or manually deploy a retained known-good packaged
  template using current parameters and the service role. Confirm that prior code is
  compatible with the migrated schema. Never automatically revert the database.

Reference: [GitHub OIDC for AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)
and [workflow concurrency](https://docs.github.com/en/actions/concepts/workflows-and-actions/concurrency).

### Applied repository setup and local validation

The initial delivery stack `camping-production-delivery` and account OIDC provider
have been created. The existing GitHub **Production** environment is restricted to
branch `main`, with `AWS_DEPLOY_ROLE_ARN`, `CF_EXECUTION_ROLE_ARN`, and environment
secret `SUPABASE_ADMIN_URL` configured. The template references the existing
application resources and allows rollback reads of its pre-CI artifact.
This setup does not run migrations or update the application stack. The supplied
administrative connection was checked with verified TLS in a read-only transaction;
no production data or schema changes were made during validation.

Local verification uses `node --test scripts/test-production-delivery.cjs` (mocked
AWS and HTTP, no production access), `actionlint .github/workflows/production-api.yml`,
`shellcheck scripts/production-stack.sh`, the configured Prettier/oxlint checks,
and `pnpm package:lambda`. The workflow runs the safeguard tests before packaging.
The first successful production execution is [run 40998797382, attempt 3](https://github.com/beecodesolutions/maytu/actions/runs/40998797382/attempts/3),
for main SHA `3dfa9ec7770b0a2dddf1ff5f3fa1195b70993f60`. OIDC, migration check,
runtime provisioning, publication, CloudFormation deployment and all HTTP checks
passed. The stack finished `UPDATE_COMPLETE`, retaining its database secret,
concurrency and canonical origin. Local validation alone does not establish this
production execution evidence.

### OIDC subject verification

Before configuring trust, read `gh api repos/beecodesolutions/maytu/actions/oidc/customization/sub`.
This repository uses immutable subjects (`use_immutable_subject=true`), whose
`sub_claim_prefix` includes the organization and repository IDs. Append
`:environment:Production` to that exact prefix, preserving capitalization.
The legacy subject without IDs is rejected by AWS. Confirm the actual subject in
CloudTrail's `AssumeRoleWithWebIdentity` event identity without printing OIDC tokens.
The first run failed at role assumption, before any migration or application deployment.

SAM transform processing also uses the CloudFormation service role. Both deployment
roles need `cloudformation:CreateChangeSet` on the exact AWS-managed
`transform/Serverless-2016-10-31` ARN. A missing service-role permission fails
change-set creation before application execution; database migration/provisioning
may already have succeeded and must not be reverted automatically.
