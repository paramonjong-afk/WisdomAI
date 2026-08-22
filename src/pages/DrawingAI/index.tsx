import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined'
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined'
import {
  Alert, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, FormControlLabel, MenuItem, Paper, Stack, TextField, Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import { runWithMutationAttempt } from '../../utils/mutationAttemptRunner'
import { userError } from '../../utils/userError'

type Provider = 'gemini' | 'openai' | 'anthropic'
type ModelProvider = Provider | 'wisdom' | 'mistral' | 'paddleocr'
type Project = { id: string; name: string; code: string | null }
type Job = {
  id: string; project_id: string | null; name: string; drawing_type: string; status: string
  detected_project_name: string | null; detected_project_code: string | null; created_at: string
  pipeline_version: string; ensemble_result: {
    provider_count?: number; items?: unknown[]; auto_approved_items?: unknown[]; review_items?: unknown[]
  } | null
}
type Run = {
  id: string; job_id: string; provider: ModelProvider; model: string; status: string
  latency_ms: number | null; error_message: string | null; result: { items?: unknown[] } | null
}
type Leader = { provider: Provider; model: string; drawing_type: string; scored_runs: number; accuracy_score: number; average_latency_ms: number }
type ModelRegistry = {
  id: string; provider: string; model: string; role: string; availability: string; cost_tier: string; notes: string | null
}
type ModuleRun = {
  id: string; job_id: string; module_key: string; module_version: string; status: string
  warnings: string[]; latency_ms: number | null
}
type LearningCoverage = {
  code: string; name_th: string; category: string; primary_metric: string
  guardrail: string; status: string; sort_order: number; verified_examples: number
}
type TakeoffItem = {
  code?: string | null; category?: string; description?: string; unit?: string | null
  quantity?: number | null; page?: number; evidence?: string
}
type DrawingSheet = {
  id: string; job_id: string; page_number: number; sheet_number: string | null; title: string | null
  revision: string | null; discipline_code: string | null; sheet_role: string
  building: string | null; floor: string | null; zone: string | null; scale: string | null
  confidence: number | null
}
type SheetItem = {
  id: string; job_id: string; page_number: number; system_code: string | null; item_code: string | null
  description: string; specification: string | null; unit: string | null; quantity: number | null
  building: string | null; floor: string | null; zone: string | null; room: string | null
  count_method: string; evidence: string; confidence: number | null; review_status: string
}
type OpenSourceOcrResult = {
  engine: 'tesseract'
  model: string
  languages: string[]
  text: string
  confidence: number
}

const disciplines = [
  ['mixed', 'แบบรวม'], ['architectural', 'สถาปัตย์'], ['structural', 'โครงสร้าง'],
  ['electrical', 'ไฟฟ้า'], ['plumbing', 'สุขาภิบาล'], ['hvac', 'ปรับอากาศ'],
  ['fire_alarm', 'แจ้งเหตุเพลิงไหม้'], ['solar', 'โซลาร์'], ['civil', 'โยธา'],
]
const workSystems = [
  ['AR','สถาปัตยกรรม'], ['ST','โครงสร้าง'], ['CV','โยธา'], ['EL','ไฟฟ้ากำลัง'],
  ['LT','สื่อสาร/แรงต่ำ'], ['FA','แจ้งเหตุเพลิงไหม้'], ['PL','สุขาภิบาล'], ['FP','ดับเพลิง'],
  ['AC','ปรับอากาศ'], ['VT','ลิฟต์/ขนส่ง'], ['SOL','โซลาร์'], ['MED','ก๊าซทางการแพทย์'],
  ['SC','ควบคุมอาคาร'], ['LA','ภูมิทัศน์'], ['TM','งานทั่วไป'],
]
const referenceSystems: Record<string, string[]> = {
  EL: ['AR','ST','AC','PL'], LT: ['AR','ST','AC','EL'], FA: ['AR','ST','AC'],
  PL: ['AR','ST','AC','CV'], FP: ['AR','ST','AC','PL'], AC: ['AR','ST','EL','PL'],
  AR: ['ST','EL','PL','AC'], ST: ['AR','CV'], CV: ['AR','ST','PL'],
}

export function DrawingAIPage() {
  const { profile, currentCompany } = useAuth()
  const canManage = profile?.role === 'admin' || profile?.role === 'manager'
  const [projects, setProjects] = useState<Project[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [leaders, setLeaders] = useState<Leader[]>([])
  const [modelRegistry, setModelRegistry] = useState<ModelRegistry[]>([])
  const [moduleRuns, setModuleRuns] = useState<ModuleRun[]>([])
  const [learningCoverage, setLearningCoverage] = useState<LearningCoverage[]>([])
  const [projectId, setProjectId] = useState('')
  const [drawingType, setDrawingType] = useState('mixed')
  const [file, setFile] = useState<File | null>(null)
  const [providers, setProviders] = useState<Provider[]>(['gemini', 'openai', 'anthropic'])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [reviewJobId, setReviewJobId] = useState('')
  const [truthJson, setTruthJson] = useState('[]')
  const [manualProjectJob, setManualProjectJob] = useState<Job | null>(null)
  const [manualProjectName, setManualProjectName] = useState('')
  const [manualProjectCode, setManualProjectCode] = useState('')
  const [sheets, setSheets] = useState<DrawingSheet[]>([])
  const [sheetItems, setSheetItems] = useState<SheetItem[]>([])
  const [detailJob, setDetailJob] = useState<Job | null>(null)
  const [scopeSystems, setScopeSystems] = useState<string[]>([])
  const runAttempt = <T = { data?: unknown; error?: unknown }>(action: string, request: Record<string, unknown>, operation: () => unknown) =>
    runWithMutationAttempt({ module: 'drawing_ai', action, actorProfileId: profile?.id, companyId: currentCompany?.company_id ?? null, request, operation }) as Promise<T>

  const load = useCallback(async () => {
    const companyId = currentCompany?.company_id
    if (!companyId) {
      setProjects([]); setJobs([]); setRuns([]); setModuleRuns([]); setSheets([]); setSheetItems([])
      return
    }
    const [p, j, r, registry, modules, sheetResult, itemResult] = await Promise.all([
      supabase.from('projects').select('id:project_id,name,code').eq('company_id', companyId).eq('status', 'active').order('name'),
      supabase.from('drawing_ai_jobs').select('id,project_id,name,drawing_type,status,detected_project_name,detected_project_code,pipeline_version,ensemble_result,created_at').eq('company_id', companyId).order('created_at', { ascending: false }).limit(100),
      supabase.from('drawing_ai_runs').select('id,job_id,provider,model,status,latency_ms,error_message,result').eq('company_id', companyId).order('created_at', { ascending: false }).limit(300),
      supabase.from('drawing_ai_model_registry').select('id,provider,model,role,availability,cost_tier,notes').order('provider'),
      supabase.from('drawing_ai_module_runs').select('id,job_id,module_key,module_version,status,warnings,latency_ms').eq('company_id', companyId).order('created_at', { ascending: false }).limit(600),
      supabase.from('drawing_sheets').select('id,job_id,page_number,sheet_number,title,revision,discipline_code,sheet_role,building,floor,zone,scale,confidence').eq('company_id', companyId).order('page_number'),
      supabase.from('drawing_sheet_items').select('id,job_id,page_number,system_code,item_code,description,specification,unit,quantity,building,floor,zone,room,count_method,evidence,confidence,review_status').eq('company_id', companyId).order('page_number').limit(2000),
    ])
    const error = p.error ?? j.error ?? r.error ?? registry.error ?? modules.error ?? sheetResult.error ?? itemResult.error
    if (error) setMessage(userError(error))
    setProjects((p.data ?? []) as Project[])
    setJobs((j.data ?? []) as Job[])
    setRuns((r.data ?? []) as Run[])
    // Aggregate views currently have no company dimension. Do not expose cross-company analysis.
    setLeaders([])
    setModelRegistry((registry.data ?? []) as ModelRegistry[])
    setModuleRuns((modules.data ?? []) as ModuleRun[])
    setLearningCoverage([])
    setSheets((sheetResult.data ?? []) as DrawingSheet[])
    setSheetItems((itemResult.data ?? []) as SheetItem[])
  }, [currentCompany?.company_id])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  useEffect(() => {
    if (!jobs.some((job) => ['queued', 'processing'].includes(job.status))) return
    const timer = window.setInterval(() => { void load() }, 10000)
    return () => window.clearInterval(timer)
  }, [jobs, load])

  const toggleProvider = (provider: Provider) => {
    setProviders((current) => current.includes(provider) ? current.filter((item) => item !== provider) : [...current, provider])
  }

  const submit = async () => {
    if (!file || providers.length === 0 || !profile || !currentCompany) return
    setBusy(true); setMessage('')
    let openSourceOcr: OpenSourceOcrResult | null = null
    if (file.type.startsWith('image/')) {
      setMessage('กำลังอ่านข้อความด้วย Tesseract OCR...')
      try {
        const { createWorker } = await import('tesseract.js')
        const worker = await createWorker(['eng', 'tha'])
        try {
          const { data } = await worker.recognize(file)
          openSourceOcr = {
            engine: 'tesseract',
            model: 'tesseract.js-7',
            languages: ['eng', 'tha'],
            text: data.text.trim().slice(0, 100_000),
            confidence: Math.max(0, Math.min(100, data.confidence)) / 100,
          }
        } finally {
          await worker.terminate()
        }
      } catch (error) {
        console.warn('Tesseract OCR unavailable; continuing with cloud vision providers.', error)
      }
    }
    const path = `${currentCompany.company_id}/${projectId || 'auto-project'}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const upload = await runAttempt<{ data?: { path: string; id?: string }; error?: unknown }>('upload_source_file', { path, file_name: file.name }, async () =>
      supabase.storage.from('drawing-ai').upload(path, file, { contentType: file.type }))
    if (upload.error) { setMessage(userError(upload.error)); setBusy(false); return }
    const created = await runAttempt<{ data?: { id: string }; error?: unknown }>('create_job', {
      company_id: currentCompany.company_id,
      project_id: projectId || null,
      drawing_type: drawingType,
    }, async () => await supabase.from('drawing_ai_jobs').insert({
      company_id: currentCompany.company_id,
      project_id: projectId || null, name: file.name, drawing_type: drawingType,
      storage_path: path, mime_type: file.type, requested_providers: providers,
      open_source_ocr: openSourceOcr, created_by: profile.id,
    }).select('id').single())
    if (created.error || !created.data?.id) { setMessage(userError(created.error)); setBusy(false); return }
    const createdJobId = created.data.id
    const invoked = await runAttempt('invoke_benchmark', { jobId: createdJobId }, async () =>
      supabase.functions.invoke('drawing-ai-benchmark', { body: { jobId: createdJobId } }))
    if (invoked.error) setMessage(userError(invoked.error))
    else setMessage('รับงานเข้าคิวแล้ว ปิดหน้านี้ได้และกลับมาดูผลภายหลัง ระบบจะอัปเดตสถานะอัตโนมัติ')
    setBusy(false); setFile(null); await load()
  }

  const saveManualProject = async () => {
    if (!manualProjectJob || !manualProjectName.trim() || !profile || !currentCompany) return
    setBusy(true)
    try {
      let project = projects.find((item) =>
        manualProjectCode.trim() && item.code?.toLowerCase() === manualProjectCode.trim().toLowerCase())
      if (!project) {
      const created = await runAttempt<{ data?: { id: string; name: string; code: string }; error?: unknown }>('create_manual_project', {
          company_id: currentCompany.company_id,
          name: manualProjectName.trim(),
          code: manualProjectCode.trim() || 'auto-generated',
        }, async () => await supabase.from('projects').insert({
          company_id: currentCompany.company_id,
          name: manualProjectName.trim(),
          code: manualProjectCode.trim() || `MANUAL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
          status: 'active',
          created_by: profile.id,
        }).select('id:project_id,name,code').single())
        if (created.error) throw created.error
        project = created.data as Project
      }
      const updated = await runAttempt<{ error?: unknown }>('attach_job_to_project', { job_id: manualProjectJob.id }, async () => await supabase.from('drawing_ai_jobs').update({
        project_id: project.id,
        status: runs.some((run) => run.job_id === manualProjectJob.id && run.status === 'completed') ? 'completed' : 'failed',
        updated_at: new Date().toISOString(),
      }).eq('company_id', currentCompany.company_id).eq('id', manualProjectJob.id))
      if (updated.error) throw updated.error
      setManualProjectJob(null)
      setManualProjectName('')
      setManualProjectCode('')
      setMessage('ผูกแบบเข้ากับโครงการเรียบร้อยแล้ว')
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? userError(error) : 'สร้างโครงการไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const normalize = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z0-9ก-๙]/g, '')
  const keyOf = (item: TakeoffItem) => normalize(item.code) || `${normalize(item.category)}:${normalize(item.description)}`
  const scoreRun = (predicted: TakeoffItem[], truth: TakeoffItem[]) => {
    const truthMap = new Map(truth.map((item) => [keyOf(item), item]))
    const predictedMap = new Map(predicted.map((item) => [keyOf(item), item]))
    const matches = [...predictedMap].filter(([key]) => key && truthMap.has(key))
    const precision = predictedMap.size ? matches.length / predictedMap.size : 0
    const recall = truthMap.size ? matches.length / truthMap.size : 0
    if (!matches.length) return { item_precision: precision, item_recall: recall, quantity_accuracy: 0, unit_accuracy: 0, evidence_accuracy: 0 }
    let quantity = 0; let unit = 0; let evidence = 0
    for (const [key, item] of matches) {
      const expected = truthMap.get(key)!
      const actualQuantity = Number(item.quantity)
      const expectedQuantity = Number(expected.quantity)
      if (Number.isFinite(actualQuantity) && Number.isFinite(expectedQuantity)) {
        quantity += expectedQuantity === 0 ? Number(actualQuantity === 0) : Math.max(0, 1 - Math.abs(actualQuantity - expectedQuantity) / Math.abs(expectedQuantity))
      }
      unit += Number(normalize(item.unit) === normalize(expected.unit))
      evidence += Number(Boolean(item.page && item.evidence?.trim()))
    }
    return {
      item_precision: precision, item_recall: recall,
      quantity_accuracy: quantity / matches.length,
      unit_accuracy: unit / matches.length,
      evidence_accuracy: evidence / matches.length,
    }
  }

  const openReview = (run: Run) => {
    setReviewJobId(run.job_id)
    setTruthJson(JSON.stringify(run.result?.items ?? [], null, 2))
  }

  const saveGroundTruth = async () => {
    if (!profile || !currentCompany || !reviewJobId) return
    try {
      const truth = JSON.parse(truthJson) as TakeoffItem[]
      if (!Array.isArray(truth)) throw new Error('Ground truth ต้องเป็น JSON array')
      if (truth.some((item) => !keyOf(item))) throw new Error('ทุกรายการต้องมี code หรือ category + description')
      setBusy(true)
      const truthResult = await runAttempt('save_ground_truth', { job_id: reviewJobId, truths: truth.length }, async () => await supabase.from('drawing_ai_ground_truth').upsert({
        company_id: currentCompany.company_id,
        job_id: reviewJobId, items: truth, verified_by: profile.id, verified_at: new Date().toISOString(),
      }))
      if (truthResult.error) throw truthResult.error
      const jobRuns = runs.filter((run) => run.job_id === reviewJobId && run.status === 'completed' && Array.isArray(run.result?.items))
      const scores = jobRuns.map((run) => ({ company_id: currentCompany.company_id, run_id: run.id, ...scoreRun(run.result!.items as TakeoffItem[], truth) }))
      if (scores.length) {
        const scoreResult = await runAttempt('save_scores', { job_id: reviewJobId, score_count: scores.length }, async () => await supabase.from('drawing_ai_scores').upsert(scores))
        if (scoreResult.error) throw scoreResult.error
      }
      const jobResult = await runAttempt('mark_job_verified', { job_id: reviewJobId }, async () => await supabase.from('drawing_ai_jobs').update({
        status: 'verified', verified_by: profile.id, verified_at: new Date().toISOString(),
      }).eq('company_id', currentCompany.company_id).eq('id', reviewJobId))
      if (jobResult.error) throw jobResult.error
      setReviewJobId(''); setMessage('ยืนยัน ground truth และคำนวณอันดับทุกโมเดลแล้ว')
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? userError(error) : 'บันทึก ground truth ไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const toggleScopeSystem = (code: string) => {
    setScopeSystems((current) => current.includes(code)
      ? current.filter((item) => item !== code)
      : [...current, code])
  }

  const saveScope = async () => {
    if (!detailJob || !profile || !currentCompany || !scopeSystems.length) return
    setBusy(true)
    try {
      const scopeResult = await runAttempt('save_scope', { job_id: detailJob.id, systems: scopeSystems }, async () => await supabase.from('drawing_takeoff_scopes').upsert({
        company_id: currentCompany.company_id,
        job_id: detailJob.id,
        output_system_codes: scopeSystems,
        status: 'review',
        selected_by: profile.id,
        selected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }))
      if (scopeResult.error) throw scopeResult.error
      const jobSheets = sheets.filter((sheet) => sheet.job_id === detailJob.id)
      const dependencies = scopeSystems.flatMap((outputCode) => jobSheets.flatMap((sheet) => {
        if (sheet.discipline_code === outputCode) {
          return [{ job_id: detailJob.id, output_system_code: outputCode, sheet_id: sheet.id,
            dependency_type: 'primary', reason: 'แบบหลักของระบบที่เลือก', auto_selected: true }]
        }
        if ((referenceSystems[outputCode] ?? []).includes(sheet.discipline_code ?? '')) {
          return [{ job_id: detailJob.id, output_system_code: outputCode, sheet_id: sheet.id,
            dependency_type: sheet.discipline_code === 'AR' ? 'room_boundary' : sheet.discipline_code === 'ST' ? 'level' : 'clash',
            reason: 'แบบอ้างอิงสำหรับหาระยะ ระดับ ขอบเขตห้อง และตรวจการชนระบบ', auto_selected: true }]
        }
        return []
      }))
      await runAttempt('delete_sheet_dependencies', { job_id: detailJob.id }, async () =>
        supabase.from('drawing_sheet_dependencies').delete().eq('company_id', currentCompany.company_id).eq('job_id', detailJob.id))
      if (dependencies.length) {
        const dependencyResult = await runAttempt('save_sheet_dependencies', { job_id: detailJob.id, count: dependencies.length }, async () =>
          supabase.from('drawing_sheet_dependencies').insert(
            dependencies.map((dependency) => ({ ...dependency, company_id: currentCompany.company_id })),
          ))
        if (dependencyResult.error) throw dependencyResult.error
      }
      const updateResult = await runAttempt('mark_job_awaiting_review', { job_id: detailJob.id }, async () => await supabase.from('drawing_ai_jobs').update({
        status: 'awaiting_review', updated_at: new Date().toISOString(),
      }).eq('company_id', currentCompany.company_id).eq('id', detailJob.id))
      if (updateResult.error) throw updateResult.error
      setMessage(`บันทึกขอบเขต BOQ แล้ว ${scopeSystems.length} ระบบ พร้อมเลือกแบบอ้างอิงข้ามระบบอัตโนมัติ`)
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? userError(error) : 'บันทึกขอบเขต BOQ ไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  return <Stack spacing={3}>
    <PageHeader title="Drawing AI Benchmark" description="อ่านแบบด้วยหลาย AI และจัดอันดับจากคำตอบที่ผู้เชี่ยวชาญยืนยันจริง"
      action={<Button startIcon={<RefreshOutlinedIcon />} onClick={() => void load()}>รีเฟรช</Button>} />
    {message && <Alert severity={message.includes('เสร็จ') ? 'success' : 'warning'}>{message}</Alert>}
    {canManage && <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Stack spacing={2}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>ส่งแบบเข้าทดสอบพร้อมกัน</Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField select fullWidth label="โครงการ (ไม่เลือก = ให้ AI อ่านจากแบบ)" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <MenuItem value="">อ่านชื่อโครงการจาก Title Block อัตโนมัติ</MenuItem>
            {projects.map((project) => <MenuItem key={project.id} value={project.id}>{project.code ? `${project.code} · ` : ''}{project.name}</MenuItem>)}
          </TextField>
          <TextField select fullWidth label="ประเภทแบบ" value={drawingType} onChange={(e) => setDrawingType(e.target.value)}>
            {disciplines.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
          </TextField>
          <Button component="label" variant="outlined" startIcon={<CloudUploadOutlinedIcon />} sx={{ minWidth: 190 }}>
            {file?.name ?? 'เลือก PDF / รูปแบบ'}
            <input hidden type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Button>
        </Stack>
        <Stack direction="row" spacing={2}>
          {(['gemini', 'openai', 'anthropic'] as Provider[]).map((provider) =>
            <FormControlLabel key={provider} control={<Checkbox checked={providers.includes(provider)} onChange={() => toggleProvider(provider)} />} label={provider} />)}
        </Stack>
        <Button variant="contained" disabled={busy || !file || providers.length === 0} onClick={() => void submit()}>
          {busy ? <><CircularProgress size={18} sx={{ mr: 1 }} />กำลังอ่านแบบทุกโมเดล</> : 'เริ่ม Benchmark'}
        </Button>
      </Stack>
    </Paper>}

    <Typography variant="h6" sx={{ fontWeight: 700 }}>อันดับความแม่นยำที่ยืนยันแล้ว</Typography>
    <StandardDataTable rows={leaders} getRowId={(row) => `${row.provider}-${row.model}-${row.drawing_type}`}
      emptyText="ยังไม่มี ground truth ที่ผู้ตรวจยืนยัน จึงยังบอกไม่ได้ว่า AI ตัวใดแม่นที่สุด"
      columns={[
        { id: 'rank', label: 'AI', render: (row) => <Chip label={`${row.provider} · ${row.model}`} />, exportValue: (row) => row.provider },
        { id: 'type', label: 'ประเภทแบบ', render: (row) => row.drawing_type, exportValue: (row) => row.drawing_type },
        { id: 'runs', label: 'ชุดทดสอบ', align: 'right', render: (row) => row.scored_runs, exportValue: (row) => row.scored_runs },
        { id: 'score', label: 'Accuracy', align: 'right', render: (row) => `${(Number(row.accuracy_score) * 100).toFixed(1)}%`, exportValue: (row) => row.accuracy_score },
        { id: 'latency', label: 'เวลาเฉลี่ย', align: 'right', render: (row) => `${(row.average_latency_ms / 1000).toFixed(1)} วินาที`, exportValue: (row) => row.average_latency_ms },
      ]} />

    <Typography variant="h6" sx={{ fontWeight: 700 }}>Wisdom AI Model Registry</Typography>
    <StandardDataTable rows={modelRegistry} getRowId={(row) => row.id} emptyText="ยังไม่มีโมเดลใน registry"
      columns={[
        { id: 'model', label: 'Provider / Model', render: (row) => `${row.provider} · ${row.model}`, exportValue: (row) => row.model },
        { id: 'role', label: 'หน้าที่', render: (row) => row.role, exportValue: (row) => row.role },
        { id: 'availability', label: 'สถานะ', render: (row) =>
          <Chip size="small" color={row.availability === 'active' ? 'success' : row.availability.startsWith('blocked') ? 'error' : 'warning'} label={row.availability} />,
          exportValue: (row) => row.availability },
        { id: 'cost', label: 'ต้นทุน', render: (row) => row.cost_tier, exportValue: (row) => row.cost_tier },
        { id: 'notes', label: 'หมายเหตุ', minWidth: 260, render: (row) => row.notes ?? '-', exportValue: (row) => row.notes },
      ]} />

    <Typography variant="h6" sx={{ fontWeight: 700 }}>WisdomAI Learning Map — 18 งาน</Typography>
    <StandardDataTable rows={learningCoverage} getRowId={(row) => row.code}
      getSearchText={(row) => `${row.name_th} ${row.category} ${row.primary_metric}`}
      emptyText="ยังไม่มี Learning Map"
      columns={[
        { id: 'order', label: '#', align: 'right', render: (row) => row.sort_order, exportValue: (row) => row.sort_order },
        { id: 'name', label: 'งานที่เรียนรู้', minWidth: 260, render: (row) => row.name_th, exportValue: (row) => row.name_th },
        { id: 'category', label: 'กลุ่ม', render: (row) => row.category, exportValue: (row) => row.category },
        { id: 'metric', label: 'ตัวชี้วัดหลัก', render: (row) => row.primary_metric, exportValue: (row) => row.primary_metric },
        { id: 'examples', label: 'ตัวอย่างยืนยันแล้ว', align: 'right', render: (row) => row.verified_examples, exportValue: (row) => row.verified_examples },
        { id: 'status', label: 'สถานะ', render: (row) =>
          <Chip size="small" color={row.status === 'active' ? 'success' : 'warning'} label={row.status} />, exportValue: (row) => row.status },
        { id: 'guardrail', label: 'ข้อห้าม', minWidth: 260, render: (row) => row.guardrail, exportValue: (row) => row.guardrail },
      ]} />

    <Typography variant="h6" sx={{ fontWeight: 700 }}>ประวัติการอ่านแบบ</Typography>
    <StandardDataTable rows={jobs} getRowId={(row) => row.id}
      getSearchText={(row) => `${row.name} ${row.detected_project_name ?? ''} ${row.detected_project_code ?? ''}`}
      emptyText="ยังไม่มีงานอ่านแบบ"
      columns={[
        { id: 'name', label: 'ไฟล์แบบ', render: (row) => row.name, exportValue: (row) => row.name },
        { id: 'project', label: 'โครงการ', minWidth: 220, render: (row) => {
          const project = projects.find((item) => item.id === row.project_id)
          return project ? `${project.code ? `${project.code} · ` : ''}${project.name}` : row.detected_project_name ?? 'อ่านชื่อโครงการไม่พบ'
        }, exportValue: (row) => row.detected_project_name },
        { id: 'status', label: 'สถานะ', render: (row) =>
          <Chip size="small" color={row.status === 'needs_project' ? 'warning' : row.status === 'completed' ? 'success' : 'default'} label={row.status} />,
          exportValue: (row) => row.status },
        { id: 'ensemble', label: 'Wisdom Ensemble', align: 'right', render: (row) =>
          row.ensemble_result
            ? `${row.ensemble_result.items?.length ?? 0} รายการ · ตรวจคน ${row.ensemble_result.review_items?.length ?? 0}`
            : '-', exportValue: (row) => row.ensemble_result?.items?.length },
        { id: 'action', label: 'ดำเนินการ', minWidth: 190, render: (row) => canManage && row.status === 'needs_project'
          ? <Button size="small" variant="contained" onClick={() => {
            setManualProjectJob(row)
            setManualProjectName(row.detected_project_name ?? '')
            setManualProjectCode(row.detected_project_code ?? '')
          }}>ใส่ชื่อโครงการ</Button>
          : <Button size="small" variant="outlined" disabled={!sheets.some((sheet) => sheet.job_id === row.id)}
            onClick={() => { setDetailJob(row); setScopeSystems([]) }}>ตรวจแบบ/เลือก BOQ</Button>, exportValue: () => '' },
      ]} />
    <StandardDataTable rows={moduleRuns} getRowId={(row) => row.id}
      getSearchText={(row) => `${row.module_key} ${jobs.find((job) => job.id === row.job_id)?.name ?? ''}`}
      emptyText="ยังไม่มีผลโมดูลผู้เชี่ยวชาญ"
      columns={[
        { id: 'file', label: 'ไฟล์', render: (row) => jobs.find((job) => job.id === row.job_id)?.name ?? '-', exportValue: (row) => jobs.find((job) => job.id === row.job_id)?.name },
        { id: 'module', label: 'โมดูลผู้เชี่ยวชาญ', render: (row) => `${row.module_key} · v${row.module_version}`, exportValue: (row) => row.module_key },
        { id: 'status', label: 'สถานะ', render: (row) => <Chip size="small" color={row.status === 'completed' ? 'success' : row.status === 'warning' ? 'warning' : 'error'} label={row.status} />, exportValue: (row) => row.status },
        { id: 'warnings', label: 'ต้องตรวจ', align: 'right', render: (row) => row.warnings.length, exportValue: (row) => row.warnings.length },
        { id: 'latency', label: 'เวลา', align: 'right', render: (row) => row.latency_ms ? `${row.latency_ms} ms` : '-', exportValue: (row) => row.latency_ms },
      ]} />
    <StandardDataTable rows={runs} getRowId={(row) => row.id}
      getSearchText={(row) => `${row.provider} ${row.model} ${jobs.find((job) => job.id === row.job_id)?.name ?? ''}`}
      emptyText="ยังไม่มีผลการทดสอบ"
      columns={[
        { id: 'file', label: 'ไฟล์', render: (row) => jobs.find((job) => job.id === row.job_id)?.name ?? '-', exportValue: (row) => jobs.find((job) => job.id === row.job_id)?.name },
        { id: 'provider', label: 'AI / Model', render: (row) => `${row.provider} · ${row.model}`, exportValue: (row) => row.provider },
        { id: 'status', label: 'สถานะ', render: (row) => <Chip size="small" color={row.status === 'completed' ? 'success' : row.status === 'failed' ? 'error' : 'default'} label={row.status} />, exportValue: (row) => row.status },
        { id: 'items', label: 'รายการที่พบ', align: 'right', render: (row) => row.result?.items?.length ?? '-', exportValue: (row) => row.result?.items?.length },
        { id: 'latency', label: 'เวลา', align: 'right', render: (row) => row.latency_ms ? `${(row.latency_ms / 1000).toFixed(1)} วินาที` : '-', exportValue: (row) => row.latency_ms },
        { id: 'error', label: 'ข้อผิดพลาด', minWidth: 220, render: (row) => row.error_message ?? '-', exportValue: (row) => row.error_message },
        { id: 'review', label: 'ตรวจเทียบ', render: (row) => canManage && row.status === 'completed'
          ? <Button size="small" variant="outlined" onClick={() => openReview(row)}>สร้าง Ground truth</Button> : '-', exportValue: () => '' },
      ]} />
    <Dialog open={Boolean(reviewJobId)} onClose={() => !busy && setReviewJobId('')} fullWidth maxWidth="md">
      <DialogTitle>ผู้เชี่ยวชาญตรวจยืนยัน Ground truth</DialogTitle>
      <DialogContent>
        <Alert severity="info" sx={{ my: 1 }}>
          แก้ JSON ให้เป็นรายการและปริมาณจริงจากแบบ ระบบจะใช้ชุดนี้วัด Precision, Recall, Quantity, Unit และหลักฐานของ AI ทุกตัว
        </Alert>
        <TextField multiline fullWidth minRows={16} value={truthJson} onChange={(e) => setTruthJson(e.target.value)}
          slotProps={{ htmlInput: { style: { fontFamily: 'monospace', fontSize: 13 } } }} />
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={() => setReviewJobId('')}>ยกเลิก</Button>
        <Button variant="contained" disabled={busy} onClick={() => void saveGroundTruth()}>ยืนยันและคำนวณอันดับ</Button>
      </DialogActions>
    </Dialog>
    <Dialog open={Boolean(manualProjectJob)} onClose={() => !busy && setManualProjectJob(null)} fullWidth maxWidth="sm">
      <DialogTitle>ระบุโครงการของแบบ</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ mt: 1 }}>
        <Alert severity="info">AI ไม่พบชื่อโครงการใน Title Block กรุณาระบุชื่อเพื่อสร้างและผูกโครงการอัตโนมัติ</Alert>
        <TextField autoFocus label="ชื่อโครงการ" value={manualProjectName} onChange={(e) => setManualProjectName(e.target.value)} />
        <TextField label="รหัสโครงการ (เว้นว่างให้ระบบสร้าง)" value={manualProjectCode} onChange={(e) => setManualProjectCode(e.target.value)} />
      </Stack></DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={() => setManualProjectJob(null)}>ยกเลิก</Button>
        <Button variant="contained" disabled={busy || !manualProjectName.trim()} onClick={() => void saveManualProject()}>สร้างและผูกโครงการ</Button>
      </DialogActions>
    </Dialog>
    <Dialog open={Boolean(detailJob)} onClose={() => !busy && setDetailJob(null)} fullWidth maxWidth="xl">
      <DialogTitle>Drawing Index และขอบเขต BOQ — {detailJob?.name}</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ mt: 1 }}>
        <Alert severity="info">
          เลือกระบบที่ต้องการให้ออก BOQ ระบบจะนำแบบสถาปัตย์ โครงสร้าง และระบบที่เกี่ยวข้องมาใช้หาระยะ ระดับ และตรวจการชนโดยอัตโนมัติ แต่จะไม่สร้าง BOQ ของแบบอ้างอิง
        </Alert>
        <Typography sx={{ fontWeight: 700 }}>1. แบบทั้งหมด {sheets.filter((sheet) => sheet.job_id === detailJob?.id).length} แผ่น</Typography>
        <StandardDataTable rows={sheets.filter((sheet) => sheet.job_id === detailJob?.id)} getRowId={(row) => row.id}
          emptyText="ยังไม่มี Drawing Index" minWidth={1100} columns={[
            { id: 'page', label: 'หน้า', render: (row) => row.page_number, exportValue: (row) => row.page_number },
            { id: 'number', label: 'เลขที่แบบ', render: (row) => row.sheet_number ?? '-', exportValue: (row) => row.sheet_number },
            { id: 'title', label: 'ชื่อแบบ', minWidth: 220, render: (row) => row.title ?? '-', exportValue: (row) => row.title },
            { id: 'system', label: 'ระบบ', render: (row) => row.discipline_code ?? '-', exportValue: (row) => row.discipline_code },
            { id: 'role', label: 'ประเภทแผ่น', render: (row) => row.sheet_role, exportValue: (row) => row.sheet_role },
            { id: 'location', label: 'อาคาร/ชั้น/โซน', render: (row) => [row.building,row.floor,row.zone].filter(Boolean).join(' / ') || '-', exportValue: (row) => [row.building,row.floor,row.zone].filter(Boolean).join(' / ') },
            { id: 'scale', label: 'มาตราส่วน', render: (row) => row.scale ?? '-', exportValue: (row) => row.scale },
          ]} />
        <Divider />
        <Typography sx={{ fontWeight: 700 }}>2. เลือกระบบที่ต้องการออก BOQ</Typography>
        <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap' }}>
          {workSystems.map(([code, label]) => <FormControlLabel key={code}
            control={<Checkbox checked={scopeSystems.includes(code)} onChange={() => toggleScopeSystem(code)} />}
            label={`${code} · ${label}`} />)}
        </Stack>
        <Divider />
        <Typography sx={{ fontWeight: 700 }}>3. รายการที่อ่านได้ แยกตามแผ่นและห้อง</Typography>
        <StandardDataTable rows={sheetItems.filter((item) => item.job_id === detailJob?.id)} getRowId={(row) => row.id}
          getSearchText={(row) => `${row.system_code} ${row.item_code} ${row.description} ${row.room} ${row.floor}`}
          searchLabel="ค้นหาระบบ รายการ ชั้น หรือห้อง" emptyText="ยังไม่มีรายการถอดปริมาณ" minWidth={1400}
          columns={[
            { id: 'page', label: 'แผ่น', render: (row) => row.page_number, exportValue: (row) => row.page_number },
            { id: 'system', label: 'ระบบ', render: (row) => row.system_code ?? '-', exportValue: (row) => row.system_code },
            { id: 'location', label: 'ชั้น/โซน/ห้อง', minWidth: 220, render: (row) => [row.floor,row.zone,row.room].filter(Boolean).join(' / ') || 'ไม่ระบุพื้นที่', exportValue: (row) => [row.floor,row.zone,row.room].filter(Boolean).join(' / ') },
            { id: 'code', label: 'รหัส', render: (row) => row.item_code ?? '-', exportValue: (row) => row.item_code },
            { id: 'description', label: 'รายการ', minWidth: 260, render: (row) => row.description, exportValue: (row) => row.description },
            { id: 'quantity', label: 'ปริมาณ', align: 'right', render: (row) => row.quantity == null ? 'รอตรวจ' : `${Number(row.quantity).toLocaleString('th-TH')} ${row.unit ?? ''}`, exportValue: (row) => row.quantity },
            { id: 'method', label: 'วิธีนับ', render: (row) => row.count_method, exportValue: (row) => row.count_method },
            { id: 'review', label: 'ตรวจสอบ', render: (row) => <Chip size="small" color={row.review_status === 'needs_review' ? 'warning' : 'default'} label={row.review_status} />, exportValue: (row) => row.review_status },
          ]} />
      </Stack></DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={() => setDetailJob(null)}>ปิด</Button>
        <Button variant="contained" disabled={busy || !scopeSystems.length} onClick={() => void saveScope()}>
          บันทึกขอบเขตและแบบอ้างอิง
        </Button>
      </DialogActions>
    </Dialog>
  </Stack>
}

