import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const employeePage = readFileSync('src/pages/Employee/index.tsx', 'utf8')
const table = readFileSync('src/components/StandardDataTable.tsx', 'utf8')

for (const token of ['รีเฟรชรายชื่อ', 'อัปเดตสิทธิ์และรายชื่อ', 'เพิ่มพนักงาน', 'ตัวกรองรายชื่อ', 'ค้นหาพนักงาน', 'ตั้งค่าคอลัมน์', 'ส่งออก CSV', 'ส่งออก PDF']) {
  assert.match(employeePage, new RegExp(token))
}
for (const token of ['compactToolbar', 'onToolsReady', 'onSearchReady', 'SearchOutlinedIcon']) {
  assert.match(table, new RegExp(token))
}
assert.doesNotMatch(employeePage, /label="แสดงรายชื่อ"/)
assert.match(employeePage, /aria-label="เพิ่มพนักงาน"/)

console.log('HR UI action standard contract: PASS')
