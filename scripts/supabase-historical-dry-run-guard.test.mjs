import assert from 'node:assert/strict'
import {
  HISTORICAL_BASELINE_ALLOWLIST,
  REVERSIONED_CORRECTION_VERSIONS,
  validateHistoricalDryRun,
} from './supabase-historical-dry-run-guard.mjs'

const safeReport = {
  management: 'read_verified_history_not_reconciled',
  apply_authorized: false,
  remote_only_versions: [],
  historical_local_only_versions: [...HISTORICAL_BASELINE_ALLOWLIST],
  future_local_only_versions: [...REVERSIONED_CORRECTION_VERSIONS, '20260901090000'],
}

const result = validateHistoricalDryRun(safeReport)
assert.equal(result.include_all_dry_run_authorized, true)
assert.equal(result.apply_authorized, false)
assert.equal(result.baseline_history_repair_required, true)
assert.deepEqual(result.historical_versions, [...HISTORICAL_BASELINE_ALLOWLIST].sort())

const reconciled = validateHistoricalDryRun({
  ...safeReport,
  historical_local_only_versions: [],
  future_local_only_versions: [],
})
assert.equal(reconciled.baseline_history_repair_required, false)

for (const unsafe of [
  { ...safeReport, management: 'permission_denied' },
  { ...safeReport, apply_authorized: true },
  { ...safeReport, remote_only_versions: ['20260801000000'] },
  { ...safeReport, historical_local_only_versions: ['20260830070000'] },
  { ...safeReport, historical_local_only_versions: [...HISTORICAL_BASELINE_ALLOWLIST, '20260830070000'] },
  { ...safeReport, future_local_only_versions: REVERSIONED_CORRECTION_VERSIONS.slice(1) },
]) assert.throws(() => validateHistoricalDryRun(unsafe))

console.log('Historical baseline guard passed: one baseline, future corrections, remote drift rejection, apply denied')
