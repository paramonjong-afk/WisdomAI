export type PdfStorageClass = 'native-text' | 'scan' | 'signed' | 'official'

export type PdfStorageAdapters = {
  optimizePdfLossless(bytes: Uint8Array): Promise<Uint8Array>
  encodePageWebpLossless(page: Uint8Array, pageNumber: number): Promise<Uint8Array>
  extractText(bytes: Uint8Array): Promise<string>
  ocrPage(page: Uint8Array, pageNumber: number): Promise<string>
  verifySignature(bytes: Uint8Array): Promise<boolean>
}

export type PdfStoragePlan = {
  classification: PdfStorageClass
  original: Uint8Array
  originalSha256: string
  optimizedPdf?: Uint8Array
  pages: Array<{ page: number; webp: Uint8Array; text: string }>
  text: string
  thumbnailAndIndexStoredSeparately: true
  createPdfOnDemand: boolean
  originalMayBeRemovedAfterValidatedCopy: boolean
  signatureVerified?: boolean
  storedBytes: number
}

const sha256 = async (bytes: Uint8Array) => {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
}

const sameBytes = (left: Uint8Array, right: Uint8Array) =>
  left.length === right.length && left.every((value, index) => value === right[index])

/**
 * Produces storage artifacts only. Thumbnail, extracted text, and search index are
 * intentionally described as separate records instead of being embedded in a PDF.
 * The caller must complete its own durable-write/read-back validation before it is
 * allowed to act on originalMayBeRemovedAfterValidatedCopy.
 */
export async function planPdfStorage(
  input: Uint8Array,
  classification: PdfStorageClass,
  pageRasters: Uint8Array[],
  adapters: PdfStorageAdapters,
): Promise<PdfStoragePlan> {
  const original = input.slice()
  const originalSha256 = await sha256(original)

  if (classification === 'signed' || classification === 'official') {
    const signatureVerified = classification === 'signed'
      ? await adapters.verifySignature(original)
      : undefined
    if (classification === 'signed' && !signatureVerified) throw new Error('PDF_SIGNATURE_VERIFICATION_FAILED')
    if (!sameBytes(input, original) || await sha256(original) !== originalSha256) throw new Error('PDF_ORIGINAL_BYTES_CHANGED')
    const text = await adapters.extractText(original)
    return {
      classification, original, originalSha256, pages: [], text,
      thumbnailAndIndexStoredSeparately: true, createPdfOnDemand: false,
      originalMayBeRemovedAfterValidatedCopy: false, signatureVerified,
      storedBytes: original.byteLength,
    }
  }

  if (classification === 'native-text') {
    const optimizedPdf = await adapters.optimizePdfLossless(original)
    const text = await adapters.extractText(optimizedPdf)
    if (!text.trim()) throw new Error('LOSSLESS_PDF_TEXT_NOT_READABLE')
    return {
      classification, original, originalSha256, optimizedPdf, pages: [], text,
      thumbnailAndIndexStoredSeparately: true, createPdfOnDemand: false,
      originalMayBeRemovedAfterValidatedCopy: false,
      storedBytes: original.byteLength + optimizedPdf.byteLength,
    }
  }

  if (!pageRasters.length) throw new Error('SCAN_PDF_HAS_NO_PAGES')
  const pages = await Promise.all(pageRasters.map(async (raster, index) => ({
    page: index + 1,
    webp: await adapters.encodePageWebpLossless(raster, index + 1),
    text: await adapters.ocrPage(raster, index + 1),
  })))
  if (pages.some(page => !page.text.trim())) throw new Error('SCAN_PDF_OCR_EMPTY')
  return {
    classification, original, originalSha256, pages,
    text: pages.map(page => page.text).join('\n'),
    thumbnailAndIndexStoredSeparately: true, createPdfOnDemand: true,
    originalMayBeRemovedAfterValidatedCopy: true,
    storedBytes: pages.reduce((total, page) => total + page.webp.byteLength, 0),
  }
}

