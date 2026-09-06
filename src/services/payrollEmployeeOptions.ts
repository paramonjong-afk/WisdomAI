export type PayrollEmployeeOption = { id: string; name: string; employmentStatus: string; isFormer: boolean }
export type PayrollEmployeeRow = { profile_id: string; employment_status: string | null; profiles: { full_name: string | null } | { full_name: string | null }[] | null }

const currentEmploymentStatuses = new Set(['active', 'probation', 'notice'])

export const payrollEmployeeOptions = (rows: PayrollEmployeeRow[]): PayrollEmployeeOption[] => {
  const byProfile = new Map<string, PayrollEmployeeOption>()
  for (const row of rows) {
    const linkedProfile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
    const employmentStatus = row.employment_status ?? 'unknown'
    const option = { id: row.profile_id, name: linkedProfile?.full_name ?? row.profile_id, employmentStatus, isFormer: !currentEmploymentStatuses.has(employmentStatus) }
    const existing = byProfile.get(row.profile_id)
    if (!existing || (existing.isFormer && !option.isFormer)) byProfile.set(row.profile_id, option)
  }
  return [...byProfile.values()].sort((left, right) => Number(left.isFormer) - Number(right.isFormer) || left.name.localeCompare(right.name, 'th'))
}

export const payrollEmployeeLabel = (employee: PayrollEmployeeOption) => `${employee.name}${employee.isFormer ? ' · อดีตพนักงาน' : ''}`
