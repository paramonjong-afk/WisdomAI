import { AddBusinessOutlined, ArrowBackOutlined, LinkOutlined, OpenInNewOutlined } from '@mui/icons-material'
import { Alert, Button, Chip, MenuItem, Paper, Select, Stack, TextField, Typography } from '@mui/material'
import { useMemo, useState } from 'react'
import {
  findProjectMatches,
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
  message: { severity: 'success' | 'error' | 'info'; text: string } | null
  onAction: (action: ProjectGateAction, payload: Record<string, unknown>, draft?: MasterProjectCandidateDraft) => Promise<void>
  onOpenSource: () => void
}

export function MasterDataProjectGatePanel({ candidate, source, projects, saving, reason, message, onAction, onOpenSource }: Props) {
  const matches = useMemo(() => findProjectMatches(candidate, source, projects), [candidate, projects, source])
  const [selectedProjectId, setSelectedProjectId] = useState(() => typeof candidate.candidate_data.project_id === 'string' ? candidate.candidate_data.project_id : matches[0]?.project.id ?? '')
  const [draft, setDraft] = useState<MasterProjectCandidateDraft>(() => projectDraftFromCandidate(candidate, source))
  const validation = useMemo(() => validateProjectDraft(draft, source), [draft, source])
  const gate = projectGateStatus(candidate)
  const reasonMissing = reason.trim().length < 3

  const selectedProject = projects.find((project) => project.id === selectedProjectId)
  const selectedMatch = matches.find((match) => match.project.id === selectedProjectId)
  const set = (key: keyof MasterProjectCandidateDraft, value: string) => setDraft((current) => ({ ...current, [key]: value }))

  return <Paper variant="outlined" sx={{ p: 1.25, borderColor: 'primary.main' }}>
    <Stack spacing={1.25}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
        <Typography sx={{ fontWeight: 800, flex: 1 }}>Project-first Gate</Typography>
        <Chip size="small" color={gate === 'linked_existing_project' || gate === 'awaiting_new_project' || gate === 'confirmed' ? 'success' : 'warning'} label={projectGateStatusLabel[gate]} />
      </Stack>
      <Typography variant="body2">ต้องผูก Project เดิม หรือบันทึก Project Candidate ที่ข้อมูลขั้นต่ำครบ ก่อนยืนยันรายการออกจากคิว</Typography>
      {message && <Alert severity={message.severity}>{message.text}</Alert>}
      {reasonMissing && <Alert severity="info">ระบุเหตุผลอย่างน้อย 3 ตัวอักษรด้านล่างเพื่อเปิดใช้ปุ่มบันทึก/ตัดสินใจ</Alert>}

      <Paper variant="outlined" sx={{ p: 1 }}>
        <Typography variant="subtitle2">หลักฐานสำหรับหา Project</Typography>
        <Typography variant="body2">Source: {source.sourceRoom ?? source.sourceChannel ?? '-'} · Document/Intake: {source.documentId ?? source.intakeId ?? '-'}</Typography>
        <Typography variant="body2">Message: {source.messageId ?? '-'} · OCR: {source.ocrRawText ?? 'ไม่พบ OCR text'}</Typography>
        {(source.path || source.documentId || source.messageId) && <Button size="small" startIcon={<OpenInNewOutlined />} onClick={onOpenSource}>เปิดต้นทาง</Button>}
      </Paper>

      <Typography variant="subtitle2">1. ค้นและผูก Project เดิม ({projects.length} โครงการ)</Typography>
      <Select size="small" displayEmpty value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}>
        <MenuItem value="">เลือก Project เดิม</MenuItem>
        {projects.map((project) => {
          const match = matches.find((item) => item.project.id === project.id)
          return <MenuItem key={project.id} value={project.id}>{project.name}{project.code ? ` · ${project.code}` : ''}{match ? ` · ตรง ${match.score} หลักฐาน` : ''}</MenuItem>
        })}
      </Select>
      {matches.length > 0 && <Alert severity="info">แนะนำ: {matches.slice(0, 3).map((match) => `${match.project.name} (${match.evidence.join(', ')})`).join(' · ')}</Alert>}
      <Button startIcon={<LinkOutlined />} variant="outlined" disabled={!selectedProject || saving || reasonMissing} onClick={() => selectedProject && void onAction('link_existing_project', { project_id: selectedProject.id, project_name: selectedProject.name, match_evidence: selectedMatch?.evidence ?? ['admin_selected'] })}>ผูก Project เดิม</Button>

      <Typography variant="subtitle2">2. ไม่พบ Project เดิม — สร้าง/อัปเดต Project Candidate</Typography>
      <TextField size="small" label="ชื่อโครงการ *" value={draft.project_name} onChange={(event) => set('project_name', event.target.value)} />
      <TextField size="small" label="ลูกค้าหรือเจ้าของงาน *" value={draft.customer_owner_name} onChange={(event) => set('customer_owner_name', event.target.value)} />
      <TextField size="small" label="ไซต์/สถานที่ *" value={draft.site_location} onChange={(event) => set('site_location', event.target.value)} />
      <TextField size="small" label="ผู้รับผิดชอบ *" value={draft.responsible_name} onChange={(event) => set('responsible_name', event.target.value)} />
      <TextField size="small" label="ประเภทงาน *" value={draft.work_type} onChange={(event) => set('work_type', event.target.value)} />
      <TextField size="small" type="date" label="วันที่เริ่มโดยประมาณ *" value={draft.approximate_start_date} onChange={(event) => set('approximate_start_date', event.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
      {!validation.valid && <Alert severity="warning">ข้อมูลที่ยังขาด: {validation.missing.join(', ')}</Alert>}
      <Button startIcon={<AddBusinessOutlined />} variant="outlined" disabled={!validation.valid || saving || reasonMissing} onClick={() => void onAction('save_project_candidate', draft, draft)}>สร้าง/อัปเดต Project Candidate</Button>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <Button color="warning" disabled={saving || reasonMissing} onClick={() => void onAction('request_information', {})}>ขอข้อมูลเพิ่ม</Button>
        <Button startIcon={<ArrowBackOutlined />} disabled={saving || reasonMissing} onClick={() => void onAction('return_review', {})}>กลับคิวตรวจ</Button>
      </Stack>
      <Typography variant="caption" color="text.secondary">Project Candidate เป็นคิวรอเปิดโครงการ ไม่สร้าง Project จริงอัตโนมัติ · Raw/OCR เดิมไม่ถูกเขียนทับ · ทุก action append Version/Audit</Typography>
    </Stack>
  </Paper>
}
