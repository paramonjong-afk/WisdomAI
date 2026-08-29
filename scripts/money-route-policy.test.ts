import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/20260829115423_money_route_policy_registry.sql', 'utf8')
const panel = readFileSync('src/pages/MasterDataCenter/MoneyRoutePolicyPanel.tsx', 'utf8')
const page = readFileSync('src/pages/MasterDataCenter/index.tsx', 'utf8')

assert.match(migration, /create table public\.money_route_policies/)
assert.match(migration, /create table public\.money_route_policy_audit/)
assert.match(migration, /status text not null default 'active' check \(status in \('active','inactive'\)\)/)
assert.doesNotMatch(migration, /delete from public\.money_route_policies/i)
assert.match(migration, /money_route_policy_version_conflict/)
assert.match(migration, /policy_row\.decision<>'auto_route'/)
assert.match(migration, /policy_row\.route_type<>'company_to_advance'/)
assert.match(migration, /policy_row\.destination_module<>'advance_finance'/)
assert.match(migration, /auto_create_from_money_route_policy/)
assert.match(panel, /กฎบัญชีและเส้นทางเงิน/)
assert.match(panel, /save_money_route_policy/)
assert.match(panel, /set_money_route_policy_status/)
assert.match(panel, /ปิดกฎแทนการลบ/)
assert.match(panel, /ประวัติกฎและ Audit/)
assert.match(page, /<MoneyRoutePolicyPanel \/>/)

console.log('money route policy contract: PASS')
