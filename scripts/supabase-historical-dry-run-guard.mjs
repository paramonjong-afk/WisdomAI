import { readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { checkConnection } from './supabase-connection-check.mjs'

export const HISTORICAL_BASELINE_ALLOWLIST = [
  '202607210000',
]

export const REVERSIONED_CORRECTION_VERSIONS = [
  '20260905110000',
  '20260905110100',
  '20260905110200',
  '20260905110300',
  '20260905110400',
]

const sorted = values => [...values].sort()

export function validateHistoricalDryRun(
  report,
  allowlist = HISTORICAL_BASELINE_ALLOWLIST,
  correctionVersions = REVERSIONED_CORRECTION_VERSIONS,
) {
  if (report.management !== 'read_verified_history_not_reconciled') {
    throw new Error('Remote migration history was not read successfully')
  }
  if (report.apply_authorized !== false) {
    throw new Error('Read-only diagnostic must never authorize apply')
  }
  if (!Array.isArray(report.remote_only_versions) || report.remote_only_versions.length) {
    throw new Error('Remote migration versions are missing from source')
  }
  if (!Array.isArray(report.historical_local_only_versions)) {
    throw new Error('Historical migration inventory is unavailable')
  }
  const actual = sorted(report.historical_local_only_versions)
  const expected = sorted(allowlist)
  const baselinePending = JSON.stringify(actual) === JSON.stringify(expected)
  const baselineRecorded = actual.length === 0
  if (!baselinePending && !baselineRecorded) {
    throw new Error('Historical migration allowlist mismatch')
  }
  const future = sorted(report.future_local_only_versions ?? [])
  if (baselinePending && correctionVersions.some(version => !future.includes(version))) {
    throw new Error('Re-versioned correction inventory is incomplete')
  }
  return {
    include_all_dry_run_authorized: true,
    apply_authorized: false,
    baseline_history_repair_required: baselinePending,
    historical_versions: actual,
    future_versions: future,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const versions = readdirSync(new URL('../supabase/migrations/', import.meta.url))
    .filter(file => file.endsWith('.sql'))
    .map(file => file.split('_')[0])
  const report = await checkConnection(process.env, fetch, versions)
  try {
    console.log(JSON.stringify(validateHistoricalDryRun(report), null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Historical dry-run guard failed')
    process.exitCode = 1
  }
}
