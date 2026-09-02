import { AddOutlined, CloseOutlined, FilterAltOutlined, RefreshOutlined, VisibilityOutlined, WarningAmberOutlined } from '@mui/icons-material'
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Drawer, IconButton, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
import { userError } from '../../utils/userError'
import { calculateHolderBalance, type HolderAdvanceCase, type HolderBalance } from './advanceHolderBalances'

type Holder = {
  id: string
  display_name: string
  is_active: boolean
  holder_profile_id: string | null
  holder_person_id: string | null
  employee_advance_holder_aliases: { id: string; alias_name: string }[] | null
}
type HolderRow = Holder & HolderBalance
type Candidate = { id: string; name: string; kind: 'profile' | 'person' }
type FlowFilter = 'all' | 'received' | 'paid' | 'returned' | 'pending'

const money = (value: number) => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(value || 0)
const dateTime = (value: string | null | undefined) => value ? new Date(value).toLocaleString('th-TH') : '-'
const settlementLabel: Record<string, string> = { daily_wage: 'ค่าแรงรายวัน', materials: 'ค่าวัสดุ', travel: 'ค่าเดินทาง', other: 'อื่น ๆ', cash_return: 'คืนบริษัท', payroll_offset: 'หักเงินเดือน', employee_advance: 'เงินเบิกช่าง' }

export function AdvanceHoldersPage() {
  usePageTitle('ทะเบียนผู้ถือเงินสำรอง')
  const { currentCompany } = useAuth()
  const companyId = currentCompany?.company_id ?? ''
  const [holders, setHolders] = useState<Holder[]>([])
  const [advanceCases, setAdvanceCases] = useState<HolderAdvanceCase[]>([])
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Holder | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ candidate: '', active: 'true' })
  const [alias, setAlias] = useState('')
  const [negativeOnly, setNegativeOnly] = useState(false)
  const [flowFilter, setFlowFilter] = useState<FlowFilter>('all')

  const load = useCallback(async () => {
    if (!companyId) return
    const [{ data: holderData, error: holderError }, { data: caseData, error: caseError }, { data: profileData, error: profileError }, { data: personData, error: personError }] = await Promise.all([
      supabase.from('employee_advance_holders').select('id,display_name,is_active,holder_profile_id,holder_person_id,employee_advance_holder_aliases(id,alias_name)').eq('company_id', companyId).order('display_name'),
      supabase.from('employee_advance_cases').select('id,advance_number,holder_profile_id,holder_person_id,amount_received,status,updated_at,financial_transactions(transfer_at),employee_advance_settlement_items(expense_type,amount,approval_status)').eq('company_id', companyId).order('updated_at', { ascending: false }),
      supabase.from('employee_employment_records').select('profile_id,profiles!employee_employment_records_profile_id_fkey(full_name)').eq('company_id', companyId).eq('employment_type', 'monthly').in('employment_status', ['active', 'probation', 'notice']),
      supabase.from('employee_people').select('id,full_name').eq('company_id', companyId).eq('employment_type', 'monthly').eq('employee_status', 'active'),
    ])
    if (holderError || caseError || profileError || personError) { setError(userError(holderError ?? caseError ?? profileError ?? personError)); return }
    setHolders((holderData ?? []) as unknown as Holder[])
    setAdvanceCases((caseData ?? []) as unknown as HolderAdvanceCase[])
    setCandidates([
      ...((profileData ?? []) as unknown as { profile_id: string; profiles: { full_name: string | null } | null }[]).map((row) => ({ id: row.profile_id, name: row.profiles?.full_name ?? row.profile_id, kind: 'profile' as const })),
      ...((personData ?? []) as { id: string; full_name: string | null }[]).map((row) => ({ id: row.id, name: row.full_name ?? row.id, kind: 'person' as const })),
    ])
    setError('')
  }, [companyId])

  const rows = useMemo<HolderRow[]>(() => holders.map((holder) => {
    const cases = advanceCases.filter((advanceCase) =>
      (holder.holder_profile_id && advanceCase.holder_profile_id === holder.holder_profile_id)
      || (holder.holder_person_id && advanceCase.holder_person_id === holder.holder_person_id))
    return { ...holder, ...calculateHolderBalance(cases) }
  }), [advanceCases, holders])
  const visibleRows = negativeOnly ? rows.filter((row) => row.balance < 0) : rows
  const selectedRow = selected ? rows.find((row) => row.id === selected.id) ?? null : null
  const selectedCases = selectedRow?.cases.filter((advanceCase) => {
    if (flowFilter === 'all') return true
    const balance = calculateHolderBalance([advanceCase])
    if (flowFilter === 'received') return balance.received > 0
    if (flowFilter === 'paid') return balance.paidOrOffset > 0
    if (flowFilter === 'returned') return balance.returned > 0
    return balance.pendingCount > 0
  }) ?? []

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

  return <Stack spacing={2}>
    <PageHeader title="ทะเบียนผู้ถือเงินสำรองจ่าย" description="เพิ่มเฉพาะชื่อผู้ถือเงิน ระบบจะอ่านข้อมูลบัญชีจากสลิป และเรียนรู้ชื่อภาษาอังกฤษ/ชื่อสะกดต่างกันเมื่อ Admin ยืนยันครั้งแรก" action={<Stack direction="row" spacing={1}><Button startIcon={<RefreshOutlined />} onClick={() => void load()}>รีเฟรช</Button><Button variant="contained" startIcon={<AddOutlined />} onClick={() => setOpen(true)}>เพิ่มผู้ถือเงิน</Button></Stack>} />
    {error && <Alert severity="error">{error}</Alert>}
    <Stack direction="row" sx={{ justifyContent: 'flex-end' }}><Button size="small" variant={negativeOnly ? 'contained' : 'outlined'} color={negativeOnly ? 'error' : 'inherit'} startIcon={<WarningAmberOutlined />} onClick={() => setNegativeOnly((value) => !value)}>เฉพาะยอดติดลบ{rows.some((row) => row.balance < 0) ? ` (${rows.filter((row) => row.balance < 0).length})` : ''}</Button></Stack>
    <StandardDataTable rows={visibleRows} getRowId={(row) => row.id} onRowClick={(row) => { setFlowFilter('all'); setSelected(row) }} getSearchText={(row) => `${row.display_name} ${(row.employee_advance_holder_aliases ?? []).map((item) => item.alias_name).join(' ')}`} searchLabel="ค้นหาชื่อผู้ถือเงินหรือชื่อ alias" emptyText={negativeOnly ? 'ไม่พบผู้ถือเงินที่มียอดติดลบ' : 'ยังไม่มีผู้ถือเงินสำรองจ่ายที่ลงทะเบียน'} minWidth={1320} columns={[
      { id: 'name', label: 'ผู้ถือเงิน', minWidth: 220, render: (row) => row.display_name },
      { id: 'received', label: 'รับเข้า', minWidth: 130, align: 'right', render: (row) => money(row.received) },
      { id: 'paid', label: 'จ่าย/ตัดยอด', minWidth: 130, align: 'right', render: (row) => money(row.paidOrOffset) },
      { id: 'returned', label: 'คืนบริษัท', minWidth: 130, align: 'right', render: (row) => money(row.returned) },
      { id: 'balance', label: 'คงเหลือ', minWidth: 150, align: 'right', render: (row) => <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end', alignItems: 'center' }}>{row.balance < 0 && <WarningAmberOutlined color="error" fontSize="small" />}<Typography sx={{ fontWeight: 800, color: row.balance < 0 ? 'error.main' : row.balance > 0 ? 'success.main' : 'text.primary' }}>{money(row.balance)}</Typography></Stack> },
      { id: 'pending', label: 'รอตรวจ', minWidth: 150, align: 'right', render: (row) => row.pendingCount ? <Chip size="small" color="warning" label={`${row.pendingCount} รายการ · ${money(row.pendingAmount)}`} /> : '-' },
      { id: 'updated', label: 'อัปเดตล่าสุด', minWidth: 170, render: (row) => dateTime(row.updatedAt) },
      { id: 'active', label: 'สถานะ', minWidth: 130, render: (row) => <Chip size="small" color={row.is_active ? 'success' : 'default'} label={row.is_active ? 'พร้อมจับคู่' : 'ปิดใช้งาน'} /> },
      { id: 'detail', label: 'รายการ', minWidth: 100, render: (row) => <Button size="small" startIcon={<VisibilityOutlined />} onClick={(event) => { event.stopPropagation(); setFlowFilter('all'); setSelected(row) }}>ดูรายการ</Button> },
    ]} />
    <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm"><DialogTitle>เพิ่มผู้ถือเงินสำรองจ่าย</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}><TextField select label="ชื่อพนักงานรายเดือน" value={form.candidate} onChange={(event) => setForm({ ...form, candidate: event.target.value })}>{candidates.map((candidate) => <MenuItem key={`${candidate.kind}:${candidate.id}`} value={`${candidate.kind}:${candidate.id}`}>{candidate.name}</MenuItem>)}</TextField><TextField select label="สถานะ" value={form.active} onChange={(event) => setForm({ ...form, active: event.target.value })}><MenuItem value="true">พร้อมจับคู่</MenuItem><MenuItem value="false">ปิดใช้งาน</MenuItem></TextField></Stack></DialogContent><DialogActions><Button onClick={() => setOpen(false)}>ยกเลิก</Button><Button disabled={saving || !form.candidate} variant="contained" onClick={() => void saveHolder()}>บันทึกชื่อ</Button></DialogActions></Dialog>
    <Drawer anchor="right" open={Boolean(selectedRow)} onClose={() => { setSelected(null); setFlowFilter('all') }} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 560 }, p: 2 } } }}>
      <Stack spacing={2}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Box><Typography variant="overline">ผู้ถือเงินสำรองจ่าย</Typography><Typography variant="h6">{selectedRow?.display_name}</Typography></Box><IconButton aria-label="ปิด" onClick={() => { setSelected(null); setFlowFilter('all') }}><CloseOutlined /></IconButton></Stack>
        {selectedRow && <>
          {selectedRow.balance < 0 && <Alert severity="error">ยอดคงเหลือติดลบ {money(selectedRow.balance)} กรุณาตรวจรายการจ่าย/คืนและหลักฐานต้นทาง</Alert>}
          <Paper variant="outlined" sx={{ p: 1.5 }}><Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }}>
            {([
              ['received', 'รับเข้า', selectedRow.received, 'success'],
              ['paid', 'จ่าย/ตัดยอด', selectedRow.paidOrOffset, 'warning'],
              ['returned', 'คืนบริษัท', selectedRow.returned, 'info'],
              ['all', 'คงเหลือ', selectedRow.balance, selectedRow.balance < 0 ? 'error' : 'success'],
            ] as const).map(([filter, label, amount, color]) => <Button key={filter} variant={flowFilter === filter ? 'contained' : 'text'} color={color} onClick={() => setFlowFilter(filter)} sx={{ minWidth: 112, justifyContent: 'flex-start', textTransform: 'none' }}><Box sx={{ textAlign: 'left' }}><Typography variant="caption" sx={{ display: 'block' }}>{label}</Typography><Typography sx={{ fontWeight: 900 }}>{money(amount)}</Typography></Box></Button>)}
          </Stack></Paper>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Typography sx={{ fontWeight: 800 }}>รายการ{flowFilter === 'all' ? 'รับ–จ่าย' : flowFilter === 'received' ? 'รับเข้า' : flowFilter === 'paid' ? 'จ่าย/ตัดยอด' : flowFilter === 'returned' ? 'คืนบริษัท' : 'รอตรวจ'}ตามลำดับเวลา</Typography><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Chip size="small" icon={<FilterAltOutlined />} label={`${selectedCases.length} รายการ`} />{selectedRow.pendingCount > 0 && <Button size="small" color="warning" onClick={() => setFlowFilter('pending')}>รอตรวจ {selectedRow.pendingCount}</Button>}</Stack></Stack>
          <Box>{selectedCases.length ? selectedCases.map((advanceCase) => {
            const balance = calculateHolderBalance([advanceCase])
            return <Paper key={advanceCase.id} variant="outlined" sx={{ p: 1.25, mb: 1 }}><Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1 }}><Box><Typography sx={{ fontWeight: 800 }}>{advanceCase.advance_number}</Typography><Typography variant="caption" color="text.secondary">{dateTime(advanceCase.financial_transactions?.transfer_at ?? advanceCase.updated_at)} · {advanceCase.status}</Typography></Box><Typography sx={{ fontWeight: 800, color: balance.balance < 0 ? 'error.main' : 'text.primary' }}>{money(balance.balance)}</Typography></Stack><Typography variant="body2" sx={{ mt: 0.5 }}>รับ {money(balance.received)} · จ่าย/ตัด {money(balance.paidOrOffset)} · คืน {money(balance.returned)}</Typography>{(advanceCase.employee_advance_settlement_items ?? []).map((item, index) => <Typography key={`${advanceCase.id}-${index}`} variant="caption" sx={{ display: 'block', color: item.approval_status === 'approved' ? 'text.secondary' : 'warning.main' }}>• {settlementLabel[item.expense_type] ?? item.expense_type} {money(Number(item.amount))} · {item.approval_status}</Typography>)}</Paper>
          }) : <Typography color="text.secondary">ไม่พบรายการตามตัวกรองนี้</Typography>}</Box>
          <Box><Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>ชื่อ alias ใช้จับคู่สลิปกับผู้ถือเงินรายนี้</Typography><Stack direction="row" spacing={1}><TextField fullWidth size="small" label="ชื่อ alias" value={alias} onChange={(event) => setAlias(event.target.value)} /><Button disabled={saving || alias.trim().length < 2} variant="contained" onClick={() => void addAlias()}>เพิ่ม</Button></Stack></Box>
        </>}
      </Stack>
    </Drawer>
  </Stack>
}
