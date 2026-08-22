export const normalizeEmploymentStatus = (value?: string | null) => (value ?? '').trim().toLowerCase()

export const isResignEmploymentStatus = (status?: string | null) => {
  const normalized = normalizeEmploymentStatus(status)
  if (!normalized) return false

  return [
    'resigned',
    'resign',
    'terminated',
    'inactive',
    'quit',
    'fired',
    'ลาออก',
  ].includes(normalized)
}

export const isEmployeeResigned = (params?: {
  employment_status?: string | null
  membership_active?: boolean | null
}) => {
  if (params?.membership_active === false) return true
  return isResignEmploymentStatus(params?.employment_status)
}

export const employmentStatusLabel = (status?: string | null) => {
  const normalized = normalizeEmploymentStatus(status)
  if (!normalized) return 'สถานะไม่ระบุ'

  if (isResignEmploymentStatus(normalized)) return 'ลาออก'
  if (['active', 'working', 'employed'].includes(normalized)) return 'ทำงาน'
  return status ?? 'ไม่ทราบสถานะ'
}

export const employmentStatusColor = (status?: string | null) => {
  if (!status) return 'default'
  if (isResignEmploymentStatus(status)) return 'error'
  if (normalizeEmploymentStatus(status) === 'active') return 'success'
  return 'warning'
}
