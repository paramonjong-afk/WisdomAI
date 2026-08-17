import type { Session, User } from '@supabase/supabase-js'

export type ProfileRole = 'admin' | 'manager' | 'employee'

export interface Profile {
  id: string
  full_name: string | null
  email: string | null
  role: ProfileRole
  platform_role?: ProfileRole
  created_at?: string
  updated_at?: string
}

export type CompanyRole = 'company_admin' | 'executive' | 'manager' | 'site_supervisor' | 'accounting_hr' | 'employee'

export interface CompanyMembership {
  company_id: string
  company_name: string
  company_slug: string
  company_role: CompanyRole
  is_active: boolean
}

export interface AuthContextValue {
  session: Session | null
  user: User | null
  profile: Profile | null
  companies: CompanyMembership[]
  currentCompany: CompanyMembership | null
  loading: boolean
  error: string | null
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  switchCompany: (companyId: string) => Promise<void>
}
