import AddOutlinedIcon from '@mui/icons-material/AddOutlined'
import { Alert, Box, Button, Chip, MenuItem, Paper, Stack, Tab, Tabs, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
import { userError } from '../../utils/userError'
import { runWithMutationAttempt } from '../../utils/mutationAttemptRunner'
import { isEmployeeResigned } from '../../utils/employeeLifecycle'
import { SalesExpensePanel } from './SalesExpensePanel'

type Project = { project_id: string; name: string; code: string | null }
type Site = {
  id: string
  project_id: string
  name: string
  projects: { name: string } | null
}
type Employee = {
  id: string
  full_name: string | null
  email: string | null
  employee_code?: string | null
  employment_type?: string
  job_title?: string | null
  department?: string | null
  employment_status?: string | null
  work_policy_id?: string | null
  monthly_salary?: number
  membership_active?: boolean | null
}
type Assignment = {
  profile_id: string
  site_id: string
  starts_on: string
  ends_on: string | null
  active: boolean
  allocation_note: string | null
}
type Allocation = {
  id: string
  profile_id: string
  site_id: string
  allocation_mode: 'percent' | 'fixed_amount'
  allocation_value: number
  starts_on: string
  ends_on: string | null
  active: boolean
  note: string | null
}
type Commercial = {
  project_id: string
  sales_status: string
  delivery_status: string
  expected_contract_value: number
  win_probability: number
  status_reason: string | null
}
type Revision = {
  id: string
  project_id: string
  revision_no: number
  title: string
  status: string
  amount_before_vat: number
  vat_amount: number
  total_amount: number
  reason: string | null
  locked_at: string | null
  created_at: string
}
type CostCode = { id: string; code: string; name_th: string }
type CostEntry = {
  id: string
  project_id: string
  site_id: string | null
  cost_code_id: string
  cost_date: string
  description: string
  cause: string
  budget_amount: number
  committed_amount: number
  actual_amount: number
  forecast_amount: number
  phase: string | null
  area: string | null
  status: string
}
type ProjectMember = {
  project_id: string
  profile_id: string
  member_role: string
}

const today = () => new Date().toISOString().slice(0, 10)
const money = (value: number) =>
  Number(value || 0).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
const salesLabels: Record<string, string> = {
  lead: 'ลูกค้าเป้าหมาย',
  estimating: 'ประเมินราคา/จัดทำ BOQ',
  proposal_sent: 'เสนอราคาแล้ว',
  negotiation: 'เจรจา/รอผล',
  won: 'ปิดการขายสำเร็จ',
  lost: 'ขายไม่สำเร็จ',
  cancelled: 'ยกเลิก',
}
const deliveryLabels: Record<string, string> = {
  not_started: 'ยังไม่เริ่ม',
  ready: 'รอเริ่มงาน',
  active: 'กำลังดำเนินการ',
  paused: 'พักโครงการ',
  construction_complete: 'งานก่อสร้างเสร็จ',
  warranty: 'รับประกัน/เก็บงาน',
  closed: 'ปิดโครงการ',
}
const revisionLabels: Record<string, string> = {
  draft: 'ร่าง',
  review: 'รอตรวจ',
  sent: 'ส่งลูกค้าแล้ว',
  customer_revision: 'ลูกค้าขอแก้',
  approved: 'ฉบับสัญญา',
  rejected: 'ไม่อนุมัติ',
  cancelled: 'ยกเลิก',
}
const causeLabels: Record<string, string> = {
  planned: 'ตามแผน',
  variation: 'งานเพิ่ม–ลด',
  rework: 'แก้ไขงาน',
  waste: 'สูญเสีย',
  delay: 'ล่าช้า',
  warranty: 'รับประกัน',
  other: 'อื่น ๆ',
}
const employmentLabels: Record<string, string> = {
  daily: 'รายวัน',
  monthly: 'รายเดือน',
  temporary: 'ชั่วคราว',
  contractor: 'ผู้รับเหมา',
}

export function ProjectControlsPage() {
  usePageTitle('ควบคุมโครงการและต้นทุน')
  const navigate = useNavigate(),
    [searchParams, setSearchParams] = useSearchParams()
  const contextProjectId = searchParams.get('project_id') ?? ''
  const { profile, currentCompany } = useAuth(),
    canManage = profile?.role === 'admin' || profile?.role === 'manager'
  const [tab, setTab] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState('')
  const [projects, setProjects] = useState<Project[]>([]),
    [sites, setSites] = useState<Site[]>([]),
    [employees, setEmployees] = useState<Employee[]>([]),
    [allEmployees, setAllEmployees] = useState<Employee[]>([]),
    [resignedEmployees, setResignedEmployees] = useState<Employee[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([]),
    [allocations, setAllocations] = useState<Allocation[]>([]),
    [commercials, setCommercials] = useState<Commercial[]>([])
  const [revisions, setRevisions] = useState<Revision[]>([]),
    [costCodes, setCostCodes] = useState<CostCode[]>([]),
    [costs, setCosts] = useState<CostEntry[]>([])
  const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([])
  const [assignment, setAssignment] = useState({
    profileId: '',
    siteId: '',
    startsOn: today(),
    endsOn: '',
    note: '',
  })
  const [allocation, setAllocation] = useState({
    profileId: '',
    siteId: '',
    mode: 'percent',
    value: '',
    startsOn: today(),
    endsOn: '',
    note: '',
  })
  const [commercial, setCommercial] = useState({
    projectId: contextProjectId,
    salesStatus: 'lead',
    deliveryStatus: 'not_started',
    expectedValue: '',
    probability: '0',
    reason: '',
  })
  const [revision, setRevision] = useState({
    projectId: contextProjectId,
    title: '',
    status: 'draft',
    amount: '',
    vat: '7',
    reason: '',
  })
  const [cost, setCost] = useState({
    projectId: contextProjectId,
    siteId: '',
    costCodeId: '',
    date: today(),
    description: '',
    phase: '',
    area: '',
    cause: 'planned',
    budget: '',
    committed: '',
    actual: '',
    forecast: '',
    status: 'draft',
  })

  const projectName = (id: string) => projects.find((item) => item.project_id === id)?.name ?? '-'
  const siteName = (id: string) => {
    const item = sites.find((site) => site.id === id)
    return item ? `${item.projects?.name ?? ''} · ${item.name}` : '-'
  }
  const employeeName = (id: string) => {
    const item = allEmployees.find((employee) => employee.id === id)
    return item?.full_name || item?.email || '-'
  }
  const employeeInfo = (id: string) => allEmployees.find((employee) => employee.id === id)
  const projectRole = (profileId: string, siteId: string) => {
    const projectId = sites.find((site) => site.id === siteId)?.project_id
    return projectMembers.find((member) => member.profile_id === profileId && member.project_id === projectId)?.member_role ?? 'member'
  }
  const codeName = (id: string) => {
    const item = costCodes.find((code) => code.id === id)
    return item ? `${item.code} ${item.name_th}` : '-'
  }

  const load = useCallback(async () => {
    setError('')
    const results = await Promise.all([
      supabase.from('projects').select('project_id,name,code').order('name'),
      supabase.from('project_sites').select('id,project_id,name,projects(name)').order('name'),
      supabase.from('profiles').select('id,full_name,email').order('full_name'),
      supabase
        .from('employee_employment_records')
        .select('profile_id,employee_code,employment_type,job_title,department,employment_status,work_policy_id,monthly_salary')
        .eq('company_id', currentCompany?.company_id ?? ''),
      supabase.from('employee_site_assignments').select('profile_id,site_id,starts_on,ends_on,active,allocation_note').order('created_at', { ascending: false }),
      supabase.from('employee_site_cost_allocations').select('*').order('created_at', { ascending: false }),
      supabase.from('project_commercial_profiles').select('*'),
      supabase.from('project_price_revisions').select('*').order('revision_no', { ascending: false }),
      supabase.from('project_cost_codes').select('id,code,name_th').eq('active', true).order('sort_order'),
      supabase.from('project_cost_entries').select('*').order('cost_date', { ascending: false }),
      supabase.from('project_members').select('project_id,profile_id,member_role'),
      supabase
        .from('company_members')
        .select('profile_id,active')
        .eq('company_id', currentCompany?.company_id ?? ''),
    ])
    const firstError = results.find((result) => result.error)?.error
    if (firstError) {
      setError(userError(firstError))
      return
    }
    setProjects((results[0].data ?? []) as Project[])
    setSites((results[1].data ?? []) as unknown as Site[])
    const employmentMap = new Map((results[3].data ?? []).map((item) => [item.profile_id, item]))
    const fullEmployeeDirectory = ((results[2].data ?? []) as Employee[]).map((item) => {
      const employment = employmentMap.get(item.id)
      const membership = results[11].data?.find((row: { profile_id: string; active: boolean }) => row.profile_id === item.id)
      return {
        ...item,
        ...(employment ?? {}),
        membership_active: membership?.active ?? false,
      }
    }) as Employee[]
    const activeEmployees = fullEmployeeDirectory.filter(
      (employee) =>
        !isEmployeeResigned({
          employment_status: employee.employment_status ?? null,
          membership_active: employee.membership_active ?? false,
        }),
    )
    const resignedList = fullEmployeeDirectory.filter((employee) =>
      isEmployeeResigned({
        employment_status: employee.employment_status ?? null,
        membership_active: employee.membership_active ?? false,
      }),
    )
    setAllEmployees(fullEmployeeDirectory)
    setResignedEmployees(resignedList)
    setEmployees(activeEmployees)
    setAssignments((results[4].data ?? []) as Assignment[])
    setAllocations((results[5].data ?? []) as Allocation[])
    const commercialRows = (results[6].data ?? []) as Commercial[]
    setCommercials(commercialRows)
    setRevisions((results[7].data ?? []) as Revision[])
    const current = commercialRows.find((item) => item.project_id === contextProjectId)
    if (current)
      setCommercial({
        projectId: current.project_id,
        salesStatus: current.sales_status,
        deliveryStatus: current.delivery_status,
        expectedValue: String(current.expected_contract_value),
        probability: String(current.win_probability),
        reason: current.status_reason || '',
      })
    setCostCodes((results[8].data ?? []) as CostCode[])
    setCosts((results[9].data ?? []) as CostEntry[])
    setProjectMembers((results[10].data ?? []) as ProjectMember[])
  }, [contextProjectId, currentCompany?.company_id])
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])
  const selectContextProject = (projectId: string) => {
    setSearchParams(projectId ? { project_id: projectId } : {})
    const current = commercials.find((item) => item.project_id === projectId)
    setCommercial(
      current
        ? {
            projectId: current.project_id,
            salesStatus: current.sales_status,
            deliveryStatus: current.delivery_status,
            expectedValue: String(current.expected_contract_value),
            probability: String(current.win_probability),
            reason: current.status_reason || '',
          }
        : {
            projectId,
            salesStatus: 'lead',
            deliveryStatus: 'not_started',
            expectedValue: '',
            probability: '0',
            reason: '',
          },
    )
    setRevision((value) => ({ ...value, projectId }))
    setCost((value) => ({ ...value, projectId, siteId: '' }))
  }

  const run = async (action: () => Promise<{ error: unknown }>, message: string, recordInput: Record<string, unknown> = {}) => {
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      await runWithMutationAttempt({
        module: 'project-controls',
        action: message,
        actorProfileId: profile?.id,
        companyId: currentCompany?.company_id,
        request: { ...recordInput },
        operation: action,
      })
      setSuccess(message)
      await load()
    } catch (error) {
      setError(userError(error))
    } finally {
      setBusy(false)
    }
  }
  const saveAssignment = () =>
    run(
      async () =>
        supabase.from('employee_site_assignments').upsert(
          {
            profile_id: assignment.profileId,
            site_id: assignment.siteId,
            starts_on: assignment.startsOn,
            ends_on: assignment.endsOn || null,
            active: true,
            allocation_note: assignment.note || null,
            assigned_by: profile?.id,
          },
          { onConflict: 'profile_id,site_id' },
        ),
      'บันทึกการมอบหมายไซต์แล้ว',
    )
  const saveAllocation = () =>
    run(
      async () =>
        supabase.from('employee_site_cost_allocations').insert({
          profile_id: allocation.profileId,
          site_id: allocation.siteId,
          allocation_mode: allocation.mode,
          allocation_value: Number(allocation.value),
          starts_on: allocation.startsOn,
          ends_on: allocation.endsOn || null,
          note: allocation.note || null,
        }),
      'บันทึกการจัดสรรเงินเดือนแล้ว',
    )
  const saveCommercial = () =>
    run(
      async () =>
        supabase.from('project_commercial_profiles').upsert(
          {
            project_id: commercial.projectId,
            sales_status: commercial.salesStatus,
            delivery_status: commercial.deliveryStatus,
            expected_contract_value: Number(commercial.expectedValue || 0),
            win_probability: Number(commercial.probability || 0),
            status_reason: commercial.reason || null,
            updated_by: profile?.id,
          },
          { onConflict: 'project_id' },
        ),
      'บันทึกสถานะโครงการแล้ว',
    )
  const saveRevision = () => {
    const next = Math.max(-1, ...revisions.filter((item) => item.project_id === revision.projectId).map((item) => item.revision_no)) + 1
    const beforeVat = Number(revision.amount || 0),
      vat = (beforeVat * Number(revision.vat || 0)) / 100
    return run(
      async () =>
        supabase.from('project_price_revisions').insert({
          project_id: revision.projectId,
          revision_no: next,
          title: revision.title || `เสนอราคา Rev.${next}`,
          status: revision.status,
          amount_before_vat: beforeVat,
          vat_amount: vat,
          reason: revision.reason || null,
        }),
      'สร้าง Revision ราคาแล้ว',
    )
  }
  const saveCost = () =>
    run(
      async () =>
        supabase.from('project_cost_entries').insert({
          project_id: cost.projectId,
          site_id: cost.siteId || null,
          cost_code_id: cost.costCodeId,
          cost_date: cost.date,
          description: cost.description,
          phase: cost.phase || null,
          area: cost.area || null,
          cause: cost.cause,
          budget_amount: Number(cost.budget || 0),
          committed_amount: Number(cost.committed || 0),
          actual_amount: Number(cost.actual || 0),
          forecast_amount: Number(cost.forecast || 0),
          status: cost.status,
        }),
      'บันทึกต้นทุนโครงการแล้ว',
    )

  const allocationSummary = useMemo(
    () =>
      employees
        .filter((e) => e.employment_type === 'monthly')
        .map((employee) => {
          const rows = allocations.filter((a) => a.profile_id === employee.id && a.active),
            mode = rows[0]?.allocation_mode,
            total = rows.reduce((sum, row) => sum + Number(row.allocation_value), 0)
          return {
            id: employee.id,
            name: employee.full_name || employee.email || employee.id,
            mode,
            total,
            complete: mode === 'percent' ? total === 100 : total === Number(employee.monthly_salary || 0),
          }
        }),
    [allocations, employees],
  )
  const contextSiteIds = useMemo(() => new Set(sites.filter((site) => !contextProjectId || site.project_id === contextProjectId).map((site) => site.id)), [contextProjectId, sites])
  const visibleSites = useMemo(() => sites.filter((site) => !contextProjectId || site.project_id === contextProjectId), [contextProjectId, sites])
  const visibleAssignments = useMemo(() => assignments.filter((row) => !contextProjectId || contextSiteIds.has(row.site_id)), [assignments, contextProjectId, contextSiteIds])
  const visibleAllocations = useMemo(() => allocations.filter((row) => !contextProjectId || contextSiteIds.has(row.site_id)), [allocations, contextProjectId, contextSiteIds])
  const visibleRevisions = useMemo(() => revisions.filter((row) => !contextProjectId || row.project_id === contextProjectId), [contextProjectId, revisions])
  const visibleCosts = useMemo(() => costs.filter((row) => !contextProjectId || row.project_id === contextProjectId), [contextProjectId, costs])
  if (!canManage) return <Alert severity="error">เฉพาะผู้ดูแลระบบและผู้จัดการ</Alert>

  return (
    <Stack spacing={2.5}>
      <PageHeader title="งานขายและต้นทุนโครงการ" description="พนักงาน–ไซต์ · จัดสรรเงินเดือน · งานขายและ Revision · ค่าใช้จ่ายก่อนขาย · Cost Code โครงการ" />
      {error && <Alert severity="error">{error}</Alert>}
      {success && <Alert severity="success">{success}</Alert>}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'center' } }}>
          <TextField select size="small" label="โครงการปัจจุบัน" value={contextProjectId} onChange={(event) => selectContextProject(event.target.value)} sx={{ minWidth: 300 }}>
            <MenuItem value="">ทุกโครงการ</MenuItem>
            {projects.map((project) => (
              <MenuItem key={project.project_id} value={project.project_id}>
                {project.name}
              </MenuItem>
            ))}
          </TextField>
          {contextProjectId && (
            <>
              <Button onClick={() => navigate(`/boq?project_id=${contextProjectId}`)}>BOQ</Button>
              <Button onClick={() => navigate(`/drawing-ai?project_id=${contextProjectId}`)}>แบบ/Drawing</Button>
              <Button onClick={() => navigate(`/work-summary?project_id=${contextProjectId}`)}>งาน LINE</Button>
              <Button onClick={() => navigate(`/reports?project_id=${contextProjectId}`)}>รายงาน</Button>
            </>
          )}
        </Stack>
      </Paper>
      <Paper variant="outlined">
        <Tabs value={tab} onChange={(_e, value) => setTab(value)} variant="scrollable" scrollButtons="auto">
          <Tab label="พนักงาน–ไซต์" />
          <Tab label="จัดสรรเงินเดือน" />
          <Tab label="สถานะ/Revision" />
          <Tab label="ค่าใช้จ่ายก่อนขาย" />
          <Tab label="ต้นทุนโครงการ" />
        </Tabs>
      </Paper>

      {tab === 0 && (
        <>
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Stack
              direction="row"
              spacing={1}
              sx={{
                display: 'flex',
                alignItems: 'center',
                mb: 1,
                justifyContent: 'space-between',
              }}
            >
              <Typography variant="h6">มอบหมายพนักงานให้ไซต์</Typography>
              {resignedEmployees.length > 0 && <Chip color="default" label={`ซ่อนแล้ว: สถานะลาออก ${resignedEmployees.length} คน`} />}
            </Stack>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: 'repeat(3,1fr)' },
                gap: 1.5,
                mt: 2,
              }}
            >
              <TextField select label="พนักงาน" value={assignment.profileId} onChange={(e) => setAssignment({ ...assignment, profileId: e.target.value })}>
                {employees.map((item) => (
                  <MenuItem key={item.id} value={item.id}>
                    {employeeName(item.id)}
                  </MenuItem>
                ))}
              </TextField>
              <TextField select label="ไซต์" value={assignment.siteId} onChange={(e) => setAssignment({ ...assignment, siteId: e.target.value })}>
                {visibleSites.map((item) => (
                  <MenuItem key={item.id} value={item.id}>
                    {siteName(item.id)}
                  </MenuItem>
                ))}
              </TextField>
              <TextField label="หมายเหตุ" value={assignment.note} onChange={(e) => setAssignment({ ...assignment, note: e.target.value })} />
              <TextField type="date" label="เริ่ม" value={assignment.startsOn} onChange={(e) => setAssignment({ ...assignment, startsOn: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
              <TextField type="date" label="สิ้นสุด" value={assignment.endsOn} onChange={(e) => setAssignment({ ...assignment, endsOn: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
              <Button variant="contained" startIcon={<AddOutlinedIcon />} disabled={busy || !assignment.profileId || !assignment.siteId} onClick={() => void saveAssignment()}>
                มอบหมาย/อัปเดต
              </Button>
            </Box>
          </Paper>
          <StandardDataTable
            rows={visibleAssignments}
            getRowId={(row) => `${row.profile_id}-${row.site_id}`}
            getSearchText={(row) => `${employeeName(row.profile_id)} ${siteName(row.site_id)} ${row.active}`}
            searchLabel="ค้นหาพนักงาน โครงการ หรือไซต์"
            emptyText="ยังไม่มีการมอบหมายไซต์"
            exportFileName="employee-site-assignments"
            columns={[
              {
                id: 'code',
                label: 'รหัส',
                render: (r) => employeeInfo(r.profile_id)?.employee_code || '-',
                exportValue: (r) => employeeInfo(r.profile_id)?.employee_code,
              },
              {
                id: 'employee',
                label: 'พนักงาน',
                render: (r) => employeeName(r.profile_id),
                exportValue: (r) => employeeName(r.profile_id),
                linkTo: (r) => `/employees?employment=${r.profile_id}`,
              },
              {
                id: 'employment',
                label: 'ประเภทจ้าง',
                render: (r) => employmentLabels[employeeInfo(r.profile_id)?.employment_type || ''] || employeeInfo(r.profile_id)?.employment_type || 'ยังไม่กำหนด',
                exportValue: (r) => employmentLabels[employeeInfo(r.profile_id)?.employment_type || ''] || employeeInfo(r.profile_id)?.employment_type,
              },
              {
                id: 'position',
                label: 'ตำแหน่ง/ฝ่าย',
                render: (r) => `${employeeInfo(r.profile_id)?.job_title || '-'}${employeeInfo(r.profile_id)?.department ? ` · ${employeeInfo(r.profile_id)?.department}` : ''}`,
                exportValue: (r) => `${employeeInfo(r.profile_id)?.job_title || ''} ${employeeInfo(r.profile_id)?.department || ''}`,
              },
              {
                id: 'projectRole',
                label: 'สิทธิ์โครงการ',
                render: (r) => projectRole(r.profile_id, r.site_id),
                exportValue: (r) => projectRole(r.profile_id, r.site_id),
              },
              {
                id: 'readiness',
                label: 'ความพร้อม',
                render: (r) => (employeeInfo(r.profile_id)?.work_policy_id ? 'พร้อม' : 'ขาดตารางเวลา'),
                exportValue: (r) => (employeeInfo(r.profile_id)?.work_policy_id ? 'พร้อม' : 'ขาดตารางเวลา'),
              },
              {
                id: 'site',
                label: 'โครงการ/ไซต์',
                render: (r) => siteName(r.site_id),
                exportValue: (r) => siteName(r.site_id),
              },
              {
                id: 'period',
                label: 'ช่วงเวลา',
                render: (r) => `${r.starts_on} – ${r.ends_on || 'ไม่กำหนด'}`,
                exportValue: (r) => `${r.starts_on}-${r.ends_on || ''}`,
              },
              {
                id: 'status',
                label: 'สถานะ',
                render: (r) => <Chip size="small" color={r.active ? 'success' : 'default'} label={r.active ? 'ใช้งาน' : 'ปิด'} />,
                exportValue: (r) => (r.active ? 'active' : 'inactive'),
              },
              {
                id: 'action',
                label: 'จัดการ',
                render: (r) => (
                  <Stack direction="row" spacing={1}>
                    <Button
                      size="small"
                      onClick={() =>
                        setAssignment({
                          profileId: r.profile_id,
                          siteId: r.site_id,
                          startsOn: r.starts_on,
                          endsOn: r.ends_on || '',
                          note: r.allocation_note || '',
                        })
                      }
                    >
                      แก้ไข
                    </Button>
                    <Button size="small" color={r.active ? 'error' : 'success'} onClick={() => void run(async () => supabase.from('employee_site_assignments').update({ active: !r.active }).eq('profile_id', r.profile_id).eq('site_id', r.site_id), r.active ? 'ปิดการมอบหมายแล้ว' : 'เปิดการมอบหมายแล้ว')}>
                      {r.active ? 'ยกเลิก' : 'เปิดใช้'}
                    </Button>
                  </Stack>
                ),
              },
            ]}
          />
        </>
      )}

      {tab === 1 && (
        <>
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Stack
              direction="row"
              spacing={1}
              sx={{
                display: 'flex',
                alignItems: 'center',
                mb: 1,
                justifyContent: 'space-between',
              }}
            >
              <Typography variant="h6">จัดสรรค่าใช้จ่ายพนักงานเงินเดือน</Typography>
              {resignedEmployees.length > 0 && <Chip color="default" label={`พนักงานลาออกถูกซ่อน ${resignedEmployees.length} คน`} />}
            </Stack>
            <Alert severity="info" sx={{ mt: 1 }}>
              ช่วงเวลาเดียวกันเลือกใช้แบบเปอร์เซ็นต์หรือจำนวนเงินเพียงแบบเดียว เปอร์เซ็นต์รวมไม่เกิน 100% และจำนวนเงินรวมไม่เกินเงินเดือน
            </Alert>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: 'repeat(3,1fr)' },
                gap: 1.5,
                mt: 2,
              }}
            >
              <TextField select label="พนักงานรายเดือน" value={allocation.profileId} onChange={(e) => setAllocation({ ...allocation, profileId: e.target.value })}>
                {employees
                  .filter((item) => item.employment_type === 'monthly')
                  .map((item) => (
                    <MenuItem key={item.id} value={item.id}>
                      {employeeName(item.id)} · {money(item.monthly_salary || 0)}
                    </MenuItem>
                  ))}
              </TextField>
              <TextField select label="ไซต์" value={allocation.siteId} onChange={(e) => setAllocation({ ...allocation, siteId: e.target.value })}>
                {visibleSites.map((item) => (
                  <MenuItem key={item.id} value={item.id}>
                    {siteName(item.id)}
                  </MenuItem>
                ))}
              </TextField>
              <TextField select label="รูปแบบ" value={allocation.mode} onChange={(e) => setAllocation({ ...allocation, mode: e.target.value })}>
                <MenuItem value="percent">เปอร์เซ็นต์</MenuItem>
                <MenuItem value="fixed_amount">จำนวนเงิน/เดือน</MenuItem>
              </TextField>
              <TextField type="number" label={allocation.mode === 'percent' ? 'สัดส่วน %' : 'จำนวนเงิน'} value={allocation.value} onChange={(e) => setAllocation({ ...allocation, value: e.target.value })} />
              <TextField type="date" label="เริ่ม" value={allocation.startsOn} onChange={(e) => setAllocation({ ...allocation, startsOn: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
              <TextField type="date" label="สิ้นสุด" value={allocation.endsOn} onChange={(e) => setAllocation({ ...allocation, endsOn: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
              <TextField label="หมายเหตุ" value={allocation.note} onChange={(e) => setAllocation({ ...allocation, note: e.target.value })} />
              <Button variant="contained" disabled={busy || !allocation.profileId || !allocation.siteId || Number(allocation.value) <= 0} onClick={() => void saveAllocation()}>
                บันทึกการจัดสรร
              </Button>
            </Box>
          </Paper>
          <StandardDataTable
            rows={visibleAllocations}
            getRowId={(r) => r.id}
            getSearchText={(r) => `${employeeName(r.profile_id)} ${siteName(r.site_id)}`}
            searchLabel="ค้นหาพนักงานหรือไซต์"
            emptyText="ยังไม่มีการจัดสรรเงินเดือน"
            exportFileName="salary-site-allocation"
            toolbar={
              <Stack direction="row" spacing={1}>
                {allocationSummary.filter((r) => !r.complete).length > 0 && <Chip color="warning" label={`ยังจัดสรรไม่ครบ ${allocationSummary.filter((r) => !r.complete).length} คน`} />}
              </Stack>
            }
            columns={[
              {
                id: 'employee',
                label: 'พนักงาน',
                render: (r) => employeeName(r.profile_id),
                exportValue: (r) => employeeName(r.profile_id),
              },
              {
                id: 'site',
                label: 'ไซต์',
                render: (r) => siteName(r.site_id),
                exportValue: (r) => siteName(r.site_id),
              },
              {
                id: 'value',
                label: 'สัดส่วน/จำนวนเงิน',
                render: (r) => (r.allocation_mode === 'percent' ? `${r.allocation_value}%` : money(r.allocation_value)),
                exportValue: (r) => r.allocation_value,
              },
              {
                id: 'period',
                label: 'ช่วงเวลา',
                render: (r) => `${r.starts_on} – ${r.ends_on || 'ไม่กำหนด'}`,
              },
              {
                id: 'status',
                label: 'สถานะ',
                render: (r) => <Chip size="small" color={r.active ? 'success' : 'default'} label={r.active ? 'ใช้งาน' : 'ปิด'} />,
              },
              {
                id: 'action',
                label: 'จัดการ',
                render: (r) => (
                  <Button size="small" color={r.active ? 'error' : 'success'} onClick={() => void run(async () => supabase.from('employee_site_cost_allocations').update({ active: !r.active }).eq('id', r.id), r.active ? 'ปิดการจัดสรรแล้ว' : 'เปิดการจัดสรรแล้ว')}>
                    {r.active ? 'ปิด' : 'เปิด'}
                  </Button>
                ),
              },
            ]}
          />
        </>
      )}

      {tab === 2 && (
        <>
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Typography variant="h6">สถานะการขายและการดำเนินโครงการ</Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: 'repeat(3,1fr)' },
                gap: 1.5,
                mt: 2,
              }}
            >
              <TextField
                select
                label="โครงการ/โอกาสขาย"
                value={commercial.projectId}
                onChange={(e) => {
                  const current = commercials.find((item) => item.project_id === e.target.value)
                  setCommercial(
                    current
                      ? {
                          projectId: current.project_id,
                          salesStatus: current.sales_status,
                          deliveryStatus: current.delivery_status,
                          expectedValue: String(current.expected_contract_value),
                          probability: String(current.win_probability),
                          reason: current.status_reason || '',
                        }
                      : { ...commercial, projectId: e.target.value },
                  )
                }}
              >
                {projects.map((item) => (
                  <MenuItem key={item.project_id} value={item.project_id}>
                    {item.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField select label="สถานะการขาย" value={commercial.salesStatus} onChange={(e) => setCommercial({ ...commercial, salesStatus: e.target.value })}>
                {Object.entries(salesLabels).map(([key, label]) => (
                  <MenuItem key={key} value={key}>
                    {label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="สถานะดำเนินโครงการ"
                value={commercial.deliveryStatus}
                onChange={(e) =>
                  setCommercial({
                    ...commercial,
                    deliveryStatus: e.target.value,
                  })
                }
              >
                {Object.entries(deliveryLabels).map(([key, label]) => (
                  <MenuItem key={key} value={key}>
                    {label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                type="number"
                label="มูลค่าคาดการณ์"
                value={commercial.expectedValue}
                onChange={(e) =>
                  setCommercial({
                    ...commercial,
                    expectedValue: e.target.value,
                  })
                }
              />
              <TextField type="number" label="โอกาสชนะ %" value={commercial.probability} onChange={(e) => setCommercial({ ...commercial, probability: e.target.value })} />
              <TextField label="เหตุผล/หมายเหตุสถานะ" value={commercial.reason} onChange={(e) => setCommercial({ ...commercial, reason: e.target.value })} />
              <Button variant="contained" disabled={busy || !commercial.projectId} onClick={() => void saveCommercial()}>
                บันทึกสถานะ
              </Button>
            </Box>
          </Paper>
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Typography variant="h6">สร้าง Revision ราคา</Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: 'repeat(3,1fr)' },
                gap: 1.5,
                mt: 2,
              }}
            >
              <TextField select label="โครงการ" value={revision.projectId} onChange={(e) => setRevision({ ...revision, projectId: e.target.value })}>
                {projects.map((item) => (
                  <MenuItem key={item.project_id} value={item.project_id}>
                    {item.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField label="ชื่อ Revision" value={revision.title} onChange={(e) => setRevision({ ...revision, title: e.target.value })} />
              <TextField select label="สถานะ" value={revision.status} onChange={(e) => setRevision({ ...revision, status: e.target.value })}>
                {Object.entries(revisionLabels).map(([key, label]) => (
                  <MenuItem key={key} value={key}>
                    {label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField type="number" label="ราคาก่อน VAT" value={revision.amount} onChange={(e) => setRevision({ ...revision, amount: e.target.value })} />
              <TextField type="number" label="VAT %" value={revision.vat} onChange={(e) => setRevision({ ...revision, vat: e.target.value })} />
              <TextField label="เหตุผลที่แก้ราคา" value={revision.reason} onChange={(e) => setRevision({ ...revision, reason: e.target.value })} />
              <Button variant="contained" disabled={busy || !revision.projectId || Number(revision.amount) < 0} onClick={() => void saveRevision()}>
                สร้าง Revision ถัดไป
              </Button>
            </Box>
          </Paper>
          <StandardDataTable
            rows={visibleRevisions}
            getRowId={(r) => r.id}
            getSearchText={(r) => `${projectName(r.project_id)} ${r.title} ${revisionLabels[r.status]}`}
            searchLabel="ค้นหาโครงการ Revision หรือสถานะ"
            emptyText="ยังไม่มี Revision ราคา"
            exportFileName="project-price-revisions"
            columns={[
              {
                id: 'project',
                label: 'โครงการ',
                render: (r) => projectName(r.project_id),
                exportValue: (r) => projectName(r.project_id),
              },
              {
                id: 'revision',
                label: 'Revision',
                render: (r) => `Rev.${r.revision_no} · ${r.title}`,
                exportValue: (r) => r.revision_no,
              },
              {
                id: 'amount',
                label: 'ยอดรวม',
                align: 'right',
                render: (r) => money(r.total_amount),
                exportValue: (r) => r.total_amount,
              },
              {
                id: 'status',
                label: 'สถานะ',
                render: (r) => <Chip size="small" color={r.status === 'approved' ? 'success' : r.status === 'customer_revision' ? 'warning' : 'default'} label={revisionLabels[r.status] || r.status} />,
              },
              {
                id: 'locked',
                label: 'ล็อก',
                render: (r) => (r.locked_at ? 'ฉบับสัญญา' : 'แก้ไขได้'),
              },
              { id: 'reason', label: 'เหตุผล', render: (r) => r.reason || '-' },
            ]}
          />
        </>
      )}

      {tab === 3 && <SalesExpensePanel projects={projects} contextProjectId={contextProjectId} />}

      {tab === 4 && (
        <>
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Typography variant="h6">บันทึก Budget, Committed, Actual และ Forecast</Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: 'repeat(3,1fr)' },
                gap: 1.5,
                mt: 2,
              }}
            >
              <TextField select label="โครงการ" value={cost.projectId} onChange={(e) => setCost({ ...cost, projectId: e.target.value, siteId: '' })}>
                {projects.map((item) => (
                  <MenuItem key={item.project_id} value={item.project_id}>
                    {item.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField select label="ไซต์" value={cost.siteId} onChange={(e) => setCost({ ...cost, siteId: e.target.value })}>
                <MenuItem value="">ไม่ระบุ/ส่วนกลาง</MenuItem>
                {sites
                  .filter((item) => !cost.projectId || item.project_id === cost.projectId)
                  .map((item) => (
                    <MenuItem key={item.id} value={item.id}>
                      {siteName(item.id)}
                    </MenuItem>
                  ))}
              </TextField>
              <TextField select label="Cost Code" value={cost.costCodeId} onChange={(e) => setCost({ ...cost, costCodeId: e.target.value })}>
                {costCodes.map((item) => (
                  <MenuItem key={item.id} value={item.id}>
                    {item.code} · {item.name_th}
                  </MenuItem>
                ))}
              </TextField>
              <TextField type="date" label="วันที่" value={cost.date} onChange={(e) => setCost({ ...cost, date: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
              <TextField label="รายละเอียด" value={cost.description} onChange={(e) => setCost({ ...cost, description: e.target.value })} />
              <TextField select label="สาเหตุ" value={cost.cause} onChange={(e) => setCost({ ...cost, cause: e.target.value })}>
                {Object.entries(causeLabels).map(([key, label]) => (
                  <MenuItem key={key} value={key}>
                    {label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField label="ช่วงงาน" value={cost.phase} onChange={(e) => setCost({ ...cost, phase: e.target.value })} />
              <TextField label="พื้นที่" value={cost.area} onChange={(e) => setCost({ ...cost, area: e.target.value })} />
              <TextField type="number" label="Budget" value={cost.budget} onChange={(e) => setCost({ ...cost, budget: e.target.value })} />
              <TextField type="number" label="Committed" value={cost.committed} onChange={(e) => setCost({ ...cost, committed: e.target.value })} />
              <TextField type="number" label="Actual" value={cost.actual} onChange={(e) => setCost({ ...cost, actual: e.target.value })} />
              <TextField type="number" label="Forecast" value={cost.forecast} onChange={(e) => setCost({ ...cost, forecast: e.target.value })} />
              <Button variant="contained" disabled={busy || !cost.projectId || !cost.costCodeId || !cost.description.trim()} onClick={() => void saveCost()}>
                บันทึกต้นทุน
              </Button>
            </Box>
          </Paper>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'repeat(2,1fr)', md: 'repeat(4,1fr)' },
              gap: 1.5,
            }}
          >
            {[
              ['Budget', visibleCosts.reduce((s, r) => s + Number(r.budget_amount), 0)],
              ['Committed', visibleCosts.reduce((s, r) => s + Number(r.committed_amount), 0)],
              ['Actual', visibleCosts.reduce((s, r) => s + Number(r.actual_amount), 0)],
              ['Forecast', visibleCosts.reduce((s, r) => s + Number(r.forecast_amount), 0)],
            ].map(([label, value]) => (
              <Paper key={String(label)} variant="outlined" sx={{ p: 2 }}>
                <Typography color="text.secondary">{label}</Typography>
                <Typography variant="h5" sx={{ fontWeight: 800 }}>
                  {money(Number(value))}
                </Typography>
              </Paper>
            ))}
          </Box>
          <StandardDataTable
            rows={visibleCosts}
            getRowId={(r) => r.id}
            getSearchText={(r) => `${projectName(r.project_id)} ${siteName(r.site_id || '')} ${codeName(r.cost_code_id)} ${r.description} ${r.cause}`}
            searchLabel="ค้นหาโครงการ ไซต์ Cost Code หรือสาเหตุ"
            emptyText="ยังไม่มีรายการต้นทุน"
            exportFileName="project-cost-control"
            columns={[
              {
                id: 'project',
                label: 'โครงการ/ไซต์',
                render: (r) => (
                  <>
                    {projectName(r.project_id)}
                    <Typography variant="caption" sx={{ display: 'block' }}>
                      {r.site_id ? siteName(r.site_id) : 'ส่วนกลาง'}
                    </Typography>
                  </>
                ),
                exportValue: (r) => `${projectName(r.project_id)} ${r.site_id ? siteName(r.site_id) : ''}`,
              },
              {
                id: 'code',
                label: 'Cost Code',
                render: (r) => codeName(r.cost_code_id),
                exportValue: (r) => codeName(r.cost_code_id),
              },
              {
                id: 'description',
                label: 'รายการ',
                render: (r) => r.description,
              },
              {
                id: 'dimension',
                label: 'ช่วงงาน/พื้นที่',
                render: (r) => `${r.phase || '-'} / ${r.area || '-'}`,
              },
              {
                id: 'cause',
                label: 'สาเหตุ',
                render: (r) => causeLabels[r.cause] || r.cause,
              },
              {
                id: 'budget',
                label: 'Budget',
                align: 'right',
                render: (r) => money(r.budget_amount),
                exportValue: (r) => r.budget_amount,
              },
              {
                id: 'committed',
                label: 'Committed',
                align: 'right',
                render: (r) => money(r.committed_amount),
                exportValue: (r) => r.committed_amount,
              },
              {
                id: 'actual',
                label: 'Actual',
                align: 'right',
                render: (r) => money(r.actual_amount),
                exportValue: (r) => r.actual_amount,
              },
              {
                id: 'forecast',
                label: 'Forecast',
                align: 'right',
                render: (r) => money(r.forecast_amount),
                exportValue: (r) => r.forecast_amount,
              },
            ]}
          />
        </>
      )}
    </Stack>
  )
}
