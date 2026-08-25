import { ContentCopyOutlined, OpenInNewOutlined } from '@mui/icons-material'
import { Accordion, AccordionDetails, AccordionSummary, Button, Chip, Grid, IconButton, Paper, Stack, Tooltip, Typography } from '@mui/material'
import { ExpandMoreOutlined } from '@mui/icons-material'
import type { MasterSourceEvidence } from './masterDataReview'

type Props = {
  source: MasterSourceEvidence
  sourceCount: number
  onOpenSource: () => void
}

const dateTime = (value: string | null) => value ? new Date(value).toLocaleString('th-TH') : 'ไม่พบเวลา'
const shortId = (value: string | null) => value ? `${value.slice(0, 8)}…${value.slice(-4)}` : 'ไม่พบ'

function ReferenceValue({ label, value }: { label: string; value: string | null }) {
  const copy = async () => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // Clipboard may be unavailable in a restricted browser context. The full ID
      // remains visible in the tooltip, so a failed copy must not break the Drawer.
    }
  }
  return <Paper variant="outlined" sx={{ p: 1, minWidth: 0, height: '100%' }}>
    <Typography variant="caption" color="text.secondary">{label}</Typography>
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', minWidth: 0 }}>
      <Tooltip title={value ?? `${label} ไม่พบ`}><Typography variant="body2" sx={{ fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{shortId(value)}</Typography></Tooltip>
      {value && <Tooltip title={`คัดลอก ${label}`}><IconButton size="small" aria-label={`คัดลอก ${label}`} onClick={() => void copy()}><ContentCopyOutlined fontSize="inherit" /></IconButton></Tooltip>}
    </Stack>
  </Paper>
}

export function MasterDataSourceReferenceCard({ source, sourceCount, onOpenSource }: Props) {
  return <Accordion variant="outlined" defaultExpanded>
    <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.75} sx={{ alignItems: { sm: 'center' }, width: '100%' }}>
        <Typography sx={{ fontWeight: 800, flex: 1 }}>Source Reference / Evidence history</Typography>
        <Chip size="small" color={source.sourceResolved ? 'success' : 'warning'} label={source.sourceResolved ? 'ผูกต้นทางแล้ว' : 'Source ไม่ครบ'} />
      </Stack>
    </AccordionSummary>
    <AccordionDetails>
      <Stack spacing={1}>
        <Grid container spacing={1}>
          <Grid size={{ xs: 12, sm: 6 }}><ReferenceValue label="Document ID" value={source.documentId} /></Grid>
          <Grid size={{ xs: 12, sm: 6 }}><ReferenceValue label="Intake ID" value={source.intakeId} /></Grid>
          <Grid size={{ xs: 12, sm: 6 }}><ReferenceValue label="Message ID" value={source.messageId} /></Grid>
          <Grid size={{ xs: 12, sm: 6 }}><ReferenceValue label="Attachment ID" value={source.attachmentId} /></Grid>
        </Grid>
        <Paper variant="outlined" sx={{ p: 1 }}>
          <Typography variant="caption" color="text.secondary">ต้นทาง</Typography>
          <Typography variant="body2"><strong>ช่องทาง:</strong> {source.sourceChannel ?? 'ไม่ระบุช่องทาง'} · <strong>ห้อง:</strong> {source.sourceRoom ?? 'ไม่ระบุห้อง'}</Typography>
          <Typography variant="body2"><strong>ผู้ส่ง:</strong> {source.sourceSender ?? 'ไม่ระบุผู้ส่ง'} · <strong>รับเข้า:</strong> {dateTime(source.receivedAt)}</Typography>
          <Typography variant="body2"><strong>ไฟล์:</strong> {source.fileName ?? source.attachmentContentType ?? 'ไม่พบชื่อไฟล์'}</Typography>
        </Paper>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
          <Typography variant="body2" sx={{ flex: 1 }}>กลุ่มนี้พบ <strong>{sourceCount}</strong> source · Audit <strong>{source.auditCount}</strong> เหตุการณ์{source.auditId ? ` · ล่าสุด #${source.auditId}` : ''}</Typography>
          {(source.path || source.documentId || source.messageId) && <Button size="small" startIcon={<OpenInNewOutlined />} onClick={onOpenSource}>เปิดหลักฐานต้นฉบับ</Button>}
        </Stack>
        {source.missingReasons.length > 0 && <Stack spacing={0.25}>{source.missingReasons.map((reason) => <Typography key={reason} variant="caption" color="warning.main">• {reason}</Typography>)}</Stack>}
      </Stack>
    </AccordionDetails>
  </Accordion>
}
