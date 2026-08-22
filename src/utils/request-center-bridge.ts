import { generateAttemptId, globalMutationAttemptStore, createSignature } from './operation-center'
import { supabase } from '../lib/supabase'

type RequestErrorDetail = {
  path: string
  method?: string
  status: number
  statusText?: string
  body?: string
}

const mapHttpStatusToCode = (status: number) => {
  if (status === 409) return 'EMAIL_ALREADY_EXISTS'
  if (status === 403 || status === 401) return 'PERMISSION_DENIED'
  if (status === 422) return 'MISSING_REQUIRED_FIELD'
  if (status >= 400 && status < 500) return 'UNHANDLED'
  if (status >= 500) return 'UNHANDLED'
  return 'UNHANDLED'
}

const shouldTrack = (path: string, method?: string) => {
  const normalizedPath = path.toLowerCase()
  const normalizedMethod = (method ?? 'GET').toUpperCase()

  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(normalizedMethod)) return false
  return normalizedPath.includes('/functions/v1/') || normalizedPath.includes('/rest/v1/')
}

const mapAction = (path: string, status: number, rawBody = ''): string => {
  const lower = rawBody.toLowerCase()
  if (status === 409) return 'ข้อมูลซ้ำในระบบ ตรวจซ้ำก่อนส่งใหม่'
  if (status === 401) return 'ตรวจสิทธิ์เข้าสู่ระบบใหม่อีกครั้ง'
  if (status === 403) return 'ตรวจสิทธิ์สิทธิ์บัญชี/บริษัทที่เลือกแล้วลองใหม่'
  if (status >= 500) return 'ระบบมีปัญหาชั่วคราว โปรดลองอีกครั้งหลัง 1-2 นาที'
  if (lower.includes('invalid email') || lower.includes('รูปแบบอีเมล')) return 'ตรวจรูปแบบอีเมลให้ถูกต้อง เช่น name@domain.com'
  if (lower.includes('duplicate') || lower.includes('registered') || lower.includes('already')) return 'เปลี่ยนอีเมลหรือตรวจข้อมูลซ้ำก่อนลองใหม่'
  if (lower.includes('permission denied') || lower.includes('forbidden')) return 'ตรวจสิทธิ์ผู้ใช้งานและบริษัทที่เลือกก่อนลองใหม่'
  if (lower.includes('violates') || lower.includes('constraint')) return 'ตรวจสิทธิ์หรือข้อมูลที่เชื่อมโยงก่อนลองใหม่'
  if (path.includes('/functions/v1/create-employee')) return 'ลองรัน dry-run ก่อนส่งจริง แล้วส่งใหม่'
  return 'ตรวจข้อมูลที่ส่งให้ครบและลองใหม่'
}

const parseErrorCodeFromBody = (body?: string) => {
  if (!body) return undefined
  const firstLine = body.trim().slice(0, 4000)
  try {
    const parsed = JSON.parse(firstLine)
    if (parsed && typeof parsed === 'object' && typeof parsed.error_code === 'string') return parsed.error_code
    if (typeof parsed.error === 'string' && parsed.error.includes(':')) {
      const suffix = parsed.error.split(':').slice(-1)[0]
      if (suffix?.trim()) return suffix.trim()
    }
  } catch {
    // no-op
  }
  return undefined
}

export const installRequestErrorCenterBridge = () => {
  if (typeof window === 'undefined') return
  const target = window as Window & { __wisdomAiRequestErrorCenterBridgeInstalled?: boolean }
  if (target.__wisdomAiRequestErrorCenterBridgeInstalled) return
  target.__wisdomAiRequestErrorCenterBridgeInstalled = true

  const handleRequestError = async (event: Event) => {
    const detail = (event as CustomEvent).detail as RequestErrorDetail | undefined
    if (!detail) return
    if (!shouldTrack(detail.path, detail.method)) return

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const errorBody = detail.body ?? ''
    const requestId = generateAttemptId()
    const mapFromBody = parseErrorCodeFromBody(errorBody)
    const errorCode = mapFromBody ?? mapHttpStatusToCode(detail.status)
    globalMutationAttemptStore.upsert({
      id: requestId,
      module: 'request-layer',
      action: `${detail.method ?? 'REQUEST'} ${detail.path}`,
      status: 'error',
      actor_profile_id: user.id,
      company_id: null,
      input: {
        path: detail.path,
        status: detail.status,
        statusText: detail.statusText ?? '',
        body: errorBody.slice(0, 1000),
      },
      created_at: new Date().toISOString(),
      request_id: requestId,
      error_code: errorCode,
      error: `HTTP ${detail.status} ${detail.statusText ?? 'HTTP request failed'} ${errorBody ? `| ${errorBody.slice(0, 240)}` : ''}`.trim(),
      error_action: mapAction(detail.path, detail.status, errorBody),
      signature: createSignature({ module: 'request-layer', path: detail.path, status: detail.status }),
    })
  }

  window.addEventListener('wisdomai-request-error', handleRequestError as EventListener)
}
