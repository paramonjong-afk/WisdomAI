import { supabase } from '../lib/supabase'

export type GeneralWorkRoom = {
  id: string
  name: '01 | งานทั่วไป'
  company_id: string
  room_key: 'general_work_primary'
  is_private: false
  room_purpose: 'general_work'
  created_by: string | null
}

export async function ensureGeneralWorkRoom(companyId: string) {
  const { data, error } = await supabase.rpc('ensure_standard_general_work_room', { target_company_id: companyId })
  if (error) throw error
  return data as GeneralWorkRoom | null
}
