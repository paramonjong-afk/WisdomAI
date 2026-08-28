import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { moneyPurposeRoute } from '../src/services/transferSlipMoneyLineage.ts'

const route = moneyPurposeRoute('materials')
assert.equal(route.route, 'บัญชี → ต้นทุนโครงการ')
assert.deepEqual(route.departments, ['project'])

const migration = readFileSync('supabase/migrations/20260829093000_keep_material_transfer_slips_out_of_inventory.sql', 'utf8')
assert.match(migration, /สลิปค่าวัสดุเป็นหลักฐานการเงิน ไม่ใช่ใบรับเข้า Stock/)
assert.match(migration, /if not \('project' = any\(next_departments\)\)/)
assert.doesNotMatch(migration.match(/new_branch text :=[\s\S]*?\$branch\$;/)?.[0] ?? '', /inventory_project/)
assert.match(migration, /t\.department = 'inventory'/)
assert.match(migration, /t\.note = 'สร้างจากการจัดสรรเส้นทางเงิน v2'/)
assert.match(migration, /'inventory_mutated', false/)

console.log('transfer slip material routing: PASS (project cost only, no inventory receipt)')
