import {
  Alert, Button, CircularProgress, MenuItem, Paper, Stack, TextField, Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { userError } from '../../utils/userError'
import { runWithMutationAttempt } from '../../utils/mutationAttemptRunner'

type Props = { profileId: string }
type IdentityDocument = {
  id: string; document_type: string; identifier_last4: string | null
  issued_on: string | null; expires_on: string | null; review_status: string; created_at: string
}
type EmergencyContact = {
  id: string; full_name: string; relationship: string; phone: string; is_primary: boolean
}

const documentLabels: Record<string, string> = {
  thai_national_id: 'บัตรประจำตัวประชาชน',
  driving_license: 'ใบขับขี่',
  passport: 'หนังสือเดินทาง',
  work_permit: 'ใบอนุญาตทำงาน',
  house_registration: 'ทะเบียนบ้าน',
  professional_license: 'ใบอนุญาตวิชาชีพ',
  education_certificate: 'หลักฐานการศึกษา',
  medical_certificate: 'ใบรับรองแพทย์',
  bank_evidence: 'หลักฐานบัญชีธนาคาร',
  other: 'เอกสารอื่น',
}

export function PersonalDocumentsPanel({ profileId }: Props) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [documents, setDocuments] = useState<IdentityDocument[]>([])
  const [contacts, setContacts] = useState<EmergencyContact[]>([])
  const [personal, setPersonal] = useState({
    first_name_th: '', last_name_th: '', preferred_name: '', date_of_birth: '',
    phone: '', personal_email: '', address_line: '', district: '', province: '', postal_code: '',
  })
  const [contact, setContact] = useState({ full_name: '', relationship: '', phone: '' })
  const [document, setDocument] = useState({
    document_type: 'thai_national_id', identifier_last4: '', issued_on: '', expires_on: '',
  })
  const [file, setFile] = useState<File | null>(null)

  const load = useCallback(async () => {
    const [profileResult, documentResult, contactResult] = await Promise.all([
      supabase.from('employee_private_profiles').select(
        'first_name_th,last_name_th,preferred_name,date_of_birth,phone,personal_email,address_line,district,province,postal_code',
      ).eq('profile_id', profileId).maybeSingle(),
      supabase.from('employee_identity_documents').select(
        'id,document_type,identifier_last4,issued_on,expires_on,review_status,created_at',
      ).eq('profile_id', profileId).order('created_at', { ascending: false }),
      supabase.from('employee_emergency_contacts').select(
        'id,full_name,relationship,phone,is_primary',
      ).eq('profile_id', profileId).order('is_primary', { ascending: false }),
    ])
    const firstError = [profileResult, documentResult, contactResult].find((result) => result.error)?.error
    if (firstError) setErrorMessage(userError(firstError))
    if (profileResult.data) setPersonal(Object.fromEntries(
      Object.entries(personal).map(([key]) => [key, profileResult.data?.[key as keyof typeof profileResult.data] ?? '']),
    ) as typeof personal)
    setDocuments((documentResult.data ?? []) as IdentityDocument[])
    setContacts((contactResult.data ?? []) as EmergencyContact[])
  // personal keys are intentionally fixed for normalizing nullable database values.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const savePersonal = async () => {
    setBusy(true); setMessage(''); setErrorMessage('')
    try {
      await runWithMutationAttempt({
        module: 'PersonalDocuments',
        action: 'บันทึกข้อมูลส่วนตัวจากเอกสาร',
        actorProfileId: profileId,
        companyId: null,
        request: {
          profile_id: profileId,
          data_status: 'pending_review',
          date_of_birth: personal.date_of_birth || null,
        },
        operation: async () => await supabase.from('employee_private_profiles').upsert({
          profile_id: profileId,
          ...personal,
          date_of_birth: personal.date_of_birth || null,
          data_status: 'pending_review',
          updated_at: new Date().toISOString(),
        }),
      })
      setMessage('บันทึกข้อมูลส่วนตัวและส่งรอตรวจสอบแล้ว')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : userError(error))
    }
    setBusy(false)
  }

  const addContact = async () => {
    setBusy(true); setMessage(''); setErrorMessage('')
    try {
      await runWithMutationAttempt({
        module: 'PersonalDocuments',
        action: 'เพิ่มผู้ติดต่อฉุกเฉิน',
        actorProfileId: profileId,
        companyId: null,
        request: { profile_id: profileId, ...contact },
        operation: async () => await supabase.from('employee_emergency_contacts').insert({
          profile_id: profileId, ...contact, is_primary: contacts.length === 0,
          consent_confirmed_at: new Date().toISOString(),
        }),
      })
      setContact({ full_name: '', relationship: '', phone: '' })
      setMessage('เพิ่มผู้ติดต่อฉุกเฉินแล้ว')
      await load()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : userError(error))
    }
    setBusy(false)
  }

  const uploadDocument = async () => {
    if (!file) return
    setBusy(true); setMessage(''); setErrorMessage('')
    const extension = file.name.split('.').pop()?.toLowerCase() || 'bin'
    const path = `${profileId}/${crypto.randomUUID()}.${extension}`
    const upload = await supabase.storage.from('employee-private-documents').upload(path, file, {
      contentType: file.type, upsert: false,
    })
    if (upload.error) {
      setErrorMessage(userError(upload.error)); setBusy(false); return
    }
    try {
      await runWithMutationAttempt({
        module: 'PersonalDocuments',
        action: 'อัปโหลดเอกสารบุคคล',
        actorProfileId: profileId,
        companyId: null,
        request: {
          profile_id: profileId,
          document_type: document.document_type,
          identifier_last4: document.identifier_last4.trim() || null,
          issued_on: document.issued_on || null,
          expires_on: document.expires_on || null,
        },
        operation: async () => await supabase.from('employee_identity_documents').insert({
          profile_id: profileId,
          document_type: document.document_type,
          identifier_last4: document.identifier_last4.trim() || null,
          issued_on: document.issued_on || null,
          expires_on: document.expires_on || null,
          storage_path: path,
          mime_type: file.type,
          file_size_bytes: file.size,
          source: 'employee_upload',
          review_status: 'pending',
        }),
      })
      setFile(null)
      setDocument({ document_type: 'thai_national_id', identifier_last4: '', issued_on: '', expires_on: '' })
      setMessage('อัปโหลดเอกสารแล้ว เจ้าหน้าที่จะตรวจสอบก่อนนำไปใช้')
      await load()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : userError(error))
    }
    setBusy(false)
  }

  return <Stack spacing={2}>
    {message && <Alert severity="success">{message}</Alert>}
    {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
    <Alert severity="info">
      ระบบไม่ขอเลขบัตรเต็ม Laser code ศาสนา หรือข้อมูลชีวมิติ กรุณาระบุเฉพาะเลขท้ายเอกสาร 2–4 ตัว
    </Alert>
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Typography variant="h6">ข้อมูลส่วนตัวตามเอกสาร</Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField fullWidth label="ชื่อภาษาไทย" value={personal.first_name_th}
            onChange={(event) => setPersonal({ ...personal, first_name_th: event.target.value })} />
          <TextField fullWidth label="นามสกุลภาษาไทย" value={personal.last_name_th}
            onChange={(event) => setPersonal({ ...personal, last_name_th: event.target.value })} />
        </Stack>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField fullWidth label="ชื่อที่ใช้เรียก" value={personal.preferred_name}
            onChange={(event) => setPersonal({ ...personal, preferred_name: event.target.value })} />
          <TextField fullWidth type="date" label="วันเกิด" value={personal.date_of_birth}
            onChange={(event) => setPersonal({ ...personal, date_of_birth: event.target.value })}
            slotProps={{ inputLabel: { shrink: true } }} />
          <TextField fullWidth label="โทรศัพท์" value={personal.phone}
            onChange={(event) => setPersonal({ ...personal, phone: event.target.value })} />
        </Stack>
        <TextField label="อีเมลส่วนตัว" value={personal.personal_email}
          onChange={(event) => setPersonal({ ...personal, personal_email: event.target.value })} />
        <TextField multiline minRows={2} label="ที่อยู่" value={personal.address_line}
          onChange={(event) => setPersonal({ ...personal, address_line: event.target.value })} />
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField fullWidth label="อำเภอ/เขต" value={personal.district}
            onChange={(event) => setPersonal({ ...personal, district: event.target.value })} />
          <TextField fullWidth label="จังหวัด" value={personal.province}
            onChange={(event) => setPersonal({ ...personal, province: event.target.value })} />
          <TextField fullWidth label="รหัสไปรษณีย์" value={personal.postal_code}
            onChange={(event) => setPersonal({ ...personal, postal_code: event.target.value })} />
        </Stack>
        <Button variant="contained" disabled={busy} onClick={() => void savePersonal()}>
          {busy ? <CircularProgress size={22} color="inherit" /> : 'บันทึกและส่งตรวจสอบ'}
        </Button>
      </Stack>
    </Paper>

    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Typography variant="h6">ผู้ติดต่อฉุกเฉิน</Typography>
        {contacts.map((item) => <Typography key={item.id}>
          {item.full_name} · {item.relationship} · {item.phone}{item.is_primary ? ' (หลัก)' : ''}
        </Typography>)}
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField fullWidth label="ชื่อผู้ติดต่อ" value={contact.full_name}
            onChange={(event) => setContact({ ...contact, full_name: event.target.value })} />
          <TextField fullWidth label="ความสัมพันธ์" value={contact.relationship}
            onChange={(event) => setContact({ ...contact, relationship: event.target.value })} />
          <TextField fullWidth label="โทรศัพท์" value={contact.phone}
            onChange={(event) => setContact({ ...contact, phone: event.target.value })} />
        </Stack>
        <Button variant="outlined" disabled={busy || !contact.full_name || !contact.relationship || !contact.phone}
          onClick={() => void addContact()}>เพิ่มผู้ติดต่อ</Button>
      </Stack>
    </Paper>

    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Typography variant="h6">เอกสารประจำตัวและหลักฐาน</Typography>
        <TextField select label="ประเภทเอกสาร" value={document.document_type}
          onChange={(event) => setDocument({ ...document, document_type: event.target.value })}>
          {Object.entries(documentLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
        </TextField>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField fullWidth label="เลขท้ายเอกสาร 2–4 ตัว" value={document.identifier_last4}
            onChange={(event) => setDocument({ ...document, identifier_last4: event.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 4) })} />
          <TextField fullWidth type="date" label="วันที่ออก" value={document.issued_on}
            onChange={(event) => setDocument({ ...document, issued_on: event.target.value })}
            slotProps={{ inputLabel: { shrink: true } }} />
          <TextField fullWidth type="date" label="วันหมดอายุ" value={document.expires_on}
            onChange={(event) => setDocument({ ...document, expires_on: event.target.value })}
            slotProps={{ inputLabel: { shrink: true } }} />
        </Stack>
        <Button component="label" variant="outlined">
          {file ? file.name : 'เลือกไฟล์ PDF/JPG/PNG'}
          <input hidden type="file" accept="application/pdf,image/jpeg,image/png,image/webp"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </Button>
        <Button variant="contained" disabled={busy || !file || (!!document.identifier_last4 && document.identifier_last4.length < 2)}
          onClick={() => void uploadDocument()}>อัปโหลดเอกสาร</Button>
        {documents.map((item) => <Paper key={item.id} variant="outlined" sx={{ p: 1.5 }}>
          <Typography sx={{ fontWeight: 800 }}>{documentLabels[item.document_type] ?? item.document_type}</Typography>
          <Typography color="text.secondary">
            เลขท้าย {item.identifier_last4 || '-'} · สถานะ {item.review_status}
            {item.expires_on ? ` · หมดอายุ ${new Date(item.expires_on).toLocaleDateString('th-TH')}` : ''}
          </Typography>
        </Paper>)}
      </Stack>
    </Paper>
  </Stack>
}

