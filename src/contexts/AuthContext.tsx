import type { Session, User } from '@supabase/supabase-js'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { AuthContextValue, Profile } from '../types/auth'
import { AuthContext } from './auth-context'

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
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, created_at, updated_at')
    .eq('id', user.id)
    .maybeSingle<Profile>()

  if (error) throw error
  if (data) return data

  const { data: createdProfile, error: createError } = await supabase
    .from('profiles')
    .insert(profileFromUser(user))
    .select('id, full_name, email, role, created_at, updated_at')
    .single<Profile>()

  if (createError) throw createError
  return createdProfile
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const syncProfile = useCallback(async (currentSession: Session | null) => {
    setSession(currentSession)
    setError(null)

    if (!currentSession?.user) {
      setProfile(null)
      return
    }

    try {
      setProfile(await loadOrCreateProfile(currentSession.user))
    } catch (profileError) {
      setProfile(null)
      setError(profileError instanceof Error ? profileError.message : 'Unable to load user profile.')
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

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return
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

  const value = useMemo<AuthContextValue>(
    () => ({ session, user: session?.user ?? null, profile, loading, error, signOut, refreshProfile }),
    [error, loading, profile, refreshProfile, session, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
