import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// This diagnostic never runs SQL or retries a write via another transport.
export async function checkConnection(env, request = fetch) {
  const ref = env.SUPABASE_PROJECT_REF
  const token = env.SUPABASE_ACCESS_TOKEN
  const report = {
    checked_at: new Date().toISOString(),
    management: 'not_checked',
    pooler: env.SUPABASE_DB_PASSWORD ? 'configured_not_verified' : 'missing_database_password',
    direct: env.SUPABASE_DB_PASSWORD ? 'configured_not_verified' : 'missing_database_password',
    apply_authorized: false,
  }
  if (!ref || !/^[a-z]{20}$/.test(ref)) return { ...report, management: 'invalid_project_ref' }
  if (!token) return { ...report, management: 'missing_access_token' }
  for (const endpoint of [`/v1/projects/${ref}`, `/v1/projects/${ref}/database/migrations`]) {
    try {
      const response = await request(`https://api.supabase.com${endpoint}`, {
        method: 'GET', redirect: 'error',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      })
      if (!response.ok) {
        const status = response.status
        return { ...report, management: status === 401 ? 'invalid_or_expired_token'
          : status === 403 ? 'permission_denied' : status === 429 ? 'rate_limited'
            : `http_${status}` }
      }
      const body = await response.json()
      if (endpoint.endsWith('/migrations')) {
        if (!Array.isArray(body) || body.some(row => !row || !/^\d+$/.test(String(row.version)))) {
          return { ...report, management: 'unexpected_history_response' }
        }
        report.remote_migration_count = body.length
      } else if (body.id !== ref) {
        return { ...report, management: 'project_mismatch' }
      }
    } catch {
      // Raw API errors, response bodies and headers may contain credentials/data.
      return { ...report, management: 'network_timeout_or_invalid_response' }
    }
  }
  return { ...report, management: 'read_verified_history_not_reconciled' }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await checkConnection(process.env)
  const safe = JSON.stringify(report, null, 2)
  console.log(safe)
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n## Supabase connection recovery\n\n\`\`\`json\n${safe}\n\`\`\`\nRead access is not migration approval. No SQL executed.\n`)
  }
  if (report.management !== 'read_verified_history_not_reconciled') process.exitCode = 1
}
