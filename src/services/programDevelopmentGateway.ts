import { supabase } from '../lib/supabase'

export type ProgramDevelopmentRoom = {
  id: string
  name: string
  company_id: string
  room_key: 'program_development_primary'
  is_private: boolean
  room_purpose: 'program_development'
  created_by: string | null
}

/** Idempotently provisions the owner-only development room through the DB RPC. */
export async function ensureProgramDevelopmentRoom(companyId: string) {
  const { data, error } = await supabase.rpc('ensure_standard_program_development_room', {
    target_company_id: companyId,
  })
  if (error) throw error
  return data as ProgramDevelopmentRoom | null
}
