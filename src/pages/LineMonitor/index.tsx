import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined'
import {
  Alert, Box, Button, Chip, CircularProgress, MenuItem, Paper, Select, Stack,
  Tab, Tabs, Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { isPlatformAdmin as resolvePlatformAdmin } from '../../utils/permissions'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
import { userError } from '../../utils/userError'
import { PlatformLineGroupManager } from './PlatformLineGroupManager'

type PipelineStatus = 'received' | 'processing' | 'processed' | 'failed' | 'skipped'

type IngestionEvent = {
  id: string
  webhook_event_id: string
  line_message_id: string | null
  source_message_id: string | null
  line_group_id: string | null
  event_type: string
  message_type: string | null
  processing_status: PipelineStatus
  processing_stage: string
  attachment_status: string
  analysis_status: string
  output_type: string | null
  is_redelivery: boolean
  error_message: string | null
  occurred_at: string
  received_at: string
  processed_at: string | null
}

type StoredMessage = {
  id: string
  line_message_id: string
  line_group_id: string | null
  message_type: string
  text_content: string | null
  file_name: string | null
  occurred_at: string
  is_redelivery: boolean
}

type StoredMessageRow = StoredMessage & {
  group_name: string
  attachment: boolean
  analysis_status: string
  analysis_error: string | null
  output: string
  diagnostic: string
}

type LineGroupHealth = {
  line_group_id: string
  display_name: string | null
  active: boolean
  last_event_at: string | null
}

type LineNotification = {
  id: string
  destination: string | null
  status: string
  error_message: string | null
  created_at: string
}

type LineGroupHealthRow = LineGroupHealth & {
  age_minutes: number | null
  health: 'healthy' | 'warning' | 'critical' | 'unknown'
}

type TelegramAdminEvent = {
  id: string
  telegram_update_id: string
  telegram_chat_id: string | null
  telegram_user_id: string | null
  event_type: string
  command: string | null
  status: 'received' | 'processed' | 'ignored' | 'failed'
  error_message: string | null
  created_at: string
  processed_at: string | null
}

const statusLabels: Record<PipelineStatus, string> = {
  received: 'รับ Webhook แล้ว',
  processing: 'กำลังประมวลผล',
  processed: 'สำเร็จ',
  failed: 'ไม่สำเร็จ',
  skipped: 'ไม่ใช้งาน',
}

const stageLabels: Record<string, string> = {
  webhook_received: 'รับจาก LINE',
  message_saved: 'บันทึกข้อความ',
  text_analysis: 'Gemini วิเคราะห์ข้อความ',
  text_summary_saved: 'บันทึกสรุปข้อความ',
  attachment_download: 'ดาวน์โหลดไฟล์จาก LINE',
  attachment_saved: 'เก็บไฟล์ใน Storage',
  image_analysis: 'Gemini วิเคราะห์รูป',
  image_summary_saved: 'บันทึกสรุปรูป',
  financial_transaction_saved: 'สร้างรายการเงิน',
  accounting_document_saved: 'สร้างเอกสารบัญชี',
  completed: 'เสร็จสมบูรณ์',
  unsend_applied: 'ลบข้อความตามคำขอ',
  event_not_used: 'เหตุการณ์ที่ระบบไม่ใช้',
}

const outputLabels: Record<string, string> = {
  work_summary: 'สรุปงาน',
  financial_transaction: 'รายการเงิน',
  accounting_document: 'เอกสารบัญชี',
}

export function LineMonitorPage() {
  usePageTitle('ตรวจสอบ LINE และ Telegram')
  const { profile } = useAuth()
  const canManage = profile?.role === 'admin' || profile?.role === 'manager'
  const isPlatformAdmin=resolvePlatformAdmin(profile)
  const [events, setEvents] = useState<IngestionEvent[]>([])
  const [storedRows, setStoredRows] = useState<StoredMessageRow[]>([])
  const [groupHealthRows, setGroupHealthRows] = useState<LineGroupHealthRow[]>([])
  const [notifications, setNotifications] = useState<LineNotification[]>([])
  const [telegramEvents, setTelegramEvents] = useState<TelegramAdminEvent[]>([])
  const [channelTab, setChannelTab] = useState<'line' | 'telegram' | 'groups'>('line')
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    if (!canManage) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const [eventResult, messagesResult, groupsResult, notificationsResult, telegramResult] = await Promise.all([
      supabase.from('line_ingestion_events').select('*')
        .order('received_at', { ascending: false }).limit(500),
      supabase.from('line_messages')
        .select('id, line_message_id, line_group_id, message_type, text_content, file_name, occurred_at, is_redelivery')
        .order('occurred_at', { ascending: false }).limit(300),
      supabase.from('line_groups').select('line_group_id, display_name, active, last_event_at'),
      supabase.from('health_monitor_notifications')
        .select('id, destination, status, error_message, created_at')
        .order('created_at', { ascending: false }).limit(100),
      supabase.from('telegram_admin_events')
        .select('id, telegram_update_id, telegram_chat_id, telegram_user_id, event_type, command, status, error_message, created_at, processed_at')
        .order('created_at', { ascending: false }).limit(500),
    ])

    if (eventResult.error && eventResult.error.code !== '42P01') setError(userError(eventResult.error))
    else setEvents((eventResult.data ?? []) as IngestionEvent[])
    if (messagesResult.error) {
      setError((current) => [current, userError(messagesResult.error)].filter(Boolean).join(' · '))
      setLoading(false)
      return
    }

    if (groupsResult.error) setError((current) => [current, userError(groupsResult.error)].filter(Boolean).join(' · '))
    if (notificationsResult.error && notificationsResult.error.code !== '42P01') {
      setError((current) => [current, userError(notificationsResult.error)].filter(Boolean).join(' · '))
    }
    if (telegramResult.error && telegramResult.error.code !== '42P01') {
      setError((current) => [current, `Telegram: ${userError(telegramResult.error)}`].filter(Boolean).join(' · '))
    } else {
      setTelegramEvents((telegramResult.data ?? []) as TelegramAdminEvent[])
    }

    const now = Date.now()
    const groups = (groupsResult.data ?? []) as LineGroupHealth[]
    setGroupHealthRows(groups.filter((group) => group.active).map((group): LineGroupHealthRow => {
      const ageMinutes = group.last_event_at
        ? Math.max(0, Math.floor((now - new Date(group.last_event_at).getTime()) / 60_000))
        : null
      return {
        ...group,
        age_minutes: ageMinutes,
        health: ageMinutes === null ? 'unknown' : ageMinutes > 72 * 60 ? 'critical' : ageMinutes > 24 * 60 ? 'warning' : 'healthy',
      }
    }).sort((a, b) => (b.age_minutes ?? Number.MAX_SAFE_INTEGER) - (a.age_minutes ?? Number.MAX_SAFE_INTEGER)))
    setNotifications((notificationsResult.data ?? []) as LineNotification[])

    const messages = (messagesResult.data ?? []) as StoredMessage[]
    const ids = messages.map((message) => message.id)
    const [attachments, summaries, documents, financial] = ids.length > 0
      ? await Promise.all([
          supabase.from('line_attachments').select('message_id').in('message_id', ids),
          supabase.from('work_summary_items')
            .select('source_message_id, analysis_status, analysis_error').in('source_message_id', ids),
          supabase.from('accounting_documents')
            .select('source_message_id, document_type, status').in('source_message_id', ids),
          supabase.from('financial_transactions')
            .select('source_message_id, review_status').in('source_message_id', ids),
        ])
      : [
          { data: [], error: null }, { data: [], error: null },
          { data: [], error: null }, { data: [], error: null },
        ]

    const groupNames = new Map(groups.map((group) =>
      [group.line_group_id, group.display_name ?? group.line_group_id]))
    const attachmentIds = new Set((attachments.data ?? []).map((item) => item.message_id))
    const summaryByMessage = new Map((summaries.data ?? []).map((item) => [item.source_message_id, item]))
    const documentByMessage = new Map((documents.data ?? []).map((item) => [item.source_message_id, item]))
    const financialByMessage = new Map((financial.data ?? []).map((item) => [item.source_message_id, item]))

    setStoredRows(messages.map((message) => {
      const summary = summaryByMessage.get(message.id)
      const document = documentByMessage.get(message.id)
      const transaction = financialByMessage.get(message.id)
      const attachment = attachmentIds.has(message.id)
      let diagnostic = 'บันทึกข้อความแล้ว'
      if (['image', 'video', 'audio', 'file'].includes(message.message_type ?? '') && !attachment) {
        diagnostic = 'รับข้อความแล้ว แต่ไม่พบไฟล์ใน Storage'
      } else if (message.message_type === 'image' && !summary) {
        diagnostic = 'เก็บรูปแล้ว แต่ไม่พบผลวิเคราะห์'
      } else if (message.message_type === 'image' && summary && !document && !transaction) {
        diagnostic = 'วิเคราะห์รูปแล้ว แต่ไม่ถูกจำแนกเป็นเอกสารบัญชีหรือสลิป'
      } else if (document) {
        diagnostic = document.status === 'confirmed'
          ? 'ยืนยันและลงบัญชีแล้ว'
          : `สร้างเอกสารเข้าคิวตรวจสอบแล้ว (${document.status})`
      } else if (transaction) {
        diagnostic = `สร้างรายการเงินแล้ว (${transaction.review_status})`
      } else if (summary) {
        diagnostic = `สร้างสรุปแล้ว (${summary.analysis_status})`
      }
      return {
        ...message,
        group_name: message.line_group_id
          ? groupNames.get(message.line_group_id) ?? message.line_group_id
          : 'แชตส่วนตัว',
        attachment,
        analysis_status: summary?.analysis_status ?? 'ไม่มี',
        analysis_error: summary?.analysis_error ?? null,
        output: document
          ? `เอกสารบัญชี: ${document.document_type}`
          : transaction ? 'รายการเงิน' : summary ? 'สรุปงาน' : 'ไม่มี',
        diagnostic,
      }
    }))
    setLoading(false)
  }, [canManage])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0)
    return () => window.clearTimeout(timer)
  }, [loadData])

  const visibleEvents = useMemo(() => events.filter((event) =>
    !statusFilter || event.processing_status === statusFilter), [events, statusFilter])
  const failed = events.filter((event) => event.processing_status === 'failed').length
  const pending = events.filter((event) =>
    event.processing_status === 'received' || event.processing_status === 'processing').length
  const redelivered = events.filter((event) => event.is_redelivery).length
  const latestOutbound = notifications[0] ?? null
  const latestOutboundSuccess = notifications.find((item) => item.status === 'sent') ?? null
  const quotaBlocked = notifications.find((item) => item.status === 'failed' && /429|monthly limit/i.test(item.error_message ?? '')) ?? null
  const staleGroups = groupHealthRows.filter((group) => group.health === 'warning' || group.health === 'critical')

  if (!canManage) {
    return <Alert severity="warning">หน้านี้เปิดให้เฉพาะ Admin และ Manager</Alert>
  }

  const channelTabs = (
    <Paper variant="outlined">
      <Tabs value={channelTab} onChange={(_event, value: 'line' | 'telegram' | 'groups') => setChannelTab(value)}>
        <Tab value="line" label="LINE" />
        <Tab value="telegram" label="Telegram" />
        {isPlatformAdmin&&<Tab value="groups" label="จัดการกลุ่ม LINE" />}
      </Tabs>
    </Paper>
  )

  if(channelTab==='groups'&&isPlatformAdmin){
    return <Stack spacing={3}>
      <PageHeader title="จัดการกลุ่ม LINE แยกตามบริษัท" description="กำหนดบริษัทเจ้าของกลุ่ม LINE เพื่อแยกข้อความ การแจ้งเตือน และข้อมูลโครงการ" action={<Button startIcon={<RefreshOutlinedIcon />} onClick={()=>window.location.reload()}>รีเฟรช</Button>}/>
      {channelTabs}
      <PlatformLineGroupManager/>
    </Stack>
  }

  if (channelTab === 'telegram') {
    const telegramFailed = telegramEvents.filter((item) => item.status === 'failed').length
    const telegramPending = telegramEvents.filter((item) => item.status === 'received').length
    const telegramVoice = telegramEvents.filter((item) => item.event_type === 'voice').length
    return (
      <Stack spacing={3}>
        <PageHeader
          title="ตรวจสอบข้อความจาก LINE และ Telegram"
          description="ติดตามข้อความ เสียง ขั้นตอนประมวลผล และข้อผิดพลาด โดยแยกตามช่องทาง"
          action={<Button startIcon={<RefreshOutlinedIcon />} onClick={() => void loadData()}>รีเฟรช</Button>}
        />
        {channelTabs}
        {error && <Alert severity="error">{error}</Alert>}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 2 }}>
          {[
            ['รับล่าสุด', telegramEvents[0] ? new Date(telegramEvents[0].created_at).toLocaleString('th-TH') : 'ยังไม่มี'],
            ['เสียง', `${telegramVoice} รายการ`],
            ['รอประมวลผล', `${telegramPending} รายการ`],
            ['ไม่สำเร็จ', `${telegramFailed} รายการ`],
          ].map(([label, value]) => (
            <Paper key={label} variant="outlined" sx={{ p: 2 }}>
              <Typography variant="body2" color="text.secondary">{label}</Typography>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>{value}</Typography>
            </Paper>
          ))}
        </Box>
        {telegramEvents.length === 0 && !loading && (
          <Alert severity="info">ยังไม่มีเหตุการณ์ Telegram ที่บัญชีนี้มีสิทธิ์ดู</Alert>
        )}
        {loading ? <Box sx={{ display: 'grid', placeItems: 'center', py: 5 }}><CircularProgress /></Box> : (
          <StandardDataTable
            rows={telegramEvents}
            getRowId={(row) => row.id}
            getSearchText={(row) => [row.event_type, row.status, row.command, row.error_message].filter(Boolean).join(' ')}
            searchLabel="ค้นหาชนิดข้อความ สถานะ คำสั่ง หรือ Error"
            emptyText="ยังไม่มีเหตุการณ์ Telegram"
            exportFileName="wisdomai-telegram-admin-events"
            minWidth={1100}
            columns={[
              { id: 'time', label: 'เวลารับ', minWidth: 180, render: (row) => new Date(row.created_at).toLocaleString('th-TH'), exportValue: (row) => row.created_at },
              { id: 'type', label: 'ชนิด', minWidth: 110, render: (row) => row.event_type === 'voice' ? 'เสียง' : row.event_type, exportValue: (row) => row.event_type },
              { id: 'status', label: 'สถานะ', minWidth: 140, render: (row) => <Chip size="small" color={row.status === 'failed' ? 'error' : row.status === 'processed' ? 'success' : row.status === 'received' ? 'warning' : 'default'} label={row.status} />, exportValue: (row) => row.status },
              { id: 'command', label: 'คำสั่ง/ข้อความที่ถอดได้', minWidth: 320, render: (row) => row.command ?? '-', exportValue: (row) => row.command },
              { id: 'processed', label: 'ประมวลผลเมื่อ', minWidth: 180, render: (row) => row.processed_at ? new Date(row.processed_at).toLocaleString('th-TH') : '-', exportValue: (row) => row.processed_at },
              { id: 'error', label: 'Error', minWidth: 300, render: (row) => row.error_message ?? '-', exportValue: (row) => row.error_message },
            ]}
          />
        )}
      </Stack>
    )
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title="ตรวจสอบข้อมูลจาก LINE"
        description="ตรวจทุกขั้นตั้งแต่ LINE ส่ง Webhook จนถึงการดาวน์โหลดไฟล์ วิเคราะห์ด้วย Gemini และสร้างข้อมูลในระบบ"
        action={<Button startIcon={<RefreshOutlinedIcon />} onClick={() => void loadData()}>รีเฟรช</Button>}
      />
      {channelTabs}
      {error && <Alert severity="error">{error}</Alert>}
      {quotaBlocked && (
        <Alert severity="error">
          LINE ส่งออกถูกระงับเพราะเกินโควตารายเดือน (429) ล่าสุด {new Date(quotaBlocked.created_at).toLocaleString('th-TH')} — ระบบยังรับ Webhook ได้ แต่ตอบกลับหรือแจ้งเตือนไม่ได้จนกว่าโควตาจะพร้อม
        </Alert>
      )}
      {staleGroups.length > 0 && (
        <Alert severity="warning">
          พบกลุ่ม LINE ที่เปิดใช้งานแต่ไม่มี Webhook เกิน 24 ชั่วโมง {staleGroups.length} กลุ่ม โปรดตรวจว่ากลุ่มยังใช้งานจริงและ Bot ยังอยู่ในกลุ่ม
        </Alert>
      )}
      {events.length === 0 && !loading && (
        <Alert severity="info">
          ตารางตรวจสอบเพิ่งเริ่มเก็บข้อมูลหลัง Deploy เวอร์ชันนี้ ด้านล่างยังแสดงข้อความเดิมที่ระบบเคยบันทึกไว้ให้ตรวจย้อนหลัง
        </Alert>
      )}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 2 }}>
        {[
          ['Webhook ล่าสุด', events[0] ? new Date(events[0].received_at).toLocaleString('th-TH') : 'ยังไม่มี'],
          ['ไม่สำเร็จ', `${failed} รายการ`],
          ['กำลังดำเนินการ', `${pending} รายการ`],
          ['LINE ส่งซ้ำ', `${redelivered} รายการ`],
        ].map(([label, value]) => (
          <Paper key={label} variant="outlined" sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">{label}</Typography>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>{value}</Typography>
          </Paper>
        ))}
      </Box>

      <Typography variant="h6" sx={{ fontWeight: 800 }}>สถานะการรับ–ส่ง LINE แยกตามกลุ่ม</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' }, gap: 2 }}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="body2" color="text.secondary">ส่งออกล่าสุด</Typography>
          <Typography variant="body1" sx={{ fontWeight: 700 }}>
            {latestOutbound ? `${latestOutbound.status} · ${new Date(latestOutbound.created_at).toLocaleString('th-TH')}` : 'ยังไม่มีประวัติ'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            สำเร็จล่าสุด: {latestOutboundSuccess ? new Date(latestOutboundSuccess.created_at).toLocaleString('th-TH') : 'ยังไม่พบ'}
          </Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="body2" color="text.secondary">กลุ่มที่ควรตรวจสอบ</Typography>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>{staleGroups.length} กลุ่ม</Typography>
          <Typography variant="caption" color="text.secondary">เตือนเมื่อเงียบเกิน 24 ชม. · วิกฤตเมื่อเกิน 72 ชม.</Typography>
        </Paper>
      </Box>
      <StandardDataTable
        rows={groupHealthRows}
        getRowId={(row) => row.line_group_id}
        getSearchText={(row) => `${row.display_name ?? ''} ${row.line_group_id} ${row.health}`}
        searchLabel="ค้นหาชื่อกลุ่มหรือ Group ID"
        emptyText="ยังไม่มีกลุ่ม LINE ที่เปิดใช้งาน"
        exportFileName="wisdomai-line-group-health"
        minWidth={850}
        columns={[
          { id: 'group', label: 'กลุ่ม LINE', minWidth: 220, render: (row) => row.display_name ?? row.line_group_id, exportValue: (row) => row.display_name ?? row.line_group_id },
          { id: 'last', label: 'รับ Webhook ล่าสุด', minWidth: 190, render: (row) => row.last_event_at ? new Date(row.last_event_at).toLocaleString('th-TH') : 'ยังไม่เคยรับ', exportValue: (row) => row.last_event_at },
          { id: 'age', label: 'เงียบมาแล้ว', minWidth: 150, render: (row) => row.age_minutes === null ? '-' : row.age_minutes < 60 ? `${row.age_minutes} นาที` : `${Math.floor(row.age_minutes / 60)} ชม.`, exportValue: (row) => row.age_minutes },
          { id: 'health', label: 'สถานะ', minWidth: 140, render: (row) => <Chip size="small" color={row.health === 'healthy' ? 'success' : row.health === 'warning' ? 'warning' : row.health === 'critical' ? 'error' : 'default'} label={row.health === 'healthy' ? 'รับปกติ' : row.health === 'warning' ? 'ควรตรวจ' : row.health === 'critical' ? 'เงียบผิดปกติ' : 'ไม่มีข้อมูล'} />, exportValue: (row) => row.health },
        ]}
      />

      <Typography variant="h6" sx={{ fontWeight: 800 }}>สถานะ Pipeline หลังติดตั้งระบบตรวจสอบ</Typography>
      {loading ? <Box sx={{ display: 'grid', placeItems: 'center', py: 5 }}><CircularProgress /></Box> : (
        <StandardDataTable
          rows={visibleEvents}
          getRowId={(row) => row.id}
          getSearchText={(row) => [
            row.line_message_id, row.line_group_id, row.event_type, row.processing_stage,
            row.error_message, row.output_type,
          ].filter(Boolean).join(' ')}
          searchLabel="ค้นหา Message ID, กลุ่ม, ขั้นตอน หรือ Error"
          emptyText="ยังไม่มี Webhook หลังติดตั้งระบบตรวจสอบ"
          exportFileName="wisdomai-line-ingestion-events"
          minWidth={1350}
          toolbar={<Select size="small" displayEmpty value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)} sx={{ minWidth: 170 }}>
            <MenuItem value="">ทุกสถานะ</MenuItem>
            {(Object.entries(statusLabels) as [PipelineStatus, string][]).map(([value, label]) =>
              <MenuItem key={value} value={value}>{label}</MenuItem>)}
          </Select>}
          columns={[
            { id: 'time', label: 'เวลาจาก LINE', minWidth: 170, render: (row) => new Date(row.occurred_at).toLocaleString('th-TH'), exportValue: (row) => row.occurred_at },
            { id: 'type', label: 'ชนิด', minWidth: 100, render: (row) => row.event_type, exportValue: (row) => row.event_type },
            { id: 'status', label: 'สถานะ', minWidth: 140, render: (row) => <Chip size="small" color={row.processing_status === 'failed' ? 'error' : row.processing_status === 'processed' ? 'success' : 'default'} label={statusLabels[row.processing_status]} />, exportValue: (row) => statusLabels[row.processing_status] },
            { id: 'stage', label: 'ขั้นตอนล่าสุด', minWidth: 190, render: (row) => stageLabels[row.processing_stage] ?? row.processing_stage, exportValue: (row) => row.processing_stage },
            { id: 'attachment', label: 'ไฟล์', minWidth: 110, render: (row) => row.attachment_status, exportValue: (row) => row.attachment_status },
            { id: 'analysis', label: 'Gemini', minWidth: 110, render: (row) => row.analysis_status, exportValue: (row) => row.analysis_status },
            { id: 'output', label: 'ผลลัพธ์', minWidth: 150, render: (row) => row.output_type ? outputLabels[row.output_type] ?? row.output_type : '-', exportValue: (row) => row.output_type },
            { id: 'redelivery', label: 'ส่งซ้ำ', minWidth: 90, render: (row) => row.is_redelivery ? 'ใช่' : '-', exportValue: (row) => row.is_redelivery ? 'yes' : 'no' },
            { id: 'error', label: 'Error', minWidth: 300, render: (row) => row.error_message ?? '-', exportValue: (row) => row.error_message },
          ]}
        />
      )}

      <Typography variant="h6" sx={{ fontWeight: 800 }}>ตรวจข้อความที่ระบบเคยบันทึกไว้</Typography>
      <StandardDataTable
        rows={storedRows}
        getRowId={(row) => row.id}
        getSearchText={(row) => [
          row.group_name, row.message_type, row.text_content, row.file_name,
          row.output, row.diagnostic, row.analysis_error,
        ].filter(Boolean).join(' ')}
        searchLabel="ค้นหากลุ่ม ข้อความ ชื่อไฟล์ หรือผลตรวจ"
        emptyText="ยังไม่มีข้อความ LINE ในฐานข้อมูล"
        exportFileName="wisdomai-line-stored-messages"
        minWidth={1350}
        columns={[
          { id: 'time', label: 'เวลา', minWidth: 170, render: (row) => new Date(row.occurred_at).toLocaleString('th-TH'), exportValue: (row) => row.occurred_at },
          { id: 'group', label: 'กลุ่ม LINE', minWidth: 200, render: (row) => row.group_name, exportValue: (row) => row.group_name },
          { id: 'type', label: 'ชนิด', minWidth: 100, render: (row) => row.message_type, exportValue: (row) => row.message_type },
          { id: 'content', label: 'ข้อความ/ไฟล์', minWidth: 240, render: (row) => row.text_content ?? row.file_name ?? row.line_message_id, exportValue: (row) => row.text_content ?? row.file_name },
          { id: 'attachment', label: 'เก็บไฟล์', minWidth: 100, render: (row) => row.attachment ? 'สำเร็จ' : row.message_type === 'text' ? '-' : 'ไม่พบ', exportValue: (row) => row.attachment ? 'saved' : 'missing' },
          { id: 'analysis', label: 'วิเคราะห์', minWidth: 120, render: (row) => row.analysis_status, exportValue: (row) => row.analysis_status },
          { id: 'output', label: 'ข้อมูลที่สร้าง', minWidth: 180, render: (row) => row.output, exportValue: (row) => row.output },
          { id: 'diagnostic', label: 'ผลตรวจ', minWidth: 320, render: (row) => <Stack spacing={0.5}><Typography variant="body2">{row.diagnostic}</Typography>{row.analysis_error && <Typography variant="caption" color="error">{row.analysis_error}</Typography>}</Stack>, exportValue: (row) => `${row.diagnostic}${row.analysis_error ? `: ${row.analysis_error}` : ''}` },
        ]}
      />
    </Stack>
  )
}

