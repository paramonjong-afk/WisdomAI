export type DocumentKind = 'pdf' | 'heic' | 'tiff'
export type PageSource = { page: number; text?: string; raster?: Uint8Array }
export type DecodedImage = { pages: PageSource[]; colorProfile: 'embedded' | 'srgb-converted' }
export type PdfInspection = { pages: PageSource[]; encrypted: boolean; passwordAccepted: boolean }

export type DocumentPipelineAdapters = {
  inspectPdf(bytes: Uint8Array, password?: string): Promise<PdfInspection>
  decodeHeic(bytes: Uint8Array): Promise<DecodedImage>
  decodeTiff(bytes: Uint8Array): Promise<DecodedImage>
  encodeWebpLossless(raster: Uint8Array): Promise<Uint8Array>
  ocr(raster: Uint8Array, page: number): Promise<string>
}

export type DocumentPage = {
  page: number
  sourcePage: number
  text: string
  method: 'native-text' | 'ocr'
  webp?: Uint8Array
}

export type DocumentPipelineResult = {
  kind: DocumentKind
  original: Uint8Array
  immutableOriginal: boolean
  signed: boolean
  colorProfile?: DecodedImage['colorProfile']
  pages: DocumentPage[]
  compression: 'original' | 'lossless-webp'
}

export class PasswordProtectedPdfError extends Error {
  readonly code = 'PDF_PASSWORD_REQUIRED'
  constructor() { super('PDF ต้องใช้รหัสผ่านที่ถูกต้องก่อนประมวลผล') }
}

const ascii = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes)

export function detectDocumentKind(bytes: Uint8Array): DocumentKind {
  const header = ascii(bytes.subarray(0, 32))
  if (header.startsWith('%PDF-')) return 'pdf'
  const littleEndianTiff = bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00
  const bigEndianTiff = bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a
  if (littleEndianTiff || bigEndianTiff) return 'tiff'
  if (header.slice(4, 12).includes('ftyp') && /hei[cf]|mif1|msf1/.test(header)) return 'heic'
  throw new Error('UNSUPPORTED_DOCUMENT_SIGNATURE')
}

// Detection is deliberately read-only. Signed PDFs must retain their exact bytes.
export function hasPdfSignature(bytes: Uint8Array): boolean {
  const source = ascii(bytes)
  return /\/Type\s*\/Sig\b|\/ByteRange\s*\[/.test(source)
}

const validatePages = (pages: PageSource[]) => {
  if (!pages.length) throw new Error('DOCUMENT_HAS_NO_PAGES')
  pages.forEach((page, index) => {
    if (page.page !== index + 1) throw new Error('INVALID_PAGE_MAPPING')
  })
}

async function rasterPages(pages: PageSource[], adapters: DocumentPipelineAdapters) {
  const mapped: DocumentPage[] = []
  for (const source of pages) {
    if (!source.raster) throw new Error(`MISSING_PAGE_RASTER:${source.page}`)
    // Lossless WebP only: never use JBIG2, whose symbol substitution can alter digits.
    const [webp, text] = await Promise.all([
      adapters.encodeWebpLossless(source.raster),
      adapters.ocr(source.raster, source.page),
    ])
    mapped.push({ page: mapped.length + 1, sourcePage: source.page, text, method: 'ocr', webp })
  }
  return mapped
}

export async function processDocument(
  input: Uint8Array,
  adapters: DocumentPipelineAdapters,
  options: { password?: string } = {},
): Promise<DocumentPipelineResult> {
  const original = input.slice()
  const kind = detectDocumentKind(original)
  if (kind === 'pdf') {
    const signed = hasPdfSignature(original)
    const inspection = await adapters.inspectPdf(original, options.password)
    if (inspection.encrypted && !inspection.passwordAccepted) throw new PasswordProtectedPdfError()
    validatePages(inspection.pages)
    const hasNativeText = inspection.pages.every(page => Boolean(page.text?.trim()))
    const pages = hasNativeText
      ? inspection.pages.map(source => ({ page: source.page, sourcePage: source.page, text: source.text!.trim(), method: 'native-text' as const }))
      : await rasterPages(inspection.pages, adapters)
    return { kind, original, immutableOriginal: signed, signed, pages, compression: hasNativeText ? 'original' : 'lossless-webp' }
  }

  const decoded = kind === 'heic' ? await adapters.decodeHeic(original) : await adapters.decodeTiff(original)
  validatePages(decoded.pages)
  if (kind === 'heic' && !['embedded', 'srgb-converted'].includes(decoded.colorProfile)) {
    throw new Error('HEIC_COLOR_PROFILE_NOT_PRESERVED')
  }
  const pages = await rasterPages(decoded.pages, adapters)
  return { kind, original, immutableOriginal: false, signed: false, colorProfile: decoded.colorProfile, pages, compression: 'lossless-webp' }
}
