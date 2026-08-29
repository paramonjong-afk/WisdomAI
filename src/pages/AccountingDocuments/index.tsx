import AddOutlinedIcon from '@mui/icons-material/AddOutlined'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import OpenInNewOutlinedIcon from '@mui/icons-material/OpenInNewOutlined'
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined'
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Autocomplete, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Drawer, FormControlLabel, IconButton, MenuItem, Paper, Select, Stack, Tab, Tabs, TextField, Typography,
} from '@mui/material'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
import { documentFlowGateway } from '../../services/documentFlowGateway'
import { filterTransferSlipQueue, transferSlipContinuation, transferSlipQueueBucket, transferSlipQueueCounts } from '../../services/accountingTransferSlipQueue'
import type { TransferSlipQueueFilter, TransferSlipQueueRow } from '../../services/accountingTransferSlipQueue'
import { mapTransferSlipTruth } from '../../services/transferSlipOperationalTruth'
import type { TransferSlipOperationalTruthRow } from '../../services/transferSlipOperationalTruth'
import { applyMoneyFundingSource, calculateUnallocatedAmount, emptyMoneyAllocation, emptyMoneyLineage, legacyMoneyLineageScope, moneyAllocationDestinations, moneyAllocationTotal, moneyFundingSourceNeedsHolder, moneyPurposeNeedsExpenseAccount, moneyPurposeRoute, validateMoneyLineage } from '../../services/transferSlipMoneyLineage'
import type { MoneyAllocationDraft, MoneyFundingSource, MoneyLineageDraft, MoneyPurpose, PayrollKind } from '../../services/transferSlipMoneyLineage'
import { buildSlipAnalysisGate, inferSlipMoneyPurpose, slipPurposeNeedsFundHolder, slipPurposeNeedsProject } from '../../services/transferSlipAnalysisGate'
import { emptyPaymentPartyDraft, paymentAliasValidation, paymentMethodLabel } from '../../services/paymentAlias'
import type { PaymentAliasType, PaymentMethod } from '../../services/paymentAlias'
import type { VendorMatchStatus } from '../../services/vendorPaymentMatching'
import { runWithMutationAttempt } from '../../utils/mutationAttemptRunner'
import { userError } from '../../utils/userError'
import { TransferSlipAnalysisGateCard } from './TransferSlipAnalysisGateCard'

type DocumentStatus = 'pending' | 'confirmed' | 'duplicate' | 'dismissed' | 'needs_correction'
type ItemType = 'stock' | 'direct_project' | 'tool_asset' | 'expense' | 'service' | 'labor' | 'unknown'
type Project = { id: string; name: string; code: string | null }
type Site = { id: string; project_id: string; name: string }
type CostCategory = { id: string; parent_id: string | null; code: string; name_th: string; default_account_code: string | null; default_account_name: string | null }
type VendorOption = { id: string; name: string; tax_id: string | null; phone: string | null }

type AccountingDocument = {
  id: string; document_type: string; document_number: string | null; document_date: string | null
  source_message_id: string
  document_set_id: string | null; page_number: number | null
  vendor_name: string | null; total_amount: number | null; status: DocumentStatus; posting_status: string
  created_at: string; project_id: string | null; site_id: string | null; cost_center_code: string | null
  wbs_code: string | null; contract_reference: string | null; recognition_date: string | null
  document_purpose: DocumentPurpose; classification_source: string
  review_draft: { header?: typeof emptyHeader; lines?: DocumentLine[]; document_type?: string; document_purpose?: DocumentPurpose; supplier_name?: string; receiving_location?: string; stock_review?: Record<string, StockReviewLine> } | null
  projects: { name: string } | null
  line_messages: { line_senders: { display_name: string | null } | null; line_groups: { display_name: string | null } | null } | null
}
type AccountingPendingSlip = TransferSlipQueueRow
type SlipPreviewFile = { url: string; contentType: string | null; label: string }
type SlipFlowEvent = { id: string; event_type: string; from_flow: string | null; to_flow: string | null; from_state: string | null; to_state: string | null; note: string | null; created_at: string }
type SlipReviewDraft = { senderName: string; senderBankName: string; senderAccountLast4: string; senderPaymentMethod: PaymentMethod; senderAliasType: PaymentAliasType; senderAliasValue: string; recipientName: string; recipientBankName: string; recipientAccountLast4: string; recipientPaymentMethod: PaymentMethod; recipientAliasType: PaymentAliasType; recipientAliasValue: string; amount: string; transferAt: string; bankReference: string; note: string }
type AdvancePartyMatch = { applicable: boolean; ready: boolean; applied: boolean; blockers: string[]; holderId?: string | null; holderName?: string | null; recipientProfileId?: string | null; recipientName?: string | null; senderBankLinked?: boolean; recipientBankLinked?: boolean }
const slipDraftFromRow = (row: AccountingPendingSlip): SlipReviewDraft => {
  const sender = emptyPaymentPartyDraft(row.senderBankName, row.senderAccountLast4)
  const recipient = emptyPaymentPartyDraft(row.recipientBankName, row.recipientAccountLast4)
  return { senderName: row.senderName ?? '', senderBankName: row.senderBankName ?? '', senderAccountLast4: row.senderAccountLast4 ?? '', senderPaymentMethod: sender.paymentMethod, senderAliasType: sender.aliasType, senderAliasValue: sender.aliasValue, recipientName: row.recipientName ?? '', recipientBankName: row.recipientBankName ?? '', recipientAccountLast4: row.recipientAccountLast4 ?? '', recipientPaymentMethod: recipient.paymentMethod, recipientAliasType: recipient.aliasType, recipientAliasValue: recipient.aliasValue, amount: row.amount == null ? '' : String(row.amount), transferAt: row.transferAt ? new Date(row.transferAt).toISOString().slice(0, 16) : '', bankReference: row.bankReference ?? '', note: row.dataReviewNote ?? row.notes ?? '' }
}
type StoredPaymentPartyLink = { party_role: 'sender' | 'recipient'; payment_method: PaymentMethod; canonical_party_type: string | null; canonical_party_name: string | null; match_status: string; match_reason: string; master_payment_aliases: { alias_type: PaymentAliasType; masked_value: string; verification_status: string } | null }
type StoredMoneyAllocation = { allocation_key: string; purpose_type: MoneyPurpose; allocation_amount: number; cost_category_id: string | null; account_code: string | null; account_name: string | null; project_id: string | null; site_id: string | null; payee_name: string | null; responsible_name: string | null; description: string | null; confidence: number | null; evidence: Array<{ field?: string; value?: string }> | null }
type StoredVendorMatch = { allocation_key: string; vendor_id: string | null; vendor_name: string | null; vendor_tax_id: string | null; vendor_bank_name: string | null; vendor_account_last4: string | null; payer_name: string | null; match_status: VendorMatchStatus; confidence: number | null; reason: string }
type StoredMoneyLineage = { id: string; root_lineage_id: string; parent_lineage_id: string | null; funding_source_type: MoneyFundingSource; funding_source_reference: string | null; fund_holder_name: string | null; payer_name: string | null; final_beneficiary_name: string | null; purpose_type: MoneyPurpose | 'multi_allocation'; project_id: string | null; site_id: string | null; responsible_name: string | null; starting_amount: number | null; paid_amount: number | null; returned_amount: number; remaining_amount: number | null; hops: Array<{ from_party?: string; to_party?: string; amount?: number; transferred_at?: string; note?: string }>; route_status: string; next_destination: string; route_note: string | null }
type MoneyLineageOption = { id: string; root_lineage_id: string; payer_name: string | null; final_beneficiary_name: string | null; paid_amount: number | null; updated_at: string; route_status: string }
const moneyAllocationDraftFromStored = (row: StoredMoneyAllocation, match?: StoredVendorMatch): MoneyAllocationDraft => ({ key: row.allocation_key, purposeType: row.purpose_type, amount: String(row.allocation_amount), costCategoryId: row.cost_category_id ?? '', accountCode: row.account_code ?? '', accountName: row.account_name ?? '', projectId: row.project_id ?? '', siteId: row.site_id ?? '', payeeName: row.payee_name ?? '', responsibleName: row.responsible_name ?? '', description: row.description ?? '', confidence: row.confidence == null ? '' : String(row.confidence), payrollKind: (row.evidence ?? []).find(item => item.field === 'payroll_kind')?.value as PayrollKind ?? '', vendorId: match?.vendor_id ?? '', vendorName: match?.vendor_name ?? '', vendorTaxId: match?.vendor_tax_id ?? '', vendorBankName: match?.vendor_bank_name ?? '', vendorAccountLast4: match?.vendor_account_last4 ?? '', vendorMatchStatus: match?.match_status ?? 'needs_review', vendorMatchConfidence: match?.confidence == null ? '' : String(match.confidence), vendorMatchReason: match?.reason ?? '' })
const moneyLineageDraftFromStored = (row: StoredMoneyLineage, allocations: StoredMoneyAllocation[], matches: StoredVendorMatch[] = []): MoneyLineageDraft => {
  const matchByKey = new Map(matches.map(match => [match.allocation_key, match]))
  return { parentLineageId: row.parent_lineage_id ?? '', fundingSourceType: row.funding_source_type, fundingSourceReference: row.funding_source_reference ?? '', fundHolderName: row.fund_holder_name ?? '', payerName: row.payer_name ?? '', finalBeneficiaryName: row.final_beneficiary_name ?? '', purposeType: row.purpose_type === 'multi_allocation' ? 'unknown' : row.purpose_type, projectId: row.project_id ?? '', siteId: row.site_id ?? '', responsibleName: row.responsible_name ?? '', startingAmount: row.starting_amount == null ? '' : String(row.starting_amount), paidAmount: row.paid_amount == null ? '' : String(row.paid_amount), returnedAmount: String(row.returned_amount ?? 0), remainingAmount: row.remaining_amount == null ? '' : String(row.remaining_amount), note: row.route_note ?? '', hops: (row.hops ?? []).map(hop => ({ fromParty: hop.from_party ?? '', toParty: hop.to_party ?? '', amount: hop.amount == null ? '' : String(hop.amount), transferredAt: hop.transferred_at ? new Date(hop.transferred_at).toISOString().slice(0, 16) : '', note: hop.note ?? '' })), allocations: allocations.length ? allocations.map(allocation => moneyAllocationDraftFromStored(allocation, matchByKey.get(allocation.allocation_key))) : [emptyMoneyAllocation(row.paid_amount, row.final_beneficiary_name ?? '')] }
}
type DocumentSetMember = { id: string; source_message_id: string; document_type: string; status: DocumentStatus; page_number: number | null; created_at: string }
type SetMatchGap = { documentType: string; documentLabel: string; isRequired: boolean }
type DocumentSetMatchSummary = {
  key: string
  setLabel: string
  status: string
  vendorName: string
  documentCount: number
  pageCount: number
  typesPresent: string[]
  criticalMissing: string[]
  optionalMissing: string[]
  representativeDocumentId: string
  representativeDocumentType: string
  createdAt: string
}

type Allocation = {
  id?: string; project_id: string; site_id: string; cost_category_id: string
  account_code: string; account_name: string; cost_center_code: string; wbs_code: string
  allocation_percent: number; allocation_amount: number
}
type DocumentLine = {
  id: string; line_number: number; description: string; product_code: string | null
  quantity: number | null; unit: string | null; unit_price: number | null; line_amount: number | null
  item_type: ItemType; cost_category_id: string | null; account_code: string | null; account_name: string | null
  split_group_id?: string | null; split_original_description?: string | null; split_original_quantity?: number | null
  allocations: Allocation[]
}
type ProductSplitItem = { description: string; quantity: number; mode: StockMode; project_id: string; site_id: string }
type InventoryBalance = { id: string; name: string; product_code: string | null; unit: string | null; item_kind: string; balance_quantity: number; average_unit_cost: number | null }
type ProjectInventoryBalance = { inventory_item_id: string; project_id: string | null; location_id: string | null; name: string; product_code: string | null; unit: string | null; location_name: string | null; balance_quantity: number; average_unit_cost: number }
type ProductPriceReference = { id: string; document_id: string; project_id?: string | null; vendor_name: string | null; product_code: string | null; description: string; quantity: number | null; unit: string | null; unit_price: number | null; effective_unit_price: number | null; currency: string; observed_at: string; valid_until: string | null; decision_status: string }
type ActualProductPriceRow = { id:string;document_id:string;observed_at:string;quantity:number|null;unit:string|null;stated_unit_price:number|null;effective_unit_price:number;currency:string;price_basis:string;inventory_items:{name:string;product_code:string|null}|null;vendors:{name:string}|null }
type DocumentPurpose = 'material' | 'subcontractor' | 'service' | 'labor' | 'equipment' | 'welfare' | 'overhead' | 'other'
type QuotationAction = 'order_full' | 'order_partial' | 'not_ordered' | 'reference_only' | 'expired' | 'cancelled'
type StockMode = 'central_stock' | 'project_stock' | 'direct_use'
type StockAllocation = { project_id: string; site_id: string; quantity: number; mode: StockMode }
type StockReviewLine = { accepted: boolean; received_quantity: number; condition: 'good' | 'damaged' | 'short' | 'rejected'; note: string; allocations: StockAllocation[] }
type MatchCandidate = { id: string; label: string }
type DeliveryNoteCandidate = MatchCandidate & { amount: number; vendorName: string; documentType: 'delivery_note' | 'goods_receipt'; sourceMessageId: string }
type ReceivingComparisonLine = { id: string; document_id: string; description: string; quantity: number | null; unit: string | null; line_amount: number | null }
type StockOperationType = 'issue' | 'transfer' | 'waste'
const payableDocumentTypes = ['invoice', 'invoice_tax_invoice', 'tax_invoice_full', 'billing_note']
const stockModeLabels: Record<StockMode, string> = { central_stock: 'คลังกลาง', project_stock: 'Stock โครงการ', direct_use: 'รับและใช้ทันที' }

const documentLabels: Record<string, string> = {
  receipt: 'ใบเสร็จรับเงิน', cash_receipt: 'บิลเงินสด', tax_invoice_full: 'ใบกำกับภาษีเต็มรูป', tax_invoice_abbreviated: 'ใบกำกับภาษีอย่างย่อ',
  receipt_tax_invoice: 'ใบเสร็จรับเงิน/ใบกำกับภาษี', invoice_tax_invoice: 'ใบแจ้งหนี้/ใบกำกับภาษี',
  receipt_tax_invoice_abbreviated: 'ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ',
  quotation: 'ใบเสนอราคา', purchase_order: 'ใบสั่งซื้อ', invoice: 'ใบแจ้งหนี้', billing_note: 'ใบวางบิล',
  delivery_note: 'ใบส่งของ', goods_receipt: 'ใบรับสินค้า', withholding_tax_certificate: 'หนังสือรับรองหัก ณ ที่จ่าย',
  payroll: 'เอกสารค่าแรง', other: 'เอกสารอื่น', unreadable: 'อ่านเอกสารไม่ได้',
}
const statusLabels: Record<DocumentStatus, string> = { pending: 'รอตรวจสอบ', confirmed: 'ยืนยันแล้ว', duplicate: 'เอกสารซ้ำ', dismissed: 'ไม่นำมาใช้', needs_correction: 'ต้องแก้ไข' }
const purposeLabels: Record<DocumentPurpose, string> = {
  material: 'วัสดุ', subcontractor: 'ผู้รับเหมา/ผู้รับเหมาช่วง', service: 'บริการ', labor: 'แรงงาน',
  equipment: 'เครื่องจักรและอุปกรณ์', welfare: 'สวัสดิการ', overhead: 'ค่าใช้จ่ายส่วนกลาง', other: 'อื่น ๆ',
}
const itemTypeLabels: Record<ItemType, string> = {
  stock: 'รับเข้าส Stock', direct_project: 'ต้นทุนตรงโครงการ', tool_asset: 'เครื่องมือ/ทรัพย์สิน',
  expense: 'ค่าใช้จ่าย', service: 'ค่าบริการ', labor: 'ค่าแรง/สวัสดิการ', unknown: 'รอจำแนก',
}
const money = (value: number | null | undefined) => value == null ? '-' : new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(value)
const roundMoney = (value: number) => Math.round(value * 100) / 100
const emptyHeader = { project_id: '', site_id: '', cost_center_code: '', wbs_code: '', contract_reference: '', recognition_date: '' }
const quotationActionLabels: Record<QuotationAction, string> = {
  order_full: 'สั่งซื้อทั้งใบ', order_partial: 'สั่งซื้อบางส่วน', not_ordered: 'ไม่สั่งซื้อ',
  reference_only: 'เก็บเป็นราคาอ้างอิง', expired: 'ใบเสนอราคาหมดอายุ', cancelled: 'ยกเลิก',
}
const matchRequirements: readonly SetMatchGap[] = [
  { documentType: 'quotation', documentLabel: 'ใบเสนอราคา', isRequired: true },
  { documentType: 'purchase_order', documentLabel: 'ใบสั่งซื้อ', isRequired: false },
  { documentType: 'goods_receipt', documentLabel: 'ใบรับสินค้า', isRequired: true },
  { documentType: 'delivery_note', documentLabel: 'ใบส่งของ', isRequired: false },
  { documentType: 'billing_note', documentLabel: 'ใบวางบิล', isRequired: false },
] as const

export function AccountingDocumentsPage() {
  usePageTitle('เอกสารบัญชีและสต๊อก')
  const [searchParams] = useSearchParams()
  const requestedTransactionId = searchParams.get('transaction_id')
  const { profile,currentCompany } = useAuth()
  const canManage = profile?.role === 'admin' || profile?.role === 'manager'
  const runAttempt = (action: string, request: Record<string, unknown>, operation: () => unknown) =>
    runWithMutationAttempt({
      module: 'accounting_documents',
      action,
      actorProfileId: profile?.id,
      companyId: currentCompany?.company_id ?? null,
      request,
      operation,
    })
  const [tab, setTab] = useState(0)
  const [accountingQueueView, setAccountingQueueView] = useState<'slips' | 'documents'>('slips')
  const [slipFilter, setSlipFilter] = useState<TransferSlipQueueFilter>('transfer_slip')
  const [documents, setDocuments] = useState<AccountingDocument[]>([])
  const [pendingSlips, setPendingSlips] = useState<AccountingPendingSlip[]>([])
  const [selectedSlip, setSelectedSlip] = useState<AccountingPendingSlip | null>(null)
  const [slipPreviewFiles, setSlipPreviewFiles] = useState<SlipPreviewFile[]>([])
  const [slipPreviewIndex, setSlipPreviewIndex] = useState(0)
  const [slipPreviewMessage, setSlipPreviewMessage] = useState('')
  const [slipEvents, setSlipEvents] = useState<SlipFlowEvent[]>([])
  const [slipDetailLoading, setSlipDetailLoading] = useState(false)
  const [slipDetailTab, setSlipDetailTab] = useState(0)
  const [slipReviewDraft, setSlipReviewDraft] = useState<SlipReviewDraft | null>(null)
  const [slipMoneyLineageDraft, setSlipMoneyLineageDraft] = useState<MoneyLineageDraft | null>(null)
  const [slipMoneyLineageStatus, setSlipMoneyLineageStatus] = useState<{ routeStatus: string; nextDestination: string } | null>(null)
  const [moneyLineageOptions, setMoneyLineageOptions] = useState<MoneyLineageOption[]>([])
  const [slipAiGuidance, setSlipAiGuidance] = useState('')
  const [slipAdvancePartyMatch, setSlipAdvancePartyMatch] = useState<AdvancePartyMatch | null>(null)
  const [slipActionLoading, setSlipActionLoading] = useState(false)
  const [slipDateRepairLoading, setSlipDateRepairLoading] = useState(false)
  const slipRequestRef = useRef(0)
  const openedTransactionRef = useRef<string | null>(null)
  const [inventory, setInventory] = useState<InventoryBalance[]>([])
  const [projectInventory, setProjectInventory] = useState<ProjectInventoryBalance[]>([])
  const [productPrices, setProductPrices] = useState<ProductPriceReference[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [categories, setCategories] = useState<CostCategory[]>([])
  const [statusFilter, setStatusFilter] = useState('active')
  const [selected, setSelected] = useState<AccountingDocument | null>(null)
  const [lines, setLines] = useState<DocumentLine[]>([])
  const [header, setHeader] = useState(emptyHeader)
  const [documentType, setDocumentType] = useState('other')
  const [documentPurpose, setDocumentPurpose] = useState<DocumentPurpose>('other')
  const [applyToSimilar, setApplyToSimilar] = useState(false)
  const [preview, setPreview] = useState<{ url: string; contentType: string } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [documentSetMembers, setDocumentSetMembers] = useState<DocumentSetMember[]>([])
  const [quotationAction, setQuotationAction] = useState<QuotationAction>('reference_only')
  const [quotationReason, setQuotationReason] = useState('')
  const [quotationValidUntil, setQuotationValidUntil] = useState('')
  const [quotationQuantities, setQuotationQuantities] = useState<Record<string, number>>({})
  const [quotationStatus, setQuotationStatus] = useState('pending')
  const [supplierName, setSupplierName] = useState('')
  const [vendors, setVendors] = useState<VendorOption[]>([])
  const [receivingLocation, setReceivingLocation] = useState('')
  const [stockReview, setStockReview] = useState<Record<string, StockReviewLine>>({})
  const [selectedStockLineIds, setSelectedStockLineIds] = useState<string[]>([])
  const [bulkStockMode, setBulkStockMode] = useState<StockMode>('project_stock')
  const [bulkCostCategoryId, setBulkCostCategoryId] = useState('')
  const bulkItemType: ItemType = 'stock'
  const [receiptCandidates, setReceiptCandidates] = useState<MatchCandidate[]>([])
  const [poCandidates, setPoCandidates] = useState<MatchCandidate[]>([])
  const [matchedReceiptId, setMatchedReceiptId] = useState('')
  const [matchedPoId, setMatchedPoId] = useState('')
  const [approveMatchException, setApproveMatchException] = useState(false)
  const [matchExceptionReason, setMatchExceptionReason] = useState('')
  const [deliveryNoteCandidates, setDeliveryNoteCandidates] = useState<DeliveryNoteCandidate[]>([])
  const [selectedDeliveryNoteIds, setSelectedDeliveryNoteIds] = useState<string[]>([])
  const [receivingComparisonLines, setReceivingComparisonLines] = useState<ReceivingComparisonLine[]>([])
  const [savingLineId, setSavingLineId] = useState('')
  const [operationStock, setOperationStock] = useState<ProjectInventoryBalance | null>(null)
  const [operationType, setOperationType] = useState<StockOperationType>('issue')
  const [operationQuantity, setOperationQuantity] = useState(0)
  const [operationTargetProject, setOperationTargetProject] = useState('')
  const [operationTargetLocation, setOperationTargetLocation] = useState('')
  const [operationReason, setOperationReason] = useState('')
  const [splitLine, setSplitLine] = useState<DocumentLine | null>(null)
  const [splitItems, setSplitItems] = useState<ProductSplitItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [savedDraftSnapshot, setSavedDraftSnapshot] = useState('')
  const [draftTrackingReady, setDraftTrackingReady] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true); setError(null)
    const [documentResult, inventoryResult, projectInventoryResult, productPriceResult, actualPriceResult, projectResult, siteResult, categoryResult, vendorResult] = await Promise.all([
      supabase.from('accounting_documents').select(`id,source_message_id,document_set_id,page_number,document_type,document_purpose,classification_source,review_draft,document_number,document_date,vendor_name,total_amount,status,posting_status,created_at,project_id,site_id,cost_center_code,wbs_code,contract_reference,recognition_date,projects(name),line_messages!accounting_documents_source_message_id_fkey(line_senders(display_name),line_groups(display_name))`).neq('document_type', 'transfer_slip').order('created_at', { ascending: false }).limit(1000),
      supabase.from('inventory_balances').select('id,name,product_code,unit,item_kind,balance_quantity,average_unit_cost').order('name'),
      supabase.from('inventory_project_balances').select('inventory_item_id,project_id,location_id,name,product_code,unit,location_name,balance_quantity,average_unit_cost').order('name'),
      supabase.from('quotation_price_references').select('id,document_id,project_id,vendor_name,product_code,description,quantity,unit,unit_price,effective_unit_price,currency,observed_at,valid_until,decision_status').order('observed_at', { ascending: false }).limit(5000),
      supabase.from('vendor_product_prices').select('id,document_id,observed_at,quantity,unit,stated_unit_price,effective_unit_price,currency,price_basis,inventory_items(name,product_code),vendors(name)').eq('price_basis','actual').order('observed_at',{ascending:false}).limit(5000),
      supabase.from('projects').select('id,name,code').eq('status', 'active').order('name'),
      supabase.from('project_sites').select('id,project_id,name').eq('active', true).order('name'),
      supabase.from('accounting_cost_categories').select('id,parent_id,code,name_th,default_account_code,default_account_name').eq('active', true).order('sort_order'),
      supabase.from('vendors').select('id,name,tax_id,phone').order('name'),
    ])
    const firstError = [documentResult.error, inventoryResult.error, projectInventoryResult.error, productPriceResult.error, actualPriceResult.error, projectResult.error, siteResult.error, categoryResult.error, vendorResult.error].find(Boolean)
    if (firstError) setError(userError(firstError))
    // All transfer-slip modules consume one database projection. Evidence remains
    // visible for review, but only canonical_* values are operational/postable.
    const { data: truthRows, error: truthError } = await supabase
      .from('transfer_slip_operational_truth_v1')
      .select('*')
      .in('task_status', ['queued', 'claimed', 'completed', 'returned', 'recheck_required'])
      .order('task_created_at', { ascending: false })
      .limit(1000)
    if (truthError) setError(current => current ?? userError(truthError))
    setPendingSlips(((truthRows ?? []) as unknown as TransferSlipOperationalTruthRow[]).map(mapTransferSlipTruth))
    setDocuments((documentResult.data ?? []) as unknown as AccountingDocument[])
    setInventory((inventoryResult.data ?? []) as InventoryBalance[])
    setProjectInventory((projectInventoryResult.data ?? []) as unknown as ProjectInventoryBalance[])
    const quotationPrices=(productPriceResult.data??[]).map(item=>({...item,id:`quotation-${item.id}`})) as ProductPriceReference[]
    const actualPrices=((actualPriceResult.data??[]) as unknown as ActualProductPriceRow[]).map(item=>({id:`actual-${item.id}`,document_id:item.document_id,vendor_name:item.vendors?.name??null,product_code:item.inventory_items?.product_code??null,description:item.inventory_items?.name??'ไม่ระบุสินค้า',quantity:item.quantity,unit:item.unit,unit_price:item.stated_unit_price,effective_unit_price:item.effective_unit_price,currency:item.currency,observed_at:item.observed_at,valid_until:null,decision_status:'actual'}))
    setProductPrices([...actualPrices,...quotationPrices])
    setProjects((projectResult.data ?? []) as Project[])
    setSites((siteResult.data ?? []) as Site[])
    setCategories((categoryResult.data ?? []) as CostCategory[])
    setVendors((vendorResult.data ?? []) as VendorOption[])
    setLoading(false)
  }, [])

  useEffect(() => { const timer = window.setTimeout(() => void loadData(), 0); return () => window.clearTimeout(timer) }, [loadData])

  const openDocument = async (document: AccountingDocument) => {
    setDraftTrackingReady(false)
    setSavedDraftSnapshot('')
    setSelected(document); setLines([]); setBulkCostCategoryId(''); setError(null); setSuccess(null)
    setDocumentSetMembers([])
    if(document.document_set_id){
      const {data:setRows,error:setLoadError}=await supabase.from('accounting_documents')
        .select('id,source_message_id,document_type,status,page_number,created_at')
        .eq('document_set_id',document.document_set_id).order('page_number',{ascending:true})
      if(setLoadError)setError(userError(setLoadError))
      else setDocumentSetMembers((setRows??[]) as DocumentSetMember[])
    }
    const savedDraft = document.review_draft
    const databaseHeader = {
      project_id: document.project_id ?? '', site_id: document.site_id ?? '', cost_center_code: document.cost_center_code ?? '',
      wbs_code: document.wbs_code ?? '', contract_reference: document.contract_reference ?? '', recognition_date: document.recognition_date ?? document.document_date ?? '',
    }
    const documentTypeNext = savedDraft?.document_type ?? document.document_type
    const documentPurposeNext = savedDraft?.document_purpose ?? document.document_purpose ?? 'other'
    const headerNext = { ...databaseHeader, ...(savedDraft?.header ?? {}) }
    setHeader(headerNext)
    setDocumentType(documentTypeNext)
    setDocumentPurpose(documentPurposeNext)
    setApplyToSimilar(false)
    setMatchedReceiptId(''); setMatchedPoId(''); setApproveMatchException(false); setMatchExceptionReason(''); setSelectedDeliveryNoteIds([])
    const [lineResult, allocationResult, quotationResult, quotationLineResult, goodsReviewResult, goodsLineResult] = await Promise.all([
      supabase.from('accounting_document_lines').select('id,line_number,description,product_code,quantity,unit,unit_price,line_amount,item_type,cost_category_id,account_code,account_name,split_group_id,split_original_description,split_original_quantity').eq('document_id', document.id).order('line_number'),
      supabase.from('accounting_line_allocations').select('id,document_line_id,project_id,site_id,cost_category_id,account_code,account_name,cost_center_code,wbs_code,allocation_percent,allocation_amount').eq('document_id', document.id).order('created_at'),
      supabase.from('quotation_decisions').select('status,reason,valid_until').eq('document_id', document.id).maybeSingle(),
      supabase.from('quotation_line_decisions').select('document_line_id,remaining_quantity,quotation_decisions!inner(document_id)').eq('quotation_decisions.document_id', document.id),
      supabase.from('goods_receipt_reviews').select('supplier_name,receiving_location').eq('document_id', document.id).maybeSingle(),
      supabase.from('goods_receipt_line_reviews').select('id,document_line_id,accepted,received_quantity,condition,note,goods_receipt_reviews!inner(document_id)').eq('goods_receipt_reviews.document_id', document.id),
    ])
    if (lineResult.error || allocationResult.error) { setError(lineResult.error ? userError(lineResult.error) : allocationResult ? userError(allocationResult.error) : 'โหลดข้อมูลไม่สำเร็จ'); return }
    const supplierNameNext = savedDraft?.supplier_name ?? goodsReviewResult.data?.supplier_name ?? document.vendor_name ?? ''
    const receivingLocationNext = savedDraft?.receiving_location ?? goodsReviewResult.data?.receiving_location ?? ''
    const allocations = allocationResult.data ?? []
    setQuotationStatus(quotationResult.data?.status ?? 'pending')
    setQuotationReason(quotationResult.data?.reason ?? '')
    setQuotationValidUntil(quotationResult.data?.valid_until ?? '')
    setSupplierName(supplierNameNext)
    setReceivingLocation(receivingLocationNext)
    const goodsLineMap = new Map((goodsLineResult.data ?? []).map(item => [item.document_line_id, item]))
    const reviewIds=(goodsLineResult.data??[]).map(item=>item.id)
    const stockAllocationResult=reviewIds.length?await supabase.from('goods_receipt_allocations').select('review_line_id,project_id,site_id,allocation_mode,quantity').in('review_line_id',reviewIds):{data:[],error:null}
    if(stockAllocationResult.error){setError(userError(stockAllocationResult.error));return}
    const documentLineByReviewId=new Map((goodsLineResult.data??[]).map(item=>[item.id,item.document_line_id]))
    const savedStockAllocations=new Map<string,StockAllocation[]>()
    for(const allocation of stockAllocationResult.data??[]){const lineId=documentLineByReviewId.get(allocation.review_line_id);if(!lineId)continue;const list=savedStockAllocations.get(lineId)??[];list.push({project_id:allocation.project_id??'',site_id:allocation.site_id??'',quantity:Number(allocation.quantity),mode:allocation.allocation_mode as StockMode});savedStockAllocations.set(lineId,list)}
    const databaseStockReview = Object.fromEntries((lineResult.data ?? []).map(line => {
      const saved = goodsLineMap.get(line.id)
      const quantity = Number(saved?.received_quantity ?? line.quantity ?? 0)
      const storedAllocations=savedStockAllocations.get(line.id)
      return [line.id, { accepted: saved?.accepted ?? true, received_quantity: quantity, condition: (saved?.condition ?? 'good') as StockReviewLine['condition'], note: saved?.note ?? '', allocations: storedAllocations?.length?storedAllocations:[{ project_id: document.project_id ?? '', site_id: document.site_id ?? '', quantity, mode: document.project_id ? 'project_stock' : 'central_stock' }] }]
    })) as Record<string, StockReviewLine>
    const stockReviewNext = Object.fromEntries(Object.entries(databaseStockReview).map(([lineId, fallback]) => {
      const saved = ['pending', 'needs_correction'].includes(document.status) ? savedDraft?.stock_review?.[lineId] : undefined
      return [lineId, saved ? { ...fallback, ...saved, allocations: saved.allocations?.length ? saved.allocations : fallback.allocations } : fallback]
    })) as Record<string, StockReviewLine>
    setStockReview(stockReviewNext)
    setSelectedStockLineIds((lineResult.data ?? []).map(line => line.id))
    const remainingMap = new Map((quotationLineResult.data ?? []).map(item => [item.document_line_id, Number(item.remaining_quantity)]))
    setQuotationQuantities(Object.fromEntries((lineResult.data ?? []).map(line => [line.id, remainingMap.get(line.id) ?? Number(line.quantity ?? 1)])))
    const draftLineMap = new Map((savedDraft?.lines ?? []).map(line => [line.id, line]))
    const nextLines = (lineResult.data ?? []).map(raw => {
      const existing = allocations.filter(item => item.document_line_id === raw.id).map(item => ({
        id: item.id, project_id: item.project_id, site_id: item.site_id ?? '', cost_category_id: item.cost_category_id,
        account_code: item.account_code, account_name: item.account_name, cost_center_code: item.cost_center_code ?? '',
        wbs_code: item.wbs_code ?? '', allocation_percent: Number(item.allocation_percent), allocation_amount: Number(item.allocation_amount),
      }))
      const databaseLine = { ...raw, allocations: existing.length ? existing : [{
        project_id: document.project_id ?? '', site_id: document.site_id ?? '', cost_category_id: raw.cost_category_id ?? '',
        account_code: raw.account_code ?? '', account_name: raw.account_name ?? '', cost_center_code: document.cost_center_code ?? '',
        wbs_code: document.wbs_code ?? '', allocation_percent: 100, allocation_amount: Number(raw.line_amount ?? 0),
      }] } as DocumentLine
      const draftLine = draftLineMap.get(raw.id)
      return draftLine ? { ...databaseLine, ...draftLine, id: raw.id, line_number: raw.line_number, description: raw.description, line_amount: raw.line_amount } : databaseLine
    })
    setLines(nextLines)
    const effectiveDocumentType=savedDraft?.document_type ?? document.document_type
    if (payableDocumentTypes.includes(effectiveDocumentType)) {
      const [receipts, orders] = await Promise.all([
        supabase.from('accounting_documents').select('id,document_number,document_date,vendor_name,total_amount').eq('document_type', 'goods_receipt').eq('status', 'confirmed').order('created_at', { ascending: false }).limit(100),
        supabase.from('purchase_orders').select('id,po_number,vendor_name,subtotal').in('status', ['approved', 'partially_received', 'received']).order('created_at', { ascending: false }).limit(100),
      ])
      setReceiptCandidates((receipts.data ?? []).map(item => ({ id: item.id, label: `${item.document_number ?? 'ใบรับสินค้า'} · ${item.vendor_name ?? 'ไม่ระบุผู้ขาย'} · ${money(item.total_amount)}` })))
      setPoCandidates((orders.data ?? []).map(item => ({ id: item.id, label: `${item.po_number} · ${item.vendor_name} · ${money(item.subtotal)}` })))
      const normalizedVendor=(document.vendor_name??'').trim().toLocaleLowerCase('th-TH')
      const matchingReceipts=(receipts.data??[]).filter(item=>(item.vendor_name??'').trim().toLocaleLowerCase('th-TH')===normalizedVendor)
      if(normalizedVendor&&matchingReceipts.length===1)setMatchedReceiptId(matchingReceipts[0].id)
    } else { setReceiptCandidates([]); setPoCandidates([]) }
    if(effectiveDocumentType==='billing_note'){
      const [deliveryNotes,existingLinks]=await Promise.all([
        supabase.from('accounting_documents').select('id,source_message_id,document_type,document_number,document_date,vendor_name,total_amount').in('document_type',['delivery_note','goods_receipt']).eq('status','confirmed').order('created_at',{ascending:false}).limit(300),
        supabase.from('billing_delivery_note_links').select('billing_document_id,delivery_note_document_id'),
      ])
      if(deliveryNotes.error||existingLinks.error){setError(deliveryNotes.error?userError(deliveryNotes.error):existingLinks.error?userError(existingLinks.error):'โหลดใบส่งของไม่สำเร็จ');return}
      const linkedElsewhere=new Set((existingLinks.data??[]).filter(item=>item.billing_document_id!==document.id).map(item=>item.delivery_note_document_id))
      const availableDocuments=(deliveryNotes.data??[]).filter(item=>!linkedElsewhere.has(item.id))
      setDeliveryNoteCandidates(availableDocuments.map(item=>({id:item.id,sourceMessageId:item.source_message_id,amount:Number(item.total_amount??0),vendorName:item.vendor_name??'',documentType:item.document_type as 'delivery_note'|'goods_receipt',label:`${item.document_type==='goods_receipt'?'ใบรับสินค้า':'ใบส่งของ'} · ${item.document_number??'ไม่มีเลขที่'} · ${item.document_date??'-'} · ${item.vendor_name??'ไม่ระบุผู้ขาย'} · ${money(item.total_amount)}`})))
      const availableIds=availableDocuments.map(item=>item.id)
      if(availableIds.length){
        const receivingLines=await supabase.from('accounting_document_lines').select('id,document_id,description,quantity,unit,line_amount').in('document_id',availableIds).order('line_number')
        if(receivingLines.error){setError(userError(receivingLines.error));return}
        setReceivingComparisonLines((receivingLines.data??[]) as ReceivingComparisonLine[])
      }else setReceivingComparisonLines([])
      setSelectedDeliveryNoteIds((existingLinks.data??[]).filter(item=>item.billing_document_id===document.id).map(item=>item.delivery_note_document_id))
    }else {setDeliveryNoteCandidates([]);setReceivingComparisonLines([])}
    const initialDraftSnapshot = JSON.stringify({
      header: headerNext,
      lines: nextLines,
      document_type: documentTypeNext,
      document_purpose: documentPurposeNext,
      supplier_name: supplierNameNext,
      receiving_location: receivingLocationNext,
      stock_review: stockReviewNext,
    })
      setSavedDraftSnapshot(initialDraftSnapshot)
    setDraftTrackingReady(true)
  }

  const updateHeader = (field: keyof typeof header, value: string) => {
    setHeader(current => ({ ...current, [field]: value, ...(field === 'project_id' ? { site_id: '' } : {}) }))
    if (field === 'project_id') setLines(current => current.map(line => ({ ...line, allocations: line.allocations.map(allocation => ({ ...allocation, project_id: value, site_id: '' })) })))
    if (field === 'cost_center_code' || field === 'wbs_code') setLines(current => current.map(line => ({ ...line, allocations: line.allocations.map(allocation => ({ ...allocation, [field]: value })) })))
  }

  const updateLine = (lineId: string, patch: Partial<DocumentLine>) => setLines(current => current.map(line => line.id === lineId ? { ...line, ...patch } : line))

  const updateProductDetail = (lineId: string, patch: Partial<DocumentLine>) => setLines(current => current.map(line => {
    if (line.id !== lineId) return line
    const next = { ...line, ...patch }
    if (patch.quantity === undefined && patch.unit_price === undefined) return next
    const nextAmount = Number(next.quantity ?? 0) * Number(next.unit_price ?? 0)
    const allocations = next.allocations.map(allocation => ({ ...allocation, allocation_amount: Math.round(nextAmount * Number(allocation.allocation_percent ?? 0)) / 100 }))
    if (allocations.length > 0) {
      const allocatedBeforeLast = allocations.slice(0, -1).reduce((sum, allocation) => sum + allocation.allocation_amount, 0)
      allocations[allocations.length - 1].allocation_amount = Math.round((nextAmount - allocatedBeforeLast) * 100) / 100
    }
    return { ...next, line_amount: Math.round(nextAmount * 100) / 100, allocations }
  }))

  const saveProductName = async (line: DocumentLine) => {
    if(!canManage||!line.description.trim())return
    setSavingLineId(line.id);setError(null)
    try {
      const data = await runAttempt(
        'save_accounting_product_details',
        {
          p_line_id: line.id,
          p_description: line.description.trim(),
          p_quantity: Number(line.quantity ?? 0),
          p_unit: line.unit ?? '',
          p_unit_price: line.unit_price,
          p_item_type: line.item_type,
        },
        () => supabase.rpc('save_accounting_product_details',{
          p_line_id: line.id,p_description:line.description.trim(),p_quantity:Number(line.quantity ?? 0),
          p_unit: line.unit ?? '',p_unit_price: line.unit_price,p_item_type: line.item_type,
        })
      )
      const result = data as { stock_movement_updated?: boolean; will_enter_stock_on_confirmation?: boolean } | null
      setSuccess(`บันทึกชื่อและจำนวน “${line.description.trim()}” แล้ว${result?.stock_movement_updated?' · ปรับยอด Stock แล้ว':result?.will_enter_stock_on_confirmation?' · จะรับเข้า Stock เมื่อยืนยันเอกสาร':' · รายการนี้เป็นต้นทุนตรง จึงไม่เพิ่ม Stock'}`)
      await loadData()
    } catch(error) {
      setError(`บันทึกรายละเอียดสินค้าไม่สำเร็จ: ${userError(error)}`)
    }
    setSavingLineId('')
  }

  const saveQuotationReferenceLine = async (line: DocumentLine) => {
    if (!canManage || !line.description.trim()) return
    setSavingLineId(line.id); setError(null)
    try {
      await runAttempt(
        'save_accounting_product_details',
        {
          p_line_id: line.id, p_description: line.description.trim(), p_quantity: Number(line.quantity ?? 0),
          p_unit: line.unit ?? '', p_unit_price: line.unit_price, p_item_type: 'direct_project',
        },
        () => supabase.rpc('save_accounting_product_details', {
          p_line_id: line.id, p_description: line.description.trim(), p_quantity: Number(line.quantity ?? 0),
          p_unit: line.unit ?? '', p_unit_price: line.unit_price, p_item_type: 'direct_project',
        })
      )
      setSuccess(`บันทึก “${line.description.trim()}” เป็นราคาอ้างอิงแล้ว ยังไม่เข้า Stock และยังไม่เป็นต้นทุน`)
    } catch(error) {
      setError(userError(error))
    }
    setSavingLineId('')
  }

  const savePurchaseVendor = async () => {
    if(!selected||!canManage||!supplierName.trim())return
    setSaving(true);setError(null)
    const savedSupplier=supplierName.trim()
    try {
      await runAttempt('save_purchase_document_vendor',{
        p_document_id:selected.id,
        p_vendor_name:savedSupplier,
      },()=>supabase.rpc('save_purchase_document_vendor',{p_document_id:selected.id,p_vendor_name:savedSupplier}))
      setSelected(current=>current?{...current,vendor_name:savedSupplier}:current)
      setDraftTrackingReady(true)
      try { 
        const previousSnapshot = JSON.parse(savedDraftSnapshot || '{}')
        setSavedDraftSnapshot(JSON.stringify({ ...previousSnapshot, supplier_name: savedSupplier }))
      } catch {
        setSavedDraftSnapshot(currentDraftSnapshot)
      }
      setSuccess(`${registeredVendor?'บันทึกผู้ขาย':'เพิ่มผู้ขายใหม่ในทะเบียน'} “${savedSupplier}” และบันทึก Audit แล้ว`)
      await loadData()
    } catch(error) {
      setError(`บันทึกผู้ขายไม่สำเร็จ: ${userError(error)}`)
    } finally {setSaving(false)}
  }
  const updateAllocation = (lineId: string, index: number, patch: Partial<Allocation>) => setLines(current => current.map(line => line.id !== lineId ? line : {
    ...line, allocations: line.allocations.map((allocation, allocationIndex) => allocationIndex === index ? { ...allocation, ...patch } : allocation),
  }))

  const chooseCategory = (line: DocumentLine, categoryId: string) => {
    const category = categories.find(item => item.id === categoryId)
    updateLine(line.id, {
      cost_category_id: categoryId, account_code: category?.default_account_code ?? '', account_name: category?.default_account_name ?? '',
      allocations: line.allocations.map(allocation => ({ ...allocation, cost_category_id: categoryId, account_code: category?.default_account_code ?? '', account_name: category?.default_account_name ?? '' })),
    })
  }

  const chooseAllocationCategory = (lineId: string, index: number, categoryId: string) => {
    const category = categories.find(item => item.id === categoryId)
    updateAllocation(lineId, index, { cost_category_id: categoryId, account_code: category?.default_account_code ?? '', account_name: category?.default_account_name ?? '' })
  }

  const addAllocation = (line: DocumentLine) => {
    const count = line.allocations.length + 1
    const percent = roundMoney(100 / count)
    const amount = roundMoney(Number(line.line_amount ?? 0) / count)
    const next = [...line.allocations, { ...line.allocations[0], id: undefined, site_id: '', allocation_percent: percent, allocation_amount: amount }]
      .map((allocation, index, all) => ({ ...allocation, allocation_percent: index === all.length - 1 ? roundMoney(100 - percent * (all.length - 1)) : percent, allocation_amount: index === all.length - 1 ? roundMoney(Number(line.line_amount ?? 0) - amount * (all.length - 1)) : amount }))
    updateLine(line.id, { allocations: next })
  }

  const updateStockAllocation = (lineId: string, index: number, patch: Partial<StockAllocation>) => setStockReview(current => {
    const review = current[lineId]; if (!review) return current
    return { ...current, [lineId]: { ...review, allocations: review.allocations.map((allocation, allocationIndex) => allocationIndex === index ? { ...allocation, ...patch } : allocation) } }
  })
  const addStockAllocation = (lineId: string) => setStockReview(current => {
    const review = current[lineId]; if (!review) return current
    const allocated = review.allocations.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
    return { ...current, [lineId]: { ...review, allocations: [...review.allocations, { project_id: header.project_id, site_id: header.site_id, quantity: Math.max(0, review.received_quantity - allocated), mode: bulkStockMode }] } }
  })
  const applyStockDefaults = () => setStockReview(current => Object.fromEntries(Object.entries(current).map(([lineId, review]) => {
    if (!selectedStockLineIds.includes(lineId)) return [lineId, review]
    return [lineId, { ...review, accepted: true, allocations: [{ project_id: bulkStockMode === 'central_stock' ? '' : header.project_id, site_id: bulkStockMode === 'central_stock' ? '' : header.site_id, quantity: review.received_quantity, mode: bulkStockMode }] }]
  })))

  const applyAccountingDefaults = () => {
    const category=categories.find(item=>item.id===bulkCostCategoryId)
    setLines(current=>current.map(line=>!selectedStockLineIds.includes(line.id)?line:{
      ...line,
      item_type:bulkItemType,
      ...(category?{cost_category_id:category.id,account_code:category.default_account_code,account_name:category.default_account_name}:{}),
      allocations:line.allocations.map(allocation=>({...allocation,project_id:header.project_id,site_id:header.site_id,...(category?{cost_category_id:category.id,account_code:category.default_account_code??'',account_name:category.default_account_name??''}:{})})),
    }))
  }
  const stockAllocationErrors = useMemo(() => lines.flatMap(line => {
    const review = stockReview[line.id]; if (!review?.accepted) return []
    const allocated = review.allocations.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
    const errors: string[] = []
    if (Math.abs(allocated - review.received_quantity) > 0.001) errors.push(`รายการ ${line.line_number}: จัดสรร ${allocated} ไม่เท่าจำนวนรับ ${review.received_quantity}`)
    if (review.allocations.some(item => item.mode !== 'central_stock' && !item.project_id)) errors.push(`รายการ ${line.line_number}: ยังไม่ระบุโครงการ`)
    return errors
  }), [lines, stockReview])

  const validationErrors = useMemo(() => {
    const messages: string[] = []
    if (!header.project_id) messages.push('กรุณาเลือกโครงการหลัก')
    lines.forEach(line => {
      if (line.item_type === 'unknown') messages.push(`รายการ ${line.line_number}: ยังไม่จำแนกการนำไปใช้`)
      if (!line.cost_category_id || !line.account_code) messages.push(`รายการ ${line.line_number}: ยังไม่ระบุหมวดต้นทุนหรือรหัสบัญชี`)
      if (!line.allocations.length || line.allocations.some(item => !item.project_id || !item.cost_category_id || !item.account_code)) messages.push(`รายการ ${line.line_number}: ข้อมูลแบ่งโครงการไม่ครบ`)
      const amount = line.allocations.reduce((sum, item) => sum + Number(item.allocation_amount || 0), 0)
      const percent = line.allocations.reduce((sum, item) => sum + Number(item.allocation_percent || 0), 0)
      if (Math.abs(amount - Number(line.line_amount ?? 0)) > 0.01) messages.push(`รายการ ${line.line_number}: ยอดแบ่ง ${money(amount)} ไม่เท่ากับ ${money(line.line_amount)}`)
      if (Math.abs(percent - 100) > 0.01) messages.push(`รายการ ${line.line_number}: สัดส่วนรวม ${percent}% ไม่เท่ากับ 100%`)
    })
    return messages
  }, [header.project_id, lines])

  const isUtilityInvoice = payableDocumentTypes.includes(documentType)
    && lines.some(line => /(ค่า\s*ไฟ|ไฟฟ้า|ค่า\s*น้ำ|ประปา|electric|water\s*bill|utility)/i.test(line.description))
    && lines.every(line => !['stock', 'direct_project', 'tool_asset'].includes(line.item_type))
  const normalizedBillingVendor=supplierName.replace(/\s+/g,'').toLocaleLowerCase('th-TH')
  const billingDeliveryOptions=deliveryNoteCandidates.filter(item=>!normalizedBillingVendor||normalizedBillingVendor.includes('อ่านชื่อไม่ได้')||item.vendorName.replace(/\s+/g,'').toLocaleLowerCase('th-TH')===normalizedBillingVendor)
  const billingSelectedTotal=deliveryNoteCandidates.filter(item=>selectedDeliveryNoteIds.includes(item.id)).reduce((sum,item)=>sum+item.amount,0)
  const billingVariance=Number(selected?.total_amount??0)-billingSelectedTotal
  const billingComparisonRows=useMemo(()=>{
    const normalize=(value:string)=>value.replace(/\s+/g,'').toLocaleLowerCase('th-TH')
    const selectedReceivingLines=receivingComparisonLines.filter(item=>selectedDeliveryNoteIds.includes(item.document_id))
    return lines.map(line=>{
      const matches=selectedReceivingLines.filter(item=>normalize(item.description)===normalize(line.description))
      const receivedQuantity=matches.reduce((sum,item)=>sum+Number(item.quantity??0),0)
      const receivedAmount=matches.reduce((sum,item)=>sum+Number(item.line_amount??0),0)
      const billedQuantity=Number(line.quantity??0)
      const quantityDifference=receivedQuantity-billedQuantity
      return {id:line.id,description:line.description,unit:line.unit,billedQuantity,receivedQuantity,quantityDifference,billedAmount:Number(line.line_amount??0),receivedAmount,status:matches.length===0?'not_found':Math.abs(quantityDifference)<=.001?'matched':'different'}
    })
  },[lines,receivingComparisonLines,selectedDeliveryNoteIds])
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const currentDraftSnapshot=useMemo(()=>JSON.stringify({header,lines,document_type:documentType,document_purpose:documentPurpose,supplier_name:supplierName,receiving_location:receivingLocation,stock_review:stockReview}),[header,lines,documentType,documentPurpose,supplierName,receivingLocation,stockReview])
  const hasUnsavedDraftChanges = draftTrackingReady && selected !== null && lines.length > 0 && currentDraftSnapshot !== savedDraftSnapshot
  const normalizedSupplierName=supplierName.trim().toLocaleLowerCase('th-TH')
  const registeredVendor=vendors.find(vendor=>vendor.name.trim().toLocaleLowerCase('th-TH')===normalizedSupplierName)
  const supplierChanged=selected?supplierName.trim()!==(selected.vendor_name??'').trim():false
  const classificationChanged=selected?(documentType!==selected.document_type||documentPurpose!==(selected.document_purpose??'other')):false

  const saveClassification = async (confirmAfterSave = false) => {
    if (!selected || !canManage || validationErrors.length) return
    setSaving(true); setError(null); setSuccess(null)
    const payload = lines.map(line => ({
      line_id: line.id, item_type: line.item_type, cost_category_id: line.cost_category_id,
      account_code: line.account_code, account_name: line.account_name,
      allocations: line.allocations,
    }))
    let failureStage = 'ขั้นตอนบันทึกประเภทเอกสาร'
    try {
      await runAttempt('classify_accounting_document',{
        p_document_id: selected.id, p_document_type: documentType,
        p_document_purpose: documentPurpose, p_apply_to_similar: applyToSimilar,
      },()=>supabase.rpc('classify_accounting_document', {
        p_document_id: selected.id, p_document_type: documentType,
        p_document_purpose: documentPurpose, p_apply_to_similar: applyToSimilar,
      }))
      failureStage = 'ขั้นตอนบันทึกโครงการ หมวดต้นทุน หรือบัญชี'
      await runAttempt('save_accounting_document_classification',{
        p_document_id: selected.id, p_header: header, p_lines: payload,
      },()=>supabase.rpc('save_accounting_document_classification', {
        p_document_id: selected.id, p_header: header, p_lines: payload,
      }))
      if (confirmAfterSave) {
        failureStage = 'ขั้นตอนยืนยันและสร้างรายการบัญชี'
        await runAttempt('confirm_accounting_document',{
          p_document_id: selected.id,
        },()=>supabase.rpc('confirm_accounting_document', { p_document_id: selected.id }))
        await runAttempt('clear_accounting_document_review_draft', { p_document_id: selected.id }, () =>
          supabase.rpc('clear_accounting_document_review_draft', { p_document_id: selected.id }))
        setSuccess('ยืนยันเอกสารและสร้างรายการบัญชีแยกตามโครงการเรียบร้อยแล้ว'); setSelected(null); await loadData()
      } else setSuccess('บันทึกโครงการ หมวดต้นทุน และการแบ่งยอดเรียบร้อยแล้ว')
    } catch (error) {
      setError(`${failureStage}: ${userError(error)}`)
    } finally { setSaving(false) }
  }

  const persistCurrentDocumentType = async () => {
    if (!selected || !canManage) return false
    if (selected.status === 'confirmed' && documentType === selected.document_type && documentPurpose === selected.document_purpose) return true
    try {
      const result = selected.status === 'confirmed'
        ? await runAttempt('correct_confirmed_accounting_document_type',{
          p_document_id: selected.id, p_document_type: documentType, p_document_purpose: documentPurpose, p_reason: 'saved_from_accounting_documents_ui',
        },()=>supabase.rpc('correct_confirmed_accounting_document_type', {
          p_document_id: selected.id, p_document_type: documentType,
          p_document_purpose: documentPurpose, p_reason: 'saved_from_accounting_documents_ui',
        }))
        : await runAttempt('classify_accounting_document',{
          p_document_id: selected.id, p_document_type: documentType, p_document_purpose: documentPurpose, p_apply_to_similar: applyToSimilar,
        },()=>supabase.rpc('classify_accounting_document', {
          p_document_id: selected.id, p_document_type: documentType,
          p_document_purpose: documentPurpose, p_apply_to_similar: applyToSimilar,
        }))
      if (result) setSelected(current => current ? { ...current, document_type: documentType, document_purpose: documentPurpose, classification_source: 'human' } : current)
      return true
    } catch (error) {
      const rawDocumentTypeError = typeof (error as { message?: unknown })?.message === 'string' ? ((error as { message?: string }).message ?? '') : ''
      if (rawDocumentTypeError.includes('confirmed_document_type_is_locked')) {
        setSelected(current => current ? { ...current, status: 'confirmed' } : current)
        setError('เอกสารนี้ยืนยันเรียบร้อยแล้ว ไม่ต้องบันทึกประเภทซ้ำ กรุณารีเฟรชหากสถานะยังไม่เปลี่ยน')
        await loadData()
      } else setError(`บันทึกประเภทเอกสารไม่สำเร็จ: ${userError(error)}`)
      return false
    }
  }

  const persistDocumentProject = async () => {
    if (!selected || !canManage) return false
    try {
      await runAttempt('save_accounting_document_project', {
        p_document_id:selected.id,
        p_project_id:header.project_id||null,
        p_site_id:header.site_id||null,
      },()=>supabase.rpc('save_accounting_document_project', { p_document_id:selected.id,p_project_id:header.project_id||null,p_site_id:header.site_id||null }))
      setSelected(current=>current?{...current,project_id:header.project_id||null,site_id:header.site_id||null}:current)
      return true
    } catch (error) {
      setError(`บันทึกโครงการไม่สำเร็จ: ${userError(error)}`)
      return false
    }
  }

  const savePartialDraft = async () => {
    if (!selected || !canManage) return
    setSaving(true); setError(null)
    if (!await persistCurrentDocumentType()) { setSaving(false); return }
    try {
      await runAttempt('save_accounting_document_review_draft', {
        p_document_id: selected.id,
        p_draft: { header, lines, document_type: documentType, document_purpose: documentPurpose, supplier_name: supplierName, receiving_location: receivingLocation, stock_review: stockReview },
      }, () => supabase.rpc('save_accounting_document_review_draft', {
        p_document_id: selected.id,
        p_draft: { header, lines, document_type: documentType, document_purpose: documentPurpose, supplier_name: supplierName, receiving_location: receivingLocation, stock_review: stockReview },
      }))
      if (selected) {
        setSuccess(`บันทึกร่างและประเภท “${documentLabels[documentType] ?? documentType}” ลงฐานข้อมูลเรียบร้อยแล้ว สามารถกลับมาแก้ไขต่อภายหลังได้`)
        setSelected(current => current ? { ...current, document_type: documentType, document_purpose: documentPurpose, review_draft: { header, lines, document_type: documentType, document_purpose: documentPurpose, supplier_name: supplierName, receiving_location: receivingLocation, stock_review: stockReview } } : current)
        setSavedDraftSnapshot(currentDraftSnapshot)
        setDraftTrackingReady(true)
        await loadData()
      }
    } catch (error) {
      setError(userError(error))
    }
    setSaving(false)
  }

  const processQuotation = async () => {
    if (!selected || !canManage) return
    if (!header.project_id) {
      setError('กรุณาเลือกโครงการของใบเสนอราคา (ยอดนี้เป็นราคาอ้างอิงและยังไม่ลงต้นทุน)'); return
    }
    const selectedLines = lines
      .map(line => ({ line_id: line.id, quantity: Number(quotationQuantities[line.id] ?? line.quantity ?? 1) }))
      .filter(line => quotationAction === 'order_full' || (selectedStockLineIds.includes(line.line_id) && line.quantity > 0))
    if (['order_full', 'order_partial'].includes(quotationAction) && !selectedLines.length) {
      setError('กรุณาเลือกอย่างน้อยหนึ่งรายการและระบุจำนวนที่สั่ง'); return
    }
    setSaving(true); setError(null)
    if (!await persistCurrentDocumentType()) { setSaving(false); return }
    if (!await persistDocumentProject()) { setSaving(false); return }
    try {
      await Promise.all(
        lines.map(line =>
          runAttempt(
            'save_accounting_product_details',
            {
              p_line_id: line.id, p_description: line.description.trim(), p_quantity: Number(line.quantity ?? 0),
              p_unit: line.unit ?? '', p_unit_price: line.unit_price, p_item_type: 'direct_project',
            },
            () =>
              supabase.rpc('save_accounting_product_details', {
                p_line_id: line.id, p_description: line.description.trim(), p_quantity: Number(line.quantity ?? 0),
                p_unit: line.unit ?? '', p_unit_price: line.unit_price, p_item_type: 'direct_project',
              })
          )
        )
      )
      const data = await runAttempt('process_quotation_decision_with_project', {
        p_document_id: selected.id, p_action: quotationAction, p_lines: selectedLines,
        p_reason: quotationReason || null, p_valid_until: quotationValidUntil || null,
        p_project_id: header.project_id || null,
      }, () => supabase.rpc('process_quotation_decision_with_project', {
        p_document_id: selected.id, p_action: quotationAction, p_lines: selectedLines,
        p_reason: quotationReason || null, p_valid_until: quotationValidUntil || null,
        p_project_id: header.project_id || null,
      }))
      const result = data as { status?: string; purchase_order_number?: string | null; ordered_total?: number }
      setQuotationStatus(result.status ?? quotationAction)
      setSuccess(result.purchase_order_number
        ? `สร้างใบสั่งซื้อ ${result.purchase_order_number} ยอด ${money(result.ordered_total)} เรียบร้อยแล้ว`
        : 'บันทึกการตัดสินใจและราคาอ้างอิงเรียบร้อยแล้ว')
      const confirmedQuotation = { ...selected, status: 'confirmed' as DocumentStatus, posting_status: 'not_posted', project_id: header.project_id || selected.project_id }
      await loadData()
      await openDocument(confirmedQuotation)
    } catch (error) {
      setError(`บันทึกการตัดสินใจใบเสนอราคาไม่สำเร็จ: ${userError(error)}`)
    }
    setSaving(false)
  }

  const confirmGoodsReceipt = async () => {
    if (!selected || !canManage) return
    if (!supplierName.trim()) { setError('กรุณาระบุชื่อบริษัท/ผู้ส่งสินค้า'); return }
    if (!receivingLocation.trim()) { setError('กรุณาระบุคลัง/จุดรับสินค้า'); return }
    if (stockAllocationErrors.length) { setError(stockAllocationErrors[0]); return }
    const receiptLines = lines.map(line => ({ line_id: line.id, ...stockReview[line.id] }))
    if (!receiptLines.some(line => line.accepted && Number(line.received_quantity) > 0)) { setError('กรุณาเลือกรายการรับเข้า Stock อย่างน้อยหนึ่งรายการ'); return }
    setSaving(true); setError(null)
    if (!await persistCurrentDocumentType()) { setSaving(false); return }
    if (!await persistDocumentProject()) { setSaving(false); return }
    try {
      const data = await runAttempt('confirm_goods_receipt_stock', {
        p_document_id: selected.id, p_supplier_name: supplierName.trim(),
        p_receiving_location: receivingLocation.trim() || null, p_lines: receiptLines,
      }, () => supabase.rpc('confirm_goods_receipt_stock', {
        p_document_id: selected.id, p_supplier_name: supplierName.trim(),
        p_receiving_location: receivingLocation.trim() || null, p_lines: receiptLines,
      }))
      const result = data as { received_line_count?: number }
      await runAttempt('create_goods_receipt_grni', { p_document_id: selected.id }, () => supabase.rpc('create_goods_receipt_grni', { p_document_id: selected.id }))
      setSuccess(`ยืนยันรับสินค้าเข้า Stock ${result.received_line_count ?? 0} รายการ และสร้างรายการพักเจ้าหนี้ (GRNI) แล้ว`)
      setSelected(null); await loadData()
    } catch (error) {
      setError(`ยืนยันรับสินค้าไม่สำเร็จ: ${userError(error)}`)
    }
    setSaving(false)
  }

  const saveConfirmedReceiptPrices = async () => {
    if (!selected || !canManage || selected.status !== 'confirmed' || documentType !== 'goods_receipt') return
    const pricedLines = lines.map(line => ({ line_id: line.id, unit_price: line.unit_price }))
    if (pricedLines.some(line => line.unit_price == null || Number(line.unit_price) < 0)) {
      setError('กรุณาระบุราคาซื้อจริงต่อหน่วยให้ครบทุกรายการที่รับ'); return
    }
    setSaving(true); setError(null)
    try {
      const data = await runAttempt('save_confirmed_goods_receipt_prices',{
        p_document_id:selected.id,p_lines:pricedLines,
      },()=>supabase.rpc('save_confirmed_goods_receipt_prices',{p_document_id:selected.id,p_lines:pricedLines}))
      const result = data as { updated_count?: number }
      setSuccess(`บันทึกราคาซื้อจริง ${result.updated_count ?? 0} รายการ และอัปเดตประวัติราคาสินค้าแล้ว`)
      await openDocument(selected); await loadData()
    } catch (error) {
      setError(`บันทึกราคาซื้อจริงไม่สำเร็จ: ${userError(error)}`)
    }
    setSaving(false)
  }

  const confirmMatchedInvoice = async () => {
    if (!selected || !canManage || !matchedReceiptId) return
    if (!supplierName.trim()) { setError('กรุณาระบุเจ้าหนี้/ผู้ขาย'); return }
    if (approveMatchException && !matchExceptionReason.trim()) { setError('กรุณาระบุเหตุผลอนุมัติส่วนต่าง'); return }
    setSaving(true); setError(null)
    if (!await persistCurrentDocumentType()) { setSaving(false); return }
    try {
      await runAttempt('save_supplier_invoice_creditor', {
        p_document_id: selected.id, p_creditor_name: supplierName.trim(),
      }, ()=>supabase.rpc('save_supplier_invoice_creditor',{p_document_id:selected.id,p_creditor_name:supplierName.trim()}))
      const data = await runAttempt('match_invoice_and_create_ap',{
        p_invoice_document_id: selected.id, p_goods_receipt_document_id: matchedReceiptId,
        p_purchase_order_id: matchedPoId || null, p_approve_exception: approveMatchException,
        p_exception_reason: matchExceptionReason.trim() || null,
      },()=>supabase.rpc('match_invoice_and_create_ap', {
        p_invoice_document_id: selected.id, p_goods_receipt_document_id: matchedReceiptId,
        p_purchase_order_id: matchedPoId || null, p_approve_exception: approveMatchException,
        p_exception_reason: matchExceptionReason.trim() || null,
      }))
      const result = data as { status?: string; variance_amount?: number; ap_created?: boolean }
      if (!result.ap_created) setError(`ยอดไม่ตรงกัน ส่วนต่าง ${money(result.variance_amount)} — ยังไม่สร้างเจ้าหนี้ กรุณาตรวจสอบหรืออนุมัติส่วนต่าง`)
      else { setSuccess(`จับคู่เอกสารสำเร็จและสร้างเจ้าหนี้แล้ว${result.status === 'approved_exception' ? ` (อนุมัติส่วนต่าง ${money(result.variance_amount)})` : ''}`); setSelected(null); await loadData() }
    } catch (error) {
      setError(`บันทึกเจ้าหนี้ไม่สำเร็จ: ${userError(error)}`)
    }
    setSaving(false)
  }

  const confirmUtilityInvoice = async () => {
    if (!selected || !canManage) return
    if (!supplierName.trim()) { setError('กรุณาระบุเจ้าหนี้/ผู้ให้บริการ'); return }
    if (validationErrors.length) { setError(validationErrors[0]); return }
    setSaving(true); setError(null)
    const payload = lines.map(line => ({ line_id: line.id, item_type: line.item_type, cost_category_id: line.cost_category_id, account_code: line.account_code, account_name: line.account_name, allocations: line.allocations }))
    try {
      await runAttempt('classify_accounting_document', {
        p_document_id: selected.id, p_document_type: documentType, p_document_purpose: documentPurpose, p_apply_to_similar: applyToSimilar,
      },()=>supabase.rpc('classify_accounting_document', { p_document_id: selected.id, p_document_type: documentType, p_document_purpose: documentPurpose, p_apply_to_similar: applyToSimilar }))
      await runAttempt('save_accounting_document_classification', { p_document_id: selected.id, p_header: header, p_lines: payload }, ()=>supabase.rpc('save_accounting_document_classification', { p_document_id: selected.id, p_header: header, p_lines: payload }))
      await runAttempt('save_supplier_invoice_creditor',{p_document_id:selected.id,p_creditor_name:supplierName.trim()},()=>supabase.rpc('save_supplier_invoice_creditor',{p_document_id:selected.id,p_creditor_name:supplierName.trim()}))
      await runAttempt('create_utility_invoice_ap',{p_document_id:selected.id},()=>supabase.rpc('create_utility_invoice_ap', { p_document_id: selected.id }))
      await runAttempt('clear_accounting_document_review_draft', { p_document_id: selected.id }, () => supabase.rpc('clear_accounting_document_review_draft', { p_document_id: selected.id }))
      setSuccess('สร้างเจ้าหนี้ค่าสาธารณูปโภคและลงค่าใช้จ่ายตามโครงการแล้ว โดยไม่ผ่านใบรับสินค้า')
      setSelected(null); await loadData()
    } catch (error) {
      setError(`บันทึกเจ้าหนี้ไม่สำเร็จ: ${userError(error)}`)
    }
    setSaving(false)
  }

  const confirmBillingDeliveryNotes = async () => {
    if(!selected||!canManage)return
    if(!supplierName.trim()){setError('กรุณาระบุผู้ขาย/เจ้าหนี้ของใบวางบิล');return}
    if(!selectedDeliveryNoteIds.length){setError('กรุณาเลือกใบส่งของอย่างน้อย 1 ใบ');return}
    setSaving(true);setError(null)
    if(!await persistCurrentDocumentType()){setSaving(false);return}
    try {
      if(!await persistCurrentDocumentType()){setSaving(false);return}
      if(!await persistDocumentProject()){setSaving(false);return}
      await runAttempt('save_supplier_invoice_creditor',{p_document_id:selected.id,p_creditor_name:supplierName.trim()},()=>supabase.rpc('save_supplier_invoice_creditor',{p_document_id:selected.id,p_creditor_name:supplierName.trim()}))
      const data = await runAttempt('confirm_billing_note_delivery_notes',{p_billing_document_id:selected.id,p_delivery_note_ids:selectedDeliveryNoteIds},()=>supabase.rpc('confirm_billing_note_delivery_notes',{p_billing_document_id:selected.id,p_delivery_note_ids:selectedDeliveryNoteIds}))
      const result = data as {delivery_note_count?:number;delivery_note_total?:number;variance?:number;matched_line_count?:number;unmatched_line_count?:number}
      setSuccess(`ยืนยันใบวางบิลและจับคู่เอกสารรับ ${result.delivery_note_count ?? selectedDeliveryNoteIds.length} ใบ ยอดรวม ${money(result.delivery_note_total)}${Math.abs(Number(result.variance ?? 0))>.01?` · ส่วนต่าง ${money(result.variance)}`:' · ยอดตรงกัน'} · รายการตรง ${result.matched_line_count ?? 0} รายการ${Number(result.unmatched_line_count ?? 0)>0?` ไม่ตรง ${result.unmatched_line_count} รายการ`:''}`)
      setSelected(null);await loadData()
    } catch (error) {
      setError(`บันทึกเจ้าหนี้ไม่สำเร็จ: ${userError(error)}`)
    }
    setSaving(false)
  }

  const openStockOperation = (row: ProjectInventoryBalance) => {
    setOperationStock(row); setOperationType('issue'); setOperationQuantity(0); setOperationTargetProject(''); setOperationTargetLocation(''); setOperationReason(''); setError(null)
  }
  const submitStockOperation = async () => {
    if (!operationStock || operationQuantity <= 0 || !operationReason.trim()) return
    if (operationType === 'transfer' && (!operationTargetProject || !operationTargetLocation)) { setError('กรุณาระบุโครงการและคลังปลายทาง'); return }
    setSaving(true); setError(null)
    try {
      await runAttempt('process_project_stock_operation', {
        p_operation_type: operationType,p_inventory_item_id: operationStock.inventory_item_id,p_from_project_id: operationStock.project_id,
        p_from_location_id: operationStock.location_id,p_quantity: operationQuantity,p_to_project_id: operationType === 'transfer' ? operationTargetProject : null,
        p_to_location_id: operationType === 'transfer' ? operationTargetLocation : null,p_reason: operationReason.trim(),
      }, ()=>supabase.rpc('process_project_stock_operation', {
        p_operation_type: operationType,p_inventory_item_id: operationStock.inventory_item_id,p_from_project_id: operationStock.project_id,
        p_from_location_id: operationStock.location_id,p_quantity: operationQuantity,p_to_project_id: operationType === 'transfer' ? operationTargetProject : null,
        p_to_location_id: operationType === 'transfer' ? operationTargetLocation : null,p_reason: operationReason.trim(),
      }))
      setSuccess(operationType === 'transfer' ? 'โอน Stock เรียบร้อยแล้ว' : operationType === 'waste' ? 'ตัดของเสียเรียบร้อยแล้ว' : 'เบิกวัสดุเป็นต้นทุนโครงการเรียบร้อยแล้ว'); setOperationStock(null); await loadData()
    } catch (error) {
      setError(userError(error))
    }
    setSaving(false)
  }

  const suggestedProductSplit = (line: DocumentLine): ProductSplitItem[] => {
    const originalDescription=line.split_original_description??line.description
    const originalQuantity=Number(line.split_original_quantity??line.quantity??0)
    const allocation=stockReview[line.id]?.allocations[0]
    const destination={mode:allocation?.mode??'project_stock' as StockMode,project_id:allocation?.project_id??header.project_id,site_id:allocation?.site_id??header.site_id}
    if (/THW\s*#?\s*1x4\s*sq\.mm\.\s*YAZAKI/i.test(originalDescription) && Math.abs(originalQuantity-12)<.001) {
      const base=originalDescription.replace(/\s+(?:ฟ้า|น้ำตาล|ดำ|เขียว|เทา)(?:\s*,\s*(?:ฟ้า|น้ำตาล|ดำ|เขียว|เทา))*\s*$/,'').trim()
      return [{description:`${base} ฟ้า`,quantity:6,...destination},{description:`${base} น้ำตาล`,quantity:2,...destination},{description:`${base} ดำ`,quantity:2,...destination},{description:`${base} เทา`,quantity:2,...destination}]
    }
    const colorMatch=originalDescription.match(/^(.*?)(?:\s+)(ฟ้า|น้ำตาล|ดำ|เขียว|เทา)(?:\s*,\s*(.+))$/)
    const colors=colorMatch?[colorMatch[2],...colorMatch[3].split(',').map(value=>value.trim())]:[]
    return colors.length>1?colors.map((color,index)=>({description:`${colorMatch![1].trim()} ${color}`,quantity:index===0?originalQuantity:0,...destination})):[{description:originalDescription,quantity:originalQuantity,...destination},{description:'',quantity:0,...destination}]
  }
  const openProductSplit = (line: DocumentLine) => {
    setSplitLine(line)
    setSplitItems(suggestedProductSplit(line))
    setError(null)
  }
  const submitProductSplit = async () => {
    if(!splitLine)return
    const originalQuantity=Number(splitLine.split_original_quantity??splitLine.quantity??0)
    const splitTotal=splitItems.reduce((sum,item)=>sum+Number(item.quantity||0),0)
    if(splitItems.length<2||splitItems.some(item=>!item.description.trim()||item.quantity<=0||(item.mode!=='central_stock'&&!item.project_id))||Math.abs(splitTotal-originalQuantity)>.001){setError(`กรุณาระบุรายการ จำนวน และโครงการให้ครบ โดยยอดรวมต้องเท่ากับ ${originalQuantity} ${splitLine.unit??''}`);return}
    setSaving(true);setError(null)
    const splitPayload=splitItems.map(item=>({...item,description:item.description.trim()}))
    const splitRpc=selected?.status==='confirmed'?'reclassify_confirmed_receipt_stock_line_standard':'split_accounting_document_line'
    try {
      await runAttempt(splitRpc,{
        p_line_id: splitLine.id,
        p_items: splitPayload,
      },()=>supabase.rpc(splitRpc,{p_line_id:splitLine.id,p_items:splitPayload}))
      if (selected) {
        setSuccess(`แยกรายการ Stock ${splitItems.length} รายการ รวม ${splitTotal} ${splitLine.unit ?? ''} โดยยอดรวมไม่เปลี่ยน`)
        setSplitLine(null)
        await openDocument(selected)
        await loadData()
      }
    } catch (error) {
      setError(userError(error))
    }
    setSaving(false)
  }

  const saveDocumentType = async () => {
    if (!selected || !canManage) return
    setSaving(true); setError(null)
    if (await persistCurrentDocumentType()) {
      setDraftTrackingReady(true)
      try {
        const previousSnapshot = JSON.parse(savedDraftSnapshot || '{}')
        setSavedDraftSnapshot(JSON.stringify({ ...previousSnapshot, document_type: documentType, document_purpose: documentPurpose }))
      } catch {
        setSavedDraftSnapshot(currentDraftSnapshot)
      }
      setSuccess(`บันทึกประเภท “${documentLabels[documentType] ?? documentType}” ลงฐานข้อมูลแล้ว`)
      await loadData()
    }
    setSaving(false)
  }

  const viewDocumentAttachment = async (sourceMessageId: string) => {
    setPreviewLoading(true); setError(null)
    const { data: attachment, error: attachmentError } = await supabase.from('line_attachments')
      .select('storage_bucket,storage_path,content_type').eq('message_id', sourceMessageId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (attachmentError) setError(userError(attachmentError))
    else if (!attachment) setError('ไม่พบไฟล์ภาพต้นฉบับของเอกสารนี้')
    else {
      const { data: signed, error: signedError } = await supabase.storage.from(attachment.storage_bucket).createSignedUrl(attachment.storage_path, 600)
      if (signedError) setError(userError(signedError))
      else setPreview({ url: signed.signedUrl, contentType: attachment.content_type ?? 'image/jpeg' })
    }
    setPreviewLoading(false)
  }

  const viewOriginalDocument = async () => {
    if (!selected) return
    await viewDocumentAttachment(selected.source_message_id)
  }

  const mergeCurrentDocumentSet = async () => {
    if(!selected||!canManage||documentSetMembers.length<2)return
    setSaving(true);setError(null);setSuccess(null)
    try {
      const data = await runAttempt('merge_accounting_document_set',{p_primary_document_id:selected.id},()=>supabase.rpc('merge_accounting_document_set',{p_primary_document_id:selected.id}))
      const pageCount = Number((data as { page_count?: number } | null)?.page_count ?? documentSetMembers.length)
      await loadData()
      await openDocument({ ...selected, status: 'needs_correction' })
      setSuccess(`รวมเป็นเอกสารชุดเดียว ${pageCount} หน้าแล้ว กรุณาตรวจประเภท ผู้ขาย รายการ และยอดรวมก่อนยืนยัน`)
    } catch (error) {
      setError(`ขั้นตอนรวมชุดเอกสาร: ${userError(error)}`)
    }
    setSaving(false)
  }

  const detachCurrentDocumentFromSet = async () => {
    if(!selected||!canManage||documentSetMembers.length<2)return
    setSaving(true);setError(null);setSuccess(null)
    try {
      await runAttempt('detach_accounting_document_from_set', { p_document_id: selected.id }, () =>
        supabase.rpc('detach_accounting_document_from_set', { p_document_id: selected.id })
      )
      setSelected(null);setSuccess('แยกภาพออกเป็นเอกสารคนละชุดแล้ว');await loadData()
    } catch (error) {
      setError(`ขั้นตอนแยกหน้าเอกสาร: ${userError(error)}`)
    }
    setSaving(false)
  }

  const dismissDocument = async () => {
    if (!selected || !canManage) return
    setSaving(true)
    try {
      await runAttempt('dismiss_accounting_document', { target_document_id: selected.id }, () =>
        supabase.from('accounting_documents').update({ status: 'dismissed', updated_at: new Date().toISOString() }).eq('id', selected.id),
      )
      setSelected(null); await loadData()
    } catch (error) {
      setError(userError(error))
    }
    setSaving(false)
  }

  const slipCounts = useMemo(() => transferSlipQueueCounts(pendingSlips), [pendingSlips])
  const visibleSlips = useMemo(() => filterTransferSlipQueue(pendingSlips, slipFilter), [pendingSlips, slipFilter])
  const activeSlipPreview = slipPreviewFiles[slipPreviewIndex] ?? null
  const slipTransferAmount = slipReviewDraft?.amount.trim() ? Number(slipReviewDraft.amount) : null
  const slipAllocationTotal = slipMoneyLineageDraft ? moneyAllocationTotal(slipMoneyLineageDraft.allocations) : 0
  const slipLineageValidation = slipMoneyLineageDraft ? validateMoneyLineage(slipMoneyLineageDraft, slipTransferAmount) : { missing: [], errors: [] }
  const senderAliasError = slipReviewDraft ? paymentAliasValidation({ paymentMethod: slipReviewDraft.senderPaymentMethod, aliasType: slipReviewDraft.senderAliasType, aliasValue: slipReviewDraft.senderAliasValue }) : null
  const recipientAliasError = slipReviewDraft ? paymentAliasValidation({ paymentMethod: slipReviewDraft.recipientPaymentMethod, aliasType: slipReviewDraft.recipientAliasType, aliasValue: slipReviewDraft.recipientAliasValue }) : null
  const slipAnalysis = useMemo(() => selectedSlip ? buildSlipAnalysisGate(selectedSlip, slipMoneyLineageDraft) : null, [selectedSlip, slipMoneyLineageDraft])

  const closeSlipDetail = () => {
    ++slipRequestRef.current
    setSelectedSlip(null)
    setSlipPreviewFiles([])
    setSlipPreviewIndex(0)
    setSlipPreviewMessage('')
    setSlipEvents([])
    setSlipDetailLoading(false)
    setSlipDetailTab(0); setSlipReviewDraft(null); setSlipMoneyLineageDraft(null); setSlipMoneyLineageStatus(null); setMoneyLineageOptions([]); setSlipAiGuidance(''); setSlipAdvancePartyMatch(null); setSlipActionLoading(false)
  }

  const openSlipDetail = async (slip: AccountingPendingSlip) => {
    const requestId = ++slipRequestRef.current
    const suggestion = inferSlipMoneyPurpose(slip)
    const suggestedPurpose = suggestion.purpose
    const suggestedLineage = emptyMoneyLineage(
      slip.confirmedPartyPayerName ?? slip.senderName ?? '',
      slip.confirmedPartyBeneficiaryName ?? slip.recipientName ?? '',
      slip.amount,
      slip.transferAt ? new Date(slip.transferAt).toISOString().slice(0, 16) : '',
    )
    if (suggestedPurpose !== 'unknown') {
      suggestedLineage.purposeType = suggestedPurpose
      suggestedLineage.allocations = suggestedLineage.allocations.map(allocation => ({ ...allocation, purposeType: suggestedPurpose, confidence: String(suggestion.confidence) }))
    }
    setSelectedSlip(slip)
    setSlipDetailTab(0); setSlipReviewDraft(slipDraftFromRow(slip)); setSlipMoneyLineageDraft(suggestedLineage); setSlipMoneyLineageStatus(null); setMoneyLineageOptions([]); setSlipAiGuidance(''); setSlipAdvancePartyMatch(null)
    setSlipPreviewFiles([])
    setSlipPreviewIndex(0)
    setSlipPreviewMessage('กำลังเปิดไฟล์ต้นฉบับ…')
    setSlipEvents([])
    setSlipDetailLoading(true)
    try {
      const [previewResult, timelineResult, lineageResult, lineageOptionsResult, advancePartyResult, paymentPartyResult] = await Promise.all([
        documentFlowGateway.preview(slip.itemId),
        documentFlowGateway.loadTimeline(slip.itemId),
        supabase.from('transfer_slip_money_lineages').select('id,root_lineage_id,parent_lineage_id,funding_source_type,funding_source_reference,fund_holder_name,payer_name,final_beneficiary_name,purpose_type,project_id,site_id,responsible_name,starting_amount,paid_amount,returned_amount,remaining_amount,hops,route_status,next_destination,route_note').eq('item_id', slip.itemId).maybeSingle(),
        supabase.from('transfer_slip_money_lineages').select('id,root_lineage_id,payer_name,final_beneficiary_name,paid_amount,updated_at,route_status').order('updated_at', { ascending: false }).limit(100),
        suggestedPurpose === 'advance_transfer' ? supabase.rpc('resolve_transfer_slip_advance_parties', { target_item_id: slip.itemId, target_event_key: `transfer-slip-advance-party-preview:${slip.itemId}`, target_apply: false }) : Promise.resolve({ data: null, error: null }),
        slip.transactionId ? supabase.from('financial_transaction_party_links').select('party_role,payment_method,canonical_party_type,canonical_party_name,match_status,match_reason,master_payment_aliases(alias_type,masked_value,verification_status)').eq('financial_transaction_id', slip.transactionId) : Promise.resolve({ data: [], error: null }),
      ])
      if (requestId !== slipRequestRef.current) return
      if (timelineResult.error) setError(current => current ?? `โหลด Audit Flow ไม่สำเร็จ: ${userError(timelineResult.error)}`)
      else setSlipEvents((timelineResult.data ?? []) as SlipFlowEvent[])
      if (lineageOptionsResult.error) setError(current => current ?? `โหลดเส้นทางเงินก่อนหน้าไม่สำเร็จ: ${userError(lineageOptionsResult.error)}`)
      else setMoneyLineageOptions(((lineageOptionsResult.data ?? []) as unknown as MoneyLineageOption[]).filter(option => option.id !== (lineageResult.data as { id?: string } | null)?.id))
      if (lineageResult.error) setError(current => current ?? `โหลดเส้นทางเงินไม่สำเร็จ: ${userError(lineageResult.error)}`)
      else if (lineageResult.data) {
        const stored = lineageResult.data as unknown as StoredMoneyLineage
        const [allocationResult, vendorMatchResult] = await Promise.all([
          supabase.from('transfer_slip_money_allocations').select('allocation_key,purpose_type,allocation_amount,cost_category_id,account_code,account_name,project_id,site_id,payee_name,responsible_name,description,confidence,evidence').eq('lineage_id', stored.id).neq('status', 'superseded').order('sequence'),
          supabase.from('transfer_slip_vendor_matches').select('allocation_key,vendor_id,vendor_name,vendor_tax_id,vendor_bank_name,vendor_account_last4,payer_name,match_status,confidence,reason').eq('lineage_id', stored.id),
        ])
        if (requestId !== slipRequestRef.current) return
        if (allocationResult.error) setError(current => current ?? `โหลดการจัดสรรเงินไม่สำเร็จ: ${userError(allocationResult.error)}`)
        if (vendorMatchResult.error && !/relation .* does not exist/i.test(vendorMatchResult.error.message)) setError(current => current ?? `โหลดการจับคู่ผู้ขายไม่สำเร็จ: ${userError(vendorMatchResult.error)}`)
        const allocations = allocationResult.error ? [] : (allocationResult.data ?? []) as unknown as StoredMoneyAllocation[]
        const matches = vendorMatchResult.error ? [] : (vendorMatchResult.data ?? []) as unknown as StoredVendorMatch[]
        const storedDraft = moneyLineageDraftFromStored(stored, allocations, matches)
        setSlipMoneyLineageDraft(applyMoneyFundingSource(storedDraft, storedDraft.fundingSourceType))
        setSlipMoneyLineageStatus({ routeStatus: stored.route_status, nextDestination: stored.next_destination })
      } else if (!advancePartyResult.error && advancePartyResult.data) {
        const raw = advancePartyResult.data as Record<string, unknown>
        const match: AdvancePartyMatch = {
          applicable: raw.applicable === true, ready: raw.ready === true, applied: raw.applied === true,
          blockers: Array.isArray(raw.blockers) ? raw.blockers.map(String) : [],
          holderId: typeof raw.holder_id === 'string' ? raw.holder_id : null,
          holderName: typeof raw.holder_name === 'string' ? raw.holder_name : null,
          recipientProfileId: typeof raw.recipient_profile_id === 'string' ? raw.recipient_profile_id : null,
          recipientName: typeof raw.recipient_name === 'string' ? raw.recipient_name : null,
          senderBankLinked: raw.sender_bank_linked === true, recipientBankLinked: raw.recipient_bank_linked === true,
        }
        setSlipAdvancePartyMatch(match)
        if (match.ready && match.holderName && match.recipientName) {
          setSlipMoneyLineageDraft(current => current && ({ ...current, fundingSourceType: 'reserve_fund', fundHolderName: match.holderName ?? '', payerName: match.holderName ?? current.payerName, finalBeneficiaryName: match.recipientName ?? current.finalBeneficiaryName, responsibleName: match.recipientName ?? current.responsibleName, allocations: current.allocations.map(allocation => ({ ...allocation, payeeName: match.recipientName ?? allocation.payeeName, responsibleName: match.recipientName ?? allocation.responsibleName })) }))
        }
      }
      if (advancePartyResult.error) setError(current => current ?? `ตรวจการเชื่อมผู้ถือเงิน/พนักงานไม่สำเร็จ: ${userError(advancePartyResult.error)}`)
      if (paymentPartyResult.error && !/relation .* does not exist/i.test(paymentPartyResult.error.message)) setError(current => current ?? `โหลดช่องทางรับจ่ายไม่สำเร็จ: ${userError(paymentPartyResult.error)}`)
      else if (paymentPartyResult.data?.length) {
        const links = paymentPartyResult.data as unknown as StoredPaymentPartyLink[]
        setSlipReviewDraft(current => {
          if (!current) return current
          const sender = links.find(link => link.party_role === 'sender')
          const recipient = links.find(link => link.party_role === 'recipient')
          return {
            ...current,
            senderPaymentMethod: sender?.payment_method ?? current.senderPaymentMethod,
            senderAliasType: sender?.master_payment_aliases?.alias_type ?? current.senderAliasType,
            senderAliasValue: sender?.master_payment_aliases?.masked_value ?? current.senderAliasValue,
            recipientPaymentMethod: recipient?.payment_method ?? current.recipientPaymentMethod,
            recipientAliasType: recipient?.master_payment_aliases?.alias_type ?? current.recipientAliasType,
            recipientAliasValue: recipient?.master_payment_aliases?.masked_value ?? current.recipientAliasValue,
          }
        })
      }
      if (previewResult.error) {
        setSlipPreviewMessage(`เปิดไฟล์ไม่ได้: ${userError(previewResult.error)}`)
        return
      }
      const previewData = previewResult.data as { reason?: string; files?: Array<{ bucket: string; path: string; content_type?: string | null }> } | null
      if (!previewData?.files?.length) {
        setSlipPreviewMessage(previewData?.reason ?? 'ไม่พบไฟล์ต้นฉบับ')
        return
      }
      const signedFiles = await Promise.all(previewData.files.map(async (file, index) => {
        const signed = await documentFlowGateway.signedPreviewUrl(file.bucket, file.path)
        return signed.data?.signedUrl ? { url: signed.data.signedUrl, contentType: file.content_type ?? null, label: `ไฟล์ ${index + 1}` } : null
      }))
      if (requestId !== slipRequestRef.current) return
      const available = signedFiles.filter((file): file is SlipPreviewFile => Boolean(file))
      setSlipPreviewFiles(available)
      setSlipPreviewMessage(available.length ? '' : 'สร้างลิงก์เปิดไฟล์ไม่สำเร็จ กรุณาลองใหม่')
    } catch (detailError) {
      if (requestId === slipRequestRef.current) setSlipPreviewMessage(`เปิดไฟล์ไม่ได้: ${userError(detailError)}`)
    } finally {
      if (requestId === slipRequestRef.current) setSlipDetailLoading(false)
    }
  }

  const openDeepLinkedSlip = useEffectEvent((slip: AccountingPendingSlip) => {
    setAccountingQueueView('slips')
    setSlipFilter('transfer_slip')
    void openSlipDetail(slip)
  })

  useEffect(() => {
    if (!requestedTransactionId || openedTransactionRef.current === requestedTransactionId) return
    const slip = pendingSlips.find((row) => row.transactionId === requestedTransactionId)
    if (!slip) return
    openedTransactionRef.current = requestedTransactionId
    const timer = window.setTimeout(() => openDeepLinkedSlip(slip), 0)
    return () => window.clearTimeout(timer)
  }, [pendingSlips, requestedTransactionId])

  const rereadSelectedSlip = async () => {
    if (!selectedSlip) return
    setSlipActionLoading(true); setError(null); setSuccess(null)
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('reprocess-transfer-slips', { body: { item_id: selectedSlip.itemId, guidance: slipAiGuidance.trim() || undefined } })
      if (invokeError) throw invokeError
      if (data?.failed) throw new Error(data?.results?.[0]?.detail ?? 'AI อ่านสลิปไม่สำเร็จ')
      setSuccess('AI อ่านสลิปใหม่แล้ว กรุณาตรวจและยืนยันข้อมูลในแท็บถัดไป')
      await loadData()
      if (selectedSlip.sourceMessageId) {
        const { data: tx } = await supabase.from('financial_transactions').select('sender_name,sender_bank_name,sender_account_last4,recipient_name,recipient_bank_name,recipient_account_last4,amount_total,transfer_at,bank_reference,payment_party_confidence,analysis_confidence,analysis_model,notes').eq('source_message_id', selectedSlip.sourceMessageId).maybeSingle()
        if (tx) {
          const refreshed = { ...selectedSlip, senderName: tx.sender_name, senderBankName: tx.sender_bank_name, senderAccountLast4: tx.sender_account_last4, recipientName: tx.recipient_name, recipientBankName: tx.recipient_bank_name, recipientAccountLast4: tx.recipient_account_last4, amount: tx.amount_total == null ? null : Number(tx.amount_total), transferAt: tx.transfer_at, bankReference: tx.bank_reference, paymentPartyConfidence: tx.payment_party_confidence == null ? null : Number(tx.payment_party_confidence), analysisConfidence: tx.analysis_confidence == null ? null : Number(tx.analysis_confidence), analysisModel: tx.analysis_model, notes: tx.notes }
          setSelectedSlip(refreshed); setSlipReviewDraft(slipDraftFromRow(refreshed))
        }
      }
      const timeline = await documentFlowGateway.loadTimeline(selectedSlip.itemId)
      if (!timeline.error) setSlipEvents((timeline.data ?? []) as SlipFlowEvent[])
      setSlipDetailTab(1)
    } catch (actionError) { setError(userError(actionError)) }
    finally { setSlipActionLoading(false) }
  }

  const rereadInvalidSlipDates = async () => {
    setSlipDateRepairLoading(true); setError(null); setSuccess(null)
    const processedItemIds = new Set<string>()
    let processed = 0; let failed = 0; let remaining = 0
    try {
      for (let batch = 0; batch < 20; batch += 1) {
        const { data, error: invokeError } = await supabase.functions.invoke('reprocess-transfer-slips', {
          body: {
            repair_invalid_dates: true,
            limit: 10,
            exclude_item_ids: [...processedItemIds],
            guidance: 'อ่านวันที่และเวลาโอนจากภาพให้ชัดเจน แปลงปี พ.ศ. เป็น ค.ศ. และห้ามเดาวันที่ที่มองไม่เห็น',
          },
        })
        if (invokeError) throw invokeError
        const results = Array.isArray(data?.results) ? data.results as Array<{ item_id?: string; status?: string }> : []
        for (const result of results) {
          if (result.item_id) processedItemIds.add(result.item_id)
          processed += 1
          if (result.status === 'failed') failed += 1
        }
        remaining = Number(data?.estimated_remaining) || 0
        if (!results.length || remaining === 0) break
      }
      await loadData()
      setSuccess(`AI อ่านวันที่สลิปใหม่ ${processed.toLocaleString('th-TH')} รายการ${failed ? ` · ไม่สำเร็จ ${failed.toLocaleString('th-TH')} รายการ` : ''}${remaining ? ` · ยังเหลือ ${remaining.toLocaleString('th-TH')} รายการ` : ' · ครบแล้ว'} กรุณาตรวจ Candidate ก่อนยืนยัน`)
    } catch (actionError) { setError(userError(actionError)) }
    finally { setSlipDateRepairLoading(false) }
  }

  const saveSlipReview = async (decision: 'draft' | 'confirm' | 'request_information') => {
    if (!selectedSlip || !slipReviewDraft || !slipMoneyLineageDraft) return
    setSlipActionLoading(true); setError(null); setSuccess(null)
    try {
      const amount = slipReviewDraft.amount.trim() ? Number(slipReviewDraft.amount) : null
      if (amount != null && (!Number.isFinite(amount) || amount < 0)) throw new Error('จำนวนเงินไม่ถูกต้อง')
      if (decision === 'confirm' && (senderAliasError || recipientAliasError)) throw new Error([senderAliasError, recipientAliasError].filter(Boolean).join(' · '))
      let effectiveLineageDraft = slipMoneyLineageDraft
      const hasAdvanceAllocation = effectiveLineageDraft.allocations.some(allocation => allocation.purposeType === 'advance_transfer')
      const eventKey = `transfer-slip-money-lineage:${selectedSlip.itemId}:${crypto.randomUUID()}`
      if (decision === 'confirm' && hasAdvanceAllocation) {
        const partyResult = await supabase.rpc('resolve_transfer_slip_advance_parties', { target_item_id: selectedSlip.itemId, target_event_key: `${eventKey}:parties`, target_apply: true })
        if (partyResult.error) throw partyResult.error
        const raw = partyResult.data as Record<string, unknown>
        const blockers = Array.isArray(raw.blockers) ? raw.blockers.map(String) : []
        if (raw.ready !== true || blockers.length) throw new Error(blockers.join(' · ') || 'ยังเชื่อมผู้ถือเงินและพนักงานไม่ครบ')
        const holderName = typeof raw.holder_name === 'string' ? raw.holder_name : effectiveLineageDraft.fundHolderName
        const recipientName = typeof raw.recipient_name === 'string' ? raw.recipient_name : effectiveLineageDraft.finalBeneficiaryName
        effectiveLineageDraft = { ...effectiveLineageDraft, fundingSourceType: 'reserve_fund', fundHolderName: holderName, payerName: holderName, finalBeneficiaryName: recipientName, responsibleName: recipientName, allocations: effectiveLineageDraft.allocations.map(allocation => ({ ...allocation, payeeName: recipientName, responsibleName: recipientName })) }
        setSlipMoneyLineageDraft(effectiveLineageDraft)
        setSlipAdvancePartyMatch({ applicable: true, ready: true, applied: true, blockers: [], holderName, recipientName, senderBankLinked: true, recipientBankLinked: true })
      }
      if (decision === 'confirm') { const validation = validateMoneyLineage(effectiveLineageDraft, amount); if (validation.missing.length || validation.errors.length) throw new Error([...validation.missing.map(value => `ขาด ${value}`), ...validation.errors].join(' · ')) }
      const numericOrNull = (value: string) => value.trim() ? Number(value) : null
      const legacyScope = legacyMoneyLineageScope(effectiveLineageDraft.allocations)
      const transferPayload = {
        sender_name: slipReviewDraft.senderName || null, sender_bank_name: slipReviewDraft.senderBankName || null,
        sender_account_last4: slipReviewDraft.senderAccountLast4 || null, recipient_name: slipReviewDraft.recipientName || null,
        recipient_bank_name: slipReviewDraft.recipientBankName || null, recipient_account_last4: slipReviewDraft.recipientAccountLast4 || null,
        amount_total: amount, transfer_at: slipReviewDraft.transferAt ? new Date(slipReviewDraft.transferAt).toISOString() : null,
        bank_reference: slipReviewDraft.bankReference || null,
      }
      const lineagePayload = {
        parent_lineage_id: effectiveLineageDraft.parentLineageId || null,
        funding_source_type: effectiveLineageDraft.fundingSourceType, funding_source_reference: effectiveLineageDraft.fundingSourceReference || null,
        fund_holder_name: effectiveLineageDraft.fundHolderName || null, payer_name: effectiveLineageDraft.payerName || null,
        final_beneficiary_name: effectiveLineageDraft.finalBeneficiaryName || null,
        project_id: legacyScope.projectId || null, site_id: legacyScope.siteId || null, responsible_name: effectiveLineageDraft.responsibleName || null,
        starting_amount: numericOrNull(effectiveLineageDraft.startingAmount), paid_amount: amount,
        returned_amount: numericOrNull(effectiveLineageDraft.returnedAmount) ?? 0,
        remaining_amount: numericOrNull(effectiveLineageDraft.remainingAmount),
        hops: effectiveLineageDraft.hops.map((hop, index) => ({ sequence: index + 1, from_party: hop.fromParty.trim(), to_party: hop.toParty.trim(), amount: numericOrNull(hop.amount), transferred_at: hop.transferredAt ? new Date(hop.transferredAt).toISOString() : null, note: hop.note.trim() || null })),
        note: effectiveLineageDraft.note || slipReviewDraft.note || null,
      }
      const allocationPayload = effectiveLineageDraft.allocations.map((allocation, index) => ({
        allocation_key: allocation.key, sequence: index + 1, purpose_type: allocation.purposeType,
        amount: numericOrNull(allocation.amount), project_id: allocation.projectId || null, site_id: allocation.siteId || null,
        payee_name: allocation.payeeName || null, responsible_name: allocation.responsibleName || null,
        description: allocation.description || null, confidence: numericOrNull(allocation.confidence), evidence: [
          ...(allocation.purposeType === 'payroll' && allocation.payrollKind ? [{ field: 'payroll_kind', value: allocation.payrollKind, source: 'admin_confirmed' }] : []),
          ...(allocation.costCategoryId ? [
            { field: 'cost_category_id', value: allocation.costCategoryId, source: 'admin_selected' },
            { field: 'account_code', value: allocation.accountCode, source: 'canonical_accounting_cost_category' },
            { field: 'account_name', value: allocation.accountName, source: 'canonical_accounting_cost_category' },
          ] : []),
        ],
      }))
      const saveBase = async (baseDecision: 'draft' | 'confirm' | 'request_information', baseEventKey: string) => {
        const result = await supabase.rpc('review_transfer_slip_money_lineage_v2', {
          target_item_id: selectedSlip.itemId, target_event_key: baseEventKey, target_decision: baseDecision,
          target_transfer: transferPayload, target_lineage: lineagePayload, target_allocations: allocationPayload,
        })
        if (result.error) throw result.error
        return result.data as { lineage_id?: string; route_status?: string; next_destination?: string; advance_case_id?: string | null } | null
      }
      const savePaymentParties = async () => {
        const result = await supabase.rpc('review_transfer_slip_payment_parties_v1', {
          target_item_id: selectedSlip.itemId,
          target_event_key: `${eventKey}:payment-parties`,
          target_parties: [
            { party_role: 'sender', payment_method: slipReviewDraft.senderPaymentMethod, alias_type: slipReviewDraft.senderAliasType, alias_value: slipReviewDraft.senderAliasValue, canonical_name: effectiveLineageDraft.payerName || slipReviewDraft.senderName },
            { party_role: 'recipient', payment_method: slipReviewDraft.recipientPaymentMethod, alias_type: slipReviewDraft.recipientAliasType, alias_value: slipReviewDraft.recipientAliasValue, canonical_name: effectiveLineageDraft.finalBeneficiaryName || slipReviewDraft.recipientName },
          ],
          target_reason: effectiveLineageDraft.note || 'Admin ยืนยันช่องทางรับจ่ายจากสลิปและข้อมูล Canonical',
        })
        if (result.error) throw result.error
        return result.data
      }
      const hasVendorAllocations = effectiveLineageDraft.allocations.some(allocation => allocation.purposeType === 'vendor_payment')
      const vendorMatchEvidence = (allocation: MoneyAllocationDraft) => [
        allocation.vendorId ? { field: 'vendor_master_id', value: allocation.vendorId, weight: 1 } : null,
        allocation.vendorTaxId.trim() ? { field: 'vendor_tax_id', value: allocation.vendorTaxId.trim(), weight: 1 } : null,
        allocation.vendorBankName.trim() && allocation.vendorAccountLast4.trim() ? { field: 'vendor_bank_account_last4', value: `${allocation.vendorBankName.trim()} · ${allocation.vendorAccountLast4.trim()}`, weight: .8 } : null,
        allocation.vendorName.trim() ? { field: 'vendor_name_from_evidence', value: allocation.vendorName.trim(), weight: .45 } : null,
      ].filter((item): item is { field: string; value: string; weight: number } => Boolean(item))
      // Vendor matching is a guarded two-phase write: save the allocation draft,
      // record the verified vendor evidence, then confirm. The DB trigger blocks
      // a confirmed vendor allocation without that evidence row.
      let routeResult: { lineage_id?: string; route_status?: string; next_destination?: string; advance_case_id?: string | null } | null
      if (hasVendorAllocations && decision === 'confirm') {
        routeResult = await saveBase('draft', `${eventKey}:draft`)
        if (!routeResult?.lineage_id) throw new Error('ไม่พบเส้นทางเงินหลังบันทึกฉบับร่าง')
        await savePaymentParties()
        for (const allocation of effectiveLineageDraft.allocations.filter(item => item.purposeType === 'vendor_payment')) {
          const matchResult = await supabase.rpc('save_transfer_slip_vendor_match_v1', {
            target_lineage_id: routeResult.lineage_id,
            target_allocation_key: allocation.key,
            target_event_key: `${eventKey}:vendor:${allocation.key}`,
            target_vendor_id: allocation.vendorId || null,
            target_vendor_name: allocation.vendorName || allocation.payeeName || null,
            target_vendor_tax_id: allocation.vendorTaxId || null,
            target_vendor_bank_name: allocation.vendorBankName || null,
            target_vendor_account_last4: allocation.vendorAccountLast4 || null,
            target_payer_name: effectiveLineageDraft.payerName || null,
            target_match_status: allocation.vendorMatchStatus,
            target_confidence: numericOrNull(allocation.vendorMatchConfidence),
            target_reason: allocation.vendorMatchReason || 'Admin จับคู่ร้านค้าจากหลักฐานสลิป/เอกสาร',
            target_evidence: vendorMatchEvidence(allocation),
          })
          if (matchResult.error) throw matchResult.error
        }
        routeResult = await saveBase('confirm', eventKey)
      } else if (decision === 'confirm') {
        routeResult = await saveBase('draft', `${eventKey}:draft`)
        await savePaymentParties()
        routeResult = await saveBase('confirm', eventKey)
      } else {
        routeResult = await saveBase(decision, eventKey)
        if (hasVendorAllocations && routeResult?.lineage_id) {
          for (const allocation of effectiveLineageDraft.allocations.filter(item => item.purposeType === 'vendor_payment')) {
            const matchResult = await supabase.rpc('save_transfer_slip_vendor_match_v1', {
              target_lineage_id: routeResult.lineage_id,
              target_allocation_key: allocation.key,
              target_event_key: `${eventKey}:vendor:${allocation.key}`,
              target_vendor_id: allocation.vendorId || null,
              target_vendor_name: allocation.vendorName || allocation.payeeName || null,
              target_vendor_tax_id: allocation.vendorTaxId || null,
              target_vendor_bank_name: allocation.vendorBankName || null,
              target_vendor_account_last4: allocation.vendorAccountLast4 || null,
              target_payer_name: effectiveLineageDraft.payerName || null,
              target_match_status: allocation.vendorMatchStatus,
              target_confidence: numericOrNull(allocation.vendorMatchConfidence),
              target_reason: allocation.vendorMatchReason || 'บันทึกหลักฐานเพื่อรอตรวจจับคู่ร้านค้า',
              target_evidence: vendorMatchEvidence(allocation),
            })
            if (matchResult.error) throw matchResult.error
          }
        }
      }
      const route = routeResult
      const destinationLabel = moneyAllocationDestinations(effectiveLineageDraft.allocations).join(' · ')
      setSlipMoneyLineageStatus({ routeStatus: route?.route_status ?? (decision === 'confirm' ? 'routed' : decision === 'request_information' ? 'needs_information' : 'draft'), nextDestination: route?.next_destination ?? destinationLabel })
      setSuccess(decision === 'confirm' ? route?.route_status === 'accounting_review' ? 'บันทึกแล้ว แต่ยังค้างบัญชีเพื่อจับคู่ผู้ถือเงินก่อนส่งเงินสำรองจ่าย' : `ยืนยันการจัดสรรและส่งงานต่อแล้ว: ${destinationLabel}` : decision === 'request_information' ? 'ส่งกลับเพื่อขอข้อมูลเพิ่มแล้ว' : 'บันทึกฉบับร่างพร้อมเส้นทางเงินและ Audit แล้ว')
      await loadData()
      const updatedSlip: AccountingPendingSlip = { ...selectedSlip, senderName: slipReviewDraft.senderName || null, senderBankName: slipReviewDraft.senderBankName || null, senderAccountLast4: slipReviewDraft.senderAccountLast4 || null, recipientName: slipReviewDraft.recipientName || null, recipientBankName: slipReviewDraft.recipientBankName || null, recipientAccountLast4: slipReviewDraft.recipientAccountLast4 || null, amount, transferAt: slipReviewDraft.transferAt ? new Date(slipReviewDraft.transferAt).toISOString() : null, bankReference: slipReviewDraft.bankReference || null, reviewStatus: decision === 'confirm' ? 'confirmed' : 'pending', dataReviewStatus: decision === 'confirm' ? 'rechecked' : 'incomplete', dataReviewNote: slipReviewDraft.note || null }
      setSelectedSlip(updatedSlip)
      const timeline = await documentFlowGateway.loadTimeline(selectedSlip.itemId)
      if (!timeline.error) setSlipEvents((timeline.data ?? []) as SlipFlowEvent[])
    } catch (actionError) { setError(userError(actionError)) }
    finally { setSlipActionLoading(false) }
  }

  const visibleDocuments = useMemo(() => documents.filter(document => statusFilter === 'active'
    ? !['duplicate', 'dismissed'].includes(document.status)
    : !statusFilter || document.status === statusFilter), [documents, statusFilter])
  const pendingAmount = documents.filter(document => ['pending', 'needs_correction'].includes(document.status)).reduce((sum, document) => sum + (document.total_amount ?? 0), 0)
  const confirmedAmount = documents.filter(document => document.status === 'confirmed').reduce((sum, document) => sum + (document.total_amount ?? 0), 0)
  const setMatchSummary = useMemo(() => {
    const grouped = new Map<string, DocumentSetMatchSummary>()

    documents.forEach(document => {
      const setKey = document.document_set_id ?? `single:${document.id}`
      const existing = grouped.get(setKey)
      const types = new Set(existing?.typesPresent ?? [])
      types.add(document.document_type)
      const existingStatus = existing?.status
      const statuses = [existingStatus, document.status].filter(Boolean) as string[]
      const isNeedsCorrection = statuses.includes('needs_correction')

      const next: DocumentSetMatchSummary = {
        key: setKey,
        setLabel: document.document_set_id ? `ชุด #${setKey.slice(0, 6)}` : `เอกสารเดี่ยว (${document.document_set_id ? '' : document.id.slice(0, 6)})`,
        status: isNeedsCorrection ? 'needs_correction' : existingStatus ?? document.status,
        vendorName: document.vendor_name?.trim() || 'อ่านชื่อไม่ได้',
        documentCount: (existing?.documentCount ?? 0) + 1,
        pageCount: Math.max(existing?.pageCount ?? 0, document.page_number ?? 1),
        typesPresent: [...types],
        criticalMissing: existing?.criticalMissing ?? [],
        optionalMissing: existing?.optionalMissing ?? [],
        representativeDocumentId: document.id,
        representativeDocumentType: document.document_type,
        createdAt: existing?.createdAt || document.created_at,
      }

      const presentTypes = new Set(next.typesPresent)
      const nextCritical = matchRequirements.filter(item => item.isRequired && !presentTypes.has(item.documentType)).map(item => item.documentLabel)
      const nextOptional = matchRequirements.filter(item => !item.isRequired && !presentTypes.has(item.documentType)).map(item => item.documentLabel)
      next.criticalMissing = nextCritical
      next.optionalMissing = nextOptional

      if (!existing || document.created_at > (next.createdAt || document.created_at)) {
        next.createdAt = document.created_at
      }

      grouped.set(setKey, next)
    })

      return [...grouped.values()].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [documents])
  const openSetRepresentativeDocument = async (documentId: string) => {
    const target = documents.find(document => document.id === documentId)
    if (!target) return
    await openDocument(target)
  }
  const categoryLabel = (category: CostCategory) => `${category.code} · ${category.name_th}`
  const documentStatusLabel = (document: AccountingDocument) => document.document_type === 'quotation'
    ? document.status === 'confirmed' ? 'ตรวจใบเสนอราคาแล้ว' : document.status === 'pending' ? 'รอตัดสินใจ' : statusLabels[document.status]
    : document.document_type === 'goods_receipt' && document.status === 'confirmed' ? 'รับเข้า Stock แล้ว' : statusLabels[document.status]

  const renderTabContent = () => {
    if (loading) {
      return <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}><CircularProgress /></Box>
    }

    if (tab === 0) {
      return (
        <Stack spacing={2}>
          <Paper variant="outlined">
            <Tabs value={accountingQueueView} onChange={(_event, value: 'slips' | 'documents') => setAccountingQueueView(value)} variant="scrollable">
              <Tab value="slips" label={`สลิปโอนเงิน (${slipCounts.transfer_slip})`} />
              <Tab value="documents" label={`เอกสารบัญชีทั่วไป (${visibleDocuments.length})`} />
            </Tabs>
          </Paper>
          {accountingQueueView === 'slips' ? <>
            <Paper variant="outlined" sx={{ p: 1.5, borderTop: 3, borderTopColor: 'info.main' }}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}>
                <Box><Typography variant="subtitle1" sx={{ fontWeight: 800 }}>Accounting Pending Queue · สลิปโอนเงิน</Typography><Typography variant="body2" color="text.secondary">คิวสลิปจาก Intake ที่ส่งบัญชีเป็นปลายทางแรก · รายการซ้ำแยกไว้อ้างอิงและไม่นับในยอดหลัก</Typography></Box>
                <Stack direction="row" spacing={1}>
                  {canManage && <Button size="small" variant="outlined" disabled={slipDateRepairLoading} onClick={() => void rereadInvalidSlipDates()}>{slipDateRepairLoading ? 'AI กำลังอ่านวันที่…' : 'AI อ่านวันที่ผิด/ว่างใหม่'}</Button>}
                  <Button size="small" href="/document-flows?document_view=task_types">เปิดศูนย์เส้นทาง</Button>
                </Stack>
              </Stack>
              <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 1.5, flexWrap: 'wrap' }}>
                {([['transfer_slip', 'สลิปโอนเงิน'], ['pending', 'รอตรวจ'], ['reviewed', 'ตรวจแล้ว'], ['duplicate', 'ซ้ำ'], ['incomplete', 'ข้อมูลไม่ครบ']] as Array<[TransferSlipQueueFilter, string]>).map(([value, label]) => <Chip key={value} clickable color={slipFilter === value ? 'primary' : 'default'} variant={slipFilter === value ? 'filled' : 'outlined'} label={`${label} (${slipCounts[value]})`} onClick={() => setSlipFilter(value)} />)}
              </Stack>
            </Paper>
            <StandardDataTable
              rows={visibleSlips}
              getRowId={row => row.taskId}
              getSearchText={row => [row.intakeId, row.sourceMessageId, row.senderName, row.recipientName, row.sourceChannel, row.sourceRoomName, transferSlipContinuation(row).route].filter(Boolean).join(' ')}
              searchLabel="ค้นหา Document ID ผู้โอน ผู้รับ Source หรือปลายทาง"
              emptyText={`ไม่มีรายการในตัวกรอง “${slipFilter === 'transfer_slip' ? 'สลิปโอนเงิน' : slipFilter === 'pending' ? 'รอตรวจ' : slipFilter === 'reviewed' ? 'ตรวจแล้ว' : slipFilter === 'duplicate' ? 'ซ้ำ' : 'ข้อมูลไม่ครบ'}”`}
              exportFileName={`wisdomai-accounting-transfer-slips-${slipFilter}`}
              minWidth={1450}
              onRowClick={row => void openSlipDetail(row)}
              columns={[
                { id: 'id', label: 'Document ID', minWidth: 180, render: row => <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{(row.intakeId ?? row.itemId).slice(0, 12)}…</Typography>, exportValue: row => row.intakeId ?? row.itemId },
                { id: 'date', label: 'วันที่โอน', minWidth: 150, render: row => row.transferAt ? new Date(row.transferAt).toLocaleString('th-TH') : 'ยังอ่านไม่ได้' },
                { id: 'sender', label: 'ผู้จ่าย / ผู้โอน', minWidth: 210, render: row => <Box><Typography variant="body2">{row.isPostable ? row.canonicalPayerName ?? 'ไม่ระบุ' : row.confirmedPartyPayerName ?? row.senderName ?? 'ยังอ่านไม่ได้'}</Typography><Typography variant="caption" color="text.secondary">{row.isPostable ? 'ข้อมูลใช้งานจริง' : row.partyIdentityStatus === 'confirmed_pair' ? 'ชื่อจากคู่บัญชีที่ยืนยันแล้ว' : 'หลักฐานรอตรวจ'}</Typography></Box> },
                { id: 'recipient', label: 'ผู้รับ', minWidth: 210, render: row => <Box><Typography variant="body2">{row.isPostable ? row.canonicalBeneficiaryName ?? 'ไม่ระบุ' : row.confirmedPartyBeneficiaryName ?? row.recipientName ?? 'ยังอ่านไม่ได้'}</Typography><Typography variant="caption" color="text.secondary">{row.isPostable ? 'ข้อมูลใช้งานจริง' : row.partyIdentityStatus === 'confirmed_pair' ? 'ชื่อจากคู่บัญชีที่ยืนยันแล้ว' : 'หลักฐานรอตรวจ'}</Typography></Box> },
                { id: 'amount', label: 'จำนวนเงิน', minWidth: 140, align: 'right', render: row => <Box><Typography variant="body2">{money(row.isPostable ? row.canonicalAmount : row.amount)}</Typography><Typography variant="caption" color="text.secondary">{row.isPostable ? 'Canonical' : 'Evidence'}</Typography></Box> },
                { id: 'source', label: 'Source', minWidth: 220, render: row => <Box><Typography variant="body2">{row.sourceChannel ?? 'ไม่ระบุช่องทาง'} · {row.sourceRoomName ?? 'ไม่ระบุห้อง'}</Typography><Typography variant="caption" color="text.secondary">{row.sourceSenderName ?? 'ไม่ระบุผู้ส่ง'}</Typography></Box> },
                { id: 'status', label: 'สถานะข้อมูลกลาง', minWidth: 190, render: row => { const bucket = transferSlipQueueBucket(row); return <Chip size="small" color={bucket === 'reviewed' ? 'success' : bucket === 'duplicate' ? 'error' : bucket === 'incomplete' ? 'warning' : 'info'} label={row.isPostable ? 'Canonical · ใช้งานได้' : bucket === 'duplicate' ? 'รายการซ้ำ · ห้ามใช้' : row.truthStatus === 'needs_information' ? 'รอข้อมูลเพิ่ม' : bucket === 'incomplete' ? 'หลักฐานไม่ครบ' : row.partyIdentityStatus === 'confirmed_pair' ? 'ชื่อยืนยันแล้ว · รอจัดสรร' : 'รอตรวจ · ห้ามลงบัญชี'} /> } },
                { id: 'next', label: 'ปลายทางถัดไป', minWidth: 210, render: row => { const continuation = transferSlipContinuation(row); return <Stack direction="row" spacing={.5} sx={{ alignItems: 'center' }}>{continuation.label && <Chip size="small" color="secondary" label={continuation.label} />}<Typography variant="body2">{continuation.route}</Typography></Stack> } },
                { id: 'open', label: 'หลักฐาน', minWidth: 120, render: row => <Button size="small" variant="outlined" onClick={() => void openSlipDetail(row)}>เปิดรูป/Audit</Button>, exportable: false },
              ]}
            />
          </> : <StandardDataTable
            rows={visibleDocuments}
            getRowId={row => row.id}
            getSearchText={row => [row.vendor_name, row.document_number, documentLabels[row.document_type], row.projects?.name].filter(Boolean).join(' ')}
            searchLabel="ค้นหาผู้ขาย เลขที่เอกสาร หรือโครงการ"
            emptyText="ยังไม่พบเอกสารบัญชีจาก LINE"
            exportFileName="wisdomai-accounting-documents"
            minWidth={1100}
            toolbar={<Select size="small" displayEmpty value={statusFilter} onChange={event => setStatusFilter(event.target.value)} sx={{ minWidth: 210 }}><MenuItem value="active">รายการใช้งาน (ไม่รวมรายการซ้ำ)</MenuItem><MenuItem value="">ทุกสถานะ (รวมประวัติ)</MenuItem>{(Object.entries(statusLabels) as [DocumentStatus, string][]).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</Select>}
            columns={[
              { id: 'date', label: 'วันที่', minWidth: 110, render: row => row.document_date ?? new Date(row.created_at).toLocaleDateString('th-TH') },
              { id: 'type', label: 'ประเภทเอกสาร', minWidth: 230, render: row => <Box><div>{documentLabels[row.document_type] ?? row.document_type}</div><Typography variant="caption" color="text.secondary">{purposeLabels[row.document_purpose ?? 'other']}</Typography></Box> },
              { id: 'pages', label: 'ชุดภาพ', minWidth: 90, render: row => row.document_set_id ? <Chip size="small" variant="outlined" label={`หน้า ${row.page_number ?? 1}`} /> : '1 หน้า' },
              { id: 'number', label: 'เลขที่', minWidth: 130, render: row => row.document_number ?? '-' },
              { id: 'vendor', label: 'ผู้ขาย/ผู้รับเงิน', minWidth: 220, render: row => row.vendor_name ?? 'อ่านชื่อไม่ได้' },
              { id: 'total', label: 'ยอดรวม', minWidth: 120, align: 'right', render: row => money(row.total_amount) },
              { id: 'project', label: 'โครงการ', minWidth: 180, render: row => row.projects?.name ?? 'รอระบุ' },
              { id: 'status', label: 'สถานะ', minWidth: 170, render: row => <Chip size="small" color={row.status === 'confirmed' ? 'success' : row.status === 'duplicate' ? 'error' : row.status === 'needs_correction' ? 'warning' : 'default'} label={documentStatusLabel(row)} /> },
              { id: 'action', label: 'ตรวจสอบ', minWidth: 120, render: row => <Button size="small" variant="outlined" onClick={() => void openDocument(row)}>เปิดเอกสาร</Button> },
            ]}
          />}
        </Stack>
      )
    }

    if (tab === 1) {
      return (
        <StandardDataTable
          rows={setMatchSummary}
          getRowId={row => row.key}
          getSearchText={row => `${row.setLabel} ${row.vendorName} ${row.criticalMissing.join(' ')} ${row.optionalMissing.join(' ')}`}
          searchLabel="ค้นหาชุดเอกสารที่ขาดเอกสาร"
          emptyText="ยังไม่พบชุดเอกสารที่ต้องจับคู่"
          exportFileName="wisdomai-document-set-match-overview"
          columns={[
            { id: 'set', label: 'ชุดเอกสาร', minWidth: 180, render: row => <Button size="small" variant="outlined" onClick={() => void openSetRepresentativeDocument(row.representativeDocumentId)}>{row.setLabel}</Button> },
            { id: 'vendor', label: 'ผู้ขาย', minWidth: 220, render: row => row.vendorName },
            { id: 'docs', label: 'เอกสารมีในชุด', minWidth: 300, render: row => <Stack direction="row" spacing={.5} sx={{ flexWrap: 'wrap', rowGap: .5 }}><Chip size="small" label={`รวม ${row.documentCount} เอกสาร`} /><Chip size="small" color="secondary" label={`${row.pageCount} หน้า`} /></Stack>, exportValue: row => `${row.documentCount} เอกสาร` },
            { id: 'type', label: 'ครบประเภท', minWidth: 260, render: row => <Stack direction="row" spacing={.5} sx={{ flexWrap: 'wrap', rowGap: .5 }}>{matchRequirements.map(requirement => <Chip key={requirement.documentType} size="small" color={row.typesPresent.includes(requirement.documentType) ? 'success' : 'default'} label={requirement.documentLabel} />)}</Stack>},
            { id: 'criticalMissing', label: 'เอกสารขาด (สำคัญ)', minWidth: 260, render: row => row.criticalMissing.length === 0 ? <Chip size="small" color="success" label="ครบ" /> : <Stack direction="row" spacing={.5} sx={{ flexWrap: 'wrap', rowGap: .5 }}>{row.criticalMissing.map(item => <Chip key={item} size="small" color="warning" label={item} />)}</Stack> },
            { id: 'optionalMissing', label: 'เอกสารขาด (เสริม)', minWidth: 220, render: row => row.optionalMissing.length === 0 ? <Chip size="small" color="success" label="ครบ" /> : <Stack direction="row" spacing={.5} sx={{ flexWrap: 'wrap', rowGap: .5 }}>{row.optionalMissing.map(item => <Chip key={item} size="small" label={item} />)}</Stack> },
            { id: 'status', label: 'สถานะสำคัญ', minWidth: 150, render: row => <Chip size="small" color={row.criticalMissing.length > 0 ? 'error' : row.status === 'needs_correction' ? 'warning' : 'success'} label={row.status} /> },
          ]}
        />
      )
    }

    if (tab === 2) {
      return (
        <StandardDataTable
          rows={productPrices}
          getRowId={row=>row.id}
          getSearchText={row=>[row.description,row.product_code,row.vendor_name,projects.find(project=>project.id===row.project_id)?.name].filter(Boolean).join(' ')}
          searchLabel="ค้นหาสินค้า รหัส ผู้ขาย หรือโครงการ"
          emptyText="ยังไม่มีราคาสินค้าจากใบเสนอราคา"
          exportFileName="wisdomai-product-price-list"
          initialRowsPerPage={25}
          defaultSort={{ columnId: 'date', direction: 'desc' }}
          columns={[
            {id:'date',label:'วันที่ราคา',render:row=>new Date(row.observed_at).toLocaleDateString('th-TH'),sortValue:row=>new Date(row.observed_at)},
            {id:'code',label:'รหัสสินค้า',render:row=>row.product_code??'-'},
            {id:'item',label:'สินค้า/รายละเอียด',minWidth:280,render:row=>row.description},
            {id:'vendor',label:'บริษัทผู้ขาย',minWidth:220,render:row=>row.vendor_name??'ไม่ระบุ'},
            {id:'project',label:'โครงการ',minWidth:200,render:row=>projects.find(project=>project.id===row.project_id)?.name??'ราคากลางบริษัท'},
            {id:'quantity',label:'จำนวน',align:'right',render:row=>`${Number(row.quantity??0).toLocaleString('th-TH')} ${row.unit??''}`},
            {id:'price',label:'ราคาต่อหน่วย',align:'right',render:row=>money(row.effective_unit_price??row.unit_price),sortValue:row=>Number(row.effective_unit_price??row.unit_price??0)},
            {id:'valid',label:'ใช้ได้ถึง',render:row=>row.valid_until?new Date(row.valid_until).toLocaleDateString('th-TH'):'ไม่ระบุ'},
            {id:'status',label:'แหล่งราคา',render:row=><Chip size="small" color={row.decision_status==='actual'?'success':'default'} label={row.decision_status==='actual'?'ราคาซื้อจริง':quotationActionLabels[row.decision_status as QuotationAction]??row.decision_status}/>,exportValue:row=>row.decision_status==='actual'?'ราคาซื้อจริง':quotationActionLabels[row.decision_status as QuotationAction]??row.decision_status},
          ]}
        />
      )
    }

    if (tab === 3) {
      return (
        <StandardDataTable
          rows={inventory}
          getRowId={row => row.id}
          getSearchText={row => [row.name, row.product_code].filter(Boolean).join(' ')}
          emptyText="ยังไม่มีรายการสต๊อก"
          exportFileName="wisdomai-inventory-balances"
          columns={[
            { id: 'code', label: 'รหัสสินค้า', render: row => row.product_code ?? '-' }, { id: 'name', label: 'ชื่อสินค้า', minWidth: 280, render: row => row.name },
            { id: 'balance', label: 'คงเหลือ', align: 'right', render: row => `${Number(row.balance_quantity).toLocaleString('th-TH')} ${row.unit ?? ''}` },
            { id: 'cost', label: 'ต้นทุนเฉลี่ย', align: 'right', render: row => money(row.average_unit_cost) },
          ]}
        />
      )
    }

    return (
      <StandardDataTable
        rows={projectInventory}
        getRowId={row => `${row.inventory_item_id}-${row.project_id ?? 'central'}-${row.location_id ?? 'none'}`}
        getSearchText={row => [row.name,row.product_code,row.location_name,projects.find(project=>project.id===row.project_id)?.name].filter(Boolean).join(' ')}
        emptyText="ยังไม่มี Stock แยกโครงการ"
        exportFileName="wisdomai-project-stock"
        initialRowsPerPage={25}
        columns={[
          {id:'code',label:'รหัสสินค้า',render:row=>row.product_code??'-'},
          {id:'name',label:'สินค้า',minWidth:260,render:row=>row.name},
          {id:'location',label:'คลัง/จุดเก็บ',minWidth:180,render:row=>row.location_name??'-'},
          {id:'project',label:'โครงการเจ้าของ Stock',minWidth:220,render:row=>projects.find(project=>project.id===row.project_id)?.name??'คลังกลาง'},
          {id:'balance',label:'คงเหลือ',align:'right',render:row=>`${Number(row.balance_quantity).toLocaleString('th-TH')} ${row.unit??''}`,sortValue:row=>Number(row.balance_quantity)},
          {id:'cost',label:'ต้นทุนเฉลี่ย',align:'right',render:row=>money(row.average_unit_cost)},
          {id:'value',label:'มูลค่า Stock',align:'right',render:row=>money(Number(row.balance_quantity)*Number(row.average_unit_cost))},
          {id:'action',label:'ดำเนินการ',exportable:false,sortable:false,render:row=><Button size="small" variant="outlined" disabled={Number(row.balance_quantity)<=0||!row.location_id} onClick={()=>openStockOperation(row)}>เบิก/โอน</Button>},
        ]}
      />
    )
  }

  return <Stack spacing={3}>
    <PageHeader title="เอกสารบัญชีและสต๊อก" description="ตรวจเอกสาร กำหนดโครงการ/WBS หมวดต้นทุน รหัสบัญชี และแบ่งค่าใช้จ่ายหลายโครงการก่อนอนุมัติ" action={<Button startIcon={<RefreshOutlinedIcon />} onClick={() => void loadData()}>รีเฟรช</Button>} />
    {error && <Alert severity="error">{error}</Alert>}{success && <Alert severity="success">{success}</Alert>}
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3,1fr)' }, gap: 2 }}>
      {([['รอตรวจสอบ', money(pendingAmount), 'warning.main'], ['ยืนยันแล้ว', money(confirmedAmount), 'success.main'], ['เอกสารซ้ำ', `${documents.filter(item => item.status === 'duplicate').length} รายการ`, 'error.main']] as const).map(([label, value, color]) => <Paper key={label} variant="outlined" sx={{ p: 2, borderTop: 3, borderTopColor: color }}><Typography color="text.secondary">{label}</Typography><Typography variant="h5" sx={{ fontWeight: 800 }}>{value}</Typography></Paper>)}
    </Box>
    <Paper variant="outlined"><Tabs value={tab} onChange={(_event, value) => setTab(value)} variant="scrollable"><Tab label="เอกสารและเส้นทางจัดซื้อ" /><Tab label="Match Flow" /><Tab label={`รายการราคาสินค้า (${productPrices.length})`} /><Tab label="Stock รวม" /><Tab label="Stock แยกโครงการ/คลัง" /></Tabs></Paper>
    {renderTabContent()}

    <Drawer anchor="right" open={Boolean(selectedSlip)} onClose={closeSlipDetail} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 680 }, p: 0 } } }}>
      {selectedSlip && <Stack sx={{ minHeight: '100%' }}>
        <Box sx={{ position: 'sticky', top: 0, zIndex: 2, bgcolor: 'background.paper', px: 3, pt: 2.5, borderBottom: 1, borderColor: 'divider' }}><Typography variant="overline" color="text.secondary">Accounting Pending Queue</Typography><Typography variant="h5" sx={{ fontWeight: 800 }}>ตรวจสลิปโอนเงิน</Typography><Typography variant="body2" sx={{ fontFamily: 'monospace' }}>Document ID: {selectedSlip.intakeId ?? selectedSlip.itemId}</Typography>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Chip color="primary" label="ปลายทางแรก: บัญชี" />
          <Chip color={transferSlipQueueBucket(selectedSlip) === 'duplicate' ? 'error' : transferSlipQueueBucket(selectedSlip) === 'incomplete' ? 'warning' : transferSlipQueueBucket(selectedSlip) === 'reviewed' ? 'success' : 'info'} label={transferSlipQueueBucket(selectedSlip) === 'duplicate' ? 'รายการซ้ำ' : transferSlipQueueBucket(selectedSlip) === 'incomplete' ? 'ข้อมูลไม่ครบ' : transferSlipQueueBucket(selectedSlip) === 'reviewed' ? 'ตรวจแล้ว' : 'รอตรวจ'} />
          {transferSlipContinuation(selectedSlip).label && <Chip color="secondary" label={transferSlipContinuation(selectedSlip).label} />}
        </Stack>
        <Tabs value={slipDetailTab} onChange={(_event, value) => setSlipDetailTab(value)} variant="fullWidth" sx={{ mt: 1 }}><Tab label="1. รูปต้นฉบับและ AI" /><Tab label="2. ตรวจและแก้ข้อมูล" /></Tabs></Box>
        <Stack spacing={2} sx={{ p: 3, flex: 1 }}>
        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}{success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}
        {slipDetailTab === 0 && <>
        {slipDetailLoading && <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><CircularProgress size={18} /><Typography variant="body2">กำลังโหลดรูปและ Audit…</Typography></Stack>}
        {slipPreviewMessage && <Alert severity="info">{slipPreviewMessage}</Alert>}
        {slipPreviewFiles.length > 1 && <Stack direction="row" spacing={.5} useFlexGap sx={{ flexWrap: 'wrap' }}>{slipPreviewFiles.map((file, index) => <Button key={file.url} size="small" variant={index === slipPreviewIndex ? 'contained' : 'outlined'} onClick={() => setSlipPreviewIndex(index)}>{file.label}</Button>)}</Stack>}
        {activeSlipPreview && <>
          <Button component="a" href={activeSlipPreview.url} target="_blank" rel="noreferrer" variant="outlined" endIcon={<OpenInNewOutlinedIcon />}>เปิดไฟล์จริงในแท็บใหม่</Button>
          {activeSlipPreview.contentType?.startsWith('image/') ? <Box component="img" src={activeSlipPreview.url} alt="รูปสลิปต้นฉบับ" sx={{ width: '100%', maxHeight: 480, objectFit: 'contain', borderRadius: 1, bgcolor: 'grey.100' }} /> : <Box component="iframe" title="ไฟล์สลิปต้นฉบับ" src={activeSlipPreview.url} sx={{ width: '100%', height: 420, border: 0, borderRadius: 1 }} />}
        </>}
        <TextField multiline minRows={2} label="คำแนะนำให้ AI อ่านใหม่ (ไม่บังคับ)" placeholder="เช่น เน้นอ่านวันที่ เวลา เลขอ้างอิง และชื่อผู้โอนจากภาพเท่านั้น" value={slipAiGuidance} onChange={event => setSlipAiGuidance(event.target.value.slice(0, 500))} helperText={`${slipAiGuidance.length}/500 · AI จะไม่ยืนยันรายการแทน Admin`} />
        <Button variant="contained" disabled={!canManage || slipActionLoading || !activeSlipPreview} onClick={() => void rereadSelectedSlip()}>{slipActionLoading ? 'AI กำลังอ่าน…' : 'ให้ AI อ่านสลิปใหม่'}</Button>
        <Paper variant="outlined" sx={{ p: 1.5 }}><Typography variant="subtitle2" sx={{ fontWeight: 800 }}>Source Reference</Typography><Typography variant="body2">{selectedSlip.sourceChannel ?? 'ไม่ระบุ'} · {selectedSlip.sourceRoomName ?? 'ไม่ระบุห้อง'} · {selectedSlip.sourceSenderName ?? 'ไม่ระบุผู้ส่ง'}</Typography><Typography variant="caption" color="text.secondary">Message ID: {selectedSlip.sourceMessageId ?? '-'}</Typography></Paper>
        </>}
        {slipDetailTab === 1 && slipReviewDraft && slipMoneyLineageDraft && <>
          <Alert severity="info">ข้อมูลใช้งานจริงมีชุดเดียวจาก Canonical projection เท่านั้น รูปสลิปและค่าที่ AI อ่านเป็นหลักฐานอ้างอิง ไม่ใช่ข้อมูลธุรกิจและห้ามนำไปลงบัญชีก่อนยืนยัน ระบบเก็บ Source และ Audit เดิมเพื่อย้อนตรวจได้</Alert>
          {slipAnalysis && <TransferSlipAnalysisGateCard analysis={slipAnalysis} />}
          {slipAdvancePartyMatch?.applicable && <Paper variant="outlined" sx={{ p: 1.5, borderLeft: 4, borderLeftColor: slipAdvancePartyMatch.ready ? 'success.main' : 'warning.main' }}><Stack spacing={1}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}><Typography sx={{ fontWeight: 800, flex: 1 }}>ตรวจข้อมูล 2 ฝั่ง · เงินเบิกล่วงหน้า</Typography><Chip size="small" color={slipAdvancePartyMatch.ready ? 'success' : 'warning'} label={slipAdvancePartyMatch.applied ? 'เชื่อมและบันทึกแล้ว' : slipAdvancePartyMatch.ready ? 'พร้อมเชื่อมอัตโนมัติเมื่อยืนยัน' : 'ต้องแก้เฉพาะข้อมูลที่ขาด'} /></Stack>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
              <Box><Typography variant="body2"><strong>ฝั่งผู้จ่าย/ผู้ถือเงิน:</strong> {slipAdvancePartyMatch.holderName ?? 'ยังจับคู่ไม่ได้'}</Typography><Typography variant="caption" color={slipAdvancePartyMatch.senderBankLinked ? 'success.main' : 'text.secondary'}>{slipAdvancePartyMatch.senderBankLinked ? 'บัญชีผู้โอนเชื่อมแล้ว' : 'จะเชื่อมบัญชีผู้โอนเมื่อยืนยัน'}</Typography></Box>
              <Box><Typography variant="body2"><strong>ฝั่งผู้รับ/พนักงาน:</strong> {slipAdvancePartyMatch.recipientName ?? 'ยังจับคู่ไม่ได้'}</Typography><Typography variant="caption" color={slipAdvancePartyMatch.recipientBankLinked ? 'success.main' : 'text.secondary'}>{slipAdvancePartyMatch.recipientBankLinked ? 'บัญชีผู้รับเชื่อมแล้ว' : 'จะสร้างและเชื่อมบัญชีผู้รับเมื่อยืนยัน'}</Typography></Box>
            </Box>
            {slipAdvancePartyMatch.blockers.length > 0 && <Alert severity="warning">{slipAdvancePartyMatch.blockers.join(' · ')}</Alert>}
            {slipAdvancePartyMatch.ready && !slipAdvancePartyMatch.applied && <Typography variant="caption" color="text.secondary">เมื่อกด “ยืนยันการจัดสรรและส่งปลายทาง” ระบบจะบันทึกการเชื่อมทั้งสองฝั่ง, Alias, บัญชีธนาคาร และ Audit ด้วย Transaction เดิมโดยไม่สร้างรายการซ้ำ</Typography>}
          </Stack></Paper>}
          <Paper variant="outlined" sx={{ p: 1.5, borderLeft: 4, borderLeftColor: 'primary.main' }}><Stack spacing={1}>
            <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>เส้นทางเอกสารและเส้นทางเงิน</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} useFlexGap sx={{ alignItems: { sm: 'center' }, flexWrap: 'wrap' }}><Chip label="ต้นทาง: Intake" /><Typography>→</Typography><Chip color="primary" label="ปัจจุบัน: บัญชีตรวจสลิป" /><Typography>→</Typography><Chip color={slipMoneyLineageDraft.allocations.some(allocation => allocation.purposeType === 'unknown') ? 'warning' : 'secondary'} label={`ถัดไป: ${moneyAllocationDestinations(slipMoneyLineageDraft.allocations).map(route => route.replace('บัญชี → ', '')).join(' + ')}`} /></Stack>
            {slipMoneyLineageStatus && <Typography variant="caption" color="text.secondary">สถานะสายเงิน: {slipMoneyLineageStatus.routeStatus} · ปลายทางระบบ: {slipMoneyLineageStatus.nextDestination}</Typography>}
          </Stack></Paper>
          <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'grey.50' }}><Stack spacing={1}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>1. หลักฐานเดิมจากสลิป · อ่านอย่างเดียว</Typography>
              <Chip size="small" label="SOURCE / ไม่เขียนทับ" />
            </Stack>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
              <Typography variant="body2"><strong>ผู้โอนตามหลักฐาน:</strong> {selectedSlip.senderName ?? 'อ่านไม่ได้'}</Typography>
              <Typography variant="body2"><strong>บัญชีผู้โอน:</strong> {selectedSlip.senderBankName ?? 'ไม่ระบุ'} · •••• {selectedSlip.senderAccountLast4 ?? '----'}</Typography>
              <Typography variant="body2"><strong>ผู้รับตามหลักฐาน:</strong> {selectedSlip.recipientName ?? 'อ่านไม่ได้'}</Typography>
              <Typography variant="body2"><strong>บัญชีผู้รับ:</strong> {selectedSlip.recipientBankName ?? 'ไม่ระบุ'} · •••• {selectedSlip.recipientAccountLast4 ?? '----'}</Typography>
              <Typography variant="body2"><strong>ยอดตามหลักฐาน:</strong> {money(selectedSlip.amount)}</Typography>
              <Typography variant="body2"><strong>เวลาโอน:</strong> {selectedSlip.transferAt ? new Date(selectedSlip.transferAt).toLocaleString('th-TH') : 'ไม่ระบุ'}</Typography>
            </Box>
            <Typography variant="caption" color="text.secondary">แหล่งอ้างอิง: Document ID {selectedSlip.intakeId ?? selectedSlip.itemId} · Message ID {selectedSlip.sourceMessageId ?? '-'}</Typography>
          </Stack></Paper>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>2. ค่าที่อ่านจากหลักฐาน · Candidate สำหรับตรวจ</Typography>
            <Chip size="small" color="warning" label="ยังไม่ใช่ข้อมูลใช้งานจริง" />
          </Stack>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
            <TextField label="วันที่และเวลาโอน" type="datetime-local" value={slipReviewDraft.transferAt} onChange={event => setSlipReviewDraft(current => current && ({ ...current, transferAt: event.target.value }))} slotProps={{ inputLabel: { shrink: true } }} />
            <TextField label="จำนวนเงินตามสลิป" type="number" value={slipReviewDraft.amount} onChange={event => { const amount = event.target.value; setSlipReviewDraft(current => current && ({ ...current, amount })); setSlipMoneyLineageDraft(current => current && ({ ...current, paidAmount: amount, remainingAmount: calculateUnallocatedAmount(amount === '' ? null : Number(amount), current.allocations, current.returnedAmount) })) }} />
            <TextField label="ชื่อผู้โอน" value={slipReviewDraft.senderName} onChange={event => setSlipReviewDraft(current => current && ({ ...current, senderName: event.target.value }))} />
            <TextField select label="ช่องทางผู้โอน" value={slipReviewDraft.senderPaymentMethod} onChange={event => setSlipReviewDraft(current => current && ({ ...current, senderPaymentMethod: event.target.value as PaymentMethod }))}>{(['bank_account','promptpay','unknown'] as PaymentMethod[]).map(value => <MenuItem key={value} value={value}>{paymentMethodLabel(value)}</MenuItem>)}</TextField>
            {slipReviewDraft.senderPaymentMethod === 'promptpay' ? <>
              <TextField select label="ชนิด PromptPay ผู้โอน" value={slipReviewDraft.senderAliasType} onChange={event => setSlipReviewDraft(current => current && ({ ...current, senderAliasType: event.target.value as PaymentAliasType }))}><MenuItem value="mobile">เบอร์โทรศัพท์</MenuItem><MenuItem value="national_id">เลขประจำตัวประชาชน</MenuItem><MenuItem value="tax_id">เลขภาษี/นิติบุคคล</MenuItem><MenuItem value="ewallet_id">e-Wallet ID</MenuItem><MenuItem value="unknown_masked">เห็นเฉพาะเลขปกปิด</MenuItem></TextField>
              <TextField label="PromptPay ผู้โอน" value={slipReviewDraft.senderAliasValue} error={Boolean(senderAliasError)} helperText={senderAliasError ?? 'เก็บเป็น Fingerprint และแสดงเฉพาะเลขท้าย ไม่บันทึกเลขเต็มลง Audit'} onChange={event => setSlipReviewDraft(current => current && ({ ...current, senderAliasValue: event.target.value.slice(0, 32) }))} />
            </> : <><TextField label="ธนาคารผู้โอน" value={slipReviewDraft.senderBankName} onChange={event => setSlipReviewDraft(current => current && ({ ...current, senderBankName: event.target.value }))} /><TextField label="เลขบัญชีผู้โอน 4 ตัวท้าย" value={slipReviewDraft.senderAccountLast4} onChange={event => setSlipReviewDraft(current => current && ({ ...current, senderAccountLast4: event.target.value.replace(/\D/g, '').slice(0, 4) }))} /></>}
            <TextField label="ชื่อผู้รับ" value={slipReviewDraft.recipientName} onChange={event => setSlipReviewDraft(current => current && ({ ...current, recipientName: event.target.value }))} />
            <TextField select label="ช่องทางผู้รับ" value={slipReviewDraft.recipientPaymentMethod} onChange={event => setSlipReviewDraft(current => current && ({ ...current, recipientPaymentMethod: event.target.value as PaymentMethod }))}>{(['bank_account','promptpay','unknown'] as PaymentMethod[]).map(value => <MenuItem key={value} value={value}>{paymentMethodLabel(value)}</MenuItem>)}</TextField>
            {slipReviewDraft.recipientPaymentMethod === 'promptpay' ? <>
              <TextField select label="ชนิด PromptPay ผู้รับ" value={slipReviewDraft.recipientAliasType} onChange={event => setSlipReviewDraft(current => current && ({ ...current, recipientAliasType: event.target.value as PaymentAliasType }))}><MenuItem value="mobile">เบอร์โทรศัพท์</MenuItem><MenuItem value="national_id">เลขประจำตัวประชาชน</MenuItem><MenuItem value="tax_id">เลขภาษี/นิติบุคคล</MenuItem><MenuItem value="ewallet_id">e-Wallet ID</MenuItem><MenuItem value="unknown_masked">เห็นเฉพาะเลขปกปิด</MenuItem></TextField>
              <TextField label="PromptPay ผู้รับ" value={slipReviewDraft.recipientAliasValue} error={Boolean(recipientAliasError)} helperText={recipientAliasError ?? 'ผูกกับพนักงาน/Vendor/ลูกค้าเมื่อชื่อ Canonical ตรงเพียงหนึ่งราย'} onChange={event => setSlipReviewDraft(current => current && ({ ...current, recipientAliasValue: event.target.value.slice(0, 32) }))} />
            </> : <><TextField label="ธนาคารผู้รับ" value={slipReviewDraft.recipientBankName} onChange={event => setSlipReviewDraft(current => current && ({ ...current, recipientBankName: event.target.value }))} /><TextField label="เลขบัญชีผู้รับ 4 ตัวท้าย" value={slipReviewDraft.recipientAccountLast4} onChange={event => setSlipReviewDraft(current => current && ({ ...current, recipientAccountLast4: event.target.value.replace(/\D/g, '').slice(0, 4) }))} /></>}
            <TextField label="เลขอ้างอิงธนาคาร" value={slipReviewDraft.bankReference} onChange={event => setSlipReviewDraft(current => current && ({ ...current, bankReference: event.target.value }))} sx={{ gridColumn: { sm: '1 / -1' } }} />
          </Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>3. ข้อมูลใช้งานจริงชุดเดียว · Canonical</Typography>
            <Chip
              size="small"
              color={!slipMoneyLineageStatus ? 'warning' : ['draft', 'accounting_review'].includes(slipMoneyLineageStatus.routeStatus) ? 'warning' : 'success'}
              label={!slipMoneyLineageStatus ? 'ยังไม่มีข้อมูลยืนยัน' : ['draft', 'accounting_review'].includes(slipMoneyLineageStatus.routeStatus) ? 'บันทึกแล้ว · รอยืนยัน' : 'ยืนยันแล้ว'}
            />
          </Stack>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
            <TextField select label="เงินที่จ่ายมาจากไหน" value={slipMoneyLineageDraft.fundingSourceType} onChange={event => setSlipMoneyLineageDraft(current => current && applyMoneyFundingSource(current, event.target.value as MoneyFundingSource))}><MenuItem value="unknown">ยังไม่ทราบ</MenuItem><MenuItem value="company_account">บัญชีบริษัท</MenuItem><MenuItem value="reserve_fund">เงินสำรองจ่าย</MenuItem><MenuItem value="employee_advance">เงินทดลองจ่าย/เบิกล่วงหน้า</MenuItem><MenuItem value="personal_reimbursement">เงินส่วนตัวสำรองก่อน</MenuItem></TextField>
            {(moneyFundingSourceNeedsHolder(slipMoneyLineageDraft.fundingSourceType) || (slipAnalysis && slipPurposeNeedsFundHolder(slipAnalysis.purpose))) && <><TextField label="รหัสกองเงิน / Advance ID" value={slipMoneyLineageDraft.fundingSourceReference} onChange={event => setSlipMoneyLineageDraft(current => current && ({ ...current, fundingSourceReference: event.target.value }))} />
            <TextField label="ผู้ถือเงินจริงที่ยืนยัน" value={slipMoneyLineageDraft.fundHolderName} onChange={event => setSlipMoneyLineageDraft(current => current && ({ ...current, fundHolderName: event.target.value }))} helperText="จำเป็นสำหรับเงินเบิกล่วงหน้า/เงินสำรอง/เงินคืน · ไม่เปลี่ยนชื่อบนสลิป" /></>}
            <TextField label="ผู้จ่ายจริงที่ยืนยัน" value={slipMoneyLineageDraft.payerName} onChange={event => setSlipMoneyLineageDraft(current => current && ({ ...current, payerName: event.target.value }))} helperText="ใช้สำหรับกระทบยอดและรายงาน ไม่เขียนทับผู้โอนตามหลักฐาน" />
            <TextField label="ผู้รับจริงที่ยืนยัน" value={slipMoneyLineageDraft.finalBeneficiaryName} onChange={event => setSlipMoneyLineageDraft(current => current && ({ ...current, finalBeneficiaryName: event.target.value }))} helperText="แยกจากผู้รับที่ AI/OCR อ่านจากสลิป" />
            <TextField select label="เชื่อมจากเส้นเงินก่อนหน้า (ถ้ามี)" value={slipMoneyLineageDraft.parentLineageId} onChange={event => setSlipMoneyLineageDraft(current => current && ({ ...current, parentLineageId: event.target.value }))} helperText="ใช้เชื่อม บริษัท → ผู้ถือเงิน → ค่าแรง/วัสดุ/โครงการ โดยไม่สร้างสลิปซ้ำ"><MenuItem value="">เป็นต้นทางใหม่</MenuItem>{moneyLineageOptions.map(option => <MenuItem key={option.id} value={option.id}>{option.payer_name ?? 'ไม่ทราบผู้จ่าย'} → {option.final_beneficiary_name ?? 'ไม่ทราบผู้รับ'} · {money(option.paid_amount)} · {new Date(option.updated_at).toLocaleDateString('th-TH')}</MenuItem>)}</TextField>
          </Box>

          <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 1 }}><Box><Typography variant="subtitle1" sx={{ fontWeight: 800 }}>การจัดสรรเงิน ({slipMoneyLineageDraft.allocations.length} รายการ)</Typography><Typography variant="body2" color="text.secondary">สลิปเดียวแบ่งได้หลายประเภทและหลายโครงการ แต่เงินสำรอง/ส่งต่อผู้ถือเงินต้องเป็นสลิปเฉพาะแล้วเชื่อมสลิปถัดไป</Typography></Box><Button size="small" startIcon={<AddOutlinedIcon />} onClick={() => setSlipMoneyLineageDraft(current => { if (!current) return current; const allocation = emptyMoneyAllocation(null, current.finalBeneficiaryName); const allocations = [...current.allocations, allocation]; return { ...current, allocations, remainingAmount: calculateUnallocatedAmount(slipTransferAmount, allocations, current.returnedAmount) } })}>เพิ่มรายการจัดสรร</Button></Stack>
          {slipMoneyLineageDraft.allocations.map((allocation, index) => <Paper key={allocation.key} variant="outlined" sx={{ p: 1.5, borderLeft: 4, borderLeftColor: allocation.purposeType === 'unknown' ? 'warning.main' : 'success.main' }}><Stack spacing={1.25}>
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Typography sx={{ fontWeight: 800 }}>รายการที่ {index + 1} · {moneyPurposeRoute(allocation.purposeType, allocation.payrollKind).label}</Typography><IconButton size="small" color="error" disabled={slipMoneyLineageDraft.allocations.length === 1} onClick={() => setSlipMoneyLineageDraft(current => { if (!current) return current; const allocations = current.allocations.filter(item => item.key !== allocation.key); return { ...current, allocations, remainingAmount: calculateUnallocatedAmount(slipTransferAmount, allocations, current.returnedAmount) } })}><DeleteOutlineIcon fontSize="small" /></IconButton></Stack>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
              <TextField select size="small" label="1. วัตถุประสงค์/ปลายทาง" value={allocation.purposeType} onChange={event => setSlipMoneyLineageDraft(current => current && ({ ...current, allocations: current.allocations.map(item => item.key === allocation.key ? { ...item, purposeType: event.target.value as MoneyPurpose, payrollKind: event.target.value === 'payroll' ? item.payrollKind : '', costCategoryId: '', accountCode: '', accountName: '', ...(['general_expense','vendor_payment','bank_fee','tax','inter_account','cash_withdrawal'].includes(event.target.value) ? { projectId: '', siteId: '' } : {}) } : item) }))} sx={{ gridColumn: { sm: '1 / -1' } }}><MenuItem value="unknown">ยังไม่ชัดเจน</MenuItem><MenuItem value="payroll">เงินเดือน/ค่าแรง</MenuItem><MenuItem value="advance_transfer">เติมเงินสำรอง/เบิกล่วงหน้า</MenuItem><MenuItem value="materials">ซื้อวัสดุ/อุปกรณ์</MenuItem><MenuItem value="project_expense">ค่าใช้จ่ายโครงการ</MenuItem><MenuItem value="vendor_payment">จ่ายผู้ขายผ่านบัญชีบุคคล (เงินสำรองจ่าย)</MenuItem><MenuItem value="subcontractor">ผู้รับเหมา/ผู้รับเหมาช่วง</MenuItem><MenuItem value="travel">เดินทาง/หน้างาน</MenuItem><MenuItem value="bank_fee">ค่าธรรมเนียมธนาคาร</MenuItem><MenuItem value="tax">ภาษี</MenuItem><MenuItem value="refund_return">เงินคืน/คืนเงินสำรอง</MenuItem><MenuItem value="inter_account">โอนระหว่างบัญชี</MenuItem><MenuItem value="cash_withdrawal">ถอนเงินสด</MenuItem><MenuItem value="general_expense">ค่าใช้จ่ายทั่วไป</MenuItem><MenuItem value="onward_transfer">ส่งต่อให้ผู้ถือเงินอีกคน</MenuItem></TextField>
              <Box sx={{ gridColumn: { sm: '1 / -1' }, p: 1.25, border: 1, borderColor: moneyPurposeNeedsExpenseAccount(allocation.purposeType) && !allocation.costCategoryId ? 'warning.main' : 'divider', borderRadius: 1.5, bgcolor: moneyPurposeNeedsExpenseAccount(allocation.purposeType) && !allocation.costCategoryId ? 'warning.50' : 'background.paper' }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.5} sx={{ mb: 1, justifyContent: 'space-between', alignItems: { sm: 'center' } }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>2. เลือกรายการบัญชีค่าใช้จ่าย</Typography>
                  <Chip size="small" color={moneyPurposeNeedsExpenseAccount(allocation.purposeType) ? 'warning' : 'default'} label={moneyPurposeNeedsExpenseAccount(allocation.purposeType) ? 'จำเป็นก่อนยืนยัน' : 'ไม่บังคับสำหรับเงินคุมยอด'} />
                </Stack>
                <TextField fullWidth select size="small" label="รายการบัญชีจากข้อมูลกลาง" value={allocation.costCategoryId} onChange={event => setSlipMoneyLineageDraft(current => current && ({ ...current, allocations: current.allocations.map(item => {
                  if (item.key !== allocation.key) return item
                  const category = categories.find(option => option.id === event.target.value)
                  return { ...item, costCategoryId: event.target.value, accountCode: category?.default_account_code ?? '', accountName: category?.default_account_name ?? '' }
                }) }))} helperText={allocation.accountCode ? `เลือกแล้ว: บัญชี ${allocation.accountCode} · ${allocation.accountName}` : moneyPurposeNeedsExpenseAccount(allocation.purposeType) ? 'เปิด List แล้วเลือกรายการบัญชีก่อนยืนยันส่งต่อ' : 'เลือกได้หากต้องการผูกบัญชี แต่รายการเงินคุมยอดไม่บังคับ'}>
                  <MenuItem value="">ยังไม่เลือกบัญชี</MenuItem>
                  {categories.filter(category => category.default_account_code && category.default_account_name).map(category => <MenuItem key={category.id} value={category.id}>{category.code} · {category.name_th} → {category.default_account_code} {category.default_account_name}</MenuItem>)}
                </TextField>
              </Box>
              <TextField size="small" type="number" label="3. จำนวนเงินที่จัดสรร" value={allocation.amount} onChange={event => { const amount = event.target.value; setSlipMoneyLineageDraft(current => { if (!current) return current; const allocations = current.allocations.map(item => item.key === allocation.key ? { ...item, amount } : item); return { ...current, allocations, remainingAmount: calculateUnallocatedAmount(slipTransferAmount, allocations, current.returnedAmount) } }) }} sx={{ gridColumn: { sm: '1 / -1' } }} />
              {allocation.purposeType === 'payroll' && <TextField select size="small" label="ชนิดเงินเดือน/ค่าแรง" value={allocation.payrollKind} onChange={event => setSlipMoneyLineageDraft(current => current && ({ ...current, allocations: current.allocations.map(item => item.key === allocation.key ? { ...item, payrollKind: event.target.value as PayrollKind } : item) }))}><MenuItem value="">กรุณาเลือก</MenuItem><MenuItem value="salary">เงินเดือน</MenuItem><MenuItem value="daily_wage">ค่าแรงรายวัน</MenuItem><MenuItem value="contract_labor">ค่าจ้างเหมาแรงงาน</MenuItem><MenuItem value="other">ค่าตอบแทนอื่น</MenuItem></TextField>}
              {slipPurposeNeedsProject(allocation.purposeType) && <><TextField select size="small" label="โครงการ (จำเป็นสำหรับประเภทนี้)" value={allocation.projectId} onChange={event => setSlipMoneyLineageDraft(current => current && ({ ...current, allocations: current.allocations.map(item => item.key === allocation.key ? { ...item, projectId: event.target.value, siteId: '' } : item) }))}><MenuItem value="">ยังไม่เลือกโครงการ</MenuItem>{projects.map(project => <MenuItem key={project.id} value={project.id}>{project.code ? `${project.code} · ` : ''}{project.name}</MenuItem>)}</TextField>
              <TextField select size="small" label="ไซต์งาน" value={allocation.siteId} onChange={event => setSlipMoneyLineageDraft(current => current && ({ ...current, allocations: current.allocations.map(item => item.key === allocation.key ? { ...item, siteId: event.target.value } : item) }))}><MenuItem value="">ไม่ระบุไซต์</MenuItem>{sites.filter(site => site.project_id === allocation.projectId).map(site => <MenuItem key={site.id} value={site.id}>{site.name}</MenuItem>)}</TextField></>}
              <TextField size="small" label="ผู้รับ/ผู้ขาย/ช่าง" value={allocation.payeeName} onChange={event => setSlipMoneyLineageDraft(current => current && ({ ...current, allocations: current.allocations.map(item => item.key === allocation.key ? { ...item, payeeName: event.target.value } : item) }))} />
              {(slipPurposeNeedsProject(allocation.purposeType) || slipPurposeNeedsFundHolder(allocation.purposeType) || allocation.purposeType === 'payroll') && <TextField size="small" label="ผู้รับผิดชอบขั้นตอนถัดไป" value={allocation.responsibleName} onChange={event => setSlipMoneyLineageDraft(current => current && ({ ...current, allocations: current.allocations.map(item => item.key === allocation.key ? { ...item, responsibleName: event.target.value } : item) }))} />}
              <TextField size="small" label="รายละเอียดการใช้เงิน" value={allocation.description} onChange={event => setSlipMoneyLineageDraft(current => current && ({ ...current, allocations: current.allocations.map(item => item.key === allocation.key ? { ...item, description: event.target.value } : item) }))} sx={{ gridColumn: { sm: '1 / -1' } }} />
              {allocation.purposeType === 'vendor_payment' && <>
                <Alert severity="info" sx={{ gridColumn: { sm: '1 / -1' } }}>เลือก “เงินที่จ่ายมาจากไหน = เงินสำรองจ่าย” ด้านบน · ผู้รับในสลิปเป็นเจ้าของบัญชีบุคคล ส่วนร้านค้าจริงให้เลือกจากทะเบียนด้านล่าง ระบบเก็บสองฝ่ายแยกกัน</Alert>
                <TextField select size="small" label="ร้านค้า/ผู้ขายจากทะเบียน" value={allocation.vendorId} onChange={event => setSlipMoneyLineageDraft(current => current && ({ ...current, allocations: current.allocations.map(item => {
                  if (item.key !== allocation.key) return item
                  const vendor = vendors.find(option => option.id === event.target.value)
                  return { ...item, vendorId: event.target.value, vendorName: vendor?.name ?? item.vendorName, vendorTaxId: vendor?.tax_id ?? item.vendorTaxId, vendorMatchStatus: (event.target.value ? 'matched' : 'needs_review') as VendorMatchStatus, vendorMatchConfidence: event.target.value ? '1' : '', vendorMatchReason: event.target.value ? 'Admin เลือกจาก Vendor Master และตรวจหลักฐานแล้ว' : '' }
                }) }))}>
                  <MenuItem value="">ยังไม่จับคู่ร้านค้า</MenuItem>
                  {vendors.map(vendor => <MenuItem key={vendor.id} value={vendor.id}>{vendor.name}{vendor.tax_id ? ` · เลขภาษี ${vendor.tax_id}` : ''}</MenuItem>)}
                </TextField>
                <TextField size="small" label="ชื่อร้านค้าจากหลักฐาน (ถ้ามี)" value={allocation.vendorName} onChange={event => setSlipMoneyLineageDraft(current => current && ({ ...current, allocations: current.allocations.map(item => item.key === allocation.key ? { ...item, vendorName: event.target.value, vendorMatchStatus: item.vendorId ? item.vendorMatchStatus : 'candidate' as VendorMatchStatus } : item) }))} />
                <TextField size="small" label="เลขภาษีร้านค้า" value={allocation.vendorTaxId} onChange={event => setSlipMoneyLineageDraft(current => current && ({ ...current, allocations: current.allocations.map(item => item.key === allocation.key ? { ...item, vendorTaxId: event.target.value } : item) }))} />
                <TextField size="small" label="ธนาคารบัญชีร้านค้า" value={allocation.vendorBankName} onChange={event => setSlipMoneyLineageDraft(current => current && ({ ...current, allocations: current.allocations.map(item => item.key === allocation.key ? { ...item, vendorBankName: event.target.value } : item) }))} />
                <TextField size="small" label="เลขบัญชีร้านค้า (ท้าย 4 หลัก)" value={allocation.vendorAccountLast4} slotProps={{ htmlInput: { maxLength: 4 } }} onChange={event => setSlipMoneyLineageDraft(current => current && ({ ...current, allocations: current.allocations.map(item => item.key === allocation.key ? { ...item, vendorAccountLast4: event.target.value.replace(/\D/g, '').slice(0, 4) } : item) }))} />
                <TextField size="small" label="เหตุผล/หลักฐานการจับคู่" value={allocation.vendorMatchReason} onChange={event => setSlipMoneyLineageDraft(current => current && ({ ...current, allocations: current.allocations.map(item => item.key === allocation.key ? { ...item, vendorMatchReason: event.target.value } : item) }))} helperText={allocation.vendorMatchStatus === 'matched' ? 'ยืนยันแล้ว: ผู้จ่ายในสลิปยังคงแยกจากร้านค้านี้' : 'ถ้าไม่ชัด ให้บันทึกร่าง/ขอข้อมูลเพิ่ม ห้ามเดาร้านค้า'} sx={{ gridColumn: { sm: '1 / -1' } }} />
              </>}
            </Box>
          </Stack></Paper>)}

          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>กระทบยอดสลิป</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4,1fr)' }, gap: 1.5 }}>
            <TextField label="ยอดตามสลิป" value={slipTransferAmount == null ? '' : slipTransferAmount} slotProps={{ input: { readOnly: true } }} />
            <TextField label="รวมจัดสรร" value={slipAllocationTotal} slotProps={{ input: { readOnly: true } }} />
            <TextField type="number" label="ยอดคืน/หักออก" value={slipMoneyLineageDraft.returnedAmount} onChange={event => { const returnedAmount = event.target.value; setSlipMoneyLineageDraft(current => current && ({ ...current, returnedAmount, remainingAmount: calculateUnallocatedAmount(slipTransferAmount, current.allocations, returnedAmount) })) }} />
            <TextField label="ยังไม่จัดสรร" value={slipMoneyLineageDraft.remainingAmount} slotProps={{ input: { readOnly: true } }} />
          </Box>
          {(slipLineageValidation.missing.length > 0 || slipLineageValidation.errors.length > 0) && <Alert severity="warning"><Typography variant="body2" sx={{ fontWeight: 700 }}>ยังส่งปลายทางไม่ได้</Typography>{[...slipLineageValidation.missing.map(value => `ขาด ${value}`), ...slipLineageValidation.errors].map(message => <Typography key={message} variant="body2">• {message}</Typography>)}</Alert>}
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Typography variant="subtitle1" sx={{ fontWeight: 800 }}>ทอดการส่งเงิน ({slipMoneyLineageDraft.hops.length})</Typography><Button size="small" startIcon={<AddOutlinedIcon />} onClick={() => setSlipMoneyLineageDraft(current => current && ({ ...current, hops: [...current.hops, { fromParty: current.hops.at(-1)?.toParty ?? '', toParty: '', amount: current.hops.at(-1)?.amount ?? current.paidAmount, transferredAt: '', note: '' }] }))}>เพิ่มทอด</Button></Stack>
          {slipMoneyLineageDraft.hops.map((hop, index) => <Paper key={index} variant="outlined" sx={{ p: 1.25 }}><Stack spacing={1}><Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Typography sx={{ fontWeight: 700 }}>ทอดที่ {index + 1}</Typography><IconButton size="small" color="error" disabled={slipMoneyLineageDraft.hops.length === 1} onClick={() => setSlipMoneyLineageDraft(current => current && ({ ...current, hops: current.hops.filter((_value, hopIndex) => hopIndex !== index) }))}><DeleteOutlineIcon fontSize="small" /></IconButton></Stack><Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}><TextField size="small" label="จากใคร" value={hop.fromParty} onChange={event => setSlipMoneyLineageDraft(current => current && ({ ...current, hops: current.hops.map((value, hopIndex) => hopIndex === index ? { ...value, fromParty: event.target.value } : value) }))} /><TextField size="small" label="ถึงใคร" value={hop.toParty} onChange={event => setSlipMoneyLineageDraft(current => current && ({ ...current, hops: current.hops.map((value, hopIndex) => hopIndex === index ? { ...value, toParty: event.target.value } : value) }))} /><TextField size="small" type="number" label="จำนวนเงิน" value={hop.amount} onChange={event => setSlipMoneyLineageDraft(current => current && ({ ...current, hops: current.hops.map((value, hopIndex) => hopIndex === index ? { ...value, amount: event.target.value } : value) }))} /><TextField size="small" type="datetime-local" label="วันเวลา" value={hop.transferredAt} onChange={event => setSlipMoneyLineageDraft(current => current && ({ ...current, hops: current.hops.map((value, hopIndex) => hopIndex === index ? { ...value, transferredAt: event.target.value } : value) }))} slotProps={{ inputLabel: { shrink: true } }} /><TextField size="small" label="หมายเหตุทอดนี้" value={hop.note} onChange={event => setSlipMoneyLineageDraft(current => current && ({ ...current, hops: current.hops.map((value, hopIndex) => hopIndex === index ? { ...value, note: event.target.value } : value) }))} sx={{ gridColumn: { sm: '1 / -1' } }} /></Box></Stack></Paper>)}
          <TextField multiline minRows={2} label="หมายเหตุ/ข้อมูลที่ต้องขอเพิ่ม" value={slipMoneyLineageDraft.note} onChange={event => { const note = event.target.value; setSlipMoneyLineageDraft(current => current && ({ ...current, note })); setSlipReviewDraft(current => current && ({ ...current, note })) }} />
          <Paper variant="outlined" sx={{ p: 1.5 }}><Typography variant="body2">AI confidence: {selectedSlip.analysisConfidence == null ? '-' : `${Math.round(selectedSlip.analysisConfidence * 100)}%`} · Payment fields: {selectedSlip.paymentPartyConfidence == null ? '-' : `${Math.round(selectedSlip.paymentPartyConfidence * 100)}%`}</Typography><Typography variant="caption" color="text.secondary">Model: {selectedSlip.analysisModel ?? '-'}</Typography></Paper>
        </>}
        <Accordion disableGutters><AccordionSummary><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Typography sx={{ fontWeight: 800 }}>Source/Audit Flow</Typography><Chip size="small" label={`${slipEvents.length} Events`} /></Stack></AccordionSummary><AccordionDetails><Stack spacing={1}>
          {slipEvents.length === 0 && !slipDetailLoading && <Typography variant="body2" color="text.secondary">ยังไม่พบ Audit Event</Typography>}
          {slipEvents.map(event => <Box key={event.id} sx={{ borderLeft: 3, borderColor: 'primary.light', pl: 1.25 }}><Typography variant="body2" sx={{ fontWeight: 700 }}>{event.event_type}</Typography><Typography variant="caption" color="text.secondary">{event.from_flow ?? '-'} / {event.from_state ?? '-'} → {event.to_flow ?? '-'} / {event.to_state ?? '-'} · {new Date(event.created_at).toLocaleString('th-TH')}</Typography>{event.note && <Typography variant="body2">{event.note}</Typography>}</Box>)}
        </Stack></AccordionDetails></Accordion>
        <Button href={`/document-flows?document_view=task_types&item_id=${encodeURIComponent(selectedSlip.itemId)}`} variant="text">เปิดในศูนย์เส้นทางเอกสาร</Button>
        </Stack>
        {slipDetailTab === 1 && <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ position: 'sticky', bottom: 0, bgcolor: 'background.paper', borderTop: 1, borderColor: 'divider', p: 2, zIndex: 2 }}><Button disabled={!canManage || slipActionLoading} onClick={() => void saveSlipReview('draft')}>บันทึกฉบับร่าง</Button><Button color="warning" variant="outlined" disabled={!canManage || slipActionLoading || !slipMoneyLineageDraft?.note.trim()} onClick={() => void saveSlipReview('request_information')}>ขอข้อมูลเพิ่ม</Button><Button color="success" variant="contained" disabled={!canManage || slipActionLoading || Boolean(senderAliasError || recipientAliasError) || slipLineageValidation.missing.length > 0 || slipLineageValidation.errors.length > 0} onClick={() => void saveSlipReview('confirm')}>{slipActionLoading ? 'กำลังบันทึกและส่งต่อ…' : 'ยืนยันการจัดสรรและส่งปลายทาง'}</Button></Stack>}
      </Stack>}
    </Drawer>

    <Dialog open={Boolean(selected)} onClose={() => !saving && setSelected(null)} maxWidth="xl" fullWidth slotProps={{paper:{sx:{height:'94vh'}}}}>
      <DialogTitle sx={{py:1.25}}><Stack direction="row" spacing={1} sx={{alignItems:'center',justifyContent:'space-between'}}><span>ตรวจสอบเอกสาร: {selected ? documentLabels[documentType] ?? documentType : ''}</span>{selected&&['pending','needs_correction'].includes(selected.status)&&<Chip size="small" color={hasUnsavedDraftChanges?'warning':'success'} variant={hasUnsavedDraftChanges?'filled':'outlined'} label={hasUnsavedDraftChanges?'โหมดแก้ไข · ยังไม่บันทึก':'บันทึกแล้ว'}/>}</Stack></DialogTitle>
      <DialogContent dividers sx={{p:1.5,'& .MuiPaper-root':{borderRadius:1.5},'& .MuiAlert-root':{py:.25}}}>{selected && <Stack spacing={1}>
        {error&&<Alert severity="error" onClose={()=>setError(null)}>บันทึกไม่สำเร็จ: {error}</Alert>}
        {success&&<Alert severity="success" onClose={()=>setSuccess(null)}>{success}</Alert>}
        <Stack direction={{ xs: 'column', md: 'row' }} sx={{ justifyContent: 'space-between', alignItems: { md: 'center' }, gap: 1 }}>
          <Typography><b>ผู้ขาย/ผู้รับเงิน:</b> {selected.vendor_name ?? 'อ่านชื่อไม่ได้'} · <b>เลขที่:</b> {selected.document_number ?? '-'} · <b>ยอด:</b> {money(selected.total_amount)}</Typography>
          <Button variant="outlined" onClick={() => void viewOriginalDocument()} disabled={previewLoading}>{previewLoading ? 'กำลังโหลดภาพ...' : 'ดูภาพต้นฉบับ'}</Button>
        </Stack>
        {documentSetMembers.length>1&&<Paper variant="outlined" sx={{p:1.25,borderTop:4,borderTopColor:'warning.main'}}><Stack spacing={1}>
          <Stack direction={{xs:'column',md:'row'}} spacing={1} sx={{alignItems:{md:'center'},justifyContent:'space-between'}}>
            <Box><Typography sx={{fontWeight:800}}>ชุดเอกสารจาก LINE {documentSetMembers.length} หน้า</Typography><Typography variant="body2" color="text.secondary">พบภาพจากผู้ส่งและกลุ่มเดียวกันภายใน 3 นาที กรุณาดูทุกหน้าก่อนยืนยัน</Typography></Box>
            {canManage&&documentSetMembers.filter(item=>!['dismissed','confirmed'].includes(item.status)).length>1&&<Stack direction="row" spacing={1}><Button variant="outlined" onClick={()=>void detachCurrentDocumentFromSet()} disabled={saving}>แยกหน้านี้ออก</Button><Button variant="contained" color="warning" onClick={()=>void mergeCurrentDocumentSet()} disabled={saving}>รวมเป็นเอกสารเดียว</Button></Stack>}
          </Stack>
          <Stack direction="row" spacing={1} sx={{flexWrap:'wrap',gap:.5}}>{documentSetMembers.map((item,index)=><Button key={item.id} size="small" variant={item.id===selected.id?'contained':'outlined'} onClick={()=>void viewDocumentAttachment(item.source_message_id)} disabled={previewLoading}>หน้า {item.page_number??index+1} · {documentLabels[item.document_type]??item.document_type}{item.status==='dismissed'?' (รวมแล้ว)':''}</Button>)}</Stack>
          <Alert severity="info">เมื่อรวมแล้ว ระบบจะเก็บภาพครบทุกหน้าและหยุดเอกสารย่อยไม่ให้ลงบัญชีซ้ำ จากนั้นให้ตรวจประเภท ผู้ขาย รายการ และยอดรวมของเอกสารหลัก</Alert>
        </Stack></Paper>}
        <Paper variant="outlined" sx={{ p: 1.25 }}><Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ alignItems: { md: 'center' } }}><Autocomplete freeSolo openOnFocus autoHighlight fullWidth size="small" options={vendors} value={vendors.find(vendor=>vendor.name===supplierName)??supplierName} getOptionLabel={option=>typeof option==='string'?option:option.name} onChange={(_event,value)=>setSupplierName(typeof value==='string'?value:value?.name??'')} onInputChange={(_event,value)=>setSupplierName(value)} isOptionEqualToValue={(option,value)=>typeof value!=='string'&&option.id===value.id} noOptionsText="ยังไม่มีผู้ขายในทะเบียน" renderOption={(props,option)=><li {...props} key={option.id}><Box><Typography>{option.name}</Typography><Typography variant="caption" color="text.secondary">{option.tax_id?`เลขผู้เสียภาษี ${option.tax_id}`:'ไม่ระบุเลขผู้เสียภาษี'}{option.phone?` · ${option.phone}`:''}</Typography></Box></li>} renderInput={params=><TextField {...params} label="ชื่อผู้ขายจริง" placeholder="เลือกผู้ขายจากทะเบียน" disabled={!canManage}/>}/><Button variant="outlined" color={!registeredVendor?'warning':'primary'} onClick={()=>void savePurchaseVendor()} disabled={!canManage||saving||!supplierName.trim()||(!supplierChanged&&Boolean(registeredVendor))}>{!supplierName.trim()?'เลือกผู้ขาย':!supplierChanged&&registeredVendor?'มีในทะเบียนแล้ว':registeredVendor?'บันทึกผู้ขายที่เลือก':'เพิ่มผู้ขายใหม่'}</Button></Stack><Typography variant="caption" color="text.secondary">{registeredVendor?'ผู้ขายนี้มีในทะเบียนแล้ว ระบบจะไม่สร้างรายการซ้ำ':supplierName.trim()?'ไม่พบชื่อนี้ในทะเบียน เมื่อบันทึกระบบจะเพิ่มเป็นผู้ขายใหม่':'คลิกช่องเพื่อเลือกรายชื่อเดิม หากไม่พบจึงพิมพ์ชื่อใหม่'}</Typography></Paper>
        <Paper variant="outlined" sx={{ p: 2 }}><Typography variant="h6" sx={{ mb: 1, fontWeight: 800 }}>ประเภทเอกสาร</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr auto' }, gap: 1.5, alignItems: 'center' }}>
            <TextField select label="ชนิดเอกสาร" value={documentType} onChange={event => setDocumentType(event.target.value)} disabled={!canManage}>
              {Object.entries(documentLabels).filter(([value]) => value !== 'transfer_slip').map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
            </TextField>
            <TextField select label="วัตถุประสงค์" value={documentPurpose} onChange={event => setDocumentPurpose(event.target.value as DocumentPurpose)} disabled={!canManage}>
              {(Object.entries(purposeLabels) as [DocumentPurpose, string][]).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
            </TextField>
            <Button variant="outlined" onClick={() => void saveDocumentType()} disabled={!canManage || saving || !classificationChanged}>{saving?'กำลังบันทึก...':classificationChanged?'บันทึกประเภท':'ประเภทบันทึกแล้ว'}</Button>
          </Box>
          <Alert severity={classificationChanged?'warning':'success'} sx={{mt:1}}>{classificationChanged?'มีการเปลี่ยนชนิดหรือวัตถุประสงค์เอกสาร กรุณากด “บันทึกประเภท”':'ไม่มีข้อมูลประเภทเปลี่ยนแปลง ระบบใช้ค่าที่บันทึกไว้แล้ว'}</Alert>
          {['other', 'unreadable'].includes(selected.document_type) && selected.status !== 'confirmed' && <FormControlLabel sx={{ mt: 1 }} control={<Checkbox checked={applyToSimilar} onChange={event => setApplyToSimilar(event.target.checked)} />} label={`จำประเภทนี้สำหรับผู้ขาย “${selected.vendor_name ?? 'ไม่ทราบชื่อ'}” และปรับเฉพาะเอกสารอื่นที่ยังรอตรวจ`} />}
          {selected.status === 'confirmed' && <Alert severity="warning" sx={{ mt: 1 }}>เอกสารยืนยันแล้ว: แก้ได้เฉพาะชนิดและวัตถุประสงค์ พร้อมบันทึก Audit โดยยอดเงินและรายการบัญชีจะไม่เปลี่ยน</Alert>}
          <Alert severity="info" sx={{ mt: 1 }}>ตัวอย่าง: ใบเสนอราคา + วัสดุ หรือ ใบเสนอราคา + ผู้รับเหมา ระบบจะไม่เปลี่ยนเอกสารที่ยืนยันแล้วอัตโนมัติ</Alert>
        </Paper>
        {documentType === 'quotation' && <Paper variant="outlined" sx={{ p: 2, borderTop: 4, borderTopColor: 'info.main' }}>
          <Stack spacing={1.5}>
            <Stack direction={{ xs: 'column', md: 'row' }} sx={{ justifyContent: 'space-between', gap: 1 }}>
              <Box><Typography variant="h6" sx={{ fontWeight: 800 }}>การตัดสินใจใบเสนอราคา</Typography><Typography color="text.secondary">สถานะปัจจุบัน: {quotationStatus}</Typography></Box>
              <Button variant="contained" onClick={() => void processQuotation()} disabled={!canManage || saving || !header.project_id}>{saving ? 'กำลังบันทึก...' : ['order_full', 'order_partial'].includes(quotationAction) ? 'อนุมัติและสร้าง PO' : 'บันทึกราคาอ้างอิง'}</Button>
            </Stack>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr' }, gap: 1 }}>
              <TextField select label="การดำเนินการ" value={quotationAction} onChange={event => setQuotationAction(event.target.value as QuotationAction)}>{(Object.entries(quotationActionLabels) as [QuotationAction, string][]).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField>
              <TextField type="date" label="ราคามีผลถึง" value={quotationValidUntil} onChange={event => setQuotationValidUntil(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
              <TextField label="เหตุผล/หมายเหตุ" value={quotationReason} onChange={event => setQuotationReason(event.target.value)} />
            </Box>
            {['order_full', 'order_partial'].includes(quotationAction) && <Stack spacing={1}>{lines.map(line => <Box key={line.id} sx={{ display: 'grid', gridTemplateColumns: '44px 1fr 150px 150px', gap: 1, alignItems: 'center' }}>
              <Checkbox checked={quotationAction==='order_full'||selectedStockLineIds.includes(line.id)} disabled={quotationAction==='order_full'} onChange={event=>setSelectedStockLineIds(current=>event.target.checked?[...new Set([...current,line.id])]:current.filter(id=>id!==line.id))}/><Typography>{line.line_number}. {line.description}</Typography><Typography variant="body2">เสนอ {line.quantity ?? 1} {line.unit ?? ''}</Typography>
              <TextField size="small" type="number" label="จำนวนที่สั่ง" value={quotationQuantities[line.id] ?? Number(line.quantity ?? 1)} disabled={quotationAction === 'order_full'} onChange={event => setQuotationQuantities(current => ({ ...current, [line.id]: Number(event.target.value) }))} />
            </Box>)}</Stack>}
          <Alert severity="info">ต้องระบุโครงการเพื่อการติดตาม แต่ยอดใบเสนอราคาเป็นราคาอ้างอิงเท่านั้น ใบเสนอราคาไม่ลงบัญชีจนกว่าจะมีใบรับของหรือใบแจ้งหนี้ และยังไม่เป็นต้นทุนจริง</Alert>
          </Stack>
        </Paper>}
        {documentType === 'quotation' && <Paper variant="outlined" sx={{p:1.5}}><Typography variant="h6" sx={{fontWeight:800,mb:1}}>รายการและราคาอ้างอิง</Typography><StandardDataTable rows={lines} getRowId={line=>line.id} getSearchText={line=>`${line.description} ${line.product_code??''}`} searchLabel="ค้นหารายการเสนอราคา" exportFileName="quotation-reference-lines" initialRowsPerPage={25} minWidth={900} columns={[
          {id:'item',label:'สินค้า/รายละเอียด',minWidth:330,render:line=><TextField fullWidth size="small" value={line.description} onChange={event=>updateLine(line.id,{description:event.target.value})} disabled={!canManage}/>,exportValue:line=>line.description},
          {id:'quantity',label:'จำนวน',minWidth:110,render:line=><TextField size="small" type="number" value={line.quantity??''} onChange={event=>updateProductDetail(line.id,{quantity:event.target.value===''?null:Number(event.target.value)})} disabled={!canManage}/>,exportValue:line=>line.quantity},
          {id:'unit',label:'หน่วย',minWidth:100,render:line=><TextField size="small" value={line.unit??''} onChange={event=>updateLine(line.id,{unit:event.target.value})} disabled={!canManage}/>,exportValue:line=>line.unit},
          {id:'price',label:'ราคา/หน่วย',minWidth:140,render:line=><TextField size="small" type="number" value={line.unit_price??''} onChange={event=>updateProductDetail(line.id,{unit_price:event.target.value===''?null:Number(event.target.value)})} disabled={!canManage}/>,exportValue:line=>line.unit_price},
          {id:'amount',label:'ยอดอ้างอิง',align:'right',render:line=>money(line.line_amount),sortValue:line=>Number(line.line_amount??0)},
          {id:'save',label:'บันทึก',sortable:false,exportable:false,render:line=><Button size="small" variant="outlined" onClick={()=>void saveQuotationReferenceLine(line)} disabled={!canManage||savingLineId===line.id||!line.description.trim()}>{savingLineId===line.id?'กำลังบันทึก...':'บันทึกราคา'}</Button>},
        ]}/><Alert severity="success" sx={{mt:1}}>รายการในตารางนี้เก็บเป็นประวัติราคาเท่านั้น ไม่เข้า Stock ไม่ลงต้นทุน และไม่สร้างเจ้าหนี้</Alert></Paper>}
        {documentType === 'goods_receipt' && <Paper variant="outlined" sx={{ p: 1.5, borderTop: 3, borderTopColor: 'success.main' }}><Stack spacing={1}>
          <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1} sx={{alignItems:{lg:'center'}}}>
            <Typography variant="h6" sx={{ fontWeight: 800, minWidth: 190 }}>รับสินค้าเข้า Stock</Typography>
            <TextField size="small" required fullWidth label="บริษัทผู้ขาย/ผู้ส่งสินค้า" value={supplierName} onChange={event => setSupplierName(event.target.value)} error={!supplierName.trim()} />
            <TextField size="small" required fullWidth label="คลัง/จุดรับสินค้า" value={receivingLocation} onChange={event => setReceivingLocation(event.target.value)} error={!receivingLocation.trim()} />
          </Stack>
          <Paper variant="outlined" sx={{ p: 1, bgcolor: 'grey.50' }}><Stack direction={{ xs: 'column', lg: 'row' }} spacing={1} sx={{alignItems:{lg:'center'}}}>
            <TextField select size="small" label="รูปแบบรับเข้า" value={bulkStockMode} onChange={event => setBulkStockMode(event.target.value as StockMode)} sx={{ minWidth: 180 }}>{(Object.entries(stockModeLabels) as [StockMode,string][]).map(([value,label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField>
            <TextField select size="small" label="โครงการหลัก" value={header.project_id} onChange={event => updateHeader('project_id',event.target.value)} disabled={bulkStockMode === 'central_stock'} sx={{ minWidth: 220 }}><MenuItem value="">ไม่ระบุ</MenuItem>{projects.map(project => <MenuItem key={project.id} value={project.id}>{project.name}</MenuItem>)}</TextField>
            <TextField select size="small" label="ไซต์" value={header.site_id} onChange={event => updateHeader('site_id',event.target.value)} disabled={bulkStockMode === 'central_stock'} sx={{ minWidth: 180 }}><MenuItem value="">ไม่ระบุ</MenuItem>{sites.filter(site => site.project_id === header.project_id).map(site => <MenuItem key={site.id} value={site.id}>{site.name}</MenuItem>)}</TextField>
            <Button variant="contained" onClick={applyStockDefaults} disabled={!selectedStockLineIds.length || (bulkStockMode !== 'central_stock' && !header.project_id)}>ใช้กับรายการที่เลือก ({selectedStockLineIds.length})</Button>
          </Stack></Paper>
          <StandardDataTable rows={lines} getRowId={line => line.id} getSearchText={line => `${line.description} ${line.product_code ?? ''}`} searchLabel="ค้นหารายการวัสดุ" exportFileName="goods-receipt-project-stock" initialRowsPerPage={25} minWidth={1250}
            columns={[
              { id:'select',label:'เลือก',sortable:false,exportable:false,render:line=><Checkbox size="small" checked={selectedStockLineIds.includes(line.id)} onChange={event=>setSelectedStockLineIds(current=>event.target.checked?[...new Set([...current,line.id])]:current.filter(id=>id!==line.id))}/> },
              { id:'item',label:'รายการ',minWidth:300,render:line=><Stack spacing={.5}><TextField size="small" label={`ชื่อสินค้า ${line.line_number}`} value={line.description} onChange={event=>updateLine(line.id,{description:event.target.value})} disabled={!canManage}/><Typography variant="caption">ตามเอกสาร {line.quantity ?? '-'} {line.unit ?? ''}</Typography><Stack direction="row"><Button size="small" onClick={()=>void saveProductName(line)} disabled={!canManage||savingLineId===line.id||!line.description.trim()}>{savingLineId===line.id?'กำลังบันทึก...':'บันทึกชื่อ'}</Button><Button size="small" onClick={()=>openProductSplit(line)}>แยกรายการสินค้า</Button></Stack></Stack>,exportValue:line=>line.description },
              { id:'received',label:'จำนวนรับ',minWidth:105,render:line=>{const review=stockReview[line.id];return review?<TextField size="small" type="number" value={review.received_quantity} onChange={event=>setStockReview(current=>({...current,[line.id]:{...review,received_quantity:Number(event.target.value)}}))}/>:null},exportValue:line=>stockReview[line.id]?.received_quantity },
              { id:'unit_price',label:'ราคาซื้อจริง/หน่วย',minWidth:145,render:line=><TextField size="small" type="number" value={line.unit_price ?? ''} onChange={event=>updateLine(line.id,{unit_price:event.target.value===''?null:Number(event.target.value)})} disabled={!canManage} slotProps={{htmlInput:{min:0,step:'0.01'}}}/>,exportValue:line=>line.unit_price },
              { id:'condition',label:'สภาพ',minWidth:125,render:line=>{const review=stockReview[line.id];return review?<TextField select size="small" value={review.condition} onChange={event=>{const condition=event.target.value as StockReviewLine['condition'];setStockReview(current=>({...current,[line.id]:{...review,condition,accepted:condition!=='rejected',...(condition==='rejected'?{received_quantity:0}:{} )}}))}}><MenuItem value="good">ปกติ</MenuItem><MenuItem value="short">รับไม่ครบ</MenuItem><MenuItem value="damaged">ชำรุด</MenuItem><MenuItem value="rejected">ปฏิเสธ</MenuItem></TextField>:null} },
              { id:'allocation',label:'คลัง/โครงการ/จำนวน',minWidth:480,render:line=>{const review=stockReview[line.id];return <Stack spacing={.5}>{review?.allocations.map((allocation,index)=><Box key={`${line.id}-${index}`} sx={{display:'grid',gridTemplateColumns:'130px 1fr 1fr 90px auto',gap:.5}}><TextField select size="small" value={allocation.mode} onChange={event=>updateStockAllocation(line.id,index,{mode:event.target.value as StockMode,...(event.target.value==='central_stock'?{project_id:'',site_id:''}:{})})}>{(Object.entries(stockModeLabels) as [StockMode,string][]).map(([value,label])=><MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField><TextField select size="small" value={allocation.project_id} disabled={allocation.mode==='central_stock'} onChange={event=>updateStockAllocation(line.id,index,{project_id:event.target.value,site_id:''})}><MenuItem value="">โครงการ</MenuItem>{projects.map(project=><MenuItem key={project.id} value={project.id}>{project.name}</MenuItem>)}</TextField><TextField select size="small" value={allocation.site_id} disabled={allocation.mode==='central_stock'} onChange={event=>updateStockAllocation(line.id,index,{site_id:event.target.value})}><MenuItem value="">ไซต์</MenuItem>{sites.filter(site=>site.project_id===allocation.project_id).map(site=><MenuItem key={site.id} value={site.id}>{site.name}</MenuItem>)}</TextField><TextField size="small" type="number" value={allocation.quantity} onChange={event=>updateStockAllocation(line.id,index,{quantity:Number(event.target.value)})}/><IconButton size="small" color="error" disabled={review.allocations.length===1} onClick={()=>setStockReview(current=>({...current,[line.id]:{...review,allocations:review.allocations.filter((_item,i)=>i!==index)}}))}><DeleteOutlineIcon fontSize="small"/></IconButton></Box>)}<Button size="small" sx={{alignSelf:'flex-start'}} startIcon={<AddOutlinedIcon/>} onClick={()=>addStockAllocation(line.id)}>แยกรายการ</Button></Stack>} },
            ]}/>
          {stockAllocationErrors.length>0 && <Alert severity="warning">{stockAllocationErrors.slice(0,3).map(message=><div key={message}>• {message}</div>)}{stockAllocationErrors.length>3&&<div>และอีก {stockAllocationErrors.length-3} รายการ</div>}</Alert>}
          <Alert severity="info" sx={{py:0}}>คลังกลาง/Stock โครงการยังไม่เป็นต้นทุนจริง ส่วน “รับและใช้ทันที” จะรับเข้าและเบิกออกโครงการในขั้นตอนเดียว พร้อมสร้าง GRNI</Alert>
        </Stack></Paper>}
        {payableDocumentTypes.includes(documentType) && documentType !== 'billing_note' && !isUtilityInvoice && <Paper variant="outlined" sx={{ p: 2, borderTop: 4, borderTopColor: 'warning.main' }}><Stack spacing={1.5}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>จับคู่เอกสารก่อนสร้างเจ้าหนี้</Typography>
          <Alert severity="info">เลือกใบรับสินค้าที่ตรวจรับแล้ว และเลือก PO ถ้ามี ระบบจะเทียบยอด PO + ใบรับสินค้า + ใบแจ้งหนี้ ก่อนสร้างเจ้าหนี้จริง</Alert>
          <TextField required label="เจ้าหนี้/ผู้ขายที่จะสร้าง" value={supplierName} onChange={event=>setSupplierName(event.target.value)} error={!supplierName.trim()} helperText="ระบบอ่านจากใบแจ้งหนี้ สามารถแก้ไขชื่อให้ถูกต้องก่อนสร้างเจ้าหนี้" />
          {(!supplierName.trim()||!matchedReceiptId)&&<Alert severity="warning">ข้อมูลที่ยังขาด: {[!supplierName.trim()?'ชื่อเจ้าหนี้/ผู้ขาย':'',!matchedReceiptId?'ใบรับสินค้าที่ตรวจรับแล้ว':''].filter(Boolean).join(' · ')}</Alert>}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1 }}>
            <TextField select required label="ใบรับสินค้า" value={matchedReceiptId} onChange={event => setMatchedReceiptId(event.target.value)}>
              <MenuItem value="">กรุณาเลือก</MenuItem>{receiptCandidates.map(item => <MenuItem key={item.id} value={item.id}>{item.label}</MenuItem>)}
            </TextField>
            <TextField select label="ใบสั่งซื้อ (PO)" value={matchedPoId} onChange={event => setMatchedPoId(event.target.value)}>
              <MenuItem value="">ไม่มี PO / ค่าใช้จ่ายตรง</MenuItem>{poCandidates.map(item => <MenuItem key={item.id} value={item.id}>{item.label}</MenuItem>)}
            </TextField>
          </Box>
          <FormControlLabel control={<Checkbox checked={approveMatchException} onChange={event => setApproveMatchException(event.target.checked)} />} label="อนุมัติส่วนต่าง หากยอดไม่ตรง (Admin/Manager)" />
          {approveMatchException && <TextField required label="เหตุผลอนุมัติส่วนต่าง" value={matchExceptionReason} onChange={event => setMatchExceptionReason(event.target.value)} />}
          </Stack></Paper>}
        {payableDocumentTypes.includes(documentType) && isUtilityInvoice && <Paper variant="outlined" sx={{ p: 2, borderTop: 4, borderTopColor: 'info.main' }}><Stack spacing={1.5}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>สร้างเจ้าหนี้ค่าสาธารณูปโภค</Typography>
          <Alert severity="info">ค่าไฟฟ้าและค่าประปาเป็นค่าใช้จ่ายบริการ จึงไม่ต้องมีใบรับสินค้าและไม่เข้าสต็อก ระบบจะลงค่าใช้จ่ายตามโครงการ/ไซต์ที่กำหนด</Alert>
          <TextField required label="เจ้าหนี้/ผู้ให้บริการ" value={supplierName} onChange={event=>setSupplierName(event.target.value)} error={!supplierName.trim()} helperText="เช่น การไฟฟ้า หรือการประปาที่ออกใบแจ้งหนี้" />
          {validationErrors.length>0&&<Alert severity="warning">ข้อมูลที่ยังขาด: {validationErrors.slice(0,3).join(' · ')}</Alert>}
        </Stack></Paper>}
        {documentType === 'billing_note' && <Paper variant="outlined" sx={{p:2,borderTop:4,borderTopColor:'secondary.main'}}><Stack spacing={1}>
          <Typography variant="h6" sx={{fontWeight:800}}>จับคู่ใบส่งของ/ใบรับสินค้ากับใบวางบิล</Typography>
          <Alert severity="info">ระบบกรองเฉพาะเอกสารของผู้ขายที่เลือก เปรียบเทียบยอดรวม และตรวจรายการสินค้ากับจำนวนก่อนยืนยัน</Alert>
          <TextField required size="small" label="ผู้ขาย/เจ้าหนี้ในใบวางบิล" value={supplierName} onChange={event=>{setSupplierName(event.target.value);setSelectedDeliveryNoteIds([])}} error={!supplierName.trim()}/>
          <Stack direction="row" spacing={1} sx={{alignItems:'center',flexWrap:'wrap'}}><Button size="small" onClick={()=>setSelectedDeliveryNoteIds(billingDeliveryOptions.map(item=>item.id))}>เลือกทั้งหมด</Button><Button size="small" color="inherit" onClick={()=>setSelectedDeliveryNoteIds([])}>ล้างที่เลือก</Button><Chip label={`เลือก ${selectedDeliveryNoteIds.length} ใบ`}/><Chip color="secondary" label={`ยอดเอกสารรับ ${money(billingSelectedTotal)}`}/><Chip color={Math.abs(billingVariance)<=.01?'success':'warning'} label={Math.abs(billingVariance)<=.01?'ยอดตรงกัน':`ส่วนต่าง ${money(billingVariance)}`}/></Stack>
          {billingDeliveryOptions.length===0?<Alert severity="warning">ไม่พบใบส่งของหรือใบรับสินค้าที่ “ยืนยันแล้ว” ของผู้ขายรายนี้ หรือเอกสารถูกจับคู่กับใบวางบิลอื่นแล้ว</Alert>:billingDeliveryOptions.map(item=><Paper key={item.id} variant="outlined" sx={{p:.75}}><Stack direction={{xs:'column',sm:'row'}} spacing={1} sx={{alignItems:{sm:'center'}}}><FormControlLabel sx={{m:0,flex:1}} control={<Checkbox checked={selectedDeliveryNoteIds.includes(item.id)} onChange={event=>setSelectedDeliveryNoteIds(current=>event.target.checked?[...new Set([...current,item.id])]:current.filter(id=>id!==item.id))}/>} label={item.label}/><Button size="small" variant="outlined" onClick={()=>void viewDocumentAttachment(item.sourceMessageId)} disabled={previewLoading}>{previewLoading?'กำลังโหลด...':'ดูภาพเอกสาร'}</Button></Stack></Paper>) }
          {selectedDeliveryNoteIds.length>0&&<Paper variant="outlined" sx={{p:1.25,mt:1}}><Typography variant="subtitle1" sx={{fontWeight:800,mb:1}}>เปรียบเทียบรายการใบวางบิลกับเอกสารรับ</Typography><StandardDataTable rows={billingComparisonRows} getRowId={row=>row.id} getSearchText={row=>row.description} searchLabel="ค้นหารายการเปรียบเทียบ" emptyText="ใบวางบิลไม่มีรายการสำหรับเปรียบเทียบ" exportFileName="billing-receipt-comparison" initialRowsPerPage={25} minWidth={900} columns={[
            {id:'description',label:'รายการ',minWidth:260,render:row=>row.description},
            {id:'billed_quantity',label:'ใบวางบิล',align:'right',render:row=>`${row.billedQuantity.toLocaleString('th-TH')} ${row.unit??''}`,exportValue:row=>row.billedQuantity},
            {id:'received_quantity',label:'เอกสารรับ',align:'right',render:row=>`${row.receivedQuantity.toLocaleString('th-TH')} ${row.unit??''}`,exportValue:row=>row.receivedQuantity},
            {id:'quantity_difference',label:'ส่วนต่างจำนวน',align:'right',render:row=>row.quantityDifference.toLocaleString('th-TH'),exportValue:row=>row.quantityDifference},
            {id:'billed_amount',label:'ยอดใบวางบิล',align:'right',render:row=>money(row.billedAmount),exportValue:row=>row.billedAmount},
            {id:'received_amount',label:'ยอดเอกสารรับ',align:'right',render:row=>money(row.receivedAmount),exportValue:row=>row.receivedAmount},
            {id:'status',label:'ผลตรวจ',render:row=><Chip size="small" color={row.status==='matched'?'success':row.status==='not_found'?'error':'warning'} label={row.status==='matched'?'ตรงกัน':row.status==='not_found'?'ไม่พบรายการ':'จำนวนต่าง'}/>,exportValue:row=>row.status==='matched'?'ตรงกัน':row.status==='not_found'?'ไม่พบรายการ':'จำนวนต่าง'},
          ]}/></Paper>}
        </Stack></Paper>}
        {documentType !== 'goods_receipt' && <Paper variant="outlined" sx={{ p: 2 }}><Typography variant="h6" sx={{ mb: 1, fontWeight: 800 }}>ข้อมูลโครงการและการรับรู้ต้นทุน</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3,1fr)' }, gap: 1.5 }}>
            <TextField select required label="โครงการหลัก" value={header.project_id} onChange={event => updateHeader('project_id', event.target.value)} disabled={!canManage}>{projects.map(project => <MenuItem key={project.id} value={project.id}>{project.code ? `${project.code} · ` : ''}{project.name}</MenuItem>)}</TextField>
            <TextField select label="ไซต์งาน" value={header.site_id} onChange={event => updateHeader('site_id', event.target.value)} disabled={!canManage}><MenuItem value="">ไม่ระบุ</MenuItem>{sites.filter(site => site.project_id === header.project_id).map(site => <MenuItem key={site.id} value={site.id}>{site.name}</MenuItem>)}</TextField>
            <TextField type="date" label="วันที่รับรู้ต้นทุน" value={header.recognition_date} onChange={event => updateHeader('recognition_date', event.target.value)} slotProps={{ inputLabel: { shrink: true } }} disabled={!canManage} />
            <TextField label="Cost Center" value={header.cost_center_code} onChange={event => updateHeader('cost_center_code', event.target.value)} disabled={!canManage} />
            <TextField label="WBS/งวดงาน" value={header.wbs_code} onChange={event => updateHeader('wbs_code', event.target.value)} disabled={!canManage} />
            <TextField label="เลขสัญญา/PO" value={header.contract_reference} onChange={event => updateHeader('contract_reference', event.target.value)} disabled={!canManage} />
          </Box>
        </Paper>}

        {documentType !== 'goods_receipt' && documentType !== 'quotation' && validationErrors.length > 0 && <Alert severity="warning">{validationErrors.slice(0, 5).map(message => <div key={message}>• {message}</div>)}{validationErrors.length > 5 && <div>และอีก {validationErrors.length - 5} รายการ</div>}</Alert>}

        {/* Legacy line-editor UI intentionally disabled */}
        {documentType !== 'quotation' && <>
        {documentType !== 'goods_receipt' && <><Paper variant="outlined" sx={{p:1}}><Stack direction={{xs:'column',lg:'row'}} spacing={1} sx={{alignItems:{lg:'center'}}}><TextField select size="small" label="โครงการ" value={header.project_id} onChange={event=>updateHeader('project_id',event.target.value)} sx={{minWidth:220}}><MenuItem value="">เลือกโครงการ</MenuItem>{projects.map(project=><MenuItem key={project.id} value={project.id}>{project.name}</MenuItem>)}</TextField><TextField select size="small" label="ไซต์" value={header.site_id} onChange={event=>updateHeader('site_id',event.target.value)} sx={{minWidth:190}}><MenuItem value="">ไม่ระบุไซต์</MenuItem>{sites.filter(site=>site.project_id===header.project_id).map(site=><MenuItem key={site.id} value={site.id}>{site.name}</MenuItem>)}</TextField><TextField select size="small" label="หมวดต้นทุน" value={bulkCostCategoryId} onChange={event=>setBulkCostCategoryId(event.target.value)} sx={{minWidth:260}}><MenuItem value="">ไม่เปลี่ยนหมวดต้นทุน</MenuItem>{categories.map(category=><MenuItem key={category.id} value={category.id}>{categoryLabel(category)}</MenuItem>)}</TextField><Button variant="contained" onClick={applyAccountingDefaults} disabled={!header.project_id||!selectedStockLineIds.length}>ใช้กับรายการที่เลือก ({selectedStockLineIds.length})</Button><Button size="small" onClick={()=>setSelectedStockLineIds(lines.map(line=>line.id))}>เลือกทั้งหมด</Button></Stack></Paper><StandardDataTable rows={lines} getRowId={line=>line.id} getSearchText={line=>`${line.description} ${line.account_code??''} ${line.account_name??''}`} searchLabel="ค้นหารายการเอกสาร" exportFileName="accounting-document-standard-lines" initialRowsPerPage={25} minWidth={1800} columns={[
          {id:'select',label:'เลือก',sortable:false,exportable:false,render:line=><Checkbox size="small" checked={selectedStockLineIds.includes(line.id)} onChange={event=>setSelectedStockLineIds(current=>event.target.checked?[...new Set([...current,line.id])]:current.filter(id=>id!==line.id))}/>},
          {id:'item',label:'รายการ',minWidth:430,render:line=><Stack spacing={.5}><TextField size="small" label={`ชื่อสินค้า/รายการ ${line.line_number}`} value={line.description} onChange={event=>updateLine(line.id,{description:event.target.value})} disabled={!canManage}/><Stack direction="row" spacing={.5}><TextField size="small" type="number" label="จำนวน" value={line.quantity??''} onChange={event=>updateProductDetail(line.id,{quantity:event.target.value===''?null:Number(event.target.value)})} disabled={!canManage} sx={{width:95}}/><TextField size="small" label="หน่วย" value={line.unit??''} onChange={event=>updateLine(line.id,{unit:event.target.value})} disabled={!canManage} sx={{width:90}}/><TextField size="small" type="number" label="ราคา/หน่วย" value={line.unit_price??''} onChange={event=>updateProductDetail(line.id,{unit_price:event.target.value===''?null:Number(event.target.value)})} disabled={!canManage} sx={{width:125}}/></Stack><Typography variant="caption">รวม {money(line.line_amount)} · {line.item_type==='stock'?'รับเข้า Stock':'ต้นทุนตรง ไม่เข้า Stock'}</Typography><Stack direction="row"><Button size="small" variant="outlined" onClick={()=>void saveProductName(line)} disabled={!canManage||savingLineId===line.id||!line.description.trim()}>{savingLineId===line.id?'กำลังบันทึก...':'บันทึกสินค้า/Stock'}</Button><Button size="small" onClick={()=>openProductSplit(line)} disabled={!canManage}>แยกรายการสินค้า</Button></Stack></Stack>,exportValue:line=>line.description},
          {id:'usage',label:'การนำไปใช้',minWidth:170,render:line=><TextField select fullWidth size="small" value={line.item_type} onChange={event=>updateLine(line.id,{item_type:event.target.value as ItemType})} disabled={!canManage}>{(Object.entries(itemTypeLabels) as [ItemType,string][]).map(([value,label])=><MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField>,exportValue:line=>itemTypeLabels[line.item_type]},
          {id:'category',label:'หมวดต้นทุนหลัก',minWidth:250,render:line=><TextField select fullWidth size="small" value={line.cost_category_id??''} onChange={event=>chooseCategory(line,event.target.value)} disabled={!canManage}><MenuItem value="">เลือกหมวดต้นทุน</MenuItem>{categories.map(category=><MenuItem key={category.id} value={category.id}>{categoryLabel(category)}</MenuItem>)}</TextField>,exportValue:line=>categories.find(category=>category.id===line.cost_category_id)?.name_th??''},
          {id:'account',label:'บัญชี',minWidth:270,render:line=><Stack spacing={.5}><TextField size="small" placeholder="รหัสบัญชี" value={line.account_code??''} onChange={event=>updateLine(line.id,{account_code:event.target.value})} disabled={!canManage}/><TextField size="small" placeholder="ชื่อบัญชี" value={line.account_name??''} onChange={event=>updateLine(line.id,{account_name:event.target.value})} disabled={!canManage}/></Stack>,exportValue:line=>`${line.account_code??''} ${line.account_name??''}`},
          {id:'allocation',label:'โครงการ / ไซต์ / หมวด / สัดส่วน / จำนวนเงิน',minWidth:760,render:line=><Stack spacing={.5}>{line.allocations.map((allocation,index)=><Box key={`${line.id}-${index}`} sx={{display:'grid',gridTemplateColumns:'1.2fr 1fr 1.4fr 90px 120px auto',gap:.5,alignItems:'center'}}><TextField select size="small" value={allocation.project_id} onChange={event=>updateAllocation(line.id,index,{project_id:event.target.value,site_id:''})} disabled={!canManage}><MenuItem value="">เลือกโครงการ</MenuItem>{projects.map(project=><MenuItem key={project.id} value={project.id}>{project.name}</MenuItem>)}</TextField><TextField select size="small" value={allocation.site_id} onChange={event=>updateAllocation(line.id,index,{site_id:event.target.value})} disabled={!canManage}><MenuItem value="">ไม่ระบุไซต์</MenuItem>{sites.filter(site=>site.project_id===allocation.project_id).map(site=><MenuItem key={site.id} value={site.id}>{site.name}</MenuItem>)}</TextField><TextField select size="small" value={allocation.cost_category_id} onChange={event=>chooseAllocationCategory(line.id,index,event.target.value)} disabled={!canManage}><MenuItem value="">หมวดต้นทุน</MenuItem>{categories.map(category=><MenuItem key={category.id} value={category.id}>{categoryLabel(category)}</MenuItem>)}</TextField><TextField size="small" type="number" value={allocation.allocation_percent} onChange={event=>updateAllocation(line.id,index,{allocation_percent:Number(event.target.value)})} disabled={!canManage}/><TextField size="small" type="number" value={allocation.allocation_amount} onChange={event=>updateAllocation(line.id,index,{allocation_amount:Number(event.target.value)})} disabled={!canManage}/><IconButton size="small" color="error" disabled={!canManage||line.allocations.length===1} onClick={()=>updateLine(line.id,{allocations:line.allocations.filter((_item,allocationIndex)=>allocationIndex!==index)})}><DeleteOutlineIcon fontSize="small"/></IconButton></Box>)}<Button size="small" sx={{alignSelf:'flex-start'}} startIcon={<AddOutlinedIcon/>} onClick={()=>addAllocation(line)} disabled={!canManage}>แบ่งเพิ่มอีกโครงการ</Button></Stack>,exportValue:line=>line.allocations.map(allocation=>projects.find(project=>project.id===allocation.project_id)?.name??'').join(', ')},
        ]}/></>}
        </>}
      </Stack>}</DialogContent>
      {(error||success)&&<Box sx={{px:1.5,pt:1}}>{error?<Alert severity="error" onClose={()=>setError(null)}>ดำเนินการไม่สำเร็จ — {error}</Alert>:<Alert severity="success" onClose={()=>setSuccess(null)}>{success}</Alert>}</Box>}
      <DialogActions sx={{py:1}}><Button onClick={() => setSelected(null)} disabled={saving}>ปิด</Button>{canManage && selected?.status === 'confirmed' && documentType === 'goods_receipt' && <Button variant="contained" onClick={() => void saveConfirmedReceiptPrices()} disabled={saving || lines.length === 0}>{saving ? 'กำลังบันทึก...' : 'บันทึกราคาซื้อจริง'}</Button>}{canManage && selected && ['pending', 'needs_correction'].includes(selected.status) && <><Button color="inherit" onClick={() => void dismissDocument()} disabled={saving}>ไม่นำมาใช้</Button><Button variant="outlined" onClick={() => void savePartialDraft()} disabled={saving || lines.length === 0 || !hasUnsavedDraftChanges}>{saving ? 'กำลังบันทึก...' : hasUnsavedDraftChanges ? 'บันทึกร่าง' : 'บันทึกแล้ว'}</Button>{documentType === 'quotation' ? <Button variant="contained" onClick={() => void processQuotation()} disabled={saving || !header.project_id || selected.status === 'confirmed'}>{saving ? 'กำลังบันทึก...' : selected.status === 'confirmed' ? ('บันทึก' + 'การตัดสินใจแล้ว') : ['order_full', 'order_partial'].includes(quotationAction) ? 'ยืนยันและสร้าง PO' : 'ยืนยันใบเสนอราคา'}</Button> : documentType === 'goods_receipt' ? <Button variant="contained" color="success" onClick={() => void confirmGoodsReceipt()} disabled={saving || !supplierName.trim() || !receivingLocation.trim() || stockAllocationErrors.length > 0}>{saving ? 'กำลังรับเข้า...' : 'ยืนยันรับเข้า Stock'}</Button> : documentType === 'billing_note' ? <Button variant="contained" color="secondary" onClick={()=>void confirmBillingDeliveryNotes()} disabled={saving||!selectedDeliveryNoteIds.length||!header.project_id}>{saving?'กำลังจับคู่...':`ยืนยันใบวางบิล (${selectedDeliveryNoteIds.length} ใบส่งของ)`}</Button> : payableDocumentTypes.includes(documentType) ? (isUtilityInvoice ? <Button variant="contained" color="info" onClick={() => void confirmUtilityInvoice()} disabled={saving || !supplierName.trim() || validationErrors.length > 0}>{saving ? 'กำลังสร้างเจ้าหนี้...' : 'สร้างเจ้าหนี้ค่าสาธารณูปโภค'}</Button> : <Button variant="contained" color="warning" onClick={() => void confirmMatchedInvoice()} disabled={saving || !supplierName.trim() || !matchedReceiptId || (approveMatchException && !matchExceptionReason.trim())}>{saving ? 'กำลังจับคู่...' : 'จับคู่และสร้างเจ้าหนี้'}</Button>) : <Button variant="contained" onClick={() => void saveClassification(true)} disabled={saving || validationErrors.length > 0}>{saving ? 'กำลังบันทึก...' : 'ยืนยันและสร้างรายการบัญชี'}</Button>}</>}</DialogActions>
    </Dialog>
    <Dialog open={Boolean(preview)} onClose={() => setPreview(null)} maxWidth="lg" fullWidth>
      <DialogTitle>ภาพเอกสารต้นฉบับ</DialogTitle>
      <DialogContent dividers sx={{ minHeight: 500, display: 'grid', placeItems: 'center', bgcolor: 'grey.100' }}>
        {preview?.contentType.includes('pdf')
          ? <Box component="iframe" title="เอกสารต้นฉบับ" src={preview.url} sx={{ width: '100%', height: '75vh', border: 0, bgcolor: 'white' }} />
          : preview && <Box component="img" src={preview.url} alt="เอกสารต้นฉบับ" sx={{ maxWidth: '100%', maxHeight: '75vh', objectFit: 'contain' }} />}
      </DialogContent>
      <DialogActions><Button component="a" href={preview?.url ?? '#'} target="_blank" rel="noreferrer">เปิดเต็มหน้าจอ</Button><Button onClick={() => setPreview(null)}>ปิด</Button></DialogActions>
    </Dialog>
    <Dialog open={Boolean(operationStock)} onClose={()=>!saving&&setOperationStock(null)} maxWidth="sm" fullWidth>
      <DialogTitle>เบิก/โอน Stock · {operationStock?.name}</DialogTitle>
      <DialogContent dividers><Stack spacing={1.5}>
        <Alert severity="info">คงเหลือ {Number(operationStock?.balance_quantity??0).toLocaleString('th-TH')} {operationStock?.unit??''} · {operationStock?.location_name??'-'} · {projects.find(project=>project.id===operationStock?.project_id)?.name??'คลังกลาง'}</Alert>
        <TextField select label="รายการดำเนินการ" value={operationType} onChange={event=>setOperationType(event.target.value as StockOperationType)}><MenuItem value="issue">เบิกใช้เป็นต้นทุนโครงการ</MenuItem><MenuItem value="transfer">โอนไปโครงการอื่น</MenuItem><MenuItem value="waste">ตัดของเสีย/สูญหาย</MenuItem></TextField>
        <TextField type="number" label="จำนวน" value={operationQuantity} onChange={event=>setOperationQuantity(Number(event.target.value))} error={operationQuantity>Number(operationStock?.balance_quantity??0)} />
        {operationType==='transfer'&&<><TextField select label="โครงการปลายทาง" value={operationTargetProject} onChange={event=>setOperationTargetProject(event.target.value)}>{projects.map(project=><MenuItem key={project.id} value={project.id}>{project.name}</MenuItem>)}</TextField><TextField select label="คลังปลายทาง" value={operationTargetLocation} onChange={event=>setOperationTargetLocation(event.target.value)}>{[...new Map(projectInventory.filter(item=>item.location_id).map(item=>[item.location_id,item.location_name])).entries()].map(([id,name])=><MenuItem key={id!} value={id!}>{name}</MenuItem>)}</TextField></>}
        <TextField required label="เหตุผล/หมายเหตุ" value={operationReason} onChange={event=>setOperationReason(event.target.value)} multiline minRows={2}/>
      </Stack></DialogContent>
      <DialogActions><Button onClick={()=>setOperationStock(null)} disabled={saving}>ยกเลิก</Button><Button variant="contained" color={operationType==='waste'?'error':'primary'} onClick={()=>void submitStockOperation()} disabled={saving||operationQuantity<=0||operationQuantity>Number(operationStock?.balance_quantity??0)||!operationReason.trim()||(operationType==='transfer'&&(!operationTargetProject||!operationTargetLocation))}>{saving?'กำลังบันทึก...':'ยืนยัน'}</Button></DialogActions>
    </Dialog>
    <Dialog open={Boolean(splitLine)} onClose={()=>!saving&&setSplitLine(null)} maxWidth="md" fullWidth>
      <DialogTitle>แยกรายการสินค้า</DialogTitle>
      <DialogContent dividers><Stack spacing={1.5}>
        <Alert severity="info">ต้นฉบับ: {splitLine?.split_original_description??splitLine?.description} · รวม {splitLine?.split_original_quantity??splitLine?.quantity??0} {splitLine?.unit??''}</Alert>
        {splitItems.map((item,index)=><Paper key={index} variant="outlined" sx={{p:1}}><Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',lg:'2fr .75fr 1fr 1.3fr 1.3fr auto'},gap:1,alignItems:'center'}}><TextField size="small" label={`รายการย่อย ${index+1}`} value={item.description} onChange={event=>setSplitItems(current=>current.map((row,rowIndex)=>rowIndex===index?{...row,description:event.target.value}:row))}/><TextField size="small" type="number" label={`จำนวน (${splitLine?.unit??''})`} value={item.quantity} onChange={event=>setSplitItems(current=>current.map((row,rowIndex)=>rowIndex===index?{...row,quantity:Number(event.target.value)}:row))}/><TextField select size="small" label="รูปแบบรับเข้า" value={item.mode} onChange={event=>setSplitItems(current=>current.map((row,rowIndex)=>rowIndex===index?{...row,mode:event.target.value as StockMode,...(event.target.value==='central_stock'?{project_id:'',site_id:''}:{})}:row))}>{(Object.entries(stockModeLabels) as [StockMode,string][]).map(([value,label])=><MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField><TextField select size="small" label="โครงการ" value={item.project_id} disabled={item.mode==='central_stock'} onChange={event=>setSplitItems(current=>current.map((row,rowIndex)=>rowIndex===index?{...row,project_id:event.target.value,site_id:''}:row))}><MenuItem value="">เลือกโครงการ</MenuItem>{projects.map(project=><MenuItem key={project.id} value={project.id}>{project.name}</MenuItem>)}</TextField><TextField select size="small" label="ไซต์" value={item.site_id} disabled={item.mode==='central_stock'} onChange={event=>setSplitItems(current=>current.map((row,rowIndex)=>rowIndex===index?{...row,site_id:event.target.value}:row))}><MenuItem value="">ไม่ระบุไซต์</MenuItem>{sites.filter(site=>site.project_id===item.project_id).map(site=><MenuItem key={site.id} value={site.id}>{site.name}</MenuItem>)}</TextField><IconButton color="error" disabled={splitItems.length<=2} onClick={()=>setSplitItems(current=>current.filter((_row,rowIndex)=>rowIndex!==index))}><DeleteOutlineIcon/></IconButton></Box></Paper>)}
        <Stack direction="row" spacing={1}><Button startIcon={<AddOutlinedIcon/>} onClick={()=>{const base=splitLine?suggestedProductSplit(splitLine)[0]:{mode:'project_stock' as StockMode,project_id:header.project_id,site_id:header.site_id};setSplitItems(current=>[...current,{description:'',quantity:0,mode:base.mode,project_id:base.project_id,site_id:base.site_id}])}}>เพิ่มรายการย่อย</Button>{splitLine&&<Button variant="outlined" onClick={()=>setSplitItems(suggestedProductSplit(splitLine))}>ดึงค่าที่แนะนำ</Button>}</Stack>
        <Alert severity={Math.abs(splitItems.reduce((sum,item)=>sum+Number(item.quantity||0),0)-Number(splitLine?.split_original_quantity??splitLine?.quantity??0))<.001?'success':'warning'}>รวมรายการย่อย {splitItems.reduce((sum,item)=>sum+Number(item.quantity||0),0)} / {splitLine?.split_original_quantity??splitLine?.quantity??0} {splitLine?.unit??''}</Alert>
      </Stack></DialogContent>
      <DialogActions><Button onClick={()=>setSplitLine(null)} disabled={saving}>ยกเลิก</Button><Button variant="contained" onClick={()=>void submitProductSplit()} disabled={saving||splitItems.length<2||splitItems.some(item=>!item.description.trim()||item.quantity<=0||(item.mode!=='central_stock'&&!item.project_id))||Math.abs(splitItems.reduce((sum,item)=>sum+Number(item.quantity||0),0)-Number(splitLine?.split_original_quantity??splitLine?.quantity??0))>.001}>{saving?'กำลังแยก...':'ยืนยันแยกรายการ'}</Button></DialogActions>
    </Dialog>
  </Stack>
}






