import { CloseOutlined, OpenInNewOutlined, RefreshOutlined } from '@mui/icons-material'
import { Alert, Box, Button, Chip, CircularProgress, Drawer, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { documentFlowGateway } from '../../services/documentFlowGateway'
import { advanceReportGateway, calculateAdvanceBalance, filterAdvanceRows, summarizeAdvanceRows, type AdvanceDuplicateFilter, type AdvanceReportAction, type AdvanceReportRow, type AdvanceReportStatus } from '../../services/advanceReportGateway'
import { userError } from '../../utils/userError'

const statusLabels: Record<AdvanceReportStatus, string> = {
  draft: 'รอแตกยอด', collecting_evidence: 'กำลังรวบรวมหลักฐาน', submitted: 'ส่งตรวจแล้ว', under_review: 'กำลังตรวจ', approved: 'อนุมัติแล้ว', settlement_required: 'รอปิดยอด', closed: 'ปิดยอดแล้ว', returned: 'ส่งกลับแก้ไข', cancelled: 'ยกเลิก',
}
const money = (value: number | null | undefined) => Number(value ?? 0).toLocaleString('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 2 })
const dateText = (value: string | null | undefined) => value ? new Date(value).toLocaleString('th-TH') : '-'
const dateOnly = (value: string | null | undefined) => value ? new Date(value).toLocaleDateString('th-TH') : '-'
const statusColor = (status: AdvanceReportStatus) => status === 'closed' ? 'success' : status === 'returned' || status === 'cancelled' ? 'error' : status === 'approved' ? 'info' : 'warning'

export function AdvancePaymentReportPage() {
  usePageTitle('รายงานเงินสำรองจ่ายช่าง')
  const { profile, currentCompany } = useAuth()
  const canManage = profile?.role === 'admin' || profile?.role === 'manager'
  const companyId = currentCompany?.company_id ?? ''
  const [from, setFrom] = useState('2026-08-16')
  const [to, setTo] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }))
  const [status, setStatus] = useState<AdvanceReportStatus | ''>('')
  const [duplicate, setDuplicate] = useState<AdvanceDuplicateFilter>('all')
  const [rows, setRows] = useState<AdvanceReportRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedHolder, setSelectedHolder] = useState<string | null>(null)
  const [selected, setSelected] = useState<AdvanceReportRow | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewMessage, setPreviewMessage] = useState('')
  const [action, setAction] = useState<AdvanceReportAction | null>(null)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!companyId || !canManage) return
    setLoading(true); setError('')
    const result = await advanceReportGateway.list(companyId, from, to, undefined, status || undefined)
    if (result.error) setError(userError(result.error))
    else setRows(result.data)
    setLoading(false)
  }, [canManage, companyId, from, status, to])

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer) }, [load])

  const viewRows = useMemo(() => filterAdvanceRows(rows, { duplicate }), [duplicate, rows])
  const summaries = useMemo(() => summarizeAdvanceRows(viewRows), [viewRows])

  const drillRows = useMemo(() => viewRows.filter((row) => (row.holder_name ?? row.transaction?.recipient_name ?? 'ยังจับคู่ชื่อไม่ได้') === selectedHolder), [selectedHolder, viewRows])
  const totalReceived = viewRows.reduce((sum, row) => sum + Number(row.amount_received), 0)
  const totalOutstanding = viewRows.reduce((sum, row) => sum + calculateAdvanceBalance(row).outstanding, 0)

  const openDetail = async (row: AdvanceReportRow) => {
    setSelected(row); setPreviewUrl(''); setPreviewMessage('')
    const preview = await documentFlowGateway.preview(row.source_flow_item_id)
    const file = (preview.data as { files?: { bucket: string; path: string; content_type?: string | null }[] } | null)?.files?.[0]
    if (preview.error || !file) { setPreviewMessage('ไม่พบรูปสลิปที่ผูกกับ Document Flow รายการนี้'); return }
    const signed = await documentFlowGateway.signedPreviewUrl(file.bucket, file.path)
    if (signed.error || !signed.data?.signedUrl) setPreviewMessage('สร้างลิงก์รูปสลิปไม่สำเร็จ')
    else setPreviewUrl(signed.data.signedUrl)
  }

  const executeAction = async () => {
    if (!selected || !action || !profile?.id) return
    if (action === 'return' && !reason.trim()) { setError('การส่งกลับต้องมีเหตุผล'); return }
    setSaving(true); setError('')
    const result = await advanceReportGateway.transition({ caseId: selected.id, action, expectedVersion: selected.version, reason: reason.trim() || null, eventKey: crypto.randomUUID() })
    if (result.error) setError(userError(result.error))
    else { setAction(null); setReason(''); await load(); const refreshed = await advanceReportGateway.detail(companyId, selected.id); setSelected(refreshed.data) }
    setSaving(false)
  }

  if (!canManage) return <Alert severity="warning">หน้านี้เปิดให้ Admin และ Manager</Alert>

  return <Stack spacing={2.5}>
    <Stack direction={{ xs: 'column', md: 'row' }} sx={{ justifyContent: 'space-between', gap: 2 }}><Box><Typography variant="h4" sx={{ fontWeight: 800 }}>รายงานเงินสำรองจ่ายช่าง</Typography><Typography color="text.secondary">อ่านจากรายการเงินจริง: สลิป → Intake/Document Flow → เงินทดรอง → รายการค่าแรงและปิดยอด</Typography></Box><Button startIcon={<RefreshOutlined />} onClick={() => void load()}>รีเฟรช</Button></Stack>
    {error && <Alert severity="error">{error}</Alert>}
    <Paper variant="outlined" sx={{ p: 2 }}><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'end' }}><TextField type="date" label="ตั้งแต่" value={from} onChange={(event) => setFrom(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} /><TextField type="date" label="ถึง" value={to} onChange={(event) => setTo(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} /><TextField select label="สถานะ" value={status} onChange={(event) => setStatus(event.target.value as AdvanceReportStatus | '')} sx={{ minWidth: 200 }}><MenuItem value="">ทุกสถานะ</MenuItem>{Object.entries(statusLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField><TextField select label="ตรวจซ้ำ" value={duplicate} onChange={(event) => setDuplicate(event.target.value as AdvanceDuplicateFilter)} sx={{ minWidth: 170 }}><MenuItem value="all">ทั้งหมด</MenuItem><MenuItem value="clean">ผ่านตรวจซ้ำ</MenuItem><MenuItem value="duplicate">พบรายการซ้ำ</MenuItem></TextField><Button variant="contained" onClick={() => void load()}>ค้นหา</Button></Stack></Paper>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}><Metric label="รายการทั้งหมด" value={`${rows.length} รายการ`} /><Metric label="ยอดรับล่วงหน้า" value={money(totalReceived)} /><Metric label="คงค้างตามรายการ" value={money(totalOutstanding)} /></Stack>
    <Paper variant="outlined" sx={{ p: 2 }}><Typography variant="h6" sx={{ fontWeight: 800, mb: 1 }}>สรุปตามช่าง</Typography>{loading ? <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}><CircularProgress /></Box> : <Box sx={{ overflowX: 'auto' }}><Table size="small"><TableHead><TableRow><TableCell>ช่าง/ผู้รับเงิน</TableCell><TableCell align="right">ครั้ง</TableCell><TableCell align="right">ยอดรวม</TableCell><TableCell align="right">อนุมัติแล้ว</TableCell><TableCell align="right">รอตรวจ</TableCell><TableCell align="right">ส่งกลับ</TableCell><TableCell align="right">ปิดยอดแล้ว</TableCell></TableRow></TableHead><TableBody>{summaries.map((summary) => <TableRow key={summary.holder} hover onClick={() => setSelectedHolder(summary.holder)} sx={{ cursor: 'pointer' }}><TableCell sx={{ fontWeight: 700 }}>{summary.holder}</TableCell><TableCell align="right">{summary.count}</TableCell><TableCell align="right">{money(summary.total)}</TableCell><TableCell align="right">{money(summary.approved)}</TableCell><TableCell align="right">{money(summary.pending)}</TableCell><TableCell align="right">{money(summary.returned)}</TableCell><TableCell align="right">{money(summary.closed)}</TableCell></TableRow>)}</TableBody></Table>{!summaries.length && <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>ไม่พบรายการช่วงวันที่นี้</Typography>}</Box>}</Paper>
    {selectedHolder && <Paper variant="outlined" sx={{ p: 2 }}><Stack direction="row" sx={{ justifyContent: 'space-between', mb: 1 }}><Typography variant="h6" sx={{ fontWeight: 800 }}>รายการรายวัน: {selectedHolder}</Typography><Button onClick={() => setSelectedHolder(null)}>ปิดรายการ</Button></Stack><Box sx={{ overflowX: 'auto' }}><Table size="small"><TableHead><TableRow><TableCell>วันที่</TableCell><TableCell>Advance ID</TableCell><TableCell>โครงการ</TableCell><TableCell align="right">ยอด</TableCell><TableCell>สถานะ</TableCell><TableCell>ดู Detail</TableCell></TableRow></TableHead><TableBody>{drillRows.map((row) => <TableRow key={row.id} hover><TableCell>{dateOnly(row.received_at)}</TableCell><TableCell><Typography sx={{ fontWeight: 700 }}>{row.advance_number}</Typography><Typography variant="caption" color="text.secondary">{row.id}</Typography></TableCell><TableCell>{row.project_name ?? 'ไม่ระบุ'}</TableCell><TableCell align="right">{money(row.amount_received)}</TableCell><TableCell><Chip size="small" color={statusColor(row.status)} label={statusLabels[row.status]} /></TableCell><TableCell><Button size="small" variant="outlined" onClick={() => void openDetail(row)}>Detail</Button></TableCell></TableRow>)}</TableBody></Table></Box></Paper>}
    <Drawer anchor="right" open={Boolean(selected)} onClose={() => setSelected(null)} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 620 }, maxWidth: '100vw' } } }}><Stack sx={{ height: '100%' }}><Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', p: 2, borderBottom: 1, borderColor: 'divider' }}><Box><Typography variant="h6" sx={{ fontWeight: 800 }}>{selected?.advance_number}</Typography><Typography variant="body2" color="text.secondary">Detail สลิปและเส้นทางเอกสาร</Typography></Box><Button aria-label="ปิด Detail" onClick={() => setSelected(null)}><CloseOutlined /></Button></Stack><Box sx={{ p: 2, overflowY: 'auto', flex: 1 }}>{selected && <Stack spacing={1.5}><Paper variant="outlined" sx={{ p: 1.5 }}><Typography sx={{ fontWeight: 800 }}>ข้อมูลรายการ</Typography><Typography>ผู้รับ: {selected.holder_name ?? 'ยังจับคู่ไม่ได้'}</Typography><Typography>ยอดโอน: {money(selected.amount_received)} · วันที่: {dateText(selected.received_at)}</Typography><Typography>เลขอ้างอิง: {selected.bank_reference ?? selected.transaction?.bank_reference ?? 'ไม่ระบุ'}</Typography><Typography>ต้นทาง: {selected.source_flow?.current_flow ?? 'ไม่ระบุ'} / {selected.source_flow?.current_room ?? 'ไม่ระบุ'} / {selected.source_flow?.state ?? 'ไม่ระบุ'}</Typography></Paper><Paper variant="outlined" sx={{ p: 1.5 }}><Typography sx={{ fontWeight: 800 }}>คู่โอนจาก financial_transactions</Typography><Typography>ผู้โอน: {selected.transaction?.sender_name ?? 'ไม่ระบุ'} · {selected.transaction?.sender_bank_name ?? 'ไม่ระบุ'}</Typography><Typography>ผู้รับตามสลิป: {selected.transaction?.recipient_name ?? 'ไม่ระบุ'} · {selected.transaction?.recipient_bank_name ?? 'ไม่ระบุ'}</Typography><Typography>ความมั่นใจ: {selected.transaction?.payment_party_confidence == null ? 'ไม่ระบุ' : `${Math.round(selected.transaction.payment_party_confidence * 100)}%`} · ตรวจซ้ำ: {selected.transaction?.review_status ?? 'ไม่ระบุ'}</Typography></Paper><Paper variant="outlined" sx={{ p: 1.5 }}><Typography sx={{ fontWeight: 800 }}>รูปสลิป</Typography>{previewMessage && <Alert severity="info" sx={{ mt: 1 }}>{previewMessage}</Alert>}{previewUrl && <Stack spacing={1} sx={{ mt: 1 }}><Button component="a" href={previewUrl} target="_blank" rel="noreferrer" endIcon={<OpenInNewOutlined />}>เปิดรูปในแท็บใหม่</Button><Box component="img" src={previewUrl} alt="สลิปโอนเงิน" sx={{ width: '100%', maxHeight: 360, objectFit: 'contain', bgcolor: 'grey.100', borderRadius: 1 }} /></Stack>}</Paper><Paper variant="outlined" sx={{ p: 1.5 }}><Typography sx={{ fontWeight: 800 }}>ยอดตัดกับค่าแรง</Typography>{(() => { const balance = calculateAdvanceBalance(selected); return <Typography>ใช้จ่ายอนุมัติ {money(balance.used)} · คืนเงิน {money(balance.cashReturn)} · หักเงินเดือน {money(balance.payrollOffset)} · คงค้าง {money(balance.outstanding)}</Typography> })()} {(selected.settlement_items ?? []).map((item) => <Typography key={item.id} variant="body2">{item.expense_date} · {item.expense_type} · {money(item.amount)} · {item.description}</Typography>)}</Paper><Paper variant="outlined" sx={{ p: 1.5 }}><Typography sx={{ fontWeight: 800 }}>Document history</Typography>{selected.audit.map((event) => <Box key={event.id} sx={{ py: .75, borderBottom: 1, borderColor: 'divider' }}><Typography>{event.action}</Typography><Typography variant="caption" color="text.secondary">{dateText(event.created_at)}{event.reason ? ` · ${event.reason}` : ''}</Typography></Box>)}</Paper></Stack>}</Box><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}><Button disabled={!selected || saving || selected?.status !== 'submitted'} onClick={() => setAction('approve')}>อนุมัติ</Button><Button color="warning" disabled={!selected || saving || !['submitted', 'under_review'].includes(selected?.status ?? '')} onClick={() => setAction('return')}>ส่งกลับ</Button><Button variant="contained" disabled={!selected || saving || selected?.status !== 'approved'} onClick={() => setAction('close')}>ปิดยอด</Button><Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>Reject สลิปทำที่ Intake/Document Flow เพื่อคงสถานะต้นทาง</Typography></Stack></Stack></Drawer>
    {action && <Drawer anchor="bottom" open onClose={() => !saving && setAction(null)}><Stack spacing={1.5} sx={{ p: 2, maxWidth: 620, width: '100%', mx: 'auto' }}><Typography variant="h6">{action === 'approve' ? 'อนุมัติรายการ' : action === 'return' ? 'ส่งกลับแก้ไข' : 'ปิดยอดรายการ'}</Typography><TextField multiline minRows={2} label={action === 'approve' ? 'หมายเหตุ (ถ้ามี)' : 'เหตุผล'} value={reason} onChange={(event) => setReason(event.target.value)} required={action !== 'approve'} /><Stack direction="row" spacing={1} sx={{ justifyContent: 'end' }}><Button onClick={() => setAction(null)}>ยกเลิก</Button><Button variant="contained" disabled={saving || (action !== 'approve' && !reason.trim())} onClick={() => void executeAction()}>ยืนยัน</Button></Stack></Stack></Drawer>}
  </Stack>
}

function Metric({ label, value }: { label: string; value: string }) { return <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 180 }}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant="h6" sx={{ fontWeight: 800 }}>{value}</Typography></Paper> }
