import { supabase } from '../lib/supabase'

export type FlowRegistryModule = 'omni' | 'attendance' | 'advance'
export type FlowRegistryStatusFilter = 'all' | 'open' | 'waiting' | 'error' | 'closed'

export type FlowRegistryFilters = {
  companyId: string
  from: string
  to: string
  module: FlowRegistryModule | 'all'
  status: FlowRegistryStatusFilter
  source: string
  owner: string
}

export type FlowRegistryTimelineEntry = {
  id: string
  action: string
  label: string
  note: string
  actor: string
  at: string
  status: 'normal' | 'working' | 'waiting' | 'error' | 'closed'
}

export type FlowRegistryRecord = {
  id: string
  module: FlowRegistryModule
  stage: string
  status: 'open' | 'waiting' | 'error' | 'closed'
  title: string
  destination: string
  owner: string
  createdAt: string
  updatedAt: string
  ageMinutes: number
  error: string | null
  detailPath: string
  sourceId: string | null
  auditKey: string
  taskId: string
  sourceRefs: string[]
  evidenceRefs: string[]
  auditRefs: string[]
  nextAction: string
  blocker: string | null
  slaDueAt: string | null
}

export type FlowRegistryNode = {
  key: string
  label: string
  count: number
  trend: number
  status: 'normal' | 'working' | 'waiting' | 'error' | 'closed'
  maxAgeMinutes: number
}

export type FlowRegistrySnapshot = {
  receivedToday: number
  underReview: number
  waitingForInfo: number
  forwarded: number
  slaBreached: number
  closedSuccessfully: number
  nodes: FlowRegistryNode[]
  destinations: Array<{ key: string; label: string; count: number; status: 'normal' | 'waiting' | 'error' }>
  destinationGroups: Array<{ key: 'hr' | 'accounting' | 'advance'; label: string; count: number; status: 'normal' | 'waiting' | 'error' }>
  exceptions: Array<{ key: string; label: string; count: number; status: 'waiting' | 'error' }>
  records: FlowRegistryRecord[]
  auditTrail: Record<string, FlowRegistryTimelineEntry[]>
  lastUpdated: string
  sourceWarnings: string[]
  reconciliation: { rowCount: number; received: number; open: number; closed: number; forwarded: number; consistent: boolean }
}

type Row = Record<string, unknown>

const asString = (value: unknown) => typeof value === 'string' ? value : ''
const asNumber = (value: unknown) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}
const asArray = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
const statusIs = (value: string, values: string[]) => values.includes(value.toLowerCase())

const ageMinutes = (value: string, now: number) => Math.max(0, Math.floor((now - new Date(value).getTime()) / 60000))

const normalizeStatus = (status: string, error: string) => {
  if (error || statusIs(status, ['failed', 'send_failed', 'retry', 'rejected'])) return 'error' as const
  if (statusIs(status, ['closed', 'completed', 'delivered', 'approved', 'recorded', 'paid', 'settled'])) return 'closed' as const
  if (statusIs(status, ['pending', 'queued', 'waiting', 'needs_more_info', 'pending_approval', 'not_ready', 'prechecked'])) return 'waiting' as const
  return 'open' as const
}

const labelDepartment = (value: string) => (({
  accounting: 'บัญชี',
  finance: 'การเงิน',
  hr: 'HR',
  admin: 'ธุรการ',
  project: 'โครงการ',
  procurement: 'จัดซื้อ',
  inventory: 'คลัง',
  system: 'ระบบ',
}[value] ?? value) || 'ยังไม่ระบุ')

const recordKey = (module: FlowRegistryModule, id: string) => `${module}:${id}`
const emptyCounts = () => ({ duplicate: 0, rejected: 0, waitingInfo: 0, deliveryFailed: 0, retry: 0 })

const mergeTimeline = (existing: FlowRegistryTimelineEntry[] | undefined, incoming: FlowRegistryTimelineEntry[]) => {
  const seen = new Set<string>()
  const merged: FlowRegistryTimelineEntry[] = []
  for (const entry of [...(existing ?? []), ...incoming]) {
    const key = `${entry.id}:${entry.action}:${entry.at}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(entry)
  }
  return merged.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
}

const groupDestination = (record: FlowRegistryRecord) => {
  const text = `${record.destination} ${record.title}`.toLowerCase()
  if (record.module === 'advance' || text.includes('เงินสำรองจ่าย') || text.includes('finance_primary')) return 'advance' as const
  if (text.includes('hr')) return 'hr' as const
  return 'accounting' as const
}

async function loadRows(table: string, columns: string, filters: FlowRegistryFilters) {
  const query = supabase
    .from(table)
    .select(columns)
    .eq('company_id', filters.companyId)
    .gte('created_at', filters.from)
    .lte('created_at', filters.to)
    .order('created_at', { ascending: false })
    .limit(1000)
  const { data, error } = await query
  return { rows: (data ?? []) as unknown as Row[], error }
}

const includeModule = (module: FlowRegistryModule, selected: FlowRegistryFilters['module']) => selected === 'all' || selected === module

type RegistryData = {
  records: FlowRegistryRecord[]
  stageCounts: Map<string, number>
  destinationCounts: Map<string, number>
  destinationGroups: Map<'hr' | 'accounting' | 'advance', number>
  exceptionCounts: ReturnType<typeof emptyCounts>
  auditTrail: Record<string, FlowRegistryTimelineEntry[]>
  warnings: string[]
}

async function loadRegistryData(filters: FlowRegistryFilters, includeAudit = true): Promise<RegistryData> {
  const now = Date.now()
  const warnings: string[] = []
  const records: FlowRegistryRecord[] = []
  const stageCounts = new Map<string, number>()
  const destinationCounts = new Map<string, number>()
  const destinationGroups = new Map<'hr' | 'accounting' | 'advance', number>([['hr', 0], ['accounting', 0], ['advance', 0]])
  const exceptionCounts = emptyCounts()
  const auditTrail: Record<string, FlowRegistryTimelineEntry[]> = {}

  const [omniResult, taskResult, deliveryResult, attendanceResult, attendanceAuditResult, advanceResult, advanceDeliveryResult, advanceAuditResult, omniReviewResult] = await Promise.all([
    includeModule('omni', filters.module) ? loadRows('omni_intake_sources', 'id,created_at,updated_at,filter_status,outtake_status,dedupe_status,review_decision,confidence,conversation_type,intent,suggested_departments,source_channel,last_error,source_room_name,source_sender_name,reviewed_at,review_note,reviewed_by', filters) : Promise.resolve({ rows: [], error: null }),
    includeModule('omni', filters.module) ? loadRows('omni_filter_tasks', 'id,created_at,updated_at,task_status,department,assigned_to,note,source_id', filters) : Promise.resolve({ rows: [], error: null }),
    includeModule('omni', filters.module) ? loadRows('omni_outtake_delivery_events', 'id,created_at,updated_at,status,destination_channel,destination_ref,source_id,error_message,attempt_count', filters) : Promise.resolve({ rows: [], error: null }),
    includeModule('attendance', filters.module) ? loadRows('chat_attendance_approval_jobs', 'id,created_at,updated_at,requested_at,status,responsible_profile_id,message_status,message_error,room_id,request_code,approved_at,recorded_at,closed_at,decision_note,approved_by,closed_by', filters) : Promise.resolve({ rows: [], error: null }),
    includeModule('attendance', filters.module) && includeAudit ? loadRows('chat_attendance_approval_events', 'id,created_at,company_id,job_id,actor_profile_id,event_type,from_status,to_status,details', filters) : Promise.resolve({ rows: [], error: null }),
    includeModule('advance', filters.module) ? loadRows('employee_advance_cases', 'id,created_at,updated_at,status,amount_received,source_flow_item_id,holder_profile_id,holder_person_id,confirmation_delivery_status,confirmation_delivery_error,confirmation_room_setup_status', filters) : Promise.resolve({ rows: [], error: null }),
    includeModule('advance', filters.module) ? loadRows('employee_advance_message_deliveries', 'id,created_at,updated_at,status,recipient_kind,last_error,retry_count,advance_case_id,delivered_at,sent_at,room_id', filters) : Promise.resolve({ rows: [], error: null }),
    includeModule('advance', filters.module) && includeAudit ? loadRows('employee_advance_audit', 'id,created_at,case_id,item_id,action,actor_profile_id,before_data,after_data,reason', filters) : Promise.resolve({ rows: [], error: null }),
    includeModule('omni', filters.module) && includeAudit ? loadRows('omni_intake_review_events', 'id,created_at,source_id,decision,note,actor_id,event_key', filters) : Promise.resolve({ rows: [], error: null }),
  ])

  const noteError = (label: string, error: { code?: string; message?: string } | null) => {
    if (!error) return
    if (error.code === '42P01' || error.code === '42703') warnings.push(`${label}: ยังไม่มี schema/คอลัมน์ของรุ่นนี้`)
    else warnings.push(`${label}: ${error.message ?? 'อ่านข้อมูลไม่สำเร็จ'}`)
  }
  noteError('Omni Intake', omniResult.error)
  noteError('Omni Filter', taskResult.error)
  noteError('Omni Delivery', deliveryResult.error)
  noteError('Attendance', attendanceResult.error)
  noteError('Attendance Audit', attendanceAuditResult.error)
  noteError('Advance', advanceResult.error)
  noteError('Advance Delivery', advanceDeliveryResult.error)
  noteError('Advance Audit', advanceAuditResult.error)
  noteError('Omni Review', omniReviewResult.error)

  const addRecord = (record: FlowRegistryRecord, timeline: FlowRegistryTimelineEntry[] = []) => {
    if (filters.status !== 'all' && record.status !== filters.status) return
    if (filters.source && !record.sourceRefs.some((value) => value.toLowerCase().includes(filters.source.toLowerCase()))) return
    if (filters.owner && !record.owner.toLowerCase().includes(filters.owner.toLowerCase())) return
    const key = record.sourceId ? recordKey(record.module, record.sourceId) : recordKey(record.module, record.id)
    const existingIndex = records.findIndex((item) => recordKey(item.module, item.sourceId || item.id) === key)
    if (existingIndex >= 0) {
      const existing = records[existingIndex]
      stageCounts.set(existing.stage, Math.max(0, (stageCounts.get(existing.stage) ?? 1) - 1))
      destinationGroups.set(groupDestination(existing), Math.max(0, (destinationGroups.get(groupDestination(existing)) ?? 1) - 1))
      const merged: FlowRegistryRecord = {
        ...existing,
        ...record,
        id: existing.id,
        sourceId: existing.sourceId || record.sourceId,
        sourceRefs: [...new Set([...existing.sourceRefs, ...record.sourceRefs])],
        evidenceRefs: [...new Set([...existing.evidenceRefs, ...record.evidenceRefs])],
        auditRefs: [...new Set([...existing.auditRefs, ...record.auditRefs])],
        blocker: record.blocker || existing.blocker,
        nextAction: record.nextAction || existing.nextAction,
      }
      records[existingIndex] = merged
      stageCounts.set(merged.stage, (stageCounts.get(merged.stage) ?? 0) + 1)
      destinationGroups.set(groupDestination(merged), (destinationGroups.get(groupDestination(merged)) ?? 0) + 1)
      if (timeline.length > 0) auditTrail[merged.auditKey] = mergeTimeline(auditTrail[merged.auditKey], timeline)
      return
    }
    records.push(record)
    stageCounts.set(record.stage, (stageCounts.get(record.stage) ?? 0) + 1)
    const group = groupDestination(record)
    destinationGroups.set(group, (destinationGroups.get(group) ?? 0) + 1)
    if (timeline.length > 0) auditTrail[record.auditKey] = mergeTimeline(auditTrail[record.auditKey], timeline)
  }

  const registerDestination = (rawDestination: string) => {
    destinationCounts.set(rawDestination, (destinationCounts.get(rawDestination) ?? 0) + 1)
  }

  const trackRetry = (status: string, retryCount = 0) => {
    if (status === 'error') exceptionCounts.deliveryFailed += 1
    if (retryCount > 0) exceptionCounts.retry += 1
  }

  omniResult.rows.forEach((row) => {
    const filterStatus = asString(row.filter_status)
    const outtakeStatus = asString(row.outtake_status)
    const dedupeStatus = asString(row.dedupe_status)
    const review = asString(row.review_decision)
    const error = asString(row.last_error)
    const duplicate = statusIs(dedupeStatus, ['possible_duplicate', 'duplicate']) || statusIs(filterStatus, ['duplicate'])
    const rejected = statusIs(review, ['rejected'])
    const closed = statusIs(outtakeStatus, ['completed', 'delivered', 'sent']) || statusIs(review, ['approved', 'rejected'])
    const waiting = statusIs(filterStatus, ['queued', 'pending', 'needs_more_info', 'waiting_info']) || statusIs(review, ['pending'])
    const status = normalizeStatus(error ? 'failed' : closed ? 'closed' : duplicate ? 'rejected' : waiting ? 'queued' : filterStatus, error)
    const stage = duplicate ? 'ตรวจซ้ำ' : status === 'error' ? 'Exception' : closed ? 'ปิดงาน' : waiting ? 'Filter' : 'วิเคราะห์'
    const destinations = asArray(row.suggested_departments)
    destinations.forEach((destination) => registerDestination(destination))
    if (duplicate) exceptionCounts.duplicate += 1
    if (rejected) exceptionCounts.rejected += 1
    if (status === 'waiting' && statusIs(filterStatus, ['needs_more_info', 'waiting_info'])) exceptionCounts.waitingInfo += 1
    trackRetry(status)
    const createdAt = asString(row.created_at)
    const sourceId = asString(row.id)
    const timeline = includeAudit ? omniReviewResult.rows
      .filter((auditRow) => asString(auditRow.source_id) === sourceId)
      .map((auditRow) => ({
        id: asString(auditRow.id),
        action: `omni_review_${asString(auditRow.decision)}`,
        label: asString(auditRow.decision) === 'approved' ? 'อนุมัติ Omni Intake' : 'ปฏิเสธ Omni Intake',
        note: asString(auditRow.note) || 'บันทึกตรวจสอบรายการ',
        actor: asString(auditRow.actor_id) || 'ระบบ',
        at: asString(auditRow.created_at),
        status: (asString(auditRow.decision) === 'approved' ? 'closed' : 'error') as FlowRegistryTimelineEntry['status'],
      })) : []
    addRecord({
      id: sourceId,
      module: 'omni',
      stage,
      status,
      title: asString(row.intent) || asString(row.conversation_type) || 'Omni Intake',
      destination: destinations.map(labelDepartment).join(', ') || 'ยังไม่ระบุ',
      owner: asString(row.source_sender_name) || 'ยังไม่ระบุ',
      createdAt,
      updatedAt: asString(row.updated_at) || createdAt,
      ageMinutes: ageMinutes(createdAt, now),
      error: error || null,
      detailPath: '/document-flows',
      sourceId,
      auditKey: recordKey('omni', sourceId),
      taskId: sourceId,
      sourceRefs: [sourceId],
      evidenceRefs: [],
      auditRefs: timeline.map((entry) => entry.id),
      nextAction: status === 'waiting' ? 'ตรวจข้อมูลเพิ่มเติม' : status === 'closed' ? 'ไม่มี' : 'ตรวจและจัดประเภท',
      blocker: error || (waiting ? 'รอข้อมูลจากต้นทาง' : null),
      slaDueAt: null,
    }, timeline)
  })

  taskResult.rows.forEach((row) => {
    const taskStatus = asString(row.task_status)
    const department = asString(row.department)
    const error = taskStatus === 'failed' ? asString(row.note) : ''
    const status = normalizeStatus(taskStatus, error)
    if (status === 'waiting') exceptionCounts.waitingInfo += 1
    const sourceId = asString(row.source_id)
    addRecord({
      id: asString(row.id),
      module: 'omni',
      stage: 'Filter',
      status,
      title: `งาน Filter · ${labelDepartment(department)}`,
      destination: labelDepartment(department),
      owner: asString(row.assigned_to) || 'ยังไม่รับงาน',
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at) || asString(row.created_at),
      ageMinutes: ageMinutes(asString(row.created_at), now),
      error: error || null,
      detailPath: '/document-flows',
      sourceId: sourceId || null,
      auditKey: recordKey('omni', sourceId || asString(row.id)),
      taskId: sourceId || asString(row.id),
      sourceRefs: [sourceId || asString(row.id)],
      evidenceRefs: [],
      auditRefs: [],
      nextAction: status === 'waiting' ? 'รับข้อมูลและตรวจซ้ำ' : 'ตรวจ Filter',
      blocker: error || null,
      slaDueAt: null,
    })
  })

  deliveryResult.rows.forEach((row) => {
    const statusValue = asString(row.status)
    const error = asString(row.error_message)
    const status = normalizeStatus(statusValue, error)
    const destination = asString(row.destination_ref) || asString(row.destination_channel) || 'ปลายทาง'
    registerDestination(destination)
    trackRetry(status, asNumber(row.attempt_count))
    addRecord({
      id: asString(row.id),
      module: 'omni',
      stage: 'ส่งปลายทาง',
      status,
      title: 'OutTake Delivery',
      destination,
      owner: 'ระบบ',
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at) || asString(row.created_at),
      ageMinutes: ageMinutes(asString(row.created_at), now),
      error: error || null,
      detailPath: '/document-flows',
      sourceId: asString(row.source_id) || null,
      auditKey: recordKey('omni', asString(row.source_id) || asString(row.id)),
      taskId: asString(row.source_id) || asString(row.id),
      sourceRefs: [asString(row.source_id) || asString(row.id)],
      evidenceRefs: [asString(row.id)],
      auditRefs: [],
      nextAction: status === 'error' ? 'Retry delivery' : status === 'closed' ? 'ตรวจปลายทาง' : 'ส่งปลายทาง',
      blocker: error || null,
      slaDueAt: null,
    })
  })

  attendanceResult.rows.forEach((row) => {
    const statusValue = asString(row.status)
    const messageError = asString(row.message_error)
    const status = normalizeStatus(statusValue, messageError || (asString(row.message_status) === 'send_failed' ? 'send_failed' : ''))
    if (status === 'waiting') exceptionCounts.waitingInfo += 1
    if (status === 'error') exceptionCounts.deliveryFailed += 1
    const jobId = asString(row.id)
    addRecord({
      id: jobId,
      module: 'attendance',
      stage: status === 'closed' ? 'ปิดงาน' : 'อนุมัติ/บันทึก',
      status,
      title: `ลงเวลา ${asString(row.request_code)}`,
      destination: 'HR',
      owner: asString(row.responsible_profile_id) || 'ยังไม่รับงาน',
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at) || asString(row.created_at),
      ageMinutes: ageMinutes(asString(row.created_at), now),
      error: messageError || null,
      detailPath: '/chat',
      sourceId: jobId,
      auditKey: recordKey('attendance', jobId),
      taskId: jobId,
      sourceRefs: [asString(row.room_id) || jobId],
      evidenceRefs: [jobId],
      auditRefs: includeAudit ? attendanceAuditResult.rows.filter((auditRow) => asString(auditRow.job_id) === jobId).map((auditRow) => asString(auditRow.id)) : [],
      nextAction: status === 'error' ? 'ตรวจและส่ง MSG ใหม่' : status === 'waiting' ? 'รอผู้รับผิดชอบ' : status === 'closed' ? 'ไม่มี' : 'อนุมัติ/บันทึก',
      blocker: messageError || null,
      slaDueAt: null,
    }, includeAudit ? attendanceAuditResult.rows
      .filter((auditRow) => asString(auditRow.job_id) === jobId)
      .map((auditRow) => ({
        id: asString(auditRow.id),
        action: asString(auditRow.event_type) || 'attendance_event',
        label: asString(auditRow.event_type) || 'Attendance Audit',
        note: `${asString(auditRow.from_status) || '-'} → ${asString(auditRow.to_status) || '-'}`,
        actor: asString(auditRow.actor_profile_id) || 'ระบบ',
        at: asString(auditRow.created_at),
        status: (asString(auditRow.to_status) === 'closed' ? 'closed' : asString(auditRow.to_status) === 'approved' || asString(auditRow.to_status) === 'recorded' ? 'working' : asString(auditRow.to_status) === 'needs_more_info' ? 'waiting' : asString(auditRow.to_status) === 'rejected' ? 'error' : 'normal') as FlowRegistryTimelineEntry['status'],
      })) : [])
  })

  advanceResult.rows.forEach((row) => {
    const statusValue = asString(row.status)
    const status = normalizeStatus(statusValue, '')
    registerDestination('finance_primary')
    const caseId = asString(row.id)
    addRecord({
      id: caseId,
      module: 'advance',
      stage: status === 'closed' ? 'ปิดงาน' : 'อนุมัติ/บันทึก',
      status,
      title: 'เงินสำรองจ่าย',
      destination: 'เงินสำรองจ่าย/การเงิน',
      owner: asString(row.holder_profile_id) || asString(row.holder_person_id) || 'ยังไม่ระบุ',
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at) || asString(row.created_at),
      ageMinutes: ageMinutes(asString(row.created_at), now),
      error: asString(row.confirmation_delivery_error) || null,
      detailPath: '/advance-settlements',
      sourceId: asString(row.source_flow_item_id) || null,
      auditKey: recordKey('advance', caseId),
      taskId: caseId,
      sourceRefs: [asString(row.source_flow_item_id) || caseId],
      evidenceRefs: [asString(row.source_flow_item_id) || ''].filter(Boolean),
      auditRefs: includeAudit ? advanceAuditResult.rows.filter((auditRow) => asString(auditRow.case_id) === caseId).map((auditRow) => asString(auditRow.id)) : [],
      nextAction: status === 'error' ? 'Retry การแจ้งผล' : status === 'waiting' ? 'รอรับงาน/ข้อมูล' : status === 'closed' ? 'ไม่มี' : 'อนุมัติ/บันทึก',
      blocker: asString(row.confirmation_delivery_error) || null,
      slaDueAt: null,
    }, includeAudit ? advanceAuditResult.rows
      .filter((auditRow) => asString(auditRow.case_id) === caseId)
      .map((auditRow) => ({
        id: asString(auditRow.id),
        action: asString(auditRow.action),
        label: asString(auditRow.action),
        note: asString(auditRow.reason) || 'Advance Audit',
        actor: asString(auditRow.actor_profile_id) || 'ระบบ',
        at: asString(auditRow.created_at),
        status: (asString(auditRow.action).includes('failed') ? 'error' : asString(auditRow.action).includes('closed') ? 'closed' : asString(auditRow.action).includes('queued') ? 'working' : 'normal') as FlowRegistryTimelineEntry['status'],
      })) : [])
  })

  advanceDeliveryResult.rows.forEach((row) => {
    const statusValue = asString(row.status)
    const error = asString(row.last_error)
    const status = normalizeStatus(statusValue, error)
    const recipient = asString(row.recipient_kind) || 'finance_primary'
    registerDestination(recipient)
    trackRetry(status, asNumber(row.retry_count))
    addRecord({
      id: asString(row.id),
      module: 'advance',
      stage: 'ส่งปลายทาง',
      status,
      title: 'System Confirmation',
      destination: recipient,
      owner: 'ระบบ',
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at) || asString(row.created_at),
      ageMinutes: ageMinutes(asString(row.created_at), now),
      error: error || null,
      detailPath: '/advance-settlements',
      sourceId: asString(row.advance_case_id),
      auditKey: recordKey('advance', asString(row.advance_case_id)),
      taskId: asString(row.advance_case_id) || asString(row.id),
      sourceRefs: [asString(row.advance_case_id) || asString(row.id)],
      evidenceRefs: [asString(row.id)],
      auditRefs: [],
      nextAction: status === 'error' ? 'Retry เฉพาะ delivery นี้' : status === 'closed' ? 'ตรวจ Audit' : 'ส่ง MSG',
      blocker: error || null,
      slaDueAt: null,
    })
  })

  const allRecords = records.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  const canonicalDestinationCounts = new Map<string, number>()
  allRecords.forEach((record) => record.destination.split(',').map((value) => value.trim()).filter(Boolean).forEach((destination) => {
    canonicalDestinationCounts.set(destination, (canonicalDestinationCounts.get(destination) ?? 0) + 1)
  }))
  return { records: allRecords, stageCounts, destinationCounts: canonicalDestinationCounts, destinationGroups, exceptionCounts, auditTrail, warnings }
}

const stageCount = (data: RegistryData, stage: string) => data.stageCounts.get(stage) ?? 0

export async function loadFlowRegistrySnapshot(filters: FlowRegistryFilters): Promise<FlowRegistrySnapshot> {
  const currentRange = await loadRegistryData(filters, true)
  const fromMs = new Date(filters.from).getTime()
  const toMs = new Date(filters.to).getTime()
  const spanMs = Math.max(1, toMs - fromMs)
  const previousFilters: FlowRegistryFilters = {
    ...filters,
    from: new Date(fromMs - spanMs - 1).toISOString(),
    to: new Date(fromMs - 1).toISOString(),
  }
  const previousRange = await loadRegistryData(previousFilters, false)
  const trendFor = (stage: string) => {
    const current = stageCount(currentRange, stage)
    const previous = stageCount(previousRange, stage)
    if (previous === 0 && current === 0) return 0
    if (previous === 0) return current
    return Math.round(((current - previous) / previous) * 100)
  }
  const count = (predicate: (record: FlowRegistryRecord) => boolean) => currentRange.records.filter(predicate).length
  const maxAge = (predicate: (record: FlowRegistryRecord) => boolean) => currentRange.records.filter(predicate).reduce((max, record) => Math.max(max, record.ageMinutes), 0)
  const nodes: FlowRegistryNode[] = [
    { key: 'received', label: 'รับเข้า', count: currentRange.records.length, trend: trendFor('รับเข้า'), status: 'normal', maxAgeMinutes: maxAge(() => true) },
    { key: 'analysis', label: 'วิเคราะห์', count: stageCount(currentRange, 'วิเคราะห์'), trend: trendFor('วิเคราะห์'), status: 'working', maxAgeMinutes: maxAge((record) => record.stage === 'วิเคราะห์') },
    { key: 'dedupe', label: 'ตรวจซ้ำ', count: stageCount(currentRange, 'ตรวจซ้ำ'), trend: trendFor('ตรวจซ้ำ'), status: 'error', maxAgeMinutes: maxAge((record) => record.stage === 'ตรวจซ้ำ') },
    { key: 'filter', label: 'Filter', count: stageCount(currentRange, 'Filter'), trend: trendFor('Filter'), status: 'waiting', maxAgeMinutes: maxAge((record) => record.stage === 'Filter') },
    { key: 'destination', label: 'ส่งปลายทาง', count: stageCount(currentRange, 'ส่งปลายทาง'), trend: trendFor('ส่งปลายทาง'), status: 'working', maxAgeMinutes: maxAge((record) => record.stage === 'ส่งปลายทาง') },
    { key: 'approval', label: 'อนุมัติ/บันทึก', count: stageCount(currentRange, 'อนุมัติ/บันทึก'), trend: trendFor('อนุมัติ/บันทึก'), status: 'working', maxAgeMinutes: maxAge((record) => record.stage === 'อนุมัติ/บันทึก') },
    { key: 'closed', label: 'ปิดงาน', count: stageCount(currentRange, 'ปิดงาน'), trend: trendFor('ปิดงาน'), status: 'closed', maxAgeMinutes: maxAge((record) => record.stage === 'ปิดงาน' || record.status === 'closed') },
  ]
  const open = currentRange.records.filter((record) => record.status !== 'closed')
  const slaBreached = open.filter((record) => record.ageMinutes > 24 * 60).length
  const waitingForInfo = currentRange.records.filter((record) => record.status === 'waiting').length
  const forwarded = count((record) => record.stage === 'ส่งปลายทาง' || record.stage === 'อนุมัติ/บันทึก' || record.status === 'closed')
  const closedSuccessfully = count((record) => record.status === 'closed')
  const reconciliation = {
    rowCount: currentRange.records.length,
    received: currentRange.records.length,
    open: open.length,
    closed: closedSuccessfully,
    forwarded,
    consistent: currentRange.records.length === open.length + closedSuccessfully,
  }
  return {
    receivedToday: currentRange.records.filter((record) => new Date(record.createdAt).toDateString() === new Date().toDateString()).length,
    underReview: currentRange.records.filter((record) => record.status === 'open' || record.stage === 'วิเคราะห์' || record.stage === 'Filter').length,
    waitingForInfo,
    forwarded,
    slaBreached,
    closedSuccessfully,
    nodes,
    destinations: [...currentRange.destinationCounts.entries()].map(([key, value]) => ({ key, label: labelDepartment(key), count: value, status: currentRange.exceptionCounts.deliveryFailed ? 'error' as const : 'normal' as const })).sort((a, b) => b.count - a.count),
    destinationGroups: [
      { key: 'hr' as const, label: 'HR', count: currentRange.destinationGroups.get('hr') ?? 0, status: 'normal' as const },
      { key: 'accounting' as const, label: 'บัญชี', count: currentRange.destinationGroups.get('accounting') ?? 0, status: 'normal' as const },
      { key: 'advance' as const, label: 'เงินสำรองจ่าย', count: currentRange.destinationGroups.get('advance') ?? 0, status: 'normal' as const },
    ],
    exceptions: [
      { key: 'duplicate', label: 'รายการซ้ำ', count: currentRange.exceptionCounts.duplicate, status: 'error' as const },
      { key: 'rejected', label: 'Reject', count: currentRange.exceptionCounts.rejected, status: 'error' as const },
      { key: 'waiting_info', label: 'รอข้อมูล', count: currentRange.exceptionCounts.waitingInfo, status: 'waiting' as const },
      { key: 'delivery_failed', label: 'MSG failed / retry', count: currentRange.exceptionCounts.deliveryFailed, status: 'error' as const },
      { key: 'retry', label: 'Retry queue', count: currentRange.exceptionCounts.retry, status: 'waiting' as const },
    ],
    records: currentRange.records,
    auditTrail: currentRange.auditTrail,
    lastUpdated: new Date().toISOString(),
    sourceWarnings: [...new Set([...currentRange.warnings, ...previousRange.warnings])].sort(),
    reconciliation,
  }
}
