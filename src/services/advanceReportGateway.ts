import { supabase } from '../lib/supabase'

export type AdvanceReportStatus = 'draft' | 'collecting_evidence' | 'submitted' | 'under_review' | 'approved' | 'settlement_required' | 'closed' | 'returned' | 'cancelled'
export type AdvanceReportAction = 'submit' | 'approve' | 'return' | 'close'
export type AdvanceDuplicateFilter = 'all' | 'clean' | 'duplicate'

export type AdvanceReportRow = {
  id: string
  advance_number: string
  amount_received: number
  received_at: string | null
  bank_reference: string | null
  status: AdvanceReportStatus
  version: number
  project_id: string | null
  project_name: string | null
  holder_id: string | null
  holder_name: string | null
  source_flow_item_id: string
  source_flow: { current_flow: string; current_room: string; state: string; version: number } | null
  transaction: {
    id: string
    source_message_id: string
    recipient_name: string | null
    sender_name: string | null
    sender_bank_name: string | null
    sender_account_last4: string | null
    recipient_bank_name: string | null
    recipient_account_last4: string | null
    amount_total: number | null
    labor_amount: number | null
    expense_type: string
    transfer_at: string | null
    bank_reference: string | null
    review_status: string
    duplicate_of: string | null
    payment_party_confidence: number | null
  } | null
  settlement_items: Array<{
    id: string
    line_no: number
    expense_type: string
    amount: number
    expense_date: string
    payee_name: string | null
    daily_employee_profile_id: string | null
    daily_employee_person_id: string | null
    evidence_flow_item_id: string | null
    evidence_reference: string | null
    description: string
    approval_status: string
    review_note: string | null
  }>
  audit: Array<{ id: string; action: string; reason: string | null; created_at: string; before_data: unknown; after_data: unknown }>
}

export function isDuplicateAdvance(row: Pick<AdvanceReportRow, 'transaction'>) {
  return row.transaction?.review_status === 'duplicate' || Boolean(row.transaction?.duplicate_of)
}

export function filterAdvanceRows(rows: AdvanceReportRow[], filters: { from?: string; to?: string; holderId?: string; status?: AdvanceReportStatus | ''; duplicate?: AdvanceDuplicateFilter }) {
  return rows.filter((row) => {
    if (filters.from && row.received_at && row.received_at.slice(0, 10) < filters.from) return false
    if (filters.to && row.received_at && row.received_at.slice(0, 10) > filters.to) return false
    if (filters.holderId && row.holder_id !== filters.holderId) return false
    if (filters.status && row.status !== filters.status) return false
    if (filters.duplicate === 'clean' && isDuplicateAdvance(row)) return false
    if (filters.duplicate === 'duplicate' && !isDuplicateAdvance(row)) return false
    return true
  })
}

export type AdvanceReportSummary = { holder: string; holderId: string | null; count: number; total: number; approved: number; pending: number; returned: number; closed: number }

export function summarizeAdvanceRows(rows: AdvanceReportRow[]): AdvanceReportSummary[] {
  const grouped = new Map<string, AdvanceReportSummary>()
  for (const row of rows) {
    const key = row.holder_id ?? `raw:${row.holder_name ?? row.transaction?.recipient_name ?? row.id}`
    const current = grouped.get(key) ?? { holder: row.holder_name ?? row.transaction?.recipient_name ?? 'ยังจับคู่ชื่อไม่ได้', holderId: row.holder_id, count: 0, total: 0, approved: 0, pending: 0, returned: 0, closed: 0 }
    current.count += 1; current.total += Number(row.amount_received)
    if (['approved', 'settlement_required', 'closed'].includes(row.status)) current.approved += Number(row.amount_received)
    if (['draft', 'collecting_evidence', 'submitted', 'under_review'].includes(row.status)) current.pending += Number(row.amount_received)
    if (row.status === 'returned') current.returned += Number(row.amount_received)
    if (row.status === 'closed') current.closed += Number(row.amount_received)
    grouped.set(key, current)
  }
  return [...grouped.values()].sort((left, right) => right.total - left.total)
}

type RawAdvanceRow = Omit<AdvanceReportRow, 'project_name' | 'holder_name' | 'source_flow' | 'transaction' | 'settlement_items' | 'audit'> & {
  holder_profile_id: string | null
  holder_person_id: string | null
  projects: { name: string | null } | null
  holder_profile: { full_name: string | null } | null
  holder_person: { full_name: string | null } | null
  document_flow_items: { current_flow: string; current_room: string; state: string; version: number } | null
  financial_transactions: AdvanceReportRow['transaction']
  employee_advance_settlement_items: AdvanceReportRow['settlement_items'] | null
  employee_advance_audit: AdvanceReportRow['audit'] | null
}

const select = `
  id,advance_number,amount_received,received_at,bank_reference,status,version,project_id,source_flow_item_id,holder_profile_id,holder_person_id,
  projects(name),
  holder_profile:profiles!employee_advance_cases_holder_profile_id_fkey(full_name),
  holder_person:employee_people!employee_advance_cases_holder_person_id_fkey(full_name),
  document_flow_items!employee_advance_cases_source_flow_item_id_fkey(current_flow,current_room,state,version),
  financial_transactions(id,source_message_id,recipient_name,sender_name,sender_bank_name,sender_account_last4,recipient_bank_name,recipient_account_last4,amount_total,labor_amount,expense_type,transfer_at,bank_reference,review_status,duplicate_of,payment_party_confidence),
  employee_advance_settlement_items!employee_advance_settlement_items_case_id_fkey(id,line_no,expense_type,amount,expense_date,payee_name,daily_employee_profile_id,daily_employee_person_id,evidence_flow_item_id,evidence_reference,description,approval_status,review_note),
  employee_advance_audit!employee_advance_audit_case_id_fkey(id,action,reason,created_at,before_data,after_data)
`

function bangkokNextDayStart(date: string) {
  const next = new Date(`${date}T00:00:00+07:00`)
  next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString()
}

function mapRow(row: RawAdvanceRow): AdvanceReportRow {
  return {
    ...row,
    project_name: row.projects?.name ?? null,
    holder_id: row.holder_profile_id ?? row.holder_person_id ?? null,
    holder_name: row.holder_profile?.full_name ?? row.holder_person?.full_name ?? row.financial_transactions?.recipient_name ?? null,
    source_flow: row.document_flow_items,
    transaction: row.financial_transactions,
    settlement_items: row.employee_advance_settlement_items ?? [],
    audit: (row.employee_advance_audit ?? []).sort((left, right) => left.created_at.localeCompare(right.created_at)),
  }
}

export const advanceReportGateway = {
  async list(companyId: string, from: string, to: string, holderId?: string, status?: AdvanceReportStatus) {
    let query = supabase.from('employee_advance_cases').select(select).eq('company_id', companyId)
      .gte('received_at', `${from}T00:00:00+07:00`).lt('received_at', bangkokNextDayStart(to))
      .order('received_at', { ascending: false })
    if (holderId) query = query.or(`holder_profile_id.eq.${holderId},holder_person_id.eq.${holderId}`)
    if (status) query = query.eq('status', status)
    const result = await query
    return { data: (result.data ?? []).map((row) => mapRow(row as unknown as RawAdvanceRow)), error: result.error }
  },

  async detail(companyId: string, id: string) {
    const result = await supabase.from('employee_advance_cases').select(select).eq('company_id', companyId).eq('id', id).maybeSingle()
    return { data: result.data ? mapRow(result.data as unknown as RawAdvanceRow) : null, error: result.error }
  },

  async transition(input: { caseId: string; action: AdvanceReportAction; expectedVersion: number; reason?: string | null; eventKey: string }) {
    if (['return', 'close'].includes(input.action) && !input.reason?.trim()) {
      return { data: null, error: new Error('การส่งกลับหรือปิดยอดต้องมีเหตุผล') }
    }
    return supabase.rpc('transition_employee_advance_case', {
      target_case_id: input.caseId,
      target_event_key: input.eventKey,
      target_action: input.action,
      target_expected_version: input.expectedVersion,
      target_reason: input.reason ?? null,
    })
  },
}

export function calculateAdvanceBalance(row: Pick<AdvanceReportRow, 'amount_received' | 'settlement_items'>) {
  const approved = row.settlement_items.filter((item) => item.approval_status === 'approved')
  const used = approved.filter((item) => !['cash_return', 'payroll_offset'].includes(item.expense_type)).reduce((sum, item) => sum + Number(item.amount), 0)
  const cashReturn = approved.filter((item) => item.expense_type === 'cash_return').reduce((sum, item) => sum + Number(item.amount), 0)
  const payrollOffset = approved.filter((item) => item.expense_type === 'payroll_offset').reduce((sum, item) => sum + Number(item.amount), 0)
  return { used, cashReturn, payrollOffset, outstanding: Number(row.amount_received) - used - cashReturn - payrollOffset }
}
