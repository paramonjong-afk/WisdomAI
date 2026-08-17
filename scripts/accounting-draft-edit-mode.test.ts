import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/pages/AccountingDocuments/index.tsx', import.meta.url), 'utf8')

assert.match(source, /hasUnsavedDraftChanges/)
assert.match(source, /โหมดแก้ไข · ยังไม่บันทึก/)
assert.match(source, /label=\{hasUnsavedDraftChanges\?'โหมดแก้ไข · ยังไม่บันทึก':'บันทึกแล้ว'\}/)
assert.match(source, /lines\.length === 0 \|\| !hasUnsavedDraftChanges/)
assert.match(source, /hasUnsavedDraftChanges \? 'บันทึกร่าง' : 'บันทึกแล้ว'/)
assert.match(source, /setSavedDraftSnapshot\(currentDraftSnapshot\)/)

console.log('accounting draft edit mode checks passed')
