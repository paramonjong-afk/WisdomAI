import type { Session, User } from '@supabase/supabase-js'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { AuthContextValue, CompanyMembership, Profile, ProfileRole } from '../types/auth'
import { AuthContext } from './auth-context'
import { runWithMutationAttempt } from '../utils/mutationAttemptRunner'

function profileFromUser(user: User): Profile {
  const metadataName = user.user_metadata.full_name
  return {
    id: user.id,
    full_name: typeof metadataName === 'string' ? metadataName : null,
    email: user.email ?? null,
    role: 'employee',
  }
}

async function loadOrCreateProfile(user: User): Promise<Profile> {
  const { data: rpcRows, error } = await supabase.rpc('get_my_profile')
  const data = Array.isArray(rpcRows) && rpcRows.length > 0
    ? rpcRows[0] as Profile
    : null

  if (error) throw error
  if (data) return data

  const created = await runWithMutationAttempt<{ email: string | null | undefined }, { data?: Profile; error?: unknown }>({
    module: 'auth',
    action: 'create_profile',
    actorProfileId: null,
    companyId: null,
    request: { email: user.email ?? null },
    operation: async () => await supabase
      .from('profiles')
      .insert(profileFromUser(user))
      .select('id, full_name, email, role, created_at, updated_at')
      .single<Profile>(),
    errorCode: 'PROFILE_CREATE_FAILED',
    errorAction: 'ติดต่อแอดมินเพื่อจัดการบัญชีผู้ใช้และตรวจสิทธิ์',
  })

  if (!created?.data) throw new Error('ไม่สามารถสร้างโปรไฟล์ได้')
  return created.data
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [companies, setCompanies] = useState<CompanyMembership[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const syncProfile = useCallback(async (currentSession: Session | null) => {
    setSession(currentSession)
    setError(null)

    if (!currentSession?.user) {
      setProfile(null)
      setCompanies([])
      return
    }

    try {
      const loadedProfile=await loadOrCreateProfile(currentSession.user)
      const {data:companyRows,error:companyError}=await supabase.rpc('get_my_companies')
      if(companyError) throw companyError
      const memberships=(companyRows??[]) as CompanyMembership[]
      const companyRole=memberships.find(item=>item.is_active)?.company_role
      const effectiveRole:ProfileRole=companyRole==='company_admin' ? 'admin'
        : companyRole && ['executive','manager','site_supervisor','accounting_hr'].includes(companyRole) ? 'manager'
          : 'employee'
      setCompanies(memberships)
      setProfile({...loadedProfile,role:effectiveRole,platform_role:loadedProfile.role})
    } catch (profileError) {
      console.error('Unable to load user profile; using session fallback', profileError)
      setProfile(profileFromUser(currentSession.user))
      setError(null)
    }
  }, [])

  useEffect(() => {
    let active = true

    void supabase.auth.getSession().then(async ({ data, error: sessionError }) => {
      if (!active) return
      if (sessionError) setError(sessionError.message)
      else await syncProfile(data.session)
      if (active) setLoading(false)
    })

    const { data: authListener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return
      // A background token refresh must not replace the whole application with
      // AuthLoadingScreen. The user and permissions have not changed here.
      if (event === 'TOKEN_REFRESHED') {
        setSession(nextSession)
        return
      }
      setLoading(true)
      window.setTimeout(() => {
        if (!active) return
        void syncProfile(nextSession).finally(() => {
          if (active) setLoading(false)
        })
      }, 0)
    })

    return () => {
      active = false
      authListener.subscription.unsubscribe()
    }
  }, [syncProfile])

  const refreshProfile = useCallback(async () => {
    if (session) await syncProfile(session)
  }, [session, syncProfile])

  const signOut = useCallback(async () => {
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) throw signOutError
  }, [])

  const switchCompany = useCallback(async (companyId:string) => {
    await runWithMutationAttempt({
      module: 'auth',
      action: 'switch_company',
      actorProfileId: profile?.id,
      companyId,
      request: { targetCompanyId: companyId },
      operation: async () => await supabase.rpc('switch_company',{target_company_id:companyId}),
      errorCode: 'COMPANY_SWITCH_FAILED',
      errorAction: 'รีเฟรชหน้าแล้วลองสลับบริษัทใหม่ หรือแจ้ง IT ตรวจสิทธิ์',
    })
    window.location.reload()
  },[profile?.id])

  const currentCompany=companies.find(item=>item.is_active)??companies[0]??null

  const value = useMemo<AuthContextValue>(
    () => ({ session, user: session?.user ?? null, profile, companies, currentCompany, loading, error, signOut, refreshProfile, switchCompany }),
    [companies, currentCompany, error, loading, profile, refreshProfile, session, signOut, switchCompany],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
