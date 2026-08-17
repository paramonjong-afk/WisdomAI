import { Alert, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'

type Notice={id:string;title:string;detail:string;path:string;severity:'info'|'warning'|'error'}
type NoticeResult={count:number|null;data:{id:string;updated_at?:string;created_at?:string}[]|null;error:{message:string}|null}
const noticeVersion=(kind:string,result:NoticeResult)=>{
  const latest=result.data?.[0]
  return `${kind}:${latest?.id??'none'}:${latest?.updated_at??latest?.created_at??'none'}`
}
export function NotificationsPage(){
  usePageTitle('การแจ้งเตือน')
  const {profile,user}=useAuth(),canManage=profile?.role==='admin'||profile?.role==='manager'
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[items,setItems]=useState<Notice[]>([])
  const load=useCallback(async()=>{
    if(!canManage)return
    setLoading(true);setError('')
    const [leave,correction,open,line,claim,readStates]=await Promise.all([
      supabase.from('employee_leave_requests').select('id,updated_at',{count:'exact'}).in('status',['pending','late_notice','needs_evidence']).order('updated_at',{ascending:false}).limit(1),
      supabase.from('attendance_correction_requests').select('id,updated_at',{count:'exact'}).eq('status','pending').order('updated_at',{ascending:false}).limit(1),
      supabase.from('attendance_sessions').select('id,updated_at',{count:'exact'}).is('clock_out_at',null).not('status','in','(rejected,duplicate)').order('updated_at',{ascending:false}).limit(1),
      supabase.from('attendance_notifications').select('id,updated_at',{count:'exact'}).eq('status','failed').order('updated_at',{ascending:false}).limit(1),
      supabase.from('contractor_payment_claims').select('id,updated_at',{count:'exact'}).eq('status','submitted').order('updated_at',{ascending:false}).limit(1),
      supabase.from('notification_read_states').select('notification_key').eq('profile_id',user?.id??''),
    ])
    const first=[leave,correction,open,line,claim].find((row)=>row.error)?.error;if(first)setError('โหลดแจ้งเตือนบางส่วนไม่สำเร็จ')
    const allNotices:Notice[]=[
      {id:noticeVersion('leave',leave as NoticeResult),title:'คำขอลารอตรวจ',detail:`${leave.count??0} รายการ`,path:'/approvals',severity:'warning'},
      {id:noticeVersion('correction',correction as NoticeResult),title:'คำขอแก้เวลารอตรวจ',detail:`${correction.count??0} รายการ`,path:'/approvals',severity:'warning'},
      {id:noticeVersion('open',open as NoticeResult),title:'รายการยังไม่ลงเวลาออก',detail:`${open.count??0} รายการ`,path:'/employees',severity:'warning'},
      {id:noticeVersion('claim',claim as NoticeResult),title:'งวดผู้รับเหมารอตรวจ',detail:`${claim.count??0} รายการ`,path:'/approvals',severity:'info'},
      {id:noticeVersion('line',line as NoticeResult),title:'การแจ้ง LINE ล้มเหลว',detail:`${line.count??0} รายการ`,path:'/line-monitor',severity:'error'},
    ]
    const readKeys=new Set((readStates.data??[]).map((row)=>row.notification_key))
    const next=allNotices.filter((item)=>Number.parseInt(item.detail)>0&&!readKeys.has(item.id))
    setItems(next);setLoading(false)
  },[canManage,user?.id])
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load])
  if(!canManage)return <Alert severity="info">ไม่มีรายการแจ้งเตือนสำหรับสิทธิ์พนักงาน</Alert>
  if(loading)return <Stack sx={{alignItems:'center',py:8}}><CircularProgress/></Stack>
  const markRead=async(item:Notice)=>{
    if(!user)return
    const {error:saveError}=await supabase.from('notification_read_states').upsert({
      profile_id:user.id,notification_key:item.id,read_at:new Date().toISOString(),
    })
    if(saveError)setError('บันทึกสถานะอ่านแล้วไม่สำเร็จ')
    else setItems((current)=>current.filter((row)=>row.id!==item.id))
  }
  return <Stack spacing={3}>
    <PageHeader title="ศูนย์การแจ้งเตือน" description="รวมเหตุการณ์ที่ต้องติดตาม กดเพื่อไปยังหน้าดำเนินการ" action={<Button onClick={()=>void load()}>รีเฟรช</Button>}/>
    {error&&<Alert severity="error">{error}</Alert>}
    {items.map((item)=><Alert key={item.id} severity={item.severity} action={<Stack direction="row"><Button onClick={()=>void markRead(item)}>อ่านแล้ว</Button><Button component={Link} to={item.path}>เปิดรายการ</Button></Stack>}>
      <Typography sx={{fontWeight:800}}>{item.title}</Typography>{item.detail}
    </Alert>)}
    {items.length===0&&<Paper variant="outlined" sx={{p:4,textAlign:'center'}}><Typography>ไม่มีรายการที่ต้องดำเนินการ</Typography></Paper>}
  </Stack>
}
