import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined'
import {
  Alert, Box, Button, Chip, CircularProgress, MenuItem, Paper, Select, Stack,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'

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
  usePageTitle('ตรวจสอบข้อมูล LINE')
  const { profile } = useAuth()
  const canManage = profile?.role === 'admin' || profile?.role === 'manager'
  const [events, setEvents] = useState<IngestionEvent[]>([])
  const [storedRows, setStoredRows] = useState<StoredMessageRow[]>([])
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
    const [eventResult, messagesResult, groupsResult] = await Promise.all([
      supabase.from('line_ingestion_events').select('*')
        .order('received_at', { ascending: false }).limit(500),
      supabase.from('line_messages')
        .select('id, line_message_id, line_group_id, message_type, text_content, file_name, occurred_at, is_redelivery')
        .order('occurred_at', { ascending: false }).limit(300),
      supabase.from('line_groups').select('line_group_id, display_name'),
    ])

    if (eventResult.error && eventResult.error.code !== '42P01') setError(eventResult.error.message)
    else setEvents((eventResult.data ?? []) as IngestionEvent[])
    if (messagesResult.error) {
      setError((current) => [current, messagesResult.error.message].filter(Boolean).join(' · '))
      setLoading(false)
      return
    }

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

    const groupNames = new Map((groupsResult.data ?? []).map((group) =>
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
      if (['image', 'video', 'audio', 'file'].includes(message.message_type) && !attachment) {
        diagnostic = 'รับข้อความแล้ว แต่ไม่พบไฟล์ใน Storage'
      } else if (message.message_type === 'image' && !summary) {
        diagnostic = 'เก็บรูปแล้ว แต่ไม่พบผลวิเคราะห์'
      } else if (message.message_type === 'image' && summary && !document && !transaction) {
        diagnostic = 'วิเคราะห์รูปแล้ว แต่ไม่ถูกจำแนกเป็นเอกสารบัญชีหรือสลิป'
      } else if (document) {
        diagnostic = `สร้างเอกสารบัญชีแล้ว (${document.status})`
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

  if (!canManage) {
    return <Alert severity="warning">หน้านี้เปิดให้เฉพาะ Admin และ Manager</Alert>
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title="ตรวจสอบข้อมูลจาก LINE"
        description="ตรวจทุกขั้นตั้งแต่ LINE ส่ง Webhook จนถึงการดาวน์โหลดไฟล์ วิเคราะห์ด้วย Gemini และสร้างข้อมูลในระบบ"
        action={<Button startIcon={<RefreshOutlinedIcon />} onClick={() => void loadData()}>รีเฟรช</Button>}
      />
      {error && <Alert severity="error">{error}</Alert>}
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

      <Typography variant="h6" sx={{ fontWeight: 800 }}>สถานะ Pipeline หลังติดตั้งระบบตรวจสอบ</Typography>
      {loading ? <Box sx={{ display: 'grid', placeItems: 'center', py: 5 }}><CircularProgress /></Box> : (
        <StandardDataTable
          rows={visibleEvents}
          getRowId={(row) => row.id}
          getSearchText={(row) => [
            row.line_message_id, row.line_group_id, row.message_type, row.processing_stage,
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
            { id: 'type', label: 'ชนิด', minWidth: 100, render: (row) => row.message_type ?? row.event_type, exportValue: (row) => row.message_type },
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
