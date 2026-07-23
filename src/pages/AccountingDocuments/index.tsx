import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined'
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, MenuItem, Paper, Select, Stack, Tab, Tabs,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'

type DocumentStatus = 'pending' | 'confirmed' | 'duplicate' | 'dismissed' | 'needs_correction'
type ItemType = 'stock' | 'direct_project' | 'tool_asset' | 'expense' | 'service' | 'labor' | 'unknown'

type AccountingDocument = {
  id: string
  document_type: string
  document_number: string | null
  document_date: string | null
  vendor_name: string | null
  total_amount: number | null
  status: DocumentStatus
  posting_status: string
  created_at: string
  projects: { name: string } | null
  line_messages: {
    line_senders: { display_name: string | null } | null
    line_groups: { display_name: string | null } | null
  } | null
}

type DocumentLine = {
  id: string
  line_number: number
  description: string
  product_code: string | null
  quantity: number | null
  unit: string | null
  unit_price: number | null
  line_amount: number | null
  item_type: ItemType
}

type InventoryBalance = {
  id: string
  name: string
  product_code: string | null
  unit: string | null
  item_kind: string
  balance_quantity: number
  average_unit_cost: number | null
}

const documentLabels: Record<string, string> = {
  receipt: 'ใบเสร็จรับเงิน', tax_invoice_full: 'ใบกำกับภาษีเต็มรูป',
  tax_invoice_abbreviated: 'ใบกำกับภาษีอย่างย่อ', quotation: 'ใบเสนอราคา',
  purchase_order: 'ใบสั่งซื้อ', invoice: 'ใบแจ้งหนี้', billing_note: 'ใบวางบิล',
  delivery_note: 'ใบส่งของ', goods_receipt: 'ใบรับสินค้า',
  withholding_tax_certificate: 'หนังสือรับรองหัก ณ ที่จ่าย',
  payroll: 'เอกสารค่าแรง', other: 'เอกสารอื่น', unreadable: 'อ่านเอกสารไม่ได้',
}
const statusLabels: Record<DocumentStatus, string> = {
  pending: 'รอตรวจสอบ', confirmed: 'ยืนยันแล้ว', duplicate: 'เอกสารซ้ำ',
  dismissed: 'ไม่นำมาใช้', needs_correction: 'ต้องแก้ไข',
}
const itemTypeLabels: Record<ItemType, string> = {
  stock: 'รับเข้าส stock', direct_project: 'วัสดุใช้ตรงโครงการ',
  tool_asset: 'เครื่องมือ/ทรัพย์สิน', expense: 'ค่าใช้จ่าย',
  service: 'ค่าบริการ', labor: 'ค่าแรง', unknown: 'รอจำแนก',
}
const money = (value: number | null) => value == null ? '-' :
  new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(value)

export function AccountingDocumentsPage() {
  usePageTitle('เอกสารบัญชีและสต๊อก')
  const { profile } = useAuth()
  const canManage = profile?.role === 'admin' || profile?.role === 'manager'
  const [tab, setTab] = useState(0)
  const [documents, setDocuments] = useState<AccountingDocument[]>([])
  const [inventory, setInventory] = useState<InventoryBalance[]>([])
  const [statusFilter, setStatusFilter] = useState('')
  const [selected, setSelected] = useState<AccountingDocument | null>(null)
  const [lines, setLines] = useState<DocumentLine[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [documentResult, inventoryResult] = await Promise.all([
      supabase.from('accounting_documents').select(`
        id, document_type, document_number, document_date, vendor_name, total_amount,
        status, posting_status, created_at, projects(name),
        line_messages(line_senders(display_name), line_groups(display_name))
      `).neq('document_type', 'transfer_slip').order('created_at', { ascending: false }).limit(1000),
      supabase.from('inventory_balances')
        .select('id, name, product_code, unit, item_kind, balance_quantity, average_unit_cost')
        .order('name'),
    ])
    if (documentResult.error) setError(documentResult.error.message)
    else setDocuments((documentResult.data ?? []) as unknown as AccountingDocument[])
    if (inventoryResult.error) setError((current) =>
      [current, inventoryResult.error.message].filter(Boolean).join(' · '))
    else setInventory((inventoryResult.data ?? []) as InventoryBalance[])
    setLoading(false)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0)
    return () => window.clearTimeout(timer)
  }, [loadData])

  const openDocument = async (document: AccountingDocument) => {
    setSelected(document)
    setLines([])
    const { data, error: loadError } = await supabase.from('accounting_document_lines')
      .select('id, line_number, description, product_code, quantity, unit, unit_price, line_amount, item_type')
      .eq('document_id', document.id).order('line_number')
    if (loadError) setError(loadError.message)
    else setLines((data ?? []) as DocumentLine[])
  }

  const saveLineType = async (line: DocumentLine, itemType: ItemType) => {
    const { error: updateError } = await supabase.from('accounting_document_lines')
      .update({ item_type: itemType, updated_at: new Date().toISOString() }).eq('id', line.id)
    if (updateError) setError(updateError.message)
    else setLines((current) => current.map((item) =>
      item.id === line.id ? { ...item, item_type: itemType } : item))
  }

  const confirmDocument = async () => {
    if (!selected || !canManage) return
    setSaving(true)
    setError(null)
    const { error: confirmError } = await supabase.rpc('confirm_accounting_document', {
      p_document_id: selected.id,
    })
    if (confirmError) setError(confirmError.message)
    else {
      setSuccess('ยืนยันเอกสารแล้ว ระบบสร้างรายการบัญชีร่างและรับสินค้าเข้าสต๊อกตามประเภทที่กำหนด')
      setSelected(null)
      await loadData()
    }
    setSaving(false)
  }

  const dismissDocument = async () => {
    if (!selected || !canManage) return
    setSaving(true)
    const { error: updateError } = await supabase.from('accounting_documents')
      .update({ status: 'dismissed', updated_at: new Date().toISOString() }).eq('id', selected.id)
    if (updateError) setError(updateError.message)
    else {
      setSelected(null)
      await loadData()
    }
    setSaving(false)
  }

  const visibleDocuments = useMemo(() => documents.filter((document) =>
    !statusFilter || document.status === statusFilter), [documents, statusFilter])
  const pendingAmount = documents
    .filter((document) => ['pending', 'needs_correction'].includes(document.status))
    .reduce((sum, document) => sum + (document.total_amount ?? 0), 0)
  const confirmedAmount = documents.filter((document) => document.status === 'confirmed')
    .reduce((sum, document) => sum + (document.total_amount ?? 0), 0)

  return (
    <Stack spacing={3}>
      <PageHeader
        title="เอกสารบัญชีและสต๊อก"
        description="Gemini อ่านเอกสารจากรูปใน LINE ตรวจรายการซ้ำ และพักข้อมูลไว้ให้ผู้ดูแลยืนยันก่อนลงบัญชีหรือรับเข้าสต๊อก"
        action={<Button startIcon={<RefreshOutlinedIcon />} onClick={() => void loadData()}>รีเฟรช</Button>}
      />
      {error && <Alert severity="error">{error}</Alert>}
      {success && <Alert severity="success">{success}</Alert>}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 2 }}>
        {[
          ['รอตรวจสอบ', money(pendingAmount), 'warning.main'],
          ['ยืนยันแล้ว', money(confirmedAmount), 'success.main'],
          ['เอกสารซ้ำ', `${documents.filter((item) => item.status === 'duplicate').length} รายการ`, 'error.main'],
        ].map(([label, value, color]) => (
          <Paper key={label} variant="outlined" sx={{ p: 2, borderTop: 3, borderTopColor: color }}>
            <Typography color="text.secondary">{label}</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{value}</Typography>
          </Paper>
        ))}
      </Box>
      <Paper variant="outlined">
        <Tabs value={tab} onChange={(_event, value) => setTab(value)}>
          <Tab label="เอกสารจาก LINE" /><Tab label="ยอดคงเหลือสต๊อก" />
        </Tabs>
      </Paper>
      {loading ? <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}><CircularProgress /></Box>
        : tab === 0 ? (
          <StandardDataTable
            rows={visibleDocuments}
            getRowId={(row) => row.id}
            getSearchText={(row) => [
              row.vendor_name, row.document_number, documentLabels[row.document_type],
              row.projects?.name, row.line_messages?.line_senders?.display_name,
              row.line_messages?.line_groups?.display_name,
            ].filter(Boolean).join(' ')}
            searchLabel="ค้นหาผู้ขาย เลขที่เอกสาร โครงการ หรือกลุ่ม LINE"
            emptyText="ยังไม่พบเอกสารบัญชีจาก LINE"
            exportFileName="wisdomai-accounting-documents"
            minWidth={1300}
            toolbar={<Select size="small" displayEmpty value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)} sx={{ minWidth: 170 }}>
              <MenuItem value="">ทุกสถานะ</MenuItem>
              {(Object.entries(statusLabels) as [DocumentStatus, string][]).map(([value, label]) =>
                <MenuItem key={value} value={value}>{label}</MenuItem>)}
            </Select>}
            columns={[
              { id: 'date', label: 'วันที่', minWidth: 120, render: (row) => row.document_date ?? new Date(row.created_at).toLocaleDateString('th-TH'), exportValue: (row) => row.document_date ?? row.created_at },
              { id: 'type', label: 'ประเภทเอกสาร', minWidth: 180, render: (row) => documentLabels[row.document_type] ?? row.document_type, exportValue: (row) => documentLabels[row.document_type] },
              { id: 'number', label: 'เลขที่เอกสาร', minWidth: 140, render: (row) => row.document_number ?? '-', exportValue: (row) => row.document_number },
              { id: 'vendor', label: 'ผู้ขาย/ผู้รับเงิน', minWidth: 200, render: (row) => row.vendor_name ?? 'อ่านชื่อไม่ได้', exportValue: (row) => row.vendor_name },
              { id: 'total', label: 'ยอดรวม', minWidth: 120, align: 'right', render: (row) => money(row.total_amount), exportValue: (row) => row.total_amount },
              { id: 'project', label: 'โครงการ', minWidth: 160, render: (row) => row.projects?.name ?? 'รอระบุ', exportValue: (row) => row.projects?.name },
              { id: 'source', label: 'ผู้ส่ง/กลุ่ม LINE', minWidth: 210, render: (row) => `${row.line_messages?.line_senders?.display_name ?? 'ไม่ทราบผู้ส่ง'} · ${row.line_messages?.line_groups?.display_name ?? 'แชตส่วนตัว'}`, exportValue: (row) => row.line_messages?.line_groups?.display_name },
              { id: 'status', label: 'สถานะ', minWidth: 140, render: (row) => <Chip size="small" color={row.status === 'confirmed' ? 'success' : row.status === 'duplicate' ? 'error' : row.status === 'needs_correction' ? 'warning' : 'default'} label={statusLabels[row.status]} />, exportValue: (row) => statusLabels[row.status] },
              { id: 'action', label: 'ตรวจสอบ', minWidth: 120, render: (row) => <Button size="small" variant="outlined" onClick={() => void openDocument(row)}>เปิดเอกสาร</Button> },
            ]}
          />
        ) : (
          <StandardDataTable
            rows={inventory}
            getRowId={(row) => row.id}
            getSearchText={(row) => [row.name, row.product_code, row.item_kind].filter(Boolean).join(' ')}
            searchLabel="ค้นหาชื่อหรือรหัสสินค้า"
            emptyText="ยังไม่มีรายการรับเข้าส stock ที่ยืนยันแล้ว"
            exportFileName="wisdomai-inventory-balances"
            minWidth={800}
            columns={[
              { id: 'code', label: 'รหัสสินค้า', minWidth: 140, render: (row) => row.product_code ?? '-', exportValue: (row) => row.product_code },
              { id: 'name', label: 'ชื่อสินค้า', minWidth: 280, render: (row) => row.name, exportValue: (row) => row.name },
              { id: 'kind', label: 'ประเภท', minWidth: 130, render: (row) => row.item_kind, exportValue: (row) => row.item_kind },
              { id: 'balance', label: 'คงเหลือ', minWidth: 130, align: 'right', render: (row) => `${Number(row.balance_quantity).toLocaleString('th-TH')} ${row.unit ?? ''}`, exportValue: (row) => row.balance_quantity },
              { id: 'cost', label: 'ต้นทุนเฉลี่ย', minWidth: 150, align: 'right', render: (row) => money(row.average_unit_cost), exportValue: (row) => row.average_unit_cost },
            ]}
          />
        )}

      <Dialog open={Boolean(selected)} onClose={() => !saving && setSelected(null)} maxWidth="lg" fullWidth>
        <DialogTitle>ตรวจสอบเอกสาร: {selected ? documentLabels[selected.document_type] ?? selected.document_type : ''}</DialogTitle>
        <DialogContent dividers>
          {selected && <Stack spacing={2}>
            <Typography><b>ผู้ขาย/ผู้รับเงิน:</b> {selected.vendor_name ?? 'อ่านชื่อไม่ได้'} · <b>เลขที่:</b> {selected.document_number ?? '-'} · <b>ยอด:</b> {money(selected.total_amount)}</Typography>
            {(selected.status === 'needs_correction' || lines.some((line) => line.item_type === 'unknown')) &&
              <Alert severity="warning">กรุณากำหนดประเภทของทุกรายการก่อนยืนยัน ระบบจะไม่ลงบัญชีหรือรับสต๊อกจากข้อมูลที่ยังไม่ชัดเจน</Alert>}
            <StandardDataTable
              rows={lines}
              getRowId={(row) => row.id}
              emptyText="Gemini ไม่พบรายการสินค้าในเอกสารนี้"
              exportFileName="wisdomai-document-lines"
              minWidth={900}
              columns={[
                { id: 'no', label: '#', render: (row) => row.line_number, exportValue: (row) => row.line_number },
                { id: 'description', label: 'รายการ', minWidth: 280, render: (row) => row.description, exportValue: (row) => row.description },
                { id: 'quantity', label: 'จำนวน', align: 'right', render: (row) => `${row.quantity ?? '-'} ${row.unit ?? ''}`, exportValue: (row) => row.quantity },
                { id: 'price', label: 'ราคา/หน่วย', align: 'right', render: (row) => money(row.unit_price), exportValue: (row) => row.unit_price },
                { id: 'amount', label: 'รวม', align: 'right', render: (row) => money(row.line_amount), exportValue: (row) => row.line_amount },
                { id: 'type', label: 'การนำไปใช้', minWidth: 220, render: (row) =>
                  <Select size="small" fullWidth value={row.item_type}
                    disabled={!canManage || selected.status === 'confirmed' || selected.status === 'duplicate'}
                    onChange={(event) => void saveLineType(row, event.target.value as ItemType)}>
                    {(Object.entries(itemTypeLabels) as [ItemType, string][]).map(([value, label]) =>
                      <MenuItem key={value} value={value}>{label}</MenuItem>)}
                  </Select>, exportValue: (row) => itemTypeLabels[row.item_type] },
              ]}
            />
          </Stack>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelected(null)} disabled={saving}>ปิด</Button>
          {canManage && selected && ['pending', 'needs_correction'].includes(selected.status) && <>
            <Button color="inherit" onClick={() => void dismissDocument()} disabled={saving}>ไม่นำมาใช้</Button>
            <Button variant="contained" onClick={() => void confirmDocument()}
              disabled={saving || lines.length === 0 || lines.some((line) => line.item_type === 'unknown')}>
              {saving ? 'กำลังบันทึก...' : 'ยืนยันและสร้างรายการร่าง'}
            </Button>
          </>}
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
