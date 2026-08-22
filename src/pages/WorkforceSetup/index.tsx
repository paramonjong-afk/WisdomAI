import { Accordion, AccordionDetails, AccordionSummary, Alert, Button, Chip, CircularProgress, FormControlLabel, MenuItem, Paper, Stack, Switch, Tab, Tabs, TextField, Typography } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { useCallback, useEffect, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
import { userError } from '../../utils/userError'
import { runWithMutationAttempt } from '../../utils/mutationAttemptRunner'
import { isEmployeeResigned } from '../../utils/employeeLifecycle'

type Policy = {
  id:string; name:string; work_start_time:string; work_end_time:string
  break_start_time:string; break_end_time:string; grace_minutes:number
  standard_minutes:number; overtime_round_minutes:number; active:boolean
}
type Site = { id:string; name:string; work_policy_id:string|null; projects:{name:string}|null }
type Employment = {
  profile_id:string; work_policy_id:string|null; employment_status:string|null
  profiles:{full_name:string|null;email:string|null}|null
}
type SiteAssignment = {
  id:string;profile_id:string;site_id:string;starts_on:string;ends_on:string|null
  active:boolean;is_primary:boolean;work_policy_id:string|null;status?:'active'|'ended'|'void';change_reason?:string|null
}
type PaySettings = {
  first_period_end_day:number;first_pay_day:number;second_pay_day:number
  second_pay_month_offset:number;holiday_adjustment:'previous_workday'|'next_workday'|'none'
}
type RuleSettings = {
  daily_pay_mode:'day_tiers'|'prorated_minutes';full_day_minutes:number;half_day_minutes:number
  below_half_day_daily_factor:number;monthly_partial_day_deduction_factor:number
  monthly_below_half_day_deduction_factor:number;monthly_salary_divisor:number
  first_period_salary_ratio:number;attendance_day_cutoff:string;clock_out_reminder_minutes:number
  stale_after_shift_minutes:number;overtime_reminder_minutes:number;morning_summary_time:string
  line_group_id:string|null;enabled:boolean
  work_time_primary_unit:'days'|'hours';work_time_day_decimals:number
  work_time_show_secondary_hours:boolean
}
type Period = {id:string;name:string;starts_on:string;ends_on:string;pay_date:string;status:string}
type Readiness={company_id:string;profile_id:string;full_name:string|null;email:string|null;employee_code:string|null;employment_status:string|null;has_name:boolean;has_employment:boolean;has_pay_rate:boolean;has_ot_rate:boolean;has_work_policy:boolean;has_site:boolean;ready_to_clock:boolean}

const defaultPolicy = {
  name:'',work_start_time:'08:00',work_end_time:'17:00',
  break_start_time:'12:00',break_end_time:'13:00',grace_minutes:'5',
  standard_minutes:'480',overtime_round_minutes:'15',
}

export function WorkforceSetupPage() {
  usePageTitle('ตั้งค่าเวลางานและรอบจ่าย')
  const { profile,user,currentCompany }=useAuth()
  const canManage=profile?.role==='admin'||profile?.role==='manager'
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [tab,setTab]=useState(0)
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')
  const [policies,setPolicies]=useState<Policy[]>([])
  const [sites,setSites]=useState<Site[]>([])
  const [employments,setEmployments]=useState<Employment[]>([])
  const [siteAssignments,setSiteAssignments]=useState<SiteAssignment[]>([])
  const [periods,setPeriods]=useState<Period[]>([])
  const [readiness,setReadiness]=useState<Readiness[]>([])
  const [policyForm,setPolicyForm]=useState(defaultPolicy)
  const [siteAssignment,setSiteAssignment]=useState({siteId:'',policyId:''})
  const [employeeAssignment,setEmployeeAssignment]=useState({
    profileId:'',siteId:'',policyId:'',startsOn:new Date().toISOString().slice(0,10),endsOn:'',isPrimary:true,
  })
  const [editingAssignmentId,setEditingAssignmentId]=useState<string|null>(null)
  const [assignmentReason,setAssignmentReason]=useState('')
  const [cycleMonth,setCycleMonth]=useState(new Date().toISOString().slice(0,7))
  const [paySettings,setPaySettings]=useState<PaySettings>({
    first_period_end_day:15,first_pay_day:20,second_pay_day:5,
    second_pay_month_offset:1,holiday_adjustment:'previous_workday',
  })
  const [ruleSettings,setRuleSettings]=useState<RuleSettings>({
    daily_pay_mode:'day_tiers',full_day_minutes:480,half_day_minutes:240,
    below_half_day_daily_factor:0,monthly_partial_day_deduction_factor:0.5,
    monthly_below_half_day_deduction_factor:1,monthly_salary_divisor:30,
    first_period_salary_ratio:0.5,attendance_day_cutoff:'00:00',clock_out_reminder_minutes:180,
    stale_after_shift_minutes:420,overtime_reminder_minutes:60,morning_summary_time:'07:00',
    line_group_id:null,enabled:true,
    work_time_primary_unit:'days',work_time_day_decimals:2,work_time_show_secondary_hours:true,
  })

  const load=useCallback(async()=>{
    if(!canManage)return
    setLoading(true);setError('')
    const [p,s,e,c,r,q,w,a,m]=await Promise.all([
      supabase.from('work_policies').select('id,name,work_start_time,work_end_time,break_start_time,break_end_time,grace_minutes,standard_minutes,overtime_round_minutes,active').order('name'),
      supabase.from('project_sites').select('id,name,work_policy_id,projects(name)').eq('active',true).order('name'),
      supabase.from('employee_employment_records').select('profile_id,employment_status,work_policy_id,profiles!employee_employment_records_profile_id_fkey(full_name,email)').eq('company_id',currentCompany?.company_id??'').order('employee_code'),
      supabase.from('pay_cycle_settings').select('first_period_end_day,first_pay_day,second_pay_day,second_pay_month_offset,holiday_adjustment').eq('company_id',currentCompany?.company_id??'').eq('singleton',true).single(),
      supabase.from('pay_periods').select('id,name,starts_on,ends_on,pay_date,status').order('starts_on',{ascending:false}).limit(12),
      supabase.from('employee_onboarding_readiness').select('*').eq('company_id',currentCompany?.company_id??'').order('full_name'),
      supabase.from('workforce_rule_settings').select('*').eq('company_id',currentCompany?.company_id??'').eq('singleton',true).single(),
      supabase.from('employee_site_assignments').select('id,profile_id,site_id,starts_on,ends_on,active,is_primary,work_policy_id,status,change_reason').eq('company_id',currentCompany?.company_id??'').order('starts_on',{ascending:false}),
      supabase.from('company_members').select('profile_id,active').eq('company_id', currentCompany?.company_id ?? '').eq('active', true),
    ])
    const first=[p,s,e,c,r,q,w,a,m].find((item)=>item.error)?.error
    if(first)setError(userError(first))
    setPolicies((p.data??[]) as Policy[])
    setSites((s.data??[]) as unknown as Site[])
    const activeMemberSet = new Set((m.data ?? []).map((row: { profile_id: string; active: boolean }) => row.profile_id))
    const normalizedEmployments = ((e.data ?? []) as unknown as Array<{
      profile_id: string
      work_policy_id: string | null
      employment_status: string | null
      profiles: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null
    }>).map((employment) => ({
      profile_id: employment.profile_id,
      work_policy_id: employment.work_policy_id,
      employment_status: employment.employment_status,
      profiles: Array.isArray(employment.profiles) ? employment.profiles[0] ?? null : employment.profiles,
    } satisfies Employment))
    setEmployments(normalizedEmployments.filter((employment) => !isEmployeeResigned({
      membership_active: activeMemberSet.has(employment.profile_id),
      employment_status: employment.employment_status ?? null,
    })))
    if(c.data)setPaySettings(c.data as PaySettings)
    setPeriods((r.data??[]) as Period[])
    setReadiness((q.data??[]) as Readiness[])
    if(w.data)setRuleSettings(w.data as RuleSettings)
    setSiteAssignments((a.data??[]) as SiteAssignment[])
    setLoading(false)
  },[canManage,currentCompany?.company_id])
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load])

  const run=async(
    operation:()=>PromiseLike<{error:{message:string}|null}>,
    success:string,
    request: Record<string, unknown> = {},
  )=>{
    setBusy(true)
    setMessage('')
    setError('')
    try {
      await runWithMutationAttempt({
        module: 'workforce-setup',
        action: success,
        actorProfileId: user?.id,
        companyId: currentCompany?.company_id,
        request,
        operation,
      })
      setMessage(success)
      await load()
    } catch (error) {
      setError(userError(error))
    } finally {
      setBusy(false)
    }
  }
  const createPolicy=()=>run(()=>supabase.from('work_policies').insert({
    name:policyForm.name.trim(),work_start_time:policyForm.work_start_time,
    work_end_time:policyForm.work_end_time,break_start_time:policyForm.break_start_time,
    break_end_time:policyForm.break_end_time,grace_minutes:Number(policyForm.grace_minutes),
    standard_minutes:Number(policyForm.standard_minutes),
    overtime_round_minutes:Number(policyForm.overtime_round_minutes),
  }),'สร้างตารางเวลาทำงานแล้ว')
  const savePaySettings=()=>run(()=>supabase.from('pay_cycle_settings').update({
    ...paySettings,updated_by:user?.id,updated_at:new Date().toISOString(),
  }).eq('company_id',currentCompany?.company_id??'').eq('singleton',true),'บันทึกรอบจ่ายแล้ว')
  const generateCycles=async()=>{
    const [year,month]=cycleMonth.split('-').map(Number)
    await run(()=>supabase.rpc('ensure_semimonthly_pay_periods',{target_year:year,target_month:month}),'สร้างรอบ 1–15 และ 16–สิ้นเดือนแล้ว')
  }
  const saveRuleSettings=()=>run(()=>supabase.from('workforce_rule_settings').update({
    ...ruleSettings,updated_by:user?.id,updated_at:new Date().toISOString(),
  }).eq('company_id',currentCompany?.company_id??'').eq('singleton',true),'บันทึกกติกาเวลาและค่าจ้างแล้ว')
  const normalizedEmployeeName=(value:string|null)=>value?.trim().replace(/\s+/g,' ').toLocaleLowerCase('th-TH')??''
  const duplicateNameCounts=readiness.reduce<Record<string,number>>((counts,row)=>{
    const name=normalizedEmployeeName(row.full_name)
    if(name)counts[name]=(counts[name]??0)+1
    return counts
  },{})
  const duplicateCount=(row:Readiness)=>duplicateNameCounts[normalizedEmployeeName(row.full_name)]??0
  const employeeLabel=(profileId:string)=>{
    const employment=employments.find((item)=>item.profile_id===profileId)
    return employment?.profiles?.full_name||employment?.profiles?.email||profileId.slice(0,8)
  }
  const siteLabel=(siteId:string)=>{
    const site=sites.find((item)=>item.id===siteId)
    return site?`${site.projects?.name?`${site.projects.name} · `:''}${site.name}`:siteId.slice(0,8)
  }
  const policyLabel=(policyId:string|null)=>policyId?policies.find((item)=>item.id===policyId)?.name||'ตารางเฉพาะ':'ตามลำดับอัตโนมัติ'
  const today=new Date().toISOString().slice(0,10)
  const assignmentStatus=(row:SiteAssignment)=>row.status==='void'?'ยกเลิกรายการ':!row.active||row.status==='ended'?'สิ้นสุดแล้ว':row.starts_on>today?'รอเริ่ม':row.ends_on&&row.ends_on<today?'สิ้นสุดแล้ว':'ใช้งานอยู่'
  const resetAssignmentForm=()=>{
    setEditingAssignmentId(null);setAssignmentReason('')
    setEmployeeAssignment({profileId:'',siteId:'',policyId:'',startsOn:today,endsOn:'',isPrimary:true})
  }
  const saveEmployeeSiteAssignment=async()=>{
    if(editingAssignmentId){
      await run(()=>supabase.rpc('manage_employee_site_assignment',{
        target_assignment_id:editingAssignmentId,target_action:'update',target_reason:assignmentReason.trim(),
        target_site_id:employeeAssignment.siteId,target_starts_on:employeeAssignment.startsOn,
        target_ends_on:employeeAssignment.endsOn||null,target_work_policy_id:employeeAssignment.policyId||null,
        target_is_primary:employeeAssignment.isPrimary,
      }),'แก้ไขการมอบหมายและบันทึก Audit แล้ว')
      resetAssignmentForm();return
    }
    await run(()=>supabase.rpc('assign_employee_site',{
      target_profile_id:employeeAssignment.profileId,target_site_id:employeeAssignment.siteId,
      target_starts_on:employeeAssignment.startsOn,target_ends_on:employeeAssignment.endsOn||null,
      target_work_policy_id:employeeAssignment.policyId||null,target_is_primary:employeeAssignment.isPrimary,
    }),'บันทึกการมอบหมายไซต์และช่วงเวลาแล้ว')
    resetAssignmentForm()
  }
  const manageAssignment=(row:SiteAssignment,action:'end'|'void')=>{
    const reason=window.prompt(action==='void'?'ระบุเหตุผลที่ยกเลิกรายการผิด':'ระบุเหตุผลที่สิ้นสุดการมอบหมาย')?.trim()
    if(!reason)return
    const endDate=action==='end'?window.prompt('วันทำงานวันสุดท้าย (YYYY-MM-DD)',today)?.trim():null
    if(action==='end'&&!endDate)return
    void run(()=>supabase.rpc('manage_employee_site_assignment',{
      target_assignment_id:row.id,target_action:action,target_reason:reason,
      target_site_id:null,target_starts_on:null,target_ends_on:endDate||null,target_work_policy_id:null,target_is_primary:null,
    }),action==='void'?'ยกเลิกรายการผิดแล้ว โดยยังเก็บ Audit':'สิ้นสุดการมอบหมายแล้ว')
  }
  const prepareMove=(row:SiteAssignment)=>{
    setEmployeeAssignment({...employeeAssignment,profileId:row.profile_id,siteId:'',policyId:'',startsOn:today,endsOn:'',isPrimary:true})
    window.scrollTo({top:0,behavior:'smooth'})
    setMessage(`เตรียมย้าย ${employeeLabel(row.profile_id)}: เลือกไซต์ใหม่และวันเริ่ม ระบบจะสิ้นสุดไซต์หลักเดิมก่อนหน้า 1 วัน`)
  }
  const prepareEdit=(row:SiteAssignment)=>{
    setEditingAssignmentId(row.id);setAssignmentReason('')
    setEmployeeAssignment({profileId:row.profile_id,siteId:row.site_id,policyId:row.work_policy_id||'',startsOn:row.starts_on,endsOn:row.ends_on||'',isPrimary:row.is_primary})
    window.scrollTo({top:0,behavior:'smooth'})
    setMessage(`กำลังแก้ไขการมอบหมายของ ${employeeLabel(row.profile_id)} กรุณาแก้ข้อมูลและระบุเหตุผล`)
  }
  const handleAssignmentAction=(row:SiteAssignment,action:string)=>{
    if(action==='edit')prepareEdit(row)
    else if(action==='move')prepareMove(row)
    else if(action==='end')manageAssignment(row,'end')
    else if(action==='void')manageAssignment(row,'void')
  }
  if(!canManage)return <Alert severity="error">เฉพาะผู้จัดการและผู้ดูแลระบบ</Alert>
  if(loading)return <Stack sx={{alignItems:'center',py:8}}><CircularProgress/></Stack>

  return <Stack spacing={3}>
    <PageHeader title="ตั้งค่าเวลางานและรอบจ่าย" description="กำหนดตารางให้รายคน/รายไซต์ และสร้างรอบค่าจ้างรายปักษ์" />
    {message&&<Alert severity="success">{message}</Alert>}{error&&<Alert severity="error">{error}</Alert>}
    <Paper variant="outlined" sx={{position:'sticky',top:64,zIndex:5}}>
      <Tabs value={tab} onChange={(_event,value)=>setTab(value)} variant="scrollable" scrollButtons="auto">
        <Tab label="ความพร้อมพนักงาน"/><Tab label="ตารางเวลาทำงาน"/>
        <Tab label="มอบหมายตารางและไซต์"/><Tab label="รอบจ่ายค่าจ้าง"/>
        <Tab label="กติกาเวลาและค่าจ้าง"/>
      </Tabs>
    </Paper>
    {tab===0&&<Paper variant="outlined" sx={{p:{xs:2,md:2.5}}}>
      <Typography variant="h6">ความพร้อมพนักงานก่อนลงเวลา</Typography>
      <Typography color="text.secondary" sx={{mb:2}}>ตรวจข้อมูลที่ต้องมีก่อนลงเวลา โดยข้อมูลการจ้างงานและค่าจ้างแก้ไขจากหน้าพนักงานเพียงจุดเดียว</Typography>
      <StandardDataTable rows={readiness} getRowId={(row)=>row.profile_id} getSearchText={(row)=>`${row.full_name} ${row.email}`}
        searchLabel="ค้นหาพนักงาน" emptyText="ไม่มีพนักงาน" columns={[
          {id:'employee',label:'พนักงาน',render:(row)=><Stack spacing={.25}>
            <Stack direction="row" spacing={.75} sx={{alignItems:'center',flexWrap:'wrap'}}><Typography variant="body2" sx={{fontWeight:700}}>{row.full_name||row.email||'-'}</Typography>{duplicateCount(row)>1&&<Chip size="small" color="warning" label={`ชื่อซ้ำ ${duplicateCount(row)} ระเบียน`}/>}</Stack>
            <Typography variant="caption" color="text.secondary">{row.employee_code||'ยังไม่มีรหัสพนักงาน'} · {row.email||'ไม่มีอีเมล'} · Profile {row.profile_id.slice(0,8)}</Typography>
          </Stack>},
          {id:'name',label:'ชื่อ',render:(row)=><Chip size="small" color={row.has_name?'success':'warning'} label={row.has_name?'ครบ':'ขาด'}/>},
          {id:'employment',label:'จ้างงาน',render:(row)=><Chip size="small" color={row.has_employment?'success':'warning'} label={row.has_employment?'ครบ':'ขาด'}/>},
          {id:'pay',label:'ค่าจ้าง',render:(row)=><Chip size="small" color={row.has_pay_rate?'success':'warning'} label={row.has_pay_rate?'ครบ':'ขาด'}/>},
          {id:'schedule',label:'ตาราง',render:(row)=><Chip size="small" color={row.has_work_policy?'success':'warning'} label={row.has_work_policy?'ครบ':'ขาด'}/>},
          {id:'site',label:'ไซต์',render:(row)=><Chip size="small" color={row.has_site?'success':'warning'} label={row.has_site?'ครบ':'ขาด'}/>},
          {id:'ready',label:'สถานะ',render:(row)=><Stack spacing={.5}><Chip size="small" color={row.ready_to_clock?'success':'error'} label={row.ready_to_clock?'พร้อมลงเวลา':'ข้อมูลไม่ครบ'}/>{duplicateCount(row)>1&&!row.ready_to_clock&&<Typography variant="caption" color="warning.main">อาจเป็น Profile เก่าหรือข้อมูลซ้ำ</Typography>}</Stack>},
          {id:'action',label:'ดำเนินการ',render:(row)=>row.ready_to_clock?'-':
            (!row.has_name||!row.has_employment||!row.has_pay_rate)
              ? <Button size="small" component="a" href={`/employees?employment=${row.profile_id}`}>{duplicateCount(row)>1?'ตรวจข้อมูลซ้ำ':'แก้ข้อมูลพนักงาน'}</Button>
              : !row.has_work_policy
                ? <Button size="small" onClick={()=>setTab(2)}>กำหนดตาราง</Button>
                : <Button size="small" component="a" href="/time-tracking">มอบหมายไซต์</Button>},
        ]}/>
    </Paper>}
    {tab===1&&<>
    <Paper variant="outlined" sx={{p:{xs:2,md:2.5}}}>
      <Typography variant="h6">สร้างตารางเวลาทำงาน</Typography>
      <Stack spacing={2} sx={{mt:2}}>
        <TextField label="ชื่อตาราง" value={policyForm.name} onChange={(e)=>setPolicyForm({...policyForm,name:e.target.value})}/>
        <Stack direction={{xs:'column',md:'row'}} spacing={2}>
          {[
            ['เวลาเข้า','work_start_time'],['เวลาออก','work_end_time'],
            ['เริ่มพัก','break_start_time'],['สิ้นสุดพัก','break_end_time'],
          ].map(([label,key])=><TextField key={key} fullWidth type="time" label={label}
            value={policyForm[key as keyof typeof policyForm]}
            onChange={(e)=>setPolicyForm({...policyForm,[key]:e.target.value})}
            slotProps={{inputLabel:{shrink:true}}}/>)}
        </Stack>
        <Stack direction={{xs:'column',md:'row'}} spacing={2}>
          <TextField fullWidth type="number" label="ผ่อนผันสาย (นาที)" value={policyForm.grace_minutes}
            onChange={(e)=>setPolicyForm({...policyForm,grace_minutes:e.target.value})}/>
          <TextField fullWidth type="number" label="เวลาปกติ/วัน (นาที)" value={policyForm.standard_minutes}
            onChange={(e)=>setPolicyForm({...policyForm,standard_minutes:e.target.value})}/>
          <TextField fullWidth select label="ปัด OT ทุก" value={policyForm.overtime_round_minutes}
            onChange={(e)=>setPolicyForm({...policyForm,overtime_round_minutes:e.target.value})}>
            {[5,10,15,30,60].map((v)=><MenuItem key={v} value={String(v)}>{v} นาที</MenuItem>)}
          </TextField>
        </Stack>
        <Stack direction="row" sx={{justifyContent:'flex-end'}}><Button variant="contained" disabled={busy||policyForm.name.trim().length<3} onClick={()=>void createPolicy()}>สร้างตารางเวลา</Button></Stack>
      </Stack>
    </Paper>
    <StandardDataTable rows={policies} getRowId={(row)=>row.id} getSearchText={(row)=>row.name}
      searchLabel="ค้นหาตารางเวลา" emptyText="ไม่มีตารางเวลา" columns={[
        {id:'name',label:'ตาราง',render:(row)=>row.name},
        {id:'work',label:'เวลางาน',render:(row)=>`${row.work_start_time.slice(0,5)}–${row.work_end_time.slice(0,5)}`},
        {id:'break',label:'พัก',render:(row)=>`${row.break_start_time.slice(0,5)}–${row.break_end_time.slice(0,5)}`},
        {id:'rules',label:'กติกา',render:(row)=>`สาย +${row.grace_minutes} นาที · OT ${row.overtime_round_minutes} นาที`},
      ]}/>
    </>}
    {tab===2&&<Paper variant="outlined" sx={{p:{xs:1.5,md:2}}}>
      <Typography variant="h6">มอบหมายไซต์และตารางทำงาน</Typography>
      <Typography variant="body2" color="text.secondary">จัดการไซต์หลัก/เสริม ช่วงวันที่ และตารางเฉพาะ พร้อมเก็บประวัติ</Typography>
      <Accordion disableGutters elevation={0} sx={{mt:1,border:1,borderColor:'divider','&:before':{display:'none'}}}>
        <AccordionSummary expandIcon={<ExpandMoreIcon/>}><Typography variant="body2" sx={{fontWeight:700}}>ตั้งค่าเพิ่มเติม: ตารางตั้งต้นของไซต์</Typography></AccordionSummary>
        <AccordionDetails><Stack direction={{xs:'column',md:'row'}} spacing={1.5}>
          <TextField size="small" select fullWidth label="ไซต์" value={siteAssignment.siteId} onChange={(e)=>setSiteAssignment({...siteAssignment,siteId:e.target.value})}>{sites.map((site)=><MenuItem key={site.id} value={site.id}>{site.projects?.name} · {site.name}</MenuItem>)}</TextField>
          <TextField size="small" select fullWidth label="ตารางเวลา" value={siteAssignment.policyId} onChange={(e)=>setSiteAssignment({...siteAssignment,policyId:e.target.value})}>{policies.map((policy)=><MenuItem key={policy.id} value={policy.id}>{policy.name}</MenuItem>)}</TextField>
          <Button disabled={busy||!siteAssignment.siteId||!siteAssignment.policyId} onClick={()=>void run(()=>supabase.from('project_sites').update({work_policy_id:siteAssignment.policyId}).eq('id',siteAssignment.siteId),'กำหนดตารางให้ไซต์แล้ว')}>บันทึกไซต์</Button>
        </Stack><Typography variant="caption" color="text.secondary">ลำดับที่ใช้: ตารางเฉพาะการมอบหมาย → ตารางพนักงาน → ตารางตั้งต้นของไซต์</Typography></AccordionDetails>
      </Accordion>
      <Stack direction="row" sx={{mt:1.5,alignItems:'center',justifyContent:'space-between'}}><Typography sx={{fontWeight:700}}>{editingAssignmentId?'แก้ไขการมอบหมายไซต์':'มอบหมายพนักงานเข้าไซต์'}</Typography>{editingAssignmentId&&<Button size="small" onClick={resetAssignmentForm}>ยกเลิกการแก้ไข</Button>}</Stack>
      <Stack direction={{xs:'column',md:'row'}} spacing={1.25} sx={{mt:1}}>
        <TextField size="small" select fullWidth disabled={Boolean(editingAssignmentId)} label="พนักงาน" value={employeeAssignment.profileId} onChange={(e)=>setEmployeeAssignment({...employeeAssignment,profileId:e.target.value})}>
          {employments.map((item)=><MenuItem key={item.profile_id} value={item.profile_id}>{item.profiles?.full_name||item.profiles?.email}</MenuItem>)}
        </TextField>
        <TextField size="small" select fullWidth label="ไซต์" value={employeeAssignment.siteId} onChange={(e)=>setEmployeeAssignment({...employeeAssignment,siteId:e.target.value})}>
          {sites.map((site)=><MenuItem key={site.id} value={site.id}>{siteLabel(site.id)}</MenuItem>)}
        </TextField>
        <TextField size="small" select fullWidth label="ตารางเฉพาะ (ไม่บังคับ)" value={employeeAssignment.policyId} onChange={(e)=>setEmployeeAssignment({...employeeAssignment,policyId:e.target.value})}>
          <MenuItem value="">ใช้ตามลำดับอัตโนมัติ</MenuItem>
          {policies.map((policy)=><MenuItem key={policy.id} value={policy.id}>{policy.name}</MenuItem>)}
        </TextField>
      </Stack>
      <Stack direction={{xs:'column',md:'row'}} spacing={1.25} sx={{mt:1.25,alignItems:{md:'center'}}}>
        <TextField size="small" fullWidth type="date" label="เริ่มใช้วันที่" value={employeeAssignment.startsOn} onChange={(e)=>setEmployeeAssignment({...employeeAssignment,startsOn:e.target.value})} slotProps={{inputLabel:{shrink:true}}}/>
        <TextField size="small" fullWidth type="date" label="สิ้นสุดวันที่ (ไม่บังคับ)" value={employeeAssignment.endsOn} onChange={(e)=>setEmployeeAssignment({...employeeAssignment,endsOn:e.target.value})} slotProps={{inputLabel:{shrink:true}}}/>
        <FormControlLabel control={<Switch checked={employeeAssignment.isPrimary} onChange={(e)=>setEmployeeAssignment({...employeeAssignment,isPrimary:e.target.checked})}/>} label={employeeAssignment.isPrimary?'ไซต์หลัก':'ไซต์เสริม'}/>
        {editingAssignmentId&&<TextField size="small" fullWidth required label="เหตุผลที่แก้ไข" value={assignmentReason} onChange={(e)=>setAssignmentReason(e.target.value)} placeholder="เช่น เลือกไซต์ผิด"/>}
        <Button variant="contained" sx={{minWidth:160}} disabled={busy||!employeeAssignment.profileId||!employeeAssignment.siteId||!employeeAssignment.startsOn||Boolean(employeeAssignment.endsOn&&employeeAssignment.endsOn<employeeAssignment.startsOn)||Boolean(editingAssignmentId&&assignmentReason.trim().length<3)} onClick={()=>void saveEmployeeSiteAssignment()}>{editingAssignmentId?'บันทึกการแก้ไข':'บันทึกการมอบหมาย'}</Button>
      </Stack>
      <Typography sx={{mt:3,mb:1,fontWeight:700}}>การมอบหมายปัจจุบันและประวัติ</Typography>
      <StandardDataTable rows={siteAssignments} getRowId={(row)=>row.id} getSearchText={(row)=>`${employeeLabel(row.profile_id)} ${siteLabel(row.site_id)} ${assignmentStatus(row)}`}
        searchLabel="ค้นหาพนักงาน ไซต์ หรือสถานะ" emptyText="ยังไม่มีประวัติการมอบหมายไซต์" defaultSort={{columnId:'employee'}} columns={[
          {id:'employee',label:'พนักงาน',render:(row)=>employeeLabel(row.profile_id),sortValue:(row)=>employeeLabel(row.profile_id)},
          {id:'site',label:'ไซต์',render:(row)=>siteLabel(row.site_id),sortValue:(row)=>siteLabel(row.site_id)},
          {id:'type',label:'ประเภท',render:(row)=><Chip size="small" color={row.is_primary?'primary':'default'} label={row.is_primary?'ไซต์หลัก':'ไซต์เสริม'}/>,sortValue:(row)=>row.is_primary?0:1},
          {id:'period',label:'ช่วงที่มีผล',render:(row)=>`${row.starts_on} – ${row.ends_on||'ปัจจุบัน'}`,sortValue:(row)=>row.starts_on},
          {id:'policy',label:'ตารางที่กำหนด',render:(row)=>policyLabel(row.work_policy_id),sortValue:(row)=>policyLabel(row.work_policy_id)},
          {id:'status',label:'สถานะ',render:(row)=>{const status=assignmentStatus(row);return <Chip size="small" color={status==='ใช้งานอยู่'?'success':status==='รอเริ่ม'?'info':'default'} label={status}/>},sortValue:(row)=>assignmentStatus(row)},
          {id:'reason',label:'เหตุผลล่าสุด',render:(row)=>row.change_reason||'-',sortValue:(row)=>row.change_reason||''},
          {id:'action',label:'จัดการ',sortable:false,render:(row)=><TextField select size="small" value="" label="จัดการ" sx={{minWidth:125}} onChange={(event)=>handleAssignmentAction(row,event.target.value)}>
            {row.status!=='void'&&<MenuItem value="edit">แก้ไข</MenuItem>}
            {row.status!=='void'&&assignmentStatus(row)!=='สิ้นสุดแล้ว'&&<MenuItem value="move">ย้ายไซต์</MenuItem>}
            {row.status!=='void'&&assignmentStatus(row)!=='สิ้นสุดแล้ว'&&<MenuItem value="end">สิ้นสุดการมอบหมาย</MenuItem>}
            {row.status!=='void'&&<MenuItem value="void" sx={{color:'error.main'}}>ยกเลิกรายการผิด</MenuItem>}
            {row.status==='void'&&<MenuItem disabled value="history">ยกเลิกแล้ว</MenuItem>}
          </TextField>},
        ]}/>
    </Paper>}
    {tab===3&&<>
    <Paper variant="outlined" sx={{p:{xs:2,md:2.5}}}>
      <Typography variant="h6">รอบค่าจ้างอัตโนมัติ</Typography>
      <Typography color="text.secondary">รอบ 1–15 จ่ายวันที่ 20 · รอบ 16–สิ้นเดือน จ่ายวันที่ 5 เดือนถัดไป</Typography>
      <Stack direction={{xs:'column',md:'row'}} spacing={2} sx={{mt:2}}>
        <TextField type="number" label="วันตัดรอบแรก" value={paySettings.first_period_end_day} onChange={(e)=>setPaySettings({...paySettings,first_period_end_day:Number(e.target.value)})}/>
        <TextField type="number" label="วันจ่ายรอบแรก" value={paySettings.first_pay_day} onChange={(e)=>setPaySettings({...paySettings,first_pay_day:Number(e.target.value)})}/>
        <TextField type="number" label="วันจ่ายรอบสอง" value={paySettings.second_pay_day} onChange={(e)=>setPaySettings({...paySettings,second_pay_day:Number(e.target.value)})}/>
        <TextField select label="ถ้าวันจ่ายเป็นวันหยุด" value={paySettings.holiday_adjustment}
          onChange={(e)=>setPaySettings({...paySettings,holiday_adjustment:e.target.value as PaySettings['holiday_adjustment']})}>
          <MenuItem value="previous_workday">จ่ายก่อนวันหยุด</MenuItem>
          <MenuItem value="next_workday">วันทำการถัดไป</MenuItem>
          <MenuItem value="none">ใช้วันที่เดิม</MenuItem>
        </TextField>
        <Button variant="contained" disabled={busy} onClick={()=>void savePaySettings()}>บันทึกกติกา</Button>
      </Stack>
      <Stack direction={{xs:'column',sm:'row'}} spacing={2} sx={{mt:2}}>
        <TextField type="month" label="เดือนที่ต้องการสร้าง" value={cycleMonth} onChange={(e)=>setCycleMonth(e.target.value)} slotProps={{inputLabel:{shrink:true}}}/>
        <Button variant="contained" disabled={busy||!cycleMonth} onClick={()=>void generateCycles()}>สร้าง 2 รอบอัตโนมัติ</Button>
      </Stack>
    </Paper>
    <StandardDataTable rows={periods} getRowId={(row)=>row.id} getSearchText={(row)=>`${row.name} ${row.status}`}
      searchLabel="ค้นหารอบจ่าย" emptyText="ไม่มีรอบจ่าย" columns={[
        {id:'name',label:'รอบ',render:(row)=>row.name},
        {id:'range',label:'ช่วงทำงาน',render:(row)=>`${row.starts_on} – ${row.ends_on}`},
        {id:'pay',label:'วันจ่าย',render:(row)=>row.pay_date},
        {id:'status',label:'สถานะ',render:(row)=>row.status},
      ]}/>
    </>}
    {tab===4&&<Paper variant="outlined" sx={{p:{xs:2,md:2.5}}}>
      <Typography variant="h6">กติกาเวลา ค่าจ้าง และการแจ้งเตือน</Typography>
      <Typography color="text.secondary" sx={{mb:2}}>ใช้เป็นค่ากลางของบริษัท และเปลี่ยนได้โดยไม่ต้องแก้ Code</Typography>
      <Stack spacing={2}>
        <Stack direction={{xs:'column',md:'row'}} spacing={2}>
          <TextField select fullWidth label="วิธีคิดพนักงานรายวัน" value={ruleSettings.daily_pay_mode} onChange={(e)=>setRuleSettings({...ruleSettings,daily_pay_mode:e.target.value as RuleSettings['daily_pay_mode']})}>
            <MenuItem value="day_tiers">เต็มวัน / ครึ่งวัน / ไม่จ่าย</MenuItem><MenuItem value="prorated_minutes">คิดตามนาทีจริง</MenuItem>
          </TextField>
          <TextField fullWidth type="number" label="เต็มวัน (นาที)" value={ruleSettings.full_day_minutes} onChange={(e)=>setRuleSettings({...ruleSettings,full_day_minutes:Number(e.target.value)})}/>
          <TextField fullWidth type="number" label="ขั้นต่ำครึ่งวัน (นาที)" value={ruleSettings.half_day_minutes} onChange={(e)=>setRuleSettings({...ruleSettings,half_day_minutes:Number(e.target.value)})}/>
        </Stack>
        <Stack direction={{xs:'column',md:'row'}} spacing={2}>
          <TextField fullWidth type="number" label="รายเดือน: ไม่ครบวัน หักกี่วัน" value={ruleSettings.monthly_partial_day_deduction_factor} onChange={(e)=>setRuleSettings({...ruleSettings,monthly_partial_day_deduction_factor:Number(e.target.value)})}/>
          <TextField fullWidth type="number" label="รายเดือน: ไม่ถึงครึ่งวัน หักกี่วัน" value={ruleSettings.monthly_below_half_day_deduction_factor} onChange={(e)=>setRuleSettings({...ruleSettings,monthly_below_half_day_deduction_factor:Number(e.target.value)})}/>
          <TextField fullWidth type="number" label="ฐานหารเงินเดือนต่อวัน" value={ruleSettings.monthly_salary_divisor} onChange={(e)=>setRuleSettings({...ruleSettings,monthly_salary_divisor:Number(e.target.value)})}/>
          <TextField fullWidth type="number" label="สัดส่วนเงินเดือนรอบแรก" value={ruleSettings.first_period_salary_ratio} onChange={(e)=>setRuleSettings({...ruleSettings,first_period_salary_ratio:Number(e.target.value)})}/>
        </Stack>
        <Paper variant="outlined" sx={{p:2}}>
          <Typography variant="subtitle1" sx={{fontWeight:700}}>รูปแบบแสดงเวลาทำงาน</Typography>
          <Typography variant="body2" color="text.secondary" sx={{mb:2}}>ใช้ร่วมกันในรายงาน ตารางรายละเอียด และ PDF ของบริษัทนี้ โดยไม่เปลี่ยนสูตรคำนวณค่าแรง</Typography>
          <Stack direction={{xs:'column',md:'row'}} spacing={2} sx={{alignItems:{md:'center'}}}>
            <TextField select fullWidth label="หน่วยหลัก" value={ruleSettings.work_time_primary_unit} onChange={(e)=>setRuleSettings({...ruleSettings,work_time_primary_unit:e.target.value as RuleSettings['work_time_primary_unit']})}>
              <MenuItem value="days">วัน</MenuItem><MenuItem value="hours">ชั่วโมงและนาที</MenuItem>
            </TextField>
            <TextField fullWidth type="number" label="ทศนิยมของวัน" value={ruleSettings.work_time_day_decimals} disabled={ruleSettings.work_time_primary_unit!=='days'} slotProps={{htmlInput:{min:0,max:3}}} onChange={(e)=>setRuleSettings({...ruleSettings,work_time_day_decimals:Math.min(3,Math.max(0,Number(e.target.value)))})}/>
            <FormControlLabel sx={{minWidth:240}} control={<Switch checked={ruleSettings.work_time_show_secondary_hours} disabled={ruleSettings.work_time_primary_unit!=='days'} onChange={(e)=>setRuleSettings({...ruleSettings,work_time_show_secondary_hours:e.target.checked})}/>} label="แสดงชั่วโมงเป็นข้อมูลรอง"/>
          </Stack>
          <Alert severity="info" sx={{mt:2}}>ตัวอย่าง: 480 นาที = 1.00 วัน และแสดง 8 ชม. ด้านล่าง · OT สาย และออกก่อนยังแสดงเป็นชั่วโมง/นาทีเพื่อการตรวจสอบ</Alert>
        </Paper>
        <Stack direction={{xs:'column',md:'row'}} spacing={2}>
          <TextField fullWidth type="number" label="เตือนหลังเลิกกะ (นาที)" value={ruleSettings.clock_out_reminder_minutes} onChange={(e)=>setRuleSettings({...ruleSettings,clock_out_reminder_minutes:Number(e.target.value)})}/>
          <TextField fullWidth type="number" label="รอตรวจสอบหลังเลิกกะ (นาที)" value={ruleSettings.stale_after_shift_minutes} onChange={(e)=>setRuleSettings({...ruleSettings,stale_after_shift_minutes:Number(e.target.value)})}/>
          <TextField fullWidth type="number" label="เตือนหลังจบ OT (นาที)" value={ruleSettings.overtime_reminder_minutes} onChange={(e)=>setRuleSettings({...ruleSettings,overtime_reminder_minutes:Number(e.target.value)})}/>
          <TextField fullWidth type="time" label="ส่งสรุปตอนเช้า" value={ruleSettings.morning_summary_time.slice(0,5)} onChange={(e)=>setRuleSettings({...ruleSettings,morning_summary_time:e.target.value})} slotProps={{inputLabel:{shrink:true}}}/>
        </Stack>
        <TextField fullWidth label="LINE Group ID สำหรับแจ้งเตือน" value={ruleSettings.line_group_id??''} onChange={(e)=>setRuleSettings({...ruleSettings,line_group_id:e.target.value||null})} helperText="ต้องเป็นกลุ่มที่เชิญ LINE Bot เข้าร่วมแล้ว"/>
        <Alert severity="info">ค่าเริ่มต้น: กะ 08:00–17:00 เตือน 20:00 · ค้างหลัง 00:00 · สรุป LINE 07:00 · กะกลางคืนอ้างอิงเวลาสิ้นสุดกะ</Alert>
        <Stack direction="row" sx={{justifyContent:'flex-end'}}><Button variant="contained" disabled={busy||ruleSettings.half_day_minutes>=ruleSettings.full_day_minutes} onClick={()=>void saveRuleSettings()}>บันทึกกติกา</Button></Stack>
      </Stack>
    </Paper>}
  </Stack>
}

