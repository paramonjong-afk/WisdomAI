import assert from 'node:assert/strict'
import { readBoqFile } from '../src/utils/boqImport.ts'
import { compareBoqSources } from '../src/utils/boqPdfCompare.ts'

const csv='\uFEFFรหัส BOQ,หมวดงาน,รายการ,หน่วย,ปริมาณ,ค่าวัสดุ,ค่าแรง,ราคาขายต่อหน่วย\nA-01,งานดิน,ขุดดิน,ลบ.ม.,10,"1,250",300,1800'
const result=await readBoqFile(new File([csv],'old-boq.csv',{type:'text/csv'}))
assert.equal(result.rows.length,1)
assert.equal(result.rows[0].boq_code,'A-01')
assert.equal(result.rows[0].description,'ขุดดิน')
assert.equal(result.rows[0].quantity,10)
assert.equal(result.rows[0].material_unit_cost,1250)
assert.equal(result.rows[0].labour_unit_cost,300)
assert.equal(result.rows[0].selling_unit_price,1800)

const crossCategoryCsv='รหัส BOQ,หมวดงาน,รายการ,หน่วย,ปริมาณ,ราคาขายต่อหน่วย\nA-01,ชั้น 1,ผนังก่ออิฐ,ตร.ม.,10,500\nA-01,ชั้น 2,ผนังก่ออิฐ,ตร.ม.,12,500'
const crossCategory=await readBoqFile(new File([crossCategoryCsv],'multi-category.csv',{type:'text/csv'}))
assert.equal(crossCategory.rows.length,2)
assert.equal(crossCategory.rows.filter(row=>row.quality_status==='error').length,0)

const duplicateCsv='รหัส BOQ,หมวดงาน,รายการ,หน่วย,ปริมาณ,ราคาขายต่อหน่วย\nA-01,ชั้น 1,ผนังก่ออิฐ,ตร.ม.,10,500\nA-01,ชั้น 1,ผนังก่ออิฐ,ตร.ม.,12,500'
const duplicate=await readBoqFile(new File([duplicateCsv],'duplicate.csv',{type:'text/csv'}))
assert.equal(duplicate.rows.filter(row=>row.quality_status==='error').length,2)
assert.match(duplicate.rows[0].issues.join(' '),/ซ้ำ/)

const compared=compareBoqSources(crossCategory.rows,{pageCount:2,warnings:[],lines:[
  {page:1,text:'A-01 ผนังก่ออิฐ ตร.ม. 10 500'},
  {page:2,text:'A-01 ผนังก่ออิฐ ตร.ม. 12 500'},
]})
assert.equal(compared.length,2)
assert.ok(compared.every(row=>row.page!==null))
console.log('BOQ import tests passed')
