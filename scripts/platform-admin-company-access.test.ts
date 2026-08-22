import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migration = readFileSync(resolve('supabase/migrations/202608110025_platform_admin_company_access.sql'), 'utf8')
const memberGuard = readFileSync(resolve('supabase/migrations/202608110026_company_member_reference_bootstrap.sql'), 'utf8')
const settings = readFileSync(resolve('src/pages/Settings/index.tsx'), 'utf8')

for (const assertion of [
  "role='admin'",
  'public.is_platform_admin() or member.profile_id is not null',
  "current_setting('app.platform_company_bootstrap',true)='on'",
  "new.company_id=public.current_company_id()",
  "'company_created','company_switched'",
  "raise exception 'เฉพาะ Platform Admin เท่านั้นที่สร้างบริษัทได้'",
  "company.id=public.current_company_id()",
]) {
  if (!migration.includes(assertion)) throw new Error(`missing platform-company guard: ${assertion}`)
}

if (!settings.includes('isPlatformAdmin')) {
  throw new Error('Settings must distinguish Platform Admin from company-level administrators')
}

for (const assertion of [
  "tg_table_name='company_members'",
  "current_setting('app.platform_company_bootstrap',true)='on'",
  'reference_id=auth.uid()',
  'public.is_company_manager(row_company_id)',
  "raise exception 'Cross-company profile reference denied'",
]) {
  if (!memberGuard.includes(assertion)) throw new Error(`missing company-member reference guard: ${assertion}`)
}

console.log('Platform Admin company access checks passed')
