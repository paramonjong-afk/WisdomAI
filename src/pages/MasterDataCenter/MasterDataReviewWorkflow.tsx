import { CheckOutlined, MoreHorizOutlined, NavigateNextOutlined } from '@mui/icons-material'
import { Alert, Button, Chip, Divider, ListItemIcon, ListItemText, Menu, MenuItem, Paper, Stack, Step, StepLabel, Stepper, Typography } from '@mui/material'
import { useState } from 'react'
import {
  masterReviewActiveStep,
  masterReviewBlockers,
  masterReviewPersistenceNotice,
  masterReviewStage,
  masterReviewStepLabels,
  projectGateSummary,
  type MasterReviewAction,
  type MasterReviewReceipt,
} from '../../services/masterDataReviewWorkflow'
import type { MasterCandidate } from './masterDataReview'

type Props = {
  candidate: MasterCandidate
  receipt: MasterReviewReceipt
  reason: string
  saving: boolean
  hasNext: boolean
  actorName: (id: string | null) => string
  onCorrect: () => void
  onReview: (action: MasterReviewAction) => void
  onNext: () => void
  onClose: () => void
}

type ProgressProps = Pick<Props, 'candidate' | 'receipt' | 'reason' | 'actorName'>

const dateTime = (value: string | null) => value ? new Date(value).toLocaleString('th-TH') : '-'
const value = (data: Record<string, unknown> | null, key: string) => data && data[key] != null ? String(data[key]) : '-'

export function MasterDataReviewProgress({ candidate, receipt, reason, actorName }: ProgressProps) {
  const stage = masterReviewStage(candidate)
  const blockers = masterReviewBlockers(candidate, reason)
  const terminal = stage === 'confirmed'
  const persistedNotice = masterReviewPersistenceNotice(candidate)
  return <Stack spacing={1.25}>
    <Paper variant="outlined" sx={{ p: 1.25, position: 'sticky', top: 0, zIndex: 2, bgcolor: 'background.paper' }}>
      <Typography sx={{ fontWeight: 800, mb: 1 }}>ขั้นตอนตรวจและยืนยัน</Typography>
      <Stepper activeStep={masterReviewActiveStep(candidate)} alternativeLabel sx={{ '& .MuiStepLabel-label': { fontSize: { xs: '0.68rem', sm: '0.75rem' } } }}>
        {masterReviewStepLabels.map((label) => <Step key={label}><StepLabel>{label}</StepLabel></Step>)}
      </Stepper>
      {projectGateSummary(candidate) && <Chip size="small" color="success" label={projectGateSummary(candidate)} sx={{ mt: 1 }} />}
    </Paper>

    {blockers.length > 0 && !terminal && <Alert severity="info">
      <Typography variant="subtitle2">เงื่อนไขที่ต้องครบก่อนทำขั้นตอนถัดไป</Typography>
      {blockers.map((item) => <Typography key={item} variant="body2">• {item}</Typography>)}
    </Alert>}

    {persistedNotice && <Alert severity={terminal ? 'success' : 'warning'}>
      <Typography variant="subtitle2">สถานะที่บันทึกจริงล่าสุด</Typography>
      <Typography variant="body2">{persistedNotice}</Typography>
      <Typography variant="caption">เวลา: {dateTime(candidate.reviewed_at ?? null)} · เหตุผล: {candidate.review_reason ?? '-'}</Typography>
    </Alert>}

    {receipt.projectCandidate && <Paper variant="outlined" sx={{ p: 1.25, bgcolor: 'action.hover' }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.75} sx={{ alignItems: { sm: 'center' } }}>
        <Typography sx={{ fontWeight: 800, flex: 1 }}>Project Candidate บันทึกแล้ว</Typography>
        <Chip size="small" color="success" label={receipt.projectCandidate.status} />
      </Stack>
      <Typography variant="body2">Candidate ID: {receipt.projectCandidate.id}</Typography>
      <Typography variant="body2">Version: {receipt.projectCandidate.version ?? '-'} · ผู้ดำเนินการ: {actorName(receipt.projectCandidate.actorId)} · เวลา: {dateTime(receipt.projectCandidate.timestamp)}</Typography>
      <Typography variant="body2">Audit event: {receipt.projectCandidate.auditEventKey ?? 'แสดงหลังโหลด Audit สำเร็จ'}</Typography>
    </Paper>}

    {receipt.correction && <Paper variant="outlined" sx={{ p: 1.25, borderColor: 'warning.main' }}>
      <Typography sx={{ fontWeight: 800 }}>Correction Version / Audit</Typography>
      <Typography variant="body2">Version: {receipt.correction.version ?? '-'} · ผู้แก้: {actorName(receipt.correction.actorId)} · เวลา: {dateTime(receipt.correction.timestamp)}</Typography>
      <Typography variant="body2">Audit event: {receipt.correction.auditEventKey ?? '-'}</Typography>
      <Divider sx={{ my: 0.75 }} />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <Paper variant="outlined" sx={{ p: 1, flex: 1 }}><Typography variant="subtitle2">ก่อนแก้</Typography><Typography variant="body2">ชื่อ: {value(receipt.correction.beforeData, 'display_name')}</Typography><Typography variant="body2">สถานะ: {value(receipt.correction.beforeData, 'status')}</Typography></Paper>
        <Paper variant="outlined" sx={{ p: 1, flex: 1 }}><Typography variant="subtitle2">หลังแก้</Typography><Typography variant="body2">ชื่อ: {value(receipt.correction.afterData, 'display_name')}</Typography><Typography variant="body2">สถานะ: {value(receipt.correction.afterData, 'status')}</Typography></Paper>
      </Stack>
    </Paper>}

  </Stack>
}

export function MasterDataReviewActions({ candidate, reason, saving, hasNext, onCorrect, onReview, onNext, onClose }: Omit<Props, 'receipt' | 'actorName'>) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const stage = masterReviewStage(candidate)
  const blockers = masterReviewBlockers(candidate, reason)
  const isReasonMissing = reason.trim().length < 3
  const terminal = stage === 'confirmed'
  const primary = stage === 'project_ready'
    ? { label: 'บันทึกการแก้ไขและส่งตรวจซ้ำ', disabled: saving || isReasonMissing, run: onCorrect }
    : stage === 'awaiting_rereview'
      ? { label: 'ยืนยันข้อเสนอ', disabled: saving || isReasonMissing, run: () => onReview('approve') }
      : terminal
        ? { label: hasNext ? 'รายการถัดไป' : 'กลับคิว', disabled: false, run: hasNext ? onNext : onClose }
        : { label: 'เลือก Project เพื่อดำเนินการต่อ', disabled: true, run: () => undefined }
  const menuAction = (action: MasterReviewAction) => { setAnchor(null); onReview(action) }
  return <Paper variant="outlined" sx={{ p: 1, position: 'sticky', bottom: 0, zIndex: 3, bgcolor: 'background.paper' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Button fullWidth variant="contained" startIcon={terminal ? <NavigateNextOutlined /> : <CheckOutlined />} disabled={primary.disabled} onClick={primary.run}>{primary.label}</Button>
        {!terminal && <Button aria-label="การดำเนินการเพิ่มเติม" variant="outlined" disabled={saving} onClick={(event) => setAnchor(event.currentTarget)}><MoreHorizOutlined /></Button>}
      </Stack>
      {primary.disabled && blockers.length > 0 && <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.75 }}>ปุ่มยังใช้ไม่ได้: {blockers.join(' · ')}</Typography>}
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem disabled={isReasonMissing || saving} onClick={() => menuAction('request_info')}><ListItemText>ขอข้อมูลเพิ่ม</ListItemText></MenuItem>
        <MenuItem disabled={isReasonMissing || saving} onClick={() => menuAction('reject')}><ListItemText>ไม่ใช่ประเภทนี้</ListItemText></MenuItem>
        {stage === 'awaiting_rereview' && <MenuItem disabled={isReasonMissing || saving} onClick={() => menuAction('keep_existing')}><ListItemText>คงข้อมูลเดิม</ListItemText></MenuItem>}
        {stage === 'awaiting_rereview' && <MenuItem disabled={isReasonMissing || saving} onClick={() => menuAction('match_master')}><ListItemText>จับคู่ Master เดิม</ListItemText></MenuItem>}
        <Divider />
        <MenuItem disabled={saving} onClick={() => menuAction('archive')}><ListItemIcon><MoreHorizOutlined fontSize="small" /></ListItemIcon><ListItemText>Archive</ListItemText></MenuItem>
        <MenuItem disabled={!hasNext} onClick={() => { setAnchor(null); onNext() }}><ListItemText>รายการถัดไป</ListItemText></MenuItem>
        <MenuItem onClick={() => { setAnchor(null); onClose() }}><ListItemText>กลับคิว</ListItemText></MenuItem>
      </Menu>
    </Paper>
}
