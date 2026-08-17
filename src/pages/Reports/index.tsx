import AddOutlinedIcon from '@mui/icons-material/AddOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Paper, Stack, Tab, Tabs, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
import { defaultWorkTimeDisplaySettings, type WorkTimeDisplaySettings } from '../../utils/timeDisplay'
import { calculateEffectiveWorkday, type WorkdayOverrideMode } from '../../utils/wageDay'
import { calculateHolidayWage } from '../../utils/holidayWage'
import { RealtimePayrollForecast } from './RealtimePayrollForecast'
type Site={id:string;name:string;projects:{name:string}|null}
type Employee={id:string;full_name:string|null;email:string|null}
type Row={id:string;profile_id:string;clock_in_at:string;clock_out_at:string|null;scheduled_start_at:string|null;scheduled_end_at:string|null;status:string;review_reason:string|null;review_category:string|null;worked_minutes:number|null;normal_minutes:number|null;overtime_minutes:number;late_minutes:number;early_leave_minutes:number;early_arrival_minutes:number;pre_shift_overtime_minutes:number;post_shift_overtime_minutes:number;excluded_minutes:number;clock_in_latitude:number|null;clock_in_longitude:number|null;clock_out_latitude:number|null;clock_out_longitude:number|null;clock_in_accuracy_meters:number|null;clock_out_accuracy_meters:number|null;clock_in_distance_meters:number|null;clock_out_distance_meters:number|null;clock_in_selfie_path:string|null;clock_out_selfie_path:string|null;clock_in_device_info:Record<string,unknown>|null;clock_out_device_info:Record<string,unknown>|null;note:string|null;profiles:{full_name:string|null;email:string|null}|null;project_sites:{id:string;name:string;projects:{name:string}|null}|null}
type PayrollRow={id:string;profile_id:string;normal_minutes:number;overtime_minutes:number;base_pay:number;overtime_pay:number;additions:number;deductions:number;reimbursements:number;net_pay:number;status:string;profiles:{full_name:string|null;email:string|null}|null;pay_periods:{name:string;starts_on:string;ends_on:string;pay_date:string}|null;employee_payslips:{document_number:string;status:string}[]|null}
type PayPeriod={id:string;name:string;starts_on:string;ends_on:string;pay_date:string;status:string}
type LeaveRow={id:string;profile_id:string;starts_at:string;ends_at:string;requested_minutes:number;reason:string;status:string;profiles:{full_name:string|null;email:string|null}|null;leave_types:{name_th:string;paid_ratio:number}|null}
type EmployeeSummary={id:string;name:string;employmentType:string;days:number;netDays:number;standardMinutes:number;open:number;worked:number;normal:number;outside:number;outsideDays:number;ot:number;late:number;lateDays:number;early:number;earlyDays:number;estimatedPay:number;paySource:string;status:string}
type SiteSummary={id:string;name:string;sessions:number;employees:number;worked:number;normal:number;outside:number;ot:number;open:number}
type RepairProposal={id:string;session_id:string;issue_code:string;original_clock_out_at:string|null;proposed_clock_out_at:string;explanation:string;status:string;detected_at:string;attendance_sessions:{clock_in_at:string;clock_out_at:string|null;profile_id:string;profiles:{full_name:string|null;email:string|null}|null;project_sites:{name:string}|null}|null}
type EmploymentPolicy={profile_id:string;attendance_policy:'required'|'record_only'|'exempt';work_policy_id:string|null;employment_type:string;daily_rate:number;monthly_salary:number;overtime_hourly_rate:number}
type WorkPolicy={id:string;work_weekdays:number[];standard_minutes:number;work_start_time:string;work_end_time:string;break_start_time:string;break_end_time:string;grace_minutes:number}
type SiteAssignment={profile_id:string;site_id:string;starts_on:string;ends_on:string|null;active:boolean;profiles:{full_name:string|null;email:string|null}|null;project_sites:{id:string;name:string;projects:{name:string}|null}|null}
type SiteCostAllocation={id:string;profile_id:string;site_id:string;allocation_mode:'percent'|'fixed_amount';allocation_value:number;starts_on:string;ends_on:string|null;active:boolean}
type AttendanceAudit={session_id:string|null;action:string;reason:string|null}
type WageDayOverride={id:string;profile_id:string;work_date:string;day_units:number;override_mode:WorkdayOverrideMode;effective_start_time:string|null;effective_end_time:string|null;reason:string;updated_by:string;updated_at:string;profiles:{full_name:string|null;email:string|null}|null}
type HolidayType='weekly_holiday'|'traditional_holiday'|'company_holiday'|'other'
type Holiday={holiday_date:string;name:string;site_id:string|null}
type HolidayWageOverride={id:string;profile_id:string;work_date:string;holiday_type:HolidayType;wage_multiplier:number;holiday_overtime_minutes:number|null;reason:string;pay_period_id:string|null;updated_by:string;updated_at:string;profiles:{full_name:string|null;email:string|null}|null}
type ProjectEmployeeSummary={id:string;profileId:string;siteId:string;employee:string;site:string;period:string;employmentType:string;attendancePolicy:string;scheduledDays:number;attendanceDays:number;totalActualDays:number;otherSiteDays:number;leaveDays:number;missingDays:number;workedMinutes:number;verifiedMinutes:number;pendingMinutes:number;standardMinutes:number;employeePay:number;allocationLabel:string;allocatedCost:number;pendingCost:number;unallocatedCost:number;reviewCount:number;status:string;issue:string}
const reportColumns='id,profile_id,clock_in_at,clock_out_at,scheduled_start_at,scheduled_end_at,status,review_reason,review_category,worked_minutes,normal_minutes,overtime_minutes,late_minutes,early_leave_minutes,early_arrival_minutes,pre_shift_overtime_minutes,post_shift_overtime_minutes,excluded_minutes,clock_in_latitude,clock_in_longitude,clock_out_latitude,clock_out_longitude,clock_in_accuracy_meters,clock_out_accuracy_meters,clock_in_distance_meters,clock_out_distance_meters,clock_in_selfie_path,clock_out_selfie_path,clock_in_device_info,clock_out_device_info,note,profiles!attendance_sessions_profile_id_fkey(full_name,email),project_sites(id,name,projects(name))'
const PAGE_SIZE=1000
const emptyAdjustment={sessionId:'',profileId:'',siteId:'',clockIn:'',clockOut:'',clockOutDate:'',reason:''}
const employmentTypeLabel:Record<string,string>={daily:'รายวัน',monthly:'รายเดือน',temporary:'ชั่วคราว',contractor:'ผู้รับเหมา'}
const attendancePolicyLabel:Record<string,string>={required:'ต้องลงเวลาและมีผลต่อค่าจ้าง',record_only:'ลงเวลาเพื่อติดตามและกระจายต้นทุน',exempt:'ไม่ต้องลงเวลา'}

const reviewCategoryLabel:Record<string,string>={gps_outside:'อยู่นอกพื้นที่ไซต์',gps_inaccurate:'ความแม่นยำ GPS ต่ำ',gps_unavailable:'ไม่พบสัญญาณ GPS',shared_device:'ใช้อุปกรณ์ร่วมกัน',missing_clock_out:'ไม่มีเวลาออก',manual_correction:'มีการแก้ไขเวลาด้วยผู้ดูแล',multiple:'พบหลายเงื่อนไขผิดปกติ'}
const evidenceValue=(value:unknown)=>typeof value==='string'?value:typeof value==='number'?String(value):value&&typeof value==='object'?JSON.stringify(value):'-'

function bangkokLocalInput(value:string){return new Date(value).toLocaleString('sv-SE',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).replace(' ','T')}
function bangkokIso(value:string){return new Date(`${value}:00+07:00`).toISOString()}
const duration=(minutes:number|null|undefined)=>{const value=Math.max(0,Math.round(Number(minutes??0))),hours=Math.floor(value/60),remaining=value%60;return hours&&remaining?`${hours} ชม. ${remaining} นาที`:hours?`${hours} ชม.`:`${remaining} นาที`}
const optionalDuration=(minutes:number|null|undefined)=>Number(minutes??0)>0?duration(minutes):'-'
const optionalCount=(value:number,unit:string)=>value>0?`${value.toLocaleString('th-TH')} ${unit}`:'-'
const optionalMoney=(value:number)=>value>0?value.toLocaleString('th-TH',{style:'currency',currency:'THB'}):'-'
const moneyText=(value:number)=>`${Number(value??0).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท`

function bangkokMonthRange(month:string){
  const [year,value]=month.split('-').map(Number)
  if(!year||!value||value<1||value>12)throw new Error('เดือนที่เลือกไม่ถูกต้อง')
  const next=value===12?`${year+1}-01`:`${year}-${String(value+1).padStart(2,'0')}`
  return {start:`${month}-01T00:00:00+07:00`,end:`${next}-01T00:00:00+07:00`}
}

export function ReportsPage(){
  usePageTitle('รายงานพนักงาน')
  const {profile,currentCompany}=useAuth(),canManage=profile?.role==='admin'||profile?.role==='manager',companyId=currentCompany?.company_id??''
  const isAdmin=profile?.role==='admin'
  const isPlatformAdmin=profile?.platform_role==='admin'
  const [searchParams,setSearchParams]=useSearchParams()
  const requestedEmployee=searchParams.get('employee')||'all',requestedSession=searchParams.get('session')||''
  const [month,setMonth]=useState(searchParams.get('month')||new Date().toISOString().slice(0,7)),[periodId,setPeriodId]=useState('month'),[siteId,setSiteId]=useState('all'),[employeeId,setEmployeeId]=useState(requestedEmployee)
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[rows,setRows]=useState<Row[]>([]),[sites,setSites]=useState<Site[]>([])
  const [employees,setEmployees]=useState<Employee[]>([]),[dialogOpen,setDialogOpen]=useState(false),[saving,setSaving]=useState(false)
  const [sheet,setSheet]=useState(0),[payTypeTab,setPayTypeTab]=useState(0),[payrolls,setPayrolls]=useState<PayrollRow[]>([]),[leaves,setLeaves]=useState<LeaveRow[]>([]),[success,setSuccess]=useState('')
  const [adjustment,setAdjustment]=useState(emptyAdjustment)
  const [voidTarget,setVoidTarget]=useState<Row|null>(null),[voidReason,setVoidReason]=useState(''),[voidSaving,setVoidSaving]=useState(false),[restoreMode,setRestoreMode]=useState(false)
  const [repairProposals,setRepairProposals]=useState<RepairProposal[]>([]),[repairTarget,setRepairTarget]=useState<RepairProposal|null>(null),[repairDecision,setRepairDecision]=useState<'apply'|'reject'>('apply'),[repairNote,setRepairNote]=useState(''),[repairSaving,setRepairSaving]=useState(false),[repairScanning,setRepairScanning]=useState(false)
  const [confirmTarget,setConfirmTarget]=useState<Row|null>(null),[confirmReason,setConfirmReason]=useState(''),[confirmSaving,setConfirmSaving]=useState(false)
  const [summaryTarget,setSummaryTarget]=useState<EmployeeSummary|null>(null)
  const [detailTarget,setDetailTarget]=useState<Row|null>(null)
  const [employmentPolicies,setEmploymentPolicies]=useState<EmploymentPolicy[]>([]),[workPolicies,setWorkPolicies]=useState<WorkPolicy[]>([]),[holidays,setHolidays]=useState<Holiday[]>([])
  const [siteAssignments,setSiteAssignments]=useState<SiteAssignment[]>([])
  const [siteCostAllocations,setSiteCostAllocations]=useState<SiteCostAllocation[]>([])
  const [timeDisplaySettings,setTimeDisplaySettings]=useState<WorkTimeDisplaySettings>(defaultWorkTimeDisplaySettings)
  const [attendanceAudits,setAttendanceAudits]=useState<AttendanceAudit[]>([])
  const [payPeriods,setPayPeriods]=useState<PayPeriod[]>([])
  const payPeriodInitialized=useRef('')
  const [wageDayOverrides,setWageDayOverrides]=useState<WageDayOverride[]>([])
  const [wageOverrideTarget,setWageOverrideTarget]=useState<{date:string;calculatedUnits:number;currentUnits:number;overrideMode?:WorkdayOverrideMode;effectiveStartTime?:string;effectiveEndTime?:string;reason:string}|null>(null)
  const [wageOverrideSaving,setWageOverrideSaving]=useState(false)
  const [holidayWageOverrides,setHolidayWageOverrides]=useState<HolidayWageOverride[]>([])
  const [holidayWageTarget,setHolidayWageTarget]=useState<{date:string;holidayType:HolidayType;multiplier:number;holidayOvertimeMinutes:number;reason:string}|null>(null)
  const [holidayWageSaving,setHolidayWageSaving]=useState(false)
  const openCreate=useCallback((profileId='')=>{
    const now=bangkokLocalInput(new Date().toISOString())
    setAdjustment({...emptyAdjustment,profileId,siteId:siteId==='all'?'':siteId,clockIn:now,clockOutDate:now.slice(0,10)})
    setError('');setDialogOpen(true)
  },[siteId])
  const load=useCallback(async()=>{
    if(!canManage)return
    setLoading(true);setError('')
    try{
      const range=bangkokMonthRange(month)
      const siteRequest=supabase.from('project_sites').select('id,name,projects(name)').eq('active',true).order('name')
      const employeeRequest=supabase.from('profiles').select('id,full_name,email').order('full_name')
      const allRows:Row[]=[]
      for(let from=0;;from+=PAGE_SIZE){
        const query=supabase.from('attendance_sessions').select(reportColumns)
          .gte('clock_in_at',range.start).lt('clock_in_at',range.end)
          .neq('status','duplicate').order('clock_in_at').range(from,from+PAGE_SIZE-1)
        const {data,error:pageError}=await query
        if(pageError)throw pageError
        const page=(data??[]) as unknown as Row[]
        allRows.push(...page)
        if(page.length<PAGE_SIZE)break
      }
      const payrollRequest=supabase.from('employee_payrolls').select('id,profile_id,normal_minutes,overtime_minutes,base_pay,overtime_pay,additions,deductions,reimbursements,net_pay,status,profiles!employee_payrolls_profile_id_fkey(full_name,email),pay_periods(name,starts_on,ends_on,pay_date),employee_payslips(document_number,status)').eq('company_id',companyId).order('created_at',{ascending:false}).limit(500)
      const payPeriodRequest=supabase.from('pay_periods').select('id,name,starts_on,ends_on,pay_date,status').eq('company_id',companyId).lte('starts_on',range.end.slice(0,10)).gte('ends_on',range.start.slice(0,10)).order('starts_on')
      const leaveRequest=supabase.from('employee_leave_requests').select('id,profile_id,starts_at,ends_at,requested_minutes,reason,status,profiles!employee_leave_requests_profile_id_fkey(full_name,email),leave_types(name_th,paid_ratio)').eq('company_id',companyId).lt('starts_at',range.end).gte('ends_at',range.start).order('starts_at')
      const repairRequest=supabase.from('attendance_repair_proposals').select('id,session_id,issue_code,original_clock_out_at,proposed_clock_out_at,explanation,status,detected_at,attendance_sessions!attendance_repair_proposals_session_id_fkey(clock_in_at,clock_out_at,profile_id,profiles!attendance_sessions_profile_id_fkey(full_name,email),project_sites(name))').eq('company_id',companyId).eq('status','pending').order('detected_at',{ascending:false})
      const employmentRequest=supabase.from('employee_employment_records').select('profile_id,attendance_policy,work_policy_id,employment_type,daily_rate,monthly_salary,overtime_hourly_rate').eq('company_id',companyId)
      const workPolicyRequest=supabase.from('work_policies').select('id,work_weekdays,standard_minutes,work_start_time,work_end_time,break_start_time,break_end_time,grace_minutes').eq('company_id',companyId).eq('active',true)
      const holidayRequest=supabase.from('company_holidays').select('holiday_date,name,site_id').eq('company_id',companyId).gte('holiday_date',range.start.slice(0,10)).lt('holiday_date',range.end.slice(0,10))
      const assignmentRequest=supabase.from('employee_site_assignments').select('profile_id,site_id,starts_on,ends_on,active').eq('company_id',companyId).eq('active',true).lte('starts_on',range.end.slice(0,10)).or(`ends_on.is.null,ends_on.gte.${range.start.slice(0,10)}`)
      const allocationRequest=supabase.from('employee_site_cost_allocations').select('id,profile_id,site_id,allocation_mode,allocation_value,starts_on,ends_on,active').eq('company_id',companyId).eq('active',true).lte('starts_on',range.end.slice(0,10)).or(`ends_on.is.null,ends_on.gte.${range.start.slice(0,10)}`)
      const displaySettingsRequest=supabase.from('workforce_rule_settings').select('work_time_primary_unit,work_time_day_decimals,work_time_show_secondary_hours,full_day_minutes,half_day_minutes').eq('company_id',companyId).eq('singleton',true).maybeSingle()
      const wageOverrideRequest=supabase.from('employee_wage_day_overrides').select('id,profile_id,work_date,day_units,override_mode,effective_start_time,effective_end_time,reason,updated_by,updated_at,profiles!employee_wage_day_overrides_updated_by_fkey(full_name,email)').eq('company_id',companyId).gte('work_date',range.start.slice(0,10)).lt('work_date',range.end.slice(0,10))
      const holidayWageOverrideRequest=supabase.from('employee_holiday_wage_overrides').select('id,profile_id,work_date,holiday_type,wage_multiplier,holiday_overtime_minutes,reason,pay_period_id,updated_by,updated_at,profiles!employee_holiday_wage_overrides_updated_by_fkey(full_name,email)').eq('company_id',companyId).gte('work_date',range.start.slice(0,10)).lt('work_date',range.end.slice(0,10))
      const [siteRows,employeeRows,payrollRows,payPeriodRows,leaveRows,repairRows,employmentRows,workPolicyRows,holidayRows,assignmentRows,allocationRows,displaySettingsRows,wageOverrideRows,holidayWageOverrideRows]=await Promise.all([siteRequest,employeeRequest,payrollRequest,payPeriodRequest,leaveRequest,repairRequest,employmentRequest,workPolicyRequest,holidayRequest,assignmentRequest,allocationRequest,displaySettingsRequest,wageOverrideRequest,holidayWageOverrideRequest])
      if(siteRows.error||employeeRows.error||payrollRows.error||leaveRows.error||repairRows.error||employmentRows.error||workPolicyRows.error||holidayRows.error)throw siteRows.error??employeeRows.error??payrollRows.error??leaveRows.error??repairRows.error??employmentRows.error??workPolicyRows.error??holidayRows.error
      setRows(allRows);setSites((siteRows.data??[]) as unknown as Site[]);setEmployees((employeeRows.data??[]) as Employee[])
      const requestedRow=requestedSession?allRows.find(row=>row.id===requestedSession):null
      if(requestedRow){const clockIn=bangkokLocalInput(requestedRow.clock_in_at),clockOut=requestedRow.clock_out_at?bangkokLocalInput(requestedRow.clock_out_at):'';setSheet(3);setAdjustment({sessionId:requestedRow.id,profileId:requestedRow.profile_id,siteId:requestedRow.project_sites?.id??'',clockIn,clockOut,clockOutDate:(clockOut||clockIn).slice(0,10),reason:''});setDialogOpen(true);setSearchParams({}, {replace:true})}
      setPayrolls(((payrollRows.data??[]) as unknown as PayrollRow[]).filter(row=>row.pay_periods?.starts_on?.slice(0,7)===month||row.pay_periods?.ends_on?.slice(0,7)===month))
      if(payPeriodRows.error)throw payPeriodRows.error
      setPayPeriods((payPeriodRows.data??[]) as PayPeriod[])
      setLeaves((leaveRows.data??[]) as unknown as LeaveRow[])
      setRepairProposals((repairRows.data??[]) as unknown as RepairProposal[])
      setEmploymentPolicies((employmentRows.data??[]) as unknown as EmploymentPolicy[]);setWorkPolicies((workPolicyRows.data??[]) as WorkPolicy[]);setHolidays((holidayRows.data??[]) as Holiday[])
      setSiteAssignments((((assignmentRows.error?[]:assignmentRows.data)??[]) as Omit<SiteAssignment,'profiles'|'project_sites'>[]).map(item=>({
        ...item,
        profiles:((employeeRows.data??[]) as Employee[]).find(employee=>employee.id===item.profile_id)??null,
        project_sites:((siteRows.data??[]) as unknown as Site[]).find(site=>site.id===item.site_id)??null,
      })))
      setSiteCostAllocations((((allocationRows.error?[]:allocationRows.data)??[]) as SiteCostAllocation[]))
      if(displaySettingsRows.data)setTimeDisplaySettings({...defaultWorkTimeDisplaySettings,...displaySettingsRows.data} as WorkTimeDisplaySettings)
      if(wageOverrideRows.error)throw wageOverrideRows.error
      setWageDayOverrides((wageOverrideRows.data??[]) as unknown as WageDayOverride[])
      if(holidayWageOverrideRows.error)throw holidayWageOverrideRows.error
      setHolidayWageOverrides((holidayWageOverrideRows.data??[]) as unknown as HolidayWageOverride[])
    }catch{
      setRows([]);setError('โหลดรายงานไม่สำเร็จ กรุณาลองใหม่')
    }finally{
      setLoading(false)
    }
  },[canManage,companyId,month,requestedSession,setSearchParams])
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load])
  useEffect(()=>{
    const initializationKey=`${companyId}:${month}`
    if(payPeriodInitialized.current===initializationKey||!payPeriods.length)return
    const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Bangkok'})
    const current=payPeriods.find(period=>period.starts_on<=today&&period.ends_on>=today)
      ??payPeriods.find(period=>period.status==='open')
      ??payPeriods.at(-1)
    payPeriodInitialized.current=initializationKey
    if(!current)return
    const timer=window.setTimeout(()=>setPeriodId(current.id),0)
    return()=>window.clearTimeout(timer)
  },[companyId,month,payPeriods])
  useEffect(()=>{
    if(!summaryTarget||!companyId){
      const timer=window.setTimeout(()=>setAttendanceAudits([]),0)
      return()=>window.clearTimeout(timer)
    }
    let cancelled=false
    const loadAudits=async()=>{
      const sessionIds=rows.filter(row=>row.profile_id===summaryTarget.id).map(row=>row.id)
      const auditRows:AttendanceAudit[]=[]
      for(let from=0;from<sessionIds.length;from+=500){
        const {data,error:auditError}=await supabase.from('attendance_audit_logs').select('session_id,action,reason').eq('company_id',companyId).in('session_id',sessionIds.slice(from,from+500))
        if(auditError)return
        auditRows.push(...((data??[]) as AttendanceAudit[]))
      }
      if(!cancelled)setAttendanceAudits(auditRows)
    }
    void loadAudits()
    return()=>{cancelled=true}
  },[companyId,rows,summaryTarget])
  useEffect(()=>{
    if(loading||!isAdmin||searchParams.get('add')!=='1')return
    const timer=window.setTimeout(()=>{
      openCreate(searchParams.get('employee')||'')
      setSearchParams({}, {replace:true})
    },0)
    return()=>window.clearTimeout(timer)
  },[isAdmin,loading,openCreate,searchParams,setSearchParams])
  if(!canManage)return <Alert severity="error">เฉพาะผู้จัดการและผู้ดูแลระบบ</Alert>
  if(loading)return <Stack sx={{alignItems:'center',py:8}}><CircularProgress/></Stack>
  const openEdit=(row:Row)=>{const clockIn=bangkokLocalInput(row.clock_in_at),clockOut=row.clock_out_at?bangkokLocalInput(row.clock_out_at):'';setAdjustment({sessionId:row.id,profileId:row.profile_id,siteId:row.project_sites?.id??'',clockIn,clockOut,clockOutDate:(clockOut||clockIn).slice(0,10),reason:''});setError('');setDialogOpen(true)}
  const saveAdjustment=async()=>{
    if(!adjustment.profileId||!adjustment.siteId||!adjustment.clockIn||adjustment.reason.trim().length<3)return
    setSaving(true);setError('');setSuccess('')
    const {error:saveError}=await supabase.rpc('admin_save_attendance',{target_session_id:adjustment.sessionId||null,target_profile_id:adjustment.profileId,target_site_id:adjustment.siteId,target_clock_in_at:bangkokIso(adjustment.clockIn),target_clock_out_at:adjustment.clockOut?bangkokIso(adjustment.clockOut):null,adjustment_reason:adjustment.reason.trim()})
    if(saveError)setError(saveError.message);else{await load();setSuccess('บันทึกและรีเฟรชข้อมูลล่าสุดแล้ว');setDialogOpen(false)}
    setSaving(false)
  }
  const manageSoftDelete=async()=>{
    if(!voidTarget||voidReason.trim().length<3)return
    setVoidSaving(true);setError('');setSuccess('')
    const {error:actionError}=restoreMode
      ?await supabase.rpc('restore_soft_deleted_attendance_session',{target_session_id:voidTarget.id,restore_reason:voidReason.trim()})
      :await supabase.rpc('soft_delete_attendance_session',{target_session_id:voidTarget.id,delete_reason:voidReason.trim()})
    if(actionError)setError(actionError.message)
    else{setSuccess(restoreMode?'กู้คืนเคสและส่งกลับไปรอตรวจแล้ว':'ยกเลิกเคสแล้ว ข้อมูลไม่ถูกนำไปคำนวณและยังเก็บใน Audit Log');setVoidTarget(null);setVoidReason('');await load()}
    setVoidSaving(false)
  }
  const scanRepairs=async()=>{
    setRepairScanning(true);setError('');setSuccess('')
    const {data,error:scanError}=await supabase.rpc('scan_attendance_repair_proposals')
    if(scanError)setError(scanError.message);else{setSuccess(`ตรวจข้อมูลย้อนหลังแล้ว พบหรืออัปเดตข้อเสนอ ${Number(data??0)} รายการ`);await load()}
    setRepairScanning(false)
  }
  const decideRepair=async()=>{
    if(!repairTarget||repairNote.trim().length<3)return
    setRepairSaving(true);setError('');setSuccess('')
    const {error:decisionError}=await supabase.rpc('decide_attendance_repair_proposal',{target_proposal_id:repairTarget.id,decision:repairDecision,decision_note:repairNote.trim()})
    if(decisionError)setError(decisionError.message);else{setSuccess(repairDecision==='apply'?'ใช้เวลาเสนอและคำนวณรายการใหม่แล้ว':'ปฏิเสธข้อเสนอแล้ว โดยไม่เปลี่ยนเวลาต้นฉบับ');setRepairTarget(null);setRepairNote('');await load()}
    setRepairSaving(false)
  }
  const confirmTimeIsCorrect=async()=>{
    if(!confirmTarget||confirmReason.trim().length<3)return
    setConfirmSaving(true);setError('');setSuccess('')
    const {error:confirmError}=await supabase.rpc('confirm_attendance_time_is_correct',{target_session_id:confirmTarget.id,confirmation_reason:confirmReason.trim()})
    if(confirmError)setError(confirmError.message);else{setSuccess('ยืนยันเวลาถูกต้องแล้ว ระบบคำนวณใหม่และเก็บ Audit Log เรียบร้อย');setConfirmTarget(null);setConfirmReason('');await load()}
    setConfirmSaving(false)
  }
  const saveWageDayOverride=async()=>{
    if(!summaryTarget||!wageOverrideTarget||wageOverrideTarget.reason.trim().length<3)return
    setWageOverrideSaving(true);setError('');setSuccess('')
    const {error:overrideError}=await supabase.rpc('admin_set_employee_wage_day_override',{
      target_profile_id:summaryTarget.id,
      target_work_date:wageOverrideTarget.date,
      target_day_units:wageOverrideTarget.currentUnits,
      target_override_mode:wageOverrideTarget.overrideMode??'auto',
      target_effective_start_time:wageOverrideTarget.overrideMode==='custom_period'?wageOverrideTarget.effectiveStartTime||null:null,
      target_effective_end_time:wageOverrideTarget.overrideMode==='custom_period'?wageOverrideTarget.effectiveEndTime||null:null,
      override_reason:wageOverrideTarget.reason.trim(),
    })
    if(overrideError)setError(overrideError.message)
    else{setSuccess('บันทึกผลคิดวันพร้อมผู้แก้ไข เวลา และเหตุผลใน Audit แล้ว');setWageOverrideTarget(null);await load()}
    setWageOverrideSaving(false)
  }
  const saveHolidayWageOverride=async()=>{
    if(!summaryTarget||!holidayWageTarget||holidayWageTarget.reason.trim().length<3)return
    setHolidayWageSaving(true);setError('');setSuccess('')
    const {error:overrideError}=await supabase.rpc('admin_set_employee_holiday_wage_override',{
      target_profile_id:summaryTarget.id,target_work_date:holidayWageTarget.date,target_multiplier:holidayWageTarget.multiplier,
      target_holiday_type:holidayWageTarget.holidayType,target_holiday_overtime_minutes:holidayWageTarget.holidayOvertimeMinutes,override_reason:holidayWageTarget.reason.trim(),target_pay_period_id:selectedPayPeriod?.id??null,
    })
    if(overrideError)setError(overrideError.message)
    else{setSuccess('บันทึกอัตราค่าทำงานวันหยุดพร้อม Audit แล้ว');setHolidayWageTarget(null);await load()}
    setHolidayWageSaving(false)
  }
  const [reportYear,reportMonthNumber]=month.split('-').map(Number)
  const selectedPayPeriod=payPeriods.find(item=>item.id===periodId)??null
  const reportStartDate=selectedPayPeriod?.starts_on??`${month}-01`
  const reportEndDate=selectedPayPeriod?.ends_on??`${month}-${String(new Date(reportYear,reportMonthNumber,0).getDate()).padStart(2,'0')}`
  const reportPeriodLabel=selectedPayPeriod?`${selectedPayPeriod.name} · ${new Date(`${reportStartDate}T12:00:00+07:00`).toLocaleDateString('th-TH')}–${new Date(`${reportEndDate}T12:00:00+07:00`).toLocaleDateString('th-TH')} · จ่าย ${new Date(`${selectedPayPeriod.pay_date}T12:00:00+07:00`).toLocaleDateString('th-TH')} · ${selectedPayPeriod.status}`:`ทั้งเดือน ${new Date(`${month}-01T12:00:00+07:00`).toLocaleDateString('th-TH',{month:'long',year:'numeric'})}`
  const activeRows=rows.filter(row=>!['rejected','duplicate'].includes(row.status)),voidedRows=rows.filter(row=>row.status==='rejected')
  const filteredRows=activeRows.filter(row=>{const date=new Date(row.clock_in_at).toLocaleDateString('sv-SE',{timeZone:'Asia/Bangkok'});return date>=reportStartDate&&date<=reportEndDate&&(siteId==='all'||row.project_sites?.id===siteId)&&(employeeId==='all'||row.profile_id===employeeId)})
  const summaryProfileIds=Array.from(new Set([
    ...filteredRows.map(row=>row.profile_id),
    ...(siteId==='all'?employmentPolicies.filter(policy=>employeeId==='all'||policy.profile_id===employeeId).map(policy=>policy.profile_id):[]),
  ]))
  const monthlyScheduleProgress=(workPolicy:WorkPolicy|undefined)=>{
    const [year,monthNumber]=month.split('-').map(Number)
    const lastDay=new Date(year,monthNumber,0).getDate()
    const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Bangkok'})
    let scheduledDays=0,elapsedDays=0
    for(let day=1;day<=lastDay;day+=1){
      const date=`${year}-${String(monthNumber).padStart(2,'0')}-${String(day).padStart(2,'0')}`
      if(date<reportStartDate||date>reportEndDate)continue
      const weekday=new Date(`${date}T12:00:00+07:00`).getDay()||7
      if(holidays.some(item=>item.holiday_date===date)||(workPolicy&&!workPolicy.work_weekdays.includes(weekday)))continue
      scheduledDays+=1
      if(date<=today)elapsedDays+=1
    }
    return {scheduledDays:Math.max(1,scheduledDays),elapsedDays}
  }
  const employeeSummaries=summaryProfileIds.map(id=>{
    const list=filteredRows.filter(row=>row.profile_id===id)
    const policy=employmentPolicies.find(item=>item.profile_id===id)
    const workPolicy=workPolicies.find(item=>item.id===policy?.work_policy_id)??workPolicies[0]
    const standardMinutes=Math.max(1,Number(workPolicy?.standard_minutes??480))
    const valid=list.filter(row=>row.clock_out_at&&!['pending','needs_review'].includes(row.status))
    const worked=list.reduce((sum,row)=>sum+Number(row.worked_minutes??0),0)
    const normal=valid.reduce((sum,row)=>sum+Number(row.normal_minutes??0),0)
    const attendanceDays=new Set(list.map(row=>new Date(row.clock_in_at).toLocaleDateString('sv-SE',{timeZone:'Asia/Bangkok'}))).size
    const lateRows=valid.filter(row=>Number(row.late_minutes??0)>0)
    const earlyRows=valid.filter(row=>Number(row.early_leave_minutes??0)>0)
    const postShiftMinutes=(row:Row)=>row.clock_out_at&&row.scheduled_end_at?Math.max(0,Math.round((new Date(row.clock_out_at).getTime()-new Date(row.scheduled_end_at).getTime())/60000)):0
    const outsideRows=valid.filter(row=>postShiftMinutes(row)>0)
    const employeePayrolls=payrolls.filter(item=>item.profile_id===id)
    const payrollPay=employeePayrolls.reduce((sum,item)=>sum+Number(item.net_pay??0),0)
    const scheduleProgress=monthlyScheduleProgress(workPolicy)
    const dailyUnits=valid.reduce((sum,row)=>{const minutes=Number(row.worked_minutes??0);return sum+(minutes>=standardMinutes?1:minutes>=standardMinutes/2?0.5:0)},0)
    const monthlyAccrued=Number(policy?.monthly_salary??0)*scheduleProgress.elapsedDays/scheduleProgress.scheduledDays
    const estimatedBase=policy?.employment_type==='monthly'?monthlyAccrued:dailyUnits*Number(policy?.daily_rate??0)
    const estimatedOt=valid.reduce((sum,row)=>sum+Number(row.overtime_minutes??0),0)/60*Number(policy?.overtime_hourly_rate??0)
    const exempt=policy?.attendance_policy==='exempt'
    const employee=employees.find(item=>item.id===id)
    return {id,name:list[0]?.profiles?.full_name||list[0]?.profiles?.email||employee?.full_name||employee?.email||'-',employmentType:policy?.employment_type??'ไม่ระบุ',days:attendanceDays,netDays:policy?.employment_type==='monthly'?scheduleProgress.elapsedDays:dailyUnits,standardMinutes,open:list.filter(row=>!row.clock_out_at).length,worked,normal,outside:outsideRows.reduce((sum,row)=>sum+postShiftMinutes(row),0),outsideDays:new Set(outsideRows.map(row=>new Date(row.clock_in_at).toLocaleDateString('sv-SE',{timeZone:'Asia/Bangkok'}))).size,ot:valid.reduce((sum,row)=>sum+Number(row.overtime_minutes??0),0),late:lateRows.reduce((sum,row)=>sum+Number(row.late_minutes??0),0),lateDays:new Set(lateRows.map(row=>new Date(row.clock_in_at).toLocaleDateString('sv-SE',{timeZone:'Asia/Bangkok'}))).size,early:earlyRows.reduce((sum,row)=>sum+Number(row.early_leave_minutes??0),0),earlyDays:new Set(earlyRows.map(row=>new Date(row.clock_in_at).toLocaleDateString('sv-SE',{timeZone:'Asia/Bangkok'}))).size,estimatedPay:employeePayrolls.length?payrollPay:estimatedBase+estimatedOt,paySource:employeePayrolls.length?'Payroll':policy?.employment_type==='monthly'?`สะสม ${scheduleProgress.elapsedDays}/${scheduleProgress.scheduledDays} วันตามตาราง`:'ประมาณการจากวันสุทธิ',status:list.some(row=>!row.clock_out_at||['pending','needs_review'].includes(row.status))?'รอตรวจ':exempt?'ไม่บังคับลงเวลา':'พร้อม'} satisfies EmployeeSummary
  })
  const siteSummaries=sites.filter(site=>siteId==='all'||site.id===siteId).map(site=>{const list=filteredRows.filter(row=>row.project_sites?.id===site.id),worked=list.reduce((sum,row)=>sum+Number(row.worked_minutes??0),0),normal=list.reduce((sum,row)=>sum+Number(row.normal_minutes??0),0);return{id:site.id,name:`${site.projects?.name??''} · ${site.name}`,sessions:list.length,employees:new Set(list.map(row=>row.profile_id)).size,worked,normal,outside:Math.max(0,worked-normal),ot:list.reduce((sum,row)=>sum+Number(row.overtime_minutes??0),0),open:list.filter(row=>!row.clock_out_at).length} satisfies SiteSummary})
  const reviewRows=filteredRows.filter(row=>!row.clock_out_at||['pending','needs_review'].includes(row.status))
  const totalOt=filteredRows.reduce((sum,row)=>sum+Number(row.overtime_minutes??0),0)
  const totalNetDays=employeeSummaries.reduce((sum,row)=>sum+row.netDays,0)
  const totalLateDays=employeeSummaries.reduce((sum,row)=>sum+row.lateDays,0),totalLateMinutes=employeeSummaries.reduce((sum,row)=>sum+row.late,0)
  const totalEarlyDays=employeeSummaries.reduce((sum,row)=>sum+row.earlyDays,0),totalEarlyMinutes=employeeSummaries.reduce((sum,row)=>sum+row.early,0)
  const totalOutsideDays=employeeSummaries.reduce((sum,row)=>sum+row.outsideDays,0),totalOutsideMinutes=employeeSummaries.reduce((sum,row)=>sum+row.outside,0)
  const totalEstimatedPay=employeeSummaries.reduce((sum,row)=>sum+row.estimatedPay,0)
  const summaryPolicy=employmentPolicies.find(item=>item.profile_id===summaryTarget?.id),summaryWorkPolicy=workPolicies.find(item=>item.id===summaryPolicy?.work_policy_id)??workPolicies[0]
  const summaryPayrolls=payrolls.filter(item=>item.profile_id===summaryTarget?.id)
  const summaryHasPayroll=summaryPayrolls.length>0
  const summaryStandardMinutes=Math.max(1,Number(summaryWorkPolicy?.standard_minutes??480))
  const monthDays=(()=>{
    if(!summaryTarget)return[]
    const [year,monthNumber]=month.split('-').map(Number),last=new Date(year,monthNumber,0).getDate(),today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Bangkok'})
    const schedule=monthlyScheduleProgress(summaryWorkPolicy)
    const monthlyDailyRate=Number(summaryPolicy?.monthly_salary??0)/schedule.scheduledDays
    return Array.from({length:last},(_,index)=>{
      const date=`${year}-${String(monthNumber).padStart(2,'0')}-${String(index+1).padStart(2,'0')}`
      const dateValue=new Date(`${date}T12:00:00+07:00`),weekday=dateValue.getDay()||7
      const sessions=filteredRows.filter(row=>row.profile_id===summaryTarget.id&&new Date(row.clock_in_at).toLocaleDateString('sv-SE',{timeZone:'Asia/Bangkok'})===date)
      const session=sessions[0]
      const leave=leaves.find(row=>row.profile_id===summaryTarget.id&&['approved','used'].includes(row.status)&&date>=new Date(row.starts_at).toLocaleDateString('sv-SE',{timeZone:'Asia/Bangkok'})&&date<=new Date(row.ends_at).toLocaleDateString('sv-SE',{timeZone:'Asia/Bangkok'}))
      const sessionSiteIds=new Set(sessions.map(item=>item.project_sites?.id).filter((value):value is string=>Boolean(value)))
      const holiday=holidays.find(item=>item.holiday_date===date&&(!item.site_id||sessionSiteIds.has(item.site_id)))
      const weeklyHoliday=Boolean(summaryWorkPolicy&&!summaryWorkPolicy.work_weekdays.includes(weekday))
      const isHoliday=Boolean(holiday)||weeklyHoliday
      const holidayType:HolidayType=weeklyHoliday?'weekly_holiday':holiday?.site_id?'company_holiday':'traditional_holiday'
      const holidayName=holiday?.name??'วันหยุดตามตาราง'
      const scheduled=!isHoliday
      const review=sessions.some(item=>!item.clock_out_at||['pending','needs_review'].includes(item.status))
      // Recalculate from the current clock evidence so Admin time corrections
      // cannot leave stale stored worked_minutes driving the payable-day rule.
      const workedMinutes=sessions.reduce((sum,item)=>{
        if(!item.clock_out_at)return sum+Number(item.worked_minutes??0)
        const elapsed=Math.max(0,Math.round((new Date(item.clock_out_at).getTime()-new Date(item.clock_in_at).getTime())/60000))
        return sum+Math.max(0,elapsed-Number(item.excluded_minutes??0))
      },0)
      const lateMinutes=sessions.reduce((sum,item)=>sum+Number(item.late_minutes??0),0)
      const rawEarlyLeaveMinutes=sessions.reduce((sum,item)=>sum+Number(item.early_leave_minutes??0),0)
      const overtimeMinutes=sessions.reduce((sum,item)=>sum+Number(item.overtime_minutes??0),0)
      const postShiftMinutes=sessions.reduce((sum,item)=>sum+(item.clock_out_at&&item.scheduled_end_at?Math.max(0,Math.round((new Date(item.clock_out_at).getTime()-new Date(item.scheduled_end_at).getTime())/60000)):0),0)
      const siteLabel=Array.from(new Set(sessions.map(item=>item.project_sites?.name).filter(Boolean))).join(' + ')||'-'
      const firstClockIn=sessions.length?sessions.map(item=>item.clock_in_at).sort()[0]:null
      const lastClockOut=sessions.length&&sessions.every(item=>item.clock_out_at)?sessions.map(item=>item.clock_out_at as string).sort().at(-1)??null:null
      const hasAttendance=workedMinutes>0
      const calculatedDayUnits=date>today?0:summaryPolicy?.employment_type==='monthly'&&scheduled?1:summaryPolicy?.attendance_policy==='exempt'&&scheduled?1:review?0:workedMinutes>=summaryStandardMinutes?1:workedMinutes>=summaryStandardMinutes/2?0.5:0
      const wageOverride=wageDayOverrides.find(item=>item.profile_id===summaryTarget.id&&item.work_date===date)
      const dayUnits=wageOverride?Number(wageOverride.day_units):calculatedDayUnits
      const paidLeaveRatio=Number(leave?.leave_types?.paid_ratio??0)
      const payableUnits=leave?paidLeaveRatio:dayUnits
      const customDateTime=(time:string|null)=>time?new Date(`${date}T${time}+07:00`):null
      const policyDateTime=(time:string|undefined)=>time?new Date(`${date}T${time.slice(0,8)}+07:00`):null
      const scheduledStart=sessions.map(item=>item.scheduled_start_at).filter((value):value is string=>Boolean(value)).sort()[0]??policyDateTime(summaryWorkPolicy?.work_start_time)?.toISOString()??null
      const scheduledEnd=sessions.map(item=>item.scheduled_end_at).filter((value):value is string=>Boolean(value)).sort().at(-1)??policyDateTime(summaryWorkPolicy?.work_end_time)?.toISOString()??null
      const effectiveWorkday=calculateEffectiveWorkday({
        rawLateMinutes:lateMinutes,rawEarlyLeaveMinutes,rawPostShiftMinutes:postShiftMinutes,
        dayUnits:payableUnits,hasOverride:Boolean(wageOverride),overrideMode:wageOverride?.override_mode,
        scheduledStartAt:scheduledStart?new Date(scheduledStart):null,scheduledEndAt:scheduledEnd?new Date(scheduledEnd):null,
        clockInAt:firstClockIn?new Date(firstClockIn):null,clockOutAt:lastClockOut?new Date(lastClockOut):null,
        halfDayMinutes:Number(timeDisplaySettings.half_day_minutes??summaryStandardMinutes/2),
        graceMinutes:Number(summaryWorkPolicy?.grace_minutes??0),
        halfMorningEndAt:policyDateTime(summaryWorkPolicy?.break_start_time),halfAfternoonStartAt:policyDateTime(summaryWorkPolicy?.break_end_time),
        customStartAt:customDateTime(wageOverride?.effective_start_time??null),customEndAt:customDateTime(wageOverride?.effective_end_time??null),
      })
      const holidayWageOverride=holidayWageOverrides.find(item=>item.profile_id===summaryTarget.id&&item.work_date===date)
      const holidayWage=calculateHolidayWage({isHoliday,employmentType:summaryPolicy?.employment_type??'',workedMinutes:payableUnits*summaryStandardMinutes,standardMinutes:summaryStandardMinutes,dailyRate:Number(summaryPolicy?.daily_rate??0),monthlyDailyRate,approvedOvertimeMinutes:overtimeMinutes,overtimeHourlyRate:Number(summaryPolicy?.overtime_hourly_rate??0),multiplier:holidayWageOverride?.wage_multiplier??null,holidayOvertimeMinutes:holidayWageOverride?.holiday_overtime_minutes??null,reviewBlocked:review})
      const basePay=isHoliday?0:summaryPolicy?.employment_type==='monthly'?payableUnits*monthlyDailyRate:payableUnits*Number(summaryPolicy?.daily_rate??0)
      const holidayPay=isHoliday?holidayWage.holidayPay:0
      const overtimePay=isHoliday?0:review?0:overtimeMinutes/60*Number(summaryPolicy?.overtime_hourly_rate??0)
      const holidayOvertimePay=isHoliday?holidayWage.holidayOvertimePay:0
      let state='ยังไม่ถึงวัน'
      if(isHoliday&&hasAttendance)state=holidayWage.needsHolidayReview?`ทำงานวันหยุด · รอตรวจอัตรา · ${holidayName}`:`ทำงานวันหยุด ${holidayWage.multiplier} เท่า · ${holidayName}`
      else if(isHoliday)state=`วันหยุด · ${holidayName}`
      else if(leave)state=paidLeaveRatio>0?'ลาได้รับค่าจ้าง':'ลาไม่รับค่าจ้าง'
      else if(summaryPolicy?.attendance_policy==='exempt')state='ไม่ต้องลงเวลา'
      else if(session)state=review?'ข้อมูลไม่ครบ':dayUnits===1?'ทำงานเต็มวัน':dayUnits===.5?'ทำงานครึ่งวัน':'ไม่ถึงครึ่งวัน'
      else if(date<today)state='หยุด'
      else if(date===today)state='ยังไม่ลงเวลา'
      const audit=attendanceAudits.find(item=>sessions.some(sessionItem=>sessionItem.id===item.session_id)&&/admin_|repair_apply|correction/i.test(item.action))
      const dataSource=holidayWageOverride?'ปรับอัตราวันหยุดโดย Admin':wageOverride?'ปรับผลคิดวันโดย Admin':audit?'แก้ไขเวลาโดยผู้ดูแล':'ระบบ'
      const sourceReason=holidayWageOverride?`${holidayWageOverride.reason} · ${holidayWageOverride.profiles?.full_name||holidayWageOverride.profiles?.email||'Admin'} · ${new Date(holidayWageOverride.updated_at).toLocaleString('th-TH')}`:wageOverride?`${wageOverride.reason} · ${wageOverride.profiles?.full_name||wageOverride.profiles?.email||'Admin'} · ${new Date(wageOverride.updated_at).toLocaleString('th-TH')}`:audit?.reason??null
      const systemCondition=review?'ข้อมูลเวลาไม่ครบ':calculatedDayUnits===1?'ผ่านเกณฑ์เต็มวัน':calculatedDayUnits===0.5?(effectiveWorkday.resolved?'ผ่านเกณฑ์ครึ่งวัน':effectiveWorkday.reason??'ระบุช่วงครึ่งวันไม่ได้'):'ไม่ผ่านเกณฑ์ค่าจ้าง'
      const payAdjusted=Boolean(wageOverride)&&payableUnits!==calculatedDayUnits
      if(!effectiveWorkday.resolved)state=`รอตรวจ: ${effectiveWorkday.reason??'ระบุช่วงครึ่งวันไม่ได้'}`
      return {id:date,date,session,sessions,siteLabel,firstClockIn,lastClockOut,workedMinutes,lateMinutes:effectiveWorkday.lateMinutes,earlyLeaveMinutes:effectiveWorkday.earlyLeaveMinutes,rawEarlyLeaveMinutes,overtimeMinutes,postShiftMinutes:effectiveWorkday.postShiftMinutes,effectiveWorkday,state,systemCondition,payAdjusted,scheduled,review,calculatedDayUnits,dayUnits:payableUnits,basePay,holidayPay,overtimePay,holidayOvertimePay,holidayMultiplier:holidayWage.multiplier,needsHolidayReview:holidayWage.needsHolidayReview,netPay:basePay+holidayPay+overtimePay+holidayOvertimePay,dataSource,sourceReason,wageOverride,holidayWageOverride,holiday,isHoliday,holidayType}
    }).filter(row=>row.date>=reportStartDate&&row.date<=reportEndDate)
  })()
  const monthDayTotals=monthDays.reduce((sum,row)=>({
    worked:sum.worked+row.workedMinutes,
    late:sum.late+row.lateMinutes,
    lateDays:sum.lateDays+(row.lateMinutes>0?1:0),
    early:sum.early+row.earlyLeaveMinutes,
    earlyDays:sum.earlyDays+(row.earlyLeaveMinutes>0?1:0),
    outside:sum.outside+row.postShiftMinutes,
    units:sum.units+row.dayUnits,
    base:sum.base+row.basePay,
    holiday:sum.holiday+row.holidayPay,
    overtime:sum.overtime+row.overtimePay,
    holidayOvertime:sum.holidayOvertime+row.holidayOvertimePay,
    holidayDays:sum.holidayDays+(row.holiday&&row.dayUnits>0?row.dayUnits:0),
    holidayPending:sum.holidayPending+(row.needsHolidayReview?1:0),
    net:sum.net+row.netPay,
  }),{worked:0,late:0,lateDays:0,early:0,earlyDays:0,outside:0,units:0,base:0,holiday:0,overtime:0,holidayOvertime:0,holidayDays:0,holidayPending:0,net:0})
  const monthDayRowSx=(row:(typeof monthDays)[number])=>{
    if(row.state==='ทำงานเต็มวัน')return{backgroundColor:'#edf7ef','&:hover':{backgroundColor:'#e2f1e5'}}
    if(row.state==='ทำงานครึ่งวัน')return{backgroundColor:'#fff8df','&:hover':{backgroundColor:'#fff1bf'}}
    if(row.state==='หยุด')return{backgroundColor:'#f2f2f2',color:'text.secondary','&:hover':{backgroundColor:'#e8e8e8'}}
    if(row.state.startsWith('ทำงานวันหยุด'))return{backgroundColor:row.needsHolidayReview?'#fff8df':'#edf7ef','&:hover':{backgroundColor:row.needsHolidayReview?'#fff1bf':'#e2f1e5'}}
    if(row.state.startsWith('วันหยุด'))return{backgroundColor:'#f1effa','&:hover':{backgroundColor:'#e6e1f5'}}
    if(row.state.startsWith('ลาได้รับ'))return{backgroundColor:'#eaf5fb','&:hover':{backgroundColor:'#dceef8'}}
    if(row.state.startsWith('ลาไม่รับ')||row.state==='ไม่ถึงครึ่งวัน')return{backgroundColor:'#fdeeee','&:hover':{backgroundColor:'#f9dddd'}}
    if(row.state==='ข้อมูลไม่ครบ'||row.state==='ยังไม่ลงเวลา')return{backgroundColor:'#fff2e5','&:hover':{backgroundColor:'#ffe5cc'}}
    if(row.state==='ยังไม่ถึงวัน')return{backgroundColor:'#fafafa',color:'text.disabled','&:hover':{backgroundColor:'#f5f5f5'}}
    return{}
  }
  const printEmployeeDetail=()=>{
    if(!summaryTarget)return
    const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]??char))
    const printClass=(state:string)=>state==='ทำงานเต็มวัน'?'full':state==='ทำงานครึ่งวัน'?'half':state==='หยุด'?'stop':state.startsWith('วันหยุด')?'holiday':state.startsWith('ลาได้รับ')?'paid-leave':state.startsWith('ลาไม่รับ')||state==='ไม่ถึงครึ่งวัน'?'unpaid':state==='ข้อมูลไม่ครบ'||state==='ยังไม่ลงเวลา'?'review':state==='ยังไม่ถึงวัน'?'future':''
    const rowsHtml=monthDays.map(row=>`<tr class="${printClass(row.state)}"><td>${escape(new Date(`${row.date}T12:00:00+07:00`).toLocaleDateString('th-TH'))}</td><td>${escape(row.siteLabel)}${row.sessions.length>1?`<br><small>${row.sessions.length} ช่วง / หลายไซต์</small>`:''}</td><td>${escape(row.firstClockIn?`${new Date(row.firstClockIn).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})}–${row.lastClockOut?new Date(row.lastClockOut).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'}):'-'}`:'-')}</td><td>${escape(optionalCount(row.lateMinutes,'นาที'))}</td><td>${escape(optionalCount(row.earlyLeaveMinutes,'นาที'))}</td><td>${escape(optionalDuration(row.postShiftMinutes))}</td><td>${escape(row.dayUnits>0?`${row.dayUnits} วัน`:'-')}</td><td>${escape(optionalMoney(row.basePay))}</td><td>${escape(optionalMoney(row.overtimePay))}</td><td>${escape(optionalMoney(row.netPay))}</td><td>${escape(row.dataSource)}${row.sourceReason?`<br><small>${escape(row.sourceReason)}</small>`:''}</td><td>${escape(row.state)}</td></tr>`).join('')
    const reportWindow=window.open('','_blank')
    if(!reportWindow){setError('Browser บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต Pop-up แล้วลองใหม่');return}
    try{reportWindow.history.replaceState(null,'',`/print/employee-attendance-${encodeURIComponent(summaryTarget.id)}-${encodeURIComponent(month)}`)}catch{/* printable window remains available */}
    reportWindow.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>รายงานค่าแรง-${escape(summaryTarget.name)}-${escape(month)}</title><style>@page{size:A4 landscape;margin:10mm}body{font-family:Tahoma,"Noto Sans Thai",Arial,sans-serif;color:#333;font-size:10px}h1{font-size:18px;margin:4px 0}.employee{font-size:15px;font-weight:700;margin:6px 0}.meta{margin:8px 0;color:#555}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:10px 0}.card{border:1px solid #bbb;padding:7px}.card b{display:block;font-size:13px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #aaa;padding:4px;vertical-align:top}th{background:#f4e8e3}tr{break-inside:avoid}.full{background:#edf7ef}.half{background:#fff8df}.stop{background:#f2f2f2;color:#666}.holiday{background:#f1effa}.paid-leave{background:#eaf5fb}.unpaid{background:#fdeeee}.review{background:#fff2e5}.future{background:#fafafa;color:#aaa}</style></head><body><div>${escape(currentCompany?.company_name??'WisdomAI')}</div><h1>รายงานเวลาและค่าแรงรายบุคคล</h1><div class="employee">ชื่อพนักงาน: ${escape(summaryTarget.name)}</div><div class="meta">รหัสพนักงาน: ${escape(summaryTarget.id)} · ${escape(reportPeriodLabel)} · สร้างเมื่อ ${escape(new Date().toLocaleString('th-TH'))} · โดย ${escape(profile?.full_name??profile?.email??'-')}</div><div class="cards"><div class="card">วันค่าแรงสุทธิ<b>${escape(monthDayTotals.units?`${monthDayTotals.units.toLocaleString('th-TH',{maximumFractionDigits:2})} วัน`:'-')}</b></div><div class="card">ค่าแรงปกติ<b>${escape(optionalMoney(monthDayTotals.base))}</b></div><div class="card">เงิน OT<b>${escape(optionalMoney(monthDayTotals.overtime))}</b></div><div class="card">รวมเงินที่ได้<b>${escape(optionalMoney(monthDayTotals.net))}</b></div></div><table><thead><tr><th>วันที่</th><th>ไซต์</th><th>เข้า–ออก</th><th>สาย</th><th>ออกก่อน</th><th>ออกเกินกะ</th><th>ผลคิดวัน</th><th>ค่าแรงปกติ</th><th>OT อนุมัติ</th><th>สุทธิ</th><th>ที่มาข้อมูล</th><th>สถานะ/เหตุผล</th></tr></thead><tbody>${rowsHtml}</tbody></table><script>window.addEventListener('load',async()=>{if(document.fonts&&document.fonts.ready)await document.fonts.ready;window.print()})</script></body></html>`)
    reportWindow.document.close()
  }
  const projectEmployeeRows=siteAssignments.filter(item=>(siteId==='all'||item.site_id===siteId)&&(employeeId==='all'||item.profile_id===employeeId)).map(item=>{
    const assignmentSessions=activeRows.filter(row=>row.profile_id===item.profile_id&&row.project_sites?.id===item.site_id)
    const employeeSessions=activeRows.filter(row=>row.profile_id===item.profile_id)
    const attendanceDates=new Set(assignmentSessions.map(row=>new Date(row.clock_in_at).toLocaleDateString('sv-SE',{timeZone:'Asia/Bangkok'})))
    const totalActualDates=new Set(employeeSessions.map(row=>new Date(row.clock_in_at).toLocaleDateString('sv-SE',{timeZone:'Asia/Bangkok'})))
    const otherSiteDates=new Set(employeeSessions.filter(row=>row.project_sites?.id!==item.site_id).map(row=>new Date(row.clock_in_at).toLocaleDateString('sv-SE',{timeZone:'Asia/Bangkok'})))
    const policy=employmentPolicies.find(value=>value.profile_id===item.profile_id)
    const workPolicy=workPolicies.find(value=>value.id===policy?.work_policy_id)??workPolicies[0]
    const [year,monthNumber]=month.split('-').map(Number),lastDay=new Date(year,monthNumber,0).getDate()
    const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Bangkok'})
    let leaveDays=0,missingDays=0,scheduledWorkDays=0
    for(let day=1;day<=lastDay;day+=1){
      const date=`${year}-${String(monthNumber).padStart(2,'0')}-${String(day).padStart(2,'0')}`
      if(date<item.starts_on||date>(item.ends_on??'9999-12-31'))continue
      const weekday=new Date(`${date}T12:00:00+07:00`).getDay()||7
      if(policy?.attendance_policy==='exempt'||holidays.some(value=>value.holiday_date===date)||(workPolicy&&!workPolicy.work_weekdays.includes(weekday)))continue
      scheduledWorkDays+=1
      if(date>today)continue
      const onLeave=leaves.some(value=>value.profile_id===item.profile_id&&['approved','used'].includes(value.status)&&date>=new Date(value.starts_at).toLocaleDateString('sv-SE',{timeZone:'Asia/Bangkok'})&&date<=new Date(value.ends_at).toLocaleDateString('sv-SE',{timeZone:'Asia/Bangkok'}))
      if(onLeave)leaveDays+=1;else if(!attendanceDates.has(date))missingDays+=1
    }
    const workedMinutes=assignmentSessions.reduce((sum,row)=>sum+Number(row.worked_minutes??0),0)
    const verifiedMinutes=assignmentSessions.filter(row=>row.clock_out_at&&['normal','approved'].includes(row.status)).reduce((sum,row)=>sum+Number(row.normal_minutes??row.worked_minutes??0),0)
    const pendingMinutes=assignmentSessions.filter(row=>!row.clock_out_at||['pending','needs_review'].includes(row.status)).reduce((sum,row)=>sum+Number(row.normal_minutes??row.worked_minutes??0),0)
    const payroll=payrolls.find(value=>value.profile_id===item.profile_id)
    const employeePay=Number(payroll?.net_pay??(policy?.employment_type==='monthly'?policy.monthly_salary:attendanceDates.size*Number(policy?.daily_rate??0))??0)
    const allocation=siteCostAllocations.find(value=>value.profile_id===item.profile_id&&value.site_id===item.site_id)
    const standardMinutes=Math.max(1,scheduledWorkDays*Number(workPolicy?.standard_minutes??480))
    const monthlyBase=Number(policy?.monthly_salary??employeePay)
    const minuteRate=monthlyBase/standardMinutes
    const usesTimeCost=policy?.employment_type==='monthly'&&policy.attendance_policy!=='exempt'
    const allocatedCost=usesTimeCost?verifiedMinutes*minuteRate:allocation?.allocation_mode==='percent'?monthlyBase*Number(allocation.allocation_value)/100:allocation?.allocation_mode==='fixed_amount'?Number(allocation.allocation_value):0
    const pendingCost=usesTimeCost?pendingMinutes*minuteRate:0
    const unallocatedCost=usesTimeCost?Math.max(0,monthlyBase-allocatedCost-pendingCost):Math.max(0,monthlyBase-allocatedCost)
    const allocationLabel=allocation?allocation.allocation_mode==='percent'?`${allocation.allocation_value}%`:`${Number(allocation.allocation_value).toLocaleString('th-TH')} บาท`:'ยังไม่จัดสรร'
    const reviewCount=assignmentSessions.filter(row=>!row.clock_out_at||['pending','needs_review'].includes(row.status)).length
    const issue=!policy?'ไม่พบข้อมูลการจ้าง':policy.employment_type==='monthly'&&!policy.monthly_salary?'ยังไม่กำหนดเงินเดือน':policy.employment_type==='monthly'&&policy.attendance_policy==='exempt'&&!allocation?'พนักงานยกเว้นลงเวลา ยังไม่จัดสรรต้นทุน':reviewCount?'มีรายการรอตรวจ':missingDays&&policy.attendance_policy==='required'?'ไม่พบเวลาบางวัน':'-'
    return {id:`${item.profile_id}-${item.site_id}`,profileId:item.profile_id,siteId:item.site_id,employee:item.profiles?.full_name||item.profiles?.email||'-',site:`${item.project_sites?.projects?.name??''} · ${item.project_sites?.name??'-'}`,period:`${item.starts_on} – ${item.ends_on??'ไม่กำหนด'}`,employmentType:policy?.employment_type??'ไม่ระบุ',attendancePolicy:policy?.attendance_policy??'ไม่ระบุ',scheduledDays:scheduledWorkDays,attendanceDays:attendanceDates.size,totalActualDays:totalActualDates.size,otherSiteDays:otherSiteDates.size,leaveDays,missingDays,workedMinutes,verifiedMinutes,pendingMinutes,standardMinutes,employeePay,allocationLabel:usesTimeCost?'ตามเวลาที่ผ่านตรวจ':allocationLabel,allocatedCost,pendingCost,unallocatedCost,reviewCount,status:issue==='-'?'พร้อม':'ต้องตรวจ',issue} satisfies ProjectEmployeeSummary
  })
  const monthlyPilotRows=projectEmployeeRows.filter(row=>row.employmentType==='monthly')
  const monthlyPilotEmployees=new Set(monthlyPilotRows.map(row=>row.profileId)).size
  const monthlyPilotPay=Array.from(new Set(monthlyPilotRows.map(row=>row.profileId))).reduce((sum,profileId)=>sum+(monthlyPilotRows.find(row=>row.profileId===profileId)?.employeePay??0),0)
  const monthlyPilotAllocated=monthlyPilotRows.reduce((sum,row)=>sum+row.allocatedCost,0)
  const monthlyPilotPending=monthlyPilotRows.reduce((sum,row)=>sum+row.pendingCost,0)
  const monthlyPilotUnallocated=Math.max(0,monthlyPilotPay-monthlyPilotAllocated-monthlyPilotPending)
  return <Stack spacing={3}>
    <PageHeader title="รายงานเวลาทำงาน" description="รายคน · รายไซต์ · ขาด ลา มาสาย · ชั่วโมงปกติและ OT" action={<Stack direction="row" spacing={1}><Button onClick={()=>window.print()}>พิมพ์ / บันทึก PDF</Button>{isAdmin&&<Button variant="contained" startIcon={<AddOutlinedIcon/>} onClick={()=>openCreate()}>เพิ่มเวลาพนักงาน</Button>}</Stack>}/>
    {error&&<Alert severity="error">{error}</Alert>}{success&&<Alert severity="success">{success}</Alert>}
    <Paper variant="outlined" sx={{p:2}}><Stack direction={{xs:'column',md:'row'}} spacing={2}>
      <TextField type="month" label="เดือน" value={month} onChange={(e)=>{setMonth(e.target.value);setPeriodId('month')}} slotProps={{inputLabel:{shrink:true}}}/>
      <TextField select label="รอบรายงาน / รอบจ่าย" value={periodId} onChange={(e)=>setPeriodId(e.target.value)} sx={{minWidth:280}}><MenuItem value="month">ทั้งเดือน (มุมมองบริหาร)</MenuItem>{payPeriods.map(period=><MenuItem key={period.id} value={period.id}>{period.name} · {new Date(`${period.starts_on}T12:00:00+07:00`).toLocaleDateString('th-TH')}–{new Date(`${period.ends_on}T12:00:00+07:00`).toLocaleDateString('th-TH')}</MenuItem>)}</TextField>
      <TextField select label="ไซต์" value={siteId} onChange={(e)=>setSiteId(e.target.value)} sx={{minWidth:260}}><MenuItem value="all">ทุกไซต์</MenuItem>{sites.map((site)=><MenuItem key={site.id} value={site.id}>{site.projects?.name} · {site.name}</MenuItem>)}</TextField>
      <TextField select label="พนักงาน" value={employeeId} onChange={(e)=>setEmployeeId(e.target.value)} sx={{minWidth:260}}><MenuItem value="all">พนักงานทุกคน</MenuItem>{employees.map(employee=><MenuItem key={employee.id} value={employee.id}>{employee.full_name||employee.email}</MenuItem>)}</TextField>
      <Typography sx={{alignSelf:'center'}}>ช่วง: {reportPeriodLabel} · {filteredRows.length} รายการ</Typography>
    </Stack></Paper>
    <Paper variant="outlined" sx={{position:'sticky',top:64,zIndex:4,overflow:'hidden'}}><Tabs value={sheet} onChange={(_event,value)=>setSheet(value)} variant="scrollable" scrollButtons="auto" sx={{minHeight:44,'& .MuiTab-root':{minHeight:44,textTransform:'none'}}}>
      <Tab label="สรุปภาพรวม"/><Tab label="เวลารายวัน"/><Tab label="ขาด–ลา–สาย"/><Tab label={`รอตรวจ (${reviewRows.length})`}/><Tab label="รายไซต์"/><Tab label="ค่าจ้าง / Payslip"/><Tab label={`ซ่อมย้อนหลัง (${repairProposals.length})`}/>{isPlatformAdmin&&<Tab label={`ยกเลิกแล้ว (${voidedRows.length})`}/>} 
      <Tab label={`พนักงานประจำโครงการ (${projectEmployeeRows.length})`}/>
    </Tabs></Paper>
    {sheet===0&&<>
      <Box sx={{display:'grid',gridTemplateColumns:{xs:'repeat(2,1fr)',md:'repeat(4,1fr)'},gap:1.25}}>{[
        ['พนักงาน',optionalCount(employeeSummaries.length,'คน')],['รอตรวจ',optionalCount(reviewRows.length,'รายการ')],['วันสุทธิ',totalNetDays>0?`${totalNetDays.toLocaleString('th-TH',{maximumFractionDigits:2})} วัน`:'-'],['รอบรายงาน',selectedPayPeriod?.name??'ทั้งเดือน'],
        ['สาย',totalLateDays>0?`${totalLateDays} วัน · ${totalLateMinutes} นาที`:'-'],['ออกก่อน',totalEarlyDays>0?`${totalEarlyDays} วัน · ${totalEarlyMinutes} นาที`:'-'],['ออกเกิน',totalOutsideDays>0?`${totalOutsideDays} วัน · ${duration(totalOutsideMinutes)}`:'-'],['OT อนุมัติ',optionalDuration(totalOt)],
        ['ค่าแรง/เงินเดือนประมาณการ',optionalMoney(totalEstimatedPay)],
      ].map(([label,value])=><Paper key={String(label)} variant="outlined" sx={{p:1.5}}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant="h6" sx={{fontWeight:800}}>{value}</Typography></Paper>)}</Box>
      <StandardDataTable rows={employeeSummaries} getRowId={row=>row.id} getSearchText={row=>`${row.name} ${row.status}`} searchLabel="ค้นหาพนักงาน" emptyText="ไม่มีข้อมูล" exportFileName={`employee-summary-${month}`} exportTitle="สรุปเวลาและค่าจ้างพนักงาน" exportSubtitle={reportPeriodLabel} exportMeta={[{label:'ไซต์',value:siteId==='all'?'ทุกไซต์':sites.find(item=>item.id===siteId)?.name??'-'},{label:'พนักงาน',value:employeeId==='all'?'ทุกคน':employees.find(item=>item.id===employeeId)?.full_name??'-'}]} exportSummary={[{label:'พนักงาน',value:optionalCount(employeeSummaries.length,'คน')},{label:'วันสุทธิ',value:totalNetDays?`${totalNetDays.toLocaleString('th-TH',{maximumFractionDigits:2})} วัน`:'-'},{label:'ประมาณการค่าจ้าง',value:optionalMoney(totalEstimatedPay)}]} columns={[
        {id:'employee',label:'พนักงาน',render:r=><Button onClick={()=>setSummaryTarget(r)}>{r.name}</Button>,exportValue:r=>r.name},{id:'type',label:'ประเภท',render:r=>employmentTypeLabel[r.employmentType]??r.employmentType},{id:'days',label:'มาทำงาน',render:r=><Button onClick={()=>setSummaryTarget(r)}>{r.days>0?`${r.days} วัน`:'-'}</Button>,exportValue:r=>r.days?`${r.days} วัน`:'-'},{id:'netDays',label:'วันสุทธิ',render:r=><Button onClick={()=>setSummaryTarget(r)}><b>{r.netDays>0?`${r.netDays.toLocaleString('th-TH',{maximumFractionDigits:2})} วัน`:'-'}</b></Button>,exportValue:r=>r.netDays?`${r.netDays} วัน`:'-'},{id:'late',label:'สาย',render:r=><Button onClick={()=>setSummaryTarget(r)}>{r.lateDays>0?`${r.lateDays} วัน · ${r.late} นาที`:'-'}</Button>,exportValue:r=>r.lateDays?`${r.lateDays} วัน · ${r.late} นาที`:'-'},{id:'early',label:'ออกก่อน',render:r=><Button onClick={()=>setSummaryTarget(r)}>{r.earlyDays>0?`${r.earlyDays} วัน · ${r.early} นาที`:'-'}</Button>,exportValue:r=>r.earlyDays?`${r.earlyDays} วัน · ${r.early} นาที`:'-'},{id:'outside',label:'ออกเกิน',render:r=><Button onClick={()=>setSummaryTarget(r)}>{r.outsideDays>0?`${r.outsideDays} วัน · ${duration(r.outside)}`:'-'}</Button>,exportValue:r=>r.outsideDays?`${r.outsideDays} วัน · ${duration(r.outside)}`:'-'},{id:'ot',label:'OT อนุมัติ',render:r=><Button onClick={()=>setSummaryTarget(r)}>{optionalDuration(r.ot)}</Button>,exportValue:r=>optionalDuration(r.ot)},{id:'pay',label:'ค่าแรง / เงินเดือน',render:r=><Button onClick={()=>setSummaryTarget(r)} sx={{display:'block',textAlign:'left'}}><b>{optionalMoney(r.estimatedPay)}</b><Typography variant="caption" color="text.secondary" sx={{display:'block'}}>{r.paySource}</Typography></Button>,exportValue:r=>`${optionalMoney(r.estimatedPay)} · ${r.paySource}`},{id:'status',label:'สถานะ',render:r=><Chip size="small" color={r.status==='พร้อม'?'success':r.status==='รอตรวจ'?'warning':'default'} label={r.status}/>,exportValue:r=>r.status},
      ]}/>
    </>}
    {sheet===1&&<StandardDataTable rows={filteredRows} getRowId={(row)=>row.id} getSearchText={(row)=>`${row.profiles?.full_name} ${row.profiles?.email} ${row.project_sites?.name} ${row.status}`} searchLabel="ค้นหาพนักงาน ไซต์ หรือสถานะ" emptyText="ไม่มีข้อมูลในช่วงที่เลือก" exportFileName={`attendance-${month}`} columns={[
      {id:'date',label:'วันที่',render:(r)=>new Date(r.clock_in_at).toLocaleDateString('th-TH'),exportValue:(r)=>new Date(r.clock_in_at).toLocaleDateString('th-TH')},
      {id:'employee',label:'พนักงาน',render:(r)=>r.profiles?.full_name||r.profiles?.email||'-'},
      {id:'site',label:'ไซต์',render:(r)=>`${r.project_sites?.projects?.name??''} ${r.project_sites?.name??'-'}`},
      {id:'time',label:'เวลาจริง / กะ',render:(r)=><Stack spacing={.25}><Typography variant="body2">จริง {new Date(r.clock_in_at).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})} – {r.clock_out_at?new Date(r.clock_out_at).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'}):'-'}</Typography><Typography variant="caption" color="text.secondary">กะ {r.scheduled_start_at?new Date(r.scheduled_start_at).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'}):'-'} – {r.scheduled_end_at?new Date(r.scheduled_end_at).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'}):'-'}</Typography></Stack>},
      {id:'early',label:'มาก่อน / OT ก่อนกะ / ไม่นับ',render:(r)=><Stack spacing={.25}><Typography variant="body2">{duration(r.early_arrival_minutes)}</Typography><Typography variant="caption" color="success.main">OT {duration(r.pre_shift_overtime_minutes)}</Typography><Typography variant="caption" color="text.secondary">ไม่นับ {duration(r.excluded_minutes)}</Typography></Stack>},
      {id:'worked',label:'ทำงานจริง',render:(r)=>duration(r.worked_minutes)},{id:'normal',label:'ปกติ',render:(r)=>duration(r.normal_minutes)},{id:'outside',label:'นอกตาราง',render:(r)=>duration(Math.max(0,Number(r.worked_minutes??0)-Number(r.normal_minutes??0)))},
      {id:'ot',label:'OT อนุมัติ',render:(r)=>duration(r.overtime_minutes)},
      {id:'late',label:'สาย/ออกก่อน',render:(r)=>`${r.late_minutes}/${r.early_leave_minutes} นาที`},
      {id:'status',label:'สถานะ',render:(r)=>r.status},
      {id:'action',label:'จัดการ',render:(r)=>isAdmin?<Stack direction="row" spacing={.5}><Button size="small" startIcon={<EditOutlinedIcon/>} onClick={()=>openEdit(r)}>{r.clock_out_at?'แก้เวลา':'เติมเวลาออก'}</Button>{isPlatformAdmin&&<Button size="small" color="error" onClick={()=>{setRestoreMode(false);setVoidTarget(r);setVoidReason('')}}>ยกเลิกเคส</Button>}</Stack>:'-'},
    ]}/>} 
    {sheet===2&&<StandardDataTable rows={leaves.filter(row=>employeeId==='all'||row.profile_id===employeeId)} getRowId={row=>row.id} getSearchText={row=>`${row.profiles?.full_name} ${row.leave_types?.name_th} ${row.status}`} searchLabel="ค้นหาการลา" emptyText="ไม่มีรายการลาในเดือนนี้" exportFileName={`leave-${month}`} columns={[
      {id:'employee',label:'พนักงาน',render:r=>r.profiles?.full_name||r.profiles?.email||'-'},{id:'type',label:'ประเภท',render:r=>r.leave_types?.name_th||'-'},{id:'start',label:'เริ่ม',render:r=>new Date(r.starts_at).toLocaleString('th-TH')},{id:'end',label:'สิ้นสุด',render:r=>new Date(r.ends_at).toLocaleString('th-TH')},{id:'duration',label:'ระยะเวลา',render:r=>duration(r.requested_minutes)},{id:'paid',label:'ค่าจ้าง',render:r=>Number(r.leave_types?.paid_ratio??0)>0?'ได้รับค่าจ้าง':'ไม่รับค่าจ้าง'},{id:'status',label:'สถานะ',render:r=>r.status},{id:'reason',label:'เหตุผล',render:r=>r.reason},
    ]}/>} 
    {sheet===3&&<StandardDataTable rows={reviewRows} getRowId={row=>row.id} onRowClick={setDetailTarget} getSearchText={row=>`${row.profiles?.full_name} ${row.project_sites?.name} ${row.review_reason??''} ${row.review_category??''}`} searchLabel="ค้นหารายการรอตรวจ" emptyText="ไม่มีรายการรอตรวจ" exportFileName={`attendance-review-${month}`} columns={[
      {id:'date',label:'วันที่',render:r=>new Date(r.clock_in_at).toLocaleDateString('th-TH')},{id:'employee',label:'พนักงาน',render:r=>r.profiles?.full_name||r.profiles?.email||'-'},{id:'site',label:'ไซต์',render:r=>r.project_sites?.name||'-'},{id:'time',label:'เข้า–ออก',render:r=>`${new Date(r.clock_in_at).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})} – ${r.clock_out_at?new Date(r.clock_out_at).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'}):'ยังไม่ลงออก'}`},{id:'status',label:'ปัญหา',render:r=><Stack spacing={.25}><Typography variant="body2">{r.review_reason||(!r.clock_out_at?'ลืมลงเวลาออก':r.status)}</Typography>{r.review_category&&<Typography variant="caption" color="warning.main">{reviewCategoryLabel[r.review_category]||r.review_category}</Typography>}</Stack>},{id:'action',label:'จัดการ',render:r=><Stack direction="row" spacing={.5}><Button size="small" color="inherit" onClick={()=>setDetailTarget(r)}>ดูรายละเอียด</Button>{r.clock_out_at&&<Button size="small" color="success" onClick={()=>{setConfirmTarget(r);setConfirmReason('')}}>ยืนยันว่าถูกต้อง</Button>}<Button size="small" onClick={()=>openEdit(r)}>ตรวจ/แก้เวลา</Button>{isPlatformAdmin&&<Button size="small" color="error" onClick={()=>{setRestoreMode(false);setVoidTarget(r);setVoidReason('')}}>ยกเลิกเคส</Button>}</Stack>},
    ]}/>} 
    {sheet===4&&<StandardDataTable rows={siteSummaries} getRowId={row=>row.id} getSearchText={row=>row.name} searchLabel="ค้นหาไซต์" emptyText="ไม่มีข้อมูลไซต์" exportFileName={`site-workforce-${month}`} columns={[
      {id:'site',label:'ไซต์/โครงการ',render:r=>r.name},{id:'employees',label:'พนักงาน',render:r=>r.employees},{id:'sessions',label:'รายการ',render:r=>r.sessions},{id:'actual',label:'ทำงานจริง',render:r=>duration(r.worked)},{id:'normal',label:'ปกติ',render:r=>duration(r.normal)},{id:'outside',label:'นอกตาราง',render:r=>duration(r.outside)},{id:'ot',label:'OT',render:r=>duration(r.ot)},{id:'open',label:'รอตรวจ',render:r=>r.open},
    ]}/>} 
    {sheet===5&&<><Paper variant="outlined" sx={{mb:2}}><Tabs value={payTypeTab} onChange={(_,value)=>setPayTypeTab(value)} variant="scrollable" scrollButtons="auto" aria-label="แยกค่าจ้างตามประเภท"><Tab label="ภาพรวม"/><Tab label="รายวัน"/><Tab label="รายเดือน"/><Tab label="ชั่วคราว / ผู้รับเหมา"/><Tab label="อนุมัติ / จ่ายแล้ว"/></Tabs></Paper>
    {payTypeTab<4&&<RealtimePayrollForecast month={month} employeeId={employeeId} employmentTypes={payTypeTab===1?['daily']:payTypeTab===2?['monthly']:payTypeTab===3?['temporary','contractor']:undefined}/>} 
    {payTypeTab===4&&<Alert severity="info" sx={{mb:2}}>แสดงเฉพาะงวดที่อนุมัติ ปิดงวด รอจ่าย หรือจ่ายแล้ว ยอดในส่วนนี้เป็นหลักฐานงวดจริง ไม่ใช่ประมาณการ</Alert>}
    <StandardDataTable rows={payrolls.filter(row=>{
      if(employeeId!=='all'&&row.profile_id!==employeeId)return false
      const employmentType=employmentPolicies.find(policy=>policy.profile_id===row.profile_id)?.employment_type
      if(payTypeTab===1)return employmentType==='daily'
      if(payTypeTab===2)return employmentType==='monthly'
      if(payTypeTab===3)return employmentType==='temporary'||employmentType==='contractor'
      if(payTypeTab===4)return ['approved','closed','pending_payment','paid'].includes(row.status)
      return true
    })} getRowId={row=>row.id} getSearchText={row=>`${row.profiles?.full_name} ${row.pay_periods?.name} ${row.status}`} searchLabel="ค้นหาพนักงาน รอบ หรือสถานะ" emptyText={payTypeTab===4?'ยังไม่มีงวดที่อนุมัติหรือจ่ายแล้ว':'ยังไม่มีค่าจ้างสำหรับประเภทนี้ในเดือนนี้'} exportFileName={`payroll-${month}`} columns={[
      {id:'employee',label:'พนักงาน',render:r=>r.profiles?.full_name||r.profiles?.email||'-'},{id:'period',label:'รอบ',render:r=>r.pay_periods?.name||'-'},{id:'normal',label:'ชม.ปกติ',render:r=>duration(r.normal_minutes)},{id:'otHours',label:'OT',render:r=>duration(r.overtime_minutes)},{id:'base',label:'ค่าจ้าง',render:r=>Number(r.base_pay).toLocaleString('th-TH',{minimumFractionDigits:2})},{id:'otPay',label:'เงิน OT',render:r=>Number(r.overtime_pay).toLocaleString('th-TH',{minimumFractionDigits:2})},{id:'deduct',label:'หัก',render:r=>Number(r.deductions).toLocaleString('th-TH',{minimumFractionDigits:2})},{id:'net',label:'สุทธิ',render:r=><Typography sx={{fontWeight:800}}>{Number(r.net_pay).toLocaleString('th-TH',{minimumFractionDigits:2})}</Typography>},{id:'status',label:'สถานะ',render:r=>r.status},{id:'payslip',label:'Payslip',render:r=>r.employee_payslips?.[0]?.document_number||'-'},
    ]}/></>} 
    {sheet===7&&isPlatformAdmin&&<StandardDataTable rows={voidedRows} getRowId={row=>row.id} getSearchText={row=>`${row.profiles?.full_name} ${row.project_sites?.name}`} searchLabel="ค้นหาเคสที่ยกเลิก" emptyText="ไม่มีเคสที่ยกเลิก" exportFileName={`voided-attendance-${month}`} columns={[{id:'date',label:'วันที่',render:r=>new Date(r.clock_in_at).toLocaleString('th-TH')},{id:'employee',label:'พนักงาน',render:r=>r.profiles?.full_name||r.profiles?.email||'-'},{id:'site',label:'โครงการ/ไซต์',render:r=>`${r.project_sites?.projects?.name??''} · ${r.project_sites?.name??'-'}`},{id:'status',label:'สถานะ',render:()=> <Chip size="small" label="ยกเลิกแล้ว"/>},{id:'action',label:'จัดการ',render:r=><Button size="small" onClick={()=>{setRestoreMode(true);setVoidTarget(r);setVoidReason('')}}>กู้คืน</Button>}]}/>} 
    {sheet===6&&<><Paper variant="outlined" sx={{p:2}}><Stack direction={{xs:'column',md:'row'}} spacing={2} style={{alignItems:'center',justifyContent:'space-between'}}><Box><Typography sx={{fontWeight:800}}>ข้อเสนอซ่อมข้อมูลย้อนหลัง</Typography><Typography variant="body2" color="text.secondary">ตรวจชื่อพนักงาน ไซต์ และเวลาก่อน–หลัง แล้วระบุเหตุผลก่อนใช้จริง ระบบจะไม่แก้ต้นฉบับอัตโนมัติ</Typography></Box><Button variant="outlined" disabled={repairScanning} onClick={()=>void scanRepairs()}>{repairScanning?'กำลังตรวจ...':'ตรวจหาข้อมูลผิดปกติ'}</Button></Stack></Paper><StandardDataTable rows={repairProposals} getRowId={row=>row.id} getSearchText={row=>`${row.attendance_sessions?.profiles?.full_name} ${row.attendance_sessions?.project_sites?.name} ${row.issue_code}`} searchLabel="ค้นหาข้อเสนอซ่อมข้อมูล" emptyText="ไม่มีข้อเสนอซ่อมข้อมูลที่รออนุมัติ" exportFileName={`attendance-repair-${month}`} columns={[
      {id:'employee',label:'พนักงาน',render:r=>r.attendance_sessions?.profiles?.full_name||r.attendance_sessions?.profiles?.email||'-'},{id:'site',label:'ไซต์',render:r=>r.attendance_sessions?.project_sites?.name||'-'},{id:'clockIn',label:'เวลาเข้า',render:r=>r.attendance_sessions?new Date(r.attendance_sessions.clock_in_at).toLocaleString('th-TH'):'-'},{id:'before',label:'เวลาออกเดิม',render:r=>r.original_clock_out_at?new Date(r.original_clock_out_at).toLocaleString('th-TH'):'ไม่มีเวลาออก'},{id:'after',label:'เวลาออกที่เสนอ',render:r=>new Date(r.proposed_clock_out_at).toLocaleString('th-TH')},{id:'reason',label:'สาเหตุ',render:r=>r.explanation},{id:'action',label:'ตัดสินใจ',render:r=><Stack direction="row" spacing={.5}><Button size="small" onClick={()=>{setRepairDecision('apply');setRepairTarget(r);setRepairNote('')}}>ตรวจและใช้เวลา</Button><Button size="small" color="inherit" onClick={()=>{setRepairDecision('reject');setRepairTarget(r);setRepairNote('')}}>ไม่ใช้</Button></Stack>},
    ]}/></>}
    {sheet===(isPlatformAdmin?8:7)&&<><Alert severity="info">แสดงพนักงานที่ได้รับมอบหมายให้โครงการ เทียบกับเวลาที่ลงจริง วันลา วันที่ไม่พบการลงเวลา และค่าจ้างงวดปัจจุบัน คลิก “ดูรายวัน” เพื่อตรวจหลักฐานแต่ละวัน</Alert><StandardDataTable rows={projectEmployeeRows} getRowId={row=>row.id} getSearchText={row=>`${row.employee} ${row.site} ${row.status}`} searchLabel="ค้นหาพนักงาน โครงการ หรือสถานะ" emptyText="ไม่พบพนักงานที่ได้รับมอบหมายในช่วงเวลานี้" exportFileName={`project-employees-${month}`} columns={[
      {id:'employee',label:'พนักงาน',render:r=><Button onClick={()=>{setEmployeeId(r.profileId);setSiteId(r.siteId);setSheet(1)}}>{r.employee}</Button>,exportValue:r=>r.employee},
      {id:'site',label:'โครงการ / ไซต์',render:r=>r.site,exportValue:r=>r.site},
      {id:'period',label:'ช่วงมอบหมาย',render:r=>r.period},
      {id:'scheduled',label:'วันทำงานตามตาราง',render:r=>`${r.scheduledDays} วัน`},
      {id:'attendance',label:'ทำจริงโครงการนี้',render:r=>`${r.attendanceDays} วัน`},
      {id:'totalActual',label:'ทำจริงทั้งหมด',render:r=>`${r.totalActualDays} วัน`},
      {id:'otherSite',label:'ทำที่อื่น',render:r=><Typography color={r.otherSiteDays?'info.main':'text.primary'} sx={{fontWeight:r.otherSiteDays?700:400}}>{r.otherSiteDays} วัน</Typography>},
      {id:'leave',label:'ลา',render:r=>`${r.leaveDays} วัน`},
      {id:'missing',label:'ไม่พบเวลา',render:r=><Typography color={r.missingDays?'error.main':'success.main'} sx={{fontWeight:700}}>{r.missingDays} วัน</Typography>},
      {id:'worked',label:'ทำงานจริง',render:r=>duration(r.workedMinutes)},
      {id:'employment',label:'ประเภท / นโยบายเวลา',render:r=><Stack><Typography variant="body2">{employmentTypeLabel[r.employmentType]??r.employmentType}</Typography><Typography variant="caption" color="text.secondary">{attendancePolicyLabel[r.attendancePolicy]??r.attendancePolicy}</Typography></Stack>},
      {id:'employeePay',label:'เงินสุทธิงวดนี้ / ประมาณการ',render:r=>r.employeePay.toLocaleString('th-TH',{style:'currency',currency:'THB'})},
      {id:'allocation',label:'วิธีคำนวณ',render:r=><Stack><Typography variant="body2">{r.allocationLabel}</Typography>{r.employmentType==='monthly'&&r.attendancePolicy!=='exempt'&&<Typography variant="caption" color="text.secondary">ผ่านตรวจ {duration(r.verifiedMinutes)} / มาตรฐาน {duration(r.standardMinutes)}</Typography>}</Stack>},
      {id:'allocatedCost',label:'ต้นทุนผ่านตรวจ',render:r=><Typography sx={{fontWeight:800}}>{r.allocatedCost.toLocaleString('th-TH',{style:'currency',currency:'THB'})}</Typography>},
      {id:'pendingCost',label:'ต้นทุนรอตรวจ',render:r=>r.pendingCost.toLocaleString('th-TH',{style:'currency',currency:'THB'})},
      {id:'issue',label:'สิ่งที่ต้องตรวจ',render:r=>r.issue},
      {id:'review',label:'รอตรวจ',render:r=>r.reviewCount},
      {id:'status',label:'สถานะ',render:r=><Chip size="small" color={r.status==='พร้อม'?'success':r.status==='รอตรวจ'?'warning':'error'} label={r.status}/>},
      {id:'action',label:'รายละเอียด',render:r=><Button size="small" onClick={()=>{setEmployeeId(r.profileId);setSiteId(r.siteId);setSheet(1)}}>ดูรายวัน</Button>},
    ]}/></>}
    {sheet===(isPlatformAdmin?8:7)&&<Paper variant="outlined" sx={{p:2}}><Stack spacing={1}><Typography sx={{fontWeight:800}}>ทดลองคำนวณพนักงานรายเดือน — อ่านข้อมูลจริง ไม่บันทึกผล</Typography><Box sx={{display:'grid',gridTemplateColumns:{xs:'repeat(2,1fr)',md:'repeat(4,1fr)'},gap:1.25}}>{[
      ['พนักงานรายเดือน',`${monthlyPilotEmployees} คน`],
      ['เงินเดือน/สุทธิงวดนี้',monthlyPilotPay.toLocaleString('th-TH',{style:'currency',currency:'THB'})],
      ['ต้นทุนผ่านตรวจ',monthlyPilotAllocated.toLocaleString('th-TH',{style:'currency',currency:'THB'})],
      ['ต้นทุนรอตรวจ',monthlyPilotPending.toLocaleString('th-TH',{style:'currency',currency:'THB'})],
      ['ยังไม่จัดสรร',monthlyPilotUnallocated.toLocaleString('th-TH',{style:'currency',currency:'THB'})],
      ['ต้องตรวจ',`${monthlyPilotRows.filter(row=>row.issue!=='-').length} รายการ`],
    ].map(([label,value])=><Paper key={label} variant="outlined" sx={{p:1.25}}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography sx={{fontWeight:800}}>{value}</Typography></Paper>)}</Box><Alert severity="warning">ผลนี้เป็น Preview เท่านั้น ไม่แก้เวลา ไม่สร้าง Payroll/Payslip และไม่ลงบัญชี หากต้นทุนจัดสรรไม่เท่ากับเงินเดือนให้ตรวจสัดส่วนก่อนใช้งานจริง</Alert></Stack></Paper>}
    <Dialog open={Boolean(detailTarget)} onClose={()=>setDetailTarget(null)} fullWidth maxWidth="md">
      <DialogTitle>รายละเอียดรายการรอตรวจ</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{pt:1}}>
        {detailTarget&&<>
          <Alert severity="warning"><b>{detailTarget.review_category?reviewCategoryLabel[detailTarget.review_category]||detailTarget.review_category:'ต้องตรวจสอบ'}</b><br/>{detailTarget.review_reason||(!detailTarget.clock_out_at?'ไม่พบเวลาออก':'ระบบระบุให้ผู้ดูแลตรวจสอบ')}</Alert>
          <Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',md:'repeat(2,1fr)'},gap:1.5}}>
            {[
              ['พนักงาน',detailTarget.profiles?.full_name||detailTarget.profiles?.email||'-'],
              ['โครงการ / ไซต์',`${detailTarget.project_sites?.projects?.name??'-'} · ${detailTarget.project_sites?.name??'-'}`],
              ['เวลาเข้าจริง',new Date(detailTarget.clock_in_at).toLocaleString('th-TH')],
              ['เวลาออกจริง',detailTarget.clock_out_at?new Date(detailTarget.clock_out_at).toLocaleString('th-TH'):'ยังไม่มีเวลาออก'],
              ['ตารางกะ',detailTarget.scheduled_start_at&&detailTarget.scheduled_end_at?`${new Date(detailTarget.scheduled_start_at).toLocaleString('th-TH')} – ${new Date(detailTarget.scheduled_end_at).toLocaleString('th-TH')}`:'ไม่พบตารางกะ'],
              ['หมายเหตุ',detailTarget.note||'-'],
            ].map(([label,value])=><Paper key={label} variant="outlined" sx={{p:1.25}}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography sx={{fontWeight:700}}>{value}</Typography></Paper>)}
          </Box>
          <Typography sx={{fontWeight:800}}>หลักฐาน GPS</Typography>
          <Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',md:'repeat(2,1fr)'},gap:1.5}}>
            {[
              ['จุดเข้า',detailTarget.clock_in_latitude,detailTarget.clock_in_longitude,detailTarget.clock_in_accuracy_meters,detailTarget.clock_in_distance_meters],
              ['จุดออก',detailTarget.clock_out_latitude,detailTarget.clock_out_longitude,detailTarget.clock_out_accuracy_meters,detailTarget.clock_out_distance_meters],
            ].map(([label,lat,lng,accuracy,distance])=><Paper key={String(label)} variant="outlined" sx={{p:1.25}}><Typography sx={{fontWeight:700}}>{label}</Typography><Typography variant="body2">พิกัด: {lat==null||lng==null?'ไม่พบ':`${lat}, ${lng}`}</Typography><Typography variant="body2">ความแม่นยำ: {accuracy==null?'-':`±${Math.round(Number(accuracy))} ม.`} · ระยะจากไซต์: {distance==null?'-':`${Math.round(Number(distance))} ม.`}</Typography>{lat!=null&&lng!=null&&<Button size="small" href={`https://www.google.com/maps?q=${lat},${lng}`} target="_blank" rel="noreferrer">เปิดแผนที่</Button>}</Paper>)}
          </Box>
          <Typography sx={{fontWeight:800}}>อุปกรณ์และรูปยืนยัน</Typography>
          <Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',md:'repeat(2,1fr)'},gap:1.5}}>
            <Paper variant="outlined" sx={{p:1.25}}><Typography sx={{fontWeight:700}}>ตอนเข้า</Typography><Typography variant="body2" sx={{wordBreak:'break-word'}}>อุปกรณ์: {evidenceValue(detailTarget.clock_in_device_info)}</Typography><Typography variant="body2">Selfie: {detailTarget.clock_in_selfie_path?'มีหลักฐาน':'ไม่มีหลักฐาน'}</Typography></Paper>
            <Paper variant="outlined" sx={{p:1.25}}><Typography sx={{fontWeight:700}}>ตอนออก</Typography><Typography variant="body2" sx={{wordBreak:'break-word'}}>อุปกรณ์: {evidenceValue(detailTarget.clock_out_device_info)}</Typography><Typography variant="body2">Selfie: {detailTarget.clock_out_selfie_path?'มีหลักฐาน':'ไม่มีหลักฐาน'}</Typography></Paper>
          </Box>
        </>}
      </Stack></DialogContent>
      <DialogActions><Button onClick={()=>setDetailTarget(null)}>ปิด</Button>{detailTarget&&<Button onClick={()=>{openEdit(detailTarget);setDetailTarget(null)}}>แก้ไขเวลา</Button>}{detailTarget?.clock_out_at&&<Button color="success" variant="contained" onClick={()=>{setConfirmTarget(detailTarget);setConfirmReason('');setDetailTarget(null)}}>ยืนยันว่าถูกต้อง</Button>}{detailTarget&&isPlatformAdmin&&<Button color="error" onClick={()=>{setRestoreMode(false);setVoidTarget(detailTarget);setVoidReason('');setDetailTarget(null)}}>ยกเลิกเคส</Button>}</DialogActions>
    </Dialog>
    <Dialog open={Boolean(summaryTarget)} onClose={()=>setSummaryTarget(null)} fullWidth maxWidth="xl" slotProps={{paper:{sx:{height:{md:'calc(100vh - 48px)'},maxHeight:'calc(100vh - 32px)'}}}}>
      <DialogTitle sx={{py:1.25}}>รายละเอียดที่มาของยอด · {summaryTarget?.name}</DialogTitle>
      <DialogContent dividers sx={{px:{xs:1,md:1.5},py:1,'& .MuiTableCell-root':{px:.75,py:.65,fontSize:12},'& .MuiTableCell-head':{fontWeight:800,whiteSpace:'nowrap'}}}><Stack spacing={1}>
        {summaryTarget&&<Alert severity={summaryTarget.status==='พร้อม'?'success':'warning'}>มาทำงาน {summaryTarget.days} วัน · วันค่าแรงสุทธิ {summaryTarget.netDays.toLocaleString('th-TH',{maximumFractionDigits:2})} วัน · {summaryTarget.status} · {reportPeriodLabel}</Alert>}
        <Alert severity="info" icon={false} sx={{py:.25}}>รูปแบบที่ใช้: แสดงผลคิดวันเป็นข้อมูลหลัก · เวลาสุทธิเก็บอยู่ในหลักฐานเวลาเข้า–ออก · เกณฑ์เต็มวัน {timeDisplaySettings.full_day_minutes} นาที · เงินปัด 2 ตำแหน่ง</Alert>
        <Box sx={{display:'grid',gridTemplateColumns:{xs:'repeat(2,1fr)',md:'repeat(4,1fr)'},gap:.75}}>{[
          ['ประเภท',employmentTypeLabel[summaryPolicy?.employment_type??'']??'ยังไม่ระบุ'],
          ['อัตราค่าจ้าง',summaryPolicy?.employment_type==='monthly'?`${moneyText(Number(summaryPolicy.monthly_salary??0))}/เดือน`:`${moneyText(Number(summaryPolicy?.daily_rate??0))}/วัน`],
          ['วันค่าแรงสุทธิ',monthDayTotals.units?`${monthDayTotals.units.toLocaleString('th-TH',{maximumFractionDigits:2})} วัน`:'-'],
          ['ค่าจ้างปกติ',moneyText(monthDayTotals.base)],
          ['ทำงานวันหยุด',monthDayTotals.holidayDays?`${monthDayTotals.holidayDays} วัน · ${moneyText(monthDayTotals.holiday)}`:'-'],
          ['รอตรวจอัตราวันหยุด',monthDayTotals.holidayPending?`${monthDayTotals.holidayPending} รายการ`:'-'],
          ['เงิน OT',moneyText(monthDayTotals.overtime)],
          ['OT วันหยุด',moneyText(monthDayTotals.holidayOvertime)],
          ['รวมเงินที่ได้',moneyText(monthDayTotals.net)],
          ['สาย',monthDayTotals.lateDays?`${monthDayTotals.lateDays} วัน · ${monthDayTotals.late} นาที`:'-'],
          ['ออกก่อน',monthDayTotals.earlyDays?`${monthDayTotals.earlyDays} วัน · ${monthDayTotals.early} นาที`:'-'],
          ['ออกเกินกะ',optionalDuration(monthDayTotals.outside)],
          ['รอบรายงาน',reportPeriodLabel],
        ].map(([label,value])=><Paper key={label} variant="outlined" sx={{px:1,py:.65,minWidth:0}}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant="body2" sx={{fontWeight:800,overflowWrap:'anywhere'}}>{value}</Typography></Paper>)}</Box>
        {!summaryHasPayroll&&<Alert severity="info">ยอดนี้เป็นประมาณการ: {summaryPolicy?.employment_type==='monthly'?'เงินเดือนเฉลี่ยตามวันทำงานในตาราง สะสมถึงวันปัจจุบัน':`วันสุทธิ × ${Number(summaryPolicy?.daily_rate??0).toLocaleString('th-TH',{minimumFractionDigits:2})} บาท/วัน`} + OT ที่อนุมัติ × {Number(summaryPolicy?.overtime_hourly_rate??0).toLocaleString('th-TH',{minimumFractionDigits:2})} บาท/ชั่วโมง ยอดเต็มเดือนแสดงแยกในประมาณการสิ้นเดือน และยังไม่ใช่ Payslip</Alert>}
        <StandardDataTable rows={monthDays} getRowId={row=>row.id} getRowSx={monthDayRowSx} getExportRowTone={row=>row.state==='ทำงานเต็มวัน'||row.state.startsWith('ทำงานวันหยุด')&&!row.needsHolidayReview?'success':row.state==='ทำงานครึ่งวัน'||row.needsHolidayReview?'warning':row.state.startsWith('วันหยุด')?'holiday':row.state==='หยุด'?'muted':row.state==='ข้อมูลไม่ครบ'||row.state==='ไม่ถึงครึ่งวัน'?'danger':undefined} getSearchText={row=>`${row.siteLabel} ${row.state}`} searchLabel="ค้นหาวัน ไซต์ หรือสถานะ" emptyText="ไม่มีรายละเอียด" exportFileName={`employee-attendance-detail-${month}`} exportTitle={`รายงานเวลาและค่าแรงรายบุคคล · ${summaryTarget?.name??''}`} exportSubtitle={reportPeriodLabel} exportMeta={[{label:'รหัสพนักงาน',value:summaryTarget?.id??'-'},{label:'ประเภท',value:summaryTarget?employmentTypeLabel[summaryTarget.employmentType]??summaryTarget.employmentType:'-'},{label:'อัตราค่าจ้าง',value:summaryPolicy?.employment_type==='monthly'?`${moneyText(Number(summaryPolicy.monthly_salary??0))}/เดือน`:`${moneyText(Number(summaryPolicy?.daily_rate??0))}/วัน`}]} exportSummary={[{label:'วันค่าแรงสุทธิ',value:monthDayTotals.units?`${monthDayTotals.units} วัน`:'-'},{label:'วันทำงานวันหยุด',value:monthDayTotals.holidayDays?`${monthDayTotals.holidayDays} วัน`:'-'},{label:'สาย',value:monthDayTotals.lateDays?`${monthDayTotals.lateDays} วัน · ${monthDayTotals.late} นาที`:'-'},{label:'ออกก่อน',value:monthDayTotals.earlyDays?`${monthDayTotals.earlyDays} วัน · ${monthDayTotals.early} นาที`:'-'},{label:'ออกเกินกะ',value:optionalDuration(monthDayTotals.outside)},{label:'ค่าแรงปกติ',value:optionalMoney(monthDayTotals.base)},{label:'ค่าทำงานวันหยุด',value:optionalMoney(monthDayTotals.holiday)},{label:'เงิน OT',value:optionalMoney(monthDayTotals.overtime)},{label:'OT วันหยุด',value:optionalMoney(monthDayTotals.holidayOvertime)},{label:'ยอดสุทธิสะสม',value:optionalMoney(monthDayTotals.net)}]} columns={[
          {id:'date',label:'วันที่',render:r=>new Date(`${r.date}T12:00:00+07:00`).toLocaleDateString('th-TH'),exportValue:r=>new Date(`${r.date}T12:00:00+07:00`).toLocaleDateString('th-TH')},{id:'site',label:'ไซต์',render:r=><Stack><span>{r.siteLabel}</span>{r.sessions.length>1&&<Typography variant="caption" color="info.main">{r.sessions.length} ช่วง / หลายไซต์</Typography>}</Stack>,exportValue:r=>r.sessions.length>1?`${r.siteLabel} (${r.sessions.length} ช่วง)`:r.siteLabel},{id:'actual',label:'เข้า–ออกจริง',render:r=>r.firstClockIn?`${new Date(r.firstClockIn).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})} – ${r.lastClockOut?new Date(r.lastClockOut).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'}):'ยังไม่ลงออก'}`:'-',exportValue:r=>r.firstClockIn?`${new Date(r.firstClockIn).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})} – ${r.lastClockOut?new Date(r.lastClockOut).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'}):'ยังไม่ลงออก'}`:'-'},{id:'late',label:'สาย',render:r=>optionalCount(r.lateMinutes,'นาที'),exportValue:r=>optionalCount(r.lateMinutes,'นาที')},{id:'earlyLeave',label:'ออกก่อน',render:r=>optionalCount(r.earlyLeaveMinutes,'นาที'),exportValue:r=>optionalCount(r.earlyLeaveMinutes,'นาที')},{id:'outside',label:'ออกเกินกะ',render:r=>optionalDuration(r.postShiftMinutes),exportValue:r=>optionalDuration(r.postShiftMinutes)},{id:'dayUnits',label:'ผลคิดวัน',render:r=><Stack spacing={.25}><b>{r.review?'รอตรวจ':r.dayUnits>0?`${r.dayUnits} วัน`:'-'}</b>{r.wageOverride&&<Typography variant="caption" color="warning.main">ระบบเดิม {r.calculatedDayUnits} วัน</Typography>}</Stack>,exportValue:r=>r.review?'รอตรวจ':r.dayUnits?`${r.dayUnits} วัน`:'-'},{id:'basePay',label:'ค่าแรงปกติ',render:r=>optionalMoney(r.basePay),exportValue:r=>optionalMoney(r.basePay)},{id:'holidayPay',label:'ค่าทำงานวันหยุด',render:r=>r.holidayPay>0?<Stack spacing={.25}><b>{optionalMoney(r.holidayPay)}</b><Typography variant="caption">{r.holidayMultiplier} เท่า</Typography></Stack>:'-',exportValue:r=>r.holidayPay>0?`${optionalMoney(r.holidayPay)} · ${r.holidayMultiplier} เท่า`:'-'},{id:'otPay',label:'OT อนุมัติ',render:r=>optionalMoney(r.overtimePay),exportValue:r=>optionalMoney(r.overtimePay)},{id:'holidayOtPay',label:'OT วันหยุด',render:r=>optionalMoney(r.holidayOvertimePay),exportValue:r=>optionalMoney(r.holidayOvertimePay)},{id:'netPay',label:'สุทธิวันนี้',render:r=><b>{optionalMoney(r.netPay)}</b>,exportValue:r=>optionalMoney(r.netPay)},{id:'source',label:'ที่มาข้อมูล',render:r=><Stack spacing={.25}><Chip size="small" color={r.dataSource==='ระบบ'?'default':'warning'} label={r.dataSource}/>{r.sourceReason&&<Typography variant="caption" color="text.secondary">{r.sourceReason}</Typography>}</Stack>,exportValue:r=>`${r.dataSource}${r.sourceReason?` · ${r.sourceReason}`:''}`},{id:'status',label:'สถานะ/เหตุผล',render:r=><Chip size="small" color={r.state==='ทำงานเต็มวัน'||r.state.startsWith('ทำงานวันหยุด')&&!r.needsHolidayReview?'success':r.needsHolidayReview||r.state==='ข้อมูลไม่ครบ'||r.state==='ยังไม่ลงเวลา'?'warning':'default'} label={r.state}/>,exportValue:r=>r.state},{id:'manage',label:'จัดการ',exportable:false,render:r=>isAdmin&&r.session?<Stack direction="row" spacing={.5}><Button size="small" startIcon={<EditOutlinedIcon/>} onClick={()=>setWageOverrideTarget({date:r.date,calculatedUnits:r.calculatedDayUnits,currentUnits:r.dayUnits,reason:''})}>ปรับผลคิดวัน</Button>{r.isHoliday&&<Button size="small" color="warning" onClick={()=>setHolidayWageTarget({date:r.date,holidayType:r.holidayType,multiplier:r.holidayMultiplier,holidayOvertimeMinutes:r.overtimeMinutes,reason:''})}>อัตราวันหยุด</Button>}</Stack>:'-'},
        ]}/>
      </Stack></DialogContent>
      <DialogActions sx={{py:.75}}><Button onClick={()=>setSummaryTarget(null)}>ปิด</Button><Button onClick={printEmployeeDetail}>พิมพ์ / บันทึก PDF รายบุคคล</Button><Button variant="contained" onClick={()=>{if(summaryTarget)setEmployeeId(summaryTarget.id);setSheet(1);setSummaryTarget(null)}}>เปิดรายละเอียดรายวัน</Button></DialogActions>
    </Dialog>
    <Dialog open={Boolean(wageOverrideTarget)} onClose={()=>!wageOverrideSaving&&setWageOverrideTarget(null)} fullWidth maxWidth="sm">
      <DialogTitle>ปรับผลคิดวันค่าแรง</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{pt:1}}>
        <Alert severity="warning">แก้เฉพาะผลคิดค่าแรง ไม่เปลี่ยนเวลาเข้า–ออกหรือหลักฐานเดิม ระบบจะเก็บค่าเดิม ค่าใหม่ ผู้แก้ เวลา และเหตุผลทุกครั้ง</Alert>
        {wageOverrideTarget&&<Typography><b>วันที่:</b> {new Date(`${wageOverrideTarget.date}T12:00:00+07:00`).toLocaleDateString('th-TH')} · <b>ระบบคำนวณ:</b> {wageOverrideTarget.calculatedUnits} วัน</Typography>}
        <TextField select fullWidth label="ผลคิดวันที่ต้องการ" value={wageOverrideTarget?.currentUnits??0} onChange={event=>wageOverrideTarget&&setWageOverrideTarget({...wageOverrideTarget,currentUnits:Number(event.target.value)})}>
          <MenuItem value={0}>0 วัน — ไม่คิดค่าแรง</MenuItem><MenuItem value={0.5}>0.5 วัน — ครึ่งวัน</MenuItem><MenuItem value={1}>1 วัน — เต็มวัน</MenuItem>
        </TextField>
        <TextField select fullWidth label="ช่วงเวลามาตรฐานที่ใช้คำนวณ" value={wageOverrideTarget?.overrideMode??'auto'} onChange={event=>wageOverrideTarget&&setWageOverrideTarget({...wageOverrideTarget,overrideMode:event.target.value as WorkdayOverrideMode})} helperText="เวลาเข้า–ออกจริงยังเก็บเป็นหลักฐาน ส่วนสาย/ออกก่อน/ออกเกินกะจะคำนวณเทียบช่วงนี้">
          <MenuItem value="auto">อัตโนมัติตามผลคิดวัน</MenuItem>
          <MenuItem value="full_day">เต็มวันตามกะ</MenuItem>
          <MenuItem value="half_morning">ครึ่งวันเช้า</MenuItem>
          <MenuItem value="half_afternoon">ครึ่งวันบ่าย</MenuItem>
          <MenuItem value="custom_period">กำหนดช่วงเวลาเอง</MenuItem>
          <MenuItem value="wage_only">ปรับค่าแรงเท่านั้น (คงตัวชี้วัดเวลาเดิม)</MenuItem>
        </TextField>
        {wageOverrideTarget?.overrideMode==='custom_period'&&<Stack direction={{xs:'column',sm:'row'}} spacing={2}>
          <TextField fullWidth type="time" label="เริ่มช่วงที่มีผล" slotProps={{inputLabel:{shrink:true}}} value={wageOverrideTarget.effectiveStartTime??''} onChange={event=>setWageOverrideTarget({...wageOverrideTarget,effectiveStartTime:event.target.value})}/>
          <TextField fullWidth type="time" label="สิ้นสุดช่วงที่มีผล" slotProps={{inputLabel:{shrink:true}}} value={wageOverrideTarget.effectiveEndTime??''} onChange={event=>setWageOverrideTarget({...wageOverrideTarget,effectiveEndTime:event.target.value})}/>
        </Stack>}
        <TextField required multiline minRows={3} label="เหตุผลที่ปรับผลคิดวัน" value={wageOverrideTarget?.reason??''} onChange={event=>wageOverrideTarget&&setWageOverrideTarget({...wageOverrideTarget,reason:event.target.value})} helperText="อย่างน้อย 3 ตัวอักษร เช่น เครื่องจักรขัดข้องแต่หัวหน้างานอนุมัติจ่ายครึ่งวัน"/>
      </Stack></DialogContent>
      <DialogActions><Button disabled={wageOverrideSaving} onClick={()=>setWageOverrideTarget(null)}>ยกเลิก</Button><Button variant="contained" disabled={wageOverrideSaving||!wageOverrideTarget||wageOverrideTarget.reason.trim().length<3||(wageOverrideTarget.overrideMode==='custom_period'&&(!wageOverrideTarget.effectiveStartTime||!wageOverrideTarget.effectiveEndTime))} onClick={()=>void saveWageDayOverride()}>{wageOverrideSaving?'กำลังบันทึก...':'บันทึกพร้อม Audit'}</Button></DialogActions>
    </Dialog>
    <Dialog open={Boolean(holidayWageTarget)} onClose={()=>!holidayWageSaving&&setHolidayWageTarget(null)} fullWidth maxWidth="sm">
      <DialogTitle>ตรวจอัตราค่าทำงานวันหยุด</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{pt:1}}>
        <Alert severity="warning">ค่าเริ่มต้นแสดง 1 เท่าเพื่อไม่ให้วันทำงานหาย แต่รายการจะคงสถานะรอตรวจจน Admin ยืนยัน ระบบแยกค่าทำงานวันหยุดและ OT วันหยุด และเก็บผู้แก้ เวลา ค่าเดิม/ใหม่ และเหตุผลทุกครั้ง</Alert>
        {holidayWageTarget&&<Typography><b>วันที่:</b> {new Date(`${holidayWageTarget.date}T12:00:00+07:00`).toLocaleDateString('th-TH')} · <b>รอบ:</b> {reportPeriodLabel}</Typography>}
        <TextField select fullWidth label="ตัวคูณค่าทำงานวันหยุด" value={holidayWageTarget?.multiplier??1} onChange={event=>holidayWageTarget&&setHolidayWageTarget({...holidayWageTarget,multiplier:Number(event.target.value)})}>
          <MenuItem value={1}>1 เท่า — ค่าแรงปกติ</MenuItem><MenuItem value={1.5}>1.5 เท่า</MenuItem><MenuItem value={2}>2 เท่า</MenuItem><MenuItem value={3}>3 เท่า</MenuItem>
        </TextField>
        <TextField type="number" fullWidth label="นาที OT วันหยุดที่อนุมัติ" value={holidayWageTarget?.holidayOvertimeMinutes??0} onChange={event=>holidayWageTarget&&setHolidayWageTarget({...holidayWageTarget,holidayOvertimeMinutes:Math.max(0,Number(event.target.value))})}/>
        <TextField required multiline minRows={3} label="เหตุผลที่ยืนยัน/ปรับอัตรา" value={holidayWageTarget?.reason??''} onChange={event=>holidayWageTarget&&setHolidayWageTarget({...holidayWageTarget,reason:event.target.value})} helperText="อย่างน้อย 3 ตัวอักษร เช่น ยืนยันค่าแรงปกติ หรือ อนุมัติวันหยุด 2 เท่า"/>
      </Stack></DialogContent>
      <DialogActions><Button disabled={holidayWageSaving} onClick={()=>setHolidayWageTarget(null)}>ยกเลิก</Button><Button variant="contained" disabled={holidayWageSaving||!holidayWageTarget||holidayWageTarget.reason.trim().length<3||Boolean(selectedPayPeriod&&!['draft','open'].includes(selectedPayPeriod.status))} onClick={()=>void saveHolidayWageOverride()}>{holidayWageSaving?'กำลังบันทึก...':'ยืนยันพร้อม Audit'}</Button></DialogActions>
    </Dialog>
    <Dialog open={dialogOpen} onClose={()=>!saving&&setDialogOpen(false)} fullWidth maxWidth="md">
      <DialogTitle>{adjustment.sessionId?'แก้ไขเวลาพนักงาน':'เพิ่มเวลาพนักงานย้อนหลัง'}</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{pt:1}}>
        {error&&<Alert severity="error">{error}</Alert>}
        <Alert severity="info">ระบบจะตรวจวันซ้ำ รอบค่าจ้างที่ปิดแล้ว และบันทึกประวัติก่อน–หลังพร้อมชื่อ Admin</Alert>
        <Stack direction={{xs:'column',md:'row'}} spacing={2}>
          <TextField select fullWidth label="พนักงาน" value={adjustment.profileId} onChange={e=>setAdjustment({...adjustment,profileId:e.target.value})}>{employees.map(employee=><MenuItem key={employee.id} value={employee.id}>{employee.full_name||employee.email}</MenuItem>)}</TextField>
          <TextField select fullWidth label="ไซต์งาน" value={adjustment.siteId} onChange={e=>setAdjustment({...adjustment,siteId:e.target.value})}>{sites.map(site=><MenuItem key={site.id} value={site.id}>{site.projects?.name} · {site.name}</MenuItem>)}</TextField>
        </Stack>
        <Typography sx={{fontWeight:700}}>กำหนดวันที่และเวลา</Typography>
        <Stack direction={{xs:'column',md:'row'}} spacing={2}>
          <TextField fullWidth type="date" label="วันที่เข้า" value={adjustment.clockIn.slice(0,10)} onChange={e=>setAdjustment({...adjustment,clockIn:`${e.target.value}T${adjustment.clockIn.slice(11,16)||'08:00'}`,clockOutDate:adjustment.clockOutDate||e.target.value})} slotProps={{inputLabel:{shrink:true}}}/>
          <TextField fullWidth type="time" label="เวลาเข้า" value={adjustment.clockIn.slice(11,16)} onChange={e=>setAdjustment({...adjustment,clockIn:`${adjustment.clockIn.slice(0,10)}T${e.target.value}`})} slotProps={{inputLabel:{shrink:true}}}/>
          <TextField fullWidth type="date" label="วันที่ออก" value={adjustment.clockOutDate||adjustment.clockIn.slice(0,10)} onChange={e=>setAdjustment({...adjustment,clockOutDate:e.target.value,clockOut:adjustment.clockOut?`${e.target.value}T${adjustment.clockOut.slice(11,16)}`:''})} slotProps={{inputLabel:{shrink:true}}}/>
          <TextField fullWidth type="time" label="เวลาออก (เว้นว่างได้)" value={adjustment.clockOut.slice(11,16)} onChange={e=>setAdjustment({...adjustment,clockOut:e.target.value?`${adjustment.clockOutDate||adjustment.clockIn.slice(0,10)}T${e.target.value}`:''})} slotProps={{inputLabel:{shrink:true}}}/>
        </Stack>
        <Alert severity="info">กรณีลงเวลาเช้าไม่ได้ ให้ใส่วันที่เข้าและเวลาเข้า แล้วเว้น “เวลาออก” ว่างไว้ พนักงานสามารถลงเวลาออกเองภายหลังได้</Alert>
        <TextField required multiline minRows={3} label="เหตุผลที่เพิ่มหรือแก้ไข" value={adjustment.reason} onChange={e=>setAdjustment({...adjustment,reason:e.target.value})} helperText="เหตุผลนี้จะถูกเก็บในประวัติการตรวจสอบ"/>
      </Stack></DialogContent>
      <DialogActions><Button disabled={saving} onClick={()=>setDialogOpen(false)}>ยกเลิก</Button><Button variant="contained" disabled={saving||!adjustment.profileId||!adjustment.siteId||!adjustment.clockIn||adjustment.reason.trim().length<3} onClick={()=>void saveAdjustment()}>{saving?'กำลังบันทึก...':adjustment.clockOut?'บันทึกและคำนวณใหม่':'บันทึกเฉพาะเวลาเข้า'}</Button></DialogActions>
    </Dialog>
    <Dialog open={Boolean(confirmTarget)} onClose={()=>!confirmSaving&&setConfirmTarget(null)} fullWidth maxWidth="sm">
      <DialogTitle>ยืนยันว่าเวลาเข้า–ออกถูกต้อง</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{pt:1}}><Alert severity="warning">การยืนยันนี้จะคงเวลาเดิมไว้ อนุมัติให้คำนวณเวลาทำงาน และบันทึกชื่อผู้ยืนยันพร้อมเหตุผลใน Audit Log</Alert>{confirmTarget&&<Box><Typography><b>พนักงาน:</b> {confirmTarget.profiles?.full_name||confirmTarget.profiles?.email||'-'}</Typography><Typography><b>ไซต์:</b> {confirmTarget.project_sites?.name||'-'}</Typography><Typography><b>เวลา:</b> {new Date(confirmTarget.clock_in_at).toLocaleString('th-TH')} – {confirmTarget.clock_out_at?new Date(confirmTarget.clock_out_at).toLocaleString('th-TH'):'ยังไม่มีเวลาออก'}</Typography><Typography><b>เหตุผลที่ระบบส่งตรวจ:</b> {confirmTarget.review_reason||confirmTarget.status}</Typography></Box>}<TextField required multiline minRows={3} label="เหตุผลที่ยืนยันว่าถูกต้อง" value={confirmReason} onChange={event=>setConfirmReason(event.target.value)} helperText="ตัวอย่าง: ตรวจสอบกับหัวหน้างานและหลักฐานหน้างานแล้ว เวลาถูกต้อง"/></Stack></DialogContent>
      <DialogActions><Button disabled={confirmSaving} onClick={()=>setConfirmTarget(null)}>ปิด</Button><Button variant="contained" color="success" disabled={confirmSaving||confirmReason.trim().length<3} onClick={()=>void confirmTimeIsCorrect()}>{confirmSaving?'กำลังยืนยัน...':'ยืนยันและคำนวณใหม่'}</Button></DialogActions>
    </Dialog>
    <Dialog open={Boolean(repairTarget)} onClose={()=>!repairSaving&&setRepairTarget(null)} fullWidth maxWidth="sm">
      <DialogTitle>{repairDecision==='apply'?'ยืนยันใช้เวลาที่ระบบเสนอ':'ยืนยันไม่ใช้ข้อเสนอ'}</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{pt:1}}><Alert severity={repairDecision==='apply'?'warning':'info'}>{repairDecision==='apply'?'ระบบจะเปลี่ยนเวลาออก คำนวณเวลาทำงานใหม่ และบันทึก Audit Log':'เวลาต้นฉบับจะไม่ถูกเปลี่ยน และบันทึกเหตุผลที่ปฏิเสธไว้'}</Alert>{repairTarget&&<Box><Typography><b>พนักงาน:</b> {repairTarget.attendance_sessions?.profiles?.full_name||repairTarget.attendance_sessions?.profiles?.email||'-'}</Typography><Typography><b>ไซต์:</b> {repairTarget.attendance_sessions?.project_sites?.name||'-'}</Typography><Typography><b>เดิม:</b> {repairTarget.original_clock_out_at?new Date(repairTarget.original_clock_out_at).toLocaleString('th-TH'):'ไม่มีเวลาออก'}</Typography><Typography><b>เสนอ:</b> {new Date(repairTarget.proposed_clock_out_at).toLocaleString('th-TH')}</Typography></Box>}<TextField required multiline minRows={3} label="เหตุผลการตัดสินใจ" value={repairNote} onChange={event=>setRepairNote(event.target.value)} helperText="อย่างน้อย 3 ตัวอักษร และจะถูกเก็บใน Audit Log"/></Stack></DialogContent>
      <DialogActions><Button disabled={repairSaving} onClick={()=>setRepairTarget(null)}>ปิด</Button><Button variant="contained" color={repairDecision==='apply'?'primary':'inherit'} disabled={repairSaving||repairNote.trim().length<3} onClick={()=>void decideRepair()}>{repairSaving?'กำลังบันทึก...':repairDecision==='apply'?'ยืนยันใช้และคำนวณใหม่':'ยืนยันไม่ใช้'}</Button></DialogActions>
    </Dialog>
    <Dialog open={Boolean(voidTarget)} onClose={()=>!voidSaving&&setVoidTarget(null)} fullWidth maxWidth="sm">
      <DialogTitle>{restoreMode?'กู้คืนเคสลงเวลา':'ยกเลิกเคสลงเวลา'}</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{pt:1}}>
        <Alert severity={restoreMode?'info':'warning'}>{restoreMode?'รายการจะกลับเข้าสถานะรอตรวจและต้องตรวจสอบก่อนนำไปคำนวณ':'รายการจะหายจากงานปัจจุบันและไม่ถูกคำนวณค่าจ้าง แต่หลักฐานและ Audit Log จะไม่ถูกลบ'}</Alert>
        <Typography>{voidTarget?.profiles?.full_name||voidTarget?.profiles?.email} · {voidTarget?new Date(voidTarget.clock_in_at).toLocaleString('th-TH'):''}</Typography>
        <TextField required multiline minRows={3} label="เหตุผล" value={voidReason} onChange={event=>setVoidReason(event.target.value)} helperText="ต้องระบุอย่างน้อย 3 ตัวอักษร"/>
      </Stack></DialogContent>
      <DialogActions><Button disabled={voidSaving} onClick={()=>setVoidTarget(null)}>ปิด</Button><Button color={restoreMode?'primary':'error'} variant="contained" disabled={voidSaving||voidReason.trim().length<3} onClick={()=>void manageSoftDelete()}>{voidSaving?'กำลังบันทึก...':restoreMode?'ยืนยันกู้คืน':'ยืนยันยกเลิกเคส'}</Button></DialogActions>
    </Dialog>
  </Stack>
}
