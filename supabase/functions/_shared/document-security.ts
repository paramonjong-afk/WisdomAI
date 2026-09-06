export type DocumentSecurityDecision = {
  accepted: boolean
  reason: string | null
  detectedType: 'pdf' | 'jpeg' | 'png' | 'gif' | 'webp' | 'heic' | 'tiff' | null
}

const MAX_IMAGE_BYTES = 50 * 1024 * 1024
const MAX_PDF_BYTES = 100 * 1024 * 1024
const text = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes)

function detectedType(bytes: Uint8Array) {
  const header = text(bytes.subarray(0, 32))
  if (header.startsWith('%PDF-')) return 'pdf' as const
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg' as const
  if (header.startsWith('\x89PNG\r\n\x1a\n')) return 'png' as const
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) return 'gif' as const
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') return 'webp' as const
  if (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) return 'tiff' as const
  if (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a) return 'tiff' as const
  if (header.slice(4, 12).includes('ftyp') && /hei[cf]|mif1|msf1/i.test(header)) return 'heic' as const
  return null
}

const mimeTypes: Record<NonNullable<ReturnType<typeof detectedType>>, string[]> = {
  pdf: ['application/pdf'], jpeg: ['image/jpeg', 'image/jpg'], png: ['image/png'], gif: ['image/gif'],
  webp: ['image/webp'], heic: ['image/heic', 'image/heif'], tiff: ['image/tiff', 'image/tif'],
}

export function inspectDocumentSecurity(bytes: Uint8Array, declaredMime: string | null | undefined): DocumentSecurityDecision {
  const type = detectedType(bytes)
  if (!type) return { accepted: false, reason: 'UNSUPPORTED_OR_INVALID_SIGNATURE', detectedType: null }
  const normalizedMime = declaredMime?.trim().toLowerCase() || null
  if (normalizedMime && normalizedMime !== 'application/octet-stream' && !mimeTypes[type].includes(normalizedMime)) {
    return { accepted: false, reason: 'MIME_SIGNATURE_MISMATCH', detectedType: type }
  }
  if (bytes.byteLength > (type === 'pdf' ? MAX_PDF_BYTES : MAX_IMAGE_BYTES)) {
    return { accepted: false, reason: 'FILE_TOO_LARGE', detectedType: type }
  }
  if (type === 'pdf' && /\/Encrypt\b|\/(?:JavaScript|JS|EmbeddedFile|Launch|RichMedia)\b/i.test(text(bytes))) {
    return { accepted: false, reason: 'PDF_ACTIVE_CONTENT_OR_ENCRYPTION', detectedType: type }
  }
  return { accepted: true, reason: null, detectedType: type }
}
