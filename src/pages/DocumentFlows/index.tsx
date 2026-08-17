import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined'
import PlayArrowOutlinedIcon from '@mui/icons-material/PlayArrowOutlined'
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined'
import RouteOutlinedIcon from '@mui/icons-material/RouteOutlined'
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, IconButton, InputLabel, MenuItem, Paper, Select, Stack, Tab, Tabs, Tooltip, Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'

type Flow = 'intake' | 'filter' | 'posting'
type FlowItem = {
  id: string
  intake_id: string
  review_case_id: string | null
  accounting_document_id: string | null
  current_flow: Flow | 'completed'
  current_room: string
  state: string
  document_type: string | null
  route_target: string | null
  confidence: number | null
  auto_routed: boolean
  issue_codes: string[]
  vendor_name: string | null
  total_amount: number | null
  version: number
  last_error: string | null
  created_at: string
  updated_at: string
  projects: { name: string } | null
}
type FlowEvent = {
  id: string
  event_type: string
  from_flow: string | null
  to_flow: string | null
  from_state: string | null
  to_state: string | null
  note: string | null
  created_at: string
}

const typeLabels: Record<string, string> = {
  quotation: 'ใบเสนอราคา', purchase_order: 'ใบสั่งซื้อ', goods_receipt: 'ใบรับสินค้า',
  delivery_note: 'ใบส่งสินค้า', billing_note: 'ใบวางบิล', invoice: 'ใบแจ้งหนี้',
  receipt: 'ใบเสร็จรับเงิน', tax_invoice_full: 'ใบกำกับภาษีเต็มรูป',
  tax_invoice_abbreviated: 'ใบกำกับภาษีอย่างย่อ', other: 'เอกสารอื่น', unreadable: 'อ่านไม่ได้',
}
const flowLabels: Record<string, string> = { intake: 'Intake', filter: 'Filter', posting: 'Posting', completed: 'เสร็จสิ้น' }
const actionLabels: Record<string, string> = {
  route_filter: 'ส่งเข้า Filter', request_classification: 'ส่งกลับคัดแยก', request_correction: 'ส่งกลับแก้ไข',
  ready_posting: 'ส่งเข้า Posting', approve: 'อนุมัติเข้าคิว Gateway', reject: 'ไม่อนุมัติ', retry: 'ลองใหม่',
}
const stateLabels: Record<string, string> = {
  received: 'รับเข้าแล้ว', ai_processing: 'AI กำลังวิเคราะห์', awaiting_classification: 'รอคัดแยก',
  validating: 'กำลังตรวจละเอียด', needs_correction: 'รอแก้ไข', duplicate_hold: 'พักเอกสารซ้ำ',
  ready_for_posting: 'พร้อมส่ง Posting', awaiting_approval: 'รออนุมัติ',
  approved_waiting_gateway: 'อนุมัติแล้ว—รอ Gateway', posting: 'กำลังบันทึกปลายทาง', posted: 'บันทึกแล้ว',
  rejected: 'ไม่อนุมัติ', failed: 'ทำงานไม่สำเร็จ', dismissed: 'ไม่นำมาใช้',
}

const money = (value: number | null) => value == null ? '-' : new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(value)
const confidence = (value: number | null) => value == null ? '-' : `${(value * 100).toFixed(1)}%`
const roomLabel = (room: string) => room.replaceAll('_', ' ')

function availableActions(item: FlowItem) {
  if (item.state === 'failed' || item.state === 'rejected') return ['retry']
  if (item.current_flow === 'intake') return ['route_filter']
  if (item.current_flow === 'filter') return item.accounting_document_id
    ? ['ready_posting', 'request_correction', 'reject'] : ['request_correction', 'reject']
  if (item.current_flow === 'posting' && item.state === 'awaiting_approval') return ['approve', 'request_correction', 'reject']
  return []
}

export function DocumentFlowsPage() {
  usePageTitle('Document Flow Center')
  const navigate = useNavigate()
  const [flow, setFlow] = useState<Flow>('intake')
  const [items, setItems] = useState<FlowItem[]>([])
  const [status, setStatus] = useState('all')
  const [loading, setLoading] = useState(true)
  const [workingId, setWorkingId] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [timelineItem, setTimelineItem] = useState<FlowItem | null>(null)
  const [events, setEvents] = useState<FlowEvent[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const response = await supabase.from('document_flow_items').select(
      'id,intake_id,review_case_id,accounting_document_id,current_flow,current_room,state,document_type,route_target,confidence,auto_routed,issue_codes,vendor_name,total_amount,version,last_error,created_at,updated_at,projects(name)',
    ).order('updated_at', { ascending: false }).limit(2000)
    if (response.error) setError(`โหลด Workflow Ledger ไม่สำเร็จ: ${response.error.message}`)
    setItems((response.data ?? []) as unknown as FlowItem[])
    setLoading(false)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  const openTimeline = async (item: FlowItem) => {
    setTimelineItem(item)
    setEvents([])
    const response = await supabase.from('document_flow_events').select(
      'id,event_type,from_flow,to_flow,from_state,to_state,note,created_at',
    ).eq('item_id', item.id).order('created_at', { ascending: false })
    if (response.error) setError(`โหลด Timeline ไม่สำเร็จ: ${response.error.message}`)
    else setEvents((response.data ?? []) as FlowEvent[])
  }

  const transition = async (item: FlowItem, action: string) => {
    setWorkingId(item.id)
    setError('')
    setSuccess('')
    const response = await supabase.rpc('transition_document_flow_item', {
      target_item_id: item.id,
      target_action: action,
      target_expected_version: item.version,
      target_event_key: crypto.randomUUID(),
      target_note: null,
    })
    setWorkingId('')
    if (response.error) {
      const friendly = response.error.message.includes('workflow_version_conflict')
        ? 'ข้อมูลรายการนี้เปลี่ยนจากอีกหน้าจอแล้ว กรุณารีเฟรชก่อนทำรายการใหม่'
        : response.error.message.includes('workflow_document_not_confirmed')
          ? 'เอกสารยังไม่ผ่านการยืนยันรายละเอียด จึงยังส่งเข้า Posting ไม่ได้'
          : response.error.message.includes('workflow_transition_not_allowed')
            ? 'สถานะปัจจุบันไม่อนุญาตให้ทำคำสั่งนี้ กรุณารีเฟรชและตรวจ Timeline'
            : response.error.message
      setError(`เปลี่ยนสถานะไม่สำเร็จ: ${friendly}`)
      return
    }
    setSuccess(`${actionLabels[action] ?? action} เรียบร้อย ระบบบันทึก Timeline และป้องกันคำสั่งซ้ำแล้ว`)
    await load()
  }

  const rows = useMemo(() => items.filter((item) => item.current_flow === flow), [flow, items])
  const statuses = Array.from(new Set(rows.map((row) => row.state))).sort()
  const visible = status === 'all' ? rows : rows.filter((row) => row.state === status)
  const counts = {
    intake: items.filter((item) => item.current_flow === 'intake').length,
    filter: items.filter((item) => item.current_flow === 'filter').length,
    posting: items.filter((item) => item.current_flow === 'posting').length,
  }

  return <Stack spacing={2.5}>
    <PageHeader title="ศูนย์เส้นทางเอกสาร" description="ทะเบียนกลาง Intake Flow → Filter Flow → Posting Flow พร้อม Version, Timeline และการป้องกันคำสั่งซ้ำ" action={
      <Button variant="outlined" startIcon={<RefreshOutlinedIcon />} disabled={loading} onClick={() => void load()}>รีเฟรช</Button>
    } />
    {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
    {success && <Alert severity="success" onClose={() => setSuccess('')}>{success}</Alert>}
    <Paper variant="outlined"><Tabs value={flow} onChange={(_event, value) => { setFlow(value as Flow); setStatus('all') }} variant="scrollable">
      <Tab value="intake" label={`1. Intake Flow (${counts.intake})`} />
      <Tab value="filter" label={`2. Filter Flow (${counts.filter})`} />
      <Tab value="posting" label={`3. Posting Flow (${counts.posting})`} />
    </Tabs></Paper>
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3,1fr)' }, gap: 1.5 }}>
      {[
        ['รายการใน Flow', rows.length],
        ['รอดำเนินการ', rows.filter((row) => !['posted', 'dismissed'].includes(row.state)).length],
        ['มีคำเตือน', rows.filter((row) => row.issue_codes.length > 0 || row.last_error).length],
      ].map(([label, value]) => <Paper key={String(label)} variant="outlined" sx={{ p: 2, borderTop: 3, borderTopColor: label === 'มีคำเตือน' ? 'warning.main' : 'primary.main' }}>
        <Typography color="text.secondary">{label}</Typography><Typography variant="h5" sx={{ fontWeight: 800 }}>{value}</Typography>
      </Paper>)}
    </Box>
    <Alert severity={flow === 'posting' ? 'warning' : 'info'}>
      {flow === 'intake' ? 'AI ≥ 90% ส่งเข้า Filter อัตโนมัติ; ต่ำกว่าเกณฑ์หรือข้อมูลไม่ครบอยู่ห้องรอคัดแยก'
        : flow === 'filter' ? 'ตรวจประเภท ความครบถ้วน ความซ้ำ ยอด ภาษี และ Matching ก่อนส่ง Posting'
          : 'การอนุมัติรอบนี้ส่งเข้าคิว Posting Gateway เท่านั้น ยังไม่ลงบัญชี/Stock/PO จนกว่า Gateway ของประเภทเอกสารจะตรวจผ่าน'}
    </Alert>
    <StandardDataTable
      rows={visible} getRowId={(row) => row.id} getSearchText={(row) => Object.values(row).join(' ')}
      searchLabel="ค้นหา Intake ID ผู้ขาย โครงการ ประเภท สถานะ หรือห้อง" exportFileName={`document-${flow}-flow`}
      onRowClick={(row) => navigate(row.review_case_id && flow === 'intake' ? '/image-review' : '/accounting-documents')}
      defaultSort={{ columnId: 'updated', direction: 'desc' }} toolbar={<FormControl size="small" sx={{ minWidth: 190 }}>
        <InputLabel>สถานะ</InputLabel><Select value={status} label="สถานะ" onChange={(event) => setStatus(event.target.value)}>
          <MenuItem value="all">ทุกสถานะ</MenuItem>{statuses.map((value) => <MenuItem key={value} value={value}>{stateLabels[value] ?? value}</MenuItem>)}
        </Select>
      </FormControl>}
      columns={[
        { id: 'updated', label: 'อัปเดตล่าสุด', minWidth: 160, render: (row) => new Date(row.updated_at).toLocaleString('th-TH'), sortValue: (row) => new Date(row.updated_at) },
        { id: 'intake', label: 'Intake ID', minWidth: 125, render: (row) => <Typography sx={{ fontFamily: 'monospace' }}>{row.intake_id.slice(0, 8)}…</Typography>, exportValue: (row) => row.intake_id },
        { id: 'type', label: 'ประเภท', minWidth: 170, render: (row) => typeLabels[row.document_type ?? 'other'] ?? row.document_type ?? '-' },
        { id: 'vendor', label: 'ผู้ขาย/คู่ค้า', minWidth: 210, render: (row) => row.vendor_name ?? '-' },
        { id: 'project', label: 'โครงการ', minWidth: 160, render: (row) => row.projects?.name ?? 'ไม่ระบุ' },
        { id: 'amount', label: 'ยอดรวม', align: 'right', minWidth: 120, render: (row) => money(row.total_amount), sortValue: (row) => row.total_amount ?? 0 },
        { id: 'confidence', label: 'AI', minWidth: 100, render: (row) => <Chip size="small" color={(row.confidence ?? 0) >= .9 ? 'success' : 'warning'} label={confidence(row.confidence)} />, sortValue: (row) => row.confidence ?? 0 },
        { id: 'state', label: 'สถานะ', minWidth: 185, render: (row) => <Chip size="small" label={stateLabels[row.state] ?? row.state} />, exportValue: (row) => row.state },
        { id: 'room', label: 'ห้อง/ปลายทาง', minWidth: 230, render: (row) => <Stack direction="row" spacing={.5}><RouteOutlinedIcon fontSize="small" color="primary" /><span>{roomLabel(row.current_room)}</span></Stack>, exportValue: (row) => row.current_room },
        { id: 'version', label: 'Version', minWidth: 80, render: (row) => `v${row.version}`, sortValue: (row) => row.version },
        { id: 'actions', label: 'ดำเนินการ', minWidth: 250, render: (row) => <Stack direction="row" spacing={.5} onClick={(event) => event.stopPropagation()}>
          <Tooltip title="ดู Timeline"><IconButton size="small" onClick={() => void openTimeline(row)}><HistoryOutlinedIcon fontSize="small" /></IconButton></Tooltip>
          {availableActions(row).map((action) => <Button key={action} size="small" variant={action === 'approve' || action === 'route_filter' ? 'contained' : 'outlined'} startIcon={<PlayArrowOutlinedIcon />} disabled={workingId === row.id} onClick={() => void transition(row, action)}>{actionLabels[action]}</Button>)}
        </Stack>, exportValue: (row) => availableActions(row).map((action) => actionLabels[action]).join(', ') },
      ]}
    />
    <Dialog open={Boolean(timelineItem)} onClose={() => setTimelineItem(null)} fullWidth maxWidth="md">
      <DialogTitle>Timeline — Intake {timelineItem?.intake_id.slice(0, 8)}…</DialogTitle>
      <DialogContent dividers><Stack spacing={1.25}>
        {events.length === 0 && <Typography color="text.secondary">ยังไม่พบเหตุการณ์</Typography>}
        {events.map((event) => <Paper key={event.id} variant="outlined" sx={{ p: 1.5 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', gap: 1 }}>
            <Box><Typography sx={{ fontWeight: 700 }}>{actionLabels[event.event_type] ?? event.event_type}</Typography>
              <Typography variant="body2" color="text.secondary">
                {flowLabels[event.from_flow ?? ''] ?? event.from_flow ?? '-'} / {stateLabels[event.from_state ?? ''] ?? event.from_state ?? '-'} → {flowLabels[event.to_flow ?? ''] ?? event.to_flow ?? '-'} / {stateLabels[event.to_state ?? ''] ?? event.to_state ?? '-'}
              </Typography>{event.note && <Typography variant="body2">หมายเหตุ: {event.note}</Typography>}</Box>
            <Typography variant="caption" color="text.secondary">{new Date(event.created_at).toLocaleString('th-TH')}</Typography>
          </Stack>
        </Paper>)}
      </Stack></DialogContent>
      <DialogActions><Button onClick={() => setTimelineItem(null)}>ปิด</Button></DialogActions>
    </Dialog>
  </Stack>
}
