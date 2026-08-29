import { AddOutlined, EditOutlined, HistoryOutlined, PowerSettingsNewOutlined } from '@mui/icons-material'
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import { userError } from '../../utils/userError'

type BankAccount = { id: string; owner_name: string; owner_type: string; bank_name: string | null; account_last4: string }
type Policy = { id: string; sender_master_bank_account_id: string | null; recipient_master_bank_account_id: string | null; sender_bank_name: string; sender_account_last4: string; recipient_bank_name: string; recipient_account_last4: string; route_type: string; decision: string; destination_module: string | null; priority: number; status: 'active' | 'inactive'; reason: string; version: number; updated_at: string }
type PolicyAudit = { id: string; policy_id: string; action: string; actor_profile_id: string | null; reason: string; created_at: string }
type Draft = { senderId: string; recipientId: string; routeType: string; decision: string; destination: string; priority: string; reason: string }

const routes: Record<string, string> = { company_to_advance: 'บริษัท → เงินทดรอง', self_transfer: 'โอนระหว่างบัญชีเจ้าของเดียวกัน', payroll: 'เงินเดือน/ค่าแรง', vendor_payment: 'ชำระผู้ขาย', internal_transfer: 'โอนภายในบริษัท', review_required: 'ยังไม่ชัดเจน/รอตรวจ' }
const decisions: Record<string, string> = { auto_route: 'ส่งต่ออัตโนมัติ', review: 'ส่งรอตรวจ', exclude: 'ไม่นับ/ไม่สร้างรายการ' }
const destinations: Record<string, string> = { advance_finance: 'เงินทดรอง', payroll: 'เงินเดือน/ค่าแรง', accounting: 'บัญชี', vendor_payables: 'เจ้าหนี้ผู้ขาย', review_queue: 'คิวตรวจ' }
const emptyDraft: Draft = { senderId: '', recipientId: '', routeType: 'review_required', decision: 'review', destination: 'review_queue', priority: '100', reason: '' }
const dateTime = (value: string) => new Date(value).toLocaleString('th-TH')

export function MoneyRoutePolicyPanel() {
  const { currentCompany } = useAuth()
  const companyId = currentCompany?.company_id ?? ''
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [policies, setPolicies] = useState<Policy[]>([])
  const [audits, setAudits] = useState<PolicyAudit[]>([])
  const [selected, setSelected] = useState<Policy | null>(null)
  const [editing, setEditing] = useState<Policy | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ severity: 'success' | 'error' | 'info'; text: string } | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)

  const load = useCallback(async () => {
    if (!companyId) return
    const [a, p, h] = await Promise.all([
      supabase.from('master_bank_accounts').select('id,owner_name,owner_type,bank_name,account_last4').eq('company_id', companyId).eq('verification_status', 'verified').order('owner_name'),
      supabase.from('money_route_policies').select('*').eq('company_id', companyId).order('priority').order('updated_at', { ascending: false }),
      supabase.from('money_route_policy_audit').select('id,policy_id,action,actor_profile_id,reason,created_at').eq('company_id', companyId).order('created_at', { ascending: false }).limit(1000),
    ])
    const error = a.error ?? p.error ?? h.error
    if (error) { setMessage({ severity: 'error', text: userError(error, 'โหลดกฎเส้นทางเงินไม่สำเร็จ') }); return }
    setAccounts((a.data ?? []) as BankAccount[]); setPolicies((p.data ?? []) as Policy[]); setAudits((h.data ?? []) as PolicyAudit[])
  }, [companyId])
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer) }, [load])

  const accountLabel = useCallback((id: string | null, bank: string, last4: string) => {
    const account = accounts.find((row) => row.id === id)
    return account ? `${account.owner_name} · ${account.bank_name ?? 'ไม่ระบุธนาคาร'} · •••• ${account.account_last4}` : `${bank} · •••• ${last4}`
  }, [accounts])
  const selectedAudits = useMemo(() => selected ? audits.filter((row) => row.policy_id === selected.id) : [], [audits, selected])

  const openCreate = () => { setEditing(null); setDraft(emptyDraft); setMessage(null); setFormOpen(true) }
  const openEdit = (row: Policy) => { setEditing(row); setDraft({ senderId: row.sender_master_bank_account_id ?? '', recipientId: row.recipient_master_bank_account_id ?? '', routeType: row.route_type, decision: row.decision, destination: row.destination_module ?? 'review_queue', priority: String(row.priority), reason: row.reason }); setFormOpen(true) }

  const save = async () => {
    if (!draft.senderId || !draft.recipientId || draft.reason.trim().length < 3) { setMessage({ severity: 'error', text: 'เลือกบัญชีทั้ง 2 ฝั่งและระบุเหตุผลอย่างน้อย 3 ตัวอักษร' }); return }
    setSaving(true); setMessage(null)
    const { error } = await supabase.rpc('save_money_route_policy', { target_policy_id: editing?.id ?? null, target_event_key: crypto.randomUUID(), target_sender_master_bank_account_id: draft.senderId, target_recipient_master_bank_account_id: draft.recipientId, target_route_type: draft.routeType, target_decision: draft.decision, target_destination_module: draft.decision === 'auto_route' ? draft.destination : null, target_priority: Number(draft.priority), target_reason: draft.reason.trim(), target_expected_version: editing?.version ?? null })
    setSaving(false)
    if (error) { setMessage({ severity: 'error', text: userError(error, 'บันทึกกฎไม่สำเร็จ') }); return }
    setFormOpen(false); await load(); setMessage({ severity: 'success', text: editing ? 'แก้ไขกฎและบันทึก Version/Audit แล้ว' : 'เพิ่มกฎส่วนกลางแล้ว Module จะใช้กฎนี้กับรายการใหม่' })
  }

  const toggleStatus = async (row: Policy) => {
    const nextStatus = row.status === 'active' ? 'inactive' : 'active'; setSaving(true); setMessage(null)
    const { error } = await supabase.rpc('set_money_route_policy_status', { target_policy_id: row.id, target_event_key: crypto.randomUUID(), target_status: nextStatus, target_expected_version: row.version, target_reason: nextStatus === 'active' ? 'เปิดใช้กฎอีกครั้งโดย Admin' : 'ปิดใช้กฎโดย Admin โดยเก็บประวัติเดิม' })
    setSaving(false)
    if (error) { setMessage({ severity: 'error', text: userError(error, 'เปลี่ยนสถานะกฎไม่สำเร็จ') }); return }
    await load(); setMessage({ severity: 'success', text: nextStatus === 'active' ? 'เปิดใช้กฎแล้ว' : 'ปิดใช้กฎแล้ว ไม่มีการลบประวัติ' })
  }

  return <Paper variant="outlined" sx={{ p: 1.5, borderColor: 'primary.light' }}>
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between', mb: 1.5 }}>
      <Box><Typography variant="h6" sx={{ fontWeight: 800 }}>กฎบัญชีและเส้นทางเงิน</Typography><Typography variant="body2" color="text.secondary">คู่บัญชีเป็นเงื่อนไขหลัก · ชื่อใช้ช่วยแนะนำเท่านั้น · ปิดกฎแทนการลบเพื่อรักษา Audit</Typography></Box>
      <Button variant="contained" startIcon={<AddOutlined />} onClick={openCreate}>เพิ่มกฎ</Button>
    </Stack>
    {message && <Alert severity={message.severity} onClose={() => setMessage(null)} sx={{ mb: 1.5 }}>{message.text}</Alert>}
    <Alert severity="info" sx={{ mb: 1.5 }}>Auto สร้างเงินทดรองเฉพาะกฎ `บริษัท → เงินทดรอง` ที่เลือก `ส่งต่ออัตโนมัติ` เท่านั้น กฎ `ไม่นับ` ใช้กันการโอนเข้าบัญชีตัวเองหรือรายการที่ไม่ใช่เงินทดรอง</Alert>
    <StandardDataTable rows={policies} getRowId={(row) => row.id} getSearchText={(row) => `${accountLabel(row.sender_master_bank_account_id,row.sender_bank_name,row.sender_account_last4)} ${accountLabel(row.recipient_master_bank_account_id,row.recipient_bank_name,row.recipient_account_last4)} ${routes[row.route_type]} ${row.reason}`} searchLabel="ค้นหาบัญชี เจ้าของ หรือเหตุผล" emptyText="ยังไม่มีกฎเส้นทางเงิน" minWidth={1200} columns={[
      { id: 'from', label: 'จากบัญชี', minWidth: 240, render: (row) => accountLabel(row.sender_master_bank_account_id,row.sender_bank_name,row.sender_account_last4) },
      { id: 'to', label: 'ไปบัญชี', minWidth: 240, render: (row) => accountLabel(row.recipient_master_bank_account_id,row.recipient_bank_name,row.recipient_account_last4) },
      { id: 'route', label: 'ประเภทเส้นทาง', minWidth: 190, render: (row) => routes[row.route_type] ?? row.route_type },
      { id: 'decision', label: 'ผลที่ระบบทำ', minWidth: 170, render: (row) => <Chip size="small" color={row.decision === 'exclude' ? 'error' : row.decision === 'auto_route' ? 'success' : 'warning'} label={decisions[row.decision] ?? row.decision} /> },
      { id: 'destination', label: 'ปลายทาง', minWidth: 130, render: (row) => row.destination_module ? destinations[row.destination_module] ?? row.destination_module : '-' },
      { id: 'status', label: 'สถานะ', minWidth: 110, render: (row) => <Chip size="small" color={row.status === 'active' ? 'success' : 'default'} label={row.status === 'active' ? 'ใช้งาน' : 'ปิดใช้'} /> },
      { id: 'version', label: 'Version', minWidth: 130, render: (row) => <Stack><Typography variant="body2">v{row.version}</Typography><Typography variant="caption" color="text.secondary">{dateTime(row.updated_at)}</Typography></Stack> },
      { id: 'actions', label: 'จัดการ', minWidth: 280, render: (row) => <Stack direction="row" spacing={0.5}><Button size="small" startIcon={<EditOutlined />} onClick={() => openEdit(row)}>แก้ไข</Button><Button size="small" startIcon={<HistoryOutlined />} onClick={() => { setSelected(row); setHistoryOpen(true) }}>ประวัติ</Button><Button size="small" color={row.status === 'active' ? 'warning' : 'success'} disabled={saving} startIcon={<PowerSettingsNewOutlined />} onClick={() => void toggleStatus(row)}>{row.status === 'active' ? 'ปิดใช้' : 'เปิดใช้'}</Button></Stack> },
    ]} />
    <Dialog open={formOpen} onClose={() => !saving && setFormOpen(false)} fullWidth maxWidth="md">
      <DialogTitle>{editing ? `แก้ไขกฎ v${editing.version}` : 'เพิ่มกฎเส้นทางเงิน'}</DialogTitle>
      <DialogContent><Stack spacing={1.5} sx={{ pt: 1 }}>
        <TextField select label="บัญชีต้นทางที่ยืนยันแล้ว" value={draft.senderId} onChange={(event) => setDraft({ ...draft, senderId: event.target.value })}>
          {accounts.map((account) => <MenuItem key={account.id} value={account.id}>{account.owner_name} · {account.owner_type} · {account.bank_name ?? 'ไม่ระบุธนาคาร'} · •••• {account.account_last4}</MenuItem>)}
        </TextField>
        <TextField select label="บัญชีปลายทางที่ยืนยันแล้ว" value={draft.recipientId} onChange={(event) => setDraft({ ...draft, recipientId: event.target.value })}>
          {accounts.map((account) => <MenuItem key={account.id} value={account.id}>{account.owner_name} · {account.owner_type} · {account.bank_name ?? 'ไม่ระบุธนาคาร'} · •••• {account.account_last4}</MenuItem>)}
        </TextField>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <TextField fullWidth select label="ประเภทเส้นทาง" value={draft.routeType} onChange={(event) => setDraft({ ...draft, routeType: event.target.value })}>{Object.entries(routes).map(([value,label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField>
          <TextField fullWidth select label="ผลที่ระบบทำ" value={draft.decision} onChange={(event) => setDraft({ ...draft, decision: event.target.value })}>{Object.entries(decisions).map(([value,label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField>
        </Stack>
        {draft.decision === 'auto_route' && <TextField select label="Module ปลายทาง" value={draft.destination} onChange={(event) => setDraft({ ...draft, destination: event.target.value })}>{Object.entries(destinations).map(([value,label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField>}
        <TextField type="number" label="ลำดับความสำคัญ (เลขน้อยทำก่อน)" value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value })} />
        <TextField multiline minRows={2} label="เหตุผล/หลักฐานที่ใช้สร้างกฎ" value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} />
      </Stack></DialogContent>
      <DialogActions><Button onClick={() => setFormOpen(false)}>ยกเลิก</Button><Button variant="contained" disabled={saving || !draft.senderId || !draft.recipientId || draft.reason.trim().length < 3} onClick={() => void save()}>{saving ? 'กำลังบันทึก...' : 'บันทึกกฎ'}</Button></DialogActions>
    </Dialog>
    <Dialog open={historyOpen} onClose={() => setHistoryOpen(false)} fullWidth maxWidth="sm">
      <DialogTitle>ประวัติกฎและ Audit</DialogTitle>
      <DialogContent><Stack spacing={1} sx={{ pt: 1 }}>{selectedAudits.length ? selectedAudits.map((audit) => <Paper key={audit.id} variant="outlined" sx={{ p: 1.25 }}><Stack direction="row" sx={{ justifyContent: 'space-between' }}><Typography sx={{ fontWeight: 700 }}>{audit.action}</Typography><Typography variant="caption">{dateTime(audit.created_at)}</Typography></Stack><Typography variant="body2">{audit.reason}</Typography><Typography variant="caption" color="text.secondary">Actor: {audit.actor_profile_id ?? 'ระบบ'}</Typography></Paper>) : <Alert severity="info">ยังไม่มี Audit</Alert>}</Stack></DialogContent>
      <DialogActions><Button onClick={() => setHistoryOpen(false)}>ปิด</Button></DialogActions>
    </Dialog>
  </Paper>
}
