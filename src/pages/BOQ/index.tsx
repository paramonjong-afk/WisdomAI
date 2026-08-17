import AddOutlinedIcon from '@mui/icons-material/AddOutlined'
import PriceCheckOutlinedIcon from '@mui/icons-material/PriceCheckOutlined'
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined'
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined'
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog,
  DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import { readBoqFile, type BoqImportResult, type ImportedBoqRow } from '../../utils/boqImport'
import { compareBoqSources, readBoqPdf, type PdfExtraction } from '../../utils/boqPdfCompare'

type Project = { id: string; name: string; code: string | null }
type BoqDocument = {
  id: string; project_id: string; document_number: string; title: string; revision: number
  status: 'draft' | 'in_review' | 'approved' | 'superseded'
  overhead_percent: number; profit_percent: number; discount_amount: number; vat_percent: number
}
type BoqItem = {
  id: string; line_number: number; boq_code: string; category: string; description: string
  unit: string; quantity: number; material_unit_cost: number; labour_unit_cost: number
  equipment_unit_cost: number; subcontract_unit_cost: number; indirect_unit_cost: number
  selling_unit_price: number; work_status: string; progress_percent: number
}
type PriceDecision = {
  id?: string; boq_item_id: string; cost_kind: 'material' | 'labour'
  latest_actual_price: number | null; government_reference_price: number | null
  comparable_min_price: number | null; comparable_max_price: number | null
  ai_recommended_price: number | null; ai_confidence: number | null; ai_reason: string | null
  sale_decided_price: number | null; sale_reason: string | null; status: string
}

const emptyDocument = { projectId: '', documentNumber: '', title: '', overhead: '0', profit: '0', vat: '7' }
const emptyItem = {
  code: '', category: '', description: '', unit: '', quantity: '1',
  material: '0', labour: '0', equipment: '0', subcontract: '0', indirect: '0', selling: '0',
}
const money = (value: number) => value.toLocaleString('th-TH', { style: 'currency', currency: 'THB' })
const numeric = (value: string) => Number(value) || 0

export function BOQPage() {
  const { profile, currentCompany } = useAuth()
  const canManage = profile?.role === 'admin' || profile?.role === 'manager'
  const [projects, setProjects] = useState<Project[]>([])
  const [documents, setDocuments] = useState<BoqDocument[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [items, setItems] = useState<BoqItem[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [documentOpen, setDocumentOpen] = useState(false)
  const [itemOpen, setItemOpen] = useState(false)
  const [documentForm, setDocumentForm] = useState(emptyDocument)
  const [itemForm, setItemForm] = useState(emptyItem)
  const [saving, setSaving] = useState(false)
  const [importOpen,setImportOpen]=useState(false)
  const [importBusy,setImportBusy]=useState(false)
  const [importFile,setImportFile]=useState<File|null>(null)
  const [importPdf,setImportPdf]=useState<File|null>(null)
  const [pdfExtraction,setPdfExtraction]=useState<PdfExtraction|null>(null)
  const [acceptedComparisons,setAcceptedComparisons]=useState<string[]>([])
  const [importResult,setImportResult]=useState<BoqImportResult|null>(null)
  const [selectedImportSheets,setSelectedImportSheets]=useState<string[]>([])
  const [importError,setImportError]=useState('')
  const [importForm,setImportForm]=useState(emptyDocument)
  const [priceDecisions, setPriceDecisions] = useState<PriceDecision[]>([])
  const [pricingItem, setPricingItem] = useState<BoqItem | null>(null)
  const [pricingForms, setPricingForms] = useState<Record<'material' | 'labour', PriceDecision> | null>(null)

  const selected = documents.find((document) => document.id === selectedId)
  const importRows=useMemo(()=>importResult?.rows.filter(row=>selectedImportSheets.includes(row.sheet_name))??[],[importResult,selectedImportSheets])
  const importHasErrors=importRows.some(row=>row.quality_status==='error')
  const comparisons=useMemo(()=>pdfExtraction?compareBoqSources(importRows,pdfExtraction):[],[importRows,pdfExtraction])
  const comparisonById=useMemo(()=>new Map(comparisons.map(row=>[row.import_id,row])),[comparisons])
  const unresolvedComparisons=comparisons.filter(row=>row.match!=='matched'&&!acceptedComparisons.includes(row.import_id))

  const loadDocuments = useCallback(async () => {
    setLoading(true)
    setMessage('')
    const [projectResult, documentResult] = await Promise.all([
      supabase.from('projects').select('id:project_id,name,code').eq('status', 'active').order('name'),
      supabase.from('boq_documents')
        .select('id,project_id,document_number,title,revision,status,overhead_percent,profit_percent,discount_amount,vat_percent')
        .order('updated_at', { ascending: false }),
    ])
    if (projectResult.error || documentResult.error) {
      setMessage(projectResult.error?.message ?? documentResult.error?.message ?? 'โหลดข้อมูลไม่สำเร็จ')
    } else {
      setProjects((projectResult.data ?? []) as Project[])
      const rows = (documentResult.data ?? []) as BoqDocument[]
      setDocuments(rows)
      setSelectedId((current) => current && rows.some((row) => row.id === current) ? current : rows[0]?.id ?? '')
    }
    setLoading(false)
  }, [])

  const loadItems = useCallback(async (documentId: string) => {
    if (!documentId) {
      setItems([])
      return
    }
    const { data, error } = await supabase.from('boq_items')
      .select('id,line_number,boq_code,category,description,unit,quantity,material_unit_cost,labour_unit_cost,equipment_unit_cost,subcontract_unit_cost,indirect_unit_cost,selling_unit_price,work_status,progress_percent')
      .eq('boq_document_id', documentId).order('line_number')
    if (error) setMessage(error.message)
    else {
      const loadedItems = (data ?? []) as BoqItem[]
      setItems(loadedItems)
      if (!loadedItems.length) setPriceDecisions([])
      else {
        const decisionResult = await supabase.from('boq_item_price_decisions').select('*')
          .in('boq_item_id', loadedItems.map((item) => item.id))
        if (decisionResult.error) setMessage(decisionResult.error.message)
        else setPriceDecisions((decisionResult.data ?? []) as PriceDecision[])
      }
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadDocuments() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadDocuments])
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadItems(selectedId) }, 0)
    return () => window.clearTimeout(timer)
  }, [loadItems, selectedId])

  const totals = useMemo(() => {
    const result = items.reduce((sum, item) => {
      const quantity = Number(item.quantity)
      sum.material += quantity * Number(item.material_unit_cost)
      sum.labour += quantity * Number(item.labour_unit_cost)
      sum.equipment += quantity * Number(item.equipment_unit_cost)
      sum.subcontract += quantity * Number(item.subcontract_unit_cost)
      sum.indirect += quantity * Number(item.indirect_unit_cost)
      sum.selling += quantity * Number(item.selling_unit_price)
      return sum
    }, { material: 0, labour: 0, equipment: 0, subcontract: 0, indirect: 0, selling: 0 })
    const direct = result.material + result.labour + result.equipment + result.subcontract + result.indirect
    const overhead = direct * Number(selected?.overhead_percent ?? 0) / 100
    const profit = (direct + overhead) * Number(selected?.profit_percent ?? 0) / 100
    const beforeVat = direct + overhead + profit - Number(selected?.discount_amount ?? 0)
    const vat = Math.max(0, beforeVat) * Number(selected?.vat_percent ?? 0) / 100
    return { ...result, direct, overhead, profit, beforeVat, vat, grandTotal: beforeVat + vat }
  }, [items, selected])

  const createDocument = async () => {
    if (!documentForm.projectId || !documentForm.documentNumber.trim() || !documentForm.title.trim()) return
    setSaving(true)
    const { data, error } = await supabase.from('boq_documents').insert({
      project_id: documentForm.projectId,
      document_number: documentForm.documentNumber.trim(),
      title: documentForm.title.trim(),
      overhead_percent: numeric(documentForm.overhead),
      profit_percent: numeric(documentForm.profit),
      vat_percent: numeric(documentForm.vat),
      created_by: profile?.id,
    }).select('id').single()
    setSaving(false)
    if (error) setMessage(error.message)
    else {
      setDocumentOpen(false); setDocumentForm(emptyDocument)
      await loadDocuments()
      if (data?.id) setSelectedId(data.id)
    }
  }

  const createItem = async () => {
    if (!selected || !itemForm.code.trim() || !itemForm.category.trim() || !itemForm.description.trim() || !itemForm.unit.trim()) return
    setSaving(true)
    const { error } = await supabase.from('boq_items').insert({
      boq_document_id: selected.id,
      line_number: items.length ? Math.max(...items.map((item) => item.line_number)) + 1 : 1,
      boq_code: itemForm.code.trim(), category: itemForm.category.trim(),
      description: itemForm.description.trim(), unit: itemForm.unit.trim(),
      quantity: numeric(itemForm.quantity), material_unit_cost: numeric(itemForm.material),
      labour_unit_cost: numeric(itemForm.labour), equipment_unit_cost: numeric(itemForm.equipment),
      subcontract_unit_cost: numeric(itemForm.subcontract), indirect_unit_cost: numeric(itemForm.indirect),
      selling_unit_price: numeric(itemForm.selling),
    })
    setSaving(false)
    if (error) setMessage(error.message)
    else {
      setItemOpen(false); setItemForm(emptyItem)
      await loadItems(selected.id)
    }
  }

  const chooseImportFile=async(file:File|null)=>{
    setImportFile(file);setImportResult(null);setSelectedImportSheets([]);setAcceptedComparisons([]);setImportError('')
    if(!file)return
    if(file.size>20*1024*1024){setImportError('ไฟล์ต้องมีขนาดไม่เกิน 20 MB');return}
    setImportBusy(true)
    try{
      const result=await readBoqFile(file)
      setImportResult(result);setSelectedImportSheets(result.sheets.filter(sheet=>sheet.selected).map(sheet=>sheet.name))
      if(!importForm.title)setImportForm((current)=>({...current,title:file.name.replace(/\.[^.]+$/,'')}))
    }catch(error){
      setImportError(error instanceof Error?error.message:'อ่านไฟล์ไม่สำเร็จ')
    }finally{setImportBusy(false)}
  }

  const choosePdfFile=async(file:File|null)=>{
    setImportPdf(file);setPdfExtraction(null);setAcceptedComparisons([]);setImportError('')
    if(!file)return
    if(file.size>30*1024*1024){setImportError('PDF ต้องมีขนาดไม่เกิน 30 MB');return}
    setImportBusy(true)
    try{setPdfExtraction(await readBoqPdf(file))}
    catch(error){setImportError(error instanceof Error?error.message:'อ่าน PDF ไม่สำเร็จ')}
    finally{setImportBusy(false)}
  }

  const updateImportRow=(importId:string,key:keyof ImportedBoqRow,value:string)=>setImportResult(current=>{
    if(!current)return current
    const numericKeys=new Set<keyof ImportedBoqRow>(['quantity','material_unit_cost','labour_unit_cost','equipment_unit_cost','subcontract_unit_cost','indirect_unit_cost','selling_unit_price'])
    const rows=current.rows.map(row=>{
      if(row.import_id!==importId)return row
      const updated={...row,[key]:numericKeys.has(key)?Math.max(0,Number(value)||0):value}
      const issues=updated.issues.filter(issue=>!issue.includes('ปริมาณเป็นศูนย์')&&!issue.includes('ไม่พบราคาหรือต้นทุน'))
      if(updated.quantity<=0)issues.push('ปริมาณเป็นศูนย์ กรุณาตรวจสอบ')
      if(!updated.selling_unit_price&&!updated.material_unit_cost&&!updated.labour_unit_cost&&!updated.equipment_unit_cost&&!updated.subcontract_unit_cost)issues.push('ไม่พบราคาหรือต้นทุน')
      return{...updated,issues,quality_status:issues.some(issue=>issue.includes('ซ้ำ')||issue.includes('ศูนย์'))?'error':issues.length?'review':'ready'} as ImportedBoqRow
    })
    return{...current,rows}
  })

  const importDocument=async()=>{
    if(!profile||!currentCompany||!importFile||!importResult||!importRows.length||importHasErrors||unresolvedComparisons.length||!importForm.projectId||
      !importForm.documentNumber.trim()||!importForm.title.trim())return
    setImportBusy(true);setImportError('')
    const safeName=importFile.name.replace(/[^\p{L}\p{N}._-]+/gu,'-').slice(-120)
    const storagePath=`${currentCompany.company_id}/${profile.id}/${Date.now()}-${safeName}`
    const pdfSafeName=importPdf?.name.replace(/[^\p{L}\p{N}._-]+/gu,'-').slice(-120)
    const pdfStoragePath=importPdf?`${currentCompany.company_id}/${profile.id}/${Date.now()}-reference-${pdfSafeName}`:''
    try{
      const upload=await supabase.storage.from('boq-imports').upload(storagePath,importFile,{
        contentType:importFile.type||undefined,upsert:false,
      })
      if(upload.error)throw upload.error
      if(importPdf){const pdfUpload=await supabase.storage.from('boq-imports').upload(pdfStoragePath,importPdf,{contentType:'application/pdf',upsert:false});if(pdfUpload.error){await supabase.storage.from('boq-imports').remove([storagePath]);throw pdfUpload.error}}
      const result=await supabase.rpc('import_boq_document',{
        target_project_id:importForm.projectId,
        target_document_number:importForm.documentNumber.trim(),
        target_title:importForm.title.trim(),
        target_overhead_percent:numeric(importForm.overhead),
        target_profit_percent:numeric(importForm.profit),
        target_vat_percent:numeric(importForm.vat),
        source_file_name:importPdf?`${importFile.name} + ${importPdf.name}`:importFile.name,
        source_storage_path:importPdf?JSON.stringify({excel:storagePath,pdf:pdfStoragePath}):storagePath,
        imported_items:importRows,
      })
      if(result.error){
        await supabase.storage.from('boq-imports').remove([storagePath,...(pdfStoragePath?[pdfStoragePath]:[])])
        throw result.error
      }
      setImportOpen(false);setImportFile(null);setImportPdf(null);setPdfExtraction(null);setAcceptedComparisons([]);setImportResult(null);setSelectedImportSheets([]);setImportForm(emptyDocument)
      setMessage(`นำเข้า BOQ ${importRows.length.toLocaleString('th-TH')} รายการเรียบร้อย`)
      await loadDocuments()
      if(result.data)setSelectedId(String(result.data))
    }catch(error){
      setImportError(error instanceof Error?error.message:
        typeof error==='object'&&error&&'message' in error?String(error.message):'นำเข้า BOQ ไม่สำเร็จ')
    }finally{setImportBusy(false)}
  }

  const blankDecision = (item: BoqItem, kind: 'material' | 'labour'): PriceDecision => ({
    boq_item_id: item.id, cost_kind: kind,
    latest_actual_price: null, government_reference_price: null,
    comparable_min_price: null, comparable_max_price: null,
    ai_recommended_price: null, ai_confidence: null, ai_reason: null,
    sale_decided_price: kind === 'material' ? Number(item.material_unit_cost) : Number(item.labour_unit_cost),
    sale_reason: null, status: 'awaiting_sale',
  })

  const openPricing = (item: BoqItem) => {
    const find = (kind: 'material' | 'labour') =>
      priceDecisions.find((decision) => decision.boq_item_id === item.id && decision.cost_kind === kind)
      ?? blankDecision(item, kind)
    setPricingItem(item)
    setPricingForms({ material: { ...find('material') }, labour: { ...find('labour') } })
  }

  const savePricing = async () => {
    if (!pricingItem || !pricingForms || !profile) return
    setSaving(true)
    try {
      const rows = (['material','labour'] as const).map((kind) => ({
        ...pricingForms[kind],
        status: pricingForms[kind].sale_decided_price == null ? 'awaiting_sale' : 'sale_confirmed',
        decided_by: pricingForms[kind].sale_decided_price == null ? null : profile.id,
        decided_at: pricingForms[kind].sale_decided_price == null ? null : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }))
      const decisionResult = await supabase.from('boq_item_price_decisions').upsert(rows, { onConflict: 'boq_item_id,cost_kind' })
      if (decisionResult.error) throw decisionResult.error
      const updateResult = await supabase.from('boq_items').update({
        material_unit_cost: pricingForms.material.sale_decided_price ?? 0,
        labour_unit_cost: pricingForms.labour.sale_decided_price ?? 0,
        selling_unit_price: (pricingForms.material.sale_decided_price ?? 0) + (pricingForms.labour.sale_decided_price ?? 0),
        updated_at: new Date().toISOString(),
      }).eq('id', pricingItem.id)
      if (updateResult.error) throw updateResult.error
      setPricingItem(null); setPricingForms(null)
      setMessage('บันทึกราคาที่ Sale ตัดสินใจแล้ว')
      await loadItems(selectedId)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'บันทึกราคาไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const analyzePricing = async () => {
    if (!pricingItem) return
    setSaving(true)
    const result = await supabase.rpc('analyze_boq_item_prices', { p_boq_item_id: pricingItem.id })
    if (result.error) {
      setMessage(result.error.message)
      setSaving(false)
      return
    }
    const refreshed = await supabase.from('boq_item_price_decisions').select('*').eq('boq_item_id', pricingItem.id)
    if (refreshed.error) setMessage(refreshed.error.message)
    else {
      const rows = refreshed.data as PriceDecision[]
      const material = rows.find((row) => row.cost_kind === 'material') ?? blankDecision(pricingItem, 'material')
      const labour = rows.find((row) => row.cost_kind === 'labour') ?? blankDecision(pricingItem, 'labour')
      setPricingForms({ material, labour })
      setPriceDecisions((current) => [
        ...current.filter((row) => row.boq_item_id !== pricingItem.id), ...rows,
      ])
      setMessage('WisdomAI วิเคราะห์ช่วงราคาและราคาแนะนำจากข้อมูลที่ยืนยันแล้ว')
    }
    setSaving(false)
  }

  const decisionFor = (itemId: string, kind: 'material' | 'labour') =>
    priceDecisions.find((decision) => decision.boq_item_id === itemId && decision.cost_kind === kind)

  return (
    <Stack spacing={3}>
      <PageHeader title="BOQ Engine" description="ฐานต้นทุน ปริมาณ ราคา และความคืบหน้าของโครงการ"
        action={<Stack direction="row" spacing={1}>
          <Button startIcon={<RefreshOutlinedIcon />} onClick={() => void loadDocuments()}>รีเฟรช</Button>
          {canManage&&<Button variant="outlined" startIcon={<UploadFileOutlinedIcon/>} onClick={()=>setImportOpen(true)}>นำเข้า Excel/CSV</Button>}
          {canManage && <Button variant="contained" startIcon={<AddOutlinedIcon />} onClick={() => setDocumentOpen(true)}>สร้าง BOQ</Button>}
        </Stack>} />
      {message && <Alert severity="error">{message}</Alert>}
      {loading ? <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 240 }}><CircularProgress /></Box> : <>
        <TextField select fullWidth label="เลือก BOQ" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
          {documents.map((document) => {
            const project = projects.find((row) => row.id === document.project_id)
            return <MenuItem key={document.id} value={document.id}>
              {project?.code ? `${project.code} · ` : ''}{document.document_number} R{document.revision} — {document.title}
            </MenuItem>
          })}
        </TextField>
        {!selected ? <Alert severity="info">ยังไม่มี BOQ ในระบบ กด “สร้าง BOQ” เพื่อเริ่ม cost baseline แรก</Alert> : <>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            {[
              ['ต้นทุนตรง', totals.direct], ['วัสดุ', totals.material], ['แรงงาน', totals.labour],
              ['OH + กำไร', totals.overhead + totals.profit], ['ราคาสุทธิรวม VAT', totals.grandTotal],
            ].map(([label, value]) => <Card key={String(label)} variant="outlined" sx={{ flex: 1 }}>
              <CardContent><Typography color="text.secondary" variant="body2">{label}</Typography>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>{money(Number(value))}</Typography></CardContent>
            </Card>)}
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>{selected.document_number} · {selected.title}</Typography>
            <Chip size="small" label={`${selected.status} · R${selected.revision}`} />
            <Box sx={{ flex: 1 }} />
            {canManage && selected.status !== 'approved' &&
              <Button variant="contained" startIcon={<AddOutlinedIcon />} onClick={() => setItemOpen(true)}>เพิ่มรายการ</Button>}
          </Stack>
          <StandardDataTable rows={items} getRowId={(row) => row.id}
            getSearchText={(row) => `${row.boq_code} ${row.category} ${row.description}`}
            searchLabel="ค้นหารหัส หมวดงาน หรือรายการ" emptyText="BOQ นี้ยังไม่มีรายการ"
            exportFileName={`boq-${selected.document_number}-r${selected.revision}`} minWidth={1900}
            columns={[
              { id: 'line', label: '#', align: 'right', render: (row) => row.line_number, exportValue: (row) => row.line_number },
              { id: 'code', label: 'รหัส BOQ', render: (row) => row.boq_code, exportValue: (row) => row.boq_code },
              { id: 'category', label: 'หมวดงาน', render: (row) => row.category, exportValue: (row) => row.category },
              { id: 'description', label: 'รายการ', minWidth: 220, render: (row) => row.description, exportValue: (row) => row.description },
              { id: 'quantity', label: 'ปริมาณ', align: 'right', render: (row) => `${Number(row.quantity).toLocaleString('th-TH')} ${row.unit}`, exportValue: (row) => row.quantity },
              { id: 'material_range', label: 'วัสดุ ต่ำ–สูง', align: 'right', render: (row) => {
                const d = decisionFor(row.id, 'material')
                return d?.comparable_min_price != null && d?.comparable_max_price != null
                  ? `${money(Number(d.comparable_min_price))}–${money(Number(d.comparable_max_price))}` : '-'
              }, exportValue: (row) => decisionFor(row.id, 'material')?.comparable_min_price },
              { id: 'material_ai', label: 'วัสดุ AI แนะนำ', align: 'right', render: (row) => {
                const d = decisionFor(row.id, 'material'); return d?.ai_recommended_price == null ? '-' : money(Number(d.ai_recommended_price))
              }, exportValue: (row) => decisionFor(row.id, 'material')?.ai_recommended_price },
              { id: 'material_sale', label: 'วัสดุ Sale', align: 'right', render: (row) => money(Number(row.material_unit_cost)), exportValue: (row) => row.material_unit_cost },
              { id: 'labour_range', label: 'แรงงาน ต่ำ–สูง', align: 'right', render: (row) => {
                const d = decisionFor(row.id, 'labour')
                return d?.comparable_min_price != null && d?.comparable_max_price != null
                  ? `${money(Number(d.comparable_min_price))}–${money(Number(d.comparable_max_price))}` : '-'
              }, exportValue: (row) => decisionFor(row.id, 'labour')?.comparable_min_price },
              { id: 'labour_ai', label: 'แรงงาน AI แนะนำ', align: 'right', render: (row) => {
                const d = decisionFor(row.id, 'labour'); return d?.ai_recommended_price == null ? '-' : money(Number(d.ai_recommended_price))
              }, exportValue: (row) => decisionFor(row.id, 'labour')?.ai_recommended_price },
              { id: 'labour_sale', label: 'แรงงาน Sale', align: 'right', render: (row) => money(Number(row.labour_unit_cost)), exportValue: (row) => row.labour_unit_cost },
              { id: 'direct', label: 'ต้นทุนรวม', align: 'right', render: (row) => money(Number(row.quantity) * (Number(row.material_unit_cost) + Number(row.labour_unit_cost) + Number(row.equipment_unit_cost) + Number(row.subcontract_unit_cost) + Number(row.indirect_unit_cost))), exportValue: (row) => Number(row.quantity) * (Number(row.material_unit_cost) + Number(row.labour_unit_cost) + Number(row.equipment_unit_cost) + Number(row.subcontract_unit_cost) + Number(row.indirect_unit_cost)) },
              { id: 'selling', label: 'ราคาขายรวม', align: 'right', render: (row) => money(Number(row.quantity) * Number(row.selling_unit_price)), exportValue: (row) => Number(row.quantity) * Number(row.selling_unit_price) },
              { id: 'progress', label: 'ความคืบหน้า', align: 'right', render: (row) => `${row.progress_percent}%`, exportValue: (row) => row.progress_percent },
              { id: 'pricing', label: 'ตัดสินราคา', render: (row) => canManage
                ? <Button size="small" startIcon={<PriceCheckOutlinedIcon />} onClick={() => openPricing(row)}>ราคา</Button> : '-', exportValue: () => '' },
            ]} />
        </>}
      </>}

      <Dialog open={documentOpen} onClose={() => !saving && setDocumentOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>สร้าง BOQ</DialogTitle>
        <DialogContent><Stack spacing={2} sx={{ mt: 1 }}>
          <TextField select label="โครงการ" value={documentForm.projectId} onChange={(e) => setDocumentForm({ ...documentForm, projectId: e.target.value })}>
            {projects.map((project) => <MenuItem key={project.id} value={project.id}>{project.code ? `${project.code} · ` : ''}{project.name}</MenuItem>)}
          </TextField>
          <TextField label="เลขที่ BOQ" value={documentForm.documentNumber} onChange={(e) => setDocumentForm({ ...documentForm, documentNumber: e.target.value })} />
          <TextField label="ชื่อ BOQ" value={documentForm.title} onChange={(e) => setDocumentForm({ ...documentForm, title: e.target.value })} />
          <Stack direction="row" spacing={2}>
            <TextField fullWidth label="Overhead %" type="number" value={documentForm.overhead} onChange={(e) => setDocumentForm({ ...documentForm, overhead: e.target.value })} />
            <TextField fullWidth label="Profit %" type="number" value={documentForm.profit} onChange={(e) => setDocumentForm({ ...documentForm, profit: e.target.value })} />
            <TextField fullWidth label="VAT %" type="number" value={documentForm.vat} onChange={(e) => setDocumentForm({ ...documentForm, vat: e.target.value })} />
          </Stack>
        </Stack></DialogContent>
        <DialogActions><Button onClick={() => setDocumentOpen(false)}>ยกเลิก</Button><Button variant="contained" disabled={saving} onClick={() => void createDocument()}>บันทึก</Button></DialogActions>
      </Dialog>

      <Dialog open={importOpen} onClose={()=>!importBusy&&setImportOpen(false)} fullWidth maxWidth="xl">
        <DialogTitle>นำเข้า BOQ งานเก่าจาก Excel หรือ CSV</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{pt:1}}>
            <Alert severity="info">
              ระบบจะสร้าง BOQ ฉบับใหม่ เก็บไฟล์ต้นฉบับ และให้ตรวจตัวอย่างก่อนบันทึก โดยไม่เขียนทับ BOQ เดิม
            </Alert>
            <Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',md:'repeat(3,1fr)'},gap:2}}>
              <TextField select label="โครงการ" value={importForm.projectId}
                onChange={(event)=>setImportForm({...importForm,projectId:event.target.value})}>
                {projects.map((project)=><MenuItem key={project.id} value={project.id}>
                  {project.code?`${project.code} · `:''}{project.name}
                </MenuItem>)}
              </TextField>
              <TextField label="เลขที่ BOQ" value={importForm.documentNumber}
                onChange={(event)=>setImportForm({...importForm,documentNumber:event.target.value})}/>
              <TextField label="ชื่อ BOQ" value={importForm.title}
                onChange={(event)=>setImportForm({...importForm,title:event.target.value})}/>
            </Box>
            <Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',sm:'repeat(3,1fr)'},gap:2}}>
              <TextField label="Overhead %" type="number" value={importForm.overhead}
                onChange={(event)=>setImportForm({...importForm,overhead:event.target.value})}/>
              <TextField label="Profit %" type="number" value={importForm.profit}
                onChange={(event)=>setImportForm({...importForm,profit:event.target.value})}/>
              <TextField label="VAT %" type="number" value={importForm.vat}
                onChange={(event)=>setImportForm({...importForm,vat:event.target.value})}/>
            </Box>
            <Button component="label" variant="outlined" startIcon={<UploadFileOutlinedIcon/>} disabled={importBusy}>
              {importFile?`ไฟล์: ${importFile.name}`:'เลือกไฟล์ Excel หรือ CSV'}
              <input hidden type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(event)=>void chooseImportFile(event.target.files?.[0]??null)}/>
            </Button>
            <Button component="label" variant="outlined" color={importPdf?'success':'primary'} startIcon={<UploadFileOutlinedIcon/>} disabled={importBusy||!importResult}>
              {importPdf?`PDF อ้างอิง: ${importPdf.name}`:'แนบ PDF เพื่อตรวจสอบกับ Excel'}
              <input hidden type="file" accept=".pdf,application/pdf" onChange={(event)=>void choosePdfFile(event.target.files?.[0]??null)}/>
            </Button>
            {pdfExtraction&&<Alert severity={pdfExtraction.warnings.length?'warning':'success'}>
              อ่าน PDF ได้ {pdfExtraction.pageCount} หน้า · {pdfExtraction.lines.length.toLocaleString('th-TH')} บรรทัด · จับคู่ตรง {comparisons.filter(row=>row.match==='matched').length} · พบผลต่าง {comparisons.filter(row=>row.match==='different').length} · พบเฉพาะ Excel {comparisons.filter(row=>row.match==='excel_only').length}
              {unresolvedComparisons.length?` · รอยืนยัน ${unresolvedComparisons.length} รายการ`:''}
            </Alert>}
            {pdfExtraction?.warnings.map(warning=><Alert key={warning} severity="warning">{warning}</Alert>)}
            {importBusy&&<Stack direction="row" spacing={1} sx={{alignItems:'center'}}><CircularProgress size={22}/><Typography>กำลังอ่านและตรวจไฟล์…</Typography></Stack>}
            {importError&&<Alert severity="error">{importError}</Alert>}
            {importResult&&<>
              <Alert severity={importHasErrors?'error':importResult.warnings.length?'warning':'success'}>
                AI อ่านได้ {importResult.rows.length.toLocaleString('th-TH')} รายการ จาก {importResult.sheets.length} Sheet · เลือกนำเข้า {importRows.length.toLocaleString('th-TH')} รายการ
                {importResult.skipped>0?` · ไม่นำเข้า ${importResult.skipped} แถว`:''}
                {importHasErrors?' · ต้องแก้รายการสีแดงก่อนยืนยัน':''}
              </Alert>
              <Typography variant="h6">1. เลือก Sheet ที่ต้องการนำเข้า</Typography>
              <Stack direction="row" spacing={1} sx={{flexWrap:'wrap',gap:1}}>{importResult.sheets.map(sheet=>{
                const selectedSheet=selectedImportSheets.includes(sheet.name)
                return <Chip key={sheet.name} clickable disabled={sheet.status==='ignored'} color={selectedSheet?'primary':'default'} variant={selectedSheet?'filled':'outlined'} label={`${sheet.name} · ${sheet.rowCount} รายการ${sheet.status==='ignored'?' · ไม่นำเข้า':''}`} onClick={()=>setSelectedImportSheets(current=>selectedSheet?current.filter(name=>name!==sheet.name):[...current,sheet.name])}/>
              })}</Stack>
              {importResult.warnings.map((warning)=><Alert key={warning} severity="warning">{warning}</Alert>)}
              <Typography variant="h6">2. ตรวจผล AI และแก้ข้อมูลที่ผิด</Typography>
              <Alert severity="info">รหัสเดียวกันอยู่คนละ Sheet หรือคนละหัวข้อได้ ระบบแจ้งซ้ำเฉพาะรหัสที่อยู่ใน Sheet และหัวข้อเดียวกัน</Alert>
              <StandardDataTable rows={importRows.slice(0,200)} getRowId={(row)=>row.import_id}
                getSearchText={(row)=>`${row.sheet_name} ${row.boq_code} ${row.category} ${row.description} ${row.issues.join(' ')}`}
                searchLabel="ค้นหาในตัวอย่าง 100 รายการแรก" emptyText="ไม่มีรายการ" minWidth={1250}
                columns={[
                  {id:'sheet',label:'Sheet/แถว',render:(row)=>`${row.sheet_name} / ${row.source_row}`},
                  {id:'code',label:'รหัส',render:(row)=><TextField size="small" value={row.boq_code} onChange={event=>updateImportRow(row.import_id,'boq_code',event.target.value)} sx={{minWidth:110}}/>},
                  {id:'category',label:'หัวข้อ',render:(row)=><TextField size="small" value={row.category} onChange={event=>updateImportRow(row.import_id,'category',event.target.value)} sx={{minWidth:160}}/>},
                  {id:'description',label:'รายการ',minWidth:260,render:(row)=><TextField size="small" fullWidth value={row.description} onChange={event=>updateImportRow(row.import_id,'description',event.target.value)}/>},
                  {id:'unit',label:'หน่วย',render:(row)=><TextField size="small" value={row.unit} onChange={event=>updateImportRow(row.import_id,'unit',event.target.value)} sx={{width:90}}/>},
                  {id:'quantity',label:'ปริมาณ',render:(row)=><TextField size="small" type="number" value={row.quantity} onChange={event=>updateImportRow(row.import_id,'quantity',event.target.value)} sx={{width:110}}/>},
                  {id:'material',label:'วัสดุ/หน่วย',render:(row)=>money(row.material_unit_cost)},
                  {id:'labour',label:'แรงงาน/หน่วย',render:(row)=>money(row.labour_unit_cost)},
                  {id:'selling',label:'ราคาขาย/หน่วย',render:(row)=>money(row.selling_unit_price)},
                  {id:'compare',label:'เทียบ PDF',minWidth:260,render:(row)=>{const comparison=comparisonById.get(row.import_id),accepted=acceptedComparisons.includes(row.import_id);return !pdfExtraction?'-':!comparison?'-':<Stack spacing={.5}><Chip size="small" color={comparison.match==='matched'||accepted?'success':comparison.match==='different'?'error':'info'} label={accepted?'ยืนยันใช้ข้อมูล Excel แล้ว':comparison.match==='matched'?`ตรงกัน · หน้า ${comparison.page}`:comparison.match==='different'?`ไม่ตรง · หน้า ${comparison.page}`:'พบเฉพาะ Excel'}/>{comparison.pdfText&&<Typography variant="caption" color="text.secondary">PDF: {comparison.pdfText}</Typography>}{!accepted&&comparison.differences.map(item=><Typography key={item} variant="caption" color="error">{item}</Typography>)}{comparison.match!=='matched'&&!accepted&&<Button size="small" onClick={()=>setAcceptedComparisons(current=>[...current,row.import_id])}>ยืนยันใช้ข้อมูล Excel</Button>}</Stack>}},
                  {id:'quality',label:'ผลตรวจ AI',minWidth:220,render:(row)=><Stack spacing={.5}><Chip size="small" color={row.quality_status==='error'?'error':row.quality_status==='review'?'warning':'success'} label={row.quality_status==='error'?'ต้องแก้':row.quality_status==='review'?'ควรตรวจ':'พร้อม'}/>{row.issues.map(issue=><Typography key={issue} variant="caption" color="text.secondary">{issue}</Typography>)}</Stack>},
                ]}/>
              {importRows.length>200&&<Alert severity="info">แสดง 200 รายการแรกจาก {importRows.length.toLocaleString('th-TH')} รายการ ใช้ช่องค้นหาเพื่อตรวจรายการสำคัญ</Alert>}
            </>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={importBusy} onClick={()=>setImportOpen(false)}>ยกเลิก</Button>
          <Button variant="contained" disabled={importBusy||!importResult||!importFile||!importRows.length||importHasErrors||unresolvedComparisons.length>0||!importForm.projectId||
            !importForm.documentNumber.trim()||!importForm.title.trim()} onClick={()=>void importDocument()}>
            3. ยืนยันนำเข้า {importResult?`${importRows.length.toLocaleString('th-TH')} รายการ`:''}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={itemOpen} onClose={() => !saving && setItemOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>เพิ่มรายการ BOQ</DialogTitle>
        <DialogContent><Stack spacing={2} sx={{ mt: 1 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <TextField fullWidth label="รหัส BOQ" value={itemForm.code} onChange={(e) => setItemForm({ ...itemForm, code: e.target.value })} />
            <TextField fullWidth label="หมวดงาน" value={itemForm.category} onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })} />
          </Stack>
          <TextField label="รายการ" value={itemForm.description} onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })} />
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <TextField fullWidth label="ปริมาณ" type="number" value={itemForm.quantity} onChange={(e) => setItemForm({ ...itemForm, quantity: e.target.value })} />
            <TextField fullWidth label="หน่วย" value={itemForm.unit} onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })} />
            <TextField fullWidth label="ราคาขาย/หน่วย" type="number" value={itemForm.selling} onChange={(e) => setItemForm({ ...itemForm, selling: e.target.value })} />
          </Stack>
          <Typography sx={{ fontWeight: 700 }}>ต้นทุนต่อหน่วย</Typography>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
            {([
              ['material', 'วัสดุ'], ['labour', 'แรงงาน'], ['equipment', 'เครื่องมือ'],
              ['subcontract', 'ผู้รับเหมาช่วง'], ['indirect', 'ทางอ้อม'],
            ] as const).map(([key, label]) => <TextField key={key} fullWidth label={label} type="number" value={itemForm[key]}
              onChange={(e) => setItemForm({ ...itemForm, [key]: e.target.value })} />)}
          </Stack>
        </Stack></DialogContent>
        <DialogActions><Button onClick={() => setItemOpen(false)}>ยกเลิก</Button><Button variant="contained" disabled={saving} onClick={() => void createItem()}>เพิ่มรายการ</Button></DialogActions>
      </Dialog>

      <Dialog open={Boolean(pricingItem && pricingForms)} onClose={() => !saving && setPricingItem(null)} fullWidth maxWidth="lg">
        <DialogTitle>วิเคราะห์และตัดสินราคา — {pricingItem?.boq_code} {pricingItem?.description}</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ my: 1 }}>
            วัสดุและค่าแรงวิเคราะห์แยกกัน ระบบ BOQ จะใช้เฉพาะราคา “Sale ตัดสินใจ” ส่วนราคาอื่นเป็นหลักฐานประกอบ
          </Alert>
          {pricingForms && <Stack spacing={3}>
            {(['material','labour'] as const).map((kind) => {
              const form = pricingForms[kind]
              const update = (field: keyof PriceDecision, value: string) => setPricingForms({
                ...pricingForms, [kind]: {
                  ...form,
                  [field]: field === 'ai_reason' || field === 'sale_reason' ? value : value === '' ? null : Number(value),
                },
              })
              return <Stack key={kind} spacing={1.5}>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>{kind === 'material' ? 'ค่าวัสดุ/อุปกรณ์' : 'ค่าแรง'}</Typography>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
                  <TextField fullWidth type="number" label="จ่ายจริงล่าสุด" value={form.latest_actual_price ?? ''} onChange={(e) => update('latest_actual_price', e.target.value)} />
                  <TextField fullWidth type="number" label="ราคากลางล่าสุด" value={form.government_reference_price ?? ''} onChange={(e) => update('government_reference_price', e.target.value)} />
                  <TextField fullWidth type="number" label="ราคาต่ำสุด" value={form.comparable_min_price ?? ''} onChange={(e) => update('comparable_min_price', e.target.value)} />
                  <TextField fullWidth type="number" label="ราคาสูงสุด" value={form.comparable_max_price ?? ''} onChange={(e) => update('comparable_max_price', e.target.value)} />
                </Stack>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
                  <TextField fullWidth type="number" label="AI แนะนำ" value={form.ai_recommended_price ?? ''} onChange={(e) => update('ai_recommended_price', e.target.value)} />
                  <TextField fullWidth type="number" label="ความมั่นใจ AI (0–1)" value={form.ai_confidence ?? ''} onChange={(e) => update('ai_confidence', e.target.value)} />
                  <TextField fullWidth type="number" required label="Sale ตัดสินใจ" value={form.sale_decided_price ?? ''} onChange={(e) => update('sale_decided_price', e.target.value)} />
                </Stack>
                <TextField label="เหตุผลที่ AI แนะนำ" value={form.ai_reason ?? ''} onChange={(e) => update('ai_reason', e.target.value)} />
                <TextField required label="เหตุผล/หมายเหตุจาก Sale" value={form.sale_reason ?? ''} onChange={(e) => update('sale_reason', e.target.value)} />
              </Stack>
            })}
          </Stack>}
        </DialogContent>
        <DialogActions>
          <Button disabled={saving} onClick={() => { setPricingItem(null); setPricingForms(null) }}>ยกเลิก</Button>
          <Button disabled={saving} startIcon={<PriceCheckOutlinedIcon />} onClick={() => void analyzePricing()}>
            ให้ WisdomAI วิเคราะห์ใหม่
          </Button>
          <Button variant="contained" disabled={saving || !pricingForms?.material.sale_reason?.trim() || !pricingForms?.labour.sale_reason?.trim()}
            onClick={() => void savePricing()}>ยืนยันราคาที่ Sale ตัดสินใจ</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
