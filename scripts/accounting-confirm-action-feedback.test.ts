import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/pages/AccountingDocuments/index.tsx', import.meta.url), 'utf8')

assert.match(source, /ขั้นตอนบันทึกประเภทเอกสาร:/)
assert.match(source, /ขั้นตอนบันทึกโครงการ หมวดต้นทุน หรือบัญชี:/)
assert.match(source, /ขั้นตอนยืนยันและสร้างรายการบัญชี:/)
assert.match(source, /ดำเนินการไม่สำเร็จ — \{error\}/)
assert.match(source, /\{\(error\|\|success\)&&<Box sx=\{\{px:1\.5,pt:1\}\}/)
assert.match(source, /setSaving\(true\); setError\(null\); setSuccess\(null\)/)

console.log('accounting confirm action feedback checks passed')
