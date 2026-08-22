import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const edge = readFileSync('supabase/functions/health-monitor/index.ts', 'utf8')
const telemetry = readFileSync('src/components/AppTelemetry.tsx', 'utf8')
const supabase = readFileSync('src/lib/supabase.ts', 'utf8')
const table = readFileSync('src/components/StandardDataTable.tsx', 'utf8')

assert.match(edge, /check\('client_performance'/)
assert.match(edge, /const p95 =/)
assert.match(edge, /api_p95_ms/)
assert.match(edge, /lcp_p95_ms/)
assert.match(edge, /interaction_p95_ms/)
assert.match(edge, /error_rate:errorRate/)
assert.match(edge, /max_page_size:maxPage/)
assert.match(edge, /stalled_over_15m/)
assert.match(edge, /Math\.max\(2, settings\.alert_after_failures\)/)
assert.match(edge, /recoveryCount >= 2/)
assert.match(edge, /Math\.max\(30, settings\.repeat_alert_minutes\)/)
assert.match(telemetry, /largest-contentful-paint/)
assert.match(telemetry, /wisdomai-request-complete/)
assert.match(telemetry, /eventType: 'performance_metric'/)
assert.match(supabase, /emitRequestMetric/)
assert.match(supabase, /query_length/)
assert.match(table, /performance_kind: 'table'/)

console.log('SYS-PERF-001 performance monitoring source checks passed')
