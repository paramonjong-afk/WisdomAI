import AccessTimeOutlinedIcon from '@mui/icons-material/AccessTimeOutlined'
import ArrowForwardOutlinedIcon from '@mui/icons-material/ArrowForwardOutlined'
import CheckCircleOutlineOutlinedIcon from '@mui/icons-material/CheckCircleOutlineOutlined'
import ErrorOutlineOutlinedIcon from '@mui/icons-material/ErrorOutlineOutlined'
import FilterAltOutlinedIcon from '@mui/icons-material/FilterAltOutlined'
import HourglassEmptyOutlinedIcon from '@mui/icons-material/HourglassEmptyOutlined'
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined'
import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { loadFlowRegistrySnapshot, type FlowRegistryFilters, type FlowRegistryModule, type FlowRegistryNode, type FlowRegistryRecord, type FlowRegistrySnapshot, type FlowRegistryStatusFilter } from '../../services/flowRegistryGateway'

const isoForDate = (date: Date) => date.toISOString().slice(0, 10)
const startOfDate = (value: string) => new Date(`${value}T00:00:00`).toISOString()
const endOfDate = (value: string) => new Date(`${value}T23:59:59.999`).toISOString()
const ageLabel = (minutes: number) => minutes < 60 ? `${minutes} นาที` : `${Math.floor(minutes / 60)} ชม.`

const statusColor = (status: FlowRegistryNode['status']) => ({ normal: 'success', working: 'info', waiting: 'warning', error: 'error', closed: 'success' }[status] as 'success' | 'info' | 'warning' | 'error')
const statusLabel = (status: FlowRegistryNode['status']) => ({ normal: 'ปกติ', working: 'กำลังทำ', waiting: 'รอ', error: 'ผิดพลาด', closed: 'ปิดแล้ว' }[status])

const nodePredicate = (key: string, record: FlowRegistryRecord) => {
  if (key === 'received') return true
  if (key === 'closed') return record.status === 'closed' || record.stage === 'ปิดงาน'
  if (key === 'analysis') return record.stage === 'วิเคราะห์'
  if (key === 'dedupe') return record.stage === 'ตรวจซ้ำ'
  if (key === 'filter') return record.stage === 'Filter'
  if (key === 'destination') return record.stage === 'ส่งปลายทาง'
  if (key === 'approval') return record.stage === 'อนุมัติ/บันทึก'
  return false
}

function SummaryCard({ label, value, tone, icon }: { label: string; value: number; tone: 'primary' | 'warning' | 'error' | 'success' | 'info'; icon: React.ReactNode }) {
  return <Card variant="outlined" sx={{ flex: 1, minWidth: { xs: '46%', sm: 150 }, borderRadius: 2.5, background: 'linear-gradient(135deg, rgba(255,255,255,.98), rgba(250,245,243,.92))' }}>
    <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', color: `${tone}.main` }}>{icon}<Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800 }}>{label}</Typography></Stack>
      <Typography variant="h4" sx={{ mt: 0.75, fontWeight: 900, letterSpacing: -1 }}>{value.toLocaleString('th-TH')}</Typography>
    </CardContent>
  </Card>
}

function FlowNode({ node, onClick }: { node: FlowRegistryNode; onClick: () => void }) {
  return <Card variant="outlined" onClick={onClick} sx={{ flex: 1, minWidth: { xs: '100%', md: 120 }, cursor: 'pointer', borderRadius: 2.5, borderColor: `${statusColor(node.status)}.main`, boxShadow: node.status === 'working' ? '0 0 0 2px rgba(40,128,160,.08)' : undefined, '@keyframes wisdomPulse': { '0%,100%': { opacity: 0.92 }, '50%': { opacity: 0.58 } }, animation: node.status === 'working' ? 'wisdomPulse 2.6s ease-in-out infinite' : undefined, '&:hover': { transform: 'translateY(-2px)', boxShadow: 3 } }}>
    <CardContent sx={{ p: 1.4, '&:last-child': { pb: 1.4 } }}>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', justifyContent: 'space-between' }}><Typography variant="caption" sx={{ fontWeight: 900 }}>{node.label}</Typography><Chip size="small" color={statusColor(node.status)} label={statusLabel(node.status)} sx={{ height: 20, fontSize: 10 }} /></Stack>
      <Typography variant="h5" sx={{ mt: 0.75, fontWeight: 900 }}>{node.count.toLocaleString('th-TH')}</Typography>
      <Typography variant="caption" color="text.secondary">ค้างสูงสุด {ageLabel(node.maxAgeMinutes)}</Typography>
    </CardContent>
  </Card>
}

export function FlowRegistryDashboard() {
  const { currentCompany } = useAuth()
  const companyId = currentCompany?.company_id ?? ''
  const today = isoForDate(new Date())
  const [fromDate, setFromDate] = useState(today)
  const [toDate, setToDate] = useState(today)
  const [module, setModule] = useState<FlowRegistryFilters['module']>('all')
  const [status, setStatus] = useState<FlowRegistryStatusFilter>('all')
  const [source, setSource] = useState('')
  const [owner, setOwner] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [snapshot, setSnapshot] = useState<FlowRegistrySnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedLabel, setSelectedLabel] = useState('')

  const filters = useMemo<FlowRegistryFilters>(() => ({ companyId, from: startOfDate(fromDate), to: endOfDate(toDate), module, status, source, owner }), [companyId, fromDate, module, owner, source, status, toDate])
  const load = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    setError('')
    setSnapshot(null)
    try {
      setSnapshot(await loadFlowRegistrySnapshot(filters))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'อ่านข้อมูล Flow ไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [companyId, filters])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])
  useEffect(() => {
    if (!autoRefresh || !companyId) return
    const timer = window.setInterval(() => void load(), 30000)
    return () => window.clearInterval(timer)
  }, [autoRefresh, companyId, load])

  const detailRecords = useMemo(() => {
    if (!snapshot || !selectedLabel) return []
    const node = snapshot.nodes.find((item) => item.label === selectedLabel)
    if (node) return snapshot.records.filter((record) => nodePredicate(node.key, record)).slice(0, 100)
    const exception = snapshot.exceptions.find((item) => item.label === selectedLabel)
    if (exception?.key === 'duplicate') return snapshot.records.filter((record) => record.error === 'possible_duplicate' || record.stage === 'ตรวจซ้ำ').slice(0, 100)
    if (exception?.key === 'rejected') return snapshot.records.filter((record) => record.error === 'rejected').slice(0, 100)
    if (exception?.key === 'waiting_info') return snapshot.records.filter((record) => record.status === 'waiting').slice(0, 100)
    if (exception?.key === 'delivery_failed') return snapshot.records.filter((record) => record.error?.includes('failed')).slice(0, 100)
    if (exception?.key === 'retry') return snapshot.records.filter((record) => record.nextAction.toLowerCase().includes('retry')).slice(0, 100)
    return snapshot.records.filter((record) => record.destination === selectedLabel || record.destination.includes(selectedLabel)).slice(0, 100)
  }, [selectedLabel, snapshot])

  return <Stack spacing={1.5}>
    <PaperLike sx={{ p: { xs: 1.5, md: 2 }, background: 'linear-gradient(135deg, #2b2525 0%, #513d39 52%, #a65940 100%)', color: 'common.white', overflow: 'hidden', position: 'relative' }}>
      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5} sx={{ alignItems: { lg: 'center' }, justifyContent: 'space-between' }}>
        <Box><Typography variant="overline" sx={{ letterSpacing: 1.4, opacity: 0.8 }}>WISDOM POWER · COMMAND CENTER</Typography><Typography variant="h5" sx={{ fontWeight: 900 }}>Flow Registry Live Dashboard</Typography><Typography variant="body2" sx={{ mt: 0.25, opacity: 0.82 }}>เห็นเส้นทางจริงจาก Intake → ปลายทาง → ปิดงาน ตาม company และสิทธิ์ปัจจุบัน</Typography></Box>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}><Chip label={`บริษัท: ${currentCompany?.company_name ?? 'ยังไม่เลือก'}`} sx={{ color: 'common.white', borderColor: 'rgba(255,255,255,.45)' }} variant="outlined" /><Chip label={autoRefresh ? 'Auto refresh 30s' : 'Manual refresh'} onClick={() => setAutoRefresh((value) => !value)} sx={{ color: 'common.white', borderColor: 'rgba(255,255,255,.45)', cursor: 'pointer' }} variant="outlined" /><Button size="small" variant="contained" onClick={() => void load()} startIcon={<RefreshOutlinedIcon />} sx={{ bgcolor: 'rgba(255,255,255,.18)', color: 'common.white', '&:hover': { bgcolor: 'rgba(255,255,255,.28)' } }}>รีเฟรช</Button></Stack>
      </Stack>
    </PaperLike>

    <PaperLike sx={{ p: 1.25 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ alignItems: { md: 'center' }, flexWrap: 'wrap' }}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}><FilterAltOutlinedIcon color="primary" /><Typography variant="subtitle2" sx={{ fontWeight: 900 }}>ตัวกรองข้อมูลจริง</Typography></Stack>
        <TextField size="small" type="date" label="ตั้งแต่" value={fromDate} onChange={(event) => setFromDate(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} sx={{ minWidth: 160 }} />
        <TextField size="small" type="date" label="ถึง" value={toDate} onChange={(event) => setToDate(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} sx={{ minWidth: 160 }} />
        <FormControl size="small" sx={{ minWidth: 145 }}><InputLabel>Module</InputLabel><Select value={module} label="Module" onChange={(event) => setModule(event.target.value as FlowRegistryModule | 'all')}><MenuItem value="all">ทุก Module</MenuItem><MenuItem value="omni">Omni / Intake</MenuItem><MenuItem value="attendance">ลงเวลา / HR</MenuItem><MenuItem value="advance">เงินสำรองจ่าย</MenuItem></Select></FormControl>
        <FormControl size="small" sx={{ minWidth: 135 }}><InputLabel>สถานะ</InputLabel><Select value={status} label="สถานะ" onChange={(event) => setStatus(event.target.value as FlowRegistryStatusFilter)}><MenuItem value="all">ทุกสถานะ</MenuItem><MenuItem value="open">กำลังทำ</MenuItem><MenuItem value="waiting">รอข้อมูล</MenuItem><MenuItem value="error">ผิดพลาด</MenuItem><MenuItem value="closed">ปิดแล้ว</MenuItem></Select></FormControl>
        <TextField size="small" label="Source / Document ID" value={source} onChange={(event) => setSource(event.target.value)} sx={{ minWidth: 190 }} />
        <TextField size="small" label="ผู้รับผิดชอบ" value={owner} onChange={(event) => setOwner(event.target.value)} sx={{ minWidth: 155 }} />
        {(source || owner || module !== 'all' || status !== 'all') && <Button size="small" onClick={() => { setSource(''); setOwner(''); setModule('all'); setStatus('all') }}>ล้างตัวกรอง</Button>}
        <Typography variant="caption" color="text.secondary" sx={{ ml: { md: 'auto' } }}>ช่วงเวลาคำนวณจาก created_at ของแต่ละ registry</Typography>
      </Stack>
    </PaperLike>

    {!companyId && <Alert severity="warning">กรุณาเลือกบริษัทก่อนดูข้อมูล Flow</Alert>}
    {error && <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void load()}>ลองใหม่</Button>}>{error}</Alert>}
    {loading && <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 200 }}><CircularProgress /></Box>}
    {!loading && snapshot && <>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
        <SummaryCard label="รับเข้าวันนี้" value={snapshot.receivedToday} tone="primary" icon={<FilterAltOutlinedIcon fontSize="small" />} />
        <SummaryCard label="กำลังตรวจ" value={snapshot.underReview} tone="info" icon={<HourglassEmptyOutlinedIcon fontSize="small" />} />
        <SummaryCard label="รอข้อมูล" value={snapshot.waitingForInfo} tone="warning" icon={<AccessTimeOutlinedIcon fontSize="small" />} />
        <SummaryCard label="ส่งต่อแล้ว" value={snapshot.forwarded} tone="primary" icon={<ArrowForwardOutlinedIcon fontSize="small" />} />
        <SummaryCard label="ค้างเกิน SLA" value={snapshot.slaBreached} tone="error" icon={<ErrorOutlineOutlinedIcon fontSize="small" />} />
        <SummaryCard label="ปิดสำเร็จ" value={snapshot.closedSuccessfully} tone="success" icon={<CheckCircleOutlineOutlinedIcon fontSize="small" />} />
      </Stack>

      <PaperLike sx={{ p: { xs: 1.25, md: 1.75 } }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}><Typography variant="subtitle1" sx={{ fontWeight: 900 }}>เส้นทางงานจริง</Typography><Typography variant="caption" color="text.secondary">คลิก Node เพื่อ Drill-down รายการ</Typography></Stack>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={{ xs: 0.75, md: 0.5 }} sx={{ mt: 1.5, alignItems: 'stretch' }}>
          {snapshot.nodes.map((node, index) => <Box key={node.key} sx={{ display: 'flex', flex: 1, alignItems: 'center', minWidth: 0 }}><FlowNode node={node} onClick={() => setSelectedLabel(node.label)} />{index < snapshot.nodes.length - 1 && <ArrowForwardOutlinedIcon sx={{ display: { xs: 'none', md: 'block' }, mx: 0.2, color: 'text.disabled' }} />}</Box>)}
        </Stack>
      </PaperLike>

      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5}>
        <PaperLike sx={{ p: 1.5, flex: 1 }}><Typography variant="subtitle1" sx={{ fontWeight: 900 }}>ปลายทาง</Typography><Typography variant="caption" color="text.secondary">ยอดจาก suggested department / delivery registry</Typography><Stack spacing={0.75} sx={{ mt: 1 }}>{snapshot.destinations.length === 0 ? <Typography variant="body2" color="text.secondary">ยังไม่มีรายการปลายทางในช่วงนี้</Typography> : snapshot.destinations.slice(0, 8).map((destination) => <Button key={destination.key} onClick={() => setSelectedLabel(destination.label)} sx={{ justifyContent: 'space-between', textTransform: 'none', border: '1px solid', borderColor: 'divider', borderRadius: 1.5, px: 1.25 }}><Typography variant="body2">{destination.label}</Typography><Chip size="small" color={destination.status === 'error' ? 'error' : 'default'} label={destination.count} /></Button>)}</Stack></PaperLike>
        <PaperLike sx={{ p: 1.5, flex: 1 }}><Typography variant="subtitle1" sx={{ fontWeight: 900 }}>Exception Lane</Typography><Typography variant="caption" color="text.secondary">รายการที่ต้องตามต่อ ไม่ถูกซ่อนจากตัวเลขรวม</Typography><Stack spacing={0.75} sx={{ mt: 1 }}>{snapshot.exceptions.map((exception) => <Button key={exception.key} onClick={() => setSelectedLabel(exception.label)} sx={{ justifyContent: 'space-between', textTransform: 'none', border: '1px solid', borderColor: 'divider', borderRadius: 1.5, px: 1.25 }}><Typography variant="body2">{exception.label}</Typography><Chip size="small" color={exception.status === 'error' ? 'error' : 'warning'} label={exception.count} /></Button>)}</Stack></PaperLike>
      </Stack>

      {snapshot.sourceWarnings.length > 0 && <Alert severity="warning"><b>แหล่งข้อมูลที่ยังไม่พร้อม:</b> {snapshot.sourceWarnings.join(' · ')}</Alert>}
      <Alert severity={snapshot.reconciliation.consistent ? 'success' : 'error'}>
        Count reconciliation: {snapshot.reconciliation.rowCount.toLocaleString('th-TH')} rows · เปิด {snapshot.reconciliation.open.toLocaleString('th-TH')} · ปิด {snapshot.reconciliation.closed.toLocaleString('th-TH')} · ส่งต่อ {snapshot.reconciliation.forwarded.toLocaleString('th-TH')} {snapshot.reconciliation.consistent ? 'ตรงกัน' : 'ไม่ตรงกัน ต้องตรวจ source'}
      </Alert>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Last updated: {new Date(snapshot.lastUpdated).toLocaleString('th-TH')}</Typography><Button component={RouterLink} to="/document-flows" size="small" variant="outlined">เปิดรายการ Intake / Audit ทั้งหมด</Button></Stack>
    </>}

    <Dialog open={Boolean(selectedLabel)} onClose={() => setSelectedLabel('')} fullWidth maxWidth="md"><DialogTitle>Drill-down · {selectedLabel}</DialogTitle><DialogContent dividers>{detailRecords.length === 0 ? <Alert severity="info">ไม่พบรายการจริงตามตัวกรองนี้</Alert> : <Stack spacing={0.75}>{detailRecords.map((record) => <Card key={`${record.module}-${record.id}`} variant="outlined"><CardContent sx={{ p: 1.25, '&:last-child': { pb: 1.25 } }}><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'space-between' }}><Box sx={{ minWidth: 0 }}><Typography variant="body2" sx={{ fontWeight: 800 }}>{record.title}</Typography><Typography variant="caption" color="text.secondary">{record.module} · Task {record.taskId} · ผู้รับผิดชอบ {record.owner}</Typography></Box><Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}><Chip size="small" label={record.status} color={record.status === 'error' ? 'error' : record.status === 'waiting' ? 'warning' : record.status === 'closed' ? 'success' : 'info'} /><Typography variant="caption" color="text.secondary">ค้าง {ageLabel(record.ageMinutes)}</Typography></Stack></Stack>{record.error && <Typography variant="caption" color="error">Error: {record.error}</Typography>}<Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>Source: {record.sourceRefs.join(', ') || '-' } · Evidence: {record.evidenceRefs.join(', ') || '-'} · Audit: {record.auditRefs.join(', ') || '-'}</Typography><Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>SLA: {record.slaDueAt ? new Date(record.slaDueAt).toLocaleString('th-TH') : 'ยังไม่กำหนด'} · สิ่งที่ต้องทำต่อ: {record.nextAction}{record.blocker ? ` · Blocker: ${record.blocker}` : ''}</Typography><Divider sx={{ my: 0.75 }} /><Typography variant="caption" color="text.secondary">สร้าง {new Date(record.createdAt).toLocaleString('th-TH')} · อัปเดต {new Date(record.updatedAt).toLocaleString('th-TH')}</Typography></CardContent></Card>)}</Stack>}</DialogContent><DialogActions><Button onClick={() => setSelectedLabel('')}>ปิด</Button><Button component={RouterLink} to={detailRecords[0] ? `${detailRecords[0].detailPath}?task_id=${encodeURIComponent(detailRecords[0].taskId)}&source_id=${encodeURIComponent(detailRecords[0].sourceId ?? '')}&audit_key=${encodeURIComponent(detailRecords[0].auditKey)}` : '/document-flows'} variant="contained" onClick={() => setSelectedLabel('')}>เปิดหน้า Detail / Audit</Button></DialogActions></Dialog>
  </Stack>
}

function PaperLike({ children, sx }: { children: React.ReactNode; sx?: Record<string, unknown> }) {
  return <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2.5, bgcolor: 'background.paper', ...sx }}>{children}</Box>
}
