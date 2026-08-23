import type { DocumentFlowScope, OmniFilterTaskRow } from './documentFlowGateway'

export type LocalFixtureFlowRow = Record<string, unknown> & {
  id: string
  intake_id: string
  source_message_id: string
  company_id: string
  current_flow: 'intake' | 'filter' | 'posting' | 'completed'
  current_room: string
  state: string
  document_type: string
  route_target: string
  confidence: number
  source_channel: string
  source_room_name: string
  source_sender_name: string
  source_received_at: string
  source_file_kind: string
  source_attachment_count: number
  projects: { name: string } | null
  version: number
  last_error: string | null
  issue_codes: string[]
  updated_at: string
  created_at: string
}

const fixture = (id: string, date: string, overrides: Partial<LocalFixtureFlowRow>): LocalFixtureFlowRow => ({
  id, intake_id: id, source_message_id: `00000000-0000-4000-8000-${id.replace(/[^0-9]/g, '').padStart(12, '0').slice(-12)}`,
  company_id: '00000000-0000-4000-8000-000000000001', current_flow: 'intake', current_room: 'intake_manual_review',
  state: 'awaiting_classification', document_type: 'other', route_target: 'document_reference', confidence: .85,
  source_channel: 'line', source_room_name: '#ทีมช่าง-กรุงเทพ', source_sender_name: 'Jong',
  source_received_at: `${date}T09:15:00+07:00`, source_file_kind: 'image_or_scan', source_attachment_count: 1,
  projects: { name: 'โครงการบ้านพักอาศัย' }, version: 1, last_error: null, issue_codes: [],
  updated_at: `${date}T09:15:00+07:00`, created_at: `${date}T09:15:00+07:00`,
  target_department: 'accounting', assignment_status: 'unassigned', next_action: 'ตรวจสอบข้อมูล', latest_comment: 'Fixture สำหรับทดสอบ Local',
  ...overrides,
})

export const localDocumentFlowFixture: LocalFixtureFlowRow[] = [
  fixture('fixture-2201', '2026-08-22', { document_type: 'other', state: 'awaiting_classification', confidence: .85, source_room_name: '#ทีมช่าง-กรุงเทพ', latest_comment: 'รอ AI แยกประเภท' }),
  fixture('fixture-2202', '2026-08-22', { document_type: 'receipt', state: 'validating', current_flow: 'filter', current_room: 'filter_receipt', route_target: 'accounts_payable_tax', confidence: .95, source_channel: 'web_chat', source_room_name: 'ห้องบัญชี', source_file_kind: 'pdf', target_department: 'accounting', next_action: 'ตรวจเอกสาร', latest_comment: 'ส่งเข้าคิวบัญชีแล้ว' }),
  fixture('fixture-2203', '2026-08-22', { document_type: 'transfer_slip', state: 'destination_in_progress', current_flow: 'posting', current_room: 'destination_accounting_queue', route_target: 'payment_verification', confidence: .96, source_sender_name: 'Somchai', target_department: 'accounting', assignment_status: 'claimed', next_action: 'ตรวจคู่โอน', latest_comment: 'บัญชีรับงานแล้ว' }),
  fixture('fixture-2204', '2026-08-22', { document_type: 'other', state: 'needs_correction', current_room: 'intake_manual_review', confidence: .72, issue_codes: ['missing_content'], last_error: 'ข้อมูลไม่ครบ', source_sender_name: 'Nok', next_action: 'ขอข้อมูลเพิ่ม' }),
  fixture('fixture-2301', '2026-08-23', { document_type: 'payroll', state: 'posted', current_flow: 'completed', current_room: 'completed_archive', confidence: .98, source_channel: 'telegram', source_room_name: 'ห้อง HR', target_department: 'hr', next_action: 'ปิดงาน', latest_comment: 'ปิดงานแล้ว' }),
]

const matches = (row: LocalFixtureFlowRow, scope: DocumentFlowScope) => {
  if (scope.channel && scope.channel !== 'all' && row.source_channel !== scope.channel) return false
  if (scope.date && !row.source_received_at.startsWith(scope.date)) return false
  if (scope.room && !row.source_room_name.toLowerCase().includes(scope.room.toLowerCase())) return false
  if (scope.sender && !row.source_sender_name.toLowerCase().includes(scope.sender.toLowerCase())) return false
  if (scope.fileKind && scope.fileKind !== 'all' && row.source_file_kind !== scope.fileKind) return false
  if (scope.project && !row.projects?.name.toLowerCase().includes(scope.project.toLowerCase())) return false
  return true
}

export function localQueuePage(scope: DocumentFlowScope, flow: 'intake' | 'filter' | 'posting' | null) {
  const scoped = localDocumentFlowFixture.filter((row) => matches(row, scope) && (!flow || row.current_flow === flow))
  const all = localDocumentFlowFixture.filter((row) => matches(row, scope))
  return { data: { items: scoped, counts: { intake: all.filter((row) => row.current_flow === 'intake').length, filter: all.filter((row) => row.current_flow === 'filter').length, posting: all.filter((row) => row.current_flow === 'posting').length }, next_cursor: null }, error: null }
}

export function localOmniTasks(scope: DocumentFlowScope) {
  const rows = localDocumentFlowFixture.filter((row) => matches(row, scope)).map((row) => ({
    id: `task-${row.id}`, department: row.target_department ?? 'accounting', task_status: row.state, required: true, note: row.latest_comment as string, created_at: row.created_at, updated_at: row.updated_at, source_id: row.id,
    omni_intake_sources: { id: row.id, source_channel: row.source_channel, source_kind: 'file', source_room_name: row.source_room_name, source_sender_name: row.source_sender_name, occurred_at: row.source_received_at, text_content: row.latest_comment as string, attachment_count: row.source_attachment_count, dedupe_status: 'primary', conversation_type: 'document', intent: row.document_type, ai_summary: row.latest_comment as string, confidence: row.confidence, confidence_band: row.confidence >= .9 ? 'high' : 'low', suggested_departments: [row.target_department ?? 'accounting'], filter_status: row.state, outtake_status: 'pending' },
  })) as unknown as OmniFilterTaskRow[]
  return { data: rows, count: rows.length, error: null }
}
