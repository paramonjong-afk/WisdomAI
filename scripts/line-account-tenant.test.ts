import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const migration=readFileSync('supabase/migrations/202608110021_company_scoped_line_accounts.sql','utf8')
const webhook=readFileSync('supabase/functions/line-webhook/index.ts','utf8')
assert.match(migration,/unique \(company_id, profile_id\)/)
assert.match(migration,/unique \(company_id, line_user_id\)/)
assert.match(migration,/where company_id=token_row\.company_id and line_user_id=token_row\.line_user_id/)
assert.match(migration,/on conflict\(company_id,profile_id\)/)
assert.match(migration,/public\.is_company_manager\(company_id\)/)
assert.match(webhook,/linkedProfile\(lineUserId: string, companyId: string\)/)
assert.match(webhook,/eq\('company_id',companyId\)\.eq\('line_user_id'/)
assert.match(webhook,/onConflict:'company_id,profile_id'/)
assert.doesNotMatch(webhook,/onConflict:'profile_id'/)
console.log('TEN-011 company-scoped LINE account checks passed')
