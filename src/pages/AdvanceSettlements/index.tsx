import { AddOutlined, CloseOutlined, RefreshOutlined } from '@mui/icons-material'
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Drawer, IconButton, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
import { userError } from '../../utils/userError'

type SettlementItem = { id: string; expense_type: string; amount: number; approval_status: string; description: string; expense_date: string; evidence_reference: string | null }
type Audit = { id: string; action: string; reason: string | null; created_at: string }
type SourceFlow = { id: string; current_flow: string; current_room: string; state: string }
type SourceSlip = { recipient_name: string | null; sender_name: string | null; sender_bank_name: string | null; sender_account_last4: string | null; recipient_bank_name: string | null; recipient_account_last4: string | null; transfer_at: string | null; payment_party_confidence: number | null }
type AdvanceCase = {
  id: string; advance_number: string; amount_received: number; bank_reference: string | null; status: string; version: number; parent_case_id: string | null; purpose_note: string | null
  financial_transactions: SourceSlip | null; source_flow: SourceFlow | null; holder_profile: { full_name: string | null } | null; holder_person: { full_name: string | null } | null
  employee_advance_settlement_items: SettlementItem[] | null; employee_advance_audit: Audit[] | null
}
type DailyEmployee = { profile_id: string; profiles: { full_name: string | null } | null }

const labels: Record<string, string> = {
  draft: 'รอแตกยอด', collecting_evidence: 'กำลังรวบรวมหลักฐาน', submitted: 'ส่งตรวจแล้ว', approved: 'อนุมัติแล้ว', closed: 'ปิดยอดแล้ว', returned: 'ส่งกลับแก้ไข', cancelled: 'ยกเลิก',
  daily_wage: 'ค่าแรงรายวัน', materials: 'ค่าวัสดุ', travel: 'ค่าเดินทาง', other: 'อื่น ๆ', cash_return: 'คืนเงินบริษัท', payroll_offset: 'หักเงินเดือน', employee_advance: 'เงินเบิกช่าง',
  auto_create_from_holder_registry: 'ระบบสร้างร่างจากชื่อที่เรียนรู้', admin_confirm_name_match: 'Admin ยืนยันชื่อและสอนระบบ', create_from_transfer: 'สร้างจากสลิปต้นทาง', add_settlement_item: 'เพิ่มรายการใช้เงิน', create_sub_advance: 'สร้างเงินเบิกช่าง', submit: 'ส่งตรวจ', approve: 'อนุมัติ', return: 'ส่งกลับแก้ไข', close: 'ปิดยอด',
}
const money = (value: number) => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(value || 0)
const dateTime = (value: string | null | undefined) => value ? new Date(value).toLocaleString('th-TH') : '-'
const holderName = (row: AdvanceCase) => row.holder_profile?.full_name ?? row.holder_person?.full_name ?? row.financial_transactions?.recipient_name ?? '-'
const routeText = (row: AdvanceCase) => row.parent_case_id ? `เงินทดรองหลัก → เงินเบิกช่าง → ${labels[row.status] ?? row.status}` : `สลิป → Intake → Filter → บัญชี → เงินทดรอง (${labels[row.status] ?? row.status})`
function updateState(row: AdvanceCase) {
  const actions = row.employee_advance_audit ?? []
  if (actions.some((audit) => audit.action === 'admin_confirm_name_match')) return { label: 'Admin ยืนยัน/เรียนรู้ชื่อ', color: 'primary' as const }
  if (actions.some((audit) => audit.action === 'auto_create_from_holder_registry')) return { label: 'สร้างอัตโนมัติจากชื่อที่เรียนรู้', color: 'success' as const }
  if (actions.some((audit) => audit.action === 'create_from_transfer')) return { label: 'สร้างจากชื่อตรง', color: 'secondary' as const }
  return { label: 'ข้อมูลเดิม/รอตรวจที่มา', color: 'default' as const }
}
function sourceQuality(row: AdvanceCase) {
  const source = row.financial_transactions
  if (!source) return { label: 'เงินเบิกจากเคสหลัก', color: 'info' as const }
  const complete = Boolean(source.recipient_name && source.sender_name && source.sender_bank_name && source.sender_account_last4 && source.recipient_bank_name && source.recipient_account_last4)
  if (!complete) return { label: 'ข้อมูลสลิปไม่ครบ', color: 'warning' as const }
  if (Number(source.payment_party_confidence ?? 0) < 0.9) return { label: 'AI ต้องตรวจเพิ่ม', color: 'warning' as const }
  return { label: 'ข้อมูลสลิปครบ', color: 'success' as const }
}

export function AdvanceSettlementsPage() {
  usePageTitle('เงินทดรองและปิดยอด')
  const { currentCompany } = useAuth()
  const [rows, setRows] = useState<AdvanceCase[]>([])
  const [selected, setSelected] = useState<AdvanceCase | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [lineOpen, setLineOpen] = useState(false)
  const [subAdvanceOpen, setSubAdvanceOpen] = useState(false)
  const [dailyEmployees, setDailyEmployees] = useState<DailyEmployee[]>([])
  const [line, setLine] = useState({ expense_type: 'materials', amount: '', description: '', evidence_reference: '', expense_date: new Date().toLocaleDateString('en-CA') })
  const [subAdvance, setSubAdvance] = useState({ holderProfileId: '', amount: '', description: '' })
  const companyId = currentCompany?.company_id ?? ''
  const load = useCallback(async () => {
    if (!companyId) return
    const [{ data, error: loadError }, { data: dailyData, error: dailyError }] = await Promise.all([supabase.from('employee_advance_cases').select(`
      id,advance_number,amount_received,bank_reference,status,parent_case_id,purpose_note,
      financial_transactions(recipient_name,sender_name,sender_bank_name,sender_account_last4,recipient_bank_name,recipient_account_last4,transfer_at,payment_party_confidence),
      source_flow:document_flow_items!employee_advance_cases_source_flow_item_id_fkey(id,current_flow,current_room,state),
      holder_profile:profiles!employee_advance_cases_holder_profile_id_fkey(full_name),
      holder_person:employee_people!employee_advance_cases_holder_person_id_fkey(full_name),
      employee_advance_settlement_items!employee_advance_settlement_items_case_id_fkey(id,expense_type,amount,approval_status,description,expense_date,evidence_reference),
      employee_advance_audit!employee_advance_audit_case_id_fkey(id,action,reason,created_at)
    `).eq('company_id', companyId).order('updated_at', { ascending: false }), supabase.from('employee_employment_records').select('profile_id,profiles!employee_employment_records_profile_id_fkey(full_name)').eq('company_id', companyId).eq('employment_type', 'daily').in('employment_status', ['active', 'probation', 'notice'])])
    if (loadError || dailyError) setError(userError(loadError ?? dailyError))
    else { setError(''); setRows((data ?? []) as unknown as AdvanceCase[]); setDailyEmployees((dailyData ?? []) as unknown as DailyEmployee[]) }
  }, [companyId])
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])
  const total = (row: AdvanceCase) => (row.employee_advance_settlement_items ?? []).filter((item) => item.approval_status === 'approved').reduce((sum, item) => sum + Number(item.amount), 0)
  const outstanding = (row: AdvanceCase) => Number(row.amount_received) - total(row)
  const received = rows.reduce((sum, row) => sum + Number(row.amount_received), 0)
  const openBalance = rows.filter((row) => row.status !== 'closed').reduce((sum, row) => sum + outstanding(row), 0)
  const automaticCount = rows.filter((row) => ['auto_create_from_holder_registry', 'admin_confirm_name_match'].some((action) => (row.employee_advance_audit ?? []).some((audit) => audit.action === action))).length
  const addLine = async () => { if (!selected) return; setSaving(true); const { error: rpcError } = await supabase.rpc('add_employee_advance_settlement_item', { target_case_id: selected.id, target_event_key: crypto.randomUUID(), target_expense_type: line.expense_type, target_amount: Number(line.amount), target_expense_date: line.expense_date, target_payee_name: null, target_project_id: null, target_work_package_id: null, target_evidence_flow_item_id: null, target_evidence_reference: line.evidence_reference || null, target_description: line.description }); setSaving(false); if (rpcError) { setError(userError(rpcError)); return }; setLineOpen(false); await load() }
  const transition = async (action: string) => { if (!selected) return; setSaving(true); const { error: rpcError } = await supabase.rpc('transition_employee_advance_case', { target_case_id: selected.id, target_event_key: crypto.randomUUID(), target_action: action, target_expected_version: selected.version, target_reason: null }); setSaving(false); if (rpcError) { setError(userError(rpcError)); return }; setSelected(null); await load() }
  const createSubAdvance = async () => { if (!selected) return; setSaving(true); const { error: rpcError } = await supabase.rpc('create_employee_sub_advance', { target_parent_case_id: selected.id, target_event_key: crypto.randomUUID(), target_holder_profile_id: subAdvance.holderProfileId, target_holder_person_id: null, target_amount: Number(subAdvance.amount), target_description: subAdvance.description, target_project_id: null, target_work_package_id: null }); setSaving(false); if (rpcError) { setError(userError(rpcError)); return }; setSubAdvanceOpen(false); await load() }
  return <Stack spacing={2}>
    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}><BoxTitle /><Button startIcon={<RefreshOutlined />} onClick={() => void load()}>รีเฟรช</Button></Stack>
    {error && <Alert severity="error">{error}</Alert>}
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}><Metric label="เงินทดรองรับมา" value={money(received)} /><Metric label="ยอดคงค้างที่ยังไม่ปิด" value={money(openBalance)} /><Metric label="สร้าง/ยืนยันอัตโนมัติ" value={`${automaticCount} เคส`} /></Stack>
    <StandardDataTable rows={rows} getRowId={(row) => row.id} getSearchText={(row) => `${row.advance_number} ${holderName(row)} ${row.bank_reference ?? ''} ${routeText(row)}`} searchLabel="ค้นหารหัส ผู้ถือเงิน สลิป หรือเส้นทาง" onRowClick={setSelected} minWidth={1820} columns={[
      { id: 'number', label: 'รหัสเงินทดรอง', minWidth: 160, render: (row) => row.advance_number },
      { id: 'holder', label: 'ผู้ถือเงิน (มาตรฐาน)', minWidth: 190, render: (row) => holderName(row) },
      { id: 'auto', label: 'การสร้าง/เรียนรู้', minWidth: 210, render: (row) => { const state = updateState(row); return <Chip size="small" color={state.color} label={state.label} /> }, exportValue: (row) => updateState(row).label },
      { id: 'data', label: 'ข้อมูลต้นทาง', minWidth: 150, render: (row) => { const state = sourceQuality(row); return <Chip size="small" color={state.color} label={state.label} /> }, exportValue: (row) => sourceQuality(row).label },
      { id: 'received', label: 'รับมา', minWidth: 130, align: 'right', render: (row) => <AmountLink label="ดูรายละเอียดเงินทดรอง" value={money(Number(row.amount_received))} onClick={() => setSelected(row)} /> },
      { id: 'used', label: 'ใช้จ่ายอนุมัติ', minWidth: 140, align: 'right', render: (row) => <AmountLink label="ดูรายการจ่ายที่อนุมัติ" value={money(total(row))} onClick={() => setSelected(row)} /> },
      { id: 'outstanding', label: 'คงค้าง', minWidth: 130, align: 'right', render: (row) => <AmountLink label="ดูยอดคงค้างและรายการจ่าย" value={money(outstanding(row))} onClick={() => setSelected(row)} /> },
      { id: 'status', label: 'สถานะ', minWidth: 140, render: (row) => labels[row.status] ?? row.status },
      { id: 'route', label: 'เส้นทางอัตโนมัติ', minWidth: 340, render: (row) => routeText(row), exportValue: (row) => routeText(row) },
      { id: 'source', label: 'อ้างอิงสลิป', minWidth: 170, render: (row) => row.bank_reference ?? '-' },
    ]} />
    <Drawer anchor="right" open={Boolean(selected)} onClose={() => setSelected(null)} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 640 }, maxWidth: '100vw' } } }}>
      <Stack sx={{ height: '100%' }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', p: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Box><Typography variant="h6" sx={{ fontWeight: 800 }}>{selected?.advance_number}</Typography><Typography variant="body2" color="text.secondary">รายละเอียดเงินทดรองและรายการจ่าย</Typography></Box>
          <IconButton aria-label="ปิดรายละเอียดเงินทดรอง" onClick={() => setSelected(null)}><CloseOutlined /></IconButton>
        </Stack>
        <Box sx={{ p: 2, overflowY: 'auto', flex: 1 }}>{selected && <CaseDetail row={selected} total={total(selected)} outstanding={outstanding(selected)} />}</Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
          <Button startIcon={<AddOutlined />} disabled={selected?.status === 'closed'} onClick={() => setSubAdvanceOpen(true)}>เบิกให้ช่าง</Button><Button startIcon={<AddOutlined />} disabled={selected?.status === 'closed'} onClick={() => setLineOpen(true)}>เพิ่มรายการใช้เงิน</Button><Button disabled={saving || selected?.status === 'closed'} onClick={() => void transition('submit')}>ส่งตรวจ</Button><Button disabled={saving || selected?.status !== 'submitted'} onClick={() => void transition('approve')}>อนุมัติ</Button><Button disabled={saving || selected?.status !== 'approved'} variant="contained" onClick={() => void transition('close')}>ปิดยอด</Button>
        </Stack>
      </Stack>
    </Drawer>
    <Dialog open={lineOpen} onClose={() => setLineOpen(false)} fullWidth maxWidth="sm"><DialogTitle>เพิ่มรายการใช้เงิน</DialogTitle><DialogContent><Stack spacing={1.5} sx={{ pt: 1 }}><TextField select label="ประเภท" value={line.expense_type} onChange={(event) => setLine({ ...line, expense_type: event.target.value })}>{['daily_wage', 'materials', 'travel', 'other', 'cash_return', 'payroll_offset'].map((value) => <MenuItem key={value} value={value}>{labels[value]}</MenuItem>)}</TextField><TextField type="number" label="จำนวนเงิน" value={line.amount} onChange={(event) => setLine({ ...line, amount: event.target.value })} /><TextField type="date" label="วันที่" value={line.expense_date} onChange={(event) => setLine({ ...line, expense_date: event.target.value })} slotProps={{ inputLabel: { shrink: true } }} /><TextField label="รายละเอียด" value={line.description} onChange={(event) => setLine({ ...line, description: event.target.value })} /><TextField label="เลขอ้างอิงหลักฐาน" value={line.evidence_reference} onChange={(event) => setLine({ ...line, evidence_reference: event.target.value })} /></Stack></DialogContent><DialogActions><Button onClick={() => setLineOpen(false)}>ยกเลิก</Button><Button disabled={saving || !line.amount || line.description.trim().length < 3} variant="contained" onClick={() => void addLine()}>บันทึก</Button></DialogActions></Dialog>
    <Dialog open={subAdvanceOpen} onClose={() => setSubAdvanceOpen(false)} fullWidth maxWidth="sm"><DialogTitle>สร้างเงินเบิกล่วงหน้าให้ช่าง</DialogTitle><DialogContent><Stack spacing={1.5} sx={{ pt: 1 }}><TextField select label="ช่าง/พนักงานรายวัน" value={subAdvance.holderProfileId} onChange={(event) => setSubAdvance({ ...subAdvance, holderProfileId: event.target.value })}>{dailyEmployees.map((employee) => <MenuItem key={employee.profile_id} value={employee.profile_id}>{employee.profiles?.full_name ?? employee.profile_id}</MenuItem>)}</TextField><TextField type="number" label="จำนวนเงิน" value={subAdvance.amount} onChange={(event) => setSubAdvance({ ...subAdvance, amount: event.target.value })} /><TextField label="รายละเอียดงาน/เหตุผล" value={subAdvance.description} onChange={(event) => setSubAdvance({ ...subAdvance, description: event.target.value })} /></Stack></DialogContent><DialogActions><Button onClick={() => setSubAdvanceOpen(false)}>ยกเลิก</Button><Button disabled={saving || !subAdvance.holderProfileId || !subAdvance.amount || subAdvance.description.trim().length < 3} variant="contained" onClick={() => void createSubAdvance()}>สร้างเงินเบิก</Button></DialogActions></Dialog>
  </Stack>
}

function CaseDetail({ row, total, outstanding }: { row: AdvanceCase; total: number; outstanding: number }) {
  const source = row.financial_transactions
  return <Stack spacing={2}>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}><Chip color={updateState(row).color} label={updateState(row).label} /><Chip color={sourceQuality(row).color} label={sourceQuality(row).label} /></Stack>
    <Paper variant="outlined" sx={{ p: 1.5 }}><Typography sx={{ fontWeight: 700 }}>ข้อมูลเงินสำรองจ่าย</Typography><Typography>ผู้ถือเงิน: {holderName(row)} · รับมา {money(Number(row.amount_received))} · ใช้จ่ายอนุมัติ {money(total)} · คงค้าง {money(outstanding)}</Typography><Typography variant="body2" color="text.secondary">{row.purpose_note ?? '-'}</Typography></Paper>
    <Paper variant="outlined" sx={{ p: 1.5 }}><Typography sx={{ fontWeight: 700 }}>เส้นทางเอกสาร</Typography><Typography>{routeText(row)}</Typography>{row.source_flow && <Typography variant="body2" color="text.secondary">สถานะทะเบียนกลาง: {row.source_flow.current_flow} / {row.source_flow.current_room} / {row.source_flow.state}</Typography>}</Paper>
    {source && <Paper variant="outlined" sx={{ p: 1.5 }}><Typography sx={{ fontWeight: 700 }}>หลักฐานสลิปต้นทาง</Typography><Typography variant="body2">ผู้โอน: {source.sender_name ?? '-'} · {source.sender_bank_name ?? '-'} · •••• {source.sender_account_last4 ?? '-'}</Typography><Typography variant="body2">ผู้รับที่อ่านจากสลิป: {source.recipient_name ?? '-'} · {source.recipient_bank_name ?? '-'} · •••• {source.recipient_account_last4 ?? '-'}</Typography><Typography variant="body2">เวลาโอน: {dateTime(source.transfer_at)} · อ้างอิง: {row.bank_reference ?? '-'}</Typography></Paper>}
    <Box><Typography sx={{ fontWeight: 700, mb: 1 }}>Timeline อัตโนมัติ</Typography>{[...(row.employee_advance_audit ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((audit) => <Paper key={audit.id} variant="outlined" sx={{ p: 1, mb: 0.75 }}><Typography>{labels[audit.action] ?? audit.action}</Typography><Typography variant="caption" color="text.secondary">{dateTime(audit.created_at)}{audit.reason ? ` · ${audit.reason}` : ''}</Typography></Paper>)}</Box>
    <Box><Typography sx={{ fontWeight: 700, mb: 1 }}>รายการจ่าย/หลักฐาน</Typography>{(row.employee_advance_settlement_items ?? []).length > 0 ? (row.employee_advance_settlement_items ?? []).map((item) => <Paper key={item.id} variant="outlined" sx={{ p: 1, mb: 0.75 }}><Typography>{labels[item.expense_type] ?? item.expense_type} · {money(Number(item.amount))} · {labels[item.approval_status] ?? item.approval_status}</Typography><Typography variant="caption">{item.expense_date} · {item.description}{item.evidence_reference ? ` · หลักฐาน ${item.evidence_reference}` : ''}</Typography></Paper>) : <Typography variant="body2" color="text.secondary">ยังไม่มีรายการจ่ายที่บันทึกสำหรับเงินทดรองนี้</Typography>}</Box>
  </Stack>
}
function AmountLink({ label, value, onClick }: { label: string; value: string; onClick: () => void }) { return <Button aria-label={label} variant="text" size="small" sx={{ minWidth: 0, p: 0, fontWeight: 700, whiteSpace: 'nowrap' }} onClick={(event) => { event.stopPropagation(); onClick() }}>{value}</Button> }
function Metric({ label, value }: { label: string; value: string }) { return <Paper variant="outlined" sx={{ p: 1.5, flex: 1 }}><Typography variant="caption">{label}</Typography><Typography variant="h6">{value}</Typography></Paper> }
function BoxTitle() { return <Box><Typography variant="h5" sx={{ fontWeight: 800 }}>เงินทดรองและปิดยอด</Typography><Typography variant="body2" color="text.secondary">สลิปต้นทาง → รายการใช้เงิน → หลักฐาน → อนุมัติ → ปิดยอด</Typography></Box> }
