import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const functionsWorkflow = readFileSync(resolve(root, '.github/workflows/deploy-supabase-functions.yml'), 'utf8')
const migrationsWorkflow = readFileSync(resolve(root, '.github/workflows/deploy-supabase-migrations.yml'), 'utf8')
const agents = readFileSync(resolve(root, 'AGENTS.md'), 'utf8')
const profilesFoundation = readFileSync(resolve(root, 'supabase/migrations/202607210000_profiles_foundation.sql'), 'utf8')
const recoveryMigration = readFileSync(resolve(root, 'supabase/migrations/20260904120000_recover_orphaned_system_work_item_claims.sql'), 'utf8')
const boundedRetryMigration = readFileSync(resolve(root, 'supabase/migrations/20260904130000_bounded_retry_and_escalation_alerts.sql'), 'utf8')
const healthMonitor = readFileSync(resolve(root, 'supabase/functions/health-monitor/index.ts'), 'utf8')
const automationWorker = readFileSync(resolve(root, 'supabase/functions/automation-worker/index.ts'), 'utf8')

for (const contract of [
  'workflow_call:',
  'supabase/setup-cli@v1',
  'supabase functions deploy "$fn" --project-ref "$SUPABASE_PROJECT_REF"',
  'SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}',
  'SUPABASE_PROJECT_REF: ${{ secrets.SUPABASE_PROJECT_REF }}',
]) assert.ok(functionsWorkflow.includes(contract), `missing functions workflow contract: ${contract}`)

for (const contract of [
  'pull_request:',
  "- 'supabase/migrations/**'",
  'verify-migrations:',
  'apply-migrations:',
  'needs: verify-migrations',
  "if: github.event_name == 'push' && github.ref == 'refs/heads/main'",
  'supabase start',
  'supabase db reset',
  'supabase db push --linked --dry-run',
  'supabase db push --linked',
  'ALLOW-DESTRUCTIVE-MIGRATION',
  'node scripts/migration-safety-guard.mjs "$MIGRATION_BASE"',
  'node scripts/migration-safety-guard.test.mjs',
  'needs: apply-migrations',
  'uses: ./.github/workflows/deploy-supabase-functions.yml',
  "- 'supabase/functions/**'",
  'cancel-in-progress: false',
]) assert.ok(migrationsWorkflow.includes(contract), `missing migration workflow contract: ${contract}`)

assert.doesNotMatch(functionsWorkflow, /\n {2}(push|workflow_dispatch):/, 'functions must not bypass migration verification')
assert.match(functionsWorkflow, /if: github.event_name == 'push' && github.ref == 'refs\/heads\/main'/)

const pullRequestTrigger = migrationsWorkflow.slice(
  migrationsWorkflow.indexOf('  pull_request:'),
  migrationsWorkflow.indexOf('  push:'),
)
assert.doesNotMatch(pullRequestTrigger, /\n\s+paths:/, 'required verification must run on every pull request to main')
assert.equal((migrationsWorkflow.match(/supabase db push --linked$/gm) ?? []).length, 1, 'real push must exist only in apply job')
assert.ok(migrationsWorkflow.indexOf('verify-migrations:') < migrationsWorkflow.indexOf('apply-migrations:'), 'verify job must precede apply job')
assert.doesNotMatch(functionsWorkflow + migrationsWorkflow, /xkieyqixlufjqructjkr\.(?:supabase|postgres)|eyJ[A-Za-z0-9_-]+\./, 'workflow must not hard-code credentials')
assert.match(profilesFoundation, /create table if not exists public\.profiles/)
assert.match(profilesFoundation, /references auth\.users\(id\) on delete cascade/)
assert.match(profilesFoundation, /create table if not exists public\.projects/)
assert.match(profilesFoundation, /project_id uuid primary key/)
assert.match(profilesFoundation, /id uuid not null unique/)

for (const contract of ['Multi-Agent Work Claim Protocol', 'Automated Supabase Deployment Standard', 'max_attempts', 'reset_system_work_item_retry']) {
  assert.ok(agents.includes(contract), `missing AGENTS contract: ${contract}`)
}
assert.match(recoveryMigration, /recover_stale_system_work_items/)
assert.match(recoveryMigration, /wisdomai-recover-stale-work-items/)
assert.match(boundedRetryMigration, /max_attempts integer default 5/)
assert.match(boundedRetryMigration, /drop function if exists public\.claim_system_work_item\(text, integer\)/)
assert.match(boundedRetryMigration, /revoke all on function public\.claim_system_work_item\(text, integer, integer\) from public, anon, authenticated/)
assert.match(boundedRetryMigration, /grant execute on function public\.claim_system_work_item\(text, integer, integer\) to service_role/)
assert.match(boundedRetryMigration, /reset_system_work_item_retry/)
assert.match(boundedRetryMigration, /wisdomai-work-escalation-alerts/)
assert.ok(healthMonitor.indexOf("body.action === 'send_work_escalations'") < healthMonitor.indexOf('if (!monitorAuthorized)'), 'escalation action must precede settings gate')
assert.match(automationWorker, /'reset_retry'/)
assert.match(automationWorker, /admin\.rpc\('reset_system_work_item_retry'/)

console.log('Supabase deployment workflow contracts passed')
