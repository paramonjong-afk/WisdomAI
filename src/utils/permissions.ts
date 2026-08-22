import type { CompanyMembership, Profile } from '../types/auth'

/** Canonical frontend permission resolver. `role` is the DB source of truth. */
export function isPlatformAdmin(profile: Pick<Profile, 'role' | 'platform_role'> | null | undefined): boolean {
  return profile?.role === 'admin' || profile?.platform_role === 'admin'
}

export function isCompanyAdmin(profile: Pick<Profile, 'role' | 'platform_role'> | null | undefined, company: Pick<CompanyMembership, 'company_role'> | null | undefined): boolean {
  return isPlatformAdmin(profile) || company?.company_role === 'company_admin'
}

export function canManageCompany(profile: Pick<Profile, 'role' | 'platform_role'> | null | undefined, company: Pick<CompanyMembership, 'company_role'> | null | undefined): boolean {
  return isPlatformAdmin(profile) || ['company_admin', 'executive', 'manager', 'site_supervisor'].includes(company?.company_role ?? '')
}
