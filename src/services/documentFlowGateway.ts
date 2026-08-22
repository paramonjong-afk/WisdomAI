import { supabase } from '../lib/supabase'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const queryChunkSize = 100
const activeEmployeeIntakeStatuses = ['awaiting_purpose', 'collecting_documents', 'extracting', 'information_required', 'pending_review', 'rejected', 'failed']
const chunk = <T>(values: T[]) => Array.from({ length: Math.ceil(values.length / queryChunkSize) }, (_, index) => values.slice(index * queryChunkSize, (index + 1) * queryChunkSize))

export type TransferSlipParties = {
  source_message_id: string
  sender_name: string | null
  sender_bank_name: string | null
  sender_account_last4: string | null
  recipient_name: string | null
  recipient_bank_name: string | null
  recipient_account_last4: string | null
  transfer_at: string | null
  bank_reference: string | null
  payment_party_confidence: number | null
}

export type ChequePaymentEvidence = {
  source_message_id: string
  cheque_number: string | null
  cheque_issued_on: string | null
  cheque_drawer_name: string | null
  cheque_payee_name: string | null
  cheque_bank_name: string | null
  cheque_account_last4: string | null
  amount_total: number | null
  cheque_extraction_confidence: number | null
  cheque_match_status: 'unmatched' | 'matched' | 'needs_review' | 'duplicate'
  cheque_matched_entity_type: string | null
}

export type DocumentFlowScope = {
  channel?: 'all' | 'line' | 'telegram' | 'web_chat' | 'unknown'
  date?: string
  room?: string
  sender?: string
  fileKind?: 'all' | 'image_or_scan' | 'pdf' | 'document' | 'unknown'
  project?: string
}

export type OmniFilterTaskRow = {
  id: string
  department: string
  task_status: string
  required: boolean
  note: string | null
  created_at: string
  updated_at: string
  source_id: string
  omni_intake_sources: {
    id: string
    source_channel: string
    source_kind: string
    source_room_name: string | null
    source_sender_name: string | null
    occurred_at: string
    text_content: string | null
    attachment_count: number
    dedupe_status: string
    conversation_type: string
    intent: string | null
    ai_summary: string | null
    confidence: number | null
    confidence_band: string | null
    suggested_departments: string[]
    filter_status: string
    outtake_status: string
  } | null
}

export type OmniIntakeSourceRow = {
  id: string
  source_channel: 'line' | 'web_chat' | 'upload' | 'manual'
  source_kind: 'message' | 'file' | 'system_event' | 'manual'
  line_message_id: string | null
  chat_message_id: string | null
  source_room_id: string | null
  source_room_name: string | null
  source_sender_name: string | null
  occurred_at: string
  text_content: string | null
  attachment_count: number
  conversation_type: string
  intent: string | null
  ai_summary: string | null
  confidence: number
  confidence_band: string
  filter_status: string
  review_decision: 'pending' | 'approved' | 'rejected'
  review_note: string | null
}

export type IntakeContextMessage = {
  id: string
  occurred_at: string
  text_content: string | null
  attachment?: { bucket: string; path: string; contentType: string | null; label: string } | null
}

const dateRange = (date?: string) => date
  ? { from: new Date(`${date}T00:00:00`).toISOString(), to: new Date(`${date}T23:59:59.999`).toISOString() }
  : { from: null, to: null }

/**
 * The only client-side gateway for the Document Flow domain.
 * Screens must use this module rather than communicating with another flow
 * screen or issuing workflow commands to a business table themselves.
 */
export const documentFlowGateway = {
  async loadQueuePage(cursor?: { updatedAt: string; id: string } | null, limit = 100, flow?: 'filter' | 'posting' | null, scope: DocumentFlowScope = {}) {
    const range = dateRange(scope.date)
    return supabase.rpc('document_flow_queue_page_for_flow', {
      target_limit: Math.max(1, Math.min(limit, 100)),
      target_before_updated_at: cursor?.updatedAt ?? null,
      target_before_id: cursor?.id ?? null,
      target_flow: flow ?? null,
      target_channel: scope.channel ?? 'all',
      target_received_from: range.from,
      target_received_to: range.to,
      target_room: scope.room?.trim() || null,
      target_sender: scope.sender?.trim() || null,
      target_file_kind: scope.fileKind ?? 'all',
      target_project: scope.project?.trim() || null,
    })
  },

  async loadQueueFacets(scope: DocumentFlowScope = {}) {
    const range = dateRange(scope.date)
    return supabase.rpc('document_flow_queue_facets', {
      target_channel: scope.channel ?? 'all',
      target_received_from: range.from,
      target_received_to: range.to,
      target_room: scope.room?.trim() || null,
      target_sender: scope.sender?.trim() || null,
      target_file_kind: scope.fileKind ?? 'all',
      target_project: scope.project?.trim() || null,
    })
  },

  async loadIntakeQueue(filters: DocumentFlowScope = {}) {
    const { from: start, to: end } = dateRange(filters.date)
    let documentQuery = supabase
      .from('document_flow_items')
      .select('id,intake_id,review_case_id,source_message_id,source_channel,source_room_name,source_sender_name,source_received_at,source_file_kind,source_attachment_count,current_room,current_flow,state,route_target,document_type,vendor_name,confidence,issue_codes,last_error,total_amount,data_review_status,data_review_note,projects(name),version,created_at,updated_at')
      .eq('current_flow', 'intake')
      .order('updated_at', { ascending: false })
      .limit(2000)
    if (filters?.channel && filters.channel !== 'all') documentQuery = documentQuery.eq('source_channel', filters.channel)
    if (start && end) documentQuery = documentQuery.gte('source_received_at', start).lte('source_received_at', end)
    if (filters.room?.trim()) documentQuery = documentQuery.ilike('source_room_name', `%${filters.room.trim()}%`)
    if (filters.sender?.trim()) documentQuery = documentQuery.ilike('source_sender_name', `%${filters.sender.trim()}%`)
    if (filters.fileKind && filters.fileKind !== 'all') documentQuery = documentQuery.eq('source_file_kind', filters.fileKind)
    if (filters.project?.trim()) documentQuery = documentQuery.ilike('projects.name', `%${filters.project.trim()}%`)

    let employeeQuery = supabase
      .from('employee_intakes')
      .select('id,channel,external_chat_id,external_user_id,purpose,status,candidate_name,missing_fields,document_count,source_started_at,created_at,updated_at')
      .in('status', activeEmployeeIntakeStatuses)
      .order('updated_at', { ascending: false })
      .limit(2000)
    if (filters?.channel && ['line', 'telegram', 'web_chat'].includes(filters.channel)) employeeQuery = employeeQuery.eq('channel', filters.channel)
    if (filters?.channel === 'unknown') employeeQuery = employeeQuery.limit(0)
    if (start && end) employeeQuery = employeeQuery.gte('source_started_at', start).lte('source_started_at', end)
    if (filters.room?.trim()) employeeQuery = employeeQuery.ilike('external_chat_id', `%${filters.room.trim()}%`)
    if (filters.sender?.trim()) employeeQuery = employeeQuery.ilike('external_user_id', `%${filters.sender.trim()}%`)
    return Promise.all([
      documentQuery,
      employeeQuery,
    ])
  },

  async loadOmniFilterTasks(filters: DocumentFlowScope = {}) {
    const { from: start, to: end } = dateRange(filters.date)
    let query = supabase
      .from('omni_filter_tasks')
      .select(`
        id,department,task_status,required,note,created_at,updated_at,source_id,
        omni_intake_sources!inner(
          id,source_channel,source_kind,source_room_name,source_sender_name,occurred_at,
          text_content,attachment_count,dedupe_status,conversation_type,intent,ai_summary,
          confidence,confidence_band,suggested_departments,filter_status,outtake_status
        )
      `, { count: 'exact' })
      .order('updated_at', { ascending: false })
      .limit(500)
    if (filters?.channel && filters.channel !== 'all') query = query.eq('omni_intake_sources.source_channel', filters.channel)
    if (start && end) query = query.gte('omni_intake_sources.occurred_at', start).lte('omni_intake_sources.occurred_at', end)
    if (filters.room?.trim()) query = query.ilike('omni_intake_sources.source_room_name', `%${filters.room.trim()}%`)
    if (filters.sender?.trim()) query = query.ilike('omni_intake_sources.source_sender_name', `%${filters.sender.trim()}%`)
    if (filters.fileKind && filters.fileKind !== 'all') {
      if (filters.fileKind === 'unknown') query = query.eq('omni_intake_sources.attachment_count', 0)
      else query = query.gt('omni_intake_sources.attachment_count', 0)
    }
    return query
  },

  async loadOmniIntakeSources(filters: DocumentFlowScope = {}) {
    const { from: start, to: end } = dateRange(filters.date)
    let query = supabase.from('omni_intake_sources').select(
      'id,source_channel,source_kind,line_message_id,chat_message_id,source_room_id,source_room_name,source_sender_name,occurred_at,text_content,attachment_count,conversation_type,intent,ai_summary,confidence,confidence_band,filter_status,review_decision,review_note',
      { count: 'exact' },
    ).order('occurred_at', { ascending: false }).limit(500)
    if (filters.channel && filters.channel !== 'all' && filters.channel !== 'telegram' && filters.channel !== 'unknown') query = query.eq('source_channel', filters.channel)
    if (filters.channel === 'telegram' || filters.channel === 'unknown') query = query.limit(0)
    if (start && end) query = query.gte('occurred_at', start).lte('occurred_at', end)
    if (filters.room?.trim()) query = query.ilike('source_room_name', `%${filters.room.trim()}%`)
    if (filters.sender?.trim()) query = query.ilike('source_sender_name', `%${filters.sender.trim()}%`)
    if (filters.fileKind === 'unknown') query = query.eq('attachment_count', 0)
    if (filters.fileKind && filters.fileKind !== 'all' && filters.fileKind !== 'unknown') query = query.gt('attachment_count', 0)
    return query
  },

  async reviewOmniIntakeSource(sourceId: string, decision: 'approved' | 'rejected', note: string) {
    return supabase.rpc('review_omni_intake_source', {
      target_source_id: sourceId,
      target_decision: decision,
      target_note: note || null,
    })
  },

  async loadOmniConversationContext(source: Pick<OmniIntakeSourceRow, 'source_channel' | 'source_room_id' | 'occurred_at'>) {
    const center = new Date(source.occurred_at).getTime()
    const from = new Date(center - 2 * 60 * 60 * 1000).toISOString()
    const to = new Date(center + 2 * 60 * 60 * 1000).toISOString()
    if (source.source_channel === 'line' && source.source_room_id) {
      const messages = await supabase.from('line_messages')
        .select('id,occurred_at,text_content,file_name,message_type')
        .eq('line_group_id', source.source_room_id).gte('occurred_at', from).lte('occurred_at', to)
        .order('occurred_at', { ascending: true }).limit(50)
      if (messages.error) return { data: [] as IntakeContextMessage[], error: messages.error }
      const ids = (messages.data ?? []).map((message) => message.id)
      const attachments = ids.length ? await supabase.from('line_attachments')
        .select('message_id,storage_bucket,storage_path,content_type').in('message_id', ids) : { data: [], error: null }
      if (attachments.error) return { data: [] as IntakeContextMessage[], error: attachments.error }
      const attachmentByMessage = new Map((attachments.data ?? []).map((file) => [file.message_id, file]))
      return { data: (messages.data ?? []).map((message) => {
        const file = attachmentByMessage.get(message.id)
        return { id: message.id, occurred_at: message.occurred_at, text_content: message.text_content ?? message.file_name ?? null,
          attachment: file ? { bucket: file.storage_bucket, path: file.storage_path, contentType: file.content_type, label: message.file_name ?? 'ไฟล์แนบ' } : null }
      }), error: null }
    }
    if (source.source_channel === 'web_chat' && source.source_room_id) {
      const messages = await supabase.from('chat_messages')
        .select('id,created_at,text_content,attachment_bucket,attachment_path,attachment_name,attachment_content_type')
        .eq('room_id', source.source_room_id).is('deleted_at', null).gte('created_at', from).lte('created_at', to)
        .order('created_at', { ascending: true }).limit(50)
      if (messages.error) return { data: [] as IntakeContextMessage[], error: messages.error }
      return { data: (messages.data ?? []).map((message) => ({
        id: message.id, occurred_at: message.created_at, text_content: message.text_content ?? message.attachment_name ?? null,
        attachment: message.attachment_path && message.attachment_bucket ? { bucket: message.attachment_bucket, path: message.attachment_path, contentType: message.attachment_content_type, label: message.attachment_name ?? 'ไฟล์แนบ' } : null,
      })), error: null }
    }
    return { data: [] as IntakeContextMessage[], error: null }
  },

  async loadSourceMessages(sourceMessageIds: string[]) {
    // Historical imports can contain an empty/non-UUID source key.  Do not let
    // one legacy key turn the whole PostgREST `in (...)` request into 400.
    const validIds = Array.from(new Set(sourceMessageIds.filter((id) => uuidPattern.test(id))))
    if (validIds.length === 0) {
      return {
        messages: { data: [], error: null },
        senders: { data: [], error: null },
        groups: { data: [], error: null },
      }
    }
    const messageResults = await Promise.all(chunk(validIds).map((ids) => supabase
      .from('line_messages')
      .select('id,occurred_at,line_group_id,line_user_id,message_type,text_content,file_name')
      .in('id', ids)))
    const messageError = messageResults.find((result) => result.error)?.error ?? null
    const messages = {
      data: messageResults.flatMap((result) => result.data ?? []),
      error: messageError,
    }
    if (messages.error) return { messages, senders: null, groups: null }

    const senderIds = Array.from(new Set((messages.data ?? []).map((item) => item.line_user_id).filter((id): id is string => Boolean(id))))
    const groupIds = Array.from(new Set((messages.data ?? []).map((item) => item.line_group_id).filter((id): id is string => Boolean(id))))
    const [senderResults, groupResults] = await Promise.all([
      Promise.all(chunk(senderIds).map((ids) => supabase.from('line_senders').select('line_user_id,display_name').in('line_user_id', ids))),
      Promise.all(chunk(groupIds).map((ids) => supabase.from('line_groups').select('line_group_id,display_name').in('line_group_id', ids))),
    ])
    const senders = {
      data: senderResults.flatMap((result) => result.data ?? []),
      error: senderResults.find((result) => result.error)?.error ?? null,
    }
    const groups = {
      data: groupResults.flatMap((result) => result.data ?? []),
      error: groupResults.find((result) => result.error)?.error ?? null,
    }
    return { messages, senders, groups }
  },

  async loadTransferSlipParties(sourceMessageIds: string[]) {
    const validIds = Array.from(new Set(sourceMessageIds.filter((id) => uuidPattern.test(id))))
    if (validIds.length === 0) return { data: [] as TransferSlipParties[], error: null }
    const results = await Promise.all(chunk(validIds).map((ids) => supabase
      .from('financial_transactions')
      .select('source_message_id,sender_name,sender_bank_name,sender_account_last4,recipient_name,recipient_bank_name,recipient_account_last4,transfer_at,bank_reference,payment_party_confidence')
      .in('source_message_id', ids)))
    return {
      data: results.flatMap((result) => result.data ?? []) as TransferSlipParties[],
      error: results.find((result) => result.error)?.error ?? null,
    }
  },

  async loadChequePaymentEvidence(sourceMessageIds: string[]) {
    const validIds = Array.from(new Set(sourceMessageIds.filter((id) => uuidPattern.test(id))))
    if (validIds.length === 0) return { data: [] as ChequePaymentEvidence[], error: null }
    const results = await Promise.all(chunk(validIds).map((ids) => supabase
      .from('financial_transactions')
      .select('source_message_id,cheque_number,cheque_issued_on,cheque_drawer_name,cheque_payee_name,cheque_bank_name,cheque_account_last4,amount_total,cheque_extraction_confidence,cheque_match_status,cheque_matched_entity_type')
      .eq('payment_evidence_type', 'cheque_payment')
      .in('source_message_id', ids)))
    return {
      data: results.flatMap((result) => result.data ?? []) as ChequePaymentEvidence[],
      error: results.find((result) => result.error)?.error ?? null,
    }
  },

  async loadLatestEvents(itemIds: string[]) {
    const results = await Promise.all(chunk(itemIds).map((ids) => supabase.from('document_flow_events')
      .select('item_id,event_key,event_type,note,to_state,created_at')
      .in('item_id', ids)
      .order('created_at', { ascending: false })))
    return {
      data: results.flatMap((result) => result.data ?? []),
      error: results.find((result) => result.error)?.error ?? null,
    }
  },

  async loadTimeline(itemId: string) {
    return supabase.from('document_flow_events').select(
      'id,event_type,from_flow,to_flow,from_state,to_state,note,created_at',
    ).eq('item_id', itemId).order('created_at', { ascending: false })
  },

  async preview(itemId: string) {
    return supabase.rpc('document_flow_item_preview', { target_item_id: itemId })
  },

  async signedPreviewUrl(bucket: string, path: string) {
    return supabase.storage.from(bucket).createSignedUrl(path, 600)
  },

  async employeeIntakePreview(intakeId: string) {
    return supabase.from('employee_intake_documents')
      .select('storage_bucket,storage_path,mime_type,created_at')
      .eq('intake_id', intakeId)
      .order('created_at')
      .limit(1)
      .maybeSingle()
  },

  async loadProjectWorkPackages() {
    return Promise.all([
      supabase.from('projects').select('id,name,code').eq('status', 'active').order('name'),
      supabase.from('project_work_packages').select('id,project_id,parent_id,code,name,description,status').eq('status', 'active').order('name'),
    ])
  },

  async createProjectWorkPackage(input: { projectId: string; parentId?: string | null; name: string; description?: string; code?: string }) {
    return supabase.rpc('create_project_work_package', {
      target_project_id: input.projectId,
      target_parent_id: input.parentId ?? null,
      target_name: input.name,
      target_description: input.description ?? null,
      target_code: input.code ?? null,
    })
  },

  async assignProjectWorkPackage(input: { itemId: string; projectId: string; workPackageId?: string | null; expectedVersion: number; eventKey: string }) {
    return supabase.rpc('assign_document_flow_work_package', {
      target_item_id: input.itemId,
      target_project_id: input.projectId,
      target_work_package_id: input.workPackageId ?? null,
      target_expected_version: input.expectedVersion,
      target_event_key: input.eventKey,
    })
  },

  async loadDestinationTasks(itemId: string) {
    return supabase.from('document_flow_destination_tasks')
      .select('id,item_id,department,required,status,assigned_to,note,version,created_at,updated_at')
      .eq('item_id', itemId).order('created_at')
  },

  async routeMultiDestination(input: { itemId: string; expectedVersion: number; eventKey: string; documentType: string; departments: string[]; requiredDepartments: string[]; note?: string | null }) {
    return supabase.rpc('route_document_flow_multi_destination', {
      target_item_id: input.itemId,
      target_expected_version: input.expectedVersion,
      target_event_key: input.eventKey,
      target_document_type: input.documentType,
      target_departments: input.departments,
      target_required_departments: input.requiredDepartments,
      target_note: input.note ?? null,
    })
  },

  async updateDestinationTask(input: { taskId: string; expectedVersion: number; action: 'claim' | 'complete' | 'return' | 'cancel'; eventKey: string; note?: string | null }) {
    return supabase.rpc('update_document_flow_destination_task', {
      target_task_id: input.taskId,
      target_expected_version: input.expectedVersion,
      target_action: input.action,
      target_event_key: input.eventKey,
      target_note: input.note ?? null,
    })
  },

  async markDataReview(input: { itemId: string; expectedVersion: number; eventKey: string; status: 'complete' | 'incomplete' | 'recheck_required' | 'rechecked'; departments?: string[]; note?: string | null; changedFields?: string[] }) {
    return supabase.rpc('mark_document_flow_data_review', {
      target_item_id: input.itemId,
      target_expected_version: input.expectedVersion,
      target_event_key: input.eventKey,
      target_status: input.status,
      target_departments: input.departments ?? [],
      target_note: input.note ?? null,
      target_changed_fields: input.changedFields ?? [],
    })
  },

  async transition(input: {
    itemId: string
    action: string
    expectedVersion: number
    eventKey: string
    note?: string | null
  }) {
    return supabase.rpc('transition_document_flow_item', {
      target_item_id: input.itemId,
      target_action: input.action,
      target_expected_version: input.expectedVersion,
      target_event_key: input.eventKey,
      target_note: input.note ?? null,
    })
  },

  async route(input: {
    itemId: string
    action: 'classify_and_route' | 'claim_destination' | 'return_to_filter' | 'return_to_intake' | 'reassign_destination'
    expectedVersion: number
    eventKey: string
    note?: string | null
    documentType?: string | null
    department?: string | null
    candidates?: string[] | null
  }) {
    return supabase.rpc('route_document_flow_item', {
      target_item_id: input.itemId,
      target_action: input.action,
      target_expected_version: input.expectedVersion,
      target_event_key: input.eventKey,
      target_note: input.note ?? null,
      target_document_type: input.documentType ?? null,
      target_department: input.department ?? null,
      target_candidates: input.candidates ?? null,
    })
  },

  async reviewEmployeeIntake(input: {
    intakeId: string
    action: 'approve' | 'request_more' | 'cancel' | 'revert_approval'
  }) {
    return supabase.functions.invoke('review-employee-intake', {
      body: { action: input.action, intake_id: input.intakeId },
    })
  },
}
