export type ErrorCode = string

export type StandardErrorPayload = {
  error: string
  error_code: ErrorCode
  action?: string
}

type ErrorCatalogEntry = {
  title: string
  suggestion: string
  recoverLabel?: string
}

export type FriendlyError = {
  code: ErrorCode
  message: string
  action: string
  recoverLabel: string
  raw?: string
}

export type StandardErrorInput = {
  error: unknown
  fallback?: string
  module?: string
  code?: string
  responseStatus?: number
  responseStatusText?: string
}

const fallbackByPattern: Array<{ code: string; test: RegExp }> = [
  { code: 'AUTH_EMAIL_RATE_LIMIT', test: /email rate limit|over_email_send_rate_limit|rate limit exceeded|too many requests|429/i },
  { code: 'AUTH_USER_BANNED', test: /user is banned|banned|บัญชี.*ปิด|ถูกปิดใช้งาน/i },
  { code: 'INVALID_EMAIL', test: /invalid email|รูปแบบอีเมล|email/i },
  { code: 'INVALID_NAME', test: /ชื่อ|ชื่อพนักงาน|employee name/i },
  { code: 'INVALID_PASSWORD', test: /password|รหัสผ่าน/i },
  { code: 'AUTH_REQUIRED', test: /auth|token|credential|unauthorized|401|ไม่สามารถยืนยันตัวตน|login/i },
  { code: 'PERMISSION_DENIED', test: /permission|forbidden|ไม่อนุญาต|ไม่มีสิทธิ์|permission denied|denied/i },
  { code: 'EMAIL_ALREADY_EXISTS', test: /already exists|already|registered|duplicate|อีเมล|ซ้ำ/i },
  { code: 'AUTH_CREATE_FAILED', test: /createuser|auth|admin.createuser|auth user/i },
  { code: 'CONSTRAINT_VIOLATION', test: /constraint|violates|foreign key|new row violates|รหัสซ้ำ|ข้อจำกัด/i },
  { code: 'DUPLICATE_RECORD', test: /duplicate|duplicated|ซ้ำ/i },
  { code: 'MISSING_REQUIRED_FIELD', test: /null value|required|required field|ข้อมูล.*ไม่ครบ|ไม่ครบ/i },
  { code: 'NETWORK_ERROR', test: /fetch|network|เชื่อมต่อ|ECONN|socket|timeout|networkerror/i },
]

const defaultCatalog: Record<string, ErrorCatalogEntry> = {
  INVALID_EMAIL: {
    title: 'รูปแบบอีเมลไม่ถูกต้อง',
    suggestion: 'กรุณาใส่อีเมลให้ถูกต้อง เช่น name@domain.com',
  },
  INVALID_NAME: {
    title: 'ข้อมูลชื่อไม่ถูกต้อง',
    suggestion: 'กรุณาระบุชื่อพนักงาน 2-120 ตัวอักษร',
    recoverLabel: 'แก้ชื่อให้ครบถ้วน',
  },
  INVALID_PASSWORD: {
    title: 'รหัสผ่านไม่ตรงเงื่อนไข',
    suggestion: 'รหัสผ่านต้องมีอย่างน้อย 10 ตัวอักษร',
    recoverLabel: 'สร้างรหัสผ่านใหม่',
  },
  AUTH_EMAIL_RATE_LIMIT: {
    title: 'ขอลิงก์ตั้งรหัสผ่านถี่เกินไป',
    suggestion: 'ระบบส่งอีเมลถูกจำกัดชั่วคราว กรุณารอประมาณ 5-15 นาที แล้วค่อยขอลิงก์ใหม่อีกครั้ง',
    recoverLabel: 'รอแล้วขอใหม่',
  },
  AUTH_USER_BANNED: {
    title: 'บัญชีถูกปิดใช้งาน',
    suggestion: 'บัญชีนี้ถูกปิดสิทธิ์เข้าระบบอยู่ กรุณาให้ Admin เปิดใช้งานบัญชีก่อนขอลิงก์ตั้งรหัสใหม่',
    recoverLabel: 'ติดต่อ Admin',
  },
  AUTH_REQUIRED: {
    title: 'หมดอายุการเข้าสู่ระบบ',
    suggestion: 'กรุณาออกจากระบบและเข้าสู่ระบบใหม่',
    recoverLabel: 'ออก/เข้าสู่ระบบใหม่',
  },
  PERMISSION_DENIED: {
    title: 'สิทธิ์การเข้าถึงไม่พอ',
    suggestion: 'ตรวจสิทธิ์ผู้ใช้งาน/บริษัทที่เลือกให้ถูกต้อง (Admin/Manager/Executive) และยัง Active',
    recoverLabel: 'เช็คสิทธิ์และบริษัท',
  },
  EMAIL_ALREADY_EXISTS: {
    title: 'อีเมลซ้ำ',
    suggestion: 'อีเมลนี้มีอยู่แล้ว ให้ใช้อีเมลใหม่ก่อนลองอีกครั้ง',
    recoverLabel: 'เปลี่ยนอีเมล',
  },
  AUTH_CREATE_FAILED: {
    title: 'ระบบสร้างบัญชีผู้ใช้ล้มเหลว',
    suggestion: 'ตรวจสิทธิ์ระบบ Auth แล้วลองใหม่อีกครั้ง',
    recoverLabel: 'ลองใหม่',
  },
  DUPLICATE_RECORD: {
    title: 'ข้อมูลซ้ำ',
    suggestion: 'ข้อมูลที่ส่งอาจซ้ำกับข้อมูลเดิมในระบบ กรุณาใช้ข้อมูลอื่นและลองใหม่',
    recoverLabel: 'เปลี่ยนข้อมูลและลองใหม่',
  },
  CONSTRAINT_VIOLATION: {
    title: 'ข้อมูลไม่สอดคล้องกฎระบบ',
    suggestion: 'ข้อมูลที่ส่งอาจไม่ตรงข้อจำกัดสิทธิ์/ความถูกต้องของระบบ ตรวจและลองใหม่',
    recoverLabel: 'ตรวจข้อมูลแล้วลองใหม่',
  },
  MISSING_REQUIRED_FIELD: {
    title: 'ข้อมูลสำคัญไม่ครบ',
    suggestion: 'กรุณากรอกข้อมูลให้ครบตามแบบฟอร์ม',
    recoverLabel: 'เติมข้อมูลให้ครบ',
  },
  NETWORK_ERROR: {
    title: 'ไม่สามารถติดต่อระบบ',
    suggestion: 'ตรวจอินเทอร์เน็ตแล้วลองใหม่',
    recoverLabel: 'ลองเชื่อมต่อใหม่',
  },
  UNHANDLED: {
    title: 'ไม่สามารถทำรายการได้ตอนนี้',
    suggestion: 'ลองส่งใหม่อีกครั้ง และบันทึกรหัสข้อผิดพลาดนี้ไว้',
    recoverLabel: 'ลองอีกครั้ง',
  },
  UNKNOWN_ERROR: {
    title: 'เกิดข้อผิดพลาดที่ไม่คาดหมาย',
    suggestion: 'ลองใหม่อีกครั้ง หากยังไม่ผ่านให้แจ้งทีมผู้ดูแลระบบ',
    recoverLabel: 'ลองอีกครั้ง',
  },
  INVALID_ACTION: {
    title: 'การดำเนินการไม่ถูกต้อง',
    suggestion: 'เลือก action ให้ถูกต้อง: approve / request_more / cancel',
    recoverLabel: 'ตรวจความถูกต้องและลองใหม่',
  },
  INVALID_INTAKE_ID: {
    title: 'ไม่พบรหัส intake',
    suggestion: 'เลือกรายการ HR Intake ใหม่อีกครั้งก่อนกดยืนยัน',
    recoverLabel: 'เลือกรายการใหม่',
  },
  INTAKE_NOT_FOUND: {
    title: 'ไม่พบข้อมูล intake',
    suggestion: 'ตรวจสอบว่าอยู่ในบริษัทเดียวกันและรายการยังไม่ถูกยกเลิกหรือผ่านแล้ว',
    recoverLabel: 'รีเฟรชแล้วตรวจอีกครั้ง',
  },
  UNREADY_FOR_APPROVAL: {
    title: 'ข้อมูลยังไม่พร้อมอนุมัติ',
    suggestion: 'กรุณารอสถานะ pending_review และข้อมูลครบก่อนดำเนินการ',
    recoverLabel: 'ตรวจสถานะอีกครั้ง',
  },
}

const createEmployeeCatalog: Record<string, ErrorCatalogEntry> = {
  INVALID_EMAIL: defaultCatalog.INVALID_EMAIL,
  INVALID_NAME: defaultCatalog.INVALID_NAME,
  INVALID_PASSWORD: defaultCatalog.INVALID_PASSWORD,
  AUTH_REQUIRED: defaultCatalog.AUTH_REQUIRED,
  PERMISSION_DENIED: {
    ...defaultCatalog.PERMISSION_DENIED,
    suggestion: 'ตรวจสิทธิ์บริษัทที่เลือกและสถานะสมาชิกก่อน (active/ไม่หมดอายุ)',
    recoverLabel: 'ออก/เข้าสู่ระบบใหม่',
  },
  EMAIL_ALREADY_EXISTS: defaultCatalog.EMAIL_ALREADY_EXISTS,
  AUTH_CREATE_FAILED: defaultCatalog.AUTH_CREATE_FAILED,
  DUPLICATE_RECORD: {
    ...defaultCatalog.DUPLICATE_RECORD,
    suggestion: 'มักเกิดจากอีเมลซ้ำหรือรหัสพนักงานซ้ำในบริษัท ให้ลองข้อมูลใหม่และส่งซ้ำอีกครั้ง',
  },
  CONSTRAINT_VIOLATION: {
    ...defaultCatalog.CONSTRAINT_VIOLATION,
    suggestion: 'มักเกิดจากสิทธิ์ RLS, ข้อมูลซ้ำ, หรือข้อมูลความสัมพันธ์ไม่ครบ กรุณาคัดลอกรายละเอียดเพื่อตรวจ migration/สิทธิ์',
  },
  UNHANDLED: defaultCatalog.UNHANDLED,
}

const resolveCodeFromPayload = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') return undefined
  const raw = error as Record<string, unknown>
  if (typeof raw.error_code === 'string' && raw.error_code.trim()) return raw.error_code.trim()
  return undefined
}

const normalizeMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (!error || typeof error !== 'object') return 'ไม่สามารถดำเนินการได้'
  const raw = error as Record<string, unknown>
  if (typeof raw.message === 'string' && raw.message.trim()) return raw.message.trim()
  if (typeof raw.error === 'string' && raw.error.trim()) return raw.error.trim()
  if (typeof raw.msg === 'string' && raw.msg.trim()) return raw.msg.trim()
  return 'ไม่สามารถดำเนินการได้'
}

const deriveCodeByPattern = (message: string) => {
  const lower = message.toLowerCase()
  const matched = fallbackByPattern.find((rule) => rule.test.test(lower))
  return matched?.code
}

const dedupeTitlePrefix = (title: string, message: string) => {
  const normalizedTitle = title.trim()
  const withColon = `${normalizedTitle}:`
  if (message.startsWith(withColon)) return message.slice(withColon.length).trimStart()
  if (message.toLowerCase().startsWith(`${normalizedTitle.toLowerCase()}:`)) {
    return message.slice(normalizedTitle.length + 1).trimStart()
  }
  return message
}

const normalizeCode = (code?: string | null): string => {
  if (!code) return 'UNKNOWN_ERROR'
  return code.trim() || 'UNKNOWN_ERROR'
}

const getCatalog = (module?: string) => {
  return module === 'create-employee'
    ? createEmployeeCatalog
    : defaultCatalog
}

export const toFriendlyError = ({ error, module, code, responseStatus, responseStatusText, fallback = 'ดำเนินการไม่สำเร็จ กรุณาลองใหม่' }: StandardErrorInput): FriendlyError => {
  const message = normalizeMessage(error) || fallback
  const explicitCode = normalizeCode(resolveCodeFromPayload(error) || code)
  const resolvedCode = explicitCode === 'UNKNOWN_ERROR' && message
    ? deriveCodeByPattern(message) || 'UNHANDLED'
    : explicitCode

  const catalog = getCatalog(module)
  const entry = catalog[resolvedCode] || catalog.UNKNOWN_ERROR

  const detail = responseStatus
    ? `${responseStatus}${responseStatusText ? ` ${responseStatusText}` : ''}`
    : undefined

  const stage = typeof error === 'object' && error && 'stage' in (error as Record<string, unknown>)
    ? String((error as Record<string, unknown>).stage)
    : undefined

  const fullMessage = responseStatus
    ? `${stage ? `${stage}: ` : ''}${message} (${detail})`
    : `${stage ? `${stage}: ` : ''}${message}`

  return {
    code: resolvedCode || 'UNKNOWN_ERROR',
    message: `${entry.title}: ${dedupeTitlePrefix(entry.title, fullMessage)}`,
    action: error instanceof Object && error !== null && 'action' in (error as Record<string, unknown>) && typeof (error as Record<string, unknown>).action === 'string'
      ? String((error as Record<string, unknown>).action)
      : entry.suggestion,
    recoverLabel: entry.recoverLabel ?? 'ลองอีกครั้ง',
  }
}

const parseResponseJson = async (response: Response): Promise<{ payload: StandardErrorPayload | null; raw: string }> => {
  try {
    const text = await response.clone().text()
    if (!text) return { payload: null, raw: '' }
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object' && 'error_code' in parsed && 'error' in parsed) {
        return {
          payload: {
            error: String(parsed.error || ''),
            error_code: String((parsed as Record<string, unknown>).error_code || 'UNHANDLED'),
            action: typeof parsed.action === 'string' ? parsed.action : undefined,
          },
          raw: text,
        }
      }
    } catch {
      return { payload: null, raw: text }
    }
    return { payload: null, raw: text }
  } catch {
    return { payload: null, raw: '' }
  }
}

const resolveResponseFromError = (source: unknown): Response | undefined => {
  if (source instanceof Response) return source
  if (!source || typeof source !== 'object') return undefined
  const candidate = source as Record<string, unknown>
  if (candidate.response instanceof Response) return candidate.response
  if (candidate.context instanceof Response) return candidate.context
  if (candidate.context && typeof candidate.context === 'object' && (candidate.context as Record<string, unknown>).response instanceof Response) {
    const nested = (candidate.context as Record<string, unknown>).response
    if (nested instanceof Response) return nested
  }
  return undefined
}

export const parseFunctionError = async (source: unknown): Promise<{ payload: StandardErrorPayload | null; raw: string; status?: number; statusText?: string }> => {
  const response = resolveResponseFromError(source)
  if (response) {
    const parsed = await parseResponseJson(response)
    return {
      payload: parsed.payload,
      raw: parsed.raw,
      status: response.status,
      statusText: response.statusText,
    }
  }

  if (!source || typeof source !== 'object') {
    return { payload: null, raw: normalizeMessage(source) }
  }

  const candidateError = source as { message?: string; status?: number; statusText?: string; code?: string }
  const code = candidateError.code
  const raw = candidateError.message || ''
  if (code && raw) {
    return {
      payload: {
        error: raw,
        error_code: code,
      },
      raw,
      status: candidateError.status,
      statusText: candidateError.statusText,
    }
  }

  return { payload: null, raw }
}

export const fallbackError = (error: unknown, fallback = 'ดำเนินการไม่สำเร็จ กรุณาลองใหม่', module?: string) =>
  toFriendlyError({ error, fallback, module })
