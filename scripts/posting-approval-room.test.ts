import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync('src/pages/DocumentFlows/index.tsx', 'utf8')
const gateway = readFileSync('src/services/documentFlowGateway.ts', 'utf8')

assert.match(page, /รออนุมัติ — ยังไม่ลงบัญชี\/Stock/)
assert.match(page, /Approval Snapshot · Transaction Preview/)
assert.match(page, /Intake ID:/)
assert.match(page, /คู่ค้า \/ เลขประจำตัวผู้เสียภาษี/)
assert.match(page, /Journal Preview/)
assert.match(page, /ขอข้อมูลเพิ่มเติม/)
assert.match(page, /ส่งข้อมูลกลับเพื่อรออนุมัติ/)
assert.match(page, /transition\(selectedItem, 'request_information'\)/)
assert.match(page, /transition\(selectedItem, 'resubmit_information'\)/)
assert.match(page, /postingPreview\.journal\.length === 0/)
assert.match(gateway, /loadPostingApprovalPreview/)
assert.match(gateway, /accounting_document_lines/)
assert.match(gateway, /accounting_draft_entries/)

console.log('posting approval room contract passed')
