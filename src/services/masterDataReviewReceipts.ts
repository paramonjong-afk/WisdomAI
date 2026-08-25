import { supabase } from '../lib/supabase'
import type { MasterReviewReceipt } from './masterDataReviewWorkflow'

type ProjectRow = {
  id: string
  source_candidate_id: string
  status: string
  version_no: number
  updated_by: string | null
  updated_at: string
}

type VersionRow = {
  candidate_id: string
  version_no: number
  audit_event_key: string
  created_by: string | null
  created_at: string
  data: Record<string, unknown>
}

type AuditRow = {
  candidate_id: string
  event_key: string
  action: string
  actor_profile_id: string | null
  before_data: Record<string, unknown> | null
  after_data: Record<string, unknown> | null
  created_at: string
}

const empty = (): MasterReviewReceipt => ({ projectCandidate: null, correction: null })

export async function loadMasterDataReviewReceipts(candidateIds: string[]) {
  if (!candidateIds.length) return { data: {} as Record<string, MasterReviewReceipt>, error: null }
  const [projectResult, versionResult, auditResult] = await Promise.all([
    supabase.from('master_data_project_candidates').select('id,source_candidate_id,status,version_no,updated_by,updated_at').in('source_candidate_id', candidateIds).limit(1000),
    supabase.from('master_data_candidate_versions').select('candidate_id,version_no,audit_event_key,created_by,created_at,data').in('candidate_id', candidateIds).order('created_at', { ascending: false }).limit(2000),
    supabase.from('master_data_audit').select('candidate_id,event_key,action,actor_profile_id,before_data,after_data,created_at').in('candidate_id', candidateIds).in('action', ['candidate_admin_corrected', 'candidate_project_save_project_candidate']).order('created_at', { ascending: false }).limit(2000),
  ])
  const error = projectResult.error ?? versionResult.error ?? auditResult.error
  if (error) return { data: {} as Record<string, MasterReviewReceipt>, error }

  const data: Record<string, MasterReviewReceipt> = Object.fromEntries(candidateIds.map((id) => [id, empty()]))
  for (const row of (projectResult.data ?? []) as ProjectRow[]) {
    const receipt = data[row.source_candidate_id] ?? empty()
    receipt.projectCandidate = {
      id: row.id,
      status: row.status,
      version: row.version_no,
      actorId: row.updated_by,
      timestamp: row.updated_at,
      auditEventKey: null,
    }
    data[row.source_candidate_id] = receipt
  }

  const latestCorrectionVersion = new Map<string, VersionRow>()
  for (const row of (versionResult.data ?? []) as VersionRow[]) {
    if (!latestCorrectionVersion.has(row.candidate_id) && row.data?.status === 'admin_reviewed') latestCorrectionVersion.set(row.candidate_id, row)
  }
  const latestProjectAudit = new Map<string, AuditRow>()
  const latestCorrectionAudit = new Map<string, AuditRow>()
  for (const row of (auditResult.data ?? []) as AuditRow[]) {
    if (row.action === 'candidate_admin_corrected' && !latestCorrectionAudit.has(row.candidate_id)) latestCorrectionAudit.set(row.candidate_id, row)
    if (row.action === 'candidate_project_save_project_candidate' && !latestProjectAudit.has(row.candidate_id)) latestProjectAudit.set(row.candidate_id, row)
  }
  for (const candidateId of candidateIds) {
    const receipt = data[candidateId] ?? empty()
    const projectAudit = latestProjectAudit.get(candidateId)
    if (receipt.projectCandidate && projectAudit) receipt.projectCandidate.auditEventKey = projectAudit.event_key
    const correctionAudit = latestCorrectionAudit.get(candidateId)
    const correctionVersion = latestCorrectionVersion.get(candidateId)
    if (correctionAudit || correctionVersion) {
      receipt.correction = {
        version: correctionVersion?.version_no ?? null,
        actorId: correctionAudit?.actor_profile_id ?? correctionVersion?.created_by ?? null,
        timestamp: correctionAudit?.created_at ?? correctionVersion?.created_at ?? null,
        auditEventKey: correctionAudit?.event_key ?? correctionVersion?.audit_event_key ?? null,
        beforeData: correctionAudit?.before_data ?? null,
        afterData: correctionAudit?.after_data ?? null,
      }
    }
    data[candidateId] = receipt
  }
  return { data, error: null }
}
