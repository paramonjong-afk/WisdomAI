export const LINE_EMPLOYEE_INTAKE_WINDOW_MS = 10 * 60 * 1000

export function lineEmployeeIntakeBundleKey(input: {
  companyId: string
  groupId: string | null
  userId: string
  occurredAt: number
}) {
  const sourceScope = input.groupId ?? `direct:${input.userId}`
  const timeWindow = Math.floor(input.occurredAt / LINE_EMPLOYEE_INTAKE_WINDOW_MS)
  return `line:${input.companyId}:${sourceScope}:${input.userId}:${timeWindow}`
}
