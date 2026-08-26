export type DailyWageTransferConfirmation = {
  id: string
  employeeProfileId: string
  employeeName: string
  transferDate: string
  amount: number
  status: string
}

export function groupDailyWageTransfers(rows: DailyWageTransferConfirmation[]) {
  const groups = new Map<string, {
    employeeProfileId: string
    employeeName: string
    transferDate: string
    count: number
    total: number
    statuses: string[]
  }>()

  for (const row of rows) {
    const key = `${row.employeeProfileId}:${row.transferDate}`
    const current = groups.get(key) ?? {
      employeeProfileId: row.employeeProfileId,
      employeeName: row.employeeName,
      transferDate: row.transferDate,
      count: 0,
      total: 0,
      statuses: [],
    }
    current.count += 1
    current.total += Number(row.amount)
    current.statuses.push(row.status)
    groups.set(key, current)
  }

  return [...groups.values()].sort((a, b) =>
    b.transferDate.localeCompare(a.transferDate) || a.employeeName.localeCompare(b.employeeName))
}
