import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isExpiredPreviewUrlError, isImageContentType, normalizePreviewFile, previewLoadMessage, previewSignedUrlErrorMessage } from '../src/pages/AdvanceSettlements/advanceSlipPreview.ts'

const page = readFileSync('src/pages/AdvanceSettlements/index.tsx', 'utf8')
const helper = readFileSync('src/pages/AdvanceSettlements/advanceSlipPreview.ts', 'utf8')

assert.equal(isImageContentType('image/jpeg'), true, 'JPEG should be treated as image')
assert.equal(isImageContentType('IMAGE/PNG'), true, 'image content types should be case-insensitive')
assert.equal(isImageContentType('application/pdf'), false, 'PDF should not be treated as image')
assert.equal(isImageContentType(null), false, 'missing content type should not be treated as image')
assert.deepEqual(normalizePreviewFile({ bucket: 'line-attachments', path: 'slips/fixture.webp' })?.contentType, 'image/webp', 'RPC snake_case payload should infer image MIME from path when MIME is omitted')
assert.equal(normalizePreviewFile({ bucket: 'line-attachments', path: 'slips/fixture.pdf' })?.contentType, null, 'unknown non-image path should remain unknown')

assert.equal(previewLoadMessage(null), 'ไม่พบไฟล์ต้นทางที่ผูกกับรายการนี้', 'missing file should show a clear message')
assert.equal(previewLoadMessage('  หมดสิทธิ์อ่านไฟล์  '), 'หมดสิทธิ์อ่านไฟล์', 'reason should be preserved when present')

assert.equal(isExpiredPreviewUrlError('403 Forbidden'), true, '403 should be treated as expired or unauthorized preview')
assert.equal(isExpiredPreviewUrlError('session expired'), true, 'expired session should be treated as expired preview')
assert.equal(isExpiredPreviewUrlError('unrelated error'), false, 'unrelated errors should not be treated as expired preview')

assert.equal(previewSignedUrlErrorMessage('403 Forbidden'), 'ลิงก์รูปสลิปหมดอายุหรือเปิดไม่ได้', 'preview should distinguish expired/unauthorized signed URLs')
assert.equal(previewSignedUrlErrorMessage('permission denied'), 'ลิงก์รูปสลิปหมดอายุหรือเปิดไม่ได้', 'permission denied should be surfaced as expired/unauthorized')
assert.equal(previewSignedUrlErrorMessage('bucket unavailable'), 'สร้างลิงก์รูปสลิปไม่สำเร็จ: bucket unavailable', 'generic signed URL failures should stay specific')

// Local-only fixture matrix: keeps UI behavior testable without Supabase or outbound delivery.
const localFixture = [
  { id: 'fixture-image', contentType: 'image/webp', signedUrl: 'blob:fixture-image', expected: 'ready' },
  { id: 'fixture-missing', contentType: null, signedUrl: null, reason: 'ไม่พบไฟล์ต้นทาง', expected: 'missing' },
  { id: 'fixture-expired', contentType: 'image/jpeg', signedUrl: null, reason: '403 Forbidden', expected: 'expired' },
  { id: 'fixture-pdf', contentType: 'application/pdf', signedUrl: 'blob:fixture-pdf', expected: 'non_image' },
  { id: 'fixture-permission', contentType: null, signedUrl: null, reason: 'permission denied', expected: 'expired' },
] as const

assert.equal(localFixture.find((item) => item.id === 'fixture-image')?.expected, 'ready')
assert.equal(isImageContentType(localFixture.find((item) => item.id === 'fixture-image')?.contentType), true)
assert.equal(previewLoadMessage(localFixture.find((item) => item.id === 'fixture-missing')?.reason), 'ไม่พบไฟล์ต้นทาง')
assert.equal(isExpiredPreviewUrlError(localFixture.find((item) => item.id === 'fixture-expired')?.reason ?? ''), true)
assert.equal(isImageContentType(localFixture.find((item) => item.id === 'fixture-pdf')?.contentType), false)
assert.equal(isExpiredPreviewUrlError(localFixture.find((item) => item.id === 'fixture-permission')?.reason ?? ''), true)

for (const needle of [
  'documentFlowGateway.preview',
  'signedPreviewUrl',
  'ไม่พบ Document Flow Item ต้นทางที่ผูกกับรายการนี้',
  'previewSignedUrlErrorMessage',
  'normalizePreviewFile',
  'previewRequestRef.current += 1',
  'setSlipPreview({ status: \'loading\'',
  'เปิดไฟล์เต็ม',
  'ดูภาพเต็ม',
  'สลิปต้นทาง',
  'ตรวจ/แยกประเภท',
  'ค่าแรง/ตัดยอด',
  'ปิดงาน',
  'คลิกแต่ละขั้นเพื่อดู Audit รายละเอียด',
  'Timeline อัตโนมัติ (รายการเดิม)',
  'ปิดรายละเอียด Audit',
]) {
  assert.match(page, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `AdvanceSettlements page should contain ${needle}`)
}

assert.match(helper, /ลิงก์รูปสลิปหมดอายุหรือเปิดไม่ได้/, 'helper should keep the explicit expired-url message')

console.log('advance settlement slip preview regression tests passed')
