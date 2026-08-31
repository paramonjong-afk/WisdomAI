import { supabase } from '../lib/supabase'

export type EmployeePrivateChatRoom = {
  id: string
  name: string
  company_id: string
  employee_profile_id: string
  is_private: true
  room_purpose: 'employee_private'
  created_by: string | null
}

/** Ensures the signed-in employee's private room exists without creating duplicates. */
export async function ensureEmployeePrivateChatRoom(companyId: string, profileId: string) {
  const { data, error } = await supabase.rpc('ensure_employee_private_chat_room', {
    target_company_id: companyId,
    target_profile_id: profileId,
  })
  if (error) throw error
  return data as EmployeePrivateChatRoom | null
}
