import { Alert, Chip, DialogContent, DialogTitle, Divider, Drawer, MenuItem, Paper, Select, Stack, Tab, Tabs, TextField, Typography } from '@mui/material'
import { EvidenceSplitReviewWorkspace, type EvidencePreviewState } from '../../components/EvidenceSplitReviewWorkspace'
import type { MasterClassification, MasterClassificationType } from '../../services/masterDataClassification'
import { classificationLabel } from '../../services/masterDataClassification'
import type { MasterAutoRoute } from '../../services/masterDataAutoInput'
import { isAdvancePartyReviewConfirmed, type MasterRecordingMode, type TransferPartyDraft } from '../../services/masterDataAdvanceFunding'
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
  partyDraft: TransferPartyDraft
  reason: string
  saving: boolean
  message: DrawerMessage | null
  activeTab: number
  requiresCorrection: boolean
  hasNext: boolean
  preview: EvidencePreviewState | null
  recordingMode: MasterRecordingMode
  advanceBlockers: string[]
  onRecordingModeChange: (mode: MasterRecordingMode) => void
  onConfirmAdvanceFunding: () => void
  onTabChange: (tab: number) => void
  onCorrectionChange: (correction: Correction) => void
  onPartyDraftChange: (draft: TransferPartyDraft) => void
  onReasonChange: (reason: string) => void
  onProjectAction: (action: ProjectGateAction, payload: Record<string, unknown>) => Promise<void>
  onCreateWorkPackage: (input: { projectId: string; parentId: string | null; name: string; description: string }) => Promise<MasterWorkPackageOption | null>
  onOpenSource: () => void
  onClosePreview: () => void
  onRetryPreview: () => void
  onOpenPreviewExternal: () => void
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

function PartyEditor({ title, classification, name, bank, account, onNameChange, onBankChange, onAccountChange }: {
  title: string
  classification: string
  name: string
  bank: string
  account: string
  onNameChange: (value: string) => void
  onBankChange: (value: string) => void
  onAccountChange: (value: string) => void
}) {
  return <Paper variant="outlined" sx={{ p: 1.25, flex: 1 }}>
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', mb: 1 }}>
      <Typography sx={{ fontWeight: 800, flex: 1 }}>{title}</Typography>
      <Chip size="small" color="info" label={classification} />
    </Stack>
    <Stack spacing={1}>
      <TextField size="small" label="ชื่อจากสลิป *" value={name} onChange={(event) => onNameChange(event.target.value)} />
      <TextField size="small" label="เลขท้ายบัญชี *" value={account} onChange={(event) => onAccountChange(event.target.value)} />
      <TextField size="small" label="ธนาคาร" value={bank} onChange={(event) => onBankChange(event.target.value)} />
    </Stack>
  </Paper>
}

export function MasterDataReviewDrawer(props: Props) {
  const { candidate, source, classification, route } = props
  if (!candidate || !classification || !route) return null
  const masterName = typeof candidate.candidate_data.master_name === 'string' ? candidate.candidate_data.master_name : null
  const masterAccount = typeof candidate.candidate_data.master_account_last4 === 'string' ? candidate.candidate_data.master_account_last4 : null
  const nameMismatch = isNameMismatch(candidate, source)
  const advanceFunding = props.recordingMode === 'employee_advance_funding'
  const advancePartiesConfirmed = isAdvancePartyReviewConfirmed(candidate)
  const terminal = ['confirmed', 'approved', 'locked'].includes(candidate.status) && (!advanceFunding || advancePartiesConfirmed)

  const reviewPane = <>
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
          <Alert severity={advanceFunding ? 'info' : props.requiresCorrection ? 'warning' : 'success'}>
            {advanceFunding ? 'เลือกโหมดเงินเบิกล่วงหน้าแล้ว: ระบบจะผูกผู้โอนกับ Company/Internal และผู้รับกับ Employee/Technician แยกกัน พร้อมยืนยันครบสองฝั่งก่อนส่งบัญชี โดยยังไม่ต้องผูก Project' : props.requiresCorrection ? 'พบข้อมูลขาดหรือขัดแย้ง ให้แก้เฉพาะช่องที่จำเป็นแล้วบันทึกเป็น Version ใหม่' : 'ข้อมูลจากหลักฐานตรงกับข้อเสนอเดิม ไม่ต้องกรอกหรือบันทึก Correction ซ้ำ'}
          </Alert>
          <MasterDataProjectGatePanel key={candidate.id} candidate={candidate} source={source} projects={props.projects} workPackages={props.workPackages} saving={props.saving} reason={props.reason} recordingMode={props.recordingMode} advanceBlockers={props.advanceBlockers} onRecordingModeChange={props.onRecordingModeChange} onAction={props.onProjectAction} onOpenSource={props.onOpenSource} onCreateWorkPackage={props.onCreateWorkPackage} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Paper variant="outlined" sx={{ p: 1.25, flex: 1 }}><Typography sx={{ fontWeight: 800 }}>ข้อมูลเดิม</Typography><Typography variant="body2">ชื่อ: {masterName ?? 'ยังไม่มี Master เดิม'}</Typography><Typography variant="body2">บัญชี: {masterAccount ? `•••• ${masterAccount.slice(-4)}` : '-'} · ธนาคาร: {(candidate.candidate_data.master_bank_name as string | undefined) ?? '-'}</Typography></Paper>
            <Paper variant="outlined" sx={{ p: 1.25, flex: 1, borderColor: nameMismatch ? 'error.main' : 'success.main' }}><Typography sx={{ fontWeight: 800 }}>หลักฐานใหม่</Typography><Typography variant="body2">ชื่อ: {source.extractedName ?? candidate.display_name}</Typography><Typography variant="body2">บัญชี: {candidateAccount(candidate) ? `•••• ${candidateAccount(candidate)}` : '-'} · ธนาคาร: {(candidate.candidate_data.bank_name as string | undefined) ?? source.transferRecipientBank ?? '-'}</Typography><Chip size="small" color={nameMismatch ? 'error' : 'success'} label={nameMismatch ? `ข้อมูลไม่ตรง: ${mismatchStage(candidate, source)}` : 'ข้อมูลตรงกับข้อเสนอ'} /></Paper>
          </Stack>
          {(advanceFunding || source.transferSenderName || source.transferRecipientName) && <Paper variant="outlined" sx={{ p: 1.25 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}><Typography sx={{ fontWeight: 800, flex: 1 }}>คู่โอนเงินจากสลิป · ตรวจและเก็บทั้งสองฝั่ง</Typography>{advancePartiesConfirmed && <Chip size="small" color="success" label="ยืนยันครบสองฝั่งแล้ว" />}</Stack>
            {advanceFunding && <Alert severity="info" sx={{ mb: 1 }}>ค่าต้นฉบับ: {source.transferSenderName ?? 'อ่านผู้โอนไม่ได้'} · •••• {source.transferSenderAccountLast4 ?? '-'} → {source.transferRecipientName ?? 'อ่านผู้รับไม่ได้'} · •••• {source.transferRecipientAccountLast4 ?? '-'} · การแก้ด้านล่างบันทึกเป็น Derived Version โดยไม่เขียนทับสลิป/OCR</Alert>}
            {advanceFunding ? <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <PartyEditor title="ผู้โอน / แหล่งเงิน" classification="Company/Internal" name={props.partyDraft.senderName} bank={props.partyDraft.senderBankName} account={props.partyDraft.senderAccountLast4} onNameChange={(value) => props.onPartyDraftChange({ ...props.partyDraft, senderName: value })} onBankChange={(value) => props.onPartyDraftChange({ ...props.partyDraft, senderBankName: value })} onAccountChange={(value) => props.onPartyDraftChange({ ...props.partyDraft, senderAccountLast4: value })} />
              <PartyEditor title="ผู้รับ / ผู้ถือเงิน" classification="Employee/Technician" name={props.partyDraft.recipientName} bank={props.partyDraft.recipientBankName} account={props.partyDraft.recipientAccountLast4} onNameChange={(value) => props.onPartyDraftChange({ ...props.partyDraft, recipientName: value })} onBankChange={(value) => props.onPartyDraftChange({ ...props.partyDraft, recipientBankName: value })} onAccountChange={(value) => props.onPartyDraftChange({ ...props.partyDraft, recipientAccountLast4: value })} />
            </Stack> : <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}><PartyCard title="ผู้โอน / แหล่งเงิน" name={source.transferSenderName} bank={source.transferSenderBank} account={source.transferSenderAccountLast4} /><PartyCard title="ผู้รับ / ผู้ถือเงิน" name={source.transferRecipientName} bank={source.transferRecipientBank} account={source.transferRecipientAccountLast4} tone={nameMismatch ? 'warning' : 'default'} /></Stack>}
            <Typography variant="body2" sx={{ mt: 1 }}>ยอด {money(source.transferAmount)} · อ้างอิง {source.bankReference ?? '-'} · ความมั่นใจคู่โอน {source.paymentPartyConfidence == null ? '-' : `${Math.round(source.paymentPartyConfidence * 100)}%`}</Typography>
            {advanceFunding && <Typography variant="caption" color="text.secondary">บันทึกเป็นคู่เดียวกันด้วย Transaction/Document/Message เดิม · ผู้โอนและผู้รับมี Master Account แยกกัน · ไม่แก้ Raw/OCR</Typography>}
          </Paper>}
          {props.requiresCorrection && !advanceFunding && <Paper variant="outlined" sx={{ p: 1.25 }}>
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
          <MasterDataReviewProgress candidate={candidate} receipt={props.receipt} reason={props.reason} actorName={props.reviewerName} requiresCorrection={props.requiresCorrection} recordingMode={props.recordingMode} advanceBlockers={props.advanceBlockers} />
          <Paper variant="outlined" sx={{ p: 1.25 }}>
            <Typography sx={{ fontWeight: 800 }}>สรุปก่อนยืนยัน</Typography>
            {advanceFunding ? <>
              <Typography variant="body2">ผู้โอน: {props.partyDraft.senderName || '-'} · •••• {props.partyDraft.senderAccountLast4 || '-'} · Company/Internal</Typography>
              <Typography variant="body2">ผู้รับ: {props.partyDraft.recipientName || '-'} · •••• {props.partyDraft.recipientAccountLast4 || '-'} · Employee/Technician</Typography>
            </> : <><Typography variant="body2">ชื่อ: {props.correction.display_name || candidate.display_name}</Typography><Typography variant="body2">ประเภท: {classificationLabel[props.correction.classification_type]} · ความมั่นใจ {Math.round(classification.confidence * 100)}%</Typography></>}
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
    <MasterDataReviewActions candidate={candidate} reason={props.reason} saving={props.saving} hasNext={props.hasNext} requiresCorrection={props.requiresCorrection} activeTab={props.activeTab} recordingMode={props.recordingMode} advanceBlockers={props.advanceBlockers} onConfirmAdvanceFunding={props.onConfirmAdvanceFunding} onTabChange={props.onTabChange} onCorrect={props.onCorrect} onReview={props.onReview} onNext={props.onNext} onClose={props.onClose} />
  </>

  return <Drawer anchor="right"
    open={props.open}
    onClose={props.onClose}
    slotProps={{ paper: { sx: { width: props.preview ? '100%' : { xs: '100%', sm: 720 }, maxWidth: '100vw' } } }}
  >
    <EvidenceSplitReviewWorkspace
      preview={props.preview}
      reviewPane={reviewPane}
      onClosePreview={props.onClosePreview}
      onRetry={props.onRetryPreview}
      onOpenExternal={props.onOpenPreviewExternal}
    />
  </Drawer>
}
