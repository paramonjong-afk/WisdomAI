export type AdvanceSlipPreviewFile = {
  bucket: string
  path: string
  contentType: string | null
  createdAt?: string | null
}

export type PreviewFilePayload = {
  bucket?: string | null
  path?: string | null
  content_type?: string | null
  contentType?: string | null
  created_at?: string | null
  createdAt?: string | null
}

const contentTypeByExtension: Record<string, string> = {
  avif: 'image/avif',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

function inferContentType(path: string) {
  const extension = path.split('?')[0].split('.').pop()?.toLowerCase() ?? ''
  return contentTypeByExtension[extension] ?? null
}

export function normalizePreviewFile(payload: PreviewFilePayload | null | undefined): AdvanceSlipPreviewFile | null {
  const bucket = payload?.bucket?.trim()
  const path = payload?.path?.trim()
  if (!bucket || !path) return null
  const contentType = payload?.content_type?.trim() || payload?.contentType?.trim() || inferContentType(path)
  return { bucket, path, contentType, createdAt: payload?.created_at ?? payload?.createdAt ?? null }
}

export function isImageContentType(contentType: string | null | undefined) {
  return typeof contentType === 'string' && contentType.trim().toLowerCase().startsWith('image/')
}

export function isExpiredPreviewUrlError(message: string) {
  return /expired|หมดอายุ|session|token|jwt|401|403|unauthorized|permission/i.test(message)
}

export function previewLoadMessage(reason?: string | null) {
  return reason?.trim() || 'ไม่พบไฟล์ต้นทางที่ผูกกับรายการนี้'
}

export function previewSignedUrlErrorMessage(message: string) {
  return isExpiredPreviewUrlError(message)
    ? 'ลิงก์รูปสลิปหมดอายุหรือเปิดไม่ได้'
    : `สร้างลิงก์รูปสลิปไม่สำเร็จ: ${message}`
}
