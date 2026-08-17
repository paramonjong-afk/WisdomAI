import { createClient } from 'npm:@supabase/supabase-js@2'

const url=Deno.env.get('SUPABASE_URL')!
const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const botToken=Deno.env.get('TELEGRAM_BOT_TOKEN')??''
const webhookSecret=Deno.env.get('TELEGRAM_WEBHOOK_SECRET')??''
const setupSecret=Deno.env.get('AUTOMATION_WORKER_SECRET')??''
const geminiKey=Deno.env.get('GEMINI_API_KEY')??''
const siteUrl=Deno.env.get('WISDOMAI_SITE_URL')??'https://wisdomai-react.vercel.app'
const admin=createClient(url,serviceKey,{auth:{persistSession:false}})
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8'}})

type TelegramUpdate={
  update_id:number
  message?:{message_id:number;chat:{id:number|string;title?:string;type:string};from?:{id:number|string;username?:string;first_name?:string;last_name?:string};text?:string;voice?:{file_id:string;file_size?:number;mime_type?:string};location?:{latitude:number;longitude:number;horizontal_accuracy?:number};photo?:Array<{file_id:string;file_size?:number;width:number;height:number}>}
  callback_query?:{id:string;from:{id:number|string;username?:string;first_name?:string;last_name?:string};message?:{message_id:number;text?:string;chat:{id:number|string;title?:string;type:string}};data?:string}
  my_chat_member?:{chat:{id:number|string;title?:string;type:string};from?:{id:number|string};new_chat_member:{status:string}}
}

async function telegram(method:string,body:Record<string,unknown>){
  if(!botToken)throw new Error('TELEGRAM_BOT_TOKEN is not configured')
  const response=await fetch(`https://api.telegram.org/bot${botToken}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
  const payload=await response.json().catch(()=>({})) as {ok?:boolean;description?:string;result?:unknown}
  if(!response.ok||!payload.ok)throw new Error(`Telegram ${method}: ${payload.description??response.status}`)
  return payload.result
}

const sendText=(chatId:string,text:string,replyMarkup?:unknown)=>telegram('sendMessage',{chat_id:chatId,text:text.slice(0,4000),parse_mode:'HTML',disable_web_page_preview:true,...(replyMarkup?{reply_markup:replyMarkup}:{})})
const answerCallback=(id:string,text:string)=>telegram('answerCallbackQuery',{callback_query_id:id,text:text.slice(0,180),show_alert:false})
const finishCallbackMessage=async(callback:NonNullable<TelegramUpdate['callback_query']>,actionLabel:string,statusLabel:string)=>{
  const message=callback.message
  if(!message)return
  const actor=[callback.from.first_name,callback.from.last_name].filter(Boolean).join(' ')||callback.from.username||String(callback.from.id)
  const original=(message.text??'').replace(/\n\n(?:✅|⛔|ℹ️|✏️) เลือกแล้ว[\s\S]*$/,'').trim()
  const selectedAt=new Intl.DateTimeFormat('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'short',timeStyle:'medium'}).format(new Date())
  const suffix=`\n\n✅ เลือกแล้ว: ${escapeHtml(actionLabel)}\nโดย: ${escapeHtml(actor)}\nเวลา: ${escapeHtml(selectedAt)}\nสถานะ: ${escapeHtml(statusLabel)}`
  try{
    await telegram('editMessageText',{chat_id:String(message.chat.id),message_id:message.message_id,text:`${original}${suffix}`.slice(0,4096),parse_mode:'HTML',reply_markup:{inline_keyboard:[]}})
  }catch(error){
    console.error('telegram_callback_message_finalize_failed',error)
    await telegram('editMessageReplyMarkup',{chat_id:String(message.chat.id),message_id:message.message_id,reply_markup:{inline_keyboard:[]}}).catch(()=>undefined)
  }
}
const escapeHtml=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
const normalizeEmploymentType=(value:unknown)=>{
  const normalized=String(value??'').trim().toLowerCase()
  if(['daily','รายวัน','ลูกจ้างรายวัน'].includes(normalized))return'daily'
  if(['monthly','รายเดือน','พนักงานรายเดือน'].includes(normalized))return'monthly'
  if(['temporary','ชั่วคราว'].includes(normalized))return'temporary'
  if(['contractor','ผู้รับเหมา','เหมาช่วง'].includes(normalized))return'contractor'
  return normalized
}

async function resolveAdmin(telegramUserId:string){
  const {data:account}=await admin.from('telegram_admin_accounts').select('company_id,profile_id,active').eq('telegram_user_id',telegramUserId).eq('active',true).maybeSingle()
  if(!account)return null
  const {data:membership}=await admin.from('company_members').select('company_role,active').eq('company_id',account.company_id).eq('profile_id',account.profile_id).eq('active',true).maybeSingle()
  if(!membership||!['company_admin','executive','manager'].includes(membership.company_role))return null
  return{...account,company_role:membership.company_role}
}

async function resolvePlatformAdmin(telegramUserId:string){
  const {data:account}=await admin.from('telegram_admin_accounts').select('profile_id,active').eq('telegram_user_id',telegramUserId).eq('active',true).maybeSingle()
  if(!account)return null
  const {data:profile}=await admin.from('profiles').select('id,platform_role').eq('id',account.profile_id).maybeSingle()
  return profile?.platform_role==='admin'?{profile_id:profile.id}:null
}

async function sendLineGroupAssignmentRequest(requestId:string){
  const {data:requestRow,error:requestError}=await admin.from('line_group_assignment_requests')
    .select('id,line_group_id,display_name,status,notification_status,notification_attempts')
    .eq('id',requestId).maybeSingle()
  if(requestError)throw requestError
  if(!requestRow||requestRow.status!=='pending')return{sent:0,status:'not_pending'}

  const {data:claimed,error:claimError}=await admin.from('line_group_assignment_requests').update({
    notification_status:'sending',notification_attempts:(requestRow.notification_attempts??0)+1,
    notification_error:null,updated_at:new Date().toISOString(),
  }).eq('id',requestId).neq('notification_status','sending').select('id').maybeSingle()
  if(claimError)throw claimError
  if(!claimed)return{sent:0,status:'already_sending'}

  const [{data:options,error:optionError},{data:platformProfiles,error:profileError}]=await Promise.all([
    admin.from('line_group_assignment_options').select('id,company_id,expires_at,companies(name)').eq('request_id',requestId).gt('expires_at',new Date().toISOString()),
    admin.from('profiles').select('id').eq('platform_role','admin'),
  ])
  if(optionError||profileError)throw optionError??profileError
  const profileIds=(platformProfiles??[]).map(row=>row.id)
  const {data:accounts,error:accountError}=profileIds.length
    ?await admin.from('telegram_admin_accounts').select('company_id').in('profile_id',profileIds).eq('active',true)
    :{data:[],error:null}
  if(accountError)throw accountError
  const companyIds=[...new Set((accounts??[]).map(row=>row.company_id))]
  const {data:chats,error:chatError}=companyIds.length
    ?await admin.from('telegram_admin_chats').select('telegram_chat_id').in('company_id',companyIds).eq('active',true)
    :{data:[],error:null}
  if(chatError)throw chatError

  const keyboard=(options??[]).map(option=>[{
    text:`🏢 ${(option.companies as {name?:string}|null)?.name??'เลือกบริษัท'}`,
    callback_data:`line_group_assign:${option.id}`,
  }])
  const text=`🆕 <b>พบกลุ่ม LINE ใหม่</b>\nกลุ่ม: ${escapeHtml(requestRow.display_name??'ไม่พบชื่อกลุ่ม')}\nสถานะ: กักข้อมูลไว้ ยังไม่ผูกกับบริษัท\n\nกรุณาเลือกบริษัทเจ้าของกลุ่ม ข้อมูลหลังจากอนุมัติเท่านั้นจึงจะเข้าบริษัทนั้น`
  const uniqueChats=[...new Set((chats??[]).map(row=>String(row.telegram_chat_id)))]
  const deliveries=await Promise.allSettled(uniqueChats.map(chatId=>sendText(chatId,text,{inline_keyboard:keyboard})))
  let sent=deliveries.filter(result=>result.status==='fulfilled').length

  if(sent===0){
    const {data:fallback}=await admin.from('line_groups').select('line_group_id').eq('active',true).eq('display_name','กลุ่มทดสอบโปรแกรม').limit(1).maybeSingle()
    const lineToken=Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN')??''
    if(fallback?.line_group_id&&lineToken){
      const response=await fetch('https://api.line.me/v2/bot/message/push',{
        method:'POST',headers:{authorization:`Bearer ${lineToken}`,'content-type':'application/json'},
        body:JSON.stringify({to:fallback.line_group_id,messages:[{type:'text',text:`พบกลุ่ม LINE ใหม่: ${requestRow.display_name??'ไม่พบชื่อ'}\nกรุณาให้ Platform Admin เลือกบริษัทที่ ${siteUrl}/line-monitor`}]}),
      })
      if(response.ok)sent=1
    }
  }

  const notificationStatus=sent>0?'sent':'failed'
  await admin.from('line_group_assignment_requests').update({
    notification_status:notificationStatus,notified_at:sent>0?new Date().toISOString():null,
    notification_error:sent>0?null:'No active Platform Admin Telegram chat or LINE fallback',updated_at:new Date().toISOString(),
  }).eq('id',requestId).eq('status','pending')
  return{sent,status:notificationStatus}
}

async function resolveAttendanceIdentity(telegramUserId:string){
  const {data:identity}=await admin.from('attendance_channel_identities').select('company_id,profile_id,active').eq('channel','telegram').eq('external_user_id',telegramUserId).eq('active',true).maybeSingle()
  if(!identity)return null
  const {data:membership}=await admin.from('company_members').select('active').eq('company_id',identity.company_id).eq('profile_id',identity.profile_id).eq('active',true).maybeSingle()
  return membership?identity:null
}

async function statusText(companyId:string){
  const [{data:items},{data:checks},{count:incidents}]=await Promise.all([
    admin.from('system_work_items').select('work_key,title,status,progress,production_status').or(`company_id.is.null,company_id.eq.${companyId}`).order('work_key'),
    admin.from('health_monitor_checks').select('status'),
    admin.from('health_monitor_incidents').select('id',{count:'exact',head:true}).eq('status','open'),
  ])
  const counts=(checks??[]).reduce((sum,row)=>{sum[row.status]=(sum[row.status]??0)+1;return sum},{} as Record<string,number>)
  const work=(items??[]).reduce((sum,row)=>{sum[row.status]=(sum[row.status]??0)+1;return sum},{} as Record<string,number>)
  return `📊 <b>สถานะ WisdomAI</b>\nระบบ: 🟢 ${counts.healthy??0}  🟠 ${counts.warning??0}  🔴 ${counts.critical??0}\nเหตุขัดข้องที่เปิดอยู่: ${incidents??0}\n\nงาน: พร้อมทำ ${work.ready??0} · กำลังทำ ${work.doing??0} · รอตรวจ ${work.review??0} · เสร็จ ${work.done??0} · ติดปัญหา ${work.blocked??0}\n${siteUrl}/system-health`
}

async function tasksText(companyId:string){
  const {data}=await admin.from('system_work_items').select('work_key,title,status,progress,risk').or(`company_id.is.null,company_id.eq.${companyId}`).in('status',['ready','doing','review','blocked']).order('status').order('work_key').limit(25)
  const lines=(data??[]).map(item=>`${item.status==='review'?'🟣':item.status==='doing'?'🟠':item.status==='blocked'?'🔴':'🔵'} <b>${item.work_key}</b> ${item.title} · ${item.progress}%`)
  return `📋 <b>งานที่ยังไม่เสร็จ</b>\n${lines.length?lines.join('\n'):'ไม่มีงานค้าง'}\n\n${siteUrl}/system-health`
}

async function transcribeVoice(fileId:string){
  if(!geminiKey)return null
  const file=await telegram('getFile',{file_id:fileId}) as {file_path?:string}
  if(!file?.file_path)return null
  const response=await fetch(`https://api.telegram.org/file/bot${botToken}/${file.file_path}`)
  if(!response.ok)return null
  const bytes=new Uint8Array(await response.arrayBuffer())
  if(bytes.length>8_000_000)throw new Error('Voice file is too large')
  let binary='';for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768))
  const ai=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:'ถอดเสียงภาษาไทยนี้เป็นข้อความคำสั่งสั้น ๆ เท่านั้น ห้ามอธิบายเพิ่ม'},{inlineData:{mimeType:'audio/ogg',data:btoa(binary)}}]}]})})
  if(!ai.ok)return null
  const payload=await ai.json() as {candidates?:{content?:{parts?:{text?:string}[]}}[]}
  return payload.candidates?.[0]?.content?.parts?.map(part=>part.text??'').join('').trim()||null
}

function normalizeCommand(text:string){return text.trim().toLowerCase().replace(/^\//,'').replace(/\s+/g,' ')}

function attendanceAction(command:string):'clock_in'|'clock_out'|null{
  if(['clockin','in','ลงเวลาเข้า','เข้างาน','เช็คอิน'].includes(command))return'clock_in'
  if(['clockout','out','ลงเวลาออก','เลิกงาน','เช็คเอาท์'].includes(command))return'clock_out'
  return null
}

async function createTelegramAttendanceRequest(actor:{company_id:string;profile_id:string},chatId:string,userId:string,updateId:number,action:'clock_in'|'clock_out',transcript:string|null){
  let siteId:string|null=null,sessionId:string|null=null
  if(action==='clock_out'){
    const {data:open}=await admin.from('attendance_sessions').select('id,site_id').eq('company_id',actor.company_id).eq('profile_id',actor.profile_id).is('clock_out_at',null).not('status','in','(rejected,duplicate)').order('clock_in_at',{ascending:false}).limit(1).maybeSingle()
    siteId=open?.site_id??null;sessionId=open?.id??null
  }
  const missing=['location','selfie',...(!siteId?['site']:[])]
  const {data,error}=await admin.from('attendance_channel_requests').insert({
    company_id:actor.company_id,channel:'telegram',external_event_id:String(updateId),external_user_id:userId,external_chat_id:chatId,
    profile_id:actor.profile_id,site_id:siteId,attendance_session_id:sessionId,action,requested_at:new Date().toISOString(),
    transcript,missing_fields:missing,status:'information_required',source_payload:{telegram_update_id:updateId},
  }).select('id').single()
  if(error)throw error
  await admin.from('attendance_channel_events').insert({company_id:actor.company_id,request_id:data.id,actor_profile_id:actor.profile_id,event_type:'received',details:{channel:'telegram',missing_fields:missing}})
  return data.id as string
}

type PendingAttendanceRequest={id:string;company_id:string;profile_id:string;site_id:string|null;action:'clock_in'|'clock_out';latitude:number|null;longitude:number|null;accuracy_meters:number|null;selfie_path:string|null;missing_fields:string[]}

async function latestTelegramAttendanceRequest(actor:{company_id:string;profile_id:string},chatId:string,userId:string){
  const cutoff=new Date(Date.now()-10*60_000).toISOString()
  const {data,error}=await admin.from('attendance_channel_requests')
    .select('id,company_id,profile_id,site_id,action,latitude,longitude,accuracy_meters,selfie_path,missing_fields')
    .eq('company_id',actor.company_id).eq('profile_id',actor.profile_id).eq('channel','telegram')
    .eq('external_chat_id',chatId).eq('external_user_id',userId)
    .in('status',['information_required','awaiting_confirmation']).gte('requested_at',cutoff)
    .order('requested_at',{ascending:false}).limit(1).maybeSingle()
  if(error)throw error
  return data as PendingAttendanceRequest|null
}

const distanceMeters=(latitude:number,longitude:number,siteLatitude:number,siteLongitude:number)=>{
  const radians=(value:number)=>value*Math.PI/180
  const latitudeDelta=radians(siteLatitude-latitude),longitudeDelta=radians(siteLongitude-longitude)
  const value=Math.sin(latitudeDelta/2)**2+Math.cos(radians(latitude))*Math.cos(radians(siteLatitude))*Math.sin(longitudeDelta/2)**2
  return 6371000*2*Math.atan2(Math.sqrt(value),Math.sqrt(1-value))
}

async function resolveNearestAttendanceSite(actor:{company_id:string;profile_id:string},latitude:number,longitude:number){
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
  const {data:assignments,error:assignmentError}=await admin.from('employee_site_assignments').select('site_id')
    .eq('company_id',actor.company_id).eq('profile_id',actor.profile_id).eq('active',true).lte('starts_on',today).or(`ends_on.is.null,ends_on.gte.${today}`)
  if(assignmentError)throw assignmentError
  const assignedIds=(assignments??[]).map(row=>row.site_id)
  let query=admin.from('project_sites').select('id,name,latitude,longitude,radius_meters').eq('company_id',actor.company_id).eq('active',true)
  if(assignedIds.length)query=query.in('id',assignedIds)
  const {data:sites,error:siteError}=await query
  if(siteError)throw siteError
  const ranked=(sites??[]).filter(site=>Number.isFinite(site.latitude)&&Number.isFinite(site.longitude)).map(site=>({...site,distance:distanceMeters(latitude,longitude,Number(site.latitude),Number(site.longitude))})).sort((a,b)=>a.distance-b.distance)
  return ranked[0]??null
}

async function downloadTelegramPhoto(fileId:string){
  const file=await telegram('getFile',{file_id:fileId}) as {file_path?:string}
  if(!file.file_path)throw new Error('telegram_photo_path_missing')
  const response=await fetch(`https://api.telegram.org/file/bot${botToken}/${file.file_path}`)
  if(!response.ok)throw new Error(`telegram_photo_download_failed_${response.status}`)
  const bytes=new Uint8Array(await response.arrayBuffer())
  if(bytes.length>10_000_000)throw new Error('telegram_photo_too_large')
  return{bytes,contentType:response.headers.get('content-type')??'image/jpeg'}
}

type EmployeeIntake={id:string;company_id:string;status:string;purpose:string|null;extracted_data:Record<string,unknown>;missing_fields:string[];document_count:number}

const bytesToBase64=(bytes:Uint8Array)=>{
  let binary='';for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768))
  return btoa(binary)
}

const sha256Hex=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(value=>value.toString(16).padStart(2,'0')).join('')

async function latestEmployeeIntake(actor:{company_id:string;profile_id:string},chatId:string,userId:string){
  // Keep a short-lived conversation context so an Admin can answer naturally
  // without replying to a specific Bot message. Tenant + chat + sender remain
  // the strongest match; cross-channel intake is used only when unambiguous.
  const cutoff=new Date(Date.now()-24*60*60_000).toISOString()
  const {data,error}=await admin.from('employee_intakes').select('id,company_id,status,purpose,extracted_data,missing_fields,document_count')
    .eq('company_id',actor.company_id).eq('channel','telegram').eq('external_chat_id',chatId).eq('external_user_id',userId)
    .in('status',['awaiting_purpose','collecting_documents','information_required','pending_review']).gte('updated_at',cutoff)
    .order('updated_at',{ascending:false}).limit(1).maybeSingle()
  if(error)throw error
  if(data)return data as EmployeeIntake
  const {data:fallback,error:fallbackError}=await admin.from('employee_intakes').select('id,company_id,status,purpose,extracted_data,missing_fields,document_count')
    .eq('company_id',actor.company_id).in('status',['awaiting_purpose','collecting_documents','information_required','pending_review']).gte('updated_at',cutoff)
    .order('updated_at',{ascending:false}).limit(2)
  if(fallbackError)throw fallbackError
  return fallback?.length===1?fallback[0] as EmployeeIntake:null
}

const looksLikeCandidateName=(value:string)=>{
  const normalized=value.replace(/\s+/g,' ').trim()
  if(normalized.length<4||normalized.length>120||normalized.includes(':')||normalized.startsWith('/'))return false
  // Thai names contain combining marks (Unicode category M) in addition to
  // letters, so accepting only \p{L} incorrectly rejects valid Thai names.
  if(!/^[\p{L}\p{M}.\-' ]+$/u.test(normalized))return false
  const parts=normalized.split(' ').filter(Boolean)
  return parts.length>=2&&parts.length<=5
}

function parseEmployeeIntakeAdditions(text:string,intake:EmployeeIntake){
  const allowed=new Set(['phone','position','employment_type','start_date','candidate_name'])
  const additions:Record<string,string>={}
  for(const line of text.split(/\r?\n/)){
    const conversationalLine=line.replace(/^\[[^\]]+\][^:]{0,80}:\s*/,'').trim()
    const match=/^([a-z_]+)\s*:\s*(.+)$/i.exec(conversationalLine)
    if(match&&allowed.has(match[1].toLowerCase()))additions[match[1].toLowerCase()]=match[2].trim()
    const phone=/(?:^|\D)(0\d{9})(?:\D|$)/.exec(conversationalLine)?.[1]
    if(phone&&!additions.phone)additions.phone=phone
    if(!additions.employment_type){
      if(/(?:ลูกจ้าง)?รายวัน/.test(conversationalLine))additions.employment_type='รายวัน'
      else if(/(?:ลูกจ้าง)?รายเดือน|พนักงานเงินเดือน/.test(conversationalLine))additions.employment_type='รายเดือน'
      else if(/รายชั่วโมง/.test(conversationalLine))additions.employment_type='รายชั่วโมง'
      else if(/(?:จ้าง)?เหมา/.test(conversationalLine))additions.employment_type='เหมา'
    }
    const explicitPosition=/ตำแหน่ง\s*[:：]?\s*(.+)$/i.exec(conversationalLine)?.[1]?.trim()
    if(explicitPosition&&!additions.position)additions.position=explicitPosition
    else if(!additions.position&&/^ช่าง[\p{L}\p{M}\s-]{1,60}$/u.test(conversationalLine))additions.position=conversationalLine
    const explicitStart=/(?:start_date|เริ่มงาน|วันที่เริ่มงาน)\s*[:：]?\s*(.+)$/i.exec(conversationalLine)?.[1]?.trim()
    if(explicitStart&&!additions.start_date){
      additions.start_date=/^วันนี้$/i.test(explicitStart)
        ?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
        :explicitStart
    }
  }
  const normalized=text.replace(/\s+/g,' ').trim()
  const needsName=intake.missing_fields.includes('candidate_name')||intake.missing_fields.includes('confirm_name')
  if(!Object.keys(additions).length&&needsName&&looksLikeCandidateName(normalized))additions.candidate_name=normalized
  return additions
}

async function receiveEmployeeIntakePhoto(actor:{company_id:string;profile_id:string},chatId:string,userId:string,updateId:number,message:NonNullable<TelegramUpdate['message']>){
  if(!message.photo?.length)return null
  let intake=await latestEmployeeIntake(actor,chatId,userId)
  let created=false
  if(!intake){
    const {data,error}=await admin.from('employee_intakes').insert({
      company_id:actor.company_id,channel:'telegram',external_chat_id:chatId,external_user_id:userId,
      status:'awaiting_purpose',created_by:actor.profile_id,
    }).select('id,company_id,status,purpose,extracted_data,missing_fields,document_count').single()
    if(error)throw error
    intake=data as EmployeeIntake;created=true
  }
  const photo=[...message.photo].sort((a,b)=>(b.file_size??b.width*b.height)-(a.file_size??a.width*a.height))[0]
  const downloaded=await downloadTelegramPhoto(photo.file_id)
  const hash=await sha256Hex(downloaded.bytes)
  const path=`${actor.company_id}/${intake.id}/telegram-${updateId}-${photo.file_id.slice(-16)}.jpg`
  const {error:uploadError}=await admin.storage.from('employee-intake-documents').upload(path,downloaded.bytes,{contentType:downloaded.contentType,upsert:false})
  if(uploadError&&!uploadError.message.toLowerCase().includes('already exists'))throw uploadError
  const {error:documentError}=await admin.from('employee_intake_documents').upsert({
    company_id:actor.company_id,intake_id:intake.id,source_channel:'telegram',external_file_id:photo.file_id,
    storage_path:path,mime_type:downloaded.contentType,size_bytes:downloaded.bytes.length,content_sha256:hash,extraction_status:'pending',
  },{onConflict:'company_id,source_channel,external_file_id',ignoreDuplicates:true})
  if(documentError)throw documentError
  const {count}=await admin.from('employee_intake_documents').select('id',{count:'exact',head:true}).eq('company_id',actor.company_id).eq('intake_id',intake.id)
  await admin.from('employee_intakes').update({document_count:count??intake.document_count,updated_at:new Date().toISOString()}).eq('id',intake.id).eq('company_id',actor.company_id)
  return{intakeId:intake.id,count:count??intake.document_count,created}
}

async function importLineEmployeeIntake(companyId:string,messageIds:string[]){
  if(!companyId||!messageIds.length||messageIds.length>10)throw new Error('invalid_line_intake_import')
  const {data:messages,error:messageError}=await admin.from('line_messages').select('id,line_message_id,line_group_id').in('id',messageIds).eq('company_id',companyId)
  if(messageError)throw messageError
  if((messages??[]).length!==messageIds.length)throw new Error('line_intake_messages_not_found')
  const {data:intake,error:intakeError}=await admin.from('employee_intakes').insert({
    company_id:companyId,channel:'line',external_chat_id:messages?.[0]?.line_group_id??null,
    purpose:null,status:'awaiting_purpose',document_count:0,
  }).select('id').single()
  if(intakeError)throw intakeError
  const {data:attachments,error:attachmentError}=await admin.from('line_attachments').select('id,message_id,storage_bucket,storage_path,content_type,size_bytes').in('message_id',messageIds)
  if(attachmentError)throw attachmentError
  for(const attachment of attachments??[]){
    const {data:blob,error:downloadError}=await admin.storage.from(attachment.storage_bucket).download(attachment.storage_path)
    if(downloadError||!blob)throw downloadError??new Error('line_intake_attachment_missing')
    const bytes=new Uint8Array(await blob.arrayBuffer())
    const extension=(attachment.content_type??'image/jpeg').includes('png')?'png':(attachment.content_type??'').includes('webp')?'webp':'jpg'
    const targetPath=`${companyId}/${intake.id}/line-${attachment.id}.${extension}`
    const {error:uploadError}=await admin.storage.from('employee-intake-documents').upload(targetPath,bytes,{contentType:attachment.content_type??'image/jpeg',upsert:false})
    if(uploadError)throw uploadError
    const {error:documentError}=await admin.from('employee_intake_documents').insert({
      company_id:companyId,intake_id:intake.id,source_channel:'line',external_file_id:attachment.id,
      storage_path:targetPath,mime_type:attachment.content_type??'image/jpeg',size_bytes:attachment.size_bytes??bytes.length,
      content_sha256:await sha256Hex(bytes),extraction_status:'pending',
    })
    if(documentError)throw documentError
  }
  const documentCount=(attachments??[]).length
  await admin.from('employee_intakes').update({document_count:documentCount,updated_at:new Date().toISOString()}).eq('id',intake.id).eq('company_id',companyId)
  const {data:chats,error:chatError}=await admin.from('telegram_admin_chats').select('telegram_chat_id').eq('company_id',companyId).eq('active',true)
  if(chatError)throw chatError
  const replyMarkup={inline_keyboard:[
    [{text:'👤 พนักงานใหม่',callback_data:`employee_intake:new:${intake.id}`}],
    [{text:'✏️ แก้ไขพนักงานเดิม',callback_data:`employee_intake:update:${intake.id}`}],
    [{text:'📁 เก็บเอกสารเท่านั้น',callback_data:`employee_intake:archive:${intake.id}`}],
    [{text:'⛔ ยกเลิก',callback_data:`employee_intake:cancel:${intake.id}`}],
  ]}
  const uniqueChats=[...new Set((chats??[]).map(chat=>String(chat.telegram_chat_id)))]
  const deliveries=await Promise.allSettled(uniqueChats.map(chatId=>sendText(chatId,`📥 รับเอกสารจาก LINE แล้ว ${documentCount} รายการ\nเอกสารชุดนี้ใช้สำหรับอะไร?\nระบบยังไม่สร้างบัญชีพนักงานจนกว่า Admin จะตรวจอนุมัติ`,replyMarkup)))
  return{intake_id:intake.id,document_count:documentCount,telegram_targets:uniqueChats.length,telegram_sent:deliveries.filter(result=>result.status==='fulfilled').length}
}

async function extractEmployeeDocument(bytes:Uint8Array,mimeType:string){
  if(!geminiKey)throw new Error('employee_document_ai_not_configured')
  const prompt=`Analyze this Thai employee onboarding document. Return JSON only with keys document_type and fields.
Allowed document_type: thai_national_id, house_registration, education_certificate, bank_evidence, portrait, other.
Allowed fields: title_th, first_name_th, last_name_th, first_name_en, last_name_en, date_of_birth (YYYY-MM-DD), nationality, address_line, subdistrict, district, province, postal_code, identifier_last4, education_level, institution_name, major, graduation_year, gpa.
Never return a full national ID, card laser code, religion, portrait embedding, raw OCR text, or data about other household members. Use null for uncertain values.`
  const requestBody=JSON.stringify({generationConfig:{responseMimeType:'application/json'},contents:[{parts:[{text:prompt},{inlineData:{mimeType,data:bytesToBase64(bytes)}}]}]})
  let response:Response|null=null
  for(const model of ['gemini-3.6-flash','gemini-3.5-flash','gemini-2.0-flash']){
    response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':geminiKey},body:requestBody})
    if(![404,429,503].includes(response.status))break
  }
  if(!response?.ok)throw new Error(`employee_document_ai_${response?.status??'unavailable'}`)
  const payload=await response.json() as {candidates?:{content?:{parts?:{text?:string}[]}}[]}
  const text=payload.candidates?.[0]?.content?.parts?.map(part=>part.text??'').join('').trim()??'{}'
  return JSON.parse(text) as {document_type?:string;fields?:Record<string,unknown>;confidence?:number}
}

async function analyzeEmployeeIntake(actor:{company_id:string;profile_id:string},intakeId:string){
  const {data:intake,error:intakeError}=await admin.from('employee_intakes').select('id,company_id,status,extracted_data,candidate_name').eq('id',intakeId).eq('company_id',actor.company_id).maybeSingle()
  if(intakeError)throw intakeError
  if(!intake)throw new Error('employee_intake_not_found')
  await admin.from('employee_intakes').update({purpose:'new_employee',status:'extracting',updated_at:new Date().toISOString()}).eq('id',intakeId)
  const {data:documents,error:documentError}=await admin.from('employee_intake_documents').select('id,storage_path,mime_type').eq('company_id',actor.company_id).eq('intake_id',intakeId).order('created_at')
  if(documentError)throw documentError
  const existing=(intake.extracted_data??{}) as Record<string,unknown>
  const merged:Record<string,unknown>={}
  for(const key of ['candidate_name','phone','employment_type','position','start_date'])if(existing[key]!=null&&existing[key]!=='')merged[key]=existing[key]
  if(!merged.candidate_name&&intake.candidate_name)merged.candidate_name=intake.candidate_name
  const previousDelivery=existing._telegram_delivery
  if(previousDelivery)merged._telegram_delivery=previousDelivery
  const previousInput=existing._telegram_input
  if(previousInput)merged._telegram_input=previousInput
  const nameVariants=new Set<string>();let completedDocuments=0;let failedDocuments=0
  for(const document of documents??[]){
    try{
      await admin.from('employee_intake_documents').update({extraction_status:'processing'}).eq('id',document.id)
      const {data:blob,error:downloadError}=await admin.storage.from('employee-intake-documents').download(document.storage_path)
      if(downloadError||!blob)throw downloadError??new Error('employee_intake_document_missing')
      const result=await extractEmployeeDocument(new Uint8Array(await blob.arrayBuffer()),document.mime_type)
      const safeFields=result.fields??{}
      delete safeFields.national_id;delete safeFields.identification_number;delete safeFields.raw_text;delete safeFields.religion
      const fullName=[safeFields.first_name_th,safeFields.last_name_th].filter(Boolean).join(' ')
      if(fullName)nameVariants.add(fullName)
      for(const [key,value] of Object.entries(safeFields))if(value!==null&&value!==''&&merged[key]==null)merged[key]=value
      const allowedDocumentTypes=new Set(['thai_national_id','house_registration','education_certificate','bank_evidence','portrait','other'])
      const documentType=allowedDocumentTypes.has(result.document_type??'')?result.document_type:'other'
      if(documentType==='other'&&!Object.keys(safeFields).length)throw new Error('employee_document_no_readable_fields')
      await admin.from('employee_intake_documents').update({document_type:documentType,extracted_fields:safeFields,extraction_status:'completed',updated_at:new Date().toISOString()}).eq('id',document.id)
      completedDocuments+=1
    }catch(error){
      failedDocuments+=1
      const errorCode=error instanceof Error&&/^employee_document_[a-z0-9_]+$/.test(error.message)?error.message:'employee_document_analysis_failed'
      await admin.from('employee_intake_documents').update({extracted_fields:{error_code:errorCode},extraction_status:'failed',updated_at:new Date().toISOString()}).eq('id',document.id)
    }
  }
  merged.extraction_summary={completed_documents:completedDocuments,failed_documents:failedDocuments,total_documents:(documents??[]).length}
  merged.name_variants=[...nameVariants]
  const candidateName=String(merged.candidate_name??[merged.first_name_th,merged.last_name_th].filter(Boolean).join(' '))
  const required=['candidate_name','phone','employment_type','position','start_date']
  const missing=required.filter(field=>field==='candidate_name'?!candidateName:!merged[field])
  if(nameVariants.size>1&&!merged.candidate_name)missing.unshift('confirm_name')
  const allUnreadable=completedDocuments===0
  if(allUnreadable&&!missing.includes('document_read_failed'))missing.unshift('document_read_failed')
  const status=allUnreadable?'failed':missing.length?'information_required':'pending_review'
  const {data,error}=await admin.from('employee_intakes').update({candidate_name:candidateName||null,extracted_data:merged,missing_fields:missing,status,submitted_at:status==='pending_review'?new Date().toISOString():null,updated_at:new Date().toISOString()}).eq('id',intakeId).eq('company_id',actor.company_id).select('id,candidate_name,extracted_data,missing_fields,status,document_count').single()
  if(error)throw error
  return data as EmployeeIntake&{candidate_name:string|null}
}

function employeeIntakeSummary(intake:EmployeeIntake&{candidate_name?:string|null}){
  const data=intake.extracted_data??{}
  const labels:Record<string,string>={document_read_failed:'เอกสารอ่านไม่สำเร็จ',confirm_name:'ยืนยันชื่อ–นามสกุล',candidate_name:'ชื่อ–นามสกุล',phone:'เบอร์โทรศัพท์',employment_type:'ประเภทการจ้าง',position:'ตำแหน่ง',start_date:'วันที่เริ่มงาน'}
  const variants=Array.isArray(data.name_variants)?data.name_variants.map(value=>String(value)).filter(Boolean):[]
  const nameLine=intake.candidate_name?`👤 <b>ชื่อ–นามสกุล: ${escapeHtml(intake.candidate_name)}</b>`:'⚠️ <b>อ่านชื่อ–นามสกุลไม่สำเร็จ</b> กรุณากรอกชื่อหรือส่งภาพใหม่'
  const mismatch=variants.length>1?`\n⚠️ ชื่อในเอกสารไม่ตรงกัน: ${variants.map(escapeHtml).join(' / ')}`:''
  const found=[data.date_of_birth?`วันเกิด: ${escapeHtml(String(data.date_of_birth))}`:null,data.education_level||data.major?`การศึกษา: ${escapeHtml(String(data.education_level??''))} ${escapeHtml(String(data.major??''))}`.trim():null].filter(Boolean)
  const extraction=data.extraction_summary as {completed_documents?:number;failed_documents?:number}|undefined
  const unreadable=intake.status==='failed'||extraction?.completed_documents===0
  if(unreadable)return `❌ <b>อ่านข้อมูลจากเอกสารไม่ได้</b>\n📄 เอกสาร: ${intake.document_count} รายการ\nระบบยังไม่พบชื่อหรือข้อมูลหลักที่เชื่อถือได้ จึงไม่สร้างร่างพนักงานและไม่เปิดให้อนุมัติ\n\nกรุณาถ่ายใหม่ให้เอกสารเต็มกรอบ ตัวอักษรชัด ไม่มีแสงสะท้อน และส่งอีกครั้ง`
  return `${nameLine}${mismatch}\n📄 เอกสาร: ${intake.document_count} รายการ\n${found.join('\n')}\n\n${intake.missing_fields.length?`ข้อมูลที่ยังขาด: ${intake.missing_fields.map(item=>labels[item]??item).join(', ')}\nส่งข้อมูลเพิ่มในรูปแบบ เช่น\n<code>candidate_name: ชื่อ นามสกุล\nphone: 08xxxxxxxx\nposition: ช่างไฟฟ้า\nemployment_type: รายวัน\nstart_date: 2026-08-12</code>`:'ข้อมูลขั้นต่ำครบแล้วและรอ Admin ตรวจ'}`
}

async function broadcastEmployeeIntake(companyId:string,intakeId:string,text:string,replyMarkup:unknown,type:string){
  const {data:intake,error:intakeError}=await admin.from('employee_intakes').select('extracted_data').eq('id',intakeId).eq('company_id',companyId).maybeSingle()
  if(intakeError)throw intakeError
  if(!intake)throw new Error('employee_intake_not_found')
  const fingerprint=await sha256Hex(new TextEncoder().encode(`${type}\n${text}`))
  const extractedData=(intake.extracted_data??{}) as Record<string,unknown>
  const previous=extractedData._telegram_delivery as {fingerprint?:string;sent_at?:string}|undefined
  if(previous?.fingerprint===fingerprint&&previous.sent_at&&Date.now()-new Date(previous.sent_at).getTime()<15*60_000)return{telegram_targets:0,telegram_sent:0,duplicate_skipped:true}
  const {data:chats,error:chatError}=await admin.from('telegram_admin_chats').select('telegram_chat_id').eq('company_id',companyId).eq('active',true)
  if(chatError)throw chatError
  const uniqueChats=[...new Set((chats??[]).map(chat=>String(chat.telegram_chat_id)))]
  const deliveries=await Promise.allSettled(uniqueChats.map(chatId=>sendText(chatId,text,replyMarkup)))
  const sent=deliveries.filter(result=>result.status==='fulfilled').length
  if(sent)await admin.from('employee_intakes').update({extracted_data:{...extractedData,_telegram_delivery:{fingerprint,sent_at:new Date().toISOString(),type}},updated_at:new Date().toISOString()}).eq('id',intakeId).eq('company_id',companyId)
  return{telegram_targets:uniqueChats.length,telegram_sent:sent,duplicate_skipped:false}
}

async function previewEmployeeIntake(companyId:string,intakeId:string){
  const analyzed=await analyzeEmployeeIntake({company_id:companyId,profile_id:''},intakeId)
  const {error}=analyzed.status==='failed'?{error:null}:await admin.from('employee_intakes').update({purpose:null,status:'awaiting_purpose',submitted_at:null,updated_at:new Date().toISOString()}).eq('id',intakeId).eq('company_id',companyId)
  if(error)throw error
  const replyMarkup={inline_keyboard:[
    [{text:'👤 พนักงานใหม่',callback_data:`employee_intake:new:${intakeId}`}],
    [{text:'✏️ แก้ไขพนักงานเดิม',callback_data:`employee_intake:update:${intakeId}`}],
    [{text:'📁 เก็บเอกสารเท่านั้น',callback_data:`employee_intake:archive:${intakeId}`}],
    [{text:'⛔ ยกเลิก',callback_data:`employee_intake:cancel:${intakeId}`}],
  ]}
  const text=analyzed.status==='failed'?employeeIntakeSummary(analyzed):`🔎 <b>ข้อมูลสำคัญก่อนตัดสินใจ</b>\n${employeeIntakeSummary(analyzed)}\n\nเลขบัตรเต็มและข้อมูลอ่อนไหวไม่แสดงใน Telegram\nกรุณาเลือกการดำเนินการ:`
  return broadcastEmployeeIntake(companyId,intakeId,text,analyzed.status==='failed'?undefined:replyMarkup,'preview')
}

async function receiveEmployeeIntakeFields(actor:{company_id:string;profile_id:string},chatId:string,userId:string,text:string){
  const intake=await latestEmployeeIntake(actor,chatId,userId)
  if(!intake||!['awaiting_purpose','information_required','pending_review'].includes(intake.status))return null
  const additions=parseEmployeeIntakeAdditions(text,intake)
  if(!Object.keys(additions).length)return null
  const normalizedInput=text.replace(/\s+/g,' ').trim().toLowerCase()
  const inputFingerprint=await sha256Hex(new TextEncoder().encode(normalizedInput))
  const previousInput=(intake.extracted_data??{})._telegram_input as {fingerprint?:string;received_at?:string}|undefined
  if(previousInput?.fingerprint===inputFingerprint&&previousInput.received_at&&Date.now()-new Date(previousInput.received_at).getTime()<15*60_000){
    return{...intake,candidate_name:'',duplicate_input:true}
  }
  const merged={...(intake.extracted_data??{}),...additions,_telegram_input:{fingerprint:inputFingerprint,received_at:new Date().toISOString()}}
  const candidateName=additions.candidate_name??String(merged.first_name_th&&merged.last_name_th?`${merged.first_name_th} ${merged.last_name_th}`:'')
  const required=['candidate_name','phone','employment_type','position','start_date']
  const missing=required.filter(field=>field==='candidate_name'?!candidateName:!merged[field])
  const status=intake.status==='awaiting_purpose'?'awaiting_purpose':missing.length?'information_required':'pending_review'
  const {data,error}=await admin.from('employee_intakes').update({candidate_name:candidateName||null,extracted_data:merged,missing_fields:missing,status,submitted_at:status==='pending_review'?new Date().toISOString():null,updated_at:new Date().toISOString()}).eq('id',intake.id).eq('company_id',actor.company_id).select('id,candidate_name,extracted_data,missing_fields,status,document_count').single()
  if(error)throw error
  return data as EmployeeIntake&{candidate_name:string|null;duplicate_input?:boolean}
}

async function replayLatestEmployeeIntakeReply(companyId:string,intakeId:string){
  const {data:intake}=await admin.from('employee_intakes').select('id,created_at,status,missing_fields,extracted_data,purpose,document_count,company_id').eq('id',intakeId).eq('company_id',companyId).maybeSingle()
  if(!intake)throw new Error('employee_intake_not_found')
  const {data:event,error:eventError}=await admin.from('telegram_admin_events').select('telegram_chat_id,telegram_user_id,command')
    .eq('company_id',companyId).eq('event_type','message').not('command','is',null).gte('created_at',intake.created_at)
    .order('created_at',{ascending:false}).limit(20)
  if(eventError)throw eventError
  const reply=(event??[]).find(row=>Object.keys(parseEmployeeIntakeAdditions(String(row.command??''),intake as EmployeeIntake)).length>0)
  if(!reply)throw new Error('employee_intake_reply_not_found')
  const {data:account}=await admin.from('telegram_admin_accounts').select('profile_id').eq('company_id',companyId).eq('telegram_user_id',reply.telegram_user_id).eq('active',true).maybeSingle()
  if(!account)throw new Error('employee_intake_reply_admin_not_linked')
  const updated=await receiveEmployeeIntakeFields({company_id:companyId,profile_id:account.profile_id},String(reply.telegram_chat_id),String(reply.telegram_user_id),String(reply.command))
  if(!updated)throw new Error('employee_intake_reply_not_applied')
  if(updated.duplicate_input)return{reply_applied:false,telegram_sent:0,duplicate_skipped:true}
  const replyMarkup={inline_keyboard:[
    [{text:'👤 พนักงานใหม่',callback_data:`employee_intake:new:${intakeId}`}],
    [{text:'✏️ แก้ไขพนักงานเดิม',callback_data:`employee_intake:update:${intakeId}`}],
    [{text:'📁 เก็บเอกสารเท่านั้น',callback_data:`employee_intake:archive:${intakeId}`}],
    [{text:'⛔ ยกเลิก',callback_data:`employee_intake:cancel:${intakeId}`}],
  ]}
  const delivery=await broadcastEmployeeIntake(companyId,intakeId,`✅ รับข้อมูลที่ตอบกลับแล้ว\n${employeeIntakeSummary(updated)}\n\nกรุณาเลือกการดำเนินการ:`,replyMarkup,'fields_summary')
  return{reply_applied:true,...delivery}
}

async function repairEmployeeIntakeEncoding(companyId:string,intakeId:string){
  const {data:intake,error}=await admin.from('employee_intakes').select('id,candidate_name').eq('id',intakeId).eq('company_id',companyId).maybeSingle()
  if(error)throw error
  if(!intake)throw new Error('employee_intake_not_found')
  // Rebuild allowlisted OCR fields inside the UTF-8 Edge runtime. Keep only
  // the already confirmed name, then replay the latest natural-language
  // Admin message to restore operational fields without exposing PII.
  const {error:resetError}=await admin.from('employee_intakes').update({
    extracted_data:intake.candidate_name?{candidate_name:intake.candidate_name}:{},
    missing_fields:['phone','employment_type','position','start_date'],status:'information_required',
    submitted_at:null,updated_at:new Date().toISOString(),
  }).eq('id',intakeId).eq('company_id',companyId)
  if(resetError)throw resetError
  await analyzeEmployeeIntake({company_id:companyId,profile_id:''},intakeId)
  return replayLatestEmployeeIntakeReply(companyId,intakeId)
}

async function sendEmployeeIntakeSummary(companyId:string,intakeId:string){
  const {data:intake,error}=await admin.from('employee_intakes').select('id,company_id,status,purpose,extracted_data,missing_fields,document_count,candidate_name').eq('id',intakeId).eq('company_id',companyId).maybeSingle()
  if(error)throw error
  if(!intake)throw new Error('employee_intake_not_found')
  const ready=intake.status==='pending_review'&&!(intake.missing_fields??[]).length
  const prompt=ready
    ?`${employeeIntakeSummary(intake as EmployeeIntake&{candidate_name:string|null})}\n\n✅ ข้อมูลครบแล้ว รอ Admin อนุมัติสร้างพนักงานจริง`
    :`${employeeIntakeSummary(intake as EmployeeIntake&{candidate_name:string|null})}\n\nส่งเฉพาะข้อมูลที่ยังขาดตามรูปแบบที่แสดงด้านบน`
  const replyMarkup=ready?{inline_keyboard:[
    [{text:'✅ อนุมัติสร้างประวัติพนักงาน',callback_data:`employee_intake:approve:${intakeId}`}],
    [{text:'✏️ แก้ไขข้อมูล',callback_data:`employee_intake:update:${intakeId}`}],
    [{text:'⛔ ยกเลิก',callback_data:`employee_intake:cancel:${intakeId}`}],
  ]}:{force_reply:true,input_field_placeholder:'ส่งข้อมูลที่ยังขาด'}
  return broadcastEmployeeIntake(companyId,intakeId,prompt,replyMarkup,ready?'review_ready':'missing_fields')
}

async function finalizeTelegramAttendance(requestId:string){
  const {data,error}=await admin.rpc('finalize_telegram_attendance_request',{target_request_id:requestId})
  if(error)throw error
  return(data?.[0]??null) as {session_id:string;result_status:string;distance_meters:number}|null
}

async function sendTelegramAttendanceApproval(companyId:string,sessionId:string){
  const {data:session,error:sessionError}=await admin.from('attendance_sessions')
    .select('id,profile_id,site_id,clock_in_at,clock_out_at,clock_in_distance_meters,clock_out_distance_meters,review_reason,status')
    .eq('company_id',companyId).eq('id',sessionId).eq('status','needs_review').maybeSingle()
  if(sessionError)throw sessionError
  if(!session)return 0
  const [{data:profile},{data:site},{data:chats}]=await Promise.all([
    admin.from('profiles').select('full_name').eq('id',session.profile_id).maybeSingle(),
    admin.from('project_sites').select('name').eq('company_id',companyId).eq('id',session.site_id).maybeSingle(),
    admin.from('telegram_admin_chats').select('telegram_chat_id').eq('company_id',companyId).eq('active',true),
  ])
  const distance=session.clock_out_at?session.clock_out_distance_meters:session.clock_in_distance_meters
  const text=`🟠 <b>รายการลงเวลารอตรวจ</b>\nพนักงาน: ${escapeHtml(profile?.full_name??'ไม่ทราบชื่อ')}\nไซต์: ${escapeHtml(site?.name??'ไม่ทราบไซต์')}\nเวลา: ${new Date(session.clock_out_at??session.clock_in_at).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'})}\nระยะจากไซต์: ${distance==null?'-':`${Math.round(distance)} เมตร`}\nเหตุผล: ${escapeHtml(session.review_reason??'ผิดเงื่อนไขการลงเวลา')}`
  const replyMarkup={inline_keyboard:[
    [{text:'✅ อนุมัติ',callback_data:`attendance:approve:${session.id}`}],
    [{text:'ℹ️ ขอข้อมูลเพิ่ม',callback_data:`attendance:request_more:${session.id}`}],
    [{text:'⛔ ไม่อนุมัติ',callback_data:`attendance:reject:${session.id}`}],
  ]}
  const uniqueChats=[...new Set((chats??[]).map(chat=>String(chat.telegram_chat_id)))]
  const results=await Promise.allSettled(uniqueChats.map(targetChat=>sendText(targetChat,text,replyMarkup)))
  return results.filter(result=>result.status==='fulfilled').length
}

async function sendPendingAttendanceApprovals(companyId:string){
  const {data,error}=await admin.from('attendance_sessions').select('id').eq('company_id',companyId).eq('status','needs_review').order('review_requested_at',{ascending:false}).limit(10)
  if(error)throw error
  let sent=0
  for(const session of data??[])sent+=await sendTelegramAttendanceApproval(companyId,session.id)
  return{items:data?.length??0,sent}
}

async function receiveTelegramAttendanceEvidence(actor:{company_id:string;profile_id:string},chatId:string,userId:string,message:NonNullable<TelegramUpdate['message']>){
  const pending=await latestTelegramAttendanceRequest(actor,chatId,userId)
  if(!pending)return{handled:false as const}
  let siteId=pending.site_id,latitude=pending.latitude,longitude=pending.longitude,accuracy=pending.accuracy_meters,selfiePath=pending.selfie_path
  if(message.location){
    latitude=message.location.latitude;longitude=message.location.longitude;accuracy=message.location.horizontal_accuracy??null
    if(!siteId){
      const nearest=await resolveNearestAttendanceSite(actor,latitude,longitude)
      if(!nearest)throw new Error('ไม่พบไซต์งานที่ใช้งานอยู่สำหรับพนักงาน')
      siteId=nearest.id
    }
  }
  if(message.photo?.length){
    const photo=[...message.photo].sort((a,b)=>(b.file_size??b.width*b.height)-(a.file_size??a.width*a.height))[0]
    const downloaded=await downloadTelegramPhoto(photo.file_id)
    selfiePath=`${actor.profile_id}/telegram/${pending.id}.jpg`
    const {error:uploadError}=await admin.storage.from('attendance-selfies').upload(selfiePath,downloaded.bytes,{contentType:downloaded.contentType,upsert:true})
    if(uploadError)throw uploadError
  }
  const missing=[...(latitude==null||longitude==null?['location']:[]),...(!selfiePath?['selfie']:[]),...(!siteId?['site']:[])]
  const {error:updateError}=await admin.from('attendance_channel_requests').update({site_id:siteId,latitude,longitude,accuracy_meters:accuracy,selfie_path:selfiePath,missing_fields:missing,status:missing.length?'information_required':'awaiting_confirmation',updated_at:new Date().toISOString()}).eq('id',pending.id).eq('company_id',actor.company_id).eq('profile_id',actor.profile_id)
  if(updateError)throw updateError
  await admin.from('attendance_channel_events').insert({company_id:actor.company_id,request_id:pending.id,actor_profile_id:actor.profile_id,event_type:message.location?'location_received':'selfie_received',details:{missing_fields:missing}})
  if(missing.length)return{handled:true as const,requestId:pending.id,missing,result:null}
  return{handled:true as const,requestId:pending.id,missing,result:await finalizeTelegramAttendance(pending.id)}
}

Deno.serve(async request=>{
  if(request.method!=='POST')return json({error:'Method not allowed'},405)
  const setupBody=await request.clone().json().catch(()=>({})) as {action?:string;company_id?:string;message_ids?:string[];intake_id?:string;request_id?:string}
  if(setupBody.action==='send_line_group_assignment_request'){
    if(request.headers.get('authorization')!==`Bearer ${serviceKey}`)return json({error:'Unauthorized'},401)
    try{return json({status:'processed',...(await sendLineGroupAssignmentRequest(setupBody.request_id??''))})}
    catch(error){
      if(setupBody.request_id)await admin.from('line_group_assignment_requests').update({notification_status:'failed',notification_error:error instanceof Error?error.message.slice(0,1000):'notification_failed',updated_at:new Date().toISOString()}).eq('id',setupBody.request_id).eq('status','pending')
      return json({error:error instanceof Error?error.message:'line_group_assignment_notification_failed'},400)
    }
  }
  if(setupBody.action==='preview_employee_intake'){
    if(request.headers.get('authorization')!==`Bearer ${serviceKey}`)return json({error:'Unauthorized'},401)
    try{return json({status:'previewed',...(await previewEmployeeIntake(setupBody.company_id??'',setupBody.intake_id??''))})}
    catch(error){return json({error:error instanceof Error?error.message:'employee_intake_preview_failed'},400)}
  }
  if(setupBody.action==='replay_employee_intake_reply'){
    if(request.headers.get('authorization')!==`Bearer ${serviceKey}`)return json({error:'Unauthorized'},401)
    try{return json({status:'replayed',...(await replayLatestEmployeeIntakeReply(setupBody.company_id??'',setupBody.intake_id??''))})}
    catch(error){return json({error:error instanceof Error?error.message:'employee_intake_reply_replay_failed'},400)}
  }
  if(setupBody.action==='repair_employee_intake_encoding'){
    if(request.headers.get('authorization')!==`Bearer ${serviceKey}`)return json({error:'Unauthorized'},401)
    try{return json({status:'repaired',...(await repairEmployeeIntakeEncoding(setupBody.company_id??'',setupBody.intake_id??''))})}
    catch(error){return json({error:error instanceof Error?error.message:'employee_intake_encoding_repair_failed'},400)}
  }
  if(setupBody.action==='send_employee_intake_summary'){
    if(request.headers.get('authorization')!==`Bearer ${serviceKey}`)return json({error:'Unauthorized'},401)
    try{return json({status:'sent',...(await sendEmployeeIntakeSummary(setupBody.company_id??'',setupBody.intake_id??''))})}
    catch(error){return json({error:error instanceof Error?error.message:'employee_intake_summary_failed'},400)}
  }
  if(setupBody.action==='import_line_employee_intake'){
    if(request.headers.get('authorization')!==`Bearer ${serviceKey}`)return json({error:'Unauthorized'},401)
    try{return json({status:'imported',...(await importLineEmployeeIntake(setupBody.company_id??'',setupBody.message_ids??[]))})}
    catch(error){return json({error:error instanceof Error?error.message:'line_intake_import_failed'},400)}
  }
  if(setupBody.action==='configure_webhook'){
    if(!setupSecret||request.headers.get('x-automation-worker-secret')!==setupSecret)return json({error:'Unauthorized'},401)
    if(!botToken||!webhookSecret)return json({error:'Telegram secrets are not configured'},503)
    const webhookUrl=`${url}/functions/v1/telegram-admin`
    await telegram('setWebhook',{
      url:webhookUrl,
      secret_token:webhookSecret,
      allowed_updates:['message','callback_query','my_chat_member'],
      drop_pending_updates:false,
    })
    const info=await telegram('getWebhookInfo',{}) as {url?:string;pending_update_count?:number;last_error_message?:string}
    return json({status:'configured',url_matches:info.url===webhookUrl,pending_update_count:info.pending_update_count??0,has_error:Boolean(info.last_error_message)})
  }
  if(!webhookSecret||request.headers.get('x-telegram-bot-api-secret-token')!==webhookSecret)return json({error:'Unauthorized'},401)
  let update:TelegramUpdate
  try{update=await request.json()}catch{return json({error:'Invalid JSON'},400)}
  const membership=update.my_chat_member
  if(membership){
    const membershipChatId=String(membership.chat.id)
    const active=['member','administrator','creator'].includes(membership.new_chat_member.status)
    const {error}=await admin.from('telegram_admin_chats').update({
      active,
      title:membership.chat.title??null,
      updated_at:new Date().toISOString(),
    }).eq('telegram_chat_id',membershipChatId)
    if(error)return json({error:error.message},500)
    return json({status:active?'chat_activated':'chat_deactivated'})
  }
  const message=update.message
  const callback=update.callback_query
  const chatId=String(message?.chat.id??callback?.message?.chat.id??'')
  const from=message?.from??callback?.from
  const userId=String(from?.id??'')
  if(!chatId||!userId)return json({status:'ignored'})

  const messageType=callback?'callback':message?.voice?'voice':message?.location?'location':message?.photo?.length?'photo':'message'
  const {data:reserved,error:reserveError}=await admin.from('telegram_admin_events').insert({telegram_update_id:String(update.update_id),telegram_chat_id:chatId,telegram_user_id:userId,event_type:messageType,command:message?.text??callback?.data??null}).select('id').maybeSingle()
  if(reserveError?.code==='23505')return json({status:'duplicate'})
  if(reserveError)return json({error:reserveError.message},500)

  try{
    const spoken=message?.voice?await transcribeVoice(message.voice.file_id):null
    if(spoken)await admin.from('telegram_admin_events').update({command:spoken.slice(0,2000)}).eq('id',reserved!.id)
    const command=normalizeCommand(spoken??message?.text??'')
    const attendance=attendanceAction(command)
    const actor=await resolveAdmin(userId)
    const platformActor=await resolvePlatformAdmin(userId)
    const attendanceIdentity=(attendance||message?.location||message?.photo?.length)?await resolveAttendanceIdentity(userId):null
    if(attendanceIdentity&&message&&(message.location||message.photo?.length)){
      await admin.from('telegram_admin_events').update({company_id:attendanceIdentity.company_id}).eq('id',reserved!.id)
      const evidence=await receiveTelegramAttendanceEvidence(attendanceIdentity,chatId,userId,message)
      if(evidence.handled){
        if(evidence.result){
          await sendText(chatId,`${evidence.result.result_status==='normal'?'✅ บันทึกเวลาสำเร็จ':'🟠 รับข้อมูลแล้วและส่งรอตรวจ'}\nเลขคำขอ: <code>${evidence.requestId}</code>\nระยะจากไซต์: ${Math.round(evidence.result.distance_meters)} เมตร`)
          if(evidence.result.result_status==='needs_review')await sendTelegramAttendanceApproval(attendanceIdentity.company_id,evidence.result.session_id)
        }
        else await sendText(chatId,`📎 รับข้อมูลแล้ว\nเลขคำขอ: <code>${evidence.requestId}</code>\nยังขาด: ${evidence.missing.map(item=>item==='location'?'ตำแหน่ง GPS':item==='selfie'?'รูป Selfie':'ไซต์งาน').join(', ')}`)
        await admin.from('telegram_admin_events').update({status:'processed',processed_at:new Date().toISOString()}).eq('id',reserved!.id)
        return json({status:evidence.result?'attendance_recorded':'attendance_evidence_received'})
      }
    }
    if(attendance&&attendanceIdentity){
      await admin.from('telegram_admin_events').update({company_id:attendanceIdentity.company_id}).eq('id',reserved!.id)
      const requestId=await createTelegramAttendanceRequest(attendanceIdentity,chatId,userId,update.update_id,attendance,spoken)
      await sendText(chatId,`🕐 รับคำขอ${attendance==='clock_in'?'ลงเวลาเข้า':'ลงเวลาออก'}ไว้แล้ว\nเลขคำขอ: <code>${requestId}</code>\nสถานะ: รอข้อมูลตำแหน่งและ Selfie ก่อนตรวจสอบ\n⚠️ ในกลุ่ม Telegram กรุณากด Reply ข้อความนี้ แล้วส่ง GPS; จากนั้น Reply ข้อความตอบของ Bot แล้วส่ง Selfie\nระบบยังไม่สร้างเวลาจริงจนกว่าข้อมูลครบ`,{force_reply:true,input_field_placeholder:'Reply แล้วส่งตำแหน่ง GPS'})
      await admin.from('telegram_admin_events').update({status:'processed',processed_at:new Date().toISOString()}).eq('id',reserved!.id)
      return json({status:'attendance_request_received'})
    }
    if(callback?.data?.startsWith('line_group_assign:')){
      if(!platformActor){await answerCallback(callback.id,'เฉพาะ Platform Admin เท่านั้น');return json({status:'platform_admin_required'})}
      const optionId=callback.data.slice('line_group_assign:'.length)
      const {data,error}=await admin.rpc('approve_line_group_assignment',{target_option_id:optionId,actor_profile_id:platformActor.profile_id})
      if(error){
        await answerCallback(callback.id,error.message.includes('already')?'รายการนี้ถูกจัดการแล้ว':'ไม่สามารถผูกกลุ่ม LINE ได้')
        return json({status:'line_group_assignment_rejected'})
      }
      const result=data?.[0]
      await admin.from('telegram_admin_events').update({company_id:result?.company_id??null,status:'processed',processed_at:new Date().toISOString()}).eq('id',reserved!.id)
      await answerCallback(callback.id,result?.result_status==='already_assigned'?'กลุ่มนี้ถูกผูกแล้ว':`ผูกกับ ${result?.company_name??'บริษัท'} แล้ว`)
      await finishCallbackMessage(callback,`ผูกกลุ่ม LINE กับ ${result?.company_name??'บริษัท'}`,'เริ่มรับข้อมูลของบริษัทนี้แล้ว')
      return json({status:result?.result_status??'assigned'})
    }
    if(!actor){
      await sendText(chatId,`🔐 บัญชี Telegram นี้ยังไม่ได้ผูกสิทธิ์ Admin\nTelegram User ID: <code>${userId}</code>\nกรุณาให้ผู้ดูแลผูก ID นี้ใน WisdomAI`)
      await admin.from('telegram_admin_events').update({status:'ignored',processed_at:new Date().toISOString()}).eq('id',reserved!.id)
      return json({status:'unlinked'})
    }
    await admin.from('telegram_admin_events').update({company_id:actor.company_id}).eq('id',reserved!.id)
    const {error:chatError}=await admin.from('telegram_admin_chats').upsert({
      company_id:actor.company_id,
      telegram_chat_id:chatId,
      title:message?.chat.title??callback?.message?.chat.title??null,
      active:true,
      created_by:actor.profile_id,
      updated_at:new Date().toISOString(),
    },{onConflict:'company_id,telegram_chat_id'})
    if(chatError)throw chatError

    if(callback){
      const intakeMatch=/^employee_intake:(new|approve|update|archive|cancel):([0-9a-f-]{36})$/.exec(callback.data??'')
      if(intakeMatch){
        const action=intakeMatch[1],intakeId=intakeMatch[2]
        const {data:intake,error:intakeError}=await admin.from('employee_intakes').select('id,status,extracted_data').eq('id',intakeId).eq('company_id',actor.company_id).maybeSingle()
        if(intakeError)throw intakeError
        if(!intake){await answerCallback(callback.id,'ไม่พบรายการหรือไม่มีสิทธิ์');return json({status:'employee_intake_not_found'})}
        if(action==='new'&&intake.status==='pending_review'){
          await answerCallback(callback.id,'ข้อมูลครบแล้ว รออนุมัติสร้างพนักงานจริง')
          await finishCallbackMessage(callback,'พนักงานใหม่','ข้อมูลครบ รออนุมัติสร้างประวัติ')
          await sendEmployeeIntakeSummary(actor.company_id,intakeId)
          await admin.from('telegram_admin_events').update({status:'processed',processed_at:new Date().toISOString()}).eq('id',reserved!.id)
          return json({status:'employee_intake_already_ready'})
        }
        if(action==='approve'){
          const extracted={...((intake.extracted_data??{}) as Record<string,unknown>)}
          extracted.employment_type=normalizeEmploymentType(extracted.employment_type)
          if(!['daily','monthly','temporary','contractor'].includes(String(extracted.employment_type))){
            await answerCallback(callback.id,'ประเภทการจ้างไม่ถูกต้อง กรุณาแก้ไขข้อมูลก่อน')
            return json({status:'employee_intake_employment_type_invalid'})
          }
          const {error:normalizeError}=await admin.from('employee_intakes').update({extracted_data:extracted,updated_at:new Date().toISOString()}).eq('id',intakeId).eq('company_id',actor.company_id).eq('status','pending_review')
          if(normalizeError)throw normalizeError
          const {data,error}=await admin.rpc('approve_employee_intake',{target_intake_id:intakeId,actor_profile_id:actor.profile_id})
          if(error){
            await answerCallback(callback.id,error.message.includes('not_ready')?'ข้อมูลยังไม่ครบ':error.message.includes('approval_denied')?'ไม่มีสิทธิ์อนุมัติ':'ไม่สามารถสร้างประวัติพนักงานได้')
            return json({status:'employee_intake_approval_rejected'})
          }
          const result=data?.[0]
          await answerCallback(callback.id,result?.result_status==='already_created'?'รายการนี้สร้างแล้ว':'สร้างประวัติพนักงานแล้ว')
          await finishCallbackMessage(callback,'อนุมัติสร้างประวัติพนักงาน',result?.result_status==='already_created'?'สร้างไว้ก่อนแล้ว':'สร้างสำเร็จ (ยังไม่มี Login)')
          await admin.from('telegram_admin_events').update({status:'processed',processed_at:new Date().toISOString()}).eq('id',reserved!.id)
          return json({status:result?.result_status==='already_created'?'employee_already_created':'employee_created'})
        }
        if(action==='cancel'){
          await admin.from('employee_intakes').update({status:'cancelled',updated_at:new Date().toISOString()}).eq('id',intakeId).eq('company_id',actor.company_id)
          await answerCallback(callback.id,'ยกเลิกรายการแล้ว')
          await finishCallbackMessage(callback,'ยกเลิก','ยกเลิกรายการแล้ว')
        }else if(action==='new'){
          await answerCallback(callback.id,'กำลังอ่านเอกสาร')
          const analyzed=await analyzeEmployeeIntake(actor,intakeId)
          await finishCallbackMessage(callback,'พนักงานใหม่',analyzed.status==='pending_review'?'อ่านข้อมูลครบ รออนุมัติ':'กำลังรอข้อมูลเพิ่มเติม')
          await sendText(chatId,employeeIntakeSummary(analyzed))
        }else{
          const purpose=action==='update'?'update_employee':'archive_only'
          await admin.from('employee_intakes').update({purpose,status:'pending_review',submitted_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',intakeId).eq('company_id',actor.company_id)
          await answerCallback(callback.id,'บันทึกเพื่อให้ผู้ดูแลตรวจแล้ว')
          await finishCallbackMessage(callback,action==='update'?'แก้ไขพนักงานเดิม':'เก็บเอกสารเท่านั้น','บันทึกเข้าคิวตรวจแล้ว')
        }
        await admin.from('telegram_admin_events').update({status:'processed',processed_at:new Date().toISOString()}).eq('id',reserved!.id)
        return json({status:`employee_intake_${action}`})
      }
      const attendanceMatch=/^attendance:(approve|reject|request_more):([0-9a-f-]{36})$/.exec(callback.data??'')
      if(attendanceMatch){
        const action=attendanceMatch[1],sessionId=attendanceMatch[2]
        const {data,error}=await admin.rpc('review_telegram_attendance',{target_session_id:sessionId,actor_profile_id:actor.profile_id,review_action:action})
        if(error){
          await answerCallback(callback.id,error.message.includes('already_decided')?'รายการนี้ถูกจัดการแล้ว':'ไม่มีสิทธิ์หรือไม่สามารถดำเนินการได้')
          return json({status:'attendance_review_rejected'})
        }
        const result=data?.[0]?.result_status??(action==='approve'?'approved':action==='reject'?'rejected':'needs_review')
        await answerCallback(callback.id,action==='approve'?'อนุมัติแล้ว':action==='reject'?'ไม่อนุมัติแล้ว':'บันทึกขอข้อมูลเพิ่มแล้ว')
        await finishCallbackMessage(callback,action==='approve'?'อนุมัติ':action==='reject'?'ไม่อนุมัติ':'ขอข้อมูลเพิ่ม',result)
        await admin.from('telegram_admin_events').update({status:'processed',processed_at:new Date().toISOString()}).eq('id',reserved!.id)
        return json({status:'attendance_reviewed'})
      }
      const match=/^work:(approve|reject):([A-Z0-9-]+)$/.exec(callback.data??'')
      if(!match){await answerCallback(callback.id,'คำสั่งไม่ถูกต้อง');return json({status:'ignored'})}
      const approved=match[1]==='approve',workKey=match[2]
      const {data:item}=await admin.from('system_work_items').select('work_key,title,status').eq('work_key',workKey).or(`company_id.is.null,company_id.eq.${actor.company_id}`).maybeSingle()
      if(!item||item.status!=='review'){await answerCallback(callback.id,'งานนี้ไม่ได้รออนุมัติ');return json({status:'ignored'})}
      const {error}=await admin.from('system_work_items').update({status:approved?'ready':'blocked',production_status:approved?'approved_for_execution':'rejected_by_admin',evidence:`Telegram ${approved?'approved':'rejected'} by linked admin`,updated_at:new Date().toISOString()}).eq('work_key',workKey)
      if(error)throw error
      await answerCallback(callback.id,approved?'อนุมัติแล้ว':'ไม่อนุมัติแล้ว')
      await finishCallbackMessage(callback,`${approved?'อนุมัติ':'ไม่อนุมัติ'} ${workKey}`,approved?'พร้อมดำเนินการ':'ปฏิเสธแล้ว')
    }else{
      if(message?.photo?.length){
        const received=await receiveEmployeeIntakePhoto(actor,chatId,userId,update.update_id,message)
        if(received){
          await sendText(chatId,`📄 รับเอกสารแล้ว ${received.count} รายการ\nเอกสารชุดนี้ใช้สำหรับอะไร?\nระบบยังไม่สร้างบัญชีพนักงานจนกว่าข้อมูลครบและ Admin อนุมัติ`,{inline_keyboard:[
            [{text:'👤 พนักงานใหม่',callback_data:`employee_intake:new:${received.intakeId}`}],
            [{text:'✏️ แก้ไขพนักงานเดิม',callback_data:`employee_intake:update:${received.intakeId}`}],
            [{text:'📁 เก็บเอกสารเท่านั้น',callback_data:`employee_intake:archive:${received.intakeId}`}],
            [{text:'⛔ ยกเลิก',callback_data:`employee_intake:cancel:${received.intakeId}`}],
          ]})
          await admin.from('telegram_admin_events').update({status:'processed',processed_at:new Date().toISOString()}).eq('id',reserved!.id)
          return json({status:'employee_intake_document_received'})
        }
      }
      const intakeFields=message?.text?await receiveEmployeeIntakeFields(actor,chatId,userId,message.text):null
      if(intakeFields){
        if(intakeFields.duplicate_input){
          await admin.from('telegram_admin_events').update({status:'processed',processed_at:new Date().toISOString()}).eq('id',reserved!.id)
          return json({status:'employee_intake_duplicate_ignored'})
        }
        const replyMarkup=intakeFields.status==='awaiting_purpose'?{inline_keyboard:[
          [{text:'👤 พนักงานใหม่',callback_data:`employee_intake:new:${intakeFields.id}`}],
          [{text:'✏️ แก้ไขพนักงานเดิม',callback_data:`employee_intake:update:${intakeFields.id}`}],
          [{text:'📁 เก็บเอกสารเท่านั้น',callback_data:`employee_intake:archive:${intakeFields.id}`}],
          [{text:'⛔ ยกเลิก',callback_data:`employee_intake:cancel:${intakeFields.id}`}],
        ]}:undefined
        await sendText(chatId,employeeIntakeSummary(intakeFields),replyMarkup)
        await admin.from('telegram_admin_events').update({status:'processed',processed_at:new Date().toISOString()}).eq('id',reserved!.id)
        return json({status:'employee_intake_fields_received'})
      }
      if(attendance){
        await sendText(chatId,'🔐 บัญชี Telegram นี้ยังไม่มีตัวตนพนักงานที่ยืนยันในบริษัท ระบบจึงไม่รับคำขอลงเวลา กรุณาให้ผู้ดูแลผูกบัญชีก่อน')
      }
      else if(command==='status'||command==='สถานะ'||command==='สถานะระบบ')await sendText(chatId,await statusText(actor.company_id))
      else if(command==='tasks'||command==='งานค้าง'||command==='รายการงาน')await sendText(chatId,await tasksText(actor.company_id))
      else if(command==='approvals'||command==='รออนุมัติ'){
        const pending=await sendPendingAttendanceApprovals(actor.company_id)
        if(!pending.items)await sendText(chatId,'✅ ไม่มีรายการลงเวลารออนุมัติ')
        else if(!pending.sent)await sendText(chatId,'⚠️ พบรายการรออนุมัติ แต่ไม่พบกลุ่ม Telegram Admin ที่เปิดใช้งาน')
      }
      else await sendText(chatId,`${spoken?`🎙️ ถอดเสียง: ${spoken}\n\n`:''}คำสั่งที่ใช้ได้:\n/status — สถานะระบบ\n/tasks — งานค้าง\n/clockin — ขอเวลาเข้า\n/clockout — ขอเวลาออก\nการอนุมัติใช้ปุ่มจากรายการรอตรวจ`)
    }
    await admin.from('telegram_admin_events').update({status:'processed',processed_at:new Date().toISOString()}).eq('id',reserved!.id)
    return json({status:'processed'})
  }catch(error){
    const detail=error instanceof Error?error.message:String(error)
    await admin.from('telegram_admin_events').update({status:'failed',error_message:detail.slice(0,500),processed_at:new Date().toISOString()}).eq('id',reserved?.id)
    await sendText(chatId,`❌ ไม่สามารถประมวลผลรายการได้\nสาเหตุ: ${detail.slice(0,300)}\nกรุณาส่ง /clockin หรือ /clockout ใหม่ แล้ว Reply ข้อความของ Bot`).catch(()=>null)
    return json({error:detail},500)
  }
})
