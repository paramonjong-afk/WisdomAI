import { supabase } from '../lib/supabase'

export type HrMutation = 'create-employee' | 'manage-employee' | 'manage-employee-account'

/** Central frontend entry point for HR mutations. The caller records the attempt in the central audit log. */
export const invokeHrMutation = async <T>(mutation: HrMutation, body: Record<string, unknown>) =>
  supabase.functions.invoke<T>(mutation, { body })
