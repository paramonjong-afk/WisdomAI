import type { Session, User } from '@supabase/supabase-js'

export type ProfileRole = 'admin' | 'manager' | 'employee'

export interface Profile {
  id: string
  full_name: string | null
  email: string | null
  role: ProfileRole
  created_at?: string
  updated_at?: string
}

export interface AuthContextValue {
  session: Session | null
  user: User | null
  profile: Profile | null
  loading: boolean
  error: string | null
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}
