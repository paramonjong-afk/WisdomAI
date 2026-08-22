import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined'
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, MenuItem, Paper, Select, Stack, Tab,
  Tabs, Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
import { userError } from '../../utils/userError'
import { runWithMutationAttempt } from '../../utils/mutationAttemptRunner'

type ExpenseType = 'labor' | 'materials_equipment' | 'mixed' | 'advance' | 'unknown'
type ReviewStatus = 'pending' | 'confirmed' | 'duplicate' | 'dismissed'

type FinancialTransaction = {
  id: string
  sender_name: string | null
  sender_bank_name: string | null
  sender_account_last4: string | null
  recipient_name: string | null
  recipient_bank_name: string | null
  recipient_account_last4: string | null
  amount_total: number | null
  labor_amount: number | null
  materials_amount: number | null
  expense_type: ExpenseType
  transfer_at: string | null
  bank_reference: string | null
  duplicate_of: string | null
  review_status: ReviewStatus
  payment_party_confidence: number | null
  created_at: string
  employee_advance_cases: { advance_number: string; status: string }[] | null
  projects: { name: string; code: string | null } | null
  line_messages: {
    line_senders: { display_name: string | null } | null
    line_groups: { display_name: string | null } | null
  } | null
}
type AccountPair = {
  id: string
  financial_transaction_id: string
  sender_name: string | null
  sender_bank_name: string
  sender_account_last4: string
  recipient_name: string | null
  recipient_bank_name: string
  recipient_account_last4: string
  transfer_at: string | null
  bank_reference: string | null
  confidence: number
  registration_status: 'auto_registered' | 'manual_verified' | 'needs_review'
  registered_at: string
}
type AccountPairAudit = {
  id: string
  action: 'auto_registered' | 'marked_needs_review'
  payload: { confidence?: number; source?: string } | null
  created_at: string
}
type AdvanceHolderCandidate = { id: string; name: string; kind: 'profile' | 'person' }

const expenseLabels: Record<ExpenseType, string> = {
  labor: 'ค่าแรงงาน',
  materials_equipment: 'ค่าวัสดุ/อุปกรณ์',
  mixed: 'ค่าแรงและค่าของ',
  advance: 'เงินทดรอง',
  unknown: 'รอตรวจสอบประเภท',
}
const statusLabels: Record<ReviewStatus, string> = {
  pending: 'รอตรวจสอบ',
  confirmed: 'ยืนยันแล้ว',
  duplicate: 'สลิปซ้ำ',
  dismissed: 'ไม่นำมาใช้',
}
const pairStatusLabels: Record<AccountPair['registration_status'], string> = {
  auto_registered: 'รับเข้าอัตโนมัติ', manual_verified: 'ยืนยันโดยผู้ตรวจ', needs_review: 'รอตรวจคู่บัญชี',
}
const pairAuditLabels: Record<AccountPairAudit['action'], string> = {
  auto_registered: 'ระบบรับคู่บัญชีเข้าทะเบียนกลาง',
  marked_needs_review: 'ระบบระบุว่าต้องตรวจคู่บัญชีเพิ่มเติม',
}
const money = (value: number | null) => value == null ? '-' :
  new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(value)
const normalizeName = (value: string | null | undefined) => (value ?? '')
  .toLowerCase()
  .replace(/^(นาย|นาง|นางสาว|บริษัท|บจก\.?|หจก\.?)\s*/i, '')
  .replace(/\s+/g, '')
  .trim()
const nameScore = (source: string | null | undefined, candidate: string) => {
  const sourceName = normalizeName(source)
  const candidateName = normalizeName(candidate)
  if (!sourceName || !candidateName) return 0
  if (sourceName === candidateName) return 100
  if (sourceName.includes(candidateName) || candidateName.includes(sourceName)) return 86
  let common = 0
  for (const char of new Set(sourceName)) if (candidateName.includes(char)) common += 1
  return Math.round((common / Math.max(sourceName.length, candidateName.length)) * 72)
}
const transferFieldState = (row: FinancialTransaction) => {
  const missing = [row.sender_name, row.sender_bank_name, row.sender_account_last4, row.recipient_name, row.recipient_bank_name, row.recipient_account_last4]
    .filter((value) => !value).length
  if (missing > 0) return { label: `ข้อมูลขาด ${missing} จุด`, color: 'warning' as const }
  if (Number(row.payment_party_confidence ?? 0) < 0.9) return { label: 'AI ต้องตรวจเพิ่ม', color: 'warning' as const }
  return { label: 'ข้อมูลครบ', color: 'success' as const }
}

export function FinancialSummaryPage() {
  usePageTitle('สรุปรายการเงิน')
  const { profile, user, currentCompany } = useAuth()
  const navigate = useNavigate()
  const companyId = currentCompany?.company_id ?? ''
  const canManage = profile?.role === 'admin' || profile?.role === 'manager'
  const [rows, setRows] = useState<FinancialTransaction[]>([])
  const [advanceCandidates, setAdvanceCandidates] = useState<AdvanceHolderCandidate[]>([])
  const [pairRows, setPairRows] = useState<AccountPair[]>([])
  const [activeTab, setActiveTab] = useState(0)
  const [selectedPair, setSelectedPair] = useState<AccountPair | null>(null)
  const [pairAudit, setPairAudit] = useState<AccountPairAudit[]>([])
  const [pairDetailLoading, setPairDetailLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [{ data, error: loadError }, { data: pairs, error: pairError }, { data: profileCandidates, error: profileCandidateError }, { data: personCandidates, error: personCandidateError }] = await Promise.all([
      supabase.from('financial_transactions')
      .select(`
        id, sender_name, sender_bank_name, sender_account_last4,
        recipient_name, recipient_bank_name, recipient_account_last4,
        amount_total, labor_amount, materials_amount, payment_party_confidence,
        expense_type, transfer_at, bank_reference, duplicate_of, review_status, created_at,
        projects(name, code),
        line_messages(line_senders(display_name), line_groups(display_name)),
        employee_advance_cases(advance_number,status)
      `)
      .order('created_at', { ascending: false })
      .limit(1000),
      companyId
        ? supabase.from('financial_transaction_account_pairs').select('id,financial_transaction_id,sender_name,sender_bank_name,sender_account_last4,recipient_name,recipient_bank_name,recipient_account_last4,transfer_at,bank_reference,confidence,registration_status,registered_at').eq('company_id', companyId).order('registered_at', { ascending: false }).limit(1000)
        : Promise.resolve({ data: [], error: null }),
      companyId
        ? supabase.from('employee_employment_records').select('profile_id,profiles!employee_employment_records_profile_id_fkey(full_name)').eq('company_id', companyId).eq('employment_type', 'monthly').in('employment_status', ['active', 'probation', 'notice'])
        : Promise.resolve({ data: [], error: null }),
      companyId
        ? supabase.from('employee_people').select('id,full_name').eq('company_id', companyId).eq('employment_type', 'monthly').eq('employee_status', 'active')
        : Promise.resolve({ data: [], error: null }),
    ])
    if (loadError || pairError || profileCandidateError || personCandidateError) setError(userError(loadError ?? pairError ?? profileCandidateError ?? personCandidateError))
    else {
      setRows((data ?? []) as unknown as FinancialTransaction[])
      setPairRows((pairs ?? []) as AccountPair[])
      setAdvanceCandidates([
        ...((profileCandidates ?? []) as unknown as { profile_id: string; profiles: { full_name: string | null } | null }[]).map((item) => ({ id: item.profile_id, name: item.profiles?.full_name ?? item.profile_id, kind: 'profile' as const })),
        ...((personCandidates ?? []) as { id: string; full_name: string | null }[]).map((item) => ({ id: item.id, name: item.full_name ?? item.id, kind: 'person' as const })),
      ])
    }
    setLoading(false)
  }, [companyId])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0)
    return () => window.clearTimeout(timer)
  }, [loadData])

  const visibleRows = useMemo(
    () => rows.filter((row) => !statusFilter || row.review_status === statusFilter),
    [rows, statusFilter],
  )
  const confirmed = rows.filter((row) => row.review_status === 'confirmed')
  const total = confirmed.reduce((sum, row) => sum + (row.amount_total ?? 0), 0)
  const labor = confirmed.reduce((sum, row) => sum + (row.labor_amount ?? 0), 0)
  const materials = confirmed.reduce((sum, row) => sum + (row.materials_amount ?? 0), 0)
  const pending = rows.filter((row) => row.review_status === 'pending')
    .reduce((sum, row) => sum + (row.amount_total ?? 0), 0)
  const duplicateCount = rows.filter((row) => row.review_status === 'duplicate').length

  const review = async (id: string, reviewStatus: 'confirmed' | 'dismissed') => {
    if (!user || !canManage) return
    setError(null)
    try {
      await runWithMutationAttempt({
        module: 'FinancialSummary',
        action: `เปลี่ยนสถานะสลิปเป็น ${reviewStatus === 'confirmed' ? 'ยืนยัน' : 'ไม่นำมาใช้'}`,
        actorProfileId: user.id,
        companyId: null,
        request: { transaction_id: id, review_status: reviewStatus },
        operation: async () => await supabase.from('financial_transactions').update({
          review_status: reviewStatus,
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', id).eq('review_status', 'pending'),
      })
      setRows((current) => current.map((row) =>
        row.id === id ? { ...row, review_status: reviewStatus } : row)
      )
    } catch (error) {
      setError(error instanceof Error ? error.message : userError(error))
    }
  }

  const suggestedAdvanceHolders = (row: FinancialTransaction) => advanceCandidates
    .map((candidate) => ({ ...candidate, score: nameScore(row.recipient_name, candidate.name) }))
    .filter((candidate) => candidate.score >= 45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)

  const createAdvance = async (id: string, holder?: AdvanceHolderCandidate) => {
    if (!user || !canManage) return
    setError(null)
    const { error: rpcError } = holder
      ? await supabase.rpc('create_employee_advance_from_transaction_with_holder', {
        target_transaction_id: id,
        target_event_key: crypto.randomUUID(),
        target_holder_profile_id: holder.kind === 'profile' ? holder.id : null,
        target_holder_person_id: holder.kind === 'person' ? holder.id : null,
        target_purpose_note: `Admin ยืนยันจากรายชื่อแนะนำ: ${holder.name}`,
      })
      : await supabase.rpc('create_employee_advance_from_transaction', {
        target_transaction_id: id, target_event_key: crypto.randomUUID(), target_purpose_note: null,
      })
    if (rpcError) { setError(`สร้างเงินทดรองไม่สำเร็จ: ${userError(rpcError)}`); return }
    navigate('/advance-settlements')
  }

  const openPairDetail = async (pair: AccountPair) => {
    setSelectedPair(pair)
    setPairAudit([])
    setPairDetailLoading(true)
    const { data, error: auditError } = await supabase
      .from('financial_transaction_account_pair_audit')
      .select('id,action,payload,created_at')
      .eq('financial_transaction_id', pair.financial_transaction_id)
      .order('created_at', { ascending: true })
    if (auditError) setError(`โหลด Timeline คู่บัญชีไม่สำเร็จ: ${userError(auditError)}`)
    else setPairAudit((data ?? []) as AccountPairAudit[])
    setPairDetailLoading(false)
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title="สรุปรายการเงินจาก LINE"
        description="แยกค่าแรง ค่าวัสดุ/อุปกรณ์ เงินทดรอง และตรวจสลิปซ้ำข้ามกลุ่ม"
        action={<Stack direction="row" spacing={1}><Button onClick={() => navigate('/advance-holders')}>ทะเบียนผู้ถือเงิน</Button><Button onClick={() => navigate('/advance-settlements')}>เงินทดรอง/ปิดยอด</Button><Button startIcon={<RefreshOutlinedIcon />} onClick={() => void loadData()}>รีเฟรช</Button></Stack>}
      />
      {error && <Alert severity="error">ไม่สามารถโหลดหรือบันทึกข้อมูลได้: {error}</Alert>}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', lg: 'repeat(6, 1fr)' }, gap: 2 }}>
        {[
          ['ยอดยืนยันแล้ว', money(total), 'success'],
          ['ค่าแรงงาน', money(labor), 'primary'],
          ['ค่าวัสดุ/อุปกรณ์', money(materials), 'info'],
          ['ยอดรอตรวจสอบ', money(pending), 'warning'],
          ['สลิปซ้ำ', `${duplicateCount} รายการ`, 'error'],
          ['คู่บัญชีอัตโนมัติ', `${pairRows.filter((row) => row.registration_status === 'auto_registered').length} คู่`, 'secondary'],
        ].map(([label, value, color]) => (
          <Paper key={label} variant="outlined" sx={{ p: 2, borderTop: 3, borderTopColor: `${color}.main` }}>
            <Typography color="text.secondary" variant="body2">{label}</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{value}</Typography>
          </Paper>
        ))}
      </Box>
      <Paper variant="outlined"><Tabs value={activeTab} onChange={(_, value) => setActiveTab(value)}><Tab label={`รายการสลิป (${visibleRows.length})`} /><Tab label={`คู่บัญชีอัตโนมัติ (${pairRows.length})`} /></Tabs></Paper>
      {loading ? <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}><CircularProgress /></Box> : activeTab === 0 ? (
        <StandardDataTable
          rows={visibleRows}
          getRowId={(row) => row.id}
          getSearchText={(row) => [
            row.sender_name, row.sender_bank_name, row.sender_account_last4,
            row.recipient_name, row.recipient_bank_name, row.recipient_account_last4,
            row.bank_reference, row.projects?.name,
            row.line_messages?.line_senders?.display_name, row.line_messages?.line_groups?.display_name,
            expenseLabels[row.expense_type], statusLabels[row.review_status],
          ].filter(Boolean).join(' ')}
          searchLabel="ค้นหาผู้โอน ผู้รับ ธนาคาร เลขท้ายบัญชี โครงการ หรือกลุ่ม LINE"
          emptyText="ยังไม่พบสลิปโอนเงินจาก LINE"
          exportFileName="wisdomai-financial-transactions"
          minWidth={2290}
          toolbar={<Select size="small" displayEmpty value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} sx={{ minWidth: 170 }}>
            <MenuItem value="">ทุกสถานะ</MenuItem>
            {(Object.entries(statusLabels) as [ReviewStatus, string][]).map(([value, label]) =>
              <MenuItem key={value} value={value}>{label}</MenuItem>)}
          </Select>}
          columns={[
            { id: 'date', label: 'วันเวลาโอน', minWidth: 170, render: (row) => new Date(row.transfer_at ?? row.created_at).toLocaleString('th-TH'), exportValue: (row) => row.transfer_at ?? row.created_at },
            { id: 'senderName', label: 'ผู้โอน', minWidth: 170, render: (row) => row.sender_name ?? 'ไม่พบจากสลิป', exportValue: (row) => row.sender_name },
            { id: 'senderBank', label: 'ธนาคารต้นทาง', minWidth: 160, render: (row) => row.sender_bank_name ?? 'ไม่พบจากสลิป', exportValue: (row) => row.sender_bank_name },
            { id: 'senderAccount', label: 'บัญชีต้นทาง', minWidth: 140, render: (row) => row.sender_account_last4 ? `•••• ${row.sender_account_last4}` : 'ไม่พบจากสลิป', exportValue: (row) => row.sender_account_last4 },
            { id: 'recipient', label: 'ผู้รับ', minWidth: 170, render: (row) => row.recipient_name ?? 'อ่านชื่อไม่ได้', exportValue: (row) => row.recipient_name },
            { id: 'recipientBank', label: 'ธนาคารปลายทาง', minWidth: 160, render: (row) => row.recipient_bank_name ?? 'ไม่พบจากสลิป', exportValue: (row) => row.recipient_bank_name },
            { id: 'recipientAccount', label: 'บัญชีปลายทาง', minWidth: 140, render: (row) => row.recipient_account_last4 ? `•••• ${row.recipient_account_last4}` : 'ไม่พบจากสลิป', exportValue: (row) => row.recipient_account_last4 },
            { id: 'type', label: 'ประเภท', minWidth: 170, render: (row) => <Chip size="small" label={expenseLabels[row.expense_type]} />, exportValue: (row) => expenseLabels[row.expense_type] },
            { id: 'amount', label: 'ยอดโอน', minWidth: 120, align: 'right', render: (row) => money(row.amount_total), exportValue: (row) => row.amount_total },
            { id: 'labor', label: 'ค่าแรง', minWidth: 110, align: 'right', render: (row) => money(row.labor_amount), exportValue: (row) => row.labor_amount },
            { id: 'materials', label: 'ค่าของ', minWidth: 110, align: 'right', render: (row) => money(row.materials_amount), exportValue: (row) => row.materials_amount },
            { id: 'project', label: 'โครงการ', minWidth: 180, render: (row) => row.projects ? `${row.projects.code ? `${row.projects.code} · ` : ''}${row.projects.name}` : 'รอระบุโครงการ', exportValue: (row) => row.projects?.name },
            { id: 'reference', label: 'เลขอ้างอิง', minWidth: 170, render: (row) => row.bank_reference ?? '-', exportValue: (row) => row.bank_reference },
            { id: 'dataState', label: 'ข้อมูลสลิป', minWidth: 150, render: (row) => { const state = transferFieldState(row); return <Chip size="small" color={state.color} label={state.label} /> }, exportValue: (row) => transferFieldState(row).label },
            { id: 'advance', label: 'สำรองจ่าย', minWidth: 170, render: (row) => row.employee_advance_cases?.[0] ? `${row.employee_advance_cases[0].advance_number} · ${row.employee_advance_cases[0].status}` : 'ยังไม่เข้าเกณฑ์อัตโนมัติ', exportValue: (row) => row.employee_advance_cases?.[0]?.advance_number ?? null },
            { id: 'source', label: 'ผู้ส่ง/กลุ่ม LINE', minWidth: 210, render: (row) => `${row.line_messages?.line_senders?.display_name ?? 'ไม่ทราบผู้ส่ง'} · ${row.line_messages?.line_groups?.display_name ?? 'แชตส่วนตัว'}`, exportValue: (row) => `${row.line_messages?.line_senders?.display_name ?? ''} · ${row.line_messages?.line_groups?.display_name ?? ''}` },
            { id: 'status', label: 'สถานะ', minWidth: 130, render: (row) => <Chip size="small" color={row.review_status === 'duplicate' ? 'error' : row.review_status === 'confirmed' ? 'success' : 'default'} label={statusLabels[row.review_status]} />, exportValue: (row) => statusLabels[row.review_status] },
            { id: 'actions', label: 'ตรวจสอบ', minWidth: 360, render: (row) => canManage && row.review_status === 'pending' ? <Stack direction="row" spacing={0.5}><Button size="small" variant="contained" onClick={() => void review(row.id, 'confirmed')}>ยืนยัน</Button><Button size="small" color="inherit" onClick={() => void review(row.id, 'dismissed')}>ไม่นำมาใช้</Button></Stack> : row.duplicate_of ? 'ไม่นับรวมยอด' : canManage && !row.employee_advance_cases?.[0] ? <Stack spacing={0.5}>{suggestedAdvanceHolders(row).length ? <><Typography variant="caption" color="text.secondary">ยืนยันครั้งแรกเพื่อให้ระบบเรียนรู้ชื่อจากสลิป</Typography>{suggestedAdvanceHolders(row).map((candidate) => <Button key={`${candidate.kind}:${candidate.id}`} size="small" variant={candidate.score >= 86 ? 'contained' : 'outlined'} onClick={() => void createAdvance(row.id, candidate)}>ยืนยัน {candidate.name} · {candidate.score}%</Button>)}</> : <Button size="small" onClick={() => void createAdvance(row.id)}>สร้างเงินทดรองจากชื่อตรง</Button>}</Stack> : '-' },
          ]}
        />
      ) : <StandardDataTable
        rows={pairRows}
        onRowClick={(row) => void openPairDetail(row)}
        getRowId={(row) => row.id}
        getSearchText={(row) => [row.sender_name,row.sender_bank_name,row.sender_account_last4,row.recipient_name,row.recipient_bank_name,row.recipient_account_last4,row.bank_reference,pairStatusLabels[row.registration_status]].filter(Boolean).join(' ')}
        searchLabel="ค้นหาผู้โอน ผู้รับ ธนาคาร เลขท้ายบัญชี หรือเลขอ้างอิง"
        emptyText="ยังไม่มีคู่บัญชีสลิปที่ระบบรับเข้าอัตโนมัติ"
        exportFileName="wisdomai-transfer-slip-account-pairs"
        minWidth={1540}
        columns={[
          { id: 'registered', label: 'รับเข้าระบบเมื่อ', minWidth: 170, render: (row) => new Date(row.registered_at).toLocaleString('th-TH'), exportValue: (row) => row.registered_at },
          { id: 'senderName', label: 'ผู้โอน', minWidth: 170, render: (row) => row.sender_name ?? 'ไม่ระบุชื่อ', exportValue: (row) => row.sender_name },
          { id: 'senderBank', label: 'ธนาคารต้นทาง', minWidth: 170, render: (row) => row.sender_bank_name, exportValue: (row) => row.sender_bank_name },
          { id: 'senderAccount', label: 'บัญชีต้นทาง', minWidth: 140, render: (row) => `•••• ${row.sender_account_last4}`, exportValue: (row) => row.sender_account_last4 },
          { id: 'recipientName', label: 'ผู้รับ', minWidth: 170, render: (row) => row.recipient_name ?? 'ไม่ระบุชื่อ', exportValue: (row) => row.recipient_name },
          { id: 'recipientBank', label: 'ธนาคารปลายทาง', minWidth: 170, render: (row) => row.recipient_bank_name, exportValue: (row) => row.recipient_bank_name },
          { id: 'recipientAccount', label: 'บัญชีปลายทาง', minWidth: 140, render: (row) => `•••• ${row.recipient_account_last4}`, exportValue: (row) => row.recipient_account_last4 },
          { id: 'transfer', label: 'เวลาโอน', minWidth: 170, render: (row) => row.transfer_at ? new Date(row.transfer_at).toLocaleString('th-TH') : '-', exportValue: (row) => row.transfer_at },
          { id: 'reference', label: 'เลขอ้างอิง', minWidth: 180, render: (row) => row.bank_reference ?? '-', exportValue: (row) => row.bank_reference },
          { id: 'confidence', label: 'AI', minWidth: 90, align: 'right', render: (row) => `${(Number(row.confidence) * 100).toFixed(0)}%`, exportValue: (row) => row.confidence },
          { id: 'status', label: 'สถานะ', minWidth: 160, render: (row) => <Chip size="small" color={row.registration_status === 'needs_review' ? 'warning' : 'success'} label={pairStatusLabels[row.registration_status]} />, exportValue: (row) => pairStatusLabels[row.registration_status] },
        ]}
      />}
      <Dialog open={Boolean(selectedPair)} onClose={() => setSelectedPair(null)} fullWidth maxWidth="md">
        <DialogTitle>รายละเอียดคู่บัญชีและ Timeline</DialogTitle>
        <DialogContent dividers>
          {selectedPair && <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">เลขบัญชีแสดงเฉพาะ 4 หลักท้ายเพื่อความปลอดภัย</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Paper variant="outlined" sx={{ p: 2, flex: 1, borderTop: 3, borderTopColor: 'primary.main' }}>
                <Typography sx={{ fontWeight: 800 }}>ต้นทาง · ผู้โอน</Typography>
                <Typography>{selectedPair.sender_name ?? 'ไม่ระบุชื่อ'}</Typography>
                <Typography variant="body2" color="text.secondary">{selectedPair.sender_bank_name} · •••• {selectedPair.sender_account_last4}</Typography>
              </Paper>
              <Paper variant="outlined" sx={{ p: 2, flex: 1, borderTop: 3, borderTopColor: 'success.main' }}>
                <Typography sx={{ fontWeight: 800 }}>ปลายทาง · ผู้รับ</Typography>
                <Typography>{selectedPair.recipient_name ?? 'ไม่ระบุชื่อ'}</Typography>
                <Typography variant="body2" color="text.secondary">{selectedPair.recipient_bank_name} · •••• {selectedPair.recipient_account_last4}</Typography>
              </Paper>
            </Stack>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography sx={{ fontWeight: 800 }} gutterBottom>รายละเอียดสลิป</Typography>
              <Typography variant="body2">เวลาโอน: {selectedPair.transfer_at ? new Date(selectedPair.transfer_at).toLocaleString('th-TH') : 'ไม่ระบุ'}</Typography>
              <Typography variant="body2">เลขอ้างอิง: {selectedPair.bank_reference ?? 'ไม่ระบุ'}</Typography>
              <Typography variant="body2">ความมั่นใจ AI: {(Number(selectedPair.confidence) * 100).toFixed(0)}% · {pairStatusLabels[selectedPair.registration_status]}</Typography>
            </Paper>
            <Divider />
            <Typography sx={{ fontWeight: 800 }}>Timeline</Typography>
            {selectedPair.transfer_at && <Paper variant="outlined" sx={{ p: 1.5, borderLeft: 3, borderLeftColor: 'primary.main' }}>
              <Typography sx={{ fontWeight: 700 }}>โอนเงินตามสลิป</Typography>
              <Typography variant="body2" color="text.secondary">{new Date(selectedPair.transfer_at).toLocaleString('th-TH')}</Typography>
            </Paper>}
            {pairDetailLoading ? <CircularProgress size={24} /> : pairAudit.length ? pairAudit.map((event) => <Paper key={event.id} variant="outlined" sx={{ p: 1.5, borderLeft: 3, borderLeftColor: event.action === 'auto_registered' ? 'success.main' : 'warning.main' }}>
              <Typography sx={{ fontWeight: 700 }}>{pairAuditLabels[event.action]}</Typography>
              <Typography variant="body2" color="text.secondary">{new Date(event.created_at).toLocaleString('th-TH')}{event.payload?.confidence != null ? ` · AI ${(Number(event.payload.confidence) * 100).toFixed(0)}%` : ''}</Typography>
            </Paper>) : <Typography variant="body2" color="text.secondary">ยังไม่มีเหตุการณ์ทะเบียนเพิ่มเติม</Typography>}
          </Stack>}
        </DialogContent>
        <DialogActions><Button onClick={() => setSelectedPair(null)}>ปิด</Button></DialogActions>
      </Dialog>
    </Stack>
  )
}

