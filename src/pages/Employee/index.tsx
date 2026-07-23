import { Alert, Button, CircularProgress, Paper, Stack, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'

type Employee = {
  id: string
  full_name: string | null
  email: string | null
  role: 'admin' | 'manager' | 'employee'
}

export function EmployeePage() {
  usePageTitle('พนักงาน')
  const { user, profile, refreshProfile } = useAuth()
  const canManage = profile?.role === 'admin' || profile?.role === 'manager'
  const [employees, setEmployees] = useState<Employee[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState('')
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  const loadEmployees = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setErrorMessage('')
    const query = supabase
      .from('profiles')
      .select('id,full_name,email,role')
      .order('full_name', { ascending: true, nullsFirst: false })
    if (!canManage) query.eq('id', user.id)
    const { data, error } = await query
    if (error) {
      setErrorMessage(error.message)
    } else {
      const rows = (data ?? []) as Employee[]
      setEmployees(rows)
      setNames(Object.fromEntries(rows.map((employee) => [employee.id, employee.full_name ?? ''])))
    }
    setLoading(false)
  }, [canManage, user])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadEmployees()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadEmployees])

  const saveName = async (employee: Employee) => {
    setSavingId(employee.id)
    setMessage('')
    setErrorMessage('')
    const { error } = await supabase.rpc('set_profile_full_name', {
      target_profile_id: employee.id,
      new_full_name: names[employee.id] ?? '',
    })
    if (error) {
      setErrorMessage(error.message)
    } else {
      setMessage(`บันทึกชื่อ ${names[employee.id]} แล้ว ข้อความ LINE ครั้งถัดไปจะแสดงชื่อนี้`)
      await loadEmployees()
      if (employee.id === user?.id) await refreshProfile()
    }
    setSavingId('')
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title="พนักงาน"
        description="กำหนดชื่อที่ใช้แสดงในระบบและข้อความแจ้งเตือน LINE"
      />

      {message && <Alert severity="success">{message}</Alert>}
      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

      {loading ? (
        <Stack sx={{ alignItems: 'center', py: 6 }}><CircularProgress /></Stack>
      ) : (
        <Stack spacing={2}>
          {employees.map((employee) => (
            <Paper key={employee.id} variant="outlined" sx={{ p: 2.5 }}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: { md: 'center' } }}>
                <Stack sx={{ minWidth: { md: 260 } }}>
                  <Typography sx={{ fontWeight: 700 }}>{employee.email ?? 'ไม่มีอีเมล'}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    สิทธิ์: {employee.role}
                  </Typography>
                </Stack>
                <TextField
                  fullWidth
                  label="ชื่อพนักงานที่แจ้งใน LINE"
                  value={names[employee.id] ?? ''}
                  slotProps={{ htmlInput: { maxLength: 120 } }}
                  onChange={(event) => setNames((current) => ({
                    ...current,
                    [employee.id]: event.target.value,
                  }))}
                />
                <Button
                  variant="contained"
                  disabled={savingId === employee.id || (names[employee.id]?.trim().length ?? 0) < 2}
                  onClick={() => void saveName(employee)}
                >
                  {savingId === employee.id ? <CircularProgress size={22} color="inherit" /> : 'บันทึกชื่อ'}
                </Button>
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}
    </Stack>
  )
}
