import assert from 'node:assert/strict'
import { checkConnection, reconcileVersions } from './supabase-connection-check.mjs'

const env = { SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst', SUPABASE_ACCESS_TOKEN: 'private-fixture-token' }
let calls = 0
const good = async (url, options) => {
  calls++
  assert.equal(options.method, 'GET')
  assert.equal(options.redirect, 'error')
  assert.equal(new URL(url).origin, 'https://api.supabase.com')
  return { ok: true, json: async () => url.endsWith('/migrations') ? [{ version: '202609050001' }] : { id: env.SUPABASE_PROJECT_REF } }
}
assert.equal((await checkConnection({}, good)).management, 'invalid_project_ref')
assert.equal((await checkConnection({ SUPABASE_PROJECT_REF: env.SUPABASE_PROJECT_REF }, good)).management, 'missing_access_token')
assert.equal(calls, 0)
const result = await checkConnection(env, good)
assert.equal(calls, 2)
assert.equal(result.management, 'read_verified_history_not_reconciled')
assert.equal(result.remote_migration_count, 1)
assert.equal(result.pooler, 'missing_database_password')
assert.equal(result.apply_authorized, false)
for (const [status, expected] of [[401, 'invalid_or_expired_token'], [403, 'permission_denied'], [429, 'rate_limited'], [503, 'http_503']]) {
  let attempts = 0
  const r = await checkConnection(env, async () => { attempts++; return { ok: false, status } })
  assert.equal(r.management, expected)
  assert.equal(attempts, 1)
}
assert.equal((await checkConnection(env, async () => { throw Error(env.SUPABASE_ACCESS_TOKEN) })).management, 'network_timeout_or_invalid_response')
assert.equal((await checkConnection(env, async () => ({ ok: true, json: async () => ({ id: 'wrong' }) }))).management, 'project_mismatch')
const configured = await checkConnection({ ...env, SUPABASE_DB_PASSWORD: 'private-password' }, good)
assert.equal(configured.direct, 'configured_not_verified')
assert.doesNotMatch(JSON.stringify(configured), /private-password|private-fixture-token/)
for (const malformed of [{}, [{ version: 'invalid' }], [null]]) {
  const invalid = await checkConnection(env, async url => ({
    ok: true, json: async () => url.endsWith('/migrations') ? malformed : { id: env.SUPABASE_PROJECT_REF },
  }))
  assert.equal(invalid.management, 'unexpected_history_response')
  assert.equal(invalid.apply_authorized, false)
}
const empty = await checkConnection(env, async url => ({
  ok: true, json: async () => url.endsWith('/migrations') ? [] : { id: env.SUPABASE_PROJECT_REF },
}))
assert.equal(empty.remote_migration_count, 0)
assert.equal(empty.apply_authorized, false)
assert.equal((await checkConnection(env, good)).remote_migration_count, 1, 'each run gets fresh evidence')
console.log('Connection recovery tests passed: read-only, scope, missing secrets, redaction, bounded attempts')
const drift = reconcileVersions(['001', '002'], ['001', '003'])
assert.equal(drift.shared_count, 1)
assert.deepEqual(drift.local_only_versions, ['002'])
assert.deepEqual(drift.remote_only_versions, ['003'])
assert.equal(drift.history_status, 'remote_versions_missing_locally')
assert.equal(reconcileVersions(['001'], ['001']).history_status, 'version_ids_match_sql_unverified')
const pending = reconcileVersions(['001', '002'], ['001'])
assert.equal(pending.history_status, 'local_migrations_pending_dry_run')
assert.deepEqual(pending.local_only_versions, ['002'])
assert.deepEqual(pending.remote_only_versions, [])
assert.deepEqual(pending.historical_local_only_versions, [])
assert.deepEqual(pending.future_local_only_versions, ['002'])
const outOfOrder = reconcileVersions(['001', '002', '004'], ['002', '003'])
assert.deepEqual(outOfOrder.historical_local_only_versions, ['001'])
assert.deepEqual(outOfOrder.future_local_only_versions, ['004'])
assert.throws(() => reconcileVersions(['001', '001'], []))
assert.throws(() => reconcileVersions([], ['001', '001']))
assert.throws(() => reconcileVersions(['wrong'], []))
const checked = await checkConnection(env, good, ['001'])
assert.equal(checked.history_status, 'remote_versions_missing_locally')
assert.equal(checked.apply_authorized, false)
const pendingChecked = await checkConnection(env, good, ['202609050001', '202609050002'])
assert.equal(pendingChecked.history_status, 'local_migrations_pending_dry_run')
assert.equal(pendingChecked.apply_authorized, false)
assert.equal((await checkConnection(env, good, ['202609050001'])).apply_authorized, false)
console.log('History comparison passed: remote drift, local pending, duplicates, same IDs never authorize apply')
