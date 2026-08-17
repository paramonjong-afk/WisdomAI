import assert from 'node:assert/strict'
import { planPdfStorage, type PdfStorageAdapters } from '../src/utils/pdfStorageStrategy.ts'

const bytes = (value: string) => new TextEncoder().encode(value)
const text = (value: Uint8Array) => new TextDecoder().decode(value)
let signatureChecks = 0
const adapters: PdfStorageAdapters = {
  optimizePdfLossless: async input => bytes(text(input).replace(/padding+/g, '')),
  encodePageWebpLossless: async (page, pageNumber) => bytes(`W${pageNumber}:${text(page).slice(0, 4)}`),
  extractText: async input => text(input).includes('READABLE') ? 'ใบกำกับ 12345' : '',
  ocrPage: async (_page, pageNumber) => `OCR หน้า ${pageNumber} เลข 12345`,
  verifySignature: async input => { signatureChecks += 1; return text(input).includes('/ByteRange') },
}

const nativeInput = bytes('%PDF READABLE paddingpaddingpadding')
const native = await planPdfStorage(nativeInput, 'native-text', [], adapters)
assert.ok(native.optimizedPdf && native.optimizedPdf.byteLength < nativeInput.byteLength, 'lossless derivative should use fewer bytes')
assert.match(native.text, /12345/, 'optimized native PDF remains readable')
assert.equal(native.originalMayBeRemovedAfterValidatedCopy, false, 'native evidence keeps original')
assert.equal(native.original.length, nativeInput.length)
assert.equal(native.originalSha256.length, 64)

const scanInput = bytes('%PDF scan source is intentionally much larger than its page artifacts')
const scan = await planPdfStorage(scanInput, 'scan', [bytes('page-one-raster'), bytes('page-two-raster')], adapters)
assert.ok(scan.storedBytes < scanInput.byteLength, 'WebP page artifacts should use fewer stored bytes in corpus')
assert.deepEqual(scan.pages.map(page => page.page), [1, 2])
assert.ok(scan.pages.every(page => page.text.includes('12345')), 'OCR evidence is retained per page')
assert.equal(scan.createPdfOnDemand, true)
assert.equal(scan.optimizedPdf, undefined, 'scan images are not wrapped in PDF merely to reduce size')
assert.equal(scan.originalSha256.length, 64, 'source provenance hash is retained')

const signedInput = bytes('%PDF READABLE /Type /Sig /ByteRange [0 10 20 30]')
const signed = await planPdfStorage(signedInput, 'signed', [], adapters)
assert.deepEqual(signed.original, signedInput, 'signed bytes must remain identical')
assert.equal(signed.signatureVerified, true)
assert.equal(signatureChecks, 1)
assert.equal(signed.optimizedPdf, undefined)
assert.equal(signed.originalMayBeRemovedAfterValidatedCopy, false)

const officialInput = bytes('%PDF READABLE official')
const official = await planPdfStorage(officialInput, 'official', [], adapters)
assert.deepEqual(official.original, officialInput, 'official bytes must remain identical')
assert.equal(official.originalMayBeRemovedAfterValidatedCopy, false)

await assert.rejects(
  () => planPdfStorage(bytes('%PDF READABLE unsigned'), 'signed', [], adapters),
  /PDF_SIGNATURE_VERIFICATION_FAILED/,
)

console.log('DOC-INGEST-014 bytes/readability/OCR/hash/signature corpus: ok')

