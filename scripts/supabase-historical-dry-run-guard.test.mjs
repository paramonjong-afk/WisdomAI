import assert from 'node:assert/strict'
import { HISTORICAL_DRY_RUN_ALLOWLIST, validateHistoricalDryRun } from './supabase-historical-dry-run-guard.mjs'

const safeReport = {
  management: 'read_verified_history_not_reconciled',
  apply_authorized: false,
  remote_only_versions: [],
  historical_local_only_versions: [...HISTORICAL_DRY_RUN_ALLOWLIST],
  future_local_only_versions: ['20260901090000'],
}

const result = validateHistoricalDryRun(safeReport)
assert.equal(result.include_all_dry_run_authorized, true)
assert.equal(result.apply_authorized, false)
assert.deepEqual(result.historical_versions, [...HISTORICAL_DRY_RUN_ALLOWLIST].sort())

for (const unsafe of [
  { ...safeReport, management: 'permission_denied' },
  { ...safeReport, apply_authorized: true },
  { ...safeReport, remote_only_versions: ['20260801000000'] },
  { ...safeReport, historical_local_only_versions: HISTORICAL_DRY_RUN_ALLOWLIST.slice(1) },
  { ...safeReport, historical_local_only_versions: [...HISTORICAL_DRY_RUN_ALLOWLIST, '20260830070000'] },
]) assert.throws(() => validateHistoricalDryRun(unsafe))

console.log('Historical include-all dry-run guard passed: exact allowlist, remote drift rejection, apply denied')
