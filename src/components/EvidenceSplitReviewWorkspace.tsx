import {
  ArrowBackOutlined,
  CloseOutlined,
  OpenInNewOutlined,
  RefreshOutlined,
  RestartAltOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@mui/icons-material'
import { Alert, Box, Button, CircularProgress, IconButton, Paper, Stack, Tooltip, Typography } from '@mui/material'
import { type ReactNode, useState } from 'react'

export type EvidencePreviewState = {
  recordId: string
  url: string | null
  fileName: string | null
  contentType: string | null
  loading: boolean
  error: string | null
}

type Props = {
  preview: EvidencePreviewState | null
  reviewPane: ReactNode
  onClosePreview: () => void
  onRetry: () => void
  onOpenExternal: () => void
}

export type EvidencePreviewKind = 'image' | 'pdf' | 'unsupported'

function evidencePreviewKind(contentType: string | null, fileName: string | null): EvidencePreviewKind {
  const mime = (contentType ?? '').toLowerCase()
  const name = (fileName ?? '').toLowerCase()
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif|tiff?)$/.test(name)) return 'image'
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  return 'unsupported'
}

function EvidencePreviewPanel({ preview, onClosePreview, onRetry, onOpenExternal }: Omit<Props, 'reviewPane'>) {
  const [zoom, setZoom] = useState(1)
  const kind = evidencePreviewKind(preview?.contentType ?? null, preview?.fileName ?? null)

  return <Paper
    square
    elevation={0}
    data-testid="evidence-preview-pane"
    aria-label="หลักฐานต้นฉบับ"
    sx={{
      display: preview ? 'flex' : 'none',
      flexDirection: 'column',
      width: { xs: '100%', md: 'min(58vw, 1120px)' },
      flex: { md: '1 1 58%' },
      minWidth: 0,
      height: '100%',
      borderRight: { md: 1 },
      borderColor: { md: 'divider' },
      bgcolor: 'grey.950',
      color: 'common.white',
    }}
  >
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', px: 1.25, py: 1, minHeight: 56, bgcolor: 'grey.900' }}>
      <Tooltip title="กลับไปตรวจข้อมูล"><IconButton color="inherit" aria-label="กลับไปตรวจข้อมูล" onClick={onClosePreview}><ArrowBackOutlined /></IconButton></Tooltip>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>หลักฐานต้นฉบับ</Typography>
        <Typography variant="caption" sx={{ display: 'block', opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview?.fileName ?? 'ไฟล์ต้นทาง'}</Typography>
      </Box>
      {kind === 'image' && !preview?.loading && !preview?.error && <>
        <Tooltip title="ย่อ"><span><IconButton color="inherit" aria-label="ย่อหลักฐาน" disabled={zoom <= 0.5} onClick={() => setZoom((current) => Math.max(0.5, Number((current - 0.25).toFixed(2))))}><ZoomOutOutlined /></IconButton></span></Tooltip>
        <Tooltip title="ขยาย"><span><IconButton color="inherit" aria-label="ขยายหลักฐาน" disabled={zoom >= 3} onClick={() => setZoom((current) => Math.min(3, Number((current + 0.25).toFixed(2))))}><ZoomInOutlined /></IconButton></span></Tooltip>
        <Tooltip title="ขนาดพอดี"><IconButton color="inherit" aria-label="แสดงหลักฐานขนาดพอดี" onClick={() => setZoom(1)}><RestartAltOutlined /></IconButton></Tooltip>
      </>}
      {preview?.url && <Tooltip title="เปิดในแท็บใหม่ (ตัวเลือกสำรอง)"><IconButton color="inherit" aria-label="เปิดหลักฐานในแท็บใหม่" onClick={onOpenExternal}><OpenInNewOutlined /></IconButton></Tooltip>}
      <Tooltip title="ปิดหลักฐาน"><IconButton color="inherit" aria-label="ปิดหลักฐาน" onClick={onClosePreview}><CloseOutlined /></IconButton></Tooltip>
    </Stack>

    <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', alignItems: 'stretch', justifyContent: 'center' }}>
      {preview?.loading && <Stack spacing={1.5} sx={{ m: 'auto', alignItems: 'center' }}><CircularProgress color="inherit" /><Typography>กำลังโหลดหลักฐานที่มีสิทธิ์…</Typography></Stack>}
      {!preview?.loading && preview?.error && <Alert
        severity="error"
        action={<Button color="inherit" size="small" startIcon={<RefreshOutlined />} onClick={onRetry}>ลองใหม่</Button>}
        sx={{ m: 2, width: 'min(640px, calc(100% - 32px))', alignSelf: 'flex-start' }}
      >{preview.error}</Alert>}
      {!preview?.loading && !preview?.error && preview?.url && kind === 'image' && <Box sx={{ width: '100%', height: '100%', overflow: 'auto', display: 'grid', placeItems: 'center', p: 2 }}>
        <Box
          component="img"
          src={preview.url}
          alt={preview.fileName ? `หลักฐาน ${preview.fileName}` : 'หลักฐานต้นฉบับ'}
          sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', transform: `scale(${zoom})`, transformOrigin: 'center', transition: 'transform 120ms ease' }}
        />
      </Box>}
      {!preview?.loading && !preview?.error && preview?.url && kind === 'pdf' && <Box
        component="iframe"
        src={preview.url}
        title={preview.fileName ? `หลักฐาน ${preview.fileName}` : 'หลักฐาน PDF'}
        sx={{ width: '100%', height: '100%', border: 0, bgcolor: 'common.white' }}
      />}
      {!preview?.loading && !preview?.error && preview?.url && kind === 'unsupported' && <Alert severity="info" sx={{ m: 2, alignSelf: 'flex-start' }}>
        ไฟล์ชนิดนี้ยังแสดงในตัวดูหลักฐานไม่ได้ กรุณาใช้ “เปิดในแท็บใหม่” ที่มุมขวาบน
      </Alert>}
    </Box>
  </Paper>
}

export function EvidenceSplitReviewWorkspace({ preview, reviewPane, onClosePreview, onRetry, onOpenExternal }: Props) {
  return <Box data-testid="evidence-split-review-workspace" sx={{ width: '100%', height: '100dvh', display: 'flex', overflow: 'hidden' }}>
    <EvidencePreviewPanel key={`${preview?.recordId ?? 'closed'}:${preview?.url ?? ''}`} preview={preview} onClosePreview={onClosePreview} onRetry={onRetry} onOpenExternal={onOpenExternal} />
    <Box
      key="review-pane"
      data-testid="evidence-review-pane"
      sx={{
        display: { xs: preview ? 'none' : 'flex', md: 'flex' },
        flexDirection: 'column',
        width: { xs: '100%', md: preview ? 'min(720px, 42vw)' : 720 },
        flex: { md: preview ? '0 1 720px' : '0 0 720px' },
        minWidth: 0,
        height: '100%',
        bgcolor: 'background.paper',
      }}
    >{reviewPane}</Box>
  </Box>
}
