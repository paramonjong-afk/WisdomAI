import type { OperationIssue } from './operation-center'

export type CreateEmployeePayloadForValidation = {
  fullName: string
  email: string
  password: string
  role: 'employee' | 'manager'
  companyId: string | null
}

const validateEmail = (value: string) => {
  const email = value.trim().toLowerCase()
  if (!email) {
    return { valid: false, message: 'ต้องใส่อีเมล', action: 'กรุณาใส่อีเมลเพื่อใช้เป็นบัญชีพนักงาน' }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { valid: false, message: 'รูปแบบอีเมลไม่ถูกต้อง', action: 'กรุณาใส่รูปแบบเช่น name@domain.com' }
  }
  return { valid: true }
}

export const validateCreateEmployeePayload = (payload: CreateEmployeePayloadForValidation): { canProceed: boolean; issues: OperationIssue[] } => {
  const issues: OperationIssue[] = []

  const fullName = payload.fullName.trim()
  if (!fullName) {
    issues.push({
      code: 'EMPTY_FULL_NAME',
      field: 'fullName',
      message: 'ยังไม่กรอกชื่อพนักงาน',
      blocking: true,
      severity: 'error',
      action: 'กรอกชื่อ-นามสกุลที่ครบถ้วน',
    })
  } else if (fullName.length < 2 || fullName.length > 120) {
    issues.push({
      code: 'INVALID_FULL_NAME',
      field: 'fullName',
      message: 'ความยาวชื่อควรระหว่าง 2-120 ตัวอักษร',
      blocking: true,
      severity: 'error',
      action: 'แก้ชื่อให้ยาวอย่างน้อย 2 ตัวอักษร ไม่เกิน 120',
    })
  }

  const password = payload.password
  if (!password) {
    issues.push({
      code: 'EMPTY_PASSWORD',
      field: 'password',
      message: 'ยังไม่ใส่รหัสผ่านชั่วคราว',
      blocking: true,
      severity: 'error',
      action: 'ตั้งรหัสผ่านชั่วคราวอย่างน้อย 10 ตัวอักษร',
    })
  } else if (password.length < 10) {
    issues.push({
      code: 'WEAK_PASSWORD',
      field: 'password',
      message: 'รหัสผ่านสั้นเกินไป',
      blocking: true,
      severity: 'error',
      action: 'ใส่รหัสผ่านชั่วคราวอย่างน้อย 10 ตัวอักษร',
    })
  } else if (password.length < 12) {
    issues.push({
      code: 'PASSWORD_STRENGTH_WARNING',
      field: 'password',
      message: 'รหัสผ่านความยาวผ่านเกณฑ์ขั้นต่ำ แต่ยังไม่ถึงระดับแนะนำ',
      blocking: false,
      severity: 'warning',
      action: 'แนะนำให้ใช้ 12+ ตัวอักษรและผสมตัวเลขกับสัญลักษณ์',
    })
  }

  const emailCheck = validateEmail(payload.email)
  if (!emailCheck.valid) {
    const fallbackMessage = 'รูปแบบอีเมลไม่ถูกต้อง'
    const fallbackAction = 'กรุณาใส่รูปแบบอีเมลที่ถูกต้อง เช่น name@domain.com'
    issues.push({
      code: 'INVALID_EMAIL',
      field: 'email',
      message: emailCheck.message ?? fallbackMessage,
      blocking: true,
      severity: 'error',
      action: emailCheck.action ?? fallbackAction,
    })
  }

  if (!payload.companyId) {
    issues.push({
      code: 'MISSING_COMPANY_CONTEXT',
      field: 'company',
      message: 'ยังไม่ระบุบริษัทที่ใช้งาน',
      blocking: true,
      severity: 'error',
      action: 'เลือกบริษัทก่อนเพิ่มพนักงานใหม่',
    })
  }

  if (payload.role !== 'employee' && payload.role !== 'manager') {
    issues.push({
      code: 'INVALID_ROLE',
      field: 'role',
      message: 'สิทธิ์พนักงานไม่ถูกต้อง',
      blocking: true,
      severity: 'error',
      action: 'เลือกเฉพาะพนักงานหรืผู้จัดการ',
    })
  }

  const blockingIssues = issues.filter((issue) => issue.blocking)
  return {
    canProceed: blockingIssues.length === 0,
    issues,
  }
}

export const summarizeCreateEmployeeIssues = (issues: OperationIssue[]) =>
  issues.map((issue) => `• ${issue.message}${issue.action ? ` (${issue.action})` : ''}`).join('\n')
