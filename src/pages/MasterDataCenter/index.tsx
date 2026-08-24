import { ArchiveOutlined, CheckOutlined, CompareArrowsOutlined, OpenInNewOutlined, RefreshOutlined } from '@mui/icons-material'
import { Alert, Button, Chip, DialogActions, DialogContent, DialogTitle, Divider, Drawer, MenuItem, Paper, Select, Stack, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
import { documentFlowGateway } from '../../services/documentFlowGateway'
import { emptyMasterSourceEvidence, loadMasterSourceEvidence } from '../../services/masterDataSourceGateway'
import { userError } from '../../utils/userError'
import { candidateAccount, groupDuplicateCandidates, isNameMismatch, mismatchStage, reviewFilterMatches, type MasterCandidate, type MasterReviewFilter, type MasterSourceEvidence } from './masterDataReview'

type Candidate = MasterCandidate & { archive_after: string }
type BankAccount = { id: string; owner_name: string; owner_type: string; bank_name: string | null; account_last4: string; verification_status: string; verified_at: string | null; created_at: string }

const candidateStatus: Record<string, string> = { provisional: 'ข้อมูลเบื้องต้น', needs_review: 'ต้องตรวจ', confirmed: 'ยืนยันแล้ว', locked: 'ล็อกแล้ว', pending_review: 'รอตรวจ', approved: 'ยืนยันแล้ว', rejected: 'ปฏิเสธ', archived: 'เก็บถาวร', needs_more_info: 'ขอข้อมูลเพิ่ม' }
const accountStatus: Record<string, string> = { verified: 'ยืนยันแล้ว', unverified: 'รอตรวจ', inactive: 'ปิดใช้งาน', archived: 'เก็บถาวร' }
const entityLabel: Record<string, string> = { employee: 'พนักงาน', vendor: 'ผู้ขาย', customer: 'ลูกค้า', project: 'โครงการ', work_package: 'งานย่อย', bank_account: 'บัญชีธนาคาร' }
const dateTime = (value: string | null) => value ? new Date(value).toLocaleString('th-TH') : '-'
const emptyEvidence = emptyMasterSourceEvidence

export function MasterDataCenterPage() {
  usePageTitle('ศูนย์ข้อมูลกลาง')
  const { currentCompany } = useAuth()
  const companyId = currentCompany?.company_id ?? ''
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [evidence, setEvidence] = useState<Record<string, MasterSourceEvidence>>({})
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [error, setError] = useState('')
  const [savingId, setSavingId] = useState('')
  const [filter, setFilter] = useState<MasterReviewFilter>('pending_review')
  const [selected, setSelected] = useState<Candidate | null>(null)
  const [reviewReason, setReviewReason] = useState('')
  const setSourceUrl = (value: string) => { void value }

  const load = useCallback(async () => {
    if (!companyId) return
    const [candidateResult, accountResult] = await Promise.all([
      supabase.from('master_data_candidates').select('id,entity_type,display_name,normalized_name,candidate_data,confidence,status,source_table,source_id,duplicate_of,created_at,archive_after').eq('company_id', companyId).order('created_at', { ascending: false }).limit(500),
      supabase.from('master_bank_accounts').select('id,owner_name,owner_type,bank_name,account_last4,verification_status,verified_at,created_at').eq('company_id', companyId).neq('verification_status', 'archived').order('updated_at', { ascending: false }).limit(500),
    ])
    const loadError = candidateResult.error ?? accountResult.error
    if (loadError) { setError(userError(loadError)); return }
    const rows = (candidateResult.data ?? []) as Candidate[]
    setCandidates(rows)
    setAccounts((accountResult.data ?? []) as BankAccount[])
    const sourceResult = await loadMasterSourceEvidence(rows)
    setEvidence(sourceResult.data)
    setError(sourceResult.error ? `โหลด Source Reference ไม่ครบ: ${userError(sourceResult.error)}` : '')
  }, [companyId])

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer) }, [load])
  const review = async (candidate: Candidate, action: 'approve' | 'reject' | 'archive' | 'keep_existing' | 'match_master' | 'request_info' | 'lock' | 'controlled_correction') => {
    if (['reject', 'keep_existing', 'match_master', 'request_info', 'lock', 'controlled_correction'].includes(action) && reviewReason.trim().length < 3) { setError('กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร'); return }
    setSavingId(candidate.id); setError('')
    const { error: rpcError } = await supabase.rpc('review_master_data_candidate', { target_candidate_id: candidate.id, target_event_key: crypto.randomUUID(), target_action: action, target_reason: reviewReason.trim() || null })
    setSavingId('')
    if (rpcError) { setError(userError(rpcError)); return }
    setReviewReason('')
    setSelected(null)
    await load()
  }
  const openSource = async (candidate: Candidate) => {
    const source = evidence[candidate.id] ?? emptyEvidence()
    if (!source.bucket || !source.path) { setError('ไม่พบไฟล์ต้นฉบับของรายการนี้'); return }
    const signed = await documentFlowGateway.signedPreviewUrl(source.bucket, source.path)
    if (signed.error || !signed.data?.signedUrl) { setError(`เปิดไฟล์ต้นฉบับไม่สำเร็จ: ${userError(signed.error)}`); return }
    window.open(signed.data.signedUrl, '_blank', 'noopener,noreferrer')
  }
  const pending = candidates.filter((item) => ['provisional', 'needs_review', 'pending_review', 'needs_more_info'].includes(item.status)).length
  const duplicateGroups = useMemo(() => groupDuplicateCandidates(candidates), [candidates])
  const duplicateIds = useMemo(() => new Set(duplicateGroups.flatMap((group) => group.candidateIds)), [duplicateGroups])
  const filteredCandidates = useMemo(() => candidates.filter((candidate) => reviewFilterMatches(candidate, evidence[candidate.id] ?? null, duplicateIds, filter)), [candidates, duplicateIds, evidence, filter])
  const summaryRows = useMemo(() => {
    const grouped = new Set<string>()
    return filteredCandidates.filter((candidate) => {
      const group = duplicateGroups.find((item) => item.candidateIds.includes(candidate.id))
      if (!group) return true
      if (grouped.has(group.key)) return false
      grouped.add(group.key)
      return true
    })
  }, [duplicateGroups, filteredCandidates])

  return <Stack spacing={2}>
    <PageHeader title="ศูนย์ข้อมูลกลาง" description="ข้อมูลจากสลิปและเอกสารจะเข้ารอตรวจ ก่อนยืนยันเป็นข้อมูลใช้ร่วมกันทุก Module · ไม่มีการลบข้อมูลที่มีการอ้างอิง" action={<Button startIcon={<RefreshOutlined />} onClick={() => void load()}>รีเฟรช</Button>} />
    {error && <Alert severity="error">{error}</Alert>}
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}><Metric label="ข้อมูลใหม่" value={`${candidates.filter((item) => ['provisional', 'pending_review', 'needs_review'].includes(item.status)).length} รายการ`} /><Metric label="จับคู่ได้" value={`${candidates.filter((item) => ['confirmed', 'approved'].includes(item.status)).length} รายการ`} /><Metric label="ซ้ำ" value={`${duplicateGroups.length} กลุ่ม`} /><Metric label="ชื่อไม่ตรง" value={`${candidates.filter((item) => isNameMismatch(item, evidence[item.id] ?? null)).length} รายการ`} /><Metric label="รอตรวจ" value={`${pending} รายการ`} /><Metric label="ปฏิเสธ" value={`${candidates.filter((item) => item.status === 'rejected').length} รายการ`} /></Stack>
    <Paper variant="outlined" sx={{ p: 1.5 }}><Typography variant="body2">มุมมองนี้สรุปข้อมูลใหม่เป็นกลุ่ม ไม่แสดง OCR ซ้ำเป็นหลายแถว ระบบไม่ auto-merge และการยืนยัน/ปฏิเสธยังบันทึก before/after, actor, เวลา และ source ลง Audit</Typography></Paper>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}><Typography variant="h6" sx={{ flex: 1 }}>ข้อมูลใหม่ที่พบ</Typography><Select size="small" value={filter} onChange={(event) => setFilter(event.target.value as MasterReviewFilter)}><MenuItem value="pending_review">รอตรวจ</MenuItem><MenuItem value="duplicate">ซ้ำ</MenuItem><MenuItem value="name_mismatch">ชื่อไม่ตรง</MenuItem><MenuItem value="account_name_mismatch">บัญชีตรงแต่ชื่อไม่ตรง</MenuItem><MenuItem value="all">ทั้งหมด</MenuItem></Select><Chip label={`${summaryRows.length} กลุ่ม/รายการ`} /></Stack>
    <StandardDataTable rows={summaryRows} getRowId={(row) => row.id} onRowClick={setSelected} getSearchText={(row) => `${row.display_name} ${entityLabel[row.entity_type] ?? row.entity_type} ${candidateAccount(row) ?? ''} ${row.source_id ?? ''}`} searchLabel="ค้นหาชื่อ บัญชี Source ID หรือ Message ID" emptyText="ยังไม่มีข้อมูลตามตัวกรอง" minWidth={1320} columns={[
      { id: 'type', label: 'ประเภท', minWidth: 130, render: (row) => entityLabel[row.entity_type] ?? row.entity_type },
      { id: 'name', label: 'ข้อมูลใหม่ / ชื่อ', minWidth: 240, render: (row) => <Stack spacing={0.25}><Typography variant="body2">{row.display_name}</Typography>{isNameMismatch(row, evidence[row.id] ?? null) && <Chip size="small" color="error" label={`ผิดที่ ${mismatchStage(row, evidence[row.id] ?? null)}`} />}</Stack> },
      { id: 'bank', label: 'บัญชีจากหลักฐาน', minWidth: 230, render: (row) => row.entity_type === 'bank_account' ? `•••• ${candidateAccount(row) ?? '-'}` : '-' },
      { id: 'duplicate', label: 'Duplicate Group', minWidth: 180, render: (row) => { const group = duplicateGroups.find((item) => item.candidateIds.includes(row.id)); return group ? <Chip size="small" color="warning" label={`${group.candidateIds.length} ต้นทาง`} /> : 'ไม่ซ้ำ' } },
      { id: 'source', label: 'Source Reference', minWidth: 300, render: (row) => { const source = evidence[row.id] ?? emptyEvidence(); return <Stack spacing={0.2}><Typography variant="caption">Document/Intake: {source.documentId ?? source.intakeId ?? 'ไม่พบ mapping'}</Typography><Typography variant="caption">Room: {source.sourceRoom ?? 'ไม่พบห้อง'} · Message: {source.messageId ?? 'ไม่พบ Message ID'}</Typography><Typography variant="caption">เข้า: {dateTime(source.receivedAt ?? row.created_at)}</Typography>{!source.sourceResolved && <Chip size="small" color="warning" label="Source ไม่ครบ" />}</Stack> } },
      { id: 'confidence', label: 'ความมั่นใจ AI', minWidth: 130, render: (row) => row.confidence == null ? '-' : `${Math.round(row.confidence * 100)}%` },
      { id: 'created', label: 'พบเมื่อ', minWidth: 170, render: (row) => dateTime(row.created_at) },
      { id: 'status', label: 'สถานะ', minWidth: 150, render: (row) => <Chip size="small" color={['confirmed', 'approved'].includes(row.status) ? 'success' : row.status === 'locked' ? 'primary' : row.status === 'rejected' ? 'error' : row.status === 'archived' ? 'default' : 'warning'} label={candidateStatus[row.status] ?? row.status} /> },
      { id: 'actions', label: 'ตรวจรายละเอียด', minWidth: 170, render: (row) => <Button size="small" startIcon={<CompareArrowsOutlined />} onClick={(event) => { event.stopPropagation(); setSelected(row) }}>เปิด Detail</Button> },
    ]} />
    <Drawer anchor="right" open={Boolean(selected)} onClose={() => { setSelected(null); setSourceUrl(''); setReviewReason('') }} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 680 }, maxWidth: '100vw' } } }}><DialogTitle>ตรวจข้อมูลใหม่ · {selected?.display_name}</DialogTitle><DialogContent dividers>{selected && <Stack spacing={1.25}><Typography variant="body2" color="text.secondary">Candidate ID: {selected.id} · source_table: {selected.source_table ?? '-'} · source_id: {selected.source_id ?? '-'}</Typography><Paper variant="outlined" sx={{ p: 1.25 }}><Typography sx={{ fontWeight: 800 }}>Current Master</Typography><Typography variant="body2">ชื่อ: {(selected.candidate_data.master_name as string | undefined) ?? 'ยังไม่มี Master เดิม'}</Typography><Typography variant="body2">บัญชี: {(selected.candidate_data.master_account_last4 as string | undefined) ?? '-'} · ธนาคาร: {(selected.candidate_data.master_bank_name as string | undefined) ?? '-'}</Typography></Paper><Paper variant="outlined" sx={{ p: 1.25 }}><Typography sx={{ fontWeight: 800 }}>New Evidence</Typography><Typography variant="body2">ค่าจากต้นฉบับ: {(selected.candidate_data.source_name as string | undefined) ?? '-'}</Typography><Typography variant="body2">OCR อ่านได้: {(selected.candidate_data.ocr_name as string | undefined) ?? (selected.candidate_data.recipient_name as string | undefined) ?? selected.display_name}</Typography><Typography variant="body2">บัญชี/ธนาคาร: {candidateAccount(selected) ?? '-'} · {(selected.candidate_data.bank_name as string | undefined) ?? '-'}</Typography><Typography variant="body2">OCR raw text: {(evidence[selected.id] ?? emptyEvidence()).ocrRawText ?? '-'}</Typography><Typography variant="body2">พบเมื่อ: {dateTime((evidence[selected.id] ?? emptyEvidence()).receivedAt)} · confidence: {(evidence[selected.id] ?? emptyEvidence()).aiConfidence == null ? '-' : `${Math.round((evidence[selected.id] ?? emptyEvidence()).aiConfidence! * 100)}%`}</Typography>{(evidence[selected.id] ?? emptyEvidence()).path && <Button size="small" startIcon={<OpenInNewOutlined />} onClick={() => void openSource(selected)}>เปิดรูป/หลักฐานต้นฉบับ</Button>}</Paper><Paper variant="outlined" sx={{ p: 1.25 }}><Typography sx={{ fontWeight: 800 }}>Suggested Change / Compare</Typography><Typography variant="body2">ค่าที่แนะนำ: {selected.display_name} · เหตุผล: {(selected.candidate_data.suggestion_reason as string | undefined) ?? 'ชื่อ/เลขท้ายบัญชีจากข้อมูลใหม่'}</Typography><Typography variant="body2">จุดที่น่าผิดพลาด: {mismatchStage(selected, evidence[selected.id] ?? null)}</Typography><Chip size="small" color={isNameMismatch(selected, evidence[selected.id] ?? null) ? 'error' : 'success'} label={isNameMismatch(selected, evidence[selected.id] ?? null) ? 'ค่าแตกต่าง ต้องตรวจ' : 'ค่าอ่านตรงกับข้อเสนอ'} /></Paper><Paper variant="outlined" sx={{ p: 1.25 }}><Typography sx={{ fontWeight: 800 }}>Source Reference / Evidence history</Typography><Typography variant="body2">Document ID: {(evidence[selected.id] ?? emptyEvidence()).documentId ?? '-'} · Intake ID: {(evidence[selected.id] ?? emptyEvidence()).intakeId ?? '-'}</Typography><Typography variant="body2">Room/Channel: {(evidence[selected.id] ?? emptyEvidence()).sourceRoom ?? '-'} / {(evidence[selected.id] ?? emptyEvidence()).sourceChannel ?? '-'} · Message ID: {(evidence[selected.id] ?? emptyEvidence()).messageId ?? '-'}</Typography><Typography variant="body2">Attachment: {(evidence[selected.id] ?? emptyEvidence()).fileName ?? (evidence[selected.id] ?? emptyEvidence()).attachmentId ?? '-'} · Audit: {(evidence[selected.id] ?? emptyEvidence()).auditId ?? '-'}</Typography><Typography variant="body2">กลุ่มนี้พบ {duplicateGroups.find((group) => group.candidateIds.includes(selected.id))?.candidateIds.length ?? 1} source · ล่าสุด {dateTime((evidence[selected.id] ?? emptyEvidence()).receivedAt)}</Typography></Paper><TextField multiline minRows={2} label="เหตุผล (บังคับสำหรับคงเดิม/จับคู่/ขอข้อมูลเพิ่ม/ปฏิเสธ)" value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} /><Divider /><Typography variant="body2">สถานะข้อเสนอ: {candidateStatus[selected.status] ?? selected.status}. ทุก action ส่งเข้า RPC เพื่อ append old/new, actor, time, source และ decision; ไม่มี auto-update จาก evidence ใหม่</Typography></Stack>}</DialogContent><DialogActions sx={{ flexWrap: 'wrap', gap: 0.5 }}><Button disabled={!selected || savingId === selected.id} variant="contained" startIcon={<CheckOutlined />} onClick={() => selected && void review(selected, 'approve')}>ยืนยันข้อเสนอ</Button><Button disabled={!selected || savingId === selected.id || reviewReason.trim().length < 3} onClick={() => selected && void review(selected, 'keep_existing')}>คงข้อมูลเดิม</Button><Button disabled={!selected || savingId === selected.id || reviewReason.trim().length < 3} onClick={() => selected && void review(selected, 'match_master')}>จับคู่ Master เดิม</Button><Button disabled={!selected || savingId === selected.id || reviewReason.trim().length < 3} color="warning" onClick={() => selected && void review(selected, 'request_info')}>ขอข้อมูลเพิ่ม</Button><Button disabled={!selected || savingId === selected.id || reviewReason.trim().length < 3} color="error" onClick={() => selected && void review(selected, 'reject')}>ปฏิเสธ</Button><Button disabled={!selected || savingId === selected.id} onClick={() => selected && void review(selected, 'archive')} startIcon={<ArchiveOutlined />}>Archive</Button><Button onClick={() => { setSelected(null); setSourceUrl(''); setReviewReason('') }}>ปิด</Button></DialogActions></Drawer>
    <Drawer anchor="bottom" open={Boolean(selected)} onClose={() => undefined}><Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.75} sx={{ p: 1.25, justifyContent: 'flex-end' }}><Typography variant="caption" sx={{ alignSelf: 'center', mr: 'auto' }}>Version / controlled correction ต้องมีเหตุผลและจะ append Audit</Typography><Button disabled={!selected || savingId === selected.id || reviewReason.trim().length < 3} color="primary" onClick={() => selected && void review(selected, 'lock')}>ปิดการตรวจสอบ</Button><Button disabled={!selected || savingId === selected.id || reviewReason.trim().length < 3} onClick={() => selected && void review(selected, 'controlled_correction')}>เปิดแก้ไขแบบควบคุม</Button></Stack></Drawer>
    <Typography variant="h6">บัญชีที่ยืนยันแล้ว</Typography>
    <StandardDataTable rows={accounts} getRowId={(row) => row.id} getSearchText={(row) => `${row.owner_name} ${row.bank_name ?? ''} ${row.account_last4}`} searchLabel="ค้นหาชื่อ ธนาคาร หรือเลขท้ายบัญชี" emptyText="ยังไม่มีบัญชีที่ยืนยัน" minWidth={760} columns={[
      { id: 'owner', label: 'เจ้าของบัญชี', minWidth: 240, render: (row) => row.owner_name },
      { id: 'type', label: 'ประเภทเจ้าของ', minWidth: 140, render: (row) => entityLabel[row.owner_type] ?? row.owner_type },
      { id: 'account', label: 'ธนาคาร / บัญชี', minWidth: 220, render: (row) => `${row.bank_name ?? 'ไม่ระบุธนาคาร'} · •••• ${row.account_last4}` },
      { id: 'state', label: 'สถานะ', minWidth: 140, render: (row) => <Chip size="small" color={row.verification_status === 'verified' ? 'success' : 'default'} label={accountStatus[row.verification_status] ?? row.verification_status} /> },
      { id: 'verified', label: 'ยืนยันเมื่อ', minWidth: 180, render: (row) => dateTime(row.verified_at) },
    ]} />
  </Stack>
}

function Metric({ label, value }: { label: string; value: string }) { return <Paper variant="outlined" sx={{ p: 1.5, flex: 1 }}><Typography variant="caption">{label}</Typography><Typography variant="h6">{value}</Typography></Paper> }
