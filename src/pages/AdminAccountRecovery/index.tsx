import LockResetOutlinedIcon from '@mui/icons-material/LockResetOutlined'
import PersonSearchOutlinedIcon from '@mui/icons-material/PersonSearchOutlined'
import { useState } from 'react'
import { Alert, Button, Chip, Paper, Stack, TextField, Typography } from '@mui/material'
import { PageHeader } from '../../components/PageHeader'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'

type RecoveryAction = 'lookup' | 'unban' | 'send_reset'
type RecoveryUser = { id: string; email?: string; banned_until?: string | null; last_sign_in_at?: string | null; is_banned: boolean }

export function AdminAccountRecoveryPage() {
  usePageTitle('กู้คืนบัญชีผู้ใช้')
  const [email, setEmail] = useState('')
  const [reason, setReason] = useState('')
  const [user, setUser] = useState<RecoveryUser | null>(null)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [loadingAction, setLoadingAction] = useState<RecoveryAction | null>(null)

  const normalizedEmail = email.trim().toLowerCase()
  const hasReason = reason.trim().length >= 3
  const isBanned = user?.is_banned === true

  const call = async (action: RecoveryAction) => {
    setMessage('')
    setErrorMessage('')
    if (!normalizedEmail) {
      setErrorMessage('กรุณากรอกอีเมลบัญชีที่ต้องการตรวจสอบ')
      return
    }
    if (action !== 'lookup' && !hasReason) {
      setErrorMessage('กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษรเพื่อบันทึก Audit')
      return
    }
    setLoadingAction(action)
    const { data, error } = await supabase.functions.invoke('admin-account-recovery', {
      body: { action, email: normalizedEmail, reason: reason.trim() },
    })
    setLoadingAction(null)
    if (error || data?.error) {
      setErrorMessage(data?.error ?? error?.message ?? 'ดำเนินการไม่สำเร็จ')
      return
    }
    if (action === 'lookup') {
      setUser(data.user)
      setMessage('พบบัญชีและอ่านสถานะล่าสุดแล้ว')
      return
    }
    setMessage(action === 'unban'
      ? 'ยกเลิกการระงับบัญชีสำเร็จ กรุณาตรวจสอบอีกครั้งก่อนส่งลิงก์ใหม่'
      : 'ระบบส่งอีเมลตั้งรหัสผ่านใหม่แล้ว กรุณาให้ผู้ใช้ตรวจ Inbox และ Spam')
    await callLookupAfterMutation()
  }

  const callLookupAfterMutation = async () => {
    const { data } = await supabase.functions.invoke('admin-account-recovery', {
      body: { action: 'lookup', email: normalizedEmail },
    })
    if (data?.user) setUser(data.user)
  }

  return (
    <Stack spacing={2.5}>
      <PageHeader title="กู้คืนบัญชีผู้ใช้" description="ตรวจสถานะ ยกเลิกการระงับ และส่งอีเมลตั้งรหัสผ่านใหม่โดยมี Audit ทุกครั้ง" />
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, maxWidth: 820 }}>
        <Stack spacing={2}>
          <Alert severity="warning">ใช้เฉพาะบัญชีที่ตรวจแล้วว่าถูกระงับหรือผู้ใช้ขอลิงก์ใหม่ ห้ามส่งซ้ำต่อเนื่องเพราะระบบอีเมลมี Rate limit</Alert>
          <TextField label="อีเมลบัญชี" type="email" value={email} disabled={Boolean(loadingAction)} onChange={(event) => { setEmail(event.target.value); setUser(null) }} />
          <TextField label="เหตุผลสำหรับ Audit" helperText="จำเป็นเมื่อยกเลิกการระงับหรือส่งลิงก์ใหม่" value={reason} disabled={Boolean(loadingAction)} onChange={(event) => setReason(event.target.value)} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button startIcon={<PersonSearchOutlinedIcon />} variant="outlined" disabled={Boolean(loadingAction)} onClick={() => void call('lookup')}>ตรวจสอบบัญชี</Button>
            <Button color="warning" variant="contained" disabled={Boolean(loadingAction) || !user || !isBanned || !hasReason} onClick={() => void call('unban')}>ยกเลิกการระงับ</Button>
            <Button startIcon={<LockResetOutlinedIcon />} variant="contained" disabled={Boolean(loadingAction) || !user || isBanned || !hasReason} onClick={() => void call('send_reset')}>ส่งลิงก์ตั้งรหัสใหม่</Button>
          </Stack>
          {user && <Paper variant="outlined" sx={{ p: 2 }}><Stack spacing={1}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}><Typography sx={{ fontWeight: 800 }}>{user.email}</Typography><Chip size="small" color={isBanned ? 'error' : 'success'} label={isBanned ? 'ถูกระงับ' : 'ใช้งานได้'} /></Stack>
            <Typography variant="body2" color="text.secondary">เข้าสู่ระบบล่าสุด: {user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString('th-TH') : 'ยังไม่มีข้อมูล'}</Typography>
            {isBanned && <Typography variant="body2" color="error">ระงับถึง: {new Date(user.banned_until as string).toLocaleString('th-TH')}</Typography>}
          </Stack></Paper>}
          {message && <Alert severity="success">{message}</Alert>}
          {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
        </Stack>
      </Paper>
    </Stack>
  )
}
