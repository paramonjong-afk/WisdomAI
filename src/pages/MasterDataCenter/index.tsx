import { ArchiveOutlined, CheckOutlined, CloseOutlined, RefreshOutlined } from '@mui/icons-material'
import { Alert, Button, Chip, Paper, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
import { userError } from '../../utils/userError'

type Candidate = { id: string; entity_type: string; display_name: string; candidate_data: { bank_name?: string | null; account_last4?: string | null; bank_reference?: string | null }; confidence: number | null; status: string; created_at: string; archive_after: string }
type BankAccount = { id: string; owner_name: string; owner_type: string; bank_name: string | null; account_last4: string; verification_status: string; verified_at: string | null; created_at: string }

const candidateStatus: Record<string, string> = { pending_review: 'รอตรวจ', approved: 'ยืนยันแล้ว', rejected: 'ไม่ใช้', archived: 'เก็บถาวร' }
const accountStatus: Record<string, string> = { verified: 'ยืนยันแล้ว', unverified: 'รอตรวจ', inactive: 'ปิดใช้งาน', archived: 'เก็บถาวร' }
const entityLabel: Record<string, string> = { employee: 'พนักงาน', vendor: 'ผู้ขาย', customer: 'ลูกค้า', project: 'โครงการ', work_package: 'งานย่อย', bank_account: 'บัญชีธนาคาร' }
const dateTime = (value: string | null) => value ? new Date(value).toLocaleString('th-TH') : '-'

export function MasterDataCenterPage() {
  usePageTitle('ศูนย์ข้อมูลกลาง')
  const { currentCompany } = useAuth()
  const companyId = currentCompany?.company_id ?? ''
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [error, setError] = useState('')
  const [savingId, setSavingId] = useState('')
  const [currentTime, setCurrentTime] = useState(0)

  const load = useCallback(async () => {
    if (!companyId) return
    const [candidateResult, accountResult] = await Promise.all([
      supabase.from('master_data_candidates').select('id,entity_type,display_name,candidate_data,confidence,status,created_at,archive_after').eq('company_id', companyId).order('created_at', { ascending: false }).limit(500),
      supabase.from('master_bank_accounts').select('id,owner_name,owner_type,bank_name,account_last4,verification_status,verified_at,created_at').eq('company_id', companyId).neq('verification_status', 'archived').order('updated_at', { ascending: false }).limit(500),
    ])
    const loadError = candidateResult.error ?? accountResult.error
    if (loadError) { setError(userError(loadError)); return }
    setCandidates((candidateResult.data ?? []) as Candidate[])
    setAccounts((accountResult.data ?? []) as BankAccount[])
    setCurrentTime(new Date().getTime())
    setError('')
  }, [companyId])

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer) }, [load])
  const review = async (candidate: Candidate, action: 'approve' | 'reject' | 'archive') => {
    setSavingId(candidate.id); setError('')
    const { error: rpcError } = await supabase.rpc('review_master_data_candidate', { target_candidate_id: candidate.id, target_event_key: crypto.randomUUID(), target_action: action, target_reason: null })
    setSavingId('')
    if (rpcError) { setError(userError(rpcError)); return }
    await load()
  }
  const pending = candidates.filter((item) => item.status === 'pending_review').length
  const due = candidates.filter((item) => item.status === 'pending_review' && new Date(item.archive_after).getTime() <= currentTime).length

  return <Stack spacing={2}>
    <PageHeader title="ศูนย์ข้อมูลกลาง" description="ข้อมูลจากสลิปและเอกสารจะเข้ารอตรวจ ก่อนยืนยันเป็นข้อมูลใช้ร่วมกันทุก Module · ไม่มีการลบข้อมูลที่มีการอ้างอิง" action={<Button startIcon={<RefreshOutlined />} onClick={() => void load()}>รีเฟรช</Button>} />
    {error && <Alert severity="error">{error}</Alert>}
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}><Metric label="ข้อมูลรอตรวจ" value={`${pending} รายการ`} /><Metric label="ครบกำหนด Archive" value={`${due} รายการ`} /><Metric label="บัญชีที่ยืนยันแล้ว" value={`${accounts.filter((item) => item.verification_status === 'verified').length} บัญชี`} /></Stack>
    <Paper variant="outlined" sx={{ p: 1.5 }}><Typography variant="body2">การอนุมัติบัญชีจะเก็บเพียงธนาคารและเลขท้ายบัญชีจากหลักฐานต้นทาง ไม่แสดงเลขบัญชีเต็มในตาราง ระบบไม่เขียนทับข้อมูลที่เคยยืนยันแล้วโดยอัตโนมัติ</Typography></Paper>
    <Typography variant="h6">กล่องข้อมูลรอตรวจ</Typography>
    <StandardDataTable rows={candidates} getRowId={(row) => row.id} getSearchText={(row) => `${row.display_name} ${entityLabel[row.entity_type] ?? row.entity_type} ${row.candidate_data.bank_name ?? ''} ${row.candidate_data.account_last4 ?? ''}`} searchLabel="ค้นหาชื่อ ธนาคาร หรือเลขท้ายบัญชี" emptyText="ยังไม่มีข้อมูลรอตรวจ" minWidth={1080} columns={[
      { id: 'type', label: 'ประเภท', minWidth: 130, render: (row) => entityLabel[row.entity_type] ?? row.entity_type },
      { id: 'name', label: 'ชื่อที่ตรวจพบ', minWidth: 240, render: (row) => row.display_name },
      { id: 'bank', label: 'ข้อมูลบัญชีจากหลักฐาน', minWidth: 230, render: (row) => row.entity_type === 'bank_account' ? `${row.candidate_data.bank_name ?? 'ไม่ระบุธนาคาร'} · •••• ${row.candidate_data.account_last4 ?? '-'}` : '-' },
      { id: 'confidence', label: 'ความมั่นใจ AI', minWidth: 130, render: (row) => row.confidence == null ? '-' : `${Math.round(row.confidence * 100)}%` },
      { id: 'created', label: 'พบเมื่อ', minWidth: 170, render: (row) => dateTime(row.created_at) },
      { id: 'status', label: 'สถานะ', minWidth: 130, render: (row) => <Chip size="small" color={row.status === 'approved' ? 'success' : row.status === 'rejected' ? 'error' : row.status === 'archived' ? 'default' : 'warning'} label={candidateStatus[row.status] ?? row.status} /> },
      { id: 'actions', label: 'จัดการ', minWidth: 270, render: (row) => row.status === 'pending_review' ? <Stack direction="row" spacing={0.5}><Button size="small" startIcon={<CheckOutlined />} disabled={savingId === row.id} variant="contained" onClick={() => void review(row, 'approve')}>ยืนยัน</Button><Button size="small" startIcon={<CloseOutlined />} disabled={savingId === row.id} onClick={() => void review(row, 'reject')}>ไม่ใช้</Button><Button size="small" startIcon={<ArchiveOutlined />} disabled={savingId === row.id} onClick={() => void review(row, 'archive')}>Archive</Button></Stack> : '-' },
    ]} />
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
