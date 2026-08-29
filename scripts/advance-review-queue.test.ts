import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync('src/pages/AdvanceSettlements/index.tsx', 'utf8')

for (const required of [
  'reviewQueueIds',
  'openReviewQueue',
  'moveReviewQueue',
  'คิวตรวจ ${Math.max(selectedQueueIndex + 1, 1)}',
  'เช็กลิสต์ก่อนดำเนินการ',
  'หลักฐานต้นทาง',
  'ผู้ถือเงิน',
  'รายการใช้เงิน/คืนเงิน',
  'ยอดคงค้างเป็นศูนย์',
  'เปิดคิวตรวจ {pendingCount || group.rows.length}',
  'เปิดในคิวตรวจ',
]) {
  assert.ok(page.includes(required), `advance review queue should include ${required}`)
}

assert.doesNotMatch(page, /onClick=\{\(\) => onSelect\(group\.rows\[0\]\)\}/, 'group action must not open only the first advance')
assert.match(page, /disabled=\{saving \|\| !selectedReadiness\?\.canSubmit\}/, 'submit must use readiness gate')
assert.match(page, /disabled=\{saving \|\| !selectedReadiness\?\.canApprove\}/, 'approve must use readiness gate')
assert.match(page, /disabled=\{saving \|\| !selectedReadiness\?\.canClose\}/, 'close must use readiness gate')
assert.doesNotMatch(page, /setSelected\(null\); await load\(\)/, 'successful transition should keep the review queue open')

console.log('advance review queue regression tests passed')
