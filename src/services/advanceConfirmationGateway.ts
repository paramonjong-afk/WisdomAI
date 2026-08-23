import { supabase } from '../lib/supabase'

export type AdvanceConfirmationDelivery = {
  id: string; advance_case_id: string; document_id: string | null; message_kind: 'advance_confirm'
  channel: 'web_chat' | 'system' | 'line' | 'telegram'; room_id: string | null
  recipient_profile_id: string | null; recipient_kind: 'finance_primary' | 'hr_primary' | 'hr_copied' | 'source_room'
  recipient_scope: string[]; message_text: string; message_class: 'system_confirmation'; is_system: boolean
  status: 'queued' | 'sent' | 'delivered' | 'failed' | 'pending_room_setup' | 'room_setup_failed'; retry_count: number; attempts: number
  last_error: string | null; sent_at: string | null; delivered_at: string | null; event_key: string; delivery_key: string
}

export async function queueAdvanceConfirmation(advanceCaseId: string) {
  const { data, error } = await supabase.rpc('queue_employee_advance_confirmation', { target_advance_case_id: advanceCaseId })
  if (error) throw error
  return data as AdvanceConfirmationDelivery
}

export async function retryAdvanceConfirmations(maxRows = 50) {
  const { data, error } = await supabase.rpc('retry_employee_advance_confirmations', { max_rows: maxRows })
  if (error) throw error
  return Number(data ?? 0)
}
