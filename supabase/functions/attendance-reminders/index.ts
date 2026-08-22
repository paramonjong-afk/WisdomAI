import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendLinePush } from '../_shared/line-quota.ts'

const url=Deno.env.get('SUPABASE_URL')!
const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const anonKey=Deno.env.get('SUPABASE_ANON_KEY')!
const lineToken=Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN')
const siteUrl=Deno.env.get('WISDOMAI_SITE_URL')??'https://wisdomai-react.vercel.app'
const admin=createClient(url,serviceKey,{auth:{persistSession:false}})
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8'}})

type OpenSession={id:string;company_id:string;profile_id:string;clock_in_at:string;status:string;profiles:{full_name:string|null;email:string|null}|null;project_sites:{name:string}|null}
type Settings={company_id:string;clock_out_reminder_minutes:number;stale_after_shift_minutes:number;overtime_reminder_minutes:number;morning_summary_time:string;line_group_id:string|null;enabled:boolean}

async function sendLine(to:string|null,message:string,priority:'normal'|'high'='normal'){
  return sendLinePush({token:lineToken,to,messages:[{type:'text',text:message.slice(0,4900)}],priority})
}

type ReminderEventType='clock_out_reminder'|'stale_marked'|'morning_summary'
type PendingDelivery={companyId:string;destination:string|null;eventType:ReminderEventType;events:{id:string;sessionId:string;message:string}[]}

async function reserveEvent(companyId:string,sessionId:string,eventType:ReminderEventType,destination:string|null,message:string){
  const {data,error}=await admin.from('attendance_reminder_events').insert({
    company_id:companyId,session_id:sessionId,event_type:eventType,destination,status:'pending',message,
  }).select('id').single()
  if(error?.code==='23505')return null
  if(error)throw new Error(`reserve ${eventType}: ${error.message}`)
  return data.id as string
}

async function finishEvent(companyId:string,eventId:string,status:'sent'|'failed'|'skipped',errorMessage:string|null){
  const {error}=await admin.from('attendance_reminder_events').update({
    status,error_message:errorMessage,
  }).eq('company_id',companyId).eq('id',eventId)
  return error?.message??null
}
const bangkokDate=(date:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(date)
const bangkokTime=(date:Date)=>new Intl.DateTimeFormat('th-TH',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit'}).format(date)
const clockMinutes=(value:string)=>{const [h,m]=value.slice(0,5).split(':').map(Number);return h*60+m}
const scheduledEnd=(clockIn:Date,start:string,end:string)=>{
  const startMinutes=clockMinutes(start),endMinutes=clockMinutes(end)
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(clockIn)
  const base=new Date(`${parts}T00:00:00+07:00`)
  base.setUTCMinutes(base.getUTCMinutes()+endMinutes+(endMinutes<=startMinutes?1440:0))
  return base
}

Deno.serve(async(request)=>{
  if(request.method!=='POST')return json({error:'Method not allowed'},405)
  const secret=Deno.env.get('ATTENDANCE_MONITOR_SECRET')
  const monitorAuthorized=Boolean(secret&&request.headers.get('x-monitor-secret')===secret)
  let targetCompanyId:string|null=null
  if(!monitorAuthorized){
    const authorization=request.headers.get('authorization')??''
    if(!authorization)return json({error:secret?'Unauthorized':'Monitor secret is not configured'},secret?401:503)
    const userClient=createClient(url,anonKey,{global:{headers:{authorization}},auth:{persistSession:false}})
    const {data:authData,error:authError}=await userClient.auth.getUser()
    if(authError||!authData.user)return json({error:'Unauthorized'},401)
    const {data:preference}=await admin.from('user_company_preferences').select('active_company_id').eq('profile_id',authData.user.id).maybeSingle()
    targetCompanyId=preference?.active_company_id??null
    if(!targetCompanyId)return json({error:'กรุณาเลือกบริษัทก่อนตรวจรายการ'},403)
    const {data:actor}=await admin.from('profiles').select('role').eq('id',authData.user.id).maybeSingle()
    const isPlatformAdmin=actor?.role==='admin'
    const {data:membership}=await admin.from('company_members').select('company_role').eq('company_id',targetCompanyId).eq('profile_id',authData.user.id).eq('active',true).maybeSingle()
    if(!isPlatformAdmin&&(!membership||!['company_admin','executive','manager'].includes(membership.company_role)))return json({error:'ไม่มีสิทธิ์ตรวจรายการแจ้งเตือน'},403)
  }
  const {data:settingsRows,error:settingsError}=await admin.from('workforce_rule_settings').select('*').eq('singleton',true)
  if(settingsError)return json({error:settingsError.message},500)
  const now=new Date(),results=[] as unknown[]
  const pendingDeliveries=new Map<string,PendingDelivery>()
  let checked=0
  const activeSettings=(settingsRows??[] as Settings[]).filter((item)=>item.enabled&&item.company_id&&(!targetCompanyId||item.company_id===targetCompanyId))
  for(const settings of activeSettings){
  const {data:rows,error}=await admin.from('attendance_sessions')
    .select('id,company_id,profile_id,clock_in_at,status,profiles!attendance_sessions_profile_id_fkey(full_name,email),project_sites(name)')
    .eq('company_id',settings.company_id).is('clock_out_at',null).not('status','in','(rejected,duplicate)').order('clock_in_at')
  if(error){results.push({company_id:settings.company_id,status:'failed',error:error.message});continue}
  checked+=(rows??[]).length
  for(const raw of rows??[]){
    const session=raw as unknown as OpenSession
    const {data:employment}=await admin.from('employee_employment_records').select('work_policy_id').eq('company_id',settings.company_id).eq('profile_id',session.profile_id).maybeSingle()
    const {data:policy}=employment?.work_policy_id?await admin.from('work_policies').select('work_start_time,work_end_time').eq('company_id',settings.company_id).eq('id',employment.work_policy_id).maybeSingle():{data:null}
    const start=policy?.work_start_time??'08:00',end=policy?.work_end_time??'17:00'
    let expectedEnd=scheduledEnd(new Date(session.clock_in_at),start,end)
    const {data:ot}=await admin.from('employee_overtime_assignments').select('ends_at').eq('company_id',settings.company_id).eq('profile_id',session.profile_id).eq('status','approved').gte('ends_at',expectedEnd.toISOString()).order('ends_at',{ascending:false}).limit(1).maybeSingle()
    const hasOt=Boolean(ot?.ends_at);if(ot?.ends_at)expectedEnd=new Date(ot.ends_at)
    const elapsed=(now.getTime()-expectedEnd.getTime())/60000
    const reminderAfter=hasOt?settings.overtime_reminder_minutes:settings.clock_out_reminder_minutes
    const name=session.profiles?.full_name||session.profiles?.email||'ไม่ทราบชื่อ'
    const site=session.project_sites?.name??'-'
    const nowMinutes=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',hour12:false}).format(now).replace(':',''))
    const summaryTarget=Number(String(settings.morning_summary_time).slice(0,5).replace(':',''))
    const isMorningWindow=nowMinutes>=summaryTarget&&nowMinutes<summaryTarget+10
    let eventType:'clock_out_reminder'|'morning_summary'|null=null
    if(elapsed>=settings.stale_after_shift_minutes){
      const staleMessage='ลืมลงเวลาออก/รอตรวจสอบ'
      const staleEventId=await reserveEvent(settings.company_id,session.id,'stale_marked',null,staleMessage)
      if(staleEventId){
        const {error:markError}=await admin.from('attendance_sessions').update({status:'needs_review',review_reason:staleMessage,updated_at:now.toISOString()}).eq('company_id',settings.company_id).eq('id',session.id).is('clock_out_at',null)
        await finishEvent(settings.company_id,staleEventId,markError?'failed':'skipped',markError?.message??null)
      }
      if(isMorningWindow)eventType='morning_summary'
    }else if(elapsed>=reminderAfter)eventType='clock_out_reminder'
    if(!eventType)continue
    const message=eventType==='morning_summary'
      ? `⚠️ ลืมลงเวลาออก/รอตรวจสอบ\nพนักงาน: ${name}\nไซต์: ${site}\nเวลาเข้า: ${bangkokTime(new Date(session.clock_in_at))}\nกรุณาให้ผู้จัดการตรวจสอบ\n${siteUrl}/approvals`
      : `⏰ แจ้งเตือนลงเวลาออก\nพนักงาน: ${name}\nไซต์: ${site}\nหมดเวลางาน: ${bangkokTime(expectedEnd)}\nกรุณาลงเวลาออก\n${siteUrl}/time-tracking`
    // Reserve the unique event before contacting LINE. If another cron run already
    // owns this event, the unique constraint returns 23505 and this run sends nothing.
    const eventId=await reserveEvent(settings.company_id,session.id,eventType,settings.line_group_id,message)
    if(!eventId)continue
    const deliveryKey=`${settings.company_id}:${settings.line_group_id??'-'}:${eventType}`
    const pending=pendingDeliveries.get(deliveryKey)??{companyId:settings.company_id,destination:settings.line_group_id,eventType,events:[]} as PendingDelivery
    pending.events.push({id:eventId,sessionId:session.id,message})
    pendingDeliveries.set(deliveryKey,pending)
  }
  }
  for(const pending of pendingDeliveries.values()){
    const heading=pending.eventType==='morning_summary'?'⚠️ สรุปรายการลืมลงเวลาออก':'⏰ สรุปแจ้งเตือนลงเวลาออก'
    const combined=`${heading}\nจำนวน ${pending.events.length} รายการ\n\n${pending.events.map((item,index)=>`${index+1}. ${item.message.replace(/^[^\n]+\n/,'')}`).join('\n\n')}`.slice(0,4900)
    const delivery=await sendLine(pending.destination,combined,pending.eventType==='morning_summary'?'high':'normal')
    const eventStatus=delivery.status==='quota_blocked'?'skipped':delivery.status
    for(const event of pending.events){
      const finishError=await finishEvent(pending.companyId,event.id,eventStatus as 'sent'|'failed'|'skipped',delivery.error)
      results.push({company_id:pending.companyId,session_id:event.sessionId,event_type:pending.eventType,status:delivery.status,log_error:finishError})
    }
  }
  return json({status:'completed',companies:activeSettings.length,checked,events:results})
})
