import AddOutlinedIcon from '@mui/icons-material/AddOutlined'
import LaunchOutlinedIcon from '@mui/icons-material/LaunchOutlined'
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined'
import {
  Alert, Box, Button, Chip, CircularProgress, Divider, Drawer, MenuItem, Paper, Stack, TextField, Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import {
  calculateSalesExpenseAmounts,
  canApproveSalesExpense,
  canEditSalesExpense,
  salesExpenseAccountCategoryCode,
  salesExpenseCategoryLabels,
  salesExpenseStatusLabels,
  type SalesExpenseCategory,
  type SalesExpenseStatus,
} from '../../services/salesExpenseAccounting'
import { runWithMutationAttempt } from '../../utils/mutationAttemptRunner'
import { userError } from '../../utils/userError'

type Project = { project_id: string; name: string; code: string | null }
type CostCategory = { id: string; code: string; name_th: string; default_account_code: string | null; default_account_name: string | null }
type Vendor = { id: string; name: string; tax_id: string | null }
type AccountingDocument = {
  id: string
  document_number: string | null
  document_date: string | null
  vendor_name: string | null
  subtotal: number | null
  vat_amount: number | null
  withholding_tax_amount: number | null
  total_amount: number | null
  posting_status: string
}
type AdvanceCase = { id: string; advance_number: string; amount_received: number; status: string }
type CostCode = { id: string; code: string; name_th: string }
type SalesExpenseAudit = {
  id: string
  sales_expense_id: string
  action: string
  actor_profile_id: string | null
  reason: string | null
  created_at: string
}
type SalesExpense = {
  id: string
  project_id: string
  expense_date: string
  category: SalesExpenseCategory
  description: string
  budget_amount: number
  committed_amount: number
  actual_amount: number
  status: SalesExpenseStatus
  outcome_bucket: string
  project_transfer_amount: number
  cost_category_id: string | null
  account_code: string | null
  account_name: string | null
  vendor_id: string | null
  vendor_name: string | null
  vendor_tax_id: string | null
  invoice_number: string | null
  tax_invoice_number: string | null
  invoice_date: string | null
  vat_rate: number
  vat_amount: number
  withholding_tax_rate: number
  withholding_tax_amount: number
  settlement_method: 'accounts_payable' | 'employee_advance'
  accounting_document_id: string | null
  employee_advance_case_id: string | null
  evidence_reference: string | null
  note: string | null
  submitted_by: string | null
  submitted_at: string | null
  approved_by: string | null
  approved_at: string | null
  rejection_reason: string | null
  amount_basis: 'legacy_unverified' | 'before_vat'
  version: number
  updated_at: string
}

type ExpenseForm = {
  projectId: string
  date: string
  category: SalesExpenseCategory
  description: string
  budget: string
  committed: string
  actual: string
  costCategoryId: string
  vendorId: string
  vendorName: string
  vendorTaxId: string
  invoiceNumber: string
  taxInvoiceNumber: string
  invoiceDate: string
  vatRate: string
  withholdingRate: string
  settlementMethod: 'accounts_payable' | 'employee_advance'
  accountingDocumentId: string
  advanceCaseId: string
  evidenceReference: string
  note: string
}

const today = () => new Date().toISOString().slice(0, 10)
const money = (value: number) => Number(value || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dateTime = (value: string | null) => value ? new Date(value).toLocaleString('th-TH') : '-'
const eventKey = (expenseId: string | null, action: string) => `sales-expense:${expenseId ?? 'new'}:${action}:${crypto.randomUUID()}`

const emptyForm = (projectId = ''): ExpenseForm => ({
  projectId,
  date: today(),
  category: 'site_survey',
  description: '',
  budget: '',
  committed: '',
  actual: '',
  costCategoryId: '',
  vendorId: '',
  vendorName: '',
  vendorTaxId: '',
  invoiceNumber: '',
  taxInvoiceNumber: '',
  invoiceDate: '',
  vatRate: '0',
  withholdingRate: '0',
  settlementMethod: 'accounts_payable',
  accountingDocumentId: '',
  advanceCaseId: '',
  evidenceReference: '',
  note: '',
})

const statusColor = (status: SalesExpenseStatus): 'default' | 'info' | 'warning' | 'success' | 'error' => {
  if (status === 'approved' || status === 'accounting_draft' || status === 'paid') return 'success'
  if (status === 'pending') return 'warning'
  if (status === 'rejected' || status === 'void') return 'error'
  return status === 'draft' ? 'info' : 'default'
}

const outcomeLabels: Record<string, string> = {
  pending_result: 'รอจัดผลลัพธ์',
  project_cost: 'ต้นทุนโครงการ',
  selling_expense: 'ค่าใช้จ่ายขาย',
  lost_bid: 'ต้นทุนขายไม่สำเร็จ',
  customer_recoverable: 'เรียกเก็บลูกค้า',
}

const auditLabels: Record<string, string> = {
  draft_created: 'สร้างร่าง',
  draft_updated: 'แก้ไขร่าง',
  submit: 'ส่งตรวจ',
  approve: 'อนุมัติ',
  reject: 'ส่งกลับแก้ไข',
  create_accounting_draft: 'สร้างบัญชีร่าง',
  void: 'ยกเลิก',
  outcome_selling_expense: 'จัดเป็นค่าใช้จ่ายขาย',
  outcome_lost_bid: 'จัดเป็นต้นทุนขายไม่สำเร็จ',
  outcome_customer_recoverable: 'จัดเป็นยอดเรียกเก็บลูกค้า',
  outcome_project_cost: 'โอนเป็นต้นทุนโครงการ',
  legacy_snapshot: 'Snapshot รายการเดิม',
}

export function SalesExpensePanel({ projects, contextProjectId }: { projects: Project[]; contextProjectId: string }) {
  const { profile, currentCompany } = useAuth()
  const [rows, setRows] = useState<SalesExpense[]>([])
  const [categories, setCategories] = useState<CostCategory[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [documents, setDocuments] = useState<AccountingDocument[]>([])
  const [advanceCases, setAdvanceCases] = useState<AdvanceCase[]>([])
  const [costCodes, setCostCodes] = useState<CostCode[]>([])
  const [audits, setAudits] = useState<SalesExpenseAudit[]>([])
  const [selected, setSelected] = useState<SalesExpense | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [form, setForm] = useState<ExpenseForm>(() => emptyForm(contextProjectId))
  const [statusFilter, setStatusFilter] = useState('active')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [reason, setReason] = useState('')
  const [outcome, setOutcome] = useState('selling_expense')
  const [costCodeId, setCostCodeId] = useState('')
  const loadSequence = useRef(0)

  const projectName = useCallback((id: string) => projects.find((item) => item.project_id === id)?.name ?? '-', [projects])

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current
    setLoading(true)
    setError('')
    const companyId = currentCompany?.company_id ?? ''
    const results = await Promise.all([
      supabase.from('sales_expenses').select('*').eq('company_id', companyId).order('expense_date', { ascending: false }),
      supabase.from('accounting_cost_categories').select('id,code,name_th,default_account_code,default_account_name').like('code', '11.%').eq('active', true).order('code'),
      supabase.from('vendors').select('id,name,tax_id').eq('company_id', companyId).order('name'),
      supabase.from('accounting_documents').select('id,document_number,document_date,vendor_name,subtotal,vat_amount,withholding_tax_amount,total_amount,posting_status').eq('company_id', companyId).eq('status', 'confirmed').neq('posting_status', 'posted').order('created_at', { ascending: false }).limit(500),
      supabase.from('employee_advance_cases').select('id,advance_number,amount_received,status').eq('company_id', companyId).neq('status', 'cancelled').order('updated_at', { ascending: false }).limit(500),
      supabase.from('project_cost_codes').select('id,code,name_th').eq('company_id', companyId).eq('active', true).order('sort_order'),
      supabase.from('sales_expense_audit').select('id,sales_expense_id,action,actor_profile_id,reason,created_at').eq('company_id', companyId).order('created_at', { ascending: false }).limit(2000),
    ] as const)
    if (sequence !== loadSequence.current) return
    const firstError = results.find((result) => result.error)?.error
    if (firstError) {
      setError(userError(firstError))
    } else {
      setRows((results[0].data ?? []) as SalesExpense[])
      setCategories((results[1].data ?? []) as CostCategory[])
      setVendors((results[2].data ?? []) as Vendor[])
      setDocuments((results[3].data ?? []) as AccountingDocument[])
      setAdvanceCases((results[4].data ?? []) as AdvanceCase[])
      setCostCodes((results[5].data ?? []) as CostCode[])
      setAudits((results[6].data ?? []) as SalesExpenseAudit[])
    }
    setLoading(false)
  }, [currentCompany?.company_id])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => {
      window.clearTimeout(timer)
      loadSequence.current += 1
    }
  }, [load])

  const categoryFor = useCallback((category: SalesExpenseCategory) => {
    const code = salesExpenseAccountCategoryCode[category]
    return categories.find((item) => item.code === code) ?? null
  }, [categories])

  const openNew = () => {
    const next = emptyForm(contextProjectId)
    next.costCategoryId = categoryFor(next.category)?.id ?? ''
    setSelected(null)
    setForm(next)
    setReason('')
    setOutcome('selling_expense')
    setCostCodeId('')
    setError('')
    setSuccess('')
    setDrawerOpen(true)
  }

  const openRow = (row: SalesExpense) => {
    setSelected(row)
    setForm({
      projectId: row.project_id,
      date: row.expense_date,
      category: row.category,
      description: row.description,
      budget: String(row.budget_amount),
      committed: String(row.committed_amount),
      actual: String(row.actual_amount),
      costCategoryId: row.cost_category_id ?? categoryFor(row.category)?.id ?? '',
      vendorId: row.vendor_id ?? '',
      vendorName: row.vendor_name ?? '',
      vendorTaxId: row.vendor_tax_id ?? '',
      invoiceNumber: row.invoice_number ?? '',
      taxInvoiceNumber: row.tax_invoice_number ?? '',
      invoiceDate: row.invoice_date ?? '',
      vatRate: String(row.vat_rate ?? 0),
      withholdingRate: String(row.withholding_tax_rate ?? 0),
      settlementMethod: row.settlement_method ?? 'accounts_payable',
      accountingDocumentId: row.accounting_document_id ?? '',
      advanceCaseId: row.employee_advance_case_id ?? '',
      evidenceReference: row.evidence_reference ?? '',
      note: row.note ?? '',
    })
    setReason('')
    setOutcome(row.outcome_bucket === 'pending_result' || row.outcome_bucket === 'project_cost' ? 'selling_expense' : row.outcome_bucket)
    setCostCodeId('')
    setError('')
    setSuccess('')
    setDrawerOpen(true)
  }

  const closeDrawer = () => {
    setDrawerOpen(false)
    setSelected(null)
    setForm(emptyForm(contextProjectId))
    setReason('')
    setCostCodeId('')
    setError('')
    setSuccess('')
  }

  const amountSummary = calculateSalesExpenseAmounts(Number(form.actual), Number(form.vatRate), Number(form.withholdingRate))
  const selectedAudits = selected ? audits.filter((item) => item.sales_expense_id === selected.id) : []
  const editable = !selected || canEditSalesExpense(selected.status)

  const mutate = async (action: string, request: Record<string, unknown>, operation: () => Promise<{ error: unknown }>, message: string) => {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await runWithMutationAttempt({
        module: 'project-controls-sales-expense',
        action,
        actorProfileId: profile?.id,
        companyId: currentCompany?.company_id,
        request,
        operation,
      })
      setSuccess(message)
      await load()
      const selectedId = selected?.id
      if (selectedId) {
        const refreshed = (await supabase.from('sales_expenses').select('*').eq('company_id', currentCompany?.company_id ?? '').eq('id', selectedId).maybeSingle()).data as SalesExpense | null
        if (refreshed) openRow(refreshed)
      } else {
        closeDrawer()
      }
    } catch (caught) {
      setError(userError(caught))
    } finally {
      setSaving(false)
    }
  }

  const saveDraft = async () => {
    const key = eventKey(selected?.id ?? null, 'save')
    await mutate('save_sales_expense_draft', { expense_id: selected?.id ?? null, event_key: key }, async () => {
      const result = await supabase.rpc('save_sales_expense_draft', {
        target_expense_id: selected?.id ?? null,
        target_event_key: key,
        target_project_id: form.projectId,
        target_expense_date: form.date,
        target_category: form.category,
        target_description: form.description,
        target_budget_amount: Number(form.budget || 0),
        target_committed_amount: Number(form.committed || 0),
        target_actual_amount: Number(form.actual || 0),
        target_cost_category_id: form.costCategoryId,
        target_vendor_id: form.vendorId || null,
        target_vendor_name: form.vendorName || null,
        target_vendor_tax_id: form.vendorTaxId || null,
        target_invoice_number: form.invoiceNumber || null,
        target_tax_invoice_number: form.taxInvoiceNumber || null,
        target_invoice_date: form.invoiceDate || null,
        target_vat_rate: Number(form.vatRate || 0),
        target_withholding_tax_rate: Number(form.withholdingRate || 0),
        target_settlement_method: form.settlementMethod,
        target_accounting_document_id: form.accountingDocumentId || null,
        target_employee_advance_case_id: form.advanceCaseId || null,
        target_evidence_reference: form.evidenceReference || null,
        target_note: form.note || null,
      })
      return { error: result.error }
    }, selected ? 'บันทึกร่างและ Audit แล้ว' : 'สร้างร่างพร้อม Audit แล้ว')
  }

  const transition = async (action: 'submit' | 'approve' | 'reject' | 'create_accounting_draft' | 'void') => {
    if (!selected) return
    const key = eventKey(selected.id, action)
    await mutate(`transition_sales_expense:${action}`, { expense_id: selected.id, action, event_key: key }, async () => {
      const result = await supabase.rpc('transition_sales_expense', {
        target_expense_id: selected.id,
        target_action: action,
        target_event_key: key,
        target_reason: reason || null,
      })
      return { error: result.error }
    }, action === 'create_accounting_draft' ? 'สร้างรายการบัญชีร่างแบบสมดุลแล้ว รอฝ่ายบัญชีตรวจ Posting' : 'บันทึกสถานะและ Audit แล้ว')
  }

  const classifyOutcome = async () => {
    if (!selected) return
    const key = eventKey(selected.id, `outcome-${outcome}`)
    await mutate('classify_sales_expense_outcome', { expense_id: selected.id, outcome, event_key: key }, async () => {
      const result = await supabase.rpc('classify_sales_expense_outcome', {
        target_expense_id: selected.id,
        target_outcome: outcome,
        target_event_key: key,
        target_reason: reason,
      })
      return { error: result.error }
    }, 'บันทึกผลลัพธ์ค่าใช้จ่ายและ Audit แล้ว')
  }

  const transferToProject = async () => {
    if (!selected) return
    await mutate('transfer_sales_expense_to_project_cost', { expense_id: selected.id, cost_code_id: costCodeId }, async () => {
      const result = await supabase.rpc('transfer_sales_expense_to_project_cost', {
        target_expense_id: selected.id,
        target_cost_code_id: costCodeId,
        target_amount: selected.actual_amount,
      })
      return { error: result.error }
    }, 'โอนเป็นต้นทุนโครงการแบบกันซ้ำและบันทึก Audit แล้ว')
  }

  const visibleRows = useMemo(() => rows.filter((row) => {
    if (contextProjectId && row.project_id !== contextProjectId) return false
    if (statusFilter === 'all') return true
    if (statusFilter === 'active') return !['paid', 'void'].includes(row.status)
    return row.status === statusFilter
  }), [contextProjectId, rows, statusFilter])

  const summary = useMemo(() => ({
    total: visibleRows.length,
    review: visibleRows.filter((row) => row.status === 'pending').length,
    rejected: visibleRows.filter((row) => row.status === 'rejected').length,
    approved: visibleRows.filter((row) => ['approved', 'accounting_draft', 'paid'].includes(row.status)).length,
    accounting: visibleRows.filter((row) => row.status === 'accounting_draft').length,
  }), [visibleRows])

  const setCategory = (category: SalesExpenseCategory) => {
    const accountingCategory = categoryFor(category)
    setForm((current) => ({ ...current, category, costCategoryId: accountingCategory?.id ?? '' }))
  }

  return <Stack spacing={2}>
    <Paper variant="outlined" sx={{ p: 2.5, background: 'linear-gradient(135deg, rgba(166,89,64,.10), rgba(236,190,96,.08))' }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'center' } }}>
        <Box sx={{ flex: 1 }}><Typography variant="h6">ค่าใช้จ่ายขายและก่อนขาย</Typography><Typography variant="body2" color="text.secondary">ร่าง → ตรวจหลักฐาน → ผู้อนุมัติคนที่สอง → บัญชีร่าง → ฝ่ายบัญชีตรวจ Posting</Typography></Box>
        <TextField select size="small" label="สถานะ" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} sx={{ minWidth: 180 }}>
          <MenuItem value="active">คิวที่ยังใช้งาน</MenuItem><MenuItem value="all">ทั้งหมด</MenuItem>
          {Object.entries(salesExpenseStatusLabels).map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}
        </TextField>
        <Button variant="outlined" startIcon={<RefreshOutlinedIcon />} disabled={loading} onClick={() => void load()}>โหลดใหม่</Button>
        <Button variant="contained" startIcon={<AddOutlinedIcon />} onClick={openNew}>เพิ่มค่าใช้จ่าย</Button>
      </Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,1fr)', md: 'repeat(5,1fr)' }, gap: 1, mt: 2 }}>
        {[['ทั้งหมด', summary.total], ['รอตรวจ', summary.review], ['ส่งกลับ', summary.rejected], ['อนุมัติแล้ว', summary.approved], ['บัญชีร่าง', summary.accounting]].map(([label, value]) => <Paper key={String(label)} variant="outlined" sx={{ p: 1.25 }}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant="h5" sx={{ fontWeight: 800 }}>{value}</Typography></Paper>)}
      </Box>
    </Paper>
    {error && !drawerOpen && <Alert severity="error">{error}</Alert>}
    {loading ? <Paper variant="outlined" sx={{ p: 6, textAlign: 'center' }}><CircularProgress size={28} /><Typography color="text.secondary" sx={{ mt: 1 }}>กำลังโหลดค่าใช้จ่ายขาย</Typography></Paper> : <StandardDataTable
      rows={visibleRows}
      getRowId={(row) => row.id}
      getSearchText={(row) => `${projectName(row.project_id)} ${row.description} ${salesExpenseCategoryLabels[row.category]} ${row.account_code ?? ''} ${row.vendor_name ?? ''} ${row.invoice_number ?? ''}`}
      searchLabel="ค้นหาโครงการ รายการ ผู้ขาย หรือเลขเอกสาร"
      emptyText="ไม่พบค่าใช้จ่ายขายตามตัวกรอง"
      exportFileName="sales-expense-accounting"
      onRowClick={openRow}
      defaultSort={{ columnId: 'date', direction: 'desc' }}
      columns={[
        { id: 'date', label: 'วันที่', render: (row) => row.expense_date, sortValue: (row) => row.expense_date },
        { id: 'project', label: 'โครงการ/โอกาสขาย', render: (row) => projectName(row.project_id), exportValue: (row) => projectName(row.project_id) },
        { id: 'description', label: 'รายการ', minWidth: 220, render: (row) => <Box><Typography variant="body2" sx={{ fontWeight: 700 }}>{row.description}</Typography><Typography variant="caption" color="text.secondary">{salesExpenseCategoryLabels[row.category]} · v{row.version}</Typography></Box>, exportValue: (row) => row.description },
        { id: 'account', label: 'บัญชี', render: (row) => `${row.account_code ?? '-'} ${row.account_name ?? ''}` },
        { id: 'vendor', label: 'ผู้ขาย/ผู้รับเงิน', render: (row) => row.vendor_name ?? 'ยังไม่ระบุ' },
        { id: 'base', label: 'ก่อน VAT', align: 'right', render: (row) => money(row.actual_amount), exportValue: (row) => row.actual_amount },
        { id: 'tax', label: 'VAT / WHT', align: 'right', render: (row) => `${money(row.vat_amount)} / ${money(row.withholding_tax_amount)}` },
        { id: 'status', label: 'สถานะ', render: (row) => <Chip size="small" color={statusColor(row.status)} label={salesExpenseStatusLabels[row.status]} /> },
        { id: 'outcome', label: 'ผลลัพธ์', render: (row) => outcomeLabels[row.outcome_bucket] ?? row.outcome_bucket },
        { id: 'action', label: 'จัดการ', sortable: false, render: (row) => <Button size="small" onClick={(event) => { event.stopPropagation(); openRow(row) }}>ตรวจ/ดำเนินการ</Button> },
      ]}
    />}

    <Drawer anchor="right" open={drawerOpen} onClose={saving ? undefined : closeDrawer} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 760 }, maxWidth: '100vw' } } }}>
      <Box sx={{ p: { xs: 2, sm: 2.5 } }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}><Box sx={{ flex: 1 }}><Typography variant="h5" sx={{ fontWeight: 800 }}>{selected ? 'ตรวจค่าใช้จ่ายขาย' : 'เพิ่มค่าใช้จ่ายขาย'}</Typography><Typography variant="body2" color="text.secondary">{selected ? `Expense ID ${selected.id} · Version ${selected.version}` : 'สร้างเป็นร่างก่อนส่งให้ผู้ตรวจคนที่สอง'}</Typography></Box>{selected && <Chip color={statusColor(selected.status)} label={salesExpenseStatusLabels[selected.status]} />}</Stack>
        <Divider sx={{ my: 2 }} />
        {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 1.5 }}>{success}</Alert>}
        {selected?.amount_basis === 'legacy_unverified' && <Alert severity="warning" sx={{ mb: 1.5 }}>รายการเดิมยังไม่ยืนยันว่าจำนวนเงินเป็นยอดก่อน VAT ต้องเปิดตรวจและบันทึกร่างใหม่ก่อนส่งอนุมัติ</Alert>}
        <Stack spacing={2}>
          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>1. รายการและบัญชี</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2,1fr)' }, gap: 1.25 }}>
            <TextField select label="โครงการ/โอกาสขาย *" value={form.projectId} disabled={!editable} onChange={(event) => setForm({ ...form, projectId: event.target.value })}>{projects.map((project) => <MenuItem key={project.project_id} value={project.project_id}>{project.name}</MenuItem>)}</TextField>
            <TextField type="date" label="วันที่ *" value={form.date} disabled={!editable} onChange={(event) => setForm({ ...form, date: event.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
            <TextField select label="ประเภทค่าใช้จ่าย *" value={form.category} disabled={!editable} onChange={(event) => setCategory(event.target.value as SalesExpenseCategory)}>{Object.entries(salesExpenseCategoryLabels).map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}</TextField>
            <TextField select label="หมวดบัญชี *" value={form.costCategoryId} disabled={!editable} onChange={(event) => setForm({ ...form, costCategoryId: event.target.value })}>{categories.map((category) => <MenuItem key={category.id} value={category.id}>{category.code} · {category.name_th} ({category.default_account_code})</MenuItem>)}</TextField>
            <TextField label="รายละเอียด *" value={form.description} disabled={!editable} onChange={(event) => setForm({ ...form, description: event.target.value })} sx={{ gridColumn: { sm: '1 / -1' } }} />
            <TextField type="number" label="งบประมาณ" value={form.budget} disabled={!editable} onChange={(event) => setForm({ ...form, budget: event.target.value })} />
            <TextField type="number" label="ยอดผูกพัน" value={form.committed} disabled={!editable} onChange={(event) => setForm({ ...form, committed: event.target.value })} />
          </Box>

          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>2. ผู้ขาย เอกสาร และภาษี</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2,1fr)' }, gap: 1.25 }}>
            <TextField select label="ผู้ขายใน Master" value={form.vendorId} disabled={!editable} onChange={(event) => { const vendor = vendors.find((item) => item.id === event.target.value); setForm({ ...form, vendorId: event.target.value, vendorName: vendor?.name ?? form.vendorName, vendorTaxId: vendor?.tax_id ?? form.vendorTaxId }) }}><MenuItem value="">ไม่ผูก Vendor Master</MenuItem>{vendors.map((vendor) => <MenuItem key={vendor.id} value={vendor.id}>{vendor.name}{vendor.tax_id ? ` · ${vendor.tax_id}` : ''}</MenuItem>)}</TextField>
            <TextField label="ชื่อผู้ขาย/ผู้รับเงิน *" value={form.vendorName} disabled={!editable} onChange={(event) => setForm({ ...form, vendorName: event.target.value })} />
            <TextField label="เลขผู้เสียภาษี" value={form.vendorTaxId} disabled={!editable} onChange={(event) => setForm({ ...form, vendorTaxId: event.target.value })} />
            <TextField label="เลขใบแจ้งหนี้/ใบเสร็จ" value={form.invoiceNumber} disabled={!editable} onChange={(event) => setForm({ ...form, invoiceNumber: event.target.value })} />
            <TextField label="เลขใบกำกับภาษี" value={form.taxInvoiceNumber} disabled={!editable} onChange={(event) => setForm({ ...form, taxInvoiceNumber: event.target.value })} />
            <TextField type="date" label="วันที่เอกสาร" value={form.invoiceDate} disabled={!editable} onChange={(event) => setForm({ ...form, invoiceDate: event.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
            <TextField type="number" label="ยอดก่อน VAT *" value={form.actual} disabled={!editable} onChange={(event) => setForm({ ...form, actual: event.target.value })} />
            <TextField type="number" label="VAT %" value={form.vatRate} disabled={!editable} onChange={(event) => setForm({ ...form, vatRate: event.target.value })} />
            <TextField type="number" label="หัก ณ ที่จ่าย %" value={form.withholdingRate} disabled={!editable} onChange={(event) => setForm({ ...form, withholdingRate: event.target.value })} />
          </Box>
          <Paper variant="outlined" sx={{ p: 1.5 }}><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} divider={<Divider flexItem orientation="vertical" />}><Box sx={{ flex: 1 }}><Typography variant="caption">VAT</Typography><Typography sx={{ fontWeight: 800 }}>{money(amountSummary.vat)}</Typography></Box><Box sx={{ flex: 1 }}><Typography variant="caption">หัก ณ ที่จ่าย</Typography><Typography sx={{ fontWeight: 800 }}>{money(amountSummary.withholding)}</Typography></Box><Box sx={{ flex: 1 }}><Typography variant="caption">ยอดเอกสารรวม</Typography><Typography sx={{ fontWeight: 800 }}>{money(amountSummary.gross)}</Typography></Box><Box sx={{ flex: 1 }}><Typography variant="caption">ยอดจ่ายสุทธิ</Typography><Typography sx={{ fontWeight: 800 }}>{money(amountSummary.netPayable)}</Typography></Box></Stack></Paper>

          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>3. หลักฐานและวิธีตั้งหนี้</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2,1fr)' }, gap: 1.25 }}>
            <TextField select label="วิธีเคลียร์ยอด" value={form.settlementMethod} disabled={!editable} onChange={(event) => setForm({ ...form, settlementMethod: event.target.value as ExpenseForm['settlementMethod'], advanceCaseId: event.target.value === 'employee_advance' ? form.advanceCaseId : '' })}><MenuItem value="accounts_payable">ตั้งเจ้าหนี้การค้า</MenuItem><MenuItem value="employee_advance">หักเงินทดรองพนักงาน</MenuItem></TextField>
            <TextField select label="Accounting Document" value={form.accountingDocumentId} disabled={!editable} onChange={(event) => setForm({ ...form, accountingDocumentId: event.target.value })}><MenuItem value="">ยังไม่ผูกเอกสารบัญชี</MenuItem>{documents.map((document) => <MenuItem key={document.id} value={document.id}>{document.document_number ?? document.id.slice(0, 8)} · {document.vendor_name ?? 'ไม่ระบุผู้ขาย'} · {money(Number(document.total_amount ?? 0))}</MenuItem>)}</TextField>
            {form.settlementMethod === 'employee_advance' && <TextField select label="Advance ID *" value={form.advanceCaseId} disabled={!editable} onChange={(event) => setForm({ ...form, advanceCaseId: event.target.value })}><MenuItem value="">เลือกเงินทดรอง</MenuItem>{advanceCases.map((advance) => <MenuItem key={advance.id} value={advance.id}>{advance.advance_number} · {money(Number(advance.amount_received))} · {advance.status}</MenuItem>)}</TextField>}
            <TextField label="หลักฐานอ้างอิง" value={form.evidenceReference} disabled={!editable} onChange={(event) => setForm({ ...form, evidenceReference: event.target.value })} placeholder="Document ID, URL หรือเลขอ้างอิง" />
            <TextField label="หมายเหตุ" value={form.note} disabled={!editable} onChange={(event) => setForm({ ...form, note: event.target.value })} sx={{ gridColumn: { sm: '1 / -1' } }} />
          </Box>
          {selected && <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>{selected.accounting_document_id && <Button component={RouterLink} to={`/accounting-documents?document_id=${selected.accounting_document_id}`} startIcon={<LaunchOutlinedIcon />}>เปิด Accounting Document</Button>}{selected.employee_advance_case_id && <Button component={RouterLink} to={`/advance-settlements?advance_id=${selected.employee_advance_case_id}`} startIcon={<LaunchOutlinedIcon />}>เปิด Advance</Button>}</Stack>}

          {editable && <Button variant="contained" disabled={saving || !form.projectId || !form.description.trim() || !form.costCategoryId} onClick={() => void saveDraft()}>{saving ? 'กำลังบันทึก...' : 'บันทึกร่าง'}</Button>}

          {selected && <>
            <Divider />
            <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>4. Review และ Accounting Flow</Typography>
            {selected.rejection_reason && <Alert severity="warning">เหตุผลส่งกลับ: {selected.rejection_reason}</Alert>}
            <TextField label="เหตุผล/หมายเหตุการตัดสินใจ" value={reason} onChange={(event) => setReason(event.target.value)} multiline minRows={2} />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ flexWrap: 'wrap' }}>
              {(selected.status === 'draft' || selected.status === 'rejected') && <Button variant="contained" color="warning" disabled={saving} onClick={() => void transition('submit')}>ส่งให้ผู้ตรวจ</Button>}
              {selected.status === 'pending' && <Button variant="contained" color="success" disabled={saving || !canApproveSalesExpense(selected.status, selected.submitted_by, profile?.id ?? null)} onClick={() => void transition('approve')}>อนุมัติ (ผู้ตรวจคนที่สอง)</Button>}
              {selected.status === 'pending' && <Button color="error" disabled={saving || !reason.trim()} onClick={() => void transition('reject')}>ส่งกลับแก้ไข</Button>}
              {selected.status === 'approved' && <Button variant="contained" disabled={saving || !selected.accounting_document_id} onClick={() => void transition('create_accounting_draft')}>สร้างบัญชีร่าง</Button>}
              {(selected.status === 'draft' || selected.status === 'rejected') && <Button color="error" disabled={saving || !reason.trim()} onClick={() => void transition('void')}>ยกเลิกรายการ</Button>}
            </Stack>
            {selected.status === 'pending' && selected.submitted_by === profile?.id && <Alert severity="info">ผู้ส่งตรวจคนเดิมอนุมัติรายการนี้ไม่ได้ ต้องให้ผู้จัดการอีกคนตรวจตาม Maker-Checker</Alert>}
            {selected.status === 'approved' && !selected.accounting_document_id && <Alert severity="warning">ยังสร้างบัญชีร่างไม่ได้: ต้องผูก Accounting Document ที่ยืนยันแล้วในร่างก่อนส่งอนุมัติ</Alert>}

            {['approved', 'accounting_draft', 'paid'].includes(selected.status) && <Paper variant="outlined" sx={{ p: 1.5 }}><Typography sx={{ fontWeight: 800, mb: 1 }}>จัดผลลัพธ์ทางธุรกิจ</Typography><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}><TextField select size="small" label="ผลลัพธ์" value={outcome} onChange={(event) => setOutcome(event.target.value)} sx={{ minWidth: 220 }}><MenuItem value="selling_expense">ค่าใช้จ่ายขาย</MenuItem><MenuItem value="lost_bid">ต้นทุนขายไม่สำเร็จ</MenuItem><MenuItem value="customer_recoverable">เรียกเก็บลูกค้า</MenuItem></TextField><Button variant="outlined" disabled={saving || !reason.trim()} onClick={() => void classifyOutcome()}>บันทึกผลลัพธ์</Button></Stack><Divider sx={{ my: 1.5 }} /><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}><TextField select size="small" label="Cost Code ปลายทาง" value={costCodeId} onChange={(event) => setCostCodeId(event.target.value)} sx={{ minWidth: 260 }}><MenuItem value="">เลือก Cost Code</MenuItem>{costCodes.map((code) => <MenuItem key={code.id} value={code.id}>{code.code} · {code.name_th}</MenuItem>)}</TextField><Button variant="outlined" disabled={saving || !costCodeId || selected.outcome_bucket === 'project_cost'} onClick={() => void transferToProject()}>โอนเป็นต้นทุนโครงการ</Button></Stack></Paper>}

            <Divider />
            <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>5. Version และ Audit</Typography>
            {selectedAudits.length ? <Stack spacing={1}>{selectedAudits.map((audit) => <Paper key={audit.id} variant="outlined" sx={{ p: 1.25 }}><Stack direction="row" spacing={1}><Box sx={{ flex: 1 }}><Typography variant="body2" sx={{ fontWeight: 700 }}>{auditLabels[audit.action] ?? audit.action}</Typography><Typography variant="caption" color="text.secondary">{dateTime(audit.created_at)} · Actor {audit.actor_profile_id ?? 'system'}</Typography></Box></Stack>{audit.reason && <Typography variant="body2" sx={{ mt: .5 }}>เหตุผล: {audit.reason}</Typography>}</Paper>)}</Stack> : <Alert severity="info">ยังไม่มี Audit สำหรับร่างใหม่</Alert>}
          </>}
          <Button disabled={saving} onClick={closeDrawer}>ปิด</Button>
        </Stack>
      </Box>
    </Drawer>
  </Stack>
}
