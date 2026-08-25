import { AddBusinessOutlined, LinkOutlined, OpenInNewOutlined } from '@mui/icons-material'
import { Alert, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, MenuItem, Paper, Select, Stack, TextField, Typography } from '@mui/material'
import { useMemo, useState } from 'react'
import { buildMasterAutoCorrection, masterAutoRoute, type AutoInputField } from '../../services/masterDataAutoInput'
import { classifyMasterCandidate, classificationLabel } from '../../services/masterDataClassification'
import {
  autoSelectedProjectId,
  findProjectMatches,
  projectDraftAuditPayload,
  projectDraftFromCandidate,
  projectGateStatus,
  projectGateStatusLabel,
  validateProjectDraft,
  type MasterProjectCandidateDraft,
  type MasterProjectOption,
} from '../../services/masterDataProjectGate'
import type { MasterCandidate, MasterSourceEvidence } from './masterDataReview'

export type ProjectGateAction = 'link_existing_project' | 'save_project_candidate' | 'request_information' | 'return_review'

type Props = {
  candidate: MasterCandidate
  source: MasterSourceEvidence
  projects: MasterProjectOption[]
  saving: boolean
  reason: string
  message?: { severity: 'success' | 'error' | 'info'; text: string; incidentId?: string; persisted?: boolean } | null
  onAction: (action: ProjectGateAction, payload: Record<string, unknown>) => Promise<void>
  onOpenSource: () => void
}

const autoTone = (value: string, confidence: number | null, fieldStatus?: AutoInputField['status']) => {
  if (!value || fieldStatus === 'missing') return { color: 'default' as const, label: 'ยังไม่มีข้อมูล' }
  if (fieldStatus === 'conflict') return { color: 'error' as const, label: 'ข้อมูลขัดแย้ง' }
  if (fieldStatus === 'ready' || (fieldStatus == null && confidence != null && confidence >= 0.95)) return { color: 'success' as const, label: 'Auto พร้อมใช้' }
  return { color: 'warning' as const, label: 'Auto · โปรดตรวจ' }
}

function AutoFieldHint({ value, source, confidence, status }: Pick<AutoInputField, 'value' | 'source' | 'confidence'> & { status?: AutoInputField['status'] }) {
  const tone = autoTone(value, confidence, status)
  return <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', mt: 0.25, flexWrap: 'wrap' }}>
    <Chip size="small" color={tone.color} label={tone.label} />
    <Typography variant="caption" color="text.secondary">ที่มา: {source || 'รอ Admin ระบุ'}{confidence == null ? '' : ` · ${Math.round(confidence * 100)}%`}</Typography>
  </Stack>
}

export function MasterDataProjectGatePanel({ candidate, source, projects, saving, reason, message, onAction, onOpenSource }: Props) {
  const matches = useMemo(() => findProjectMatches(candidate, source, projects), [candidate, projects, source])
  const [selectedProjectId, setSelectedProjectId] = useState(() => autoSelectedProjectId(candidate, matches))
  const [draft, setDraft] = useState<MasterProjectCandidateDraft>(() => projectDraftFromCandidate(candidate, source))
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const validation = useMemo(() => validateProjectDraft(draft, source), [draft, source])
  const auditPayload = useMemo(() => projectDraftAuditPayload(candidate, source, draft), [candidate, draft, source])
  const gate = projectGateStatus(candidate)
  const classification = useMemo(() => classifyMasterCandidate(candidate, source), [candidate, source])
  const autoCorrection = useMemo(() => buildMasterAutoCorrection(candidate, source, classification), [candidate, classification, source])
  const route = useMemo(() => masterAutoRoute(autoCorrection.classification_type.value, classification.confidence, classification.conflicts), [autoCorrection.classification_type.value, classification.confidence, classification.conflicts])
  const reasonMissing = reason.trim().length < 3
  const selectedProject = projects.find((project) => project.id === selectedProjectId)
  const selectedMatch = matches.find((match) => match.project.id === selectedProjectId)
  const set = (key: keyof MasterProjectCandidateDraft, value: string) => setDraft((current) => ({ ...current, [key]: value }))
  const fieldEvidence = auditPayload.auto_fill_evidence
  const submitProjectCandidate = async () => {
    if (!validation.valid) return
    await onAction('save_project_candidate', { ...draft, ...auditPayload })
    setProjectDialogOpen(false)
  }

  return <Paper variant="outlined" sx={{ p: 1.25, borderColor: 'primary.main' }}>
    <Stack spacing={1.25}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
        <Typography sx={{ fontWeight: 800, flex: 1 }}>1. ความสัมพันธ์กับ Project · Project-first Gate</Typography>
        <Chip size="small" color={gate === 'linked_existing_project' || gate === 'awaiting_new_project' || gate === 'confirmed' ? 'success' : 'warning'} label={projectGateStatusLabel[gate]} />
      </Stack>
      <Typography variant="body2">ระบบค้น Project เดิมจากชื่อ ลูกค้า ไซต์ เลขอ้างอิง ผู้รับผิดชอบ และห้องต้นทางก่อนเสมอ ถ้าไม่พบจึงสร้าง Project Candidate รอเปิดโครงการ</Typography>
      {message && <Alert severity={message.severity} sx={{ position: 'fixed', top: { xs: 112, sm: 136 }, right: { xs: 12, sm: 28 }, width: { xs: 'calc(100% - 24px)', sm: 624 }, maxWidth: 'calc(100vw - 24px)', zIndex: 1400, boxShadow: 6 }}>
        <Typography variant="subtitle2">{message.severity === 'error' ? 'บันทึกไม่สำเร็จ · ข้อมูลยังไม่เปลี่ยน' : message.persisted ? 'ตรวจสอบการบันทึกในฐานข้อมูลแล้ว' : 'สถานะการดำเนินการ'}</Typography>
        <Typography variant="body2">{message.text}</Typography>
        {message.incidentId && <Typography variant="caption">รหัสเหตุการณ์: {message.incidentId}</Typography>}
      </Alert>}
      {reasonMissing && <Alert severity="info">ระบุเหตุผลอย่างน้อย 3 ตัวอักษรเพื่อเปิดใช้ปุ่มบันทึก</Alert>}

      <Paper variant="outlined" sx={{ p: 1 }}>
        <Typography variant="subtitle2">หลักฐานที่ใช้ Auto</Typography>
        <Typography variant="body2">{source.sourceChannel ?? '-'} · {source.sourceRoom ?? '-'} · ผู้ส่ง {source.sourceSender ?? '-'}</Typography>
        <Typography variant="body2">Document/Intake: {source.documentId ?? source.intakeId ?? '-'} · Message: {source.messageId ?? '-'}</Typography>
        {(source.path || source.documentId || source.messageId) && <Button size="small" startIcon={<OpenInNewOutlined />} onClick={onOpenSource}>เปิดต้นทาง</Button>}
      </Paper>

      <Paper variant="outlined" sx={{ p: 1, bgcolor: 'action.hover' }}>
        <Typography variant="subtitle2">Auto Input · ลดการกรอก</Typography>
        <Stack spacing={0.5} sx={{ mt: 0.75 }}>
          {([
            ['ชื่อ', autoCorrection.display_name],
            ['ประเภท', { ...autoCorrection.classification_type, value: classificationLabel[autoCorrection.classification_type.value] }],
            ['เลขท้ายบัญชี', autoCorrection.account_last4],
            ['ธนาคาร', autoCorrection.bank_name],
            ['เลขภาษี', autoCorrection.tax_id],
          ] as Array<[string, AutoInputField]>).map(([label, field]) => <Stack key={label} direction={{ xs: 'column', sm: 'row' }} spacing={0.5} sx={{ alignItems: { sm: 'center' } }}><Typography variant="body2" sx={{ minWidth: 100 }}>{label}: {field.value || '-'}</Typography><AutoFieldHint {...field} /></Stack>)}
        </Stack>
        <Divider sx={{ my: 0.75 }} />
        <Typography variant="body2"><strong>ปลายทางแนะนำ:</strong> {route.destination} · เจ้าของ {route.owner}</Typography>
        <Typography variant="body2"><strong>ทำต่อ:</strong> {route.nextAction}{route.requiresReview ? ' · ต้องตรวจโดยคน' : ' · หลักฐานครบตามเกณฑ์ Auto'}</Typography>
      </Paper>

      <Typography variant="subtitle2">Project เดิม ({projects.length} โครงการ)</Typography>
      <Select size="small" displayEmpty value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}>
        <MenuItem value="">ยังไม่พบ/เลือก Project เดิม</MenuItem>
        {projects.map((project) => {
          const match = matches.find((item) => item.project.id === project.id)
          return <MenuItem key={project.id} value={project.id}>{project.name}{project.code ? ` · ${project.code}` : ''}{match ? ` · ตรง ${match.score} หลักฐาน` : ''}</MenuItem>
        })}
      </Select>
      {matches.length > 0 && <Alert severity="info">ระบบแนะนำ: {matches.slice(0, 3).map((match) => `${match.project.name} (${match.evidence.join(', ')})`).join(' · ')}</Alert>}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <Button fullWidth startIcon={<LinkOutlined />} variant="contained" disabled={!selectedProject || saving || reasonMissing} onClick={() => selectedProject && void onAction('link_existing_project', { project_id: selectedProject.id, project_name: selectedProject.name, match_evidence: selectedMatch?.evidence ?? ['admin_selected'] })}>ผูก Project เดิม</Button>
        <Button fullWidth startIcon={<AddBusinessOutlined />} variant="outlined" disabled={saving} onClick={() => setProjectDialogOpen(true)}>เพิ่ม Project Candidate</Button>
      </Stack>
      <Typography variant="caption" color="text.secondary">Project Candidate ไม่ใช่ Project จริงและยังใช้ปิดบัญชี/ตัดยอดไม่ได้ · Raw/OCR ไม่ถูกเขียนทับ · ทุกการบันทึกมี Version/Audit</Typography>
    </Stack>

    <Dialog open={projectDialogOpen} onClose={() => setProjectDialogOpen(false)} fullWidth maxWidth="sm">
      <DialogTitle>เพิ่ม Project Candidate</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.25}>
          <Alert severity="info">ระบบเติมจากหลักฐานให้ก่อน ช่องสีเขียวพร้อมใช้ ช่องสีเหลืองควรตรวจ และช่องที่ว่างให้กรอกเฉพาะข้อมูลจำเป็น</Alert>
          <div><TextField fullWidth size="small" label="ชื่อโครงการ *" value={draft.project_name} onChange={(event) => set('project_name', event.target.value)} /><AutoFieldHint value={draft.project_name} {...fieldEvidence.project_name} /></div>
          <div><TextField fullWidth size="small" label="ลูกค้าหรือเจ้าของงาน *" value={draft.customer_owner_name} onChange={(event) => set('customer_owner_name', event.target.value)} /><AutoFieldHint value={draft.customer_owner_name} {...fieldEvidence.customer_owner_name} /></div>
          <div><TextField fullWidth size="small" label="ไซต์/สถานที่ *" value={draft.site_location} onChange={(event) => set('site_location', event.target.value)} /><AutoFieldHint value={draft.site_location} {...fieldEvidence.site_location} /></div>
          <div><TextField fullWidth size="small" label="ผู้รับผิดชอบ *" value={draft.responsible_name} onChange={(event) => set('responsible_name', event.target.value)} /><AutoFieldHint value={draft.responsible_name} {...fieldEvidence.responsible_name} /></div>
          <div><TextField fullWidth size="small" label="ประเภทงาน *" value={draft.work_type} onChange={(event) => set('work_type', event.target.value)} /><AutoFieldHint value={draft.work_type} {...fieldEvidence.work_type} /></div>
          <div><TextField fullWidth size="small" type="date" label="วันเริ่มโครงการ *" value={draft.approximate_start_date} onChange={(event) => set('approximate_start_date', event.target.value)} slotProps={{ inputLabel: { shrink: true } }} /><AutoFieldHint value={draft.approximate_start_date} {...fieldEvidence.approximate_start_date} /><Typography variant="caption" color="text.secondary">ค่าเริ่มต้นคือวันที่พบกิจกรรม/ข้อความ/เอกสารแรกที่สัมพันธ์กับโครงการ Admin แก้ได้ก่อนบันทึก</Typography></div>
          <Divider />
          <Typography variant="body2">Source จะถูกแนบอัตโนมัติ: {source.documentId ?? source.intakeId ?? source.messageId ?? 'ยังไม่พบ Source'}</Typography>
          {!validation.valid && <Alert severity="warning">ข้อมูลที่ยังขาด: {validation.missing.join(', ')}</Alert>}
          {reasonMissing && <Alert severity="warning">กรุณากลับไประบุเหตุผลอย่างน้อย 3 ตัวอักษรใน Drawer</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setProjectDialogOpen(false)}>ยกเลิก</Button>
        <Button variant="contained" disabled={!validation.valid || saving || reasonMissing} onClick={() => void submitProjectCandidate()}>บันทึก Project Candidate</Button>
      </DialogActions>
    </Dialog>
  </Paper>
}
