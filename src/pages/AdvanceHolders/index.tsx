import { AddOutlined, CloseOutlined, FindInPageOutlined, RefreshOutlined, VisibilityOutlined, WarningAmberOutlined } from '@mui/icons-material'
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Drawer, IconButton, MenuItem, Paper, Stack, Tab, Tabs, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
import { advanceHolderSlipDestination, matchAdvanceHolderSlips, type AdvanceHolderSlipEvidence, type AdvanceHolderSlipMatch } from '../../services/advanceHolderSlipMatch'
import { userError } from '../../utils/userError'
import { calculateHolderBalance, type HolderAdvanceCase, type HolderBalance } from './advanceHolderBalances'
import { calculateHolderRealtimeBalance, type HolderRealtimeBalance } from './advanceHolderRealtime'

type Holder = {
  id: string
  display_name: string
  is_active: boolean
  holder_profile_id: string | null
  holder_person_id: string | null
  employee_advance_holder_aliases: { id: string; alias_name: string }[] | null
}
type HolderRow = Holder & HolderBalance & HolderRealtimeBalance
type Candidate = { id: string; name: string; kind: 'profile' | 'person' }
type HolderFilter = 'all' | 'balance' | 'review' | 'negative' | 'transit' | 'inactive'

export function AdvanceHoldersPage() {
  usePageTitle('ทะเบียนผู้ถือเงินสำรอง')
  const navigate = useNavigate()
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
  const [tab, setTab] = useState(0)
  const [slipMatches, setSlipMatches] = useState<AdvanceHolderSlipMatch[]>([])
  const [scanning, setScanning] = useState(false)
  const [hasScanned, setHasScanned] = useState(false)
  const [routeFilter, setRouteFilter] = useState<'all' | 'resolved' | 'unresolved'>('all')
  const [negativeOnly, setNegativeOnly] = useState(false)
  const [holderFilter, setHolderFilter] = useState<HolderFilter>('all')

  const load = useCallback(async () => {
    if (!companyId) return
    const [{ data: holderData, error: holderError }, { data: caseData, error: caseError }, { data: profileData, error: profileError }, { data: personData, error: personError }] = await Promise.all([
      supabase.from('employee_advance_holders').select('id,display_name,is_active,holder_profile_id,holder_person_id,employee_advance_holder_aliases(id,alias_name)').eq('company_id', companyId).order('display_name'),
      supabase.from('employee_advance_cases').select('id,advance_number,holder_profile_id,holder_person_id,amount_received,status,updated_at,financial_transactions(transfer_at),employee_advance_settlement_items!employee_advance_settlement_items_case_id_fkey(expense_type,amount,approval_status)').eq('company_id', companyId).order('updated_at', { ascending: false }),
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

  const holderRows = useMemo<HolderRow[]>(() => holders.map((holder) => {
    const cases = advanceCases.filter((advanceCase) => (holder.holder_profile_id && advanceCase.holder_profile_id === holder.holder_profile_id) || (holder.holder_person_id && advanceCase.holder_person_id === holder.holder_person_id))
    const confirmed = calculateHolderBalance(cases)
    return { ...holder, ...confirmed, ...calculateHolderRealtimeBalance(holder.id, confirmed.balance, slipMatches) }
  }), [advanceCases, holders, slipMatches])
  const effectiveHolderFilter: HolderFilter = negativeOnly ? 'negative' : holderFilter
  const visibleHolderRows = holderRows.filter((row) => {
    if (effectiveHolderFilter === 'balance') return row.projectedBalance !== 0
    if (effectiveHolderFilter === 'review') return row.reviewCount > 0 || row.variance !== 0
    if (effectiveHolderFilter === 'negative') return row.projectedBalance < 0
    if (effectiveHolderFilter === 'transit') return row.inTransit > 0
    if (effectiveHolderFilter === 'inactive') return row.movements.length === 0
    return true
  })
  const selectedRow = selected ? holderRows.find((row) => row.id === selected.id) ?? null : null

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

  const scanSlips = useCallback(async (showResults = false) => {
    if (!companyId || !holders.length) { setError('ต้องมีผู้ถือเงินที่พร้อมจับคู่ก่อนตรวจหาสลิป'); return }
    setScanning(true); setError('')
    const { data, error: scanError } = await supabase.from('transfer_slip_operational_truth_v1')
      .select('transaction_id,item_id,evidence_sender_name,evidence_recipient_name,evidence_amount,evidence_transfer_at,truth_status,duplicate_of,lineage_id,funding_source_type,purpose_type,route_status,next_destination,canonical_payer_name,canonical_fund_holder_name,canonical_beneficiary_name')
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
      lineageId: row.lineage_id,
      fundingSourceType: row.funding_source_type,
      purposeType: row.purpose_type,
      routeStatus: row.route_status,
      nextDestination: row.next_destination,
      canonicalPayerName: row.canonical_payer_name,
      canonicalFundHolderName: row.canonical_fund_holder_name,
      canonicalBeneficiaryName: row.canonical_beneficiary_name,
    })) satisfies AdvanceHolderSlipEvidence[]
    setSlipMatches(matchAdvanceHolderSlips(holders.map((holder) => ({
      id: holder.id,
      displayName: holder.display_name,
      aliases: (holder.employee_advance_holder_aliases ?? []).map((item) => item.alias_name),
    })), evidence))
    setHasScanned(true)
    if (showResults) setTab(1)
  }, [companyId, holders])

  useEffect(() => {
    if (!holders.length || hasScanned) return
    const timer = window.setTimeout(() => void scanSlips(false), 0)
    return () => window.clearTimeout(timer)
  }, [hasScanned, holders.length, scanSlips])

  const incomingCount = slipMatches.filter((item) => item.direction === 'incoming').length
  const outgoingCount = slipMatches.filter((item) => item.direction === 'outgoing').length
  const ambiguousCount = slipMatches.filter((item) => item.matchStatus === 'ambiguous').length
  const resolvedCount = slipMatches.filter((item) => item.routeResolved).length
  const unresolvedCount = slipMatches.length - resolvedCount
  const visibleSlipMatches = slipMatches.filter((item) => routeFilter === 'all' || (routeFilter === 'resolved' ? item.routeResolved : !item.routeResolved))
  const money = (value: number | null) => value == null ? '-' : new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(value)
  const dateTime = (value: string | null | undefined) => value ? new Date(value).toLocaleString('th-TH') : '-'
  const settlementLabel: Record<string, string> = { daily_wage: 'ค่าแรงรายวัน', materials: 'ค่าวัสดุ', travel: 'ค่าเดินทาง', other: 'อื่น ๆ', cash_return: 'คืนบริษัท', payroll_offset: 'หักเงินเดือน', employee_advance: 'เงินเบิกช่าง' }
  const truthLabel = (value: string) => ({ confirmed: 'ยืนยันแล้ว', needs_review: 'รอตรวจ', needs_information: 'รอข้อมูล', duplicate: 'รายการซ้ำ' }[value] ?? value)
  const purposeLabel = (value: string | null) => ({ payroll: 'เงินเดือน/ค่าแรง', advance_transfer: 'เงินสำรอง/เบิกล่วงหน้า', materials: 'ซื้อวัสดุ/อุปกรณ์', project_expense: 'ค่าใช้จ่ายโครงการ', vendor_payment: 'จ่ายผู้ขาย', subcontractor: 'ผู้รับเหมา', travel: 'เดินทาง/หน้างาน', bank_fee: 'ค่าธรรมเนียมธนาคาร', tax: 'ภาษี', refund_return: 'เงินคืน', inter_account: 'โอนระหว่างบัญชี', cash_withdrawal: 'ถอนเงินสด', general_expense: 'ค่าใช้จ่ายทั่วไป', onward_transfer: 'ส่งต่อผู้ถือเงิน', multi_allocation: 'หลายประเภท' }[value ?? ''] ?? 'ยังไม่สรุปประเภทเงิน')
  const routeText = (row: AdvanceHolderSlipMatch) => {
    const parties = [row.canonicalPayerName ?? row.senderName, row.canonicalFundHolderName, row.canonicalBeneficiaryName ?? row.recipientName]
      .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
    return parties.join(' → ') || '-'
  }
  const destinationPath = (destination: string | null) => destination === 'payroll' ? '/reports' : destination === 'advance_finance' ? '/advance-settlements' : '/accounting-documents'
  const openMovement = (movement: AdvanceHolderSlipMatch) => navigate(`/accounting-documents?transaction_id=${encodeURIComponent(movement.transactionId)}`)

  return <Stack spacing={2}>
    <PageHeader title="ทะเบียนผู้ถือเงินสำรองจ่าย" description="ยอดบัญชียืนยัน + การเคลื่อนไหวจากสลิป Real-time พร้อมเส้นเงินที่ตรวจย้อนกลับได้" action={<Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}><Button startIcon={<RefreshOutlined />} onClick={() => { void load(); void scanSlips(false) }}>รีเฟรช</Button><Button disabled={scanning || !holders.length} startIcon={scanning ? <CircularProgress size={16} /> : <FindInPageOutlined />} onClick={() => void scanSlips(true)}>ตรวจใหม่</Button><Button variant="contained" startIcon={<AddOutlined />} onClick={() => setOpen(true)}>เพิ่มผู้ถือเงิน</Button></Stack>} />
    {error && <Alert severity="error">{error}</Alert>}
    <Paper variant="outlined"><Tabs value={tab} onChange={(_event, value: number) => setTab(value)} variant="scrollable" scrollButtons="auto"><Tab label={`ทะเบียนผู้ถือเงิน (${holders.length})`} /><Tab label={`สลิปที่พบ (${slipMatches.length})`} /></Tabs></Paper>
    {tab === 0 && <Stack spacing={1}><Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>{([['all', 'ทั้งหมด'], ['balance', 'มียอดคงเหลือ'], ['review', 'รอตรวจ'], ['negative', 'ยอดติดลบ'], ['transit', 'เงินกำลังเดินทาง'], ['inactive', 'ไม่มีการเคลื่อนไหว']] as [HolderFilter, string][]).map(([value, label]) => <Button key={value} size="small" variant={effectiveHolderFilter === value ? 'contained' : 'outlined'} color={value === 'negative' ? 'error' : value === 'review' || value === 'transit' ? 'warning' : 'inherit'} startIcon={value === 'negative' ? <WarningAmberOutlined /> : undefined} onClick={() => { setNegativeOnly(false); setHolderFilter(value) }}>{label}</Button>)}</Stack><StandardDataTable rows={visibleHolderRows} getRowId={(row) => row.id} onRowClick={setSelected} getSearchText={(row) => `${row.display_name} ${(row.employee_advance_holder_aliases ?? []).map((item) => item.alias_name).join(' ')}`} searchLabel="ค้นหาชื่อผู้ถือเงินหรือชื่อ alias" emptyText={effectiveHolderFilter === 'all' ? 'ยังไม่มีผู้ถือเงินสำรองจ่ายที่ลงทะเบียน' : 'ไม่พบรายการตามตัวกรอง'} minWidth={2050} columns={[
      { id: 'name', label: 'ผู้ถือเงิน', minWidth: 220, render: (row) => row.display_name },
      { id: 'received', label: 'รับเข้า', minWidth: 130, align: 'right', render: (row) => money(row.received) },
      { id: 'realtimePaid', label: 'จ่ายออก Real-time', minWidth: 160, align: 'right', render: (row) => <Button size="small" onClick={(event) => { event.stopPropagation(); setSelected(row) }}>{money(row.realtimePaid)}</Button> },
      { id: 'transit', label: 'เงินกำลังเดินทาง', minWidth: 160, align: 'right', render: (row) => row.inTransit ? <Chip size="small" color="warning" label={money(row.inTransit)} /> : '-' },
      { id: 'projected', label: 'คงเหลือคาดการณ์', minWidth: 170, align: 'right', render: (row) => <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end', alignItems: 'center' }}>{row.projectedBalance < 0 && <WarningAmberOutlined color="error" fontSize="small" />}<Typography sx={{ fontWeight: 900, color: row.projectedBalance < 0 ? 'error.main' : row.projectedBalance > 0 ? 'success.main' : 'text.primary' }}>{money(row.projectedBalance)}</Typography></Stack> },
      { id: 'confirmed', label: 'คงเหลือยืนยัน', minWidth: 155, align: 'right', render: (row) => money(row.confirmedBalance) },
      { id: 'variance', label: 'ผลต่าง/รอตรวจ', minWidth: 180, align: 'right', render: (row) => row.reviewCount || row.variance ? <Stack spacing={0.5} sx={{ alignItems: 'flex-end' }}><Typography color={row.variance ? 'warning.main' : 'text.secondary'} sx={{ fontWeight: 800 }}>{money(row.variance)}</Typography><Chip size="small" color="warning" variant="outlined" label={`${row.reviewCount} รายการ · ${money(row.reviewAmount)}`} /></Stack> : '-' },
      { id: 'updated', label: 'อัปเดตล่าสุด', minWidth: 170, render: (row) => dateTime(row.lastActivityAt ?? row.updatedAt) },
      { id: 'route', label: 'เส้นเงินล่าสุด', minWidth: 340, render: (row) => { const latest = row.movements[0]; return latest ? <Button size="small" sx={{ justifyContent: 'flex-start', textAlign: 'left' }} onClick={(event) => { event.stopPropagation(); openMovement(latest) }}>{routeText(latest)} → {purposeLabel(latest.purposeType)}</Button> : '-' } },
      { id: 'active', label: 'สถานะ', minWidth: 150, render: (row) => <Chip size="small" color={!row.is_active ? 'default' : row.projectedBalance < 0 ? 'error' : row.reviewCount || row.variance ? 'warning' : 'success'} label={!row.is_active ? 'ปิดใช้งาน' : row.projectedBalance < 0 ? 'ยอดติดลบ' : row.reviewCount || row.variance ? 'รอตรวจ' : 'ข้อมูลตรงกัน'} /> },
      { id: 'detail', label: 'รายการ', minWidth: 100, render: (row) => <Button size="small" startIcon={<VisibilityOutlined />} onClick={(event) => { event.stopPropagation(); setSelected(row) }}>ดูรายการ</Button> },
    ]} /></Stack>}
    {tab === 1 && <Stack spacing={1.5}>
      <Alert severity={unresolvedCount ? 'warning' : 'info'}>ระบบค้นให้อัตโนมัติจากชื่อหลักและ alias · รายการที่ยังไม่สรุปให้คลิกแถวเพื่อแก้ประเภทและเส้นทางในสลิปต้นฉบับ</Alert>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}><Button size="small" variant={routeFilter === 'all' ? 'contained' : 'outlined'} onClick={() => setRouteFilter('all')}>ทั้งหมด {slipMatches.length}</Button><Button size="small" color="success" variant={routeFilter === 'resolved' ? 'contained' : 'outlined'} onClick={() => setRouteFilter('resolved')}>มีเส้นทางแล้ว {resolvedCount}</Button><Button size="small" color="warning" variant={routeFilter === 'unresolved' ? 'contained' : 'outlined'} onClick={() => setRouteFilter('unresolved')}>ยังไม่สรุป {unresolvedCount}</Button><Chip color="success" label={`รับโอน ${incomingCount}`} /><Chip color="primary" label={`โอนออก ${outgoingCount}`} />{ambiguousCount > 0 && <Chip color="warning" label={`ต้องยืนยันชื่อ ${ambiguousCount}`} />}</Stack>
      <StandardDataTable rows={visibleSlipMatches} getRowId={(row) => row.id} onRowClick={(row) => navigate(advanceHolderSlipDestination(row).path)} getSearchText={(row) => `${row.holderName} ${row.senderName ?? ''} ${row.recipientName ?? ''} ${row.transactionId} ${purposeLabel(row.purposeType)} ${routeText(row)}`} searchLabel="ค้นหาผู้ถือเงิน ผู้โอน ผู้รับ ประเภทเงิน หรือ Transaction ID" emptyText={hasScanned ? 'ไม่พบสลิปตามตัวกรองนี้' : 'ระบบกำลังตรวจหาสลิป'} minWidth={1580} columns={[
        { id: 'date', label: 'วันที่โอน', minWidth: 150, render: (row) => row.transferAt ? new Date(row.transferAt).toLocaleString('th-TH') : '-' },
        { id: 'holder', label: 'ผู้ถือเงินที่พบ', minWidth: 180, render: (row) => <Stack spacing={0.5}><Typography variant="body2">{row.holderName}</Typography>{row.matchStatus === 'ambiguous' && <Chip size="small" color="warning" label="ต้องยืนยันผู้ถือเงิน" />}</Stack> },
        { id: 'direction', label: 'ทิศทาง', minWidth: 120, render: (row) => <Chip size="small" color={row.direction === 'incoming' ? 'success' : 'primary'} label={row.direction === 'incoming' ? 'รับโอน' : 'โอนออก'} /> },
        { id: 'sender', label: 'ผู้โอนตามสลิป', minWidth: 180, render: (row) => row.senderName ?? '-' },
        { id: 'recipient', label: 'ผู้รับตามสลิป', minWidth: 180, render: (row) => row.recipientName ?? '-' },
        { id: 'amount', label: 'ยอด', minWidth: 130, align: 'right', render: (row) => money(row.amount) },
        { id: 'purpose', label: 'ประเภทเงิน', minWidth: 190, render: (row) => <Chip size="small" color={row.routeResolved ? 'success' : 'warning'} label={purposeLabel(row.purposeType)} /> },
        { id: 'route', label: 'เส้นทางเงินจริง', minWidth: 300, render: (row) => <Stack spacing={0.5}><Typography variant="body2">{routeText(row)}</Typography><Typography variant="caption" color="text.secondary">{row.routeResolved ? `ถัดไป: ${row.nextDestination ?? 'ตามเส้นทางที่ยืนยัน'}` : 'คลิกแถวเพื่อสรุปประเภทและเส้นทาง'}</Typography></Stack> },
        { id: 'destination', label: 'เปิดห้อง', minWidth: 190, render: (row) => <Typography variant="body2" sx={{ fontWeight: 700 }}>{advanceHolderSlipDestination(row).label}</Typography> },
        { id: 'status', label: 'สถานะ', minWidth: 150, render: (row) => <Stack spacing={0.5}><Chip size="small" color={row.truthStatus === 'confirmed' ? 'success' : 'warning'} label={truthLabel(row.truthStatus)} />{!row.routeResolved && <Chip size="small" color="warning" variant="outlined" label="ยังไม่สรุปเส้นทาง" />}</Stack> },
      ]} />
    </Stack>}
    <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm"><DialogTitle>เพิ่มผู้ถือเงินสำรองจ่าย</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}><TextField select label="ชื่อพนักงานรายเดือน" value={form.candidate} onChange={(event) => setForm({ ...form, candidate: event.target.value })}>{candidates.map((candidate) => <MenuItem key={`${candidate.kind}:${candidate.id}`} value={`${candidate.kind}:${candidate.id}`}>{candidate.name}</MenuItem>)}</TextField><TextField select label="สถานะ" value={form.active} onChange={(event) => setForm({ ...form, active: event.target.value })}><MenuItem value="true">พร้อมจับคู่</MenuItem><MenuItem value="false">ปิดใช้งาน</MenuItem></TextField></Stack></DialogContent><DialogActions><Button onClick={() => setOpen(false)}>ยกเลิก</Button><Button disabled={saving || !form.candidate} variant="contained" onClick={() => void saveHolder()}>บันทึกชื่อ</Button></DialogActions></Dialog>
    <Drawer anchor="right" open={Boolean(selectedRow)} onClose={() => setSelected(null)} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 560 }, p: 2 } } }}><Stack spacing={2}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Box><Typography variant="overline">ผู้ถือเงินสำรองจ่าย</Typography><Typography variant="h6">{selectedRow?.display_name}</Typography></Box><IconButton aria-label="ปิด" onClick={() => setSelected(null)}><CloseOutlined /></IconButton></Stack>
      {selectedRow && <>
        {selectedRow.projectedBalance < 0 && <Alert severity="error">ยอดคงเหลือคาดการณ์ติดลบ {money(selectedRow.projectedBalance)} กรุณาตรวจรายการจ่ายและเส้นเงินก่อนปิดยอด</Alert>}
        {selectedRow.reviewCount > 0 && <Alert severity="warning">มี {selectedRow.reviewCount} รายการ รวม {money(selectedRow.reviewAmount)} ที่พบแบบ Real-time แต่ยังต้องตรวจประเภทเงินหรือเส้นทาง</Alert>}
        <Paper variant="outlined" sx={{ p: 1.5 }}><Stack direction="row" useFlexGap spacing={2} sx={{ flexWrap: 'wrap' }}>{[['รับเข้ายืนยัน', selectedRow.received], ['จ่ายออก Real-time', selectedRow.realtimePaid], ['กำลังเดินทาง', selectedRow.inTransit], ['คงเหลือคาดการณ์', selectedRow.projectedBalance], ['คงเหลือยืนยัน', selectedRow.confirmedBalance], ['ผลต่าง', selectedRow.variance]].map(([label, value]) => <Box key={String(label)} sx={{ minWidth: 135 }}><Typography variant="caption">{label}</Typography><Typography sx={{ fontWeight: 900, color: (label === 'คงเหลือคาดการณ์' && Number(value) < 0) ? 'error.main' : label === 'ผลต่าง' && Number(value) !== 0 ? 'warning.main' : 'text.primary' }}>{money(Number(value))}</Typography></Box>)}</Stack></Paper>
        <Box><Typography sx={{ fontWeight: 800, mb: 1 }}>เส้นเงิน Real-time</Typography>{selectedRow.movements.length ? selectedRow.movements.map((movement) => <Paper key={movement.id} variant="outlined" sx={{ p: 1.25, mb: 1, borderStyle: movement.reviewRequired ? 'dashed' : 'solid', borderColor: movement.reviewRequired ? 'warning.main' : 'success.light' }}><Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1 }}><Box><Typography sx={{ fontWeight: 800 }}>{dateTime(movement.transferAt)} · {movement.direction === 'incoming' ? 'รับเข้า' : 'จ่ายออก'}</Typography><Typography variant="caption" color="text.secondary">Transaction {movement.transactionId.slice(0, 10)}… · {movement.truthStatus}</Typography></Box><Typography sx={{ fontWeight: 900, color: movement.direction === 'incoming' ? 'success.main' : 'text.primary' }}>{movement.direction === 'incoming' ? '+' : '-'}{money(movement.amount)}</Typography></Stack><Stack direction="row" useFlexGap spacing={0.5} sx={{ flexWrap: 'wrap', alignItems: 'center', mt: 1 }}><Button size="small" variant="outlined" onClick={() => openMovement(movement)}>{movement.canonicalPayerName ?? movement.senderName ?? 'ไม่ทราบต้นทาง'}</Button><Typography>→</Typography><Button size="small" variant="outlined" onClick={() => setSelected(selectedRow)}>{selectedRow.display_name}</Button><Typography>→</Typography><Button size="small" variant="outlined" onClick={() => openMovement(movement)}>{movement.canonicalBeneficiaryName ?? movement.recipientName ?? 'ไม่ทราบผู้รับ'}</Button><Typography>→</Typography><Button size="small" color={movement.routeResolved ? 'success' : 'warning'} variant="contained" onClick={() => navigate(destinationPath(movement.nextDestination))}>{purposeLabel(movement.purposeType)}</Button></Stack><Stack direction="row" spacing={1} sx={{ mt: 1 }}><Chip size="small" color={movement.reviewRequired ? 'warning' : 'success'} label={movement.reviewRequired ? 'เส้นประ · รอตรวจ' : 'เส้นทึบ · ยืนยันแล้ว'} /><Button size="small" onClick={() => openMovement(movement)}>เปิดสลิป/Audit</Button></Stack></Paper>) : <Typography color="text.secondary">ยังไม่พบสลิปที่จับคู่ผู้ถือเงินรายนี้</Typography>}</Box>
        <Box><Typography sx={{ fontWeight: 800, mb: 1 }}>บัญชีเงินสำรองที่ยืนยันแล้ว</Typography>{selectedRow.cases.length ? selectedRow.cases.map((advanceCase) => { const balance = calculateHolderBalance([advanceCase]); return <Paper key={advanceCase.id} variant="outlined" sx={{ p: 1.25, mb: 1 }}><Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1 }}><Box><Typography sx={{ fontWeight: 800 }}>{advanceCase.advance_number}</Typography><Typography variant="caption" color="text.secondary">{dateTime(advanceCase.financial_transactions?.transfer_at ?? advanceCase.updated_at)} · {advanceCase.status}</Typography></Box><Typography sx={{ fontWeight: 800, color: balance.balance < 0 ? 'error.main' : 'text.primary' }}>{money(balance.balance)}</Typography></Stack><Typography variant="body2" sx={{ mt: 0.5 }}>รับ {money(balance.received)} · จ่าย/ตัด {money(balance.paidOrOffset)} · คืน {money(balance.returned)}</Typography>{(advanceCase.employee_advance_settlement_items ?? []).map((item, index) => <Typography key={`${advanceCase.id}-${index}`} variant="caption" sx={{ display: 'block', color: item.approval_status === 'approved' ? 'text.secondary' : 'warning.main' }}>• {settlementLabel[item.expense_type] ?? item.expense_type} {money(Number(item.amount))} · {item.approval_status}</Typography>)}</Paper> }) : <Typography color="text.secondary">ยังไม่มีรายการบัญชีเงินสำรองที่ยืนยันแล้ว</Typography>}</Box>
        <Box><Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>ชื่อ alias ใช้จับคู่สลิปกับผู้ถือเงินรายนี้</Typography><Stack direction="row" spacing={1}><TextField fullWidth size="small" label="ชื่อ alias" value={alias} onChange={(event) => setAlias(event.target.value)} /><Button disabled={saving || alias.trim().length < 2} variant="contained" onClick={() => void addAlias()}>เพิ่ม</Button></Stack></Box>
      </>}
    </Stack></Drawer>
  </Stack>
}
