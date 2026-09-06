import { Box, Button, Chip, Paper, Stack, Typography } from '@mui/material'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { usePageTitle } from '../../hooks/usePageTitle'

type State = 'ใช้แล้ว' | 'เปลี่ยนแปลงแล้ว' | 'รอตรวจ' | 'ไม่ใช้'
type Item = { id: string; name: string; path: string; flow: string; state: State; note: string }
const seed: Item[] = [
  { id: 'financial', name: 'บัญชีและธุรกรรมเงิน', path: '/financial-summary', flow: 'Financial Transaction Center', state: 'เปลี่ยนแปลงแล้ว', note: 'ข้อมูลสองฝั่ง / Drawer / Audit' },
  { id: 'accounting', name: 'เอกสารบัญชีและสลิป', path: '/accounting-documents', flow: 'Accounting Document Confirmation', state: 'ใช้แล้ว', note: 'ตรวจสลิปและจัดสรรปลายทาง' },
  { id: 'advance', name: 'เงินทดรองและผู้ถือเงิน', path: '/advance-settlements', flow: 'Employee Advance Settlement', state: 'ใช้แล้ว', note: 'Ledger และการปิดยอด' },
  { id: 'master', name: 'ข้อมูลกลาง', path: '/master-data', flow: 'Master Data Governance', state: 'ใช้แล้ว', note: 'Candidate และการยืนยันข้อมูล' },
  { id: 'hr', name: 'HR / ลงเวลา', path: '/reports', flow: 'HR Confirmation Bundle', state: 'เปลี่ยนแปลงแล้ว', note: 'สรุปค่าแรงและสถานะการอนุมัติ' },
  { id: 'intake', name: 'Intake / Document Flow', path: '/document-flows', flow: 'Omni-channel Intake', state: 'ใช้แล้ว', note: 'คัดแยกและส่งต่อปลายทาง' },
]
const key = 'wisdomai-system-inventory-v1'
export function SystemInventoryPage() {
  usePageTitle('ตรวจสอบงานระบบ')
  const navigate = useNavigate()
  const [items, setItems] = useState<Item[]>(() => { try { return JSON.parse(localStorage.getItem(key) ?? '') as Item[] || seed } catch { return seed } })
  const counts = useMemo(() => items.reduce<Record<State, number>>((acc, item) => { acc[item.state] += 1; return acc }, { 'ใช้แล้ว': 0, 'เปลี่ยนแปลงแล้ว': 0, 'รอตรวจ': 0, 'ไม่ใช้': 0 }), [items])
  const update = (id: string, state: State) => setItems(current => { const next = current.map(item => item.id === id ? { ...item, state } : item); localStorage.setItem(key, JSON.stringify(next)); return next })
  return <Stack spacing={2.5}>
    <PageHeader title="ตรวจสอบงานระบบ" description="รวม Module, Flow และลิงก์หน้าจอไว้ตรวจทีละส่วน — ยังไม่ลบข้อมูลจนกว่าจะสั่งยืนยัน" action={<Button variant="outlined" onClick={() => { localStorage.removeItem(key); setItems(seed) }}>รีเซ็ตมุมมอง</Button>} />
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,1fr)', md: 'repeat(4,1fr)' }, gap: 1.5 }}>{(['ใช้แล้ว', 'เปลี่ยนแปลงแล้ว', 'รอตรวจ', 'ไม่ใช้'] as State[]).map(state => <Paper key={state} variant="outlined" sx={{ p: 1.5 }}><Typography variant="caption" color="text.secondary">{state}</Typography><Typography variant="h5" sx={{ fontWeight: 800 }}>{counts[state]}</Typography></Paper>)}</Box>
    <Stack spacing={1.25}>{items.map(item => <Paper key={item.id} variant="outlined" sx={{ p: 2 }}><Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'center' } }}><Box sx={{ flex: 1 }}><Typography sx={{ fontWeight: 800 }}>{item.name}</Typography><Typography variant="body2" color="text.secondary">{item.flow} · {item.note}</Typography><Button size="small" onClick={() => navigate(item.path)}>เปิดหน้าจริง</Button></Box><Chip label={item.state} color={item.state === 'ใช้แล้ว' ? 'success' : item.state === 'ไม่ใช้' ? 'default' : 'warning'} /><Stack direction="row" spacing={.5}><Button size="small" onClick={() => update(item.id, 'ใช้แล้ว')}>ใช้</Button><Button size="small" onClick={() => update(item.id, 'รอตรวจ')}>รอตรวจ</Button><Button size="small" color="error" onClick={() => update(item.id, 'ไม่ใช้')}>ไม่ใช้</Button></Stack></Stack></Paper>)}</Stack>
    <Typography variant="caption" color="text.secondary">การเลือกเก็บในหน้านี้เป็นเพียงทะเบียนส่วนตัว ยังไม่มีการลบ branch, worktree หรือข้อมูล Production</Typography>
  </Stack>
}
