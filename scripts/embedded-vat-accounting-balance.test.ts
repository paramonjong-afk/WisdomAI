import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql=readFileSync(new URL('../supabase/migrations/202608160015_embedded_vat_accounting_balance.sql',import.meta.url),'utf8')
const headerSql=readFileSync(new URL('../supabase/migrations/202608160016_embedded_vat_header_reconciliation.sql',import.meta.url),'utf8')
assert.match(sql,/line_total-credit_target\)<=0\.01/)
assert.match(sql,/line_total\+original_vat/)
assert.match(sql,/set vat_amount=0/)
assert.match(sql,/set vat_amount=original_vat/g)
assert.match(sql,/confirm_accounting_document_pre_match/)
assert.match(sql,/three_way_match_required_before_ap/)

const shouldTreatVatAsEmbedded=(lineTotal:number,total:number,withholding:number,vat:number)=>vat>0&&Math.abs(lineTotal-(total+withholding))<=.01&&Math.abs(lineTotal+vat-(total+withholding))>.01
assert.equal(shouldTreatVatAsEmbedded(25,25,0,1.64),true)
assert.equal(shouldTreatVatAsEmbedded(100,107,0,7),false)
assert.equal(shouldTreatVatAsEmbedded(107,104,3,7),true)
assert.match(headerSql,/original_subtotal:=doc\.subtotal/)
assert.match(headerSql,/temporary_subtotal:=round\(coalesce\(doc\.total_amount,0\)\+coalesce\(doc\.discount_amount,0\)\+coalesce\(doc\.withholding_tax_amount,0\),2\)/)
assert.match(headerSql,/set vat_amount=0,subtotal=temporary_subtotal/)
assert.match(headerSql,/set vat_amount=original_vat,subtotal=original_subtotal/g)

console.log('embedded VAT accounting balance checks passed')
