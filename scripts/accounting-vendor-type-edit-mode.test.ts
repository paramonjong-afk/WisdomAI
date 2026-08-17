import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/pages/AccountingDocuments/index.tsx', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../supabase/migrations/202608160013_vendor_directory_selection.sql', import.meta.url), 'utf8')

assert.match(source, /const registeredVendor=/)
assert.match(source, /const supplierChanged=/)
assert.match(source, /const classificationChanged=/)
assert.match(source, /มีในทะเบียนแล้ว/)
assert.match(source, /เพิ่มผู้ขายใหม่/)
assert.match(source, /บันทึกผู้ขายที่เลือก/)
assert.match(source, /ประเภทบันทึกแล้ว/)
assert.match(source, /!classificationChanged/)
assert.match(source, /บันทึกไม่สำเร็จ: \{error\}/)
assert.match(source, /ไม่มีข้อมูลประเภทเปลี่ยนแปลง/)
assert.match(source, /setSuccess\(null\)/)
assert.match(migration, /insert into public\.vendors\(name\)/i)

console.log('accounting vendor and document type edit mode checks passed')
