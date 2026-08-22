import AddOutlinedIcon from '@mui/icons-material/AddOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined'
import {
  Alert, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem,
  Paper, Stack, TextField, Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
import { userError } from '../../utils/userError'
import { runWithMutationAttempt } from '../../utils/mutationAttemptRunner'

type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived'
type Project = {
  id: string
  name: string
  code: string | null
  status: ProjectStatus
  created_at: string
  updated_at: string
  sales_status?:string
  delivery_status?:string
  expected_contract_value?:number
  site_count?:number
  actual_cost?:number
  forecast_cost?:number
}
type ProjectForm = { name: string; code: string; status: ProjectStatus }

const emptyForm: ProjectForm = { name: '', code: '', status: 'active' }
const statusLabels: Record<ProjectStatus, string> = {
  active: 'กำลังดำเนินการ',
  paused: 'พักโครงการ',
  completed: 'เสร็จสิ้น',
  archived: 'เก็บถาวร',
}
const statusColors: Record<ProjectStatus, 'success' | 'warning' | 'info' | 'default'> = {
  active: 'success',
  paused: 'warning',
  completed: 'info',
  archived: 'default',
}
const salesLabels:Record<string,string>={lead:'ลูกค้าเป้าหมาย',qualified:'ผ่านการคัดกรอง',proposal:'เสนอราคา',negotiation:'เจรจา',won:'ปิดการขาย',lost:'ไม่ได้งาน',on_hold:'พักการขาย'}
const deliveryLabels:Record<string,string>={not_started:'ยังไม่เริ่ม',mobilizing:'เตรียมเริ่มงาน',in_progress:'กำลังดำเนินการ',on_hold:'พักงาน',completed:'เสร็จสิ้น',cancelled:'ยกเลิก'}
const money=(value:number|undefined)=>new Intl.NumberFormat('th-TH',{style:'currency',currency:'THB',maximumFractionDigits:0}).format(value??0)

export function ProjectPage() {
  const navigate=useNavigate()
  usePageTitle('จัดการโปรเจกต์')
  const { profile } = useAuth()
  const canManage = profile?.role === 'admin' || profile?.role === 'manager'
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<Project | null>(null)
  const [form, setForm] = useState<ProjectForm>(emptyForm)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [updatingStatus,setUpdatingStatus]=useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const [projectResult,commercialResult,siteResult,costResult]=await Promise.all([
      supabase.from('projects').select('id:project_id,name,code,status,created_at,updated_at').order('updated_at',{ascending:false}),
      supabase.from('project_commercial_profiles').select('project_id,sales_status,delivery_status,expected_contract_value'),
      supabase.from('project_sites').select('project_id'),
      supabase.from('project_cost_entries').select('project_id,actual_amount,forecast_amount'),
    ])
    const loadError=projectResult.error||commercialResult.error||siteResult.error||costResult.error
    if (loadError) setError(userError(loadError))
    else {const commercialMap=new Map((commercialResult.data??[]).map(row=>[row.project_id,row]));const siteCounts=new Map<string,number>();for(const row of siteResult.data??[])siteCounts.set(row.project_id,(siteCounts.get(row.project_id)??0)+1);const costMap=new Map<string,{actual:number;forecast:number}>();for(const row of costResult.data??[]){const value=costMap.get(row.project_id)??{actual:0,forecast:0};value.actual+=Number(row.actual_amount||0);value.forecast+=Number(row.forecast_amount||0);costMap.set(row.project_id,value)}setProjects((projectResult.data??[]).map(row=>({...row,...commercialMap.get(row.id),site_count:siteCounts.get(row.id)??0,actual_cost:costMap.get(row.id)?.actual??0,forecast_cost:costMap.get(row.id)?.forecast??0})) as Project[])}
    setLoading(false)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const counts = useMemo(() => ({
    all: projects.length,
    active: projects.filter((item) => item.status === 'active').length,
    paused: projects.filter((item) => item.status === 'paused').length,
    completed: projects.filter((item) => item.status === 'completed').length,
  }), [projects])

  const openCreate = () => {
    setSelected(null)
    setForm(emptyForm)
    setError('')
    setDialogOpen(true)
  }

  const openEdit = (project: Project) => {
    setSelected(project)
    setForm({ name: project.name, code: project.code || '', status: project.status })
    setError('')
    setDialogOpen(true)
  }

  const changeStatus=async(project:Project,status:ProjectStatus)=>{
    if(status===project.status)return
    const reason=status==='active'?'':window.prompt('กรุณาระบุเหตุผลการเปลี่ยนสถานะ')?.trim()
    if(status!=='active'&&!reason)return
    if(!window.confirm(`ยืนยันเปลี่ยนสถานะ ${project.name} เป็น ${statusLabels[status]}`))return
    setUpdatingStatus(project.id);setError('');setSuccess('')
    try {
      await runWithMutationAttempt({
        module: 'Project',
        action: `เปลี่ยนสถานะโปรเจกต์เป็น ${statusLabels[status]}`,
        actorProfileId: profile?.id,
        companyId: project.id ? null : null,
        request: { target_project_id: project.id, target_status: status, change_reason: reason || null },
        operation: async () => await supabase.rpc('change_project_primary_status', { target_project_id: project.id, target_status: status, change_reason: reason || null }),
      })
      setSuccess('เปลี่ยนสถานะโครงการแล้ว')
      await load()
    } catch (error) {
      setError(error instanceof Error ? error.message : userError(error))
    }
    setUpdatingStatus('')
  }

  const save = async () => {
    const name = form.name.trim()
    const code = form.code.trim().toUpperCase()
    if (!name) {
      setError('กรุณาระบุชื่อโปรเจกต์')
      return
    }
    if (code && !/^[A-Z0-9_-]+$/.test(code)) {
      setError('รหัสโปรเจกต์ใช้ได้เฉพาะ A-Z, 0-9, ขีดกลาง และขีดล่าง')
      return
    }
    const duplicate = projects.find((item) =>
      item.id !== selected?.id && code && item.code?.toUpperCase() === code)
    if (duplicate) {
      setError(`รหัส ${code} ถูกใช้โดยโปรเจกต์ ${duplicate.name} แล้ว`)
      return
    }

    setSaving(true)
    setError('')
    setSuccess('')
    const payload = {
      name,
      code: code || null,
      updated_at: new Date().toISOString(),
    }
    try {
      if (selected) {
        await runWithMutationAttempt({
          module: 'Project',
          action: 'แก้ไขข้อมูลโปรเจกต์',
          actorProfileId: profile?.id,
          companyId: null,
          request: { ...payload, target_project_id: selected.id },
          operation: async () => await supabase.from('projects').update(payload).eq('project_id', selected.id),
        })
        setSuccess('บันทึกการแก้ไขโปรเจกต์แล้ว')
      } else {
        await runWithMutationAttempt({
          module: 'Project',
          action: 'เพิ่มโปรเจกต์ใหม่',
          actorProfileId: profile?.id,
          companyId: null,
          request: { ...payload, created_by: profile?.id },
          operation: async () => await supabase.from('projects').insert({ ...payload, status: 'active', created_by: profile?.id }),
        })
        setSuccess('สร้างโปรเจกต์ใหม่แล้ว')
      }
      setDialogOpen(false)
      await load()
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === '23505') {
        setError('รหัสโปรเจกต์นี้มีอยู่ในระบบแล้ว')
      } else {
        setError(error instanceof Error ? error.message : userError(error))
      }
    }
    setSaving(false)
  }

  return <Stack spacing={3}>
    <PageHeader
      title="จัดการโปรเจกต์"
      description="ดู เพิ่ม แก้ไข และปรับสถานะโปรเจกต์ที่ใช้ร่วมกับ BOQ, LINE, ลงเวลา และรายงาน"
      action={<Stack direction="row" spacing={1}>
        <Button startIcon={<RefreshOutlinedIcon />} onClick={() => void load()} disabled={loading}>รีเฟรช</Button>
        {canManage && <Button variant="contained" startIcon={<AddOutlinedIcon />} onClick={openCreate}>
          เพิ่มโปรเจกต์
        </Button>}
      </Stack>}
    />

    {error && !dialogOpen && <Alert severity="error">{error}</Alert>}
    {success && <Alert severity="success">{success}</Alert>}
    {!canManage && <Alert severity="info">บัญชีของคุณดูข้อมูลโปรเจกต์ได้ แต่การเพิ่มหรือแก้ไขต้องใช้สิทธิ์ Admin หรือ Manager</Alert>}

    <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap' }}>
      {[
        ['ทั้งหมด', counts.all],
        ['กำลังดำเนินการ', counts.active],
        ['พักโครงการ', counts.paused],
        ['เสร็จสิ้น', counts.completed],
      ].map(([label, count]) => <Paper key={String(label)} variant="outlined" sx={{ p: 2, minWidth: 160 }}>
        <Typography variant="caption" color="text.secondary">{label}</Typography>
        <Typography variant="h5">{count}</Typography>
      </Paper>)}
    </Stack>

    <StandardDataTable
      rows={projects}
      getRowId={(item) => item.id}
      getSearchText={(item) => `${item.name} ${item.code || ''} ${statusLabels[item.status]} ${salesLabels[item.sales_status||'']||''} ${deliveryLabels[item.delivery_status||'']||''}`}
      searchLabel="ค้นหาชื่อ รหัส หรือสถานะโปรเจกต์"
      emptyText={loading ? 'กำลังโหลดข้อมูล...' : 'ยังไม่มีโปรเจกต์'}
      exportFileName="wisdomai-projects"
      columns={[
        { id: 'code', label: 'รหัส', minWidth: 140, render: (item) => item.code || '-' },
        { id: 'name', label: 'ชื่อโปรเจกต์', minWidth: 260, render: (item) => item.name, linkTo:item=>`/project-controls?project_id=${item.id}` },
        { id: 'status', label: 'สถานะ', minWidth: 180, render: (item) => canManage
          ? <TextField select size="small" value={item.status} disabled={updatingStatus===item.id} onChange={event=>void changeStatus(item,event.target.value as ProjectStatus)}>{Object.entries(statusLabels).map(([value,label])=><MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField>
          : <Chip size="small" color={statusColors[item.status]} label={statusLabels[item.status]} /> },
        {id:'sales',label:'สถานะขาย',minWidth:140,render:item=>salesLabels[item.sales_status||'']||'ยังไม่กำหนด'},
        {id:'delivery',label:'สถานะงาน',minWidth:140,render:item=>deliveryLabels[item.delivery_status||'']||'ยังไม่กำหนด'},
        {id:'sites',label:'จำนวนไซต์',align:'right',render:item=>item.site_count??0,exportValue:item=>item.site_count??0},
        {id:'value',label:'มูลค่าคาดการณ์',align:'right',allowedCompanyRoles:['company_admin','executive','manager','accounting_hr'],render:item=>money(item.expected_contract_value),exportValue:item=>item.expected_contract_value??0},
        {id:'actualCost',label:'ต้นทุนจริง',align:'right',allowedCompanyRoles:['company_admin','executive','manager','accounting_hr'],render:item=>money(item.actual_cost),exportValue:item=>item.actual_cost??0},
        {id:'forecastCost',label:'ต้นทุนคาดการณ์',align:'right',allowedCompanyRoles:['company_admin','executive','manager','accounting_hr'],render:item=>money(item.forecast_cost),exportValue:item=>item.forecast_cost??0},
        { id: 'updated', label: 'แก้ไขล่าสุด', minWidth: 180, render: (item) =>
          new Date(item.updated_at).toLocaleString('th-TH') },
        { id: 'action', label: 'จัดการ', minWidth:260, render: (item) => <Stack direction="row" spacing={1}>
          <Button size="small" variant="contained" onClick={()=>navigate(`/project-controls?project_id=${item.id}`)}>เปิดศูนย์โครงการ</Button>
          {canManage&&<Button size="small" startIcon={<EditOutlinedIcon />} onClick={() => openEdit(item)}>แก้ไข</Button>}
        </Stack> },
      ]}
    />

    <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} fullWidth maxWidth="sm">
      <DialogTitle>{selected ? 'แก้ไขโปรเจกต์' : 'เพิ่มโปรเจกต์'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            required autoFocus label="ชื่อโปรเจกต์"
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            slotProps={{ htmlInput: { maxLength: 200 } }}
          />
          <TextField
            label="รหัสโปรเจกต์"
            value={form.code}
            onChange={(event) => setForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))}
            helperText="ใช้สำหรับจับคู่ข้อความ LINE และเอกสาร เช่น PJ-001"
            slotProps={{ htmlInput: { maxLength: 50 } }}
          />
          {selected && <Alert severity="info">
            สถานะการขายและสถานะดำเนินงานแก้ไขที่ “เปิดศูนย์โครงการ” เพื่อให้ทั้งระบบใช้สถานะหลักชุดเดียวกัน
          </Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={saving} onClick={() => setDialogOpen(false)}>ยกเลิก</Button>
        <Button disabled={saving || !form.name.trim()} variant="contained" onClick={() => void save()}>
          {saving ? 'กำลังบันทึก...' : 'บันทึกข้อมูล'}
        </Button>
      </DialogActions>
    </Dialog>
  </Stack>
}

