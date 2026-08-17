import fs from 'node:fs'
import assert from 'node:assert/strict'
const sql=fs.readFileSync('supabase/migrations/202608150032_project_stock_bulk_allocation.sql','utf8')
for(const pattern of [/inventory_locations/,/goods_receipt_allocations/,/central_stock/,/project_stock/,/direct_use/,/allocation_quantity_mismatch/,/inventory_project_balances/,/process_project_stock_operation/,/insufficient_project_stock/,/direct_cost_amount/])assert.match(sql,pattern)
assert.match(sql,/site_not_in_project/)
assert.match(sql,/project_not_in_company/)
console.log('project stock bulk allocation checks passed')
