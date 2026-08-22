import { Alert, Box, Button, Chip, Paper, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { globalMutationAttemptStore, type AttemptStatus, type OperationAttemptRecord } from '../../utils/operation-center'

type AttemptRecord = OperationAttemptRecord & { created_at: string }

const statusLabel: Record<AttemptRecord['status'], string> = {
  pending: 'รอดำเนินการ',
  success: 'สำเร็จ',
  error: 'ผิดพลาด',
}

export function MutationAttemptCenterPage() {
  usePageTitle('Mutation Attempt Center')
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [attempts, setAttempts] = useState<AttemptRecord[]>([])
  const [loading, setLoading] = useState(true)

  const readLocalAttempts = useCallback(() => globalMutationAttemptStore.read() as AttemptRecord[], [])

  const loadAttempts = useCallback(async () => {
    const localRows = readLocalAttempts()

    const { data: centralRows } = await supabase
      .from('mutation_attempts')
      .select('id,attempt_id,module,action,status,actor_profile_id,company_id,request_id,error_code,error,error_action,signature,input,created_at')
      .order('created_at', { ascending: false })
      .limit(120)

    if (!centralRows || centralRows.length === 0) {
      const { data: fallbackRows } = await supabase
        .from('app_activity_logs')
        .select('id,created_at,profile_id,company_id,message,metadata')
        .eq('event_type', 'mutation_attempt')
        .order('created_at', { ascending: false })
        .limit(120)

      const mappedCentralFromFallback = (fallbackRows ?? []).map((row) => {
        const metadata = (row.metadata as Record<string, unknown>) ?? {}
        const status = (() => {
          const raw = String(metadata.mutation_status ?? '').toLowerCase()
          if (raw === 'success' || raw === 'pending' || raw === 'error') return raw as AttemptStatus
          const includesError = String(row.message ?? '')
            .toLowerCase()
            .includes('error')
          return includesError ? 'error' : 'success'
        })()
        return {
          id: String(metadata.attempt_id ?? row.id),
          module: String(metadata.module ?? 'mutation_attempt'),
          action: String(metadata.action ?? row.message ?? 'mutation_attempt'),
          status,
          actor_profile_id: row.profile_id,
          company_id: row.company_id,
          input: (metadata.input as Record<string, unknown>) ?? {},
          created_at: row.created_at,
          request_id: String(metadata.request_id ?? ''),
          error_code: (metadata.error_code as string) ?? undefined,
          error: metadata.error ? String(metadata.error) : undefined,
          error_action: metadata.error_action ? String(metadata.error_action) : undefined,
          signature: metadata.signature ? String(metadata.signature) : undefined,
        } as AttemptRecord
      })

      const mergedByIdFallback = new Map<string, AttemptRecord>()
      localRows.forEach((row) => mergedByIdFallback.set(row.id, row))
      mappedCentralFromFallback.forEach((row) => mergedByIdFallback.set(row.id, row))

      setAttempts([...mergedByIdFallback.values()]
        .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0)))
      setLoading(false)
      return
    }

    const mappedCentral = (centralRows ?? []).map((row) => {
      const status = row.status as AttemptStatus
      return {
        id: row.attempt_id,
        module: row.module,
        action: row.action,
        status,
        actor_profile_id: row.actor_profile_id,
        company_id: row.company_id,
        input: (row.input as Record<string, unknown>) ?? {},
        created_at: row.created_at,
        request_id: row.request_id ?? undefined,
        error_code: row.error_code ?? undefined,
        error: row.error ?? undefined,
        error_action: row.error_action ?? undefined,
        signature: row.signature ?? undefined,
      } as AttemptRecord
    })

    const mergedById = new Map<string, AttemptRecord>()
    localRows.forEach((row) => mergedById.set(row.id, row))
    mappedCentral.forEach((row) => mergedById.set(row.id, row))

    setAttempts([...mergedById.values()]
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0)))
    setLoading(false)
  }, [readLocalAttempts])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAttempts()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadAttempts])

  const clearAll = () => {
    localStorage.removeItem('global-mutation-attempts')
    loadAttempts()
  }

  const summary = useMemo(() => ({
    pending: attempts.filter((item) => item.status === 'pending').length,
    success: attempts.filter((item) => item.status === 'success').length,
    error: attempts.filter((item) => item.status === 'error').length,
  }), [attempts])

  const toText = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value ?? '-'))
  const scopeIssuesFromAttempt = (row: AttemptRecord) => {
    const input = row.input as Record<string, unknown> | undefined
    const raw = input?.scope_issues
    return Array.isArray(raw) ? raw.filter((item) => typeof item === 'string').join(' · ') : ''
  }

  if (!profile || profile.role !== 'admin') {
    return <Alert severity="error">เฉพาะผู้ดูแลระบบ</Alert>
  }

  return (
    <Stack spacing={2}>
      <PageHeader title="Mutation Attempt Center" description="ศูนย์รวมความพยายามบันทึกข้อมูล/การทำรายการทั้งหมดสำหรับตรวจสอบและแก้ปัญหา" />

      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        sx={{ alignItems: { xs: 'stretch', md: 'center' } }}
      >
        <Chip color="warning" label={`รอดำเนินการ: ${summary.pending}`} />
        <Chip color="success" label={`สำเร็จ: ${summary.success}`} />
        <Chip color="error" label={`ผิดพลาด: ${summary.error}`} />
        <Box sx={{ flex: 1 }} />
        <Button variant="outlined" onClick={loadAttempts}>โหลดใหม่</Button>
        <Button color="error" variant="outlined" onClick={clearAll} disabled={attempts.length === 0}>ล้างข้อมูลทั้งหมด</Button>
      </Stack>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 700 }}>
          ลิงก์สำคัญ
        </Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
        <Button variant="text" onClick={() => navigate('/system-health')}>ไปหน้ายืนยันระบบ</Button>
        <Button variant="text" onClick={() => navigate('/work-command-center')}>ไปที่ศูนย์สั่งงาน</Button>
          <Button color="success" variant="text" onClick={() => navigate('/time-tracking')}>ไปหน้าบันทึกเวลา</Button>
        </Stack>
      </Paper>

      {loading ? (
        <Alert severity="info">กำลังโหลด log...</Alert>
      ) : attempts.length === 0 ? (
        <Alert severity="info">ยังไม่มีข้อมูล Mutation Attempt</Alert>
      ) : (
        <StandardDataTable<AttemptRecord>
          rows={attempts}
          getRowId={(row) => row.id}
          getSearchText={(row) =>
            `${row.module} ${row.action} ${row.actor_profile_id} ${row.status} ${row.error_code ?? ''} ${toText(row.error ?? '')}`
          }
          searchLabel="ค้นหาหน่วยงาน, action, request, error"
          exportFileName="mutation-attempt-center"
          defaultSort={{ columnId: 'created_at', direction: 'desc' }}
          columns={[
            {
              id: 'created_at',
              label: 'เวลา',
              sortable: true,
              sortValue: (row) => new Date(row.created_at).getTime(),
              render: (row) => new Date(row.created_at).toLocaleString('th-TH'),
              exportValue: (row) => new Date(row.created_at).toLocaleString('th-TH'),
            },
            { id: 'module', label: 'โมดูล', render: (row) => row.module, exportValue: (row) => row.module },
            { id: 'action', label: 'การทำงาน', render: (row) => row.action, exportValue: (row) => row.action },
            { id: 'actor', label: 'ผู้ดำเนินการ', render: (row) => row.actor_profile_id, exportValue: (row) => row.actor_profile_id },
            { id: 'company', label: 'บริษัท', render: (row) => row.company_id || '-', exportValue: (row) => row.company_id || '-' },
            {
              id: 'status',
              label: 'สถานะ',
              render: (row) => <Chip size="small" color={row.status === 'error' ? 'error' : row.status === 'success' ? 'success' : 'warning'} label={statusLabel[row.status]} />,
              exportValue: (row) => statusLabel[row.status],
              sortable: true,
              sortValue: (row) => row.status,
            },
            {
              id: 'request',
              label: 'Request ID',
              render: (row) => row.request_id || '-',
              exportValue: (row) => row.request_id || '-',
            },
            {
              id: 'error_code',
              label: 'รหัสผิดพลาด',
              render: (row) => row.error_code || '-',
              exportValue: (row) => row.error_code || '-',
            },
            {
              id: 'error',
              label: 'รายละเอียดผิดพลาด',
              minWidth: 260,
              render: (row) => row.error || '-',
              exportValue: (row) => row.error || '-',
              visible: true,
            },
            {
              id: 'action_hint',
              label: 'คำแนะนำ',
              minWidth: 260,
              render: (row) => row.error_action || '-',
              exportValue: (row) => row.error_action || '-',
            },
            {
              id: 'scope_summary',
              label: 'สรุปขอบเขต',
              minWidth: 280,
              render: (row) => ((row.input as Record<string, unknown> | undefined)?.scope_summary as string) || '-',
              exportValue: (row) => ((row.input as Record<string, unknown> | undefined)?.scope_summary as string) || '-',
            },
            {
              id: 'scope_issues',
              label: 'รายการขอบเขตผิด',
              minWidth: 260,
              render: (row) => scopeIssuesFromAttempt(row) || '-',
              exportValue: (row) => scopeIssuesFromAttempt(row) || '-',
            },
            {
              id: 'input',
              label: 'Input (สรุป)',
              minWidth: 260,
              render: (row) => toText(row.input).slice(0, 100),
              exportValue: (row) => toText(row.input),
            },
          ]}
        />
      )}
    </Stack>
  )
}
