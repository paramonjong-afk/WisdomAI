import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import ErrorRoundedIcon from '@mui/icons-material/ErrorRounded'
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined'
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import { Alert, Box, Button, Chip, Dialog, DialogContent, DialogTitle, Divider, Drawer, IconButton, LinearProgress, MenuItem, Paper, Stack, Switch, Tab, Tabs, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
import { releaseInfo, releaseLabel } from '../../lib/releaseInfo'
import { runWithMutationAttempt } from '../../utils/mutationAttemptRunner'
import { userError } from '../../utils/userError'

type HealthStatus='healthy'|'warning'|'critical'|'unknown'
type Settings={enabled:boolean;line_group_id:string|null;responsible_name:string|null;check_interval_minutes:number;alert_after_failures:number;repeat_alert_minutes:number;daily_summary_time:string}
type Check={check_key:string;name_th:string;module:string;status:HealthStatus;message:string|null;latency_ms:number|null;last_checked_at:string|null;metadata:Record<string,unknown>|null}
type Incident={id:string;check_key:string;severity:'warning'|'critical';title:string;status:'open'|'resolved';message:string|null;started_at:string;resolved_at:string|null}
type ErrorEvent={id:string;fingerprint:string;severity:'warning'|'error'|'critical';status:'open'|'monitoring'|'resolved'|'dismissed';title:string;message:string|null;affected_module:string|null;occurrence_count:number;system_occurrence_count:number;user_report_count:number;first_seen_at:string;last_seen_at:string;resolution_reason:string|null;resolved_at:string|null;last_evidence_message_id:string|null}
type ErrorEvidence={messageId:string;attachmentId:string;bucket:string;path:string;contentType:string|null}
type ErrorStatistics={open_incidents:number;critical_open:number;incidents_24h:number;incidents_7d:number;system_occurrences:number;user_confirmations:number;repeated_incidents:number;affected_modules:number;generated_at:string|null}
type ImageStorageRow={retention_class:'temporary'|'work_evidence'|'system_error'|'financial'|'audit';file_count:number;stored_bytes:number;reclaimable_duplicate_bytes:number;oldest_file_at:string|null;newest_file_at:string|null}
type ImageOptimizationProgress={total_images:number;optimized_images:number;kept_original_images:number;failed_images:number;pending_images:number;storage_bytes_saved:number;last_optimized_at:string|null}
type Group={line_group_id:string;display_name:string|null}
type Run={id:string;status:string;healthy_count:number;warning_count:number;critical_count:number;started_at:string;finished_at:string|null;error_message:string|null}
type CommunicationEvent={event_id:string;company_id:string|null;occurred_at:string;channel:string;event_type:string;status:string;title:string|null;message:string|null;destination:string|null;source_type:string;source_id:string;actor_profile_id:string|null;related_profile_id:string|null;related_work_key:string|null;error_message:string|null;responded_at:string|null}
type PerformanceMetric={id:string;page_path:string|null;severity:'info'|'warning'|'error';message:string|null;metadata:Record<string,unknown>|null;created_at:string}
type WorkItem={id:string;title:string;category:'automation'|'line'|'report'|'audit'|'tenant'|'operations';status:'ready'|'doing'|'review'|'done'|'blocked';progress:number;risk:'low'|'medium'|'high'|'critical';production:string;detail:string;errorFingerprint?:string|null;evidence?:string|null;currentStep?:string|null;owner?:string|null;createdAt?:string;updatedAt?:string}
type WorkItemRow={work_key:string;title:string;category:WorkItem['category'];status:WorkItem['status'];progress:number;risk:WorkItem['risk'];production_status:string;detail:string|null;error_fingerprint:string|null;evidence:string|null;current_step:string|null;owner:string|null;created_at:string;updated_at:string}
type ProblemStatus='pending'|'repairing'|'verification'|'stuck'|'resolved'
type ProblemRow={id:string;source:'error'|'monitor'|'work';sourceId:string;reference:string;title:string;detail:string;status:ProblemStatus;severity:'low'|'medium'|'high'|'critical';owner:string|null;fingerprint:string|null;firstSeen:string;lastSeen:string;resolution:string|null}
type WorkStatusTab='all'|'ready'|'doing'|'approval'|'review'|'blocked'|'done'
type WorkCategoryFilter='all'|WorkItem['category']
type MainTab='overview'|'usage'|'work'|'issues'|'logs'|'settings'
type StaleAttendanceSession={session_id:string;company_id:string;company_name:string|null;profile_id:string;employee_name:string|null;employee_code:string|null;project_name:string|null;site_name:string|null;clock_in_at:string;open_minutes:number;status:string}
type AuditAction=
  | {kind:'work';item:WorkItem;approved:boolean}
  | {kind:'error';row:ProblemRow;status:'resolved'|'dismissed'}

const initial:Settings={enabled:true,line_group_id:null,responsible_name:'',check_interval_minutes:5,alert_after_failures:2,repeat_alert_minutes:30,daily_summary_time:'08:00'}
const initialErrorStatistics:ErrorStatistics={open_incidents:0,critical_open:0,incidents_24h:0,incidents_7d:0,system_occurrences:0,user_confirmations:0,repeated_incidents:0,affected_modules:0,generated_at:null}
const statusColor:Record<HealthStatus,'success'|'warning'|'error'|'default'>={healthy:'success',warning:'warning',critical:'error',unknown:'default'}
const statusLabel:Record<HealthStatus,string>={healthy:'ปกติ',warning:'เฝ้าระวัง',critical:'ขัดข้อง',unknown:'ยังไม่ตรวจ'}
const statusHex:Record<HealthStatus,string>={healthy:'#2e7d32',warning:'#ed6c02',critical:'#d32f2f',unknown:'#8a8a8a'}
const flowOrder=['line_pipeline','line_webhook','database','attendance','notification']
const formatDate=(value:string|null)=>value?new Date(value).toLocaleString('th-TH'):'-'
const readableCheckMessage=(value:unknown,fallback:string)=>{
  if(typeof value==='string'&&value.trim()&&value.trim()!=='[object Object]')return value
  if(value&&typeof value==='object'){
    const record=value as Record<string,unknown>
    const parts=[record.code,userError(record),record.details,record.hint].filter(part=>typeof part==='string'&&part.trim())
    if(parts.length)return parts.join(' · ')
    try{return JSON.stringify(record)}catch{return fallback}
  }
  return fallback
}
const checkDiagnosis=(check:Check)=>{
  if(check.check_key==='employee_readiness')return {
    cause:check.status==='critical'?'ระบบอ่านข้อมูลความพร้อมพนักงานของบริษัทนี้ไม่สำเร็จ':'พบพนักงานที่ข้อมูลก่อนลงเวลายังไม่ครบ',
    impact:check.status==='critical'?'ยังสรุปไม่ได้ว่าพนักงานคนใดพร้อมลงเวลา แต่ไม่ได้ลบหรือเปลี่ยนข้อมูลลงเวลา':'พนักงานที่ข้อมูลไม่ครบอาจลงเวลาไม่ได้หรือถูกส่งให้ตรวจสอบ',
    resolution:check.status==='critical'?'ตรวจ Tenant View, สิทธิ์บริษัท และโครงสร้างข้อมูล แล้วกดตรวจใหม่':'เปิดหน้ากำหนดเวลางานและระบบ OT เพื่อตรวจข้อมูลจ้างงาน ตารางเวลา และไซต์',
    confidence:check.status==='critical'?'ยืนยันจากผลตรวจระบบ':'ยืนยันจากจำนวนรายการ',
  }
  return {cause:check.status==='critical'?'การตรวจระบบตอบกลับด้วยข้อผิดพลาด':'ค่าที่ตรวจเกินเกณฑ์เฝ้าระวัง',impact:'โมดูลนี้อาจให้ข้อมูลไม่ครบหรือทำงานช้ากว่าปกติ',resolution:'เปิดข้อมูลเทคนิค ตรวจโมดูลที่เกี่ยวข้อง แล้วกดตรวจใหม่หลังแก้ไข',confidence:'วิเคราะห์จากผลตรวจล่าสุด'}
}
const formatDuration=(minutes:number)=>`${Math.floor(Math.max(0,minutes)/60)} ชม. ${Math.max(0,minutes)%60} นาที`
const legacyWorkItems:WorkItem[]=[
  {id:'SYS-001',title:'หน้า Status แบบกราฟิก',category:'report',status:'review',progress:90,risk:'low',production:'Deploy แล้ว',detail:'รอผู้ใช้ตรวจหน้าจริงและยืนยันการแสดงผล'},
  {id:'SYS-002',title:'Scheduled Monitor เบื้องหลัง 24 ชั่วโมง',category:'automation',status:'ready',progress:25,risk:'high',production:'ยังไม่ Deploy',detail:'ต้องตรวจได้แม้ไม่มี Admin เปิดเว็บและไม่เปิดเผย Secret'},
  {id:'SYS-003',title:'LINE heartbeat ตรวจกรณีส่งแล้วเงียบ',category:'line',status:'ready',progress:20,risk:'medium',production:'ยังไม่ Deploy',detail:'เพิ่มเวลารับ Event และเวลาตอบกลับล่าสุด พร้อมแจ้งเตือนตาม Config'},
  {id:'SYS-004',title:'ตรวจจับ Error ทุกทางและสร้างงานแก้ไขอัตโนมัติ',category:'automation',status:'doing',progress:35,risk:'medium',production:'กำลังพัฒนา',detail:'ครอบคลุม Frontend, API, Edge, LINE, Database, Workflow และ Deploy พร้อม fingerprint, AI วิเคราะห์, SLA และวงจรแก้ไขครบขั้นตอน'},
  {id:'SYS-005',title:'ศูนย์สั่งงานผ่านมือถือและคอมพิวเตอร์',category:'report',status:'ready',progress:10,risk:'medium',production:'ยังไม่ Deploy',detail:'สร้างคำสั่งเป็นงานค้าง ติดตามความก้าวหน้า อนุมัติงานเสี่ยง และเก็บประวัติ'},
  {id:'SYS-006',title:'ตรวจงานกำลังทำและงานค้างด้วย Worker heartbeat',category:'automation',status:'ready',progress:10,risk:'medium',production:'ยังไม่ Deploy',detail:'แสดงขั้นตอนล่าสุด heartbeat รอบถัดไป elapsed time และแจ้งเมื่องานหยุดหรือเกิน timeout'},
  {id:'SYS-007',title:'ส่งรายงาน Status เข้ากลุ่ม LINE ทดสอบโปรแกรม',category:'line',status:'review',progress:90,risk:'medium',production:'Deploy แล้ว',detail:'รายงานทุกงานพร้อมเปอร์เซ็นต์ งานรออนุมัติ บันทึกประวัติ และป้องกันการส่งซ้ำภายใน 5 นาที'},
  {id:'SYS-008',title:'ศูนย์สั่งงานผ่าน LINE และ Voice',category:'line',status:'review',progress:90,risk:'high',production:'Deploy แล้ว',detail:'รับข้อความและเสียง ถอดเสียงด้วย AI ทวนคำสั่ง ตรวจสิทธิ์ ขออนุมัติงานเสี่ยง และจัดคิวตามความสำคัญแล้ว รอทดสอบ Voice จริงจาก LINE'},
  {id:'SYS-013',title:'Unified Voice, Chat & Codex Approval Command Center',category:'automation',status:'ready',progress:0,risk:'high',production:'ยังไม่ Deploy',detail:'รวม Web Chat, คำสั่งเสียง, Telegram และ LINE เข้าคิว Work Item เดียว เชื่อม Codex Worker สำหรับวิเคราะห์ แก้ Code และทดสอบ โดยงาน Security, Migration และ Production ต้องให้เจ้าของระบบอนุมัติและ Codex ห้ามอนุมัติตัวเอง'},
  {id:'OPS-001',title:'บันทึกงานยืนยันลง List และรายงาน Status',category:'report',status:'done',progress:100,risk:'low',production:'ใช้งานแล้ว',detail:'Automation และรายการงานใช้ workflow เดียวกัน'},
]
const riskLabel={low:'ต่ำ',medium:'กลาง',high:'สูง',critical:'วิกฤต'} as const
const problemStatusLabel:Record<ProblemStatus,string>={pending:'ค้างรอดำเนินการ',repairing:'กำลังแก้ไข',verification:'รอตรวจผล',stuck:'ติดปัญหา',resolved:'แก้ไขแล้ว'}
const problemStatusColor:Record<ProblemStatus,'info'|'warning'|'secondary'|'error'|'success'>={pending:'info',repairing:'warning',verification:'secondary',stuck:'error',resolved:'success'}

const displayStatusLabel:Record<Exclude<WorkStatusTab,'all'>,string>={ready:'ต้องดำเนินการ',doing:'กำลังทำ',approval:'รออนุมัติ',review:'รอตรวจ',blocked:'ติดปัญหา',done:'เสร็จแล้ว'}
const displayStatusColor:Record<Exclude<WorkStatusTab,'all'>,'info'|'warning'|'secondary'|'error'|'success'>={ready:'info',doing:'warning',approval:'warning',review:'secondary',blocked:'error',done:'success'}
const categoryLabel:Record<WorkCategoryFilter,string>={all:'ทุกประเภท',automation:'ระบบอัตโนมัติ',line:'LINE / Telegram',report:'หน้าจอและรายงาน',tenant:'หลายบริษัทและสิทธิ์',audit:'ตรวจสอบระบบ',operations:'งานดำเนินการ'}
const getDisplayStatus=(item:WorkItem):Exclude<WorkStatusTab,'all'>=>item.status==='review'&&item.production.toLowerCase().includes('awaiting_approval')?'approval':item.status
const productionLabel=(value:string)=>{
  const normalized=value.toLowerCase()
  if(normalized.includes('awaiting_approval'))return 'Production: รออนุมัติ'
  if(normalized.includes('not_deploy')||normalized.includes('not deploy'))return 'Production: ยังไม่ขึ้นระบบ'
  if(normalized.includes('deploy'))return 'Production: ขึ้นระบบแล้ว'
  return `Production: ${value||'ยังไม่ระบุ'}`
}

function StatusIcon({status}:{status:HealthStatus}){
  if(status==='healthy')return <CheckCircleRoundedIcon color="success"/>
  if(status==='critical')return <ErrorRoundedIcon color="error"/>
  return <WarningAmberRoundedIcon color={status==='warning'?'warning':'disabled'}/>
}

function MiniRunChart({runs}:{runs:Run[]}){
  const points=[...runs].reverse().slice(-24)
  const max=Math.max(1,...points.map(run=>run.healthy_count+run.warning_count+run.critical_count))
  return <Box sx={{display:'grid',gridTemplateColumns:`repeat(${Math.max(points.length,1)},minmax(8px,1fr))`,alignItems:'end',gap:.5,height:120,pt:1}}>
    {points.length===0?<Typography color="text.secondary" sx={{gridColumn:'1/-1',alignSelf:'center',textAlign:'center'}}>ยังไม่มีประวัติรอบตรวจ</Typography>:points.map(run=>{
      const total=run.healthy_count+run.warning_count+run.critical_count
      const height=Math.max(8,Math.round(total/max*100))
      const color=run.critical_count?'error.main':run.warning_count?'warning.main':'success.main'
      return <Box key={run.id} title={`${formatDate(run.started_at)} ปกติ ${run.healthy_count} เฝ้าระวัง ${run.warning_count} ขัดข้อง ${run.critical_count}`} sx={{height:`${height}%`,bgcolor:color,borderRadius:'5px 5px 1px 1px',minWidth:6}}/>
    })}
  </Box>
}

export function SystemHealthPage(){
  usePageTitle('สถานะระบบ')
  const {profile,currentCompany}=useAuth()
  const companyId=currentCompany?.company_id??''
  const runAttempt = <T = { data?: unknown; error?: unknown }>(action: string, request: Record<string, unknown>, operation: () => unknown) =>
    runWithMutationAttempt({
      module: 'system_health',
      action,
      actorProfileId: profile?.id,
      companyId,
      request,
      operation,
    }) as Promise<T>
  const [settings,setSettings]=useState(initial)
  const [checks,setChecks]=useState<Check[]>([])
  const [incidents,setIncidents]=useState<Incident[]>([])
  const [errorEvents,setErrorEvents]=useState<ErrorEvent[]>([])
  const [errorStatistics,setErrorStatistics]=useState<ErrorStatistics>(initialErrorStatistics)
  const [groups,setGroups]=useState<Group[]>([])
  const [runs,setRuns]=useState<Run[]>([])
  const [communicationEvents,setCommunicationEvents]=useState<CommunicationEvent[]>([])
  const [performanceMetrics,setPerformanceMetrics]=useState<PerformanceMetric[]>([])
  const [workItems,setWorkItems]=useState<WorkItem[]>(legacyWorkItems)
  const [busy,setBusy]=useState(false)
  const [loaded,setLoaded]=useState(false)
  const [clockNow,setClockNow]=useState(()=>Date.now())
  const [message,setMessage]=useState('')
  const [workTab,setWorkTab]=useState<WorkStatusTab>('all')
  const [workCategory,setWorkCategory]=useState<WorkCategoryFilter>('all')
  const [mainTab,setMainTab]=useState<MainTab>('overview')
  const [selectedCheck,setSelectedCheck]=useState<Check|null>(null)
  const [errorEvidence,setErrorEvidence]=useState<Record<string,ErrorEvidence[]>>({})
  const [evidencePreview,setEvidencePreview]=useState<{urls:string[];reference:string}|null>(null)
  const [imageStorageRows,setImageStorageRows]=useState<ImageStorageRow[]>([])
  const [imageOptimization,setImageOptimization]=useState<ImageOptimizationProgress|null>(null)
  const [optimizerRunning,setOptimizerRunning]=useState(false)
  const [auditAction,setAuditAction]=useState<AuditAction|null>(null)
  const [auditReason,setAuditReason]=useState('')
  const stopOptimizer=useRef(false)

  const load=useCallback(async(silent=false)=>{
    if(!silent)setBusy(true)
    const [s,c,i,g,r,w,e,errorRows,errorStats,imageStorage,imageOptimizationProgress,performanceRows]=await Promise.all([
      supabase.from('health_monitor_settings').select('*').eq('company_id',companyId).eq('singleton',true).maybeSingle(),
      supabase.from('health_monitor_checks').select('*').eq('company_id',companyId).order('module'),
      supabase.from('health_monitor_incidents').select('*').eq('company_id',companyId).order('started_at',{ascending:false}).limit(100),
      supabase.from('line_groups').select('line_group_id,display_name').eq('company_id',companyId).eq('active',true).order('display_name'),
      supabase.from('health_monitor_runs').select('*').eq('company_id',companyId).order('started_at',{ascending:false}).limit(50),
      supabase.from('system_work_items').select('work_key,title,category,status,progress,risk,production_status,detail,error_fingerprint,evidence,current_step,owner,created_at,updated_at').order('work_key'),
      supabase.rpc('get_communication_event_feed',{target_company_id:companyId,target_limit:500}),
      supabase.from('system_error_events').select('id,fingerprint,severity,status,title,message,affected_module,occurrence_count,system_occurrence_count,user_report_count,first_seen_at,last_seen_at,resolution_reason,resolved_at,last_evidence_message_id').eq('company_id',companyId).order('last_seen_at',{ascending:false}).limit(200),
      supabase.rpc('get_system_error_statistics'),
      supabase.from('line_image_storage_report').select('*').eq('company_id',companyId).order('retention_class'),
      supabase.from('line_image_optimization_progress').select('*').eq('company_id',companyId).maybeSingle(),
      supabase.from('app_activity_logs').select('id,page_path,severity,message,metadata,created_at').eq('company_id',companyId).eq('event_type','performance_metric').order('created_at',{ascending:false}).limit(200),
    ])
    const failures=[
      ['การตั้งค่า',s.error],['ผลตรวจ',c.error],['เหตุการณ์',i.error],['กลุ่ม LINE',g.error],
      ['ประวัติรอบตรวจ',r.error],['งานระบบ',w.error],['Log การสื่อสาร',e.error],
      ['ทะเบียน Error',errorRows.error],['สถิติ Error',errorStats.error],['พื้นที่รูปจาก LINE',imageStorage.error],['ข้อมูลความเร็วหน้าเว็บ',performanceRows.error],
    ].filter((entry):entry is [string,NonNullable<typeof s.error>]=>Boolean(entry[1]))
    if(s.data)setSettings({...initial,...s.data,daily_summary_time:String(s.data.daily_summary_time??initial.daily_summary_time).slice(0,5)})
    if(c.data)setChecks(c.data)
    if(i.data)setIncidents(i.data)
    if(g.data)setGroups(g.data)
    if(r.data)setRuns(r.data)
    if(e.data)setCommunicationEvents(e.data as CommunicationEvent[])
    if(w.data)setWorkItems((w.data as WorkItemRow[]).map(item=>({id:item.work_key,title:item.title,category:item.category,status:item.status,progress:item.progress,risk:item.risk,production:item.production_status,detail:item.detail??'',errorFingerprint:item.error_fingerprint,evidence:item.evidence,currentStep:item.current_step,owner:item.owner,createdAt:item.created_at,updatedAt:item.updated_at})))
    if(errorRows.data){
      const loadedErrors=errorRows.data as ErrorEvent[]
      setErrorEvents(loadedErrors)
      const eventIds=loadedErrors.map(row=>row.id)
      if(eventIds.length){
        const evidenceRows=await supabase.from('system_error_evidence').select('error_event_id,message_id,attachment_id').in('error_event_id',eventIds)
        if(evidenceRows.error)failures.push(['ทะเบียนรูปหลักฐาน Error',evidenceRows.error])
        const attachmentIds=(evidenceRows.data??[]).flatMap(item=>item.attachment_id?[item.attachment_id]:[])
        const attachmentRows=attachmentIds.length
          ?await supabase.from('line_attachments').select('id,message_id,storage_bucket,storage_path,content_type').in('id',attachmentIds)
          :{data:[],error:null}
        if(attachmentRows.error)failures.push(['รูปหลักฐาน Error',attachmentRows.error])
        const byId=new Map((attachmentRows.data??[]).map(item=>[item.id,item]))
        setErrorEvidence(Object.fromEntries(loadedErrors.map(event=>[event.id,(evidenceRows.data??[]).flatMap(link=>{
          if(link.error_event_id!==event.id||!link.attachment_id)return []
          const attachment=byId.get(link.attachment_id)
          return attachment?[{messageId:link.message_id,attachmentId:attachment.id,bucket:attachment.storage_bucket,path:attachment.storage_path,contentType:attachment.content_type} satisfies ErrorEvidence]:[]
        })])))
      }else setErrorEvidence({})
    }
    if(errorStats.data)setErrorStatistics({...initialErrorStatistics,...(errorStats.data as unknown as ErrorStatistics)})
    if(imageStorage.data)setImageStorageRows(imageStorage.data as ImageStorageRow[])
    if(performanceRows.data)setPerformanceMetrics(performanceRows.data as PerformanceMetric[])
    setImageOptimization(imageOptimizationProgress.data as ImageOptimizationProgress|null)
    setMessage(failures.length?`โหลดข้อมูลบางส่วนไม่สำเร็จ: ${failures.map(([name,error])=>`${name} (${userError(error)})`).join(', ')}`:'')
    setLoaded(true)
    if(!silent)setBusy(false)
  },[companyId])
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load])
  useEffect(()=>{const timer=window.setInterval(()=>setClockNow(Date.now()),30_000);return()=>window.clearInterval(timer)},[])
  useEffect(()=>{
    const handleResult=(event:Event)=>{
      const detail=(event as CustomEvent<{error?:string;status?:string}>).detail
      if(detail?.error)setMessage(detail.error)
      else if(detail?.status==='completed'){void load(true).then(()=>setMessage('ตรวจระบบอัตโนมัติเรียบร้อยแล้ว และอัปเดตสถานะงานแล้ว'))}
    }
    window.addEventListener('wisdomai-health-run-result',handleResult)
    return()=>window.removeEventListener('wisdomai-health-run-result',handleResult)
  },[load])

  const save=async()=>{
    setBusy(true)
    const {error}=await runAttempt('save_health_settings',{
      company_id:companyId,
      updated_by:profile?.id,
      settings,
    }, async ()=>await supabase.from('health_monitor_settings').update({
      ...settings,updated_by:profile?.id,updated_at:new Date().toISOString(),
    }).eq('company_id',companyId).eq('singleton',true))
    if(!error)window.dispatchEvent(new Event('wisdomai-health-config-changed'))
    setMessage(error?userError(error):'บันทึกการตั้งค่าแล้ว');setBusy(false)
  }
  const runNow=async()=>{
    setBusy(true);setMessage('')
    try {
      const result = await runAttempt('run_health_check_now',{
        source:'system_health_page',
        company_id:companyId,
      }, async () => {
        const {data:sessionData,error:refreshError}=await supabase.auth.refreshSession()
        if(refreshError) throw refreshError
        const accessToken=sessionData.session?.access_token
        if(!accessToken) throw new Error('Session หมดอายุ กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่')
        return await supabase.functions.invoke('health-monitor',{
          body:{source:'system_health_page'},
          headers:{
            Authorization:`Bearer ${accessToken}`,
            'x-user-authorization':`Bearer ${accessToken}`,
          },
        })
      })
      const data = result?.data as { status?: string } | null
      const error = result?.error
      if(error){
        const context=(error as { context?: Response }).context as Response|undefined
        let detail=''
        if(context){try{const payload=await context.clone().json() as {error?:string;message?:string};detail=payload.error??userError(payload)??''}catch{detail=context.status?`HTTP ${context.status}`:'ไม่สามารถเชื่อมต่อ Edge Function ได้'}}
        setMessage(detail||userError(error))
      }else if(data?.status==='rate_limited'){
        setMessage(`ระบบเพิ่งตรวจไปแล้ว กรุณารอให้ครบรอบ ${settings.check_interval_minutes} นาที`)
        await load()
      }else{
        await load();setMessage('ตรวจระบบเรียบร้อยแล้ว และอัปเดตสถานะงานจากผลตรวจล่าสุดแล้ว')
      }
    } catch(error){
      setMessage(error instanceof Error ? userError(error) : userError({ message: String(error) }))
    } finally {
      setBusy(false)
    }
  }
  const runImageOptimizer=async()=>{
    if(profile?.role!=='admin'||optimizerRunning)return
    setOptimizerRunning(true);stopOptimizer.current=false;setMessage('กำลังปรับรูปเก่าตาม Profile ที่กำหนด...')
    const tokenResult = await runAttempt('authorize_image_optimizer',{
      source:'system_health_page',
      company_id:companyId,
    }, async () => {
      const {data:sessionData,error:refreshError}=await supabase.auth.refreshSession()
      if(refreshError) throw refreshError
      const accessToken=sessionData.session?.access_token
      if(!accessToken) throw new Error('Session หมดอายุ กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่')
      return accessToken
    })
    const accessToken = tokenResult?.data as string | undefined
    if(!accessToken){setOptimizerRunning(false);return}
    let totalProcessed=0,totalSaved=0,failures=0
    try{
      for(let batch=0;batch<300&&!stopOptimizer.current;batch+=1){
        const optimizeResult = await runAttempt('run_image_optimizer_batch',{
          source:'system_health_page',
          company_id:companyId,
          resume_processing:batch===0,
          batch,
        }, async () => await supabase.functions.invoke('image-storage-optimizer',{
          body:{batch_size:1,company_id:companyId,resume_processing:batch===0},headers:{Authorization:`Bearer ${accessToken}`,'x-user-authorization':`Bearer ${accessToken}`},
        }))
        const data=optimizeResult?.data as { processed?: number; saved_bytes?: number; failed?: number; pending?: number } | undefined
        const error=optimizeResult?.error as unknown
        if(error){
          const context=(error as {context?:Response}).context as Response|undefined
          let detail=''
          if(context)try{const payload=await context.clone().json() as {error?:string;message?:string};detail=payload.error??userError(payload)??''}catch{detail=context.status?`HTTP ${context.status}`:''}
          throw new Error(detail||userError(error))
        }
        totalProcessed+=Number(data?.processed??0);totalSaved+=Number(data?.saved_bytes??0);failures+=Number(data?.failed??0)
        const pending=Number(data?.pending??0)
        setMessage(`ปรับแล้ว ${totalProcessed.toLocaleString('th-TH')} รูป · ลดเพิ่ม ${(totalSaved/1024/1024).toLocaleString('th-TH',{maximumFractionDigits:1})} MB · ค้าง ${pending.toLocaleString('th-TH')} รูป`)
        if(batch%5===4||pending===0)await load(true)
        if(Number(data?.processed??0)===0||pending===0)break
      }
      await load(true)
      setMessage(stopOptimizer.current?`หยุดชั่วคราวแล้ว · รอบนี้ประมวลผล ${totalProcessed.toLocaleString('th-TH')} รูป`:`ปรับรูปเก่าเสร็จแล้ว ${totalProcessed.toLocaleString('th-TH')} รูป · ลดพื้นที่เพิ่ม ${(totalSaved/1024/1024).toLocaleString('th-TH',{maximumFractionDigits:1})} MB${failures?` · ล้มเหลว ${failures} รูป`:''}`)
    }catch(error){setMessage(`ปรับรูปหยุดเพราะ Error: ${error instanceof Error?userError(error):String(error)}`);await load(true)}
    finally{setOptimizerRunning(false);stopOptimizer.current=false}
  }
  const sendTelegramStatus=async()=>{
    setBusy(true);setMessage('')
    const result = await runAttempt('send_telegram_status',{
      source:'system_health_page',
      company_id:companyId,
    }, async () => {
      const {data:sessionData,error:refreshError}=await supabase.auth.refreshSession()
      if(refreshError) throw refreshError
      const accessToken=sessionData.session?.access_token
      if(!accessToken) throw new Error('Session หมดอายุ กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่')
      return supabase.functions.invoke('health-monitor',{
        body:{action:'send_status_report',group_name:'กลุ่มทดสอบโปรแกรม'},
        headers:{Authorization:`Bearer ${accessToken}`,'x-user-authorization':`Bearer ${accessToken}`},
      })
    })
    const data = result?.data as {status?:string;destination?:string} | null
    const error = result?.error as unknown
    if(error){
      const context = (error as { context?: Response }).context
      let detail=''
      if(context){try{const payload=await context.clone().json() as {error?:string;message?:string};detail=payload.error??userError(payload)??''}catch{detail=context.status?`HTTP ${context.status}`:'ไม่สามารถเชื่อมต่อ Edge Function ได้'}}
      setMessage(detail||userError(error))
    }else if(data?.status==='rate_limited')setMessage(userError(data)||'ส่งรายงานไปแล้วภายใน 5 นาที')
    else{setMessage(`ส่งรายงานไป ${data?.destination||'กลุ่มทดสอบโปรแกรม'} แล้ว`);await load()}
    setBusy(false)
  }
  const decideWork=(item:WorkItem,approved:boolean)=>{
    if(profile?.role!=='admin')return
    setAuditReason('')
    setAuditAction({kind:'work',item,approved})
  }
  const resolveError=(row:ProblemRow,status:'resolved'|'dismissed')=>{
    if(profile?.role!=='admin'||row.source!=='error'||row.status==='resolved')return
    setAuditReason('')
    setAuditAction({kind:'error',row,status})
  }
  const submitAuditAction=async()=>{
    const reason=auditReason.trim()
    if(!auditAction||!reason||!profile?.id)return
    setBusy(true);setMessage('')
    const action=auditAction
    try {
      const result = await (action.kind === 'work'
        ? runAttempt('resolve_work_item',{
          action: `${action.approved ? 'approve_work' : 'reject_work'}`,
          work_key: action.item.id,
          reason,
          evidence: `${action.approved ? 'อนุมัติ' : 'ไม่อนุมัติ'}ผ่าน Web: ${reason}`,
          actor: profile.id,
        }, async () => await supabase.from('system_work_items').update({
          status:action.approved?'ready':'blocked',
          production_status:action.approved?'approved_for_execution':'rejected_by_admin',
          evidence:`${action.approved?'อนุมัติ':'ไม่อนุมัติ'}ผ่าน Web: ${reason}`,
          updated_by:profile.id,
          updated_at:new Date().toISOString(),
        }).eq('work_key',action.item.id).eq('status','review'))
        : runAttempt('resolve_system_error',{
          action: action.status,
          error_id: action.row.sourceId,
          reason,
        }, async ()=> await supabase.rpc('resolve_system_error_event',{target_event_id:action.row.sourceId,target_status:action.status,target_reason:reason})
        ))
      const error = result?.error
      setMessage(error?userError(error):action.kind==='work'
        ?`${action.approved?'อนุมัติ':'ไม่อนุมัติ'} ${action.item.id} และบันทึก Audit แล้ว`
        :`บันทึกผล ${action.row.reference} แล้ว`)
      if(!error)await load()
      if(!error){setAuditAction(null);setAuditReason('')}
    } catch (error) {
      setMessage(error instanceof Error ? userError(error) : userError({ message: String(error) }))
    }
    setBusy(false)
  }
  const openErrorEvidence=async(row:ProblemRow)=>{
    const evidence=errorEvidence[row.sourceId]??[]
    if(!evidence.length)return
    setBusy(true);setMessage('')
    const signed=await Promise.all(evidence.map(item=>supabase.storage.from(item.bucket).createSignedUrl(item.path,600)))
    const firstError=signed.find(item=>item.error)?.error
    if(firstError)setMessage(`เปิดรูปหลักฐานไม่สำเร็จ: ${userError(firstError)}`)
    else setEvidencePreview({urls:signed.flatMap(item=>item.data?[item.data.signedUrl]:[]),reference:row.reference})
    setBusy(false)
  }
  const completedRuns=runs.filter(run=>run.status==='completed')
  const uptime=completedRuns.length?Math.round(completedRuns.filter(run=>run.critical_count===0).length/completedRuns.length*100):0
  const averageLatency=checks.length?Math.round(checks.reduce((sum,row)=>sum+(row.latency_ms??0),0)/checks.length):0
  const nextCheck=runs[0]?new Date(new Date(runs[0].started_at).getTime()+settings.check_interval_minutes*60_000):null
  const overdueMinutes=nextCheck?Math.max(0,Math.floor((clockNow-nextCheck.getTime())/60_000)):0
  const monitoringOverdue=Boolean(nextCheck&&clockNow>nextCheck.getTime()+120_000)
  const rawOverall:HealthStatus=checks.some(row=>row.status==='critical')?'critical':checks.some(row=>row.status==='warning')?'warning':checks.length?'healthy':'unknown'
  const overall:HealthStatus=monitoringOverdue&&rawOverall==='healthy'?'warning':rawOverall
  const nextCheckLabel=!nextCheck?'-':monitoringOverdue?`เลยกำหนด ${overdueMinutes} นาที · รอรอบตรวจใหม่`:nextCheck.toLocaleString('th-TH')
  const orderedChecks=useMemo(()=>[...checks].sort((a,b)=>{
    const ai=flowOrder.findIndex(key=>a.check_key.includes(key));const bi=flowOrder.findIndex(key=>b.check_key.includes(key))
    return (ai<0?99:ai)-(bi<0?99:bi)
  }),[checks])
  const statusCount=(status:Exclude<WorkStatusTab,'all'>)=>workItems.filter(item=>getDisplayStatus(item)===status).length
  const visibleWorkItems=workItems.filter(item=>(workTab==='all'||getDisplayStatus(item)===workTab)&&(workCategory==='all'||item.category===workCategory))
  const workProgress=Math.round(workItems.reduce((sum,item)=>sum+item.progress,0)/workItems.length)
  const problemRows=useMemo<ProblemRow[]>(()=>{
    const errorRows=errorEvents.map<ProblemRow>(event=>({
      id:`error:${event.id}`,source:'error',sourceId:event.id,reference:`ERR-${event.id.slice(0,8).toUpperCase()}`,title:event.title,
      detail:`${readableCheckMessage(userError(event),'ไม่มีรายละเอียดเพิ่มเติม')} · ระบบพบ ${event.system_occurrence_count} ครั้ง · ผู้ใช้ยืนยัน ${event.user_report_count} ครั้ง · รวม ${event.occurrence_count} ครั้ง`,
      status:event.status==='resolved'||event.status==='dismissed'?'resolved':event.status==='monitoring'?'verification':'pending',
      severity:event.severity==='critical'?'critical':event.severity==='error'?'high':'medium',owner:null,fingerprint:event.fingerprint,
      firstSeen:event.first_seen_at,lastSeen:event.last_seen_at,resolution:event.status==='resolved'||event.status==='dismissed'?`${event.resolution_reason||'ปิดปัญหา'} · ${formatDate(event.resolved_at)}`:null,
    }))
    const incidentRows=incidents.map<ProblemRow>(incident=>({
      id:`incident:${incident.id}`,source:'monitor',sourceId:incident.id,reference:incident.check_key,title:incident.title,
      detail:readableCheckMessage(userError(incident),'ระบบตรวจพบความผิดปกติ'),status:incident.status==='resolved'?'resolved':'pending',
      severity:incident.severity==='critical'?'critical':'medium',owner:null,fingerprint:`health:${incident.check_key}`,
      firstSeen:incident.started_at,lastSeen:incident.resolved_at||incident.started_at,
      resolution:incident.status==='resolved'?`กลับมาปกติเมื่อ ${formatDate(incident.resolved_at)}`:null,
    }))
    const workRows=workItems.filter(item=>Boolean(item.errorFingerprint)||item.status==='blocked').map<ProblemRow>(item=>{
      const status:ProblemStatus=item.status==='done'?'resolved':item.status==='doing'?'repairing':item.status==='review'?'verification':item.status==='blocked'?'stuck':'pending'
      return {
        id:`work:${item.id}`,source:'work',sourceId:item.id,reference:item.id,title:item.title,detail:item.currentStep||item.detail||'ยังไม่ระบุรายละเอียด',status,
        severity:item.risk,owner:item.owner??null,fingerprint:item.errorFingerprint??null,
        firstSeen:item.createdAt??item.updatedAt??'',lastSeen:item.updatedAt??item.createdAt??'',
        resolution:status==='resolved'?(item.evidence||'ปิดงานและตรวจผลแล้ว'):null,
      }
    })
    return [...errorRows,...incidentRows,...workRows].sort((left,right)=>new Date(right.lastSeen).getTime()-new Date(left.lastSeen).getTime())
  },[errorEvents,incidents,workItems])
  const usageRows=useMemo(()=>{
    const channel=(name:string)=>communicationEvents.filter(event=>event.channel===name)
    const failed=(rows:CommunicationEvent[])=>rows.filter(event=>event.status==='failed'||Boolean(event.error_message)).length
    const findCheck=(...terms:string[])=>checks.find(item=>terms.some(term=>`${item.check_key} ${item.module}`.toLowerCase().includes(term)))
    const database=findCheck('database')
    const edge=findCheck('edge')
    const frontend=findCheck('frontend','web')
    const line=channel('line'),telegram=channel('telegram')
    const ai=communicationEvents.filter(event=>/ai|analysis|transcri|gemini|openai|anthropic/i.test(`${event.event_type} ${event.source_type} ${event.title??''}`))
    return [
      {system:'ฐานข้อมูล Supabase',activity:database?'ตรวจแล้ว':'ยังไม่มีผลตรวจ',errors:database?.status==='critical'?1:0,latency:database?.latency_ms,status:database?.status??'unknown',coverage:'สุขภาพและเวลาโต้ตอบ; ยังไม่มี active/max connections'},
      {system:'Edge Functions',activity:edge?'ตรวจแล้ว':'ยังไม่มีผลตรวจ',errors:edge?.status==='critical'?1:0,latency:edge?.latency_ms,status:edge?.status??'unknown',coverage:'สุขภาพและ HTTP; ยังไม่มี invocation/timeout quota'},
      {system:'LINE',activity:`${line.length} เหตุการณ์`,errors:failed(line),latency:null,status:failed(line)?'warning':'healthy',coverage:'Log ล่าสุด 500 รายการ; quota จริงตรวจใน Edge ก่อน Push'},
      {system:'Telegram',activity:`${telegram.length} เหตุการณ์`,errors:failed(telegram),latency:null,status:failed(telegram)?'warning':'healthy',coverage:'ส่ง/ล้มเหลวจาก Log ล่าสุด 500 รายการ'},
      {system:'AI Providers',activity:`${ai.length} เหตุการณ์`,errors:failed(ai),latency:null,status:failed(ai)?'warning':'unknown',coverage:'กิจกรรมที่มี Log; ยังไม่มี token และค่าใช้จ่ายจาก Provider'},
      {system:'Vercel / หน้าเว็บ',activity:frontend?'ตรวจแล้ว':'ยังไม่มีผลตรวจ',errors:frontend?.status==='critical'?1:0,latency:frontend?.latency_ms,status:frontend?.status??'unknown',coverage:'HTTP และ latency; ยังไม่มี bandwidth/request quota'},
      {system:'Storage',activity:'ยังไม่มี Usage Meter',errors:0,latency:null,status:'unknown',coverage:'สิทธิ์แยกบริษัทแล้ว; ยังไม่มี GB และ bandwidth'},
      {system:'Worker / Cron',activity:`${runs.length} รอบตรวจ · ${workItems.filter(item=>item.status==='doing').length} งานกำลังทำ`,errors:runs.filter(run=>run.status!=='completed'||run.critical_count>0).length,latency:null,status:runs.some(run=>run.critical_count>0)?'warning':runs.length?'healthy':'unknown',coverage:'50 รอบล่าสุดและสถานะงานปัจจุบัน'},
    ] as const
  },[checks,communicationEvents,runs,workItems])
  const performanceSummary=useMemo(()=>{
    const values=performanceMetrics.map(row=>Number(row.metadata?.value_ms)).filter(value=>Number.isFinite(value))
    const sorted=[...values].sort((left,right)=>left-right)
    const p95=sorted.length?sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*.95)-1)]:null
    return {count:values.length,p95,slow:performanceMetrics.filter(row=>row.severity!=='info').length,last:performanceMetrics[0]??null}
  },[performanceMetrics])

  return <Stack spacing={3}>
    <PageHeader title="สถานะระบบ" description="ภาพรวมการทำงานของเว็บ ฐานข้อมูล ระบบลงเวลา และช่องทางแจ้งเตือน" action={<Stack direction={{xs:'column',sm:'row'}} spacing={1}><Button onClick={()=>void load()} disabled={busy}>รีเฟรช</Button><Button variant="outlined" onClick={()=>void sendTelegramStatus()} disabled={busy||profile?.role!=='admin'}>ส่ง Status เข้า Telegram</Button><Button variant="contained" startIcon={<RefreshOutlinedIcon/>} onClick={()=>void runNow()} disabled={busy}>ตรวจทันที</Button></Stack>}/>
    {message&&<Alert severity={message.includes('แล้ว')?'success':'error'}>{message}</Alert>}
    {loaded&&!settings.line_group_id&&<Alert severity="warning">ยังไม่ได้เลือกกลุ่ม LINE สำหรับรับการแจ้งเตือนปัญหาระบบ</Alert>}

    <Paper variant="outlined" sx={{overflow:'hidden'}}><Tabs value={mainTab} onChange={(_,value)=>setMainTab(value)} variant="scrollable" scrollButtons="auto">
      <Tab value="overview" label="ภาพรวมเทคนิค"/><Tab value="usage" label="ประสิทธิภาพและการเชื่อมต่อ"/><Tab value="issues" label="Incident และ Error"/><Tab value="logs" label="Integration และ Audit Log"/><Tab value="work" label="งานปรับปรุงระบบ"/><Tab value="settings" label="Monitoring Settings"/>
    </Tabs></Paper>

    <Box sx={{display:mainTab==='usage'?'block':'none'}}><Stack spacing={2}>
      <Alert severity="info">แสดงเฉพาะค่าที่ระบบวัดได้จริง: Log ช่องทางสูงสุด 500 รายการ และ Performance หน้าเว็บสูงสุด 200 ค่า ไม่มีการสร้างตัวเลขประมาณ</Alert>
      <Paper variant="outlined" sx={{p:2}}><Stack spacing={1.5}><Box><Typography variant="h6">มาตรฐานประสิทธิภาพส่วนกลาง</Typography><Typography variant="body2" color="text.secondary">เกินเกณฑ์จะบันทึกในทะเบียน Error กลาง โดยรวมเหตุซ้ำตามหน้าและชนิดของค่า</Typography></Box><Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',md:'repeat(3,1fr)'},gap:1}}><Paper variant="outlined" sx={{p:1.25}}><Typography variant="caption" color="text.secondary">API / Page load</Typography><Typography sx={{fontWeight:700}}>เตือน &gt; 2.5 วินาที · วิกฤต &gt; 4 วินาที</Typography></Paper><Paper variant="outlined" sx={{p:1.25}}><Typography variant="caption" color="text.secondary">LCP</Typography><Typography sx={{fontWeight:700}}>เตือน &gt; 2.5 วินาที · วิกฤต &gt; 4 วินาที</Typography></Paper><Paper variant="outlined" sx={{p:1.25}}><Typography variant="caption" color="text.secondary">การตอบสนองผู้ใช้</Typography><Typography sx={{fontWeight:700}}>เตือน &gt; 300 ms · วิกฤต &gt; 800 ms</Typography></Paper></Box><Stack direction={{xs:'column',sm:'row'}} spacing={3}><Typography>วัดได้ {performanceSummary.count} ค่า</Typography><Typography>p95 {performanceSummary.p95===null?'-':`${performanceSummary.p95} ms`}</Typography><Typography color={performanceSummary.slow?'warning.main':'text.secondary'}>เกินเกณฑ์ {performanceSummary.slow} ค่า</Typography><Typography color="text.secondary">ล่าสุด {formatDate(performanceSummary.last?.created_at??null)}</Typography></Stack></Stack></Paper>
      <Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',md:'repeat(2,1fr)'},gap:1.5}}>{usageRows.map(row=><Paper key={row.system} variant="outlined" sx={{p:2}}><Stack spacing={1}>
        <Stack direction="row" sx={{justifyContent:'space-between',alignItems:'center',gap:1}}><Typography sx={{fontWeight:800}}>{row.system}</Typography><Chip size="small" color={statusColor[row.status]} label={statusLabel[row.status]}/></Stack>
        <Stack direction="row" spacing={3}><Box><Typography variant="caption" color="text.secondary">ปริมาณที่วัดได้</Typography><Typography sx={{fontWeight:700}}>{row.activity}</Typography></Box><Box><Typography variant="caption" color="text.secondary">Error</Typography><Typography sx={{fontWeight:700}} color={row.errors?'error.main':'text.primary'}>{row.errors}</Typography></Box>{row.latency!==null&&row.latency!==undefined&&<Box><Typography variant="caption" color="text.secondary">Latency</Typography><Typography sx={{fontWeight:700}}>{row.latency} ms</Typography></Box>}</Stack>
        <Typography variant="body2" color="text.secondary">ขอบเขตข้อมูล: {row.coverage}</Typography>
      </Stack></Paper>)}</Box>
    </Stack></Box>

    <Paper variant="outlined" sx={{overflow:'hidden',display:mainTab==='work'?'block':'none'}}>
      <Box sx={{px:{xs:2,md:3},pt:2.5}}><Stack direction={{xs:'column',md:'row'}} spacing={2} sx={{justifyContent:'space-between'}}><Box><Typography variant="h6">ความก้าวหน้างานระบบ</Typography><Typography variant="body2" color="text.secondary">งานที่ยืนยันแล้ว งานที่ระบบตรวจพบ และสถานะขึ้น Production</Typography></Box><Box sx={{minWidth:{md:260}}}><Stack direction="row" sx={{justifyContent:'space-between'}}><Typography variant="caption">ความก้าวหน้ารวม</Typography><Typography variant="caption" sx={{fontWeight:700}}>{workProgress}%</Typography></Stack><LinearProgress variant="determinate" value={workProgress} sx={{height:9,borderRadius:9,mt:.5}}/></Box></Stack></Box>
      <Tabs value={workTab} onChange={(_,value)=>setWorkTab(value)} variant="scrollable" scrollButtons="auto" sx={{px:{xs:1,md:2},mt:1,borderBottom:1,borderColor:'divider'}}>
        <Tab value="all" label={`ทั้งหมด (${workItems.length})`}/><Tab value="ready" label={`ต้องดำเนินการ (${statusCount('ready')})`}/><Tab value="doing" label={`กำลังทำ (${statusCount('doing')})`}/><Tab value="approval" label={`รออนุมัติ (${statusCount('approval')})`}/><Tab value="review" label={`รอตรวจ (${statusCount('review')})`}/><Tab value="blocked" label={`ติดปัญหา (${statusCount('blocked')})`}/><Tab value="done" label={`เสร็จแล้ว (${statusCount('done')})`}/>
      </Tabs>
      <Box sx={{px:{xs:2,md:3},pt:2,maxWidth:360}}><TextField select fullWidth size="small" label="ประเภทงาน" value={workCategory} onChange={event=>setWorkCategory(event.target.value as WorkCategoryFilter)}>{(Object.keys(categoryLabel) as WorkCategoryFilter[]).map(category=><MenuItem key={category} value={category}>{categoryLabel[category]} ({category==='all'?workItems.length:workItems.filter(item=>item.category===category).length})</MenuItem>)}</TextField></Box>
      <Box sx={{p:{xs:2,md:3},display:'grid',gridTemplateColumns:{xs:'1fr',lg:'repeat(2,1fr)'},gap:1.5}}>{visibleWorkItems.map(item=>{const displayStatus=getDisplayStatus(item);return <Paper key={item.id} variant="outlined" sx={{p:2}}><Stack spacing={1.25}><Stack direction="row" spacing={1} useFlexGap sx={{alignItems:'center',flexWrap:'wrap'}}><Typography variant="subtitle2" color="primary.main">{item.id}</Typography><Chip size="small" color={displayStatusColor[displayStatus]} label={displayStatusLabel[displayStatus]}/><Chip size="small" variant="outlined" label={`ความเสี่ยง ${riskLabel[item.risk]}`}/></Stack><Typography sx={{fontWeight:700}}>{item.title}</Typography><Typography variant="body2" color="text.secondary">{item.detail}</Typography><Typography variant="caption" color="text.secondary">{productionLabel(item.production)}</Typography><Stack direction="row" spacing={1} sx={{alignItems:'center'}}><LinearProgress variant="determinate" value={item.progress} color={displayStatus==='done'?'success':'primary'} sx={{height:8,borderRadius:8,flex:1}}/><Typography variant="caption" sx={{minWidth:34,textAlign:'right'}}>{item.progress}%</Typography></Stack>{displayStatus==='approval'&&profile?.role==='admin'&&<Stack direction="row" spacing={1} sx={{pt:.5}}><Button size="small" variant="contained" color="success" disabled={busy} onClick={()=>void decideWork(item,true)}>อนุมัติ</Button><Button size="small" variant="outlined" color="error" disabled={busy} onClick={()=>void decideWork(item,false)}>ไม่อนุมัติ</Button></Stack>}</Stack></Paper>})}</Box>
    </Paper>

    <Paper variant="outlined" sx={{p:{xs:2,md:3},borderLeft:6,borderLeftColor:statusHex[overall],display:mainTab==='overview'?'block':'none'}}>
      <Stack direction={{xs:'column',md:'row'}} spacing={3} sx={{justifyContent:'space-between',alignItems:{md:'center'}}}>
        <Stack direction="row" spacing={1.5} sx={{alignItems:'center'}}><StatusIcon status={overall}/><Box><Typography variant="overline" color="text.secondary">สถานะรวม</Typography><Typography variant="h4" sx={{fontWeight:800}}>{statusLabel[overall]}</Typography></Box></Stack>
        <Stack direction={{xs:'column',sm:'row'}} spacing={3} divider={<Divider orientation="vertical" flexItem/>}>
          <Box><Typography variant="caption" color="text.secondary">ความพร้อม 50 รอบล่าสุด</Typography><Typography variant="h5" sx={{fontWeight:700}}>{uptime}%</Typography></Box>
          <Box><Typography variant="caption" color="text.secondary">เวลาตอบสนองเฉลี่ย</Typography><Typography variant="h5" sx={{fontWeight:700}}>{averageLatency} ms</Typography></Box>
          <Box><Typography variant="caption" color="text.secondary">ตรวจล่าสุด</Typography><Typography sx={{fontWeight:700}}>{formatDate(runs[0]?.started_at??null)}</Typography><Typography variant="caption" color={monitoringOverdue?'warning.main':'text.secondary'}>ครั้งถัดไป {nextCheckLabel}</Typography></Box>
        </Stack>
      </Stack>
    </Paper>
    <Paper variant="outlined" sx={{p:{xs:2,md:3},display:mainTab==='overview'?'block':'none'}}>
      <Stack direction={{xs:'column',md:'row'}} spacing={2} sx={{justifyContent:'space-between',alignItems:{md:'center'}}}>
        <Box><Typography variant="overline" color="text.secondary">Release ที่กำลังใช้งาน</Typography><Typography variant="h6" sx={{fontWeight:800}}>{releaseLabel}</Typography><Typography variant="body2" color="text.secondary">Build เมื่อ {formatDate(releaseInfo.builtAt)} · Deployment {releaseInfo.deploymentId??'local / ไม่ระบุจากผู้ให้บริการ'}</Typography></Box>
        <Alert severity="success" sx={{py:0}}>หากเลขนี้เปลี่ยน แปลว่าเว็บได้รับเวอร์ชันใหม่แล้ว</Alert>
      </Stack>
    </Paper>
    {mainTab==='overview'&&monitoringOverdue&&<Alert severity="warning">ผลตรวจล่าสุดเกินรอบที่กำหนดแล้ว ข้อมูลสุขภาพอาจไม่ใช่สถานะปัจจุบัน กรุณากด “ตรวจทันที” ระหว่างรอซ่อม Scheduled Monitor รายบริษัท</Alert>}

    <Stack direction={{xs:'column',lg:'row'}} spacing={2} sx={{alignItems:'stretch',display:mainTab==='overview'?'flex':'none'}}>
      <Paper variant="outlined" sx={{p:2.5,flex:2,minWidth:0}}><Typography variant="h6">เส้นทางการทำงาน</Typography><Typography variant="body2" color="text.secondary">กดแต่ละสถานะเพื่อดูผลตรวจล่าสุดในตารางรายละเอียดด้านล่าง</Typography>
        <Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',sm:'repeat(2,1fr)',lg:`repeat(${Math.min(Math.max(orderedChecks.length,1),5)},1fr)`},gap:1.5,mt:2}}>
          {orderedChecks.length?orderedChecks.map((item,index)=><Paper key={item.check_key} role="button" tabIndex={0} onClick={()=>setSelectedCheck(item)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setSelectedCheck(item)}}} variant="outlined" sx={{p:1.5,position:'relative',borderColor:`${statusHex[item.status]}55`,bgcolor:`${statusHex[item.status]}0a`,cursor:'pointer','&:hover':{boxShadow:2,transform:'translateY(-1px)'},transition:'box-shadow .15s, transform .15s'}}><Stack direction="row" spacing={1} sx={{alignItems:'center'}}><StatusIcon status={item.status}/><Typography sx={{fontWeight:700}}>{item.name_th}</Typography></Stack><Typography variant="caption" color="text.secondary" sx={{display:'block',mt:1}}>{userError(item)||statusLabel[item.status]}</Typography><Typography variant="caption">{item.latency_ms??'-'} ms · {formatDate(item.last_checked_at)}</Typography>{index<orderedChecks.length-1&&<Typography sx={{display:{xs:'none',lg:'block'},position:'absolute',right:-13,top:'40%',zIndex:2,color:'text.disabled'}}>›</Typography>}</Paper>):<Alert severity="info">ยังไม่มีผลตรวจ กด “ตรวจทันที” เพื่อเริ่มตรวจระบบ</Alert>}
        </Box>
      </Paper>
      <Paper variant="outlined" sx={{p:2.5,flex:1,minWidth:280}}><Typography variant="h6">แนวโน้ม 24 รอบล่าสุด</Typography><MiniRunChart runs={runs}/><Stack direction="row" spacing={2} sx={{mt:1}}>{(['healthy','warning','critical'] as const).map(status=><Stack key={status} direction="row" spacing={0.5} sx={{alignItems:'center'}}><Box sx={{width:9,height:9,borderRadius:'50%',bgcolor:statusHex[status]}}/><Typography variant="caption">{statusLabel[status]}</Typography></Stack>)}</Stack></Paper>
    </Stack>

    <Stack direction="row" spacing={2} useFlexGap sx={{flexWrap:'wrap',display:mainTab==='overview'?'flex':'none'}}>{(['healthy','warning','critical','unknown'] as const).map(status=><Paper key={status} variant="outlined" sx={{p:2,minWidth:150,flex:'1 1 150px'}}><Typography variant="caption" color="text.secondary">{statusLabel[status]}</Typography><Typography variant="h4" color={statusHex[status]}>{checks.filter(row=>row.status===status).length}</Typography></Paper>)}</Stack>

    <Paper variant="outlined" sx={{p:{xs:2,md:3},display:mainTab==='settings'?'block':'none'}}><Stack spacing={2}><Typography variant="h6">Monitoring Settings</Typography>
      <Stack direction={{xs:'column',md:'row'}} spacing={2} sx={{alignItems:{md:'center'}}}><Stack direction="row" sx={{alignItems:'center'}}><Switch checked={settings.enabled} onChange={e=>setSettings({...settings,enabled:e.target.checked})}/><Typography>เปิดตรวจอัตโนมัติ</Typography></Stack><TextField select fullWidth label="กลุ่ม LINE ผู้ดูแล" value={settings.line_group_id??''} onChange={e=>setSettings({...settings,line_group_id:e.target.value||null})}><MenuItem value="">ยังไม่ส่ง LINE</MenuItem>{groups.map(group=><MenuItem key={group.line_group_id} value={group.line_group_id}>{group.display_name||group.line_group_id}</MenuItem>)}</TextField><TextField fullWidth label="ผู้รับผิดชอบหลัก" value={settings.responsible_name??''} onChange={e=>setSettings({...settings,responsible_name:e.target.value})}/><TextField label="เวลาสรุปรายวัน" type="time" value={settings.daily_summary_time} onChange={e=>setSettings({...settings,daily_summary_time:e.target.value})} slotProps={{inputLabel:{shrink:true}}}/></Stack>
      <Stack direction={{xs:'column',md:'row'}} spacing={2}><TextField select fullWidth label="รอบเวลาตรวจ" value={settings.check_interval_minutes} onChange={e=>setSettings({...settings,check_interval_minutes:Number(e.target.value)})}>{[5,15,30,60].map(minutes=><MenuItem key={minutes} value={minutes}>{minutes===60?'1 ชั่วโมง':`${minutes} นาที`}</MenuItem>)}</TextField><TextField fullWidth type="number" label="แจ้งเมื่อผิดพลาดติดต่อกัน (รอบ)" value={settings.alert_after_failures} onChange={e=>setSettings({...settings,alert_after_failures:Number(e.target.value)})}/><TextField fullWidth type="number" label="เตือนซ้ำทุก (นาที)" value={settings.repeat_alert_minutes} onChange={e=>setSettings({...settings,repeat_alert_minutes:Number(e.target.value)})}/><Button variant="contained" startIcon={<SaveOutlinedIcon/>} disabled={busy||profile?.role!=='admin'} onClick={()=>void save()}>บันทึก</Button></Stack>
      <Alert severity="info">กติกากลาง: ผลเสียต่อเนื่อง 2 รอบสร้าง Incident เดียว, แจ้งซ้ำทุก 30 นาทีตามค่าที่กำหนด, และปิดเมื่อผ่านต่อเนื่อง 2 รอบ การวัดหน้าเว็บบันทึกจากผู้ใช้ที่เข้าสู่ระบบ โดยไม่เก็บข้อมูลลับ</Alert>
    </Stack></Paper>

    <Box sx={{display:mainTab==='issues'?'block':'none'}}><Stack spacing={3}>
    <Box><Typography variant="h6">สถิติ Error</Typography><Typography variant="body2" color="text.secondary">สรุปจากทะเบียน Error กลาง แยกระบบตรวจพบและหลักฐานที่ผู้ใช้ส่งมายืนยัน โดยรวมเหตุซ้ำด้วย Fingerprint</Typography></Box>
    <Box sx={{display:'grid',gridTemplateColumns:{xs:'repeat(2,minmax(0,1fr))',md:'repeat(4,minmax(0,1fr))'},gap:1.5}}>{[
      ['กำลังเปิด',errorStatistics.open_incidents,'error.main'],['วิกฤตที่ยังเปิด',errorStatistics.critical_open,'error.main'],['พบใน 24 ชม.',errorStatistics.incidents_24h,'warning.main'],['พบใน 7 วัน',errorStatistics.incidents_7d,'text.primary'],
      ['ระบบตรวจพบ',errorStatistics.system_occurrences,'info.main'],['ผู้ใช้ยืนยันด้วยหลักฐาน',errorStatistics.user_confirmations,'secondary.main'],['Error ที่เกิดซ้ำ',errorStatistics.repeated_incidents,'warning.main'],['โมดูลที่ได้รับผลกระทบ',errorStatistics.affected_modules,'text.primary'],
    ].map(([label,value,color])=><Paper key={String(label)} variant="outlined" sx={{p:1.75,minWidth:0}}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant="h5" sx={{fontWeight:800,color}}>{value}</Typography></Paper>)}</Box>
    <Alert severity="info">“ระบบตรวจพบ” และ “ผู้ใช้ยืนยันด้วยหลักฐาน” เป็นจำนวนครั้ง ส่วน “กำลังเปิด” และ “Error ที่เกิดซ้ำ” เป็นจำนวนปัญหาหลังรวมรายการซ้ำแล้ว</Alert>
    <Box><Typography variant="h6">รายงานพื้นที่รูปจาก LINE</Typography><Typography variant="body2" color="text.secondary">แยกตามนโยบายเก็บรักษา รูป Error และเอกสารสำคัญจะไม่ถูกลบอัตโนมัติ</Typography></Box>
    <Paper variant="outlined" sx={{p:2}}><Stack spacing={1.5}>
      <Stack direction={{xs:'column',md:'row'}} spacing={1.5} sx={{alignItems:{md:'center'},justifyContent:'space-between'}}>
        <Box><Typography sx={{fontWeight:800}}>ปรับรูปเก่าก่อนจัดเก็บตาม Profile</Typography><Typography variant="body2" color="text.secondary">เอกสาร 2500px/95 · Error 2000px/90 · รูปทั่วไป 1600px/80 · ไม่มีค่า AI</Typography></Box>
        {optimizerRunning?<Button color="warning" variant="outlined" onClick={()=>{stopOptimizer.current=true}}>หยุดชั่วคราว</Button>:<Button variant="contained" disabled={profile?.role!=='admin'||!imageOptimization?.pending_images} onClick={()=>void runImageOptimizer()}>{imageOptimization?.pending_images?'เริ่ม / ทำต่อ':'ดำเนินการครบแล้ว'}</Button>}
      </Stack>
      {imageOptimization&&<><LinearProgress variant="determinate" value={imageOptimization.total_images?Math.min(100,(imageOptimization.optimized_images+imageOptimization.kept_original_images+imageOptimization.failed_images)/imageOptimization.total_images*100):0}/><Stack direction="row" spacing={2} useFlexGap sx={{flexWrap:'wrap'}}><Typography variant="body2">ทั้งหมด {Number(imageOptimization.total_images).toLocaleString('th-TH')}</Typography><Typography variant="body2" color="success.main">ลดแล้ว {Number(imageOptimization.optimized_images).toLocaleString('th-TH')}</Typography><Typography variant="body2">เก็บต้นฉบับ {Number(imageOptimization.kept_original_images).toLocaleString('th-TH')}</Typography><Typography variant="body2" color="warning.main">ค้าง {Number(imageOptimization.pending_images).toLocaleString('th-TH')}</Typography><Typography variant="body2" color={imageOptimization.failed_images?'error.main':'text.secondary'}>ล้มเหลว {Number(imageOptimization.failed_images).toLocaleString('th-TH')}</Typography><Typography variant="body2" sx={{fontWeight:700}}>ลดพื้นที่แล้ว {(Number(imageOptimization.storage_bytes_saved)/1024/1024).toLocaleString('th-TH',{maximumFractionDigits:1})} MB</Typography></Stack></>}
    </Stack></Paper>
    <Box sx={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:1.5}}>{imageStorageRows.map(row=><Paper key={row.retention_class} variant="outlined" sx={{p:1.5}}><Typography variant="caption" color="text.secondary">{row.retention_class}</Typography><Typography variant="h6">{Number(row.file_count).toLocaleString('th-TH')} รูป</Typography><Typography variant="body2">{(Number(row.stored_bytes)/1024/1024).toLocaleString('th-TH',{maximumFractionDigits:1})} MB</Typography>{Number(row.reclaimable_duplicate_bytes)>0&&<Typography variant="caption" color="warning.main">ไฟล์ซ้ำที่คืนพื้นที่ได้ {(Number(row.reclaimable_duplicate_bytes)/1024/1024).toLocaleString('th-TH',{maximumFractionDigits:1})} MB</Typography>}</Paper>)}</Box>
    <Typography variant="h6">รายละเอียดระบบ</Typography>
    <StandardDataTable rows={checks} getRowId={row=>row.check_key} getSearchText={row=>`${row.name_th} ${row.module} ${userError(row)}`} searchLabel="ค้นหาระบบ" emptyText={busy?'กำลังตรวจ...':'ยังไม่มีผลตรวจ'} exportFileName="health-checks" columns={[{id:'status',label:'สถานะ',render:row=><Chip size="small" color={statusColor[row.status]} label={statusLabel[row.status]}/>},{id:'name',label:'ระบบ',minWidth:210,render:row=>row.name_th},{id:'module',label:'Module',render:row=>row.module},{id:'message',label:'ผลตรวจ',minWidth:300,render:row=>userError(row)||'-'},{id:'latency',label:'เวลา',render:row=>row.latency_ms===null?'-':`${row.latency_ms} ms`},{id:'checked',label:'ตรวจล่าสุด',minWidth:180,render:row=>formatDate(row.last_checked_at)}]}/>
    <Stack direction="row" sx={{justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:1}}><Box><Typography variant="h6">ทะเบียนปัญหา</Typography><Typography variant="body2" color="text.secondary">รวมเหตุที่ Monitor ตรวจพบและงานซ่อมจากคิวกลาง เพื่อแสดงส่วนที่ค้างและแก้ไขแล้วจากข้อมูลจริง</Typography></Box></Stack>
    <Stack direction="row" spacing={1.5} useFlexGap sx={{flexWrap:'wrap'}}>{(['pending','repairing','verification','stuck','resolved'] as const).map(status=><Paper key={status} variant="outlined" sx={{p:1.5,minWidth:150,flex:'1 1 150px'}}><Typography variant="caption" color="text.secondary">{problemStatusLabel[status]}</Typography><Typography variant="h5" color={status==='stuck'?'error.main':status==='resolved'?'success.main':'text.primary'}>{problemRows.filter(row=>row.status===status).length}</Typography></Paper>)}</Stack>
    <StandardDataTable rows={problemRows} getRowId={row=>row.id} getSearchText={row=>`${row.reference} ${row.title} ${row.detail} ${row.status} ${row.owner} ${row.fingerprint}`} searchLabel="ค้นหาเลขอ้างอิง ปัญหา ผู้รับผิดชอบ หรือ Fingerprint" emptyText="ยังไม่มีปัญหาที่บันทึกไว้" exportFileName="system-problem-register" defaultSort={{columnId:'updated',direction:'desc'}} getRowSx={row=>row.status==='stuck'?{bgcolor:'error.lighter'}:{}} columns={[
      {id:'status',label:'สถานะ',render:row=><Chip size="small" color={problemStatusColor[row.status]} label={problemStatusLabel[row.status]}/>,exportValue:row=>problemStatusLabel[row.status]},
      {id:'reference',label:'เลขอ้างอิง',render:row=>row.reference,exportValue:row=>row.reference},
      {id:'title',label:'ปัญหา / ขั้นตอนล่าสุด',minWidth:300,render:row=><Box><Typography sx={{fontWeight:700}}>{row.title}</Typography><Typography variant="caption" color="text.secondary">{row.detail}</Typography></Box>,exportValue:row=>`${row.title}: ${row.detail}`},
      {id:'severity',label:'ความรุนแรง',render:row=>riskLabel[row.severity],exportValue:row=>riskLabel[row.severity]},
      {id:'owner',label:'ผู้รับผิดชอบ',render:row=>row.owner||'ยังไม่มอบหมาย',exportValue:row=>row.owner||''},
      {id:'fingerprint',label:'Fingerprint',minWidth:180,render:row=>row.fingerprint||'-',exportValue:row=>row.fingerprint||''},
      {id:'first',label:'เริ่มพบ',minWidth:170,render:row=>formatDate(row.firstSeen),exportValue:row=>formatDate(row.firstSeen),sortValue:row=>new Date(row.firstSeen).getTime()},
      {id:'updated',label:'อัปเดตล่าสุด',minWidth:170,render:row=>formatDate(row.lastSeen),exportValue:row=>formatDate(row.lastSeen),sortValue:row=>new Date(row.lastSeen).getTime()},
      {id:'resolution',label:'ผลการแก้ไข',minWidth:280,render:row=>row.resolution||'ยังไม่ปิดปัญหา',exportValue:row=>row.resolution||'ยังไม่ปิดปัญหา'},
      {id:'actions',label:'จัดการ',minWidth:260,render:row=>row.source==='error'?<Stack direction="row" spacing={1} useFlexGap sx={{flexWrap:'wrap'}}>{(errorEvidence[row.sourceId]?.length??0)>0&&<Button size="small" variant="outlined" onClick={()=>void openErrorEvidence(row)}>ดูรูปหลักฐาน ({errorEvidence[row.sourceId].length})</Button>}{profile?.role==='admin'&&row.status!=='resolved'&&<><Button size="small" onClick={()=>void resolveError(row,'resolved')}>แก้ไขแล้ว</Button><Button size="small" color="inherit" onClick={()=>void resolveError(row,'dismissed')}>ไม่ใช่ปัญหา</Button></>}</Stack>:'-'},
    ]}/>
    </Stack></Box>
    <Box sx={{display:mainTab==='logs'?'block':'none'}}><Stack spacing={3}><Typography variant="h6">ประวัติการสื่อสาร</Typography>
    <Stack direction="row" spacing={2} useFlexGap sx={{flexWrap:'wrap'}}>{['line','telegram','web','system'].map(channel=><Paper key={channel} variant="outlined" sx={{p:2,minWidth:150,flex:'1 1 150px'}}><Typography variant="caption" color="text.secondary">{channel.toUpperCase()}</Typography><Typography variant="h5">{communicationEvents.filter(event=>event.channel===channel).length}</Typography></Paper>)}</Stack>
    <StandardDataTable rows={communicationEvents} getRowId={row=>row.event_id} getSearchText={row=>`${row.channel} ${row.event_type} ${row.status} ${row.destination} ${row.title} ${userError(row)} ${row.related_work_key}`} searchLabel="ค้นหาช่องทาง ข้อความ งาน หรือสถานะ" emptyText="ยังไม่มีประวัติการสื่อสาร" exportFileName="communication-event-feed" columns={[{id:'time',label:'วันเวลา',minWidth:170,render:row=>formatDate(row.occurred_at)},{id:'channel',label:'ช่องทาง',render:row=><Chip size="small" variant="outlined" label={row.channel.toUpperCase()}/>},{id:'status',label:'สถานะ',render:row=><Chip size="small" color={['sent','processed','done','approved'].includes(row.status)?'success':row.status==='failed'?'error':'default'} label={row.status}/>},{id:'type',label:'ประเภท',minWidth:180,render:row=>row.event_type},{id:'title',label:'หัวข้อ/งาน',minWidth:190,render:row=>row.related_work_key||row.title||'-'},{id:'destination',label:'ปลายทาง',minWidth:170,render:row=>row.destination||'-'},{id:'message',label:'ข้อความ/ผลลัพธ์',minWidth:360,render:row=>row.error_message||userError(row)||'-'},{id:'responded',label:'ตอบกลับ/ประมวลผล',minWidth:170,render:row=>formatDate(row.responded_at)}]}/></Stack></Box>

    <Drawer anchor="right" open={Boolean(selectedCheck)} onClose={()=>setSelectedCheck(null)} slotProps={{paper:{sx:{width:{xs:'100%',sm:480},p:3}}}}>
      {selectedCheck&&<Stack spacing={2}>
        <Stack direction="row" sx={{alignItems:'center',justifyContent:'space-between'}}><Box><Typography variant="overline" color="text.secondary">รายละเอียดผลตรวจ</Typography><Typography variant="h5" sx={{fontWeight:800}}>{selectedCheck.name_th}</Typography></Box><IconButton aria-label="ปิด" onClick={()=>setSelectedCheck(null)}><CloseRoundedIcon/></IconButton></Stack>
        <Divider/><Stack direction="row" spacing={1}><Chip color={statusColor[selectedCheck.status]} label={statusLabel[selectedCheck.status]}/><Chip variant="outlined" label={selectedCheck.module}/></Stack>
        <Box><Typography variant="caption" color="text.secondary">ผลตรวจล่าสุด</Typography><Typography>{readableCheckMessage(userError(selectedCheck),statusLabel[selectedCheck.status])}</Typography></Box>
        {selectedCheck.status!=='healthy'&&<Stack spacing={1.25}>
          <Paper variant="outlined" sx={{p:1.5}}><Typography variant="caption" color="text.secondary">สาเหตุที่วิเคราะห์ได้</Typography><Typography>{checkDiagnosis(selectedCheck).cause}</Typography></Paper>
          <Paper variant="outlined" sx={{p:1.5}}><Typography variant="caption" color="text.secondary">ผลกระทบ</Typography><Typography>{checkDiagnosis(selectedCheck).impact}</Typography></Paper>
          <Paper variant="outlined" sx={{p:1.5}}><Typography variant="caption" color="text.secondary">แนวทางแก้ไข</Typography><Typography>{checkDiagnosis(selectedCheck).resolution}</Typography></Paper>
          <Chip size="small" variant="outlined" label={`ความมั่นใจ: ${checkDiagnosis(selectedCheck).confidence}`} sx={{alignSelf:'flex-start'}}/>
          <Paper variant="outlined" sx={{p:1.5,bgcolor:'action.hover'}}><Typography variant="caption" color="text.secondary">ข้อมูลเทคนิค</Typography><Typography sx={{wordBreak:'break-word',fontFamily:'monospace',fontSize:13}}>{readableCheckMessage(userError(selectedCheck),'ไม่มีข้อมูลเทคนิค')}</Typography></Paper>
          {selectedCheck.check_key==='employee_readiness'&&<Button variant="outlined" href="/workforce-setup">เปิดข้อมูลความพร้อมพนักงาน</Button>}
        </Stack>}
        <Stack direction="row" spacing={3}><Box><Typography variant="caption" color="text.secondary">เวลาตอบสนอง</Typography><Typography>{selectedCheck.latency_ms??'-'} ms</Typography></Box><Box><Typography variant="caption" color="text.secondary">ตรวจเมื่อ</Typography><Typography>{formatDate(selectedCheck.last_checked_at)}</Typography></Box></Stack>
        {selectedCheck.check_key==='attendance'&&Array.isArray(selectedCheck.metadata?.stale_sessions)&&selectedCheck.metadata.stale_sessions.length>0?<Box><Typography variant="subtitle2" sx={{mb:1}}>รายการที่ต้องตรวจสอบ</Typography><Stack spacing={1.25}>{(selectedCheck.metadata.stale_sessions as StaleAttendanceSession[]).map(session=><Paper key={session.session_id} variant="outlined" sx={{p:1.5}}><Stack spacing={.75}><Stack direction="row" sx={{justifyContent:'space-between',gap:1}}><Typography sx={{fontWeight:800}}>{session.employee_name||'ไม่พบชื่อพนักงาน'}</Typography><Chip size="small" color="warning" label={`ค้าง ${formatDuration(session.open_minutes)}`}/></Stack><Typography variant="body2">{session.employee_code?`รหัส ${session.employee_code} · `:''}{session.company_name||'ไม่พบชื่อบริษัท'}</Typography><Typography variant="body2">{session.project_name||'ไม่พบโครงการ'} · {session.site_name||'ไม่พบไซต์'}</Typography><Typography variant="body2" color="text.secondary">ลงเวลาเข้า {formatDate(session.clock_in_at)}</Typography><Button variant="contained" size="small" href={`/reports?month=${session.clock_in_at.slice(0,7)}&employee=${session.profile_id}&session=${session.session_id}`}>เปิดและตรวจสอบรายการนี้</Button></Stack></Paper>)}</Stack></Box>:<Box><Typography variant="caption" color="text.secondary">ข้อมูลประกอบ</Typography>{selectedCheck.metadata&&Object.keys(selectedCheck.metadata).length?<Stack spacing={1} sx={{mt:1}}>{Object.entries(selectedCheck.metadata).filter(([key])=>key!=='stale_sessions').map(([key,value])=><Paper key={key} variant="outlined" sx={{p:1.25}}><Typography variant="caption" color="text.secondary">{key}</Typography><Typography sx={{wordBreak:'break-word'}}>{typeof value==='object'?JSON.stringify(value):String(value)}</Typography></Paper>)}</Stack>:<Typography>ไม่มีข้อมูลเพิ่มเติม</Typography>}</Box>}
        {selectedCheck.check_key==='attendance'&&<Button variant="outlined" href="/reports">เปิดรายงานลงเวลาทั้งหมด</Button>}
      </Stack>}
    </Drawer>
    <Dialog open={Boolean(evidencePreview)} onClose={()=>setEvidencePreview(null)} maxWidth="lg" fullWidth>
      <DialogTitle>รูปผู้ใช้แจ้ง Error ระบบ · {evidencePreview?.reference}</DialogTitle>
      <DialogContent>{evidencePreview&&<Stack spacing={2}>{evidencePreview.urls.map((url,index)=><Box key={url} component="img" src={url} alt={`หลักฐาน ${evidencePreview.reference} รูปที่ ${index+1}`} sx={{display:'block',maxWidth:'100%',maxHeight:'75vh',mx:'auto',objectFit:'contain'}}/>)}</Stack>}</DialogContent>
    </Dialog>
    <Dialog open={Boolean(auditAction)} onClose={busy?undefined:()=>setAuditAction(null)} maxWidth="sm" fullWidth>
      <DialogTitle>{auditAction?.kind==='work'
        ?`${auditAction.approved?'อนุมัติ':'ไม่อนุมัติ'} ${auditAction.item.id}`
        :`${auditAction?.status==='resolved'?'ยืนยันว่าแก้ไขแล้ว':'ปิดโดยไม่ดำเนินการ'} ${auditAction?.row.reference??''}`}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{pt:1}}>
          <Alert severity="info">ทุกการเปลี่ยนสถานะต้องระบุเหตุผล ระบบจะบันทึกผู้ดำเนินการ วันเวลา และเหตุผลไว้ใน Audit</Alert>
          <TextField autoFocus required multiline minRows={3} label="เหตุผลการดำเนินการ" value={auditReason} onChange={event=>setAuditReason(event.target.value)} slotProps={{htmlInput:{maxLength:1000}}} helperText={`${auditReason.length}/1000 ตัวอักษร`}/>
          <Stack direction="row" spacing={1} sx={{justifyContent:'flex-end'}}><Button disabled={busy} onClick={()=>setAuditAction(null)}>ยกเลิก</Button><Button variant="contained" disabled={busy||!auditReason.trim()} onClick={()=>void submitAuditAction()}>ยืนยันและบันทึก Audit</Button></Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  </Stack>
}

