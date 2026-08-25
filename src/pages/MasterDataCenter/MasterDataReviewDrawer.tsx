import { Alert, Chip, DialogContent, DialogTitle, Divider, Drawer, MenuItem, Paper, Select, Stack, Tab, Tabs, TextField, Typography } from '@mui/material'
import type { MasterClassification, MasterClassificationType } from '../../services/masterDataClassification'
import { classificationLabel } from '../../services/masterDataClassification'
import type { MasterAutoRoute } from '../../services/masterDataAutoInput'
import type { MasterProjectOption, MasterWorkPackageOption } from '../../services/masterDataProjectGate'
import type { MasterReviewAction, MasterReviewReceipt } from '../../services/masterDataReviewWorkflow'
import { MasterDataProjectGatePanel, type ProjectGateAction } from './MasterDataProjectGatePanel'
import { MasterDataReviewActions, MasterDataReviewProgress } from './MasterDataReviewWorkflow'
import { MasterDataSourceReferenceCard } from './MasterDataSourceReferenceCard'
import { candidateAccount, isNameMismatch, mismatchStage, type MasterCandidate, type MasterSourceEvidence } from './masterDataReview'

type Correction = { display_name: string; classification_type: MasterClassificationType; account_last4: string; bank_name: string; tax_id: string }
type DrawerMessage = { severity: 'success' | 'error' | 'info'; text: string; incidentId?: string; persisted?: boolean }

type Props = {
  open: boolean
  candidate: MasterCandidate | null
  source: MasterSourceEvidence
  classification: MasterClassification | null
  route: MasterAutoRoute | null
  sourceCount: number
  projects: MasterProjectOption[]
  workPackages: MasterWorkPackageOption[]
  receipt: MasterReviewReceipt
  reviewerName: (id: string | null) => string
  correction: Correction
  reason: string
  saving: boolean
  message: DrawerMessage | null
  activeTab: number
  requiresCorrection: boolean
  hasNext: boolean
  onTabChange: (tab: number) => void
  onCorrectionChange: (correction: Correction) => void
  onReasonChange: (reason: string) => void
  onProjectAction: (action: ProjectGateAction, payload: Record<string, unknown>) => Promise<void>
  onCreateWorkPackage: (input: { projectId: string; parentId: string | null; name: string; description: string }) => Promise<MasterWorkPackageOption | null>
  onOpenSource: () => void
  onCorrect: () => void
  onReview: (action: MasterReviewAction) => void
  onNext: () => void
  onClose: () => void
}

const money = (value: number | null) => value == null ? '-' : new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(value)

function PartyCard({ title, name, bank, account, tone = 'default' }: { title: string; name: string | null; bank: string | null; account: string | null; tone?: 'default' | 'warning' }) {
  return <Paper variant="outlined" sx={{ p: 1, flex: 1, borderColor: tone === 'warning' ? 'warning.main' : undefined }}>
    <Typography variant="caption" color="text.secondary">{title}</Typography>
    <Typography variant="body2" sx={{ fontWeight: 700 }}>{name ?? 'ยังอ่านชื่อไม่ได้'}</Typography>
    <Typography variant="body2">{bank ?? 'ไม่ระบุธนาคาร'} · {account ? `•••• ${account}` : 'ยังอ่านบัญชีไม่ได้'}</Typography>
  </Paper>
}

export function MasterDataReviewDrawer(props: Props) {
  const { candidate, source, classification, route } = props
  if (!candidate || !classification || !route) return null
  const masterName = typeof candidate.candidate_data.master_name === 'string' ? candidate.candidate_data.master_name : null
  const masterAccount = typeof candidate.candidate_data.master_account_last4 === 'string' ? candidate.candidate_data.master_account_last4 : null
  const nameMismatch = isNameMismatch(candidate, source)
  const terminal = ['confirmed', 'approved', 'locked'].includes(candidate.status)

  return <Drawer anchor="right" open={props.open} onClose={props.onClose} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 720 }, maxWidth: '100vw' } } }}>
    <DialogTitle>ตรวจข้อมูลใหม่ · {candidate.display_name}</DialogTitle>
    <Tabs value={props.activeTab} onChange={(_, value: number) => props.onTabChange(value)} variant="fullWidth" sx={{ borderBottom: 1, borderColor: 'divider', position: 'sticky', top: 0, zIndex: 4, bgcolor: 'background.paper' }}>
      <Tab label="1. ตรวจและเติมข้อมูล" />
      <Tab label="2. สรุปและยืนยัน" />
    </Tabs>
    <DialogContent dividers>
      <Stack spacing={1.25}>
        {props.message && <Alert severity={props.message.severity}>
          <Typography variant="subtitle2">{props.message.severity === 'error' ? 'บันทึกไม่สำเร็จ · ข้อมูลยังไม่เปลี่ยน' : props.message.persisted ? 'ตรวจสอบการบันทึกในฐานข้อมูลแล้ว' : 'สถานะการดำเนินการ'}</Typography>
          <Typography variant="body2">{props.message.text}</Typography>
          {props.message.incidentId && <Typography variant="caption">รหัสเหตุการณ์: {props.message.incidentId}</Typography>}
        </Alert>}
        {props.activeTab === 0 ? <>
          <Alert severity={props.requiresCorrection ? 'warning' : 'success'}>
            {props.requiresCorrection ? 'พบข้อมูลขาดหรือขัดแย้ง ให้แก้เฉพาะช่องที่จำเป็นแล้วบันทึกเป็น Version ใหม่' : 'ข้อมูลจากหลักฐานตรงกับข้อเสนอเดิม ไม่ต้องกรอกหรือบันทึก Correction ซ้ำ'}
          </Alert>
          <MasterDataProjectGatePanel key={candidate.id} candidate={candidate} source={source} projects={props.projects} workPackages={props.workPackages} saving={props.saving} reason={props.reason} onAction={props.onProjectAction} onOpenSource={props.onOpenSource} onCreateWorkPackage={props.onCreateWorkPackage} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Paper variant="outlined" sx={{ p: 1.25, flex: 1 }}><Typography sx={{ fontWeight: 800 }}>ข้อมูลเดิม</Typography><Typography variant="body2">ชื่อ: {masterName ?? 'ยังไม่มี Master เดิม'}</Typography><Typography variant="body2">บัญชี: {masterAccount ? `•••• ${masterAccount.slice(-4)}` : '-'} · ธนาคาร: {(candidate.candidate_data.master_bank_name as string | undefined) ?? '-'}</Typography></Paper>
            <Paper variant="outlined" sx={{ p: 1.25, flex: 1, borderColor: nameMismatch ? 'error.main' : 'success.main' }}><Typography sx={{ fontWeight: 800 }}>หลักฐานใหม่</Typography><Typography variant="body2">ชื่อ: {source.extractedName ?? candidate.display_name}</Typography><Typography variant="body2">บัญชี: {candidateAccount(candidate) ? `•••• ${candidateAccount(candidate)}` : '-'} · ธนาคาร: {(candidate.candidate_data.bank_name as string | undefined) ?? source.transferRecipientBank ?? '-'}</Typography><Chip size="small" color={nameMismatch ? 'error' : 'success'} label={nameMismatch ? `ข้อมูลไม่ตรง: ${mismatchStage(candidate, source)}` : 'ข้อมูลตรงกับข้อเสนอ'} /></Paper>
          </Stack>
          {(source.transferSenderName || source.transferRecipientName) && <Paper variant="outlined" sx={{ p: 1.25 }}>
            <Typography sx={{ fontWeight: 800, mb: 1 }}>คู่โอนเงินจากสลิป</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}><PartyCard title="ผู้โอน / แหล่งเงิน" name={source.transferSenderName} bank={source.transferSenderBank} account={source.transferSenderAccountLast4} /><PartyCard title="ผู้รับ / ผู้ถือเงิน" name={source.transferRecipientName} bank={source.transferRecipientBank} account={source.transferRecipientAccountLast4} tone={nameMismatch ? 'warning' : 'default'} /></Stack>
            <Typography variant="body2" sx={{ mt: 1 }}>ยอด {money(source.transferAmount)} · อ้างอิง {source.bankReference ?? '-'} · ความมั่นใจคู่โอน {source.paymentPartyConfidence == null ? '-' : `${Math.round(source.paymentPartyConfidence * 100)}%`}</Typography>
          </Paper>}
          {props.requiresCorrection && <Paper variant="outlined" sx={{ p: 1.25 }}>
            <Typography sx={{ fontWeight: 800, mb: 1 }}>แก้เฉพาะข้อมูล Derived · ไม่แก้ Raw/OCR</Typography>
            <Stack spacing={1}>
              <TextField size="small" label="ชื่อที่แก้ไข" value={props.correction.display_name} onChange={(event) => props.onCorrectionChange({ ...props.correction, display_name: event.target.value })} />
              <Select size="small" value={props.correction.classification_type} onChange={(event) => props.onCorrectionChange({ ...props.correction, classification_type: event.target.value as MasterClassificationType })}>{Object.entries(classificationLabel).map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}</Select>
              <TextField size="small" label="เลขท้ายบัญชี" value={props.correction.account_last4} onChange={(event) => props.onCorrectionChange({ ...props.correction, account_last4: event.target.value })} />
              <TextField size="small" label="ธนาคาร" value={props.correction.bank_name} onChange={(event) => props.onCorrectionChange({ ...props.correction, bank_name: event.target.value })} />
              <TextField size="small" label="เลขภาษี" value={props.correction.tax_id} onChange={(event) => props.onCorrectionChange({ ...props.correction, tax_id: event.target.value })} />
            </Stack>
            <Typography variant="caption" color="text.secondary">การบันทึก append before/after, actor, เวลา, reason และ Source ลง Audit/Version</Typography>
          </Paper>}
        </> : <>
          <MasterDataReviewProgress candidate={candidate} receipt={props.receipt} reason={props.reason} actorName={props.reviewerName} requiresCorrection={props.requiresCorrection} />
          <Paper variant="outlined" sx={{ p: 1.25 }}>
            <Typography sx={{ fontWeight: 800 }}>สรุปก่อนยืนยัน</Typography>
            <Typography variant="body2">ชื่อ: {props.correction.display_name || candidate.display_name}</Typography>
            <Typography variant="body2">ประเภท: {classificationLabel[props.correction.classification_type]} · ความมั่นใจ {Math.round(classification.confidence * 100)}%</Typography>
            <Typography variant="body2">ปลายทาง: {route.destination} · ผู้รับผิดชอบ: {route.owner}</Typography>
            <Typography variant="body2">สิ่งที่ต้องทำต่อ: {route.nextAction}</Typography>
            <Typography variant="body2" color={classification.conflicts.length ? 'error' : 'success.main'}>Conflict: {classification.conflicts.join(', ') || 'ไม่พบ'}</Typography>
            <Chip size="small" color={classification.autoVerified ? 'success' : 'warning'} label={classification.autoVerified ? 'Auto Verified · ยังไม่ Final/Locked' : 'Admin ต้องยืนยัน'} />
          </Paper>
          <MasterDataSourceReferenceCard source={source} sourceCount={props.sourceCount} onOpenSource={props.onOpenSource} />
        </>}
        {!terminal && <><Divider /><TextField multiline minRows={2} label="เหตุผล (บังคับเมื่อบันทึก/ยืนยัน/ตัดสินใจ)" value={props.reason} onChange={(event) => props.onReasonChange(event.target.value)} /></>}
      </Stack>
    </DialogContent>
    <MasterDataReviewActions candidate={candidate} reason={props.reason} saving={props.saving} hasNext={props.hasNext} requiresCorrection={props.requiresCorrection} activeTab={props.activeTab} onTabChange={props.onTabChange} onCorrect={props.onCorrect} onReview={props.onReview} onNext={props.onNext} onClose={props.onClose} />
  </Drawer>
}
