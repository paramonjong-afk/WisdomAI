import { supabase } from '../lib/supabase'
import { candidateEvidenceFallback, emptyMasterSourceEvidence, resolveCandidateSourceEvidence } from '../pages/MasterDataCenter/masterDataReview'
import type { MasterCandidate } from '../pages/MasterDataCenter/masterDataReview'

type FinancialSource = { id: string; source_message_id: string | null }
type FlowSource = { id: string; intake_id: string | null; source_message_id: string | null; source_channel: string | null; source_room_name: string | null; source_sender_name: string | null; source_received_at: string | null }
type MessageSource = { id: string; line_group_id: string | null; file_name: string | null; occurred_at: string | null }
type AttachmentSource = { id: string; message_id: string; storage_bucket: string; storage_path: string; content_type: string | null }
type EventSource = { id: string; item_id: string; created_at: string }
type AuditSource = { id: number; candidate_id: string; created_at: string }

const unique = (values: Array<string | null | undefined>) => [...new Set(values.filter((value): value is string => Boolean(value)))]
const chunks = <T,>(values: T[], size = 100) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size))
const batch = async <T,>(values: string[], query: (ids: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>) => {
  const results = await Promise.all(chunks(values).map(query))
  return { data: results.flatMap((result) => result.data ?? []), error: results.find((result) => result.error)?.error ?? null }
}

export { emptyMasterSourceEvidence }

export async function loadMasterSourceEvidence(candidates: MasterCandidate[]) {
  const fallback = Object.fromEntries(candidates.map((candidate) => [candidate.id, candidateEvidenceFallback(candidate)]))
  const financialCandidates = candidates.filter((candidate) => candidate.source_table === 'financial_transactions' && candidate.source_id)
  const transactionIds = unique(financialCandidates.map((candidate) => candidate.source_id))
  const directMessageIds = unique(candidates.filter((candidate) => candidate.source_table === 'line_messages').map((candidate) => candidate.source_id))

  const transactions = transactionIds.length
    ? await batch<FinancialSource>(transactionIds, (ids) => supabase.from('financial_transactions').select('id,source_message_id').in('id', ids))
    : { data: [] as FinancialSource[], error: null }
  if (transactions.error) return { data: fallback, error: transactions.error }
  const transactionById = new Map(transactions.data.map((row) => [row.id, row]))
  const messageIds = unique([...directMessageIds, ...transactions.data.map((row) => row.source_message_id), ...Object.values(fallback).map((row) => row.messageId)])

  const [flows, messages, attachments] = await Promise.all([
    messageIds.length ? batch<FlowSource>(messageIds, (ids) => supabase.from('document_flow_items').select('id,intake_id,source_message_id,source_channel,source_room_name,source_sender_name,source_received_at').in('source_message_id', ids)) : Promise.resolve({ data: [] as FlowSource[], error: null }),
    messageIds.length ? batch<MessageSource>(messageIds, (ids) => supabase.from('line_messages').select('id,line_group_id,file_name,occurred_at').in('id', ids)) : Promise.resolve({ data: [] as MessageSource[], error: null }),
    messageIds.length ? batch<AttachmentSource>(messageIds, (ids) => supabase.from('line_attachments').select('id,message_id,storage_bucket,storage_path,content_type').in('message_id', ids)) : Promise.resolve({ data: [] as AttachmentSource[], error: null }),
  ])
  const sourceError = flows.error ?? messages.error ?? attachments.error
  if (sourceError) return { data: fallback, error: sourceError }

  const itemIds = unique(flows.data.map((row) => row.id))
  const candidateIds = unique(candidates.map((row) => row.id))
  const [events, audits] = await Promise.all([
    itemIds.length ? batch<EventSource>(itemIds, (ids) => supabase.from('document_flow_events').select('id,item_id,created_at').in('item_id', ids).order('created_at', { ascending: false })) : Promise.resolve({ data: [] as EventSource[], error: null }),
    candidateIds.length ? batch<AuditSource>(candidateIds, (ids) => supabase.from('master_data_audit').select('id,candidate_id,created_at').in('candidate_id', ids).order('created_at', { ascending: false })) : Promise.resolve({ data: [] as AuditSource[], error: null }),
  ])
  const historyError = events.error ?? audits.error
  if (historyError) return { data: fallback, error: historyError }

  const flowByMessage = new Map(flows.data.map((row) => [row.source_message_id, row]))
  const messageById = new Map(messages.data.map((row) => [row.id, row]))
  const attachmentByMessage = new Map(attachments.data.map((row) => [row.message_id, row]))
  const eventByItem = new Map<string, EventSource>()
  events.data.forEach((row) => { if (!eventByItem.has(row.item_id)) eventByItem.set(row.item_id, row) })
  const auditByCandidate = new Map<string, AuditSource>()
  audits.data.forEach((row) => { if (!auditByCandidate.has(row.candidate_id)) auditByCandidate.set(row.candidate_id, row) })

  const resolved = Object.fromEntries(candidates.map((candidate) => {
    const transaction = candidate.source_table === 'financial_transactions' && candidate.source_id ? transactionById.get(candidate.source_id) : null
    const messageId = transaction?.source_message_id ?? (candidate.source_table === 'line_messages' ? candidate.source_id : null) ?? fallback[candidate.id].messageId
    const flow = messageId ? flowByMessage.get(messageId) : null
    const message = messageId ? messageById.get(messageId) : null
    const attachment = messageId ? attachmentByMessage.get(messageId) : null
    const event = flow ? eventByItem.get(flow.id) : null
    const audit = auditByCandidate.get(candidate.id)
    return [candidate.id, resolveCandidateSourceEvidence(candidate, { transaction, flow, message, attachment, event, audit })]
  }))
  return { data: resolved, error: null }
}
