import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20260826224000_fix_master_advance_uuid_min.sql'), 'utf8')

if (!migration.includes("confirm_master_data_employee_advance_funding(uuid,text,text,text,text,text)")) {
  throw new Error('UUID aggregate fix must target the canonical employee advance RPC')
}
if (!migration.includes('array_agg(distinct employment.profile_id order by employment.profile_id)')) {
  throw new Error('Profile matching must use deterministic UUID-safe aggregation')
}
if (!migration.includes('array_agg(distinct person.id order by person.id)')) {
  throw new Error('Employee-person matching must use deterministic UUID-safe aggregation')
}
if (/select[\s\S]*min\((?:employment\.profile_id|person\.id)\)/i.test(migration)) {
  throw new Error('UUID min() must not remain in the production patch')
}

console.log('master-data advance UUID aggregate fix contract passed')
