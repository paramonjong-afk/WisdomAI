import { AddOutlined, FindInPageOutlined, RefreshOutlined } from '@mui/icons-material'
import { Alert, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Paper, Stack, Tab, Tabs, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
import { matchAdvanceHolderSlips, type AdvanceHolderSlipEvidence, type AdvanceHolderSlipMatch } from '../../services/advanceHolderSlipMatch'
import { userError } from '../../utils/userError'

type Holder = {
  id: string
  display_name: string
  is_active: boolean
  employee_advance_holder_aliases: { id: string; alias_name: string }[] | null
}
type Candidate = { id: string; name: string; kind: 'profile' | 'person' }

export function AdvanceHoldersPage() {
  usePageTitle('ทะเบียนผู้ถือเงินสำรอง')
  const navigate = useNavigate()
  const { currentCompany } = useAuth()
  const companyId = currentCompany?.company_id ?? ''
  const [holders, setHolders] = useState<Holder[]>([])
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Holder | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ candidate: '', active: 'true' })
  const [alias, setAlias] = useState('')
  const [tab, setTab] = useState(0)
  const [slipMatches, setSlipMatches] = useState<AdvanceHolderSlipMatch[]>([])
  const [scanning, setScanning] = useState(false)
  const [hasScanned, setHasScanned] = useState(false)

  const load = useCallback(async () => {
    if (!companyId) return
    const [{ data: holderData, error: holderError }, { data: profileData, error: profileError }, { data: personData, error: personError }] = await Promise.all([
      supabase.from('employee_advance_holders').select('id,display_name,is_active,employee_advance_holder_aliases(id,alias_name)').eq('company_id', companyId).order('display_name'),
      supabase.from('employee_employment_records').select('profile_id,profiles!employee_employment_records_profile_id_fkey(full_name)').eq('company_id', companyId).eq('employment_type', 'monthly').in('employment_status', ['active', 'probation', 'notice']),
      supabase.from('employee_people').select('id,full_name').eq('company_id', companyId).eq('employment_type', 'monthly').eq('employee_status', 'active'),
    ])
    if (holderError || profileError || personError) { setError(userError(holderError ?? profileError ?? personError)); return }
    setHolders((holderData ?? []) as unknown as Holder[])
    setCandidates([
      ...((profileData ?? []) as unknown as { profile_id: string; profiles: { full_name: string | null } | null }[]).map((row) => ({ id: row.profile_id, name: row.profiles?.full_name ?? row.profile_id, kind: 'profile' as const })),
      ...((personData ?? []) as { id: string; full_name: string | null }[]).map((row) => ({ id: row.id, name: row.full_name ?? row.id, kind: 'person' as const })),
    ])
    setError('')
  }, [companyId])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const saveHolder = async () => {
    const candidate = candidates.find((item) => `${item.kind}:${item.id}` === form.candidate)
    if (!candidate) { setError('เลือกผู้ถือเงินก่อน'); return }
    setSaving(true); setError('')
    const { error: rpcError } = await supabase.rpc('upsert_employee_advance_holder_simple', {
      target_profile_id: candidate.kind === 'profile' ? candidate.id : null,
      target_person_id: candidate.kind === 'person' ? candidate.id : null,
      target_is_active: form.active === 'true',
      target_event_key: crypto.randomUUID(),
    })
    setSaving(false)
    if (rpcError) { setError(userError(rpcError)); return }
    setOpen(false); setForm({ candidate: '', active: 'true' }); await load()
  }

  const addAlias = async () => {
    if (!selected || alias.trim().length < 2) return
    setSaving(true); setError('')
    const { error: rpcError } = await supabase.rpc('add_employee_advance_holder_alias', { target_holder_id: selected.id, target_alias_name: alias, target_event_key: crypto.randomUUID() })
    setSaving(false)
    if (rpcError) { setError(userError(rpcError)); return }
    setAlias(''); await load()
  }

  const scanSlips = async () => {
    if (!companyId || !holders.length) { setError('ต้องมีผู้ถือเงินที่พร้อมจับคู่ก่อนตรวจหาสลิป'); return }
    setScanning(true); setError('')
    const { data, error: scanError } = await supabase.from('transfer_slip_operational_truth_v1')
      .select('transaction_id,item_id,evidence_sender_name,evidence_recipient_name,evidence_amount,evidence_transfer_at,truth_status,duplicate_of')
      .eq('company_id', companyId)
      .not('transaction_id', 'is', null)
      .order('evidence_transfer_at', { ascending: false, nullsFirst: false })
      .limit(5000)
    setScanning(false)
    if (scanError) { setError(userError(scanError)); return }
    const evidence = (data ?? []).map((row) => ({
      transactionId: row.transaction_id as string,
      itemId: row.item_id,
      senderName: row.evidence_sender_name,
      recipientName: row.evidence_recipient_name,
      amount: row.evidence_amount == null ? null : Number(row.evidence_amount),
      transferAt: row.evidence_transfer_at,
      truthStatus: row.truth_status,
      duplicateOf: row.duplicate_of,
    })) satisfies AdvanceHolderSlipEvidence[]
    setSlipMatches(matchAdvanceHolderSlips(holders.map((holder) => ({
      id: holder.id,
      displayName: holder.display_name,
      aliases: (holder.employee_advance_holder_aliases ?? []).map((item) => item.alias_name),
    })), evidence))
    setHasScanned(true)
    setTab(1)
  }

  const incomingCount = slipMatches.filter((item) => item.direction === 'incoming').length
  const outgoingCount = slipMatches.filter((item) => item.direction === 'outgoing').length
  const ambiguousCount = slipMatches.filter((item) => item.matchStatus === 'ambiguous').length
  const money = (value: number | null) => value == null ? '-' : new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(value)
  const truthLabel = (value: string) => ({ confirmed: 'ยืนยันแล้ว', needs_review: 'รอตรวจ', needs_information: 'รอข้อมูล', duplicate: 'รายการซ้ำ' }[value] ?? value)

  return <Stack spacing={2}>
    <PageHeader title="ทะเบียนผู้ถือเงินสำรองจ่าย" description="เพิ่มเฉพาะชื่อผู้ถือเงิน ระบบจะอ่านข้อมูลบัญชีจากสลิป และเรียนรู้ชื่อภาษาอังกฤษ/ชื่อสะกดต่างกันเมื่อ Admin ยืนยันครั้งแรก" action={<Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}><Button startIcon={<RefreshOutlined />} onClick={() => void load()}>รีเฟรช</Button><Button disabled={scanning || !holders.length} startIcon={scanning ? <CircularProgress size={16} /> : <FindInPageOutlined />} onClick={() => void scanSlips()}>ตรวจหาสลิป รับ/โอนออก</Button><Button variant="contained" startIcon={<AddOutlined />} onClick={() => setOpen(true)}>เพิ่มผู้ถือเงิน</Button></Stack>} />
    {error && <Alert severity="error">{error}</Alert>}
    <Paper variant="outlined"><Tabs value={tab} onChange={(_event, value: number) => setTab(value)} variant="scrollable" scrollButtons="auto"><Tab label={`ทะเบียนผู้ถือเงิน (${holders.length})`} /><Tab label={`สลิปที่พบ (${slipMatches.length})`} /></Tabs></Paper>
    {tab === 0 && <StandardDataTable rows={holders} getRowId={(row) => row.id} onRowClick={setSelected} getSearchText={(row) => `${row.display_name} ${(row.employee_advance_holder_aliases ?? []).map((item) => item.alias_name).join(' ')}`} searchLabel="ค้นหาชื่อผู้ถือเงินหรือชื่อ alias" emptyText="ยังไม่มีผู้ถือเงินสำรองจ่ายที่ลงทะเบียน" minWidth={650} columns={[
      { id: 'name', label: 'ผู้ถือเงิน', minWidth: 220, render: (row) => row.display_name },
      { id: 'aliases', label: 'ชื่อที่ใช้จับคู่', minWidth: 260, render: (row) => (row.employee_advance_holder_aliases ?? []).length ? (row.employee_advance_holder_aliases ?? []).map((item) => <Chip key={item.id} size="small" sx={{ mr: 0.5 }} label={item.alias_name} />) : '-' },
      { id: 'active', label: 'สถานะ', minWidth: 130, render: (row) => <Chip size="small" color={row.is_active ? 'success' : 'default'} label={row.is_active ? 'พร้อมจับคู่' : 'ปิดใช้งาน'} /> },
    ]} />}
    {tab === 1 && <Stack spacing={1.5}>
      <Alert severity="info">ค้นจากชื่อหลักและ alias แบบตรงกันในสลิปกลาง รายการนี้เป็นผลค้นหาเท่านั้น ไม่สร้างข้อมูลหรือแก้สลิปต้นฉบับ</Alert>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}><Chip color="success" label={`รับโอน ${incomingCount}`} /><Chip color="primary" label={`โอนออก ${outgoingCount}`} />{ambiguousCount > 0 && <Chip color="warning" label={`ต้องยืนยัน ${ambiguousCount}`} />}</Stack>
      <StandardDataTable rows={slipMatches} getRowId={(row) => row.id} onRowClick={(row) => navigate(`/accounting-documents?transaction_id=${encodeURIComponent(row.transactionId)}`)} getSearchText={(row) => `${row.holderName} ${row.senderName ?? ''} ${row.recipientName ?? ''} ${row.transactionId}`} searchLabel="ค้นหาผู้ถือเงิน ผู้โอน ผู้รับ หรือ Transaction ID" emptyText={hasScanned ? 'ไม่พบสลิปที่ชื่อผู้ถือเงินหรือ alias ตรงกัน' : 'กดตรวจหาสลิป เพื่อค้นทั้งรายการรับโอนและโอนออก'} minWidth={1050} columns={[
        { id: 'date', label: 'วันที่โอน', minWidth: 150, render: (row) => row.transferAt ? new Date(row.transferAt).toLocaleString('th-TH') : '-' },
        { id: 'holder', label: 'ผู้ถือเงินที่พบ', minWidth: 180, render: (row) => <Stack spacing={0.5}><Typography variant="body2">{row.holderName}</Typography>{row.matchStatus === 'ambiguous' && <Chip size="small" color="warning" label="ต้องยืนยันผู้ถือเงิน" />}</Stack> },
        { id: 'direction', label: 'ทิศทาง', minWidth: 120, render: (row) => <Chip size="small" color={row.direction === 'incoming' ? 'success' : 'primary'} label={row.direction === 'incoming' ? 'รับโอน' : 'โอนออก'} /> },
        { id: 'sender', label: 'ผู้โอนตามสลิป', minWidth: 180, render: (row) => row.senderName ?? '-' },
        { id: 'recipient', label: 'ผู้รับตามสลิป', minWidth: 180, render: (row) => row.recipientName ?? '-' },
        { id: 'amount', label: 'ยอด', minWidth: 130, align: 'right', render: (row) => money(row.amount) },
        { id: 'status', label: 'สถานะสลิป', minWidth: 130, render: (row) => <Chip size="small" color={row.truthStatus === 'confirmed' ? 'success' : 'warning'} label={truthLabel(row.truthStatus)} /> },
      ]} />
    </Stack>}
    <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm"><DialogTitle>เพิ่มผู้ถือเงินสำรองจ่าย</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}><TextField select label="ชื่อพนักงานรายเดือน" value={form.candidate} onChange={(event) => setForm({ ...form, candidate: event.target.value })}>{candidates.map((candidate) => <MenuItem key={`${candidate.kind}:${candidate.id}`} value={`${candidate.kind}:${candidate.id}`}>{candidate.name}</MenuItem>)}</TextField><TextField select label="สถานะ" value={form.active} onChange={(event) => setForm({ ...form, active: event.target.value })}><MenuItem value="true">พร้อมจับคู่</MenuItem><MenuItem value="false">ปิดใช้งาน</MenuItem></TextField></Stack></DialogContent><DialogActions><Button onClick={() => setOpen(false)}>ยกเลิก</Button><Button disabled={saving || !form.candidate} variant="contained" onClick={() => void saveHolder()}>บันทึกชื่อ</Button></DialogActions></Dialog>
    <Dialog open={Boolean(selected)} onClose={() => setSelected(null)} fullWidth maxWidth="sm"><DialogTitle>{selected?.display_name}</DialogTitle><DialogContent><Stack spacing={1.5} sx={{ pt: 1 }}><Typography variant="body2" color="text.secondary">เมื่อ Admin ยืนยันชื่อที่ระบบแนะนำจากสลิป ระบบจะเรียนรู้ชื่อ alias ให้อัตโนมัติ คุณสามารถเพิ่ม alias เองได้ที่นี่เช่นกัน</Typography><TextField label="ชื่อ alias" value={alias} onChange={(event) => setAlias(event.target.value)} /></Stack></DialogContent><DialogActions><Button onClick={() => setSelected(null)}>ปิด</Button><Button disabled={saving || alias.trim().length < 2} variant="contained" onClick={() => void addAlias()}>เพิ่มชื่อจับคู่</Button></DialogActions></Dialog>
  </Stack>
}
