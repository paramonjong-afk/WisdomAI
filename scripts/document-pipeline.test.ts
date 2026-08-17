import assert from 'node:assert/strict'
import { PasswordProtectedPdfError, processDocument, type DocumentPipelineAdapters, type PdfInspection } from '../src/utils/documentPipeline.ts'

const bytes = (value: string) => new TextEncoder().encode(value)
let pdfInspection: PdfInspection = { encrypted: false, passwordAccepted: true, pages: [] }
const adapters: DocumentPipelineAdapters = {
  inspectPdf: async () => pdfInspection,
  decodeHeic: async () => ({ colorProfile: 'srgb-converted', pages: [{ page: 1, raster: bytes('heic-raster') }] }),
  decodeTiff: async () => ({ colorProfile: 'embedded', pages: [1, 2, 3].map(page => ({ page, raster: bytes(`tiff-${page}`) })) }),
  encodeWebpLossless: async raster => bytes(`lossless-webp:${new TextDecoder().decode(raster)}`),
  ocr: async (_raster, page) => `OCR page ${page}: 1234567890`,
}

pdfInspection = { encrypted: false, passwordAccepted: true, pages: [{ page: 1, text: 'native text 123' }, { page: 2, text: 'page two' }] }
const native = await processDocument(bytes('%PDF-1.7 native'), adapters)
assert.deepEqual(native.pages.map(page => [page.page, page.sourcePage, page.method]), [[1, 1, 'native-text'], [2, 2, 'native-text']])
assert.equal(native.compression, 'original')

pdfInspection = { encrypted: false, passwordAccepted: true, pages: [1, 2].map(page => ({ page, raster: bytes(`scan-${page}`) })) }
const scan = await processDocument(bytes('%PDF-1.7 scan'), adapters)
assert.deepEqual(scan.pages.map(page => [page.page, page.sourcePage, page.method]), [[1, 1, 'ocr'], [2, 2, 'ocr']])
assert.ok(scan.pages.every(page => page.webp && page.text.includes('1234567890')))
assert.equal(scan.compression, 'lossless-webp')

pdfInspection = { encrypted: false, passwordAccepted: true, pages: [{ page: 1, text: 'signed' }] }
const signedBytes = bytes('%PDF-1.7 /Type /Sig /ByteRange [0 10 20 30]')
const signed = await processDocument(signedBytes, adapters)
assert.equal(signed.immutableOriginal, true)
assert.deepEqual(signed.original, signedBytes)

pdfInspection = { encrypted: true, passwordAccepted: false, pages: [] }
await assert.rejects(() => processDocument(bytes('%PDF-1.7 encrypted'), adapters), PasswordProtectedPdfError)

const heic = new Uint8Array(32); heic.set(bytes('....ftypheic'))
const heicResult = await processDocument(heic, adapters)
assert.equal(heicResult.colorProfile, 'srgb-converted')
assert.deepEqual(heicResult.pages.map(page => page.sourcePage), [1])

const tiff = new Uint8Array([0x49, 0x49, 0x2a, 0x00])
const tiffResult = await processDocument(tiff, adapters)
assert.deepEqual(tiffResult.pages.map(page => [page.page, page.sourcePage]), [[1, 1], [2, 2], [3, 3]])
assert.ok(tiffResult.pages.every(page => page.webp))

console.log('DOC-INGEST-007 document pipeline corpus: ok')
