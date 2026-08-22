import { Alert, Button, CircularProgress, Paper, Stack, Tab, Tabs, TextField } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
import { userError } from '../../utils/userError'
import { runWithMutationAttempt } from '../../utils/mutationAttemptRunner'

type Leave={id:string;reason:string;starts_at:string;ends_at:string;profiles:{full_name:string|null;email:string|null}|null;leave_types:{name_th:string}|null}
type Correction={id:string;reason:string;requested_clock_in_at:string|null;requested_clock_out_at:string|null;profiles:{full_name:string|null;email:string|null}|null}
type Claim={id:string;claim_number:string;description:string;net_amount:number;contractor_contracts:{contractor_vendors:{legal_name:string}|null}|null}
type AttendanceReview={id:string;clock_in_at:string;clock_out_at:string|null;clock_in_distance_meters:number|null;clock_out_distance_meters:number|null;clock_in_accuracy_meters:number|null;clock_out_accuracy_meters:number|null;review_reason:string|null;review_category:string|null;profiles:{full_name:string|null;email:string|null}|null;project_sites:{name:string;projects:{name:string}|null}|null}
const name=(profile:{full_name:string|null;email:string|null}|null)=>profile?.full_name||profile?.email||'ไม่ทราบชื่อ'

export function ApprovalsPage(){
  usePageTitle('ศูนย์อนุมัติ')
  const {profile,currentCompany}=useAuth(),canManage=profile?.role==='admin'||profile?.role==='manager'
  const [tab,setTab]=useState(0),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false)
  const [error,setError]=useState(''),[message,setMessage]=useState('')
  const [leaves,setLeaves]=useState<Leave[]>([]),[corrections,setCorrections]=useState<Correction[]>([]),[claims,setClaims]=useState<Claim[]>([])
  const [attendanceReviews,setAttendanceReviews]=useState<AttendanceReview[]>([]),[reviewNote,setReviewNote]=useState('')
  const load=useCallback(async()=>{
    if(!canManage)return
    setLoading(true);setError('')
    const [l,c,cl,a]=await Promise.all([
      supabase.from('employee_leave_requests').select('id,reason,starts_at,ends_at,profiles!employee_leave_requests_profile_id_fkey(full_name,email),leave_types(name_th)').in('status',['pending','late_notice','needs_evidence']).order('created_at').limit(200),
      supabase.from('attendance_correction_requests').select('id,reason,requested_clock_in_at,requested_clock_out_at,profiles!attendance_correction_requests_profile_id_fkey(full_name,email)').eq('status','pending').order('created_at').limit(200),
      supabase.from('contractor_payment_claims').select('id,claim_number,description,net_amount,contractor_contracts(contractor_vendors(legal_name))').eq('status','submitted').order('created_at').limit(200),
      supabase.from('attendance_sessions').select('id,clock_in_at,clock_out_at,clock_in_distance_meters,clock_out_distance_meters,clock_in_accuracy_meters,clock_out_accuracy_meters,review_reason,review_category,profiles!attendance_sessions_profile_id_fkey(full_name,email),project_sites(name,projects(name))').eq('status','needs_review').order('review_requested_at',{ascending:false}).limit(200),
    ])
    const first=[l,c,cl,a].find((item)=>item.error)?.error;if(first)setError('โหลดรายการอนุมัติบางส่วนไม่สำเร็จ')
    setLeaves((l.data??[]) as unknown as Leave[]);setCorrections((c.data??[]) as unknown as Correction[]);setClaims((cl.data??[]) as unknown as Claim[]);setAttendanceReviews((a.data??[]) as unknown as AttendanceReview[]);setLoading(false)
  },[canManage])
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load])
  const run = async (operation: () => PromiseLike<{ error: { message: string } | null }>, success: string, request: Record<string, unknown> = {}) => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await runWithMutationAttempt({
        module: 'approvals',
        action: success,
        actorProfileId: profile?.id,
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
  const reviewGps=(id:string,action:'approve'|'reject'|'request_more')=>run(()=>supabase.rpc('review_gps_attendance',{target_session_id:id,review_action:action,review_note:reviewNote.trim()||null,review_source:'web',source_line_group_id:null,source_line_user_id:null}),action==='approve'?'อนุมัติรายการ GPS แล้ว':action==='reject'?'ปฏิเสธรายการแล้ว':'ส่งคำขอข้อมูลเพิ่มแล้ว')
  if(!canManage)return <Alert severity="error">เฉพาะผู้จัดการและผู้ดูแลระบบ</Alert>
  if(loading)return <Stack sx={{alignItems:'center',py:8}}><CircularProgress/></Stack>
  return <Stack spacing={3}>
    <PageHeader title="ศูนย์อนุมัติ" description="รวมรายการที่ต้องตัดสินใจไว้หน้าเดียว พร้อมบันทึกผู้อนุมัติและเวลา" />
    {message&&<Alert severity="success">{message}</Alert>}{error&&<Alert severity="error">{error}</Alert>}
    <Paper variant="outlined"><Tabs value={tab} onChange={(_e,v)=>setTab(v)} variant="scrollable">
      <Tab label={`GPS รอตรวจ (${attendanceReviews.length})`}/><Tab label={`การลา (${leaves.length})`}/><Tab label={`แก้เวลา (${corrections.length})`}/><Tab label={`ผู้รับเหมา (${claims.length})`}/>
    </Tabs></Paper>
    {tab===0&&<><TextField fullWidth label="หมายเหตุการตรวจ (จำเป็นเมื่อปฏิเสธหรือขอข้อมูลเพิ่ม)" value={reviewNote} onChange={event=>setReviewNote(event.target.value)}/><StandardDataTable rows={attendanceReviews} getRowId={r=>r.id} getSearchText={r=>`${name(r.profiles)} ${r.project_sites?.projects?.name} ${r.project_sites?.name} ${r.review_reason}`} searchLabel="ค้นหาพนักงาน โครงการ ไซต์ หรือเหตุผล" emptyText="ไม่มีรายการ GPS รอตรวจ" exportFileName="attendance-gps-review" columns={[
      {id:'employee',label:'พนักงาน',render:r=>name(r.profiles)},{id:'site',label:'โครงการ/ไซต์',render:r=>`${r.project_sites?.projects?.name??'-'} · ${r.project_sites?.name??'-'}`},{id:'time',label:'เข้า–ออก',render:r=>`${new Date(r.clock_in_at).toLocaleString('th-TH')} – ${r.clock_out_at?new Date(r.clock_out_at).toLocaleString('th-TH'):'ยังไม่ออก'}`},{id:'distance',label:'ระยะ เข้า/ออก',render:r=>`${r.clock_in_distance_meters===null?'-':Math.round(r.clock_in_distance_meters)+' ม.'} / ${r.clock_out_distance_meters===null?'-':Math.round(r.clock_out_distance_meters)+' ม.'}`},{id:'accuracy',label:'GPS เข้า/ออก',render:r=>`${r.clock_in_accuracy_meters===null?'-':'±'+Math.round(r.clock_in_accuracy_meters)+' ม.'} / ${r.clock_out_accuracy_meters===null?'-':'±'+Math.round(r.clock_out_accuracy_meters)+' ม.'}`},{id:'reason',label:'เหตุผลรอตรวจ',render:r=>r.review_reason||r.review_category||'-'},{id:'action',label:'ดำเนินการ',minWidth:280,render:r=><Stack direction="row" spacing={.5}><Button disabled={busy} onClick={()=>void reviewGps(r.id,'approve')}>อนุมัติ</Button><Button disabled={busy||!reviewNote.trim()} onClick={()=>void reviewGps(r.id,'request_more')}>ขอข้อมูลเพิ่ม</Button><Button color="error" disabled={busy||!reviewNote.trim()} onClick={()=>void reviewGps(r.id,'reject')}>ปฏิเสธ</Button></Stack>}
    ]}/></>}
    {tab===1&&<StandardDataTable rows={leaves} getRowId={(r)=>r.id} getSearchText={(r)=>`${name(r.profiles)} ${r.reason}`} searchLabel="ค้นหาคำขอลา" emptyText="ไม่มีคำขอลารอตรวจ" columns={[
      {id:'employee',label:'พนักงาน',render:(r)=>name(r.profiles)},{id:'type',label:'ประเภท',render:(r)=>r.leave_types?.name_th??'-'},
      {id:'period',label:'ช่วงเวลา',render:(r)=>`${new Date(r.starts_at).toLocaleString('th-TH')} – ${new Date(r.ends_at).toLocaleString('th-TH')}`},
      {id:'reason',label:'เหตุผล',render:(r)=>r.reason},{id:'action',label:'ดำเนินการ',render:(r)=><Stack direction="row" spacing={1}><Button disabled={busy} onClick={()=>void run(()=>supabase.rpc('review_leave_request',{target_request_id:r.id,decision:'approved',decision_note:null}),'อนุมัติการลาแล้ว')}>อนุมัติ</Button><Button disabled={busy} color="error" onClick={()=>void run(()=>supabase.rpc('review_leave_request',{target_request_id:r.id,decision:'rejected',decision_note:'ไม่ผ่านการอนุมัติ'}),'ปฏิเสธคำขอแล้ว')}>ปฏิเสธ</Button></Stack>},
    ]}/>}
    {tab===2&&<StandardDataTable rows={corrections} getRowId={(r)=>r.id} getSearchText={(r)=>`${name(r.profiles)} ${r.reason}`} searchLabel="ค้นหาคำขอแก้เวลา" emptyText="ไม่มีคำขอแก้เวลารอตรวจ" columns={[
      {id:'employee',label:'พนักงาน',render:(r)=>name(r.profiles)},{id:'time',label:'เวลาที่ขอแก้',render:(r)=>`${r.requested_clock_in_at?new Date(r.requested_clock_in_at).toLocaleString('th-TH'):'-'} – ${r.requested_clock_out_at?new Date(r.requested_clock_out_at).toLocaleString('th-TH'):'-'}`},
      {id:'reason',label:'เหตุผล',render:(r)=>r.reason},{id:'action',label:'ดำเนินการ',render:(r)=><Stack direction="row" spacing={1}><Button disabled={busy} onClick={()=>void run(()=>supabase.rpc('review_attendance_correction',{target_request_id:r.id,decision:'approved',decision_note:null}),'อนุมัติการแก้เวลาแล้ว')}>อนุมัติ</Button><Button disabled={busy} color="error" onClick={()=>void run(()=>supabase.rpc('review_attendance_correction',{target_request_id:r.id,decision:'rejected',decision_note:'ไม่ผ่านการอนุมัติ'}),'ปฏิเสธคำขอแล้ว')}>ปฏิเสธ</Button></Stack>},
    ]}/>}
    {tab===3&&<StandardDataTable rows={claims} getRowId={(r)=>r.id} getSearchText={(r)=>`${r.claim_number} ${r.description}`} searchLabel="ค้นหางวดงาน" emptyText="ไม่มีงวดผู้รับเหมารอตรวจ" columns={[
      {id:'claim',label:'งวด',render:(r)=>r.claim_number},{id:'vendor',label:'ผู้รับเหมา',render:(r)=>r.contractor_contracts?.contractor_vendors?.legal_name??'-'},{id:'detail',label:'งาน',render:(r)=>r.description},{id:'net',label:'ยอดสุทธิ',render:(r)=>`฿${Number(r.net_amount).toLocaleString('th-TH')}`},
      {id:'action',label:'ดำเนินการ',render:(r)=><Stack direction="row" spacing={1}><Button disabled={busy} onClick={()=>void run(()=>supabase.rpc('transition_contractor_claim',{target_claim_id:r.id,target_action:'approve',target_payment_reference:null,target_note:null}),'อนุมัติงวดงานแล้ว')}>อนุมัติ</Button><Button disabled={busy} color="error" onClick={()=>void run(()=>supabase.rpc('transition_contractor_claim',{target_claim_id:r.id,target_action:'reject',target_payment_reference:null,target_note:'ไม่ผ่านการตรวจรับ'}),'ปฏิเสธงวดงานแล้ว')}>ปฏิเสธ</Button></Stack>},
    ]}/>}
  </Stack>
}
