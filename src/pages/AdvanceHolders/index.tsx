import { AddOutlined, RefreshOutlined } from '@mui/icons-material'
import { Alert, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
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

  return <Stack spacing={2}>
    <PageHeader title="ทะเบียนผู้ถือเงินสำรองจ่าย" description="เพิ่มเฉพาะชื่อผู้ถือเงิน ระบบจะอ่านข้อมูลบัญชีจากสลิป และเรียนรู้ชื่อภาษาอังกฤษ/ชื่อสะกดต่างกันเมื่อ Admin ยืนยันครั้งแรก" action={<Stack direction="row" spacing={1}><Button startIcon={<RefreshOutlined />} onClick={() => void load()}>รีเฟรช</Button><Button variant="contained" startIcon={<AddOutlined />} onClick={() => setOpen(true)}>เพิ่มผู้ถือเงิน</Button></Stack>} />
    {error && <Alert severity="error">{error}</Alert>}
    <StandardDataTable rows={holders} getRowId={(row) => row.id} onRowClick={setSelected} getSearchText={(row) => `${row.display_name} ${(row.employee_advance_holder_aliases ?? []).map((item) => item.alias_name).join(' ')}`} searchLabel="ค้นหาชื่อผู้ถือเงินหรือชื่อ alias" emptyText="ยังไม่มีผู้ถือเงินสำรองจ่ายที่ลงทะเบียน" minWidth={650} columns={[
      { id: 'name', label: 'ผู้ถือเงิน', minWidth: 220, render: (row) => row.display_name },
      { id: 'aliases', label: 'ชื่อที่ใช้จับคู่', minWidth: 260, render: (row) => (row.employee_advance_holder_aliases ?? []).length ? (row.employee_advance_holder_aliases ?? []).map((item) => <Chip key={item.id} size="small" sx={{ mr: 0.5 }} label={item.alias_name} />) : '-' },
      { id: 'active', label: 'สถานะ', minWidth: 130, render: (row) => <Chip size="small" color={row.is_active ? 'success' : 'default'} label={row.is_active ? 'พร้อมจับคู่' : 'ปิดใช้งาน'} /> },
    ]} />
    <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm"><DialogTitle>เพิ่มผู้ถือเงินสำรองจ่าย</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}><TextField select label="ชื่อพนักงานรายเดือน" value={form.candidate} onChange={(event) => setForm({ ...form, candidate: event.target.value })}>{candidates.map((candidate) => <MenuItem key={`${candidate.kind}:${candidate.id}`} value={`${candidate.kind}:${candidate.id}`}>{candidate.name}</MenuItem>)}</TextField><TextField select label="สถานะ" value={form.active} onChange={(event) => setForm({ ...form, active: event.target.value })}><MenuItem value="true">พร้อมจับคู่</MenuItem><MenuItem value="false">ปิดใช้งาน</MenuItem></TextField></Stack></DialogContent><DialogActions><Button onClick={() => setOpen(false)}>ยกเลิก</Button><Button disabled={saving || !form.candidate} variant="contained" onClick={() => void saveHolder()}>บันทึกชื่อ</Button></DialogActions></Dialog>
    <Dialog open={Boolean(selected)} onClose={() => setSelected(null)} fullWidth maxWidth="sm"><DialogTitle>{selected?.display_name}</DialogTitle><DialogContent><Stack spacing={1.5} sx={{ pt: 1 }}><Typography variant="body2" color="text.secondary">เมื่อ Admin ยืนยันชื่อที่ระบบแนะนำจากสลิป ระบบจะเรียนรู้ชื่อ alias ให้อัตโนมัติ คุณสามารถเพิ่ม alias เองได้ที่นี่เช่นกัน</Typography><TextField label="ชื่อ alias" value={alias} onChange={(event) => setAlias(event.target.value)} /></Stack></DialogContent><DialogActions><Button onClick={() => setSelected(null)}>ปิด</Button><Button disabled={saving || alias.trim().length < 2} variant="contained" onClick={() => void addAlias()}>เพิ่มชื่อจับคู่</Button></DialogActions></Dialog>
  </Stack>
}
