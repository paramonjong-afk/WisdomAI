import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined'
import {
  Alert, Box, Button, Chip, CircularProgress, MenuItem, Paper, Select,
  Stack, Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'

type ExpenseType = 'labor' | 'materials_equipment' | 'mixed' | 'advance' | 'unknown'
type ReviewStatus = 'pending' | 'confirmed' | 'duplicate' | 'dismissed'

type FinancialTransaction = {
  id: string
  recipient_name: string | null
  amount_total: number | null
  labor_amount: number | null
  materials_amount: number | null
  expense_type: ExpenseType
  transfer_at: string | null
  bank_reference: string | null
  duplicate_of: string | null
  review_status: ReviewStatus
  created_at: string
  projects: { name: string; code: string | null } | null
  line_messages: {
    line_senders: { display_name: string | null } | null
    line_groups: { display_name: string | null } | null
  } | null
}

const expenseLabels: Record<ExpenseType, string> = {
  labor: 'ค่าแรงงาน',
  materials_equipment: 'ค่าวัสดุ/อุปกรณ์',
  mixed: 'ค่าแรงและค่าของ',
  advance: 'เงินทดรอง',
  unknown: 'รอตรวจสอบประเภท',
}
const statusLabels: Record<ReviewStatus, string> = {
  pending: 'รอตรวจสอบ',
  confirmed: 'ยืนยันแล้ว',
  duplicate: 'สลิปซ้ำ',
  dismissed: 'ไม่นำมาใช้',
}
const money = (value: number | null) => value == null ? '-' :
  new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(value)

export function FinancialSummaryPage() {
  usePageTitle('สรุปรายการเงิน')
  const { profile, user } = useAuth()
  const canManage = profile?.role === 'admin' || profile?.role === 'manager'
  const [rows, setRows] = useState<FinancialTransaction[]>([])
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: loadError } = await supabase
      .from('financial_transactions')
      .select(`
        id, recipient_name, amount_total, labor_amount, materials_amount,
        expense_type, transfer_at, bank_reference, duplicate_of, review_status, created_at,
        projects(name, code),
        line_messages(line_senders(display_name), line_groups(display_name))
      `)
      .order('created_at', { ascending: false })
      .limit(1000)
    if (loadError) setError(loadError.message)
    else setRows((data ?? []) as unknown as FinancialTransaction[])
    setLoading(false)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0)
    return () => window.clearTimeout(timer)
  }, [loadData])

  const visibleRows = useMemo(
    () => rows.filter((row) => !statusFilter || row.review_status === statusFilter),
    [rows, statusFilter],
  )
  const confirmed = rows.filter((row) => row.review_status === 'confirmed')
  const total = confirmed.reduce((sum, row) => sum + (row.amount_total ?? 0), 0)
  const labor = confirmed.reduce((sum, row) => sum + (row.labor_amount ?? 0), 0)
  const materials = confirmed.reduce((sum, row) => sum + (row.materials_amount ?? 0), 0)
  const pending = rows.filter((row) => row.review_status === 'pending')
    .reduce((sum, row) => sum + (row.amount_total ?? 0), 0)
  const duplicateCount = rows.filter((row) => row.review_status === 'duplicate').length

  const review = async (id: string, reviewStatus: 'confirmed' | 'dismissed') => {
    if (!user || !canManage) return
    setError(null)
    const { error: updateError } = await supabase.from('financial_transactions').update({
      review_status: reviewStatus,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', id).eq('review_status', 'pending')
    if (updateError) setError(updateError.message)
    else setRows((current) => current.map((row) =>
      row.id === id ? { ...row, review_status: reviewStatus } : row))
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title="สรุปรายการเงินจาก LINE"
        description="แยกค่าแรง ค่าวัสดุ/อุปกรณ์ เงินทดรอง และตรวจสลิปซ้ำข้ามกลุ่ม"
        action={<Button startIcon={<RefreshOutlinedIcon />} onClick={() => void loadData()}>รีเฟรช</Button>}
      />
      {error && <Alert severity="error">ไม่สามารถโหลดหรือบันทึกข้อมูลได้: {error}</Alert>}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', lg: 'repeat(5, 1fr)' }, gap: 2 }}>
        {[
          ['ยอดยืนยันแล้ว', money(total), 'success'],
          ['ค่าแรงงาน', money(labor), 'primary'],
          ['ค่าวัสดุ/อุปกรณ์', money(materials), 'info'],
          ['ยอดรอตรวจสอบ', money(pending), 'warning'],
          ['สลิปซ้ำ', `${duplicateCount} รายการ`, 'error'],
        ].map(([label, value, color]) => (
          <Paper key={label} variant="outlined" sx={{ p: 2, borderTop: 3, borderTopColor: `${color}.main` }}>
            <Typography color="text.secondary" variant="body2">{label}</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{value}</Typography>
          </Paper>
        ))}
      </Box>
      {loading ? <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}><CircularProgress /></Box> : (
        <StandardDataTable
          rows={visibleRows}
          getRowId={(row) => row.id}
          getSearchText={(row) => [
            row.recipient_name, row.bank_reference, row.projects?.name,
            row.line_messages?.line_senders?.display_name, row.line_messages?.line_groups?.display_name,
            expenseLabels[row.expense_type], statusLabels[row.review_status],
          ].filter(Boolean).join(' ')}
          searchLabel="ค้นหาผู้รับ เลขอ้างอิง โครงการ หรือกลุ่ม LINE"
          emptyText="ยังไม่พบสลิปโอนเงินจาก LINE"
          exportFileName="wisdomai-financial-transactions"
          minWidth={1550}
          toolbar={<Select size="small" displayEmpty value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} sx={{ minWidth: 170 }}>
            <MenuItem value="">ทุกสถานะ</MenuItem>
            {(Object.entries(statusLabels) as [ReviewStatus, string][]).map(([value, label]) =>
              <MenuItem key={value} value={value}>{label}</MenuItem>)}
          </Select>}
          columns={[
            { id: 'date', label: 'วันเวลาโอน', minWidth: 170, render: (row) => new Date(row.transfer_at ?? row.created_at).toLocaleString('th-TH'), exportValue: (row) => row.transfer_at ?? row.created_at },
            { id: 'recipient', label: 'ผู้รับ', minWidth: 170, render: (row) => row.recipient_name ?? 'อ่านชื่อไม่ได้', exportValue: (row) => row.recipient_name },
            { id: 'type', label: 'ประเภท', minWidth: 170, render: (row) => <Chip size="small" label={expenseLabels[row.expense_type]} />, exportValue: (row) => expenseLabels[row.expense_type] },
            { id: 'amount', label: 'ยอดโอน', minWidth: 120, align: 'right', render: (row) => money(row.amount_total), exportValue: (row) => row.amount_total },
            { id: 'labor', label: 'ค่าแรง', minWidth: 110, align: 'right', render: (row) => money(row.labor_amount), exportValue: (row) => row.labor_amount },
            { id: 'materials', label: 'ค่าของ', minWidth: 110, align: 'right', render: (row) => money(row.materials_amount), exportValue: (row) => row.materials_amount },
            { id: 'project', label: 'โครงการ', minWidth: 180, render: (row) => row.projects ? `${row.projects.code ? `${row.projects.code} · ` : ''}${row.projects.name}` : 'รอระบุโครงการ', exportValue: (row) => row.projects?.name },
            { id: 'reference', label: 'เลขอ้างอิง', minWidth: 170, render: (row) => row.bank_reference ?? '-', exportValue: (row) => row.bank_reference },
            { id: 'source', label: 'ผู้ส่ง/กลุ่ม LINE', minWidth: 210, render: (row) => `${row.line_messages?.line_senders?.display_name ?? 'ไม่ทราบผู้ส่ง'} · ${row.line_messages?.line_groups?.display_name ?? 'แชตส่วนตัว'}`, exportValue: (row) => `${row.line_messages?.line_senders?.display_name ?? ''} · ${row.line_messages?.line_groups?.display_name ?? ''}` },
            { id: 'status', label: 'สถานะ', minWidth: 130, render: (row) => <Chip size="small" color={row.review_status === 'duplicate' ? 'error' : row.review_status === 'confirmed' ? 'success' : 'default'} label={statusLabels[row.review_status]} />, exportValue: (row) => statusLabels[row.review_status] },
            { id: 'actions', label: 'ตรวจสอบ', minWidth: 190, render: (row) => canManage && row.review_status === 'pending' ? <Stack direction="row" spacing={0.5}><Button size="small" variant="contained" onClick={() => void review(row.id, 'confirmed')}>ยืนยัน</Button><Button size="small" color="inherit" onClick={() => void review(row.id, 'dismissed')}>ไม่นำมาใช้</Button></Stack> : row.duplicate_of ? 'ไม่นับรวมยอด' : '-' },
          ]}
        />
      )}
    </Stack>
  )
}
