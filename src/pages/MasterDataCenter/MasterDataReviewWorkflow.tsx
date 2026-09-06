import { CheckOutlined, MoreHorizOutlined, NavigateNextOutlined } from '@mui/icons-material'
import { Alert, Button, Chip, Divider, ListItemIcon, ListItemText, Menu, MenuItem, Paper, Stack, Typography } from '@mui/material'
import { useState } from 'react'
import { isAdvancePartyReviewConfirmed, type MasterRecordingMode } from '../../services/masterDataAdvanceFunding'
import {
  masterReviewBlockers,
  masterReviewPersistenceNotice,
  masterReviewStage,
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
  onCorrectAndConfirm: () => void
  onReview: (action: MasterReviewAction) => void
  onNext: () => void
  onClose: () => void
  requiresCorrection: boolean
  canCorrectAndConfirm: boolean
  activeTab: number
  onTabChange: (tab: number) => void
  recordingMode: MasterRecordingMode
  advanceBlockers: string[]
  onConfirmAdvanceFunding: () => void
}

type ProgressProps = Pick<Props, 'candidate' | 'receipt' | 'reason' | 'actorName' | 'requiresCorrection' | 'recordingMode' | 'advanceBlockers'>

const dateTime = (value: string | null) => value ? new Date(value).toLocaleString('th-TH') : '-'
const value = (data: Record<string, unknown> | null, key: string) => data && data[key] != null ? String(data[key]) : '-'

export function MasterDataReviewProgress({ candidate, receipt, reason, actorName, requiresCorrection, recordingMode, advanceBlockers }: ProgressProps) {
  const stage = masterReviewStage(candidate)
  const advanceFunding = recordingMode === 'employee_advance_funding'
  const blockers = advanceFunding ? advanceBlockers : masterReviewBlockers(candidate, reason, requiresCorrection)
  const terminal = stage === 'confirmed' && (!advanceFunding || isAdvancePartyReviewConfirmed(candidate))
  const persistedNotice = masterReviewPersistenceNotice(candidate)
  return <Stack spacing={1.25}>
    <Paper variant="outlined" sx={{ p: 1.25 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.75} sx={{ alignItems: { sm: 'center' } }}>
        <Typography sx={{ fontWeight: 800, flex: 1 }}>สถานะรายการ</Typography>
        <Chip size="small" color={terminal ? 'success' : advanceFunding && blockers.length === 0 ? 'primary' : stage === 'project_pending' ? 'warning' : 'primary'} label={terminal ? 'ยืนยันแล้ว' : advanceFunding ? blockers.length ? 'ข้อมูลเงินทดลองจ่ายยังไม่ครบ' : 'พร้อมส่งบัญชี' : stage === 'project_pending' ? 'รอ Project' : stage === 'awaiting_rereview' ? 'รอตรวจซ้ำ' : requiresCorrection ? 'รอบันทึกข้อมูลที่แก้' : 'พร้อมยืนยัน'} />
      </Stack>
      {advanceFunding ? <Chip size="small" color="info" label="ไม่บังคับ Project · Project รอจัดสรรตอนลงค่าใช้จ่าย/กระทบยอด" sx={{ mt: 1 }} /> : projectGateSummary(candidate) && <Chip size="small" color="success" label={projectGateSummary(candidate)} sx={{ mt: 1 }} />}
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

export function MasterDataReviewActions({ candidate, reason, saving, hasNext, requiresCorrection, canCorrectAndConfirm, activeTab, recordingMode, advanceBlockers, onConfirmAdvanceFunding, onTabChange, onCorrect, onCorrectAndConfirm, onReview, onNext, onClose }: Omit<Props, 'receipt' | 'actorName'>) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const stage = masterReviewStage(candidate)
  const advanceFunding = recordingMode === 'employee_advance_funding'
  const blockers = advanceFunding ? advanceBlockers : masterReviewBlockers(candidate, reason, requiresCorrection)
  const isReasonMissing = reason.trim().length < 3
  const terminal = stage === 'confirmed' && (!advanceFunding || isAdvancePartyReviewConfirmed(candidate))
  const primary = terminal
    ? { label: hasNext ? 'รายการถัดไป' : 'กลับคิว', disabled: false, run: hasNext ? onNext : onClose }
    : advanceFunding
      ? activeTab === 0
        ? { label: 'ไปสรุปและยืนยัน', disabled: false, run: () => onTabChange(1) }
        : { label: 'ยืนยันผู้โอน–ผู้รับ และส่งบัญชี', disabled: saving || blockers.length > 0, run: onConfirmAdvanceFunding }
    : stage === 'project_ready' && activeTab === 0 && requiresCorrection
    ? canCorrectAndConfirm
      ? { label: 'บันทึกและยืนยันข้อมูล', disabled: saving || isReasonMissing, run: onCorrectAndConfirm }
      : { label: 'บันทึกข้อมูลที่แก้และส่งตรวจซ้ำ', disabled: saving || isReasonMissing, run: onCorrect }
    : (stage === 'project_ready' || stage === 'awaiting_rereview') && activeTab === 0
      ? { label: 'ไปสรุปและยืนยัน', disabled: false, run: () => onTabChange(1) }
      : (stage === 'project_ready' && !requiresCorrection) || stage === 'awaiting_rereview'
        ? { label: 'ยืนยันข้อมูล', disabled: saving || isReasonMissing, run: () => onReview('approve') }
      : activeTab === 1
          ? { label: 'กลับไปเลือก Project', disabled: false, run: () => onTabChange(0) }
          : { label: 'เลือก Project เพื่อดำเนินการต่อ', disabled: true, run: () => undefined }
  const menuAction = (action: MasterReviewAction) => { setAnchor(null); onReview(action) }
  return <Paper variant="outlined" sx={{ p: 1, position: 'sticky', bottom: 0, zIndex: 3, bgcolor: 'background.paper' }}>
      {terminal && <Chip size="small" color="success" icon={<CheckOutlined />} label="บันทึกแล้ว · ปิดการยืนยันซ้ำ" sx={{ mb: 1 }} />}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Button fullWidth variant="contained" startIcon={terminal ? <NavigateNextOutlined /> : <CheckOutlined />} disabled={primary.disabled} onClick={primary.run}>{primary.label}</Button>
        {!terminal && <Button aria-label="การดำเนินการเพิ่มเติม" variant="outlined" disabled={saving} onClick={(event) => setAnchor(event.currentTarget)}><MoreHorizOutlined /></Button>}
      </Stack>
      {primary.disabled && blockers.length > 0 && <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.75 }}>ปุ่มยังใช้ไม่ได้: {blockers.join(' · ')}</Typography>}
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem disabled={isReasonMissing || saving} onClick={() => menuAction('request_info')}><ListItemText>ขอข้อมูลเพิ่ม</ListItemText></MenuItem>
        <MenuItem disabled={isReasonMissing || saving} onClick={() => menuAction('reject')}><ListItemText>ไม่ใช่ประเภทนี้</ListItemText></MenuItem>
        {(stage === 'awaiting_rereview' || stage === 'project_ready') && <MenuItem disabled={isReasonMissing || saving} onClick={() => menuAction('keep_existing')}><ListItemText>คงข้อมูลเดิม</ListItemText></MenuItem>}
        {(stage === 'awaiting_rereview' || stage === 'project_ready') && <MenuItem disabled={isReasonMissing || saving} onClick={() => menuAction('match_master')}><ListItemText>จับคู่ Master เดิม</ListItemText></MenuItem>}
        <Divider />
        <MenuItem disabled={saving} onClick={() => menuAction('archive')}><ListItemIcon><MoreHorizOutlined fontSize="small" /></ListItemIcon><ListItemText>Archive</ListItemText></MenuItem>
        <MenuItem disabled={!hasNext} onClick={() => { setAnchor(null); onNext() }}><ListItemText>รายการถัดไป</ListItemText></MenuItem>
        <MenuItem onClick={() => { setAnchor(null); onClose() }}><ListItemText>กลับคิว</ListItemText></MenuItem>
      </Menu>
    </Paper>
}
