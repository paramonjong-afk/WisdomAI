import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const worker = readFileSync('supabase/functions/automation-worker/index.ts', 'utf8')
assert.match(worker, /Deno\.env\.get\('WISDOM_SUPABASE_SECRET_KEY'\) \?\? Deno\.env\.get\('SUPABASE_SERVICE_ROLE_KEY'\)/)
assert.match(worker, /createClient\(Deno\.env\.get\('SUPABASE_URL'\)!, adminKey/)
console.log('automation worker Secret API key fallback contract passed')
