import { Alert, Box, Button, Chip, CircularProgress, Divider, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { userError } from '../../utils/userError'
import { runWithMutationAttempt } from '../../utils/mutationAttemptRunner'

type Company={company_id:string;company_name:string;company_slug:string;company_role:string;is_active:boolean}
type Group={line_group_id:string;display_name:string|null;company_id:string;company_name:string;active:boolean;last_event_at:string|null;historical_message_count:number}
type AssignmentRequest={id:string;line_group_id:string;display_name:string|null;source_type:string;last_seen_at:string;notification_status:string;notification_error:string|null}
type AssignmentOption={id:string;request_id:string;company_id:string;expires_at:string;companies:{name?:string}|null}
type WebhookIntake={id:string;fingerprint:string;webhook_event_id:string|null;source_type:string|null;line_group_id:string|null;event_type:string|null;message_type:string|null;signature_valid:boolean;intake_status:string;diagnostic_code:string|null;diagnostic_message:string|null;occurrence_count:number;last_seen_at:string}

const intakeLabels:Record<string,string>={signature_rejected:'ลายเซ็นไม่ผ่าน',payload_rejected:'รูปแบบข้อมูลผิด',verified_empty:'Verify สำเร็จ',received:'รับจาก LINE แล้ว',tenant_resolved:'ระบุบริษัทแล้ว',quarantined:'รอผูกบริษัท',processed:'ประมวลผลสำเร็จ',skipped:'ไม่ได้ใช้งาน',failed:'ประมวลผลไม่สำเร็จ'}

export function PlatformLineGroupManager(){
  const [companies,setCompanies]=useState<Company[]>([])
  const [groups,setGroups]=useState<Group[]>([])
  const [requests,setRequests]=useState<AssignmentRequest[]>([])
  const [options,setOptions]=useState<AssignmentOption[]>([])
  const [intakes,setIntakes]=useState<WebhookIntake[]>([])
  const [selection,setSelection]=useState<Record<string,string>>({})
  const [requestSelection,setRequestSelection]=useState<Record<string,string>>({})
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState<{severity:'success'|'error'|'info';text:string}|null>(null)

  const load=useCallback(async()=>{
    setBusy(true);setMessage(null)
    const [companyResult,groupResult,requestResult,optionResult,intakeResult]=await Promise.all([
      supabase.rpc('get_my_companies'),
      supabase.rpc('get_platform_line_group_assignments'),
      supabase.from('line_group_assignment_requests').select('id,line_group_id,display_name,source_type,last_seen_at,notification_status,notification_error').eq('status','pending').order('last_seen_at',{ascending:false}),
      supabase.from('line_group_assignment_options').select('id,request_id,company_id,expires_at,companies(name)').gt('expires_at',new Date().toISOString()),
      supabase.from('line_webhook_intake_events').select('id,fingerprint,webhook_event_id,source_type,line_group_id,event_type,message_type,signature_valid,intake_status,diagnostic_code,diagnostic_message,occurrence_count,last_seen_at').order('last_seen_at',{ascending:false}).limit(50),
    ])
    if(companyResult.error||groupResult.error||requestResult.error||optionResult.error||intakeResult.error){
      setMessage({severity:'error',text:companyResult.error?userError(companyResult.error):groupResult.error?userError(groupResult.error):requestResult.error?userError(requestResult.error):optionResult.error?userError(optionResult.error):intakeResult.error?userError(intakeResult.error):'โหลดข้อมูลไม่สำเร็จ'})
    }else{
      const loadedCompanies=(companyResult.data??[]) as Company[]
      const loadedGroups=(groupResult.data??[]) as Group[]
      const loadedRequests=(requestResult.data??[]) as AssignmentRequest[]
      const loadedOptions=(optionResult.data??[]) as unknown as AssignmentOption[]
      setCompanies(loadedCompanies);setGroups(loadedGroups)
      setRequests(loadedRequests);setOptions(loadedOptions)
      setIntakes((intakeResult.data??[]) as WebhookIntake[])
      setSelection(Object.fromEntries(loadedGroups.map(group=>[group.line_group_id,group.company_id])))
      setRequestSelection(Object.fromEntries(loadedRequests.map(request=>{
        const first=loadedOptions.find(option=>option.request_id===request.id)
        return [request.id,first?.id??'']
      })))
    }
    setBusy(false)
  },[])
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load])

  const assign=async(group:Group)=>{
    const target=selection[group.line_group_id]
    if(!target||target===group.company_id)return
    const targetName=companies.find(company=>company.company_id===target)?.company_name??target
    if(!window.confirm(`ยืนยันย้ายกลุ่ม “${group.display_name??group.line_group_id}” จาก ${group.company_name} ไป ${targetName}\n\nการแจ้งเตือนและโครงการเดิมจะถูกยกเลิกการผูกก่อนย้าย ประวัติข้อความเดิมยังคงอยู่กับบริษัทเดิม`))return
    setBusy(true);setMessage(null)
    try {
      await runWithMutationAttempt({
        module: 'LineMonitor',
        action: 'ผูกกลุ่ม LINE กับบริษัท',
        actorProfileId: null,
        companyId: target,
        request: { target_line_group_id: group.line_group_id, target_company_id: target },
        operation: async () => await supabase.rpc('assign_line_group_company',{
          target_line_group_id: group.line_group_id,
          target_company_id: target,
        }),
      })
      setMessage({severity:'success',text:`ผูกกลุ่ม LINE กับ ${targetName} แล้ว`})
      await load()
    } catch (error) {
      setMessage({severity:'error',text:error instanceof Error ? error.message : userError(error)})
    }
    setBusy(false)
  }

  const approveRequest=async(request:AssignmentRequest)=>{
    const optionId=requestSelection[request.id]
    const option=options.find(item=>item.id===optionId)
    if(!option)return
    const companyName=option.companies?.name??companies.find(company=>company.company_id===option.company_id)?.company_name??option.company_id
    if(!window.confirm(`ยืนยันผูกกลุ่มใหม่ “${request.display_name??request.line_group_id}” กับ ${companyName}\n\nข้อความก่อนอนุมัติจะไม่ถูกนำเข้าบริษัท`))return
    setBusy(true);setMessage(null)
    try {
      await runWithMutationAttempt({
        module: 'LineMonitor',
        action: 'อนุมัติงานผูกกลุ่ม LINE ให้บริษัท',
        actorProfileId: null,
        companyId: option.company_id,
        request: { target_option_id: optionId },
        operation: async () => await supabase.rpc('approve_line_group_assignment',{target_option_id:optionId}),
      })
      setMessage({severity:'success',text:`อนุมัติกลุ่ม ${request.display_name??request.line_group_id} ให้ ${companyName} แล้ว`})
      await load()
    } catch (error) {
      setMessage({severity:'error',text:error instanceof Error ? error.message : userError(error)})
    }
    setBusy(false)
  }

  return <Stack spacing={2}>
    <Alert severity="info">เฉพาะ Platform Admin: Bot ตัวเดียวใช้ได้หลายบริษัท แต่กลุ่ม LINE หนึ่งกลุ่มผูกได้บริษัทเดียว การย้ายจะมี Audit Log และไม่ย้ายประวัติข้อความเดิมข้ามบริษัท</Alert>
    {message&&<Alert severity={message.severity} sx={{position:'sticky',top:8,zIndex:2}}>{message.text}</Alert>}
    <Paper variant="outlined" sx={{p:2}}>
      <Stack spacing={1.5}>
        <Box>
          <Typography variant="h6" sx={{fontWeight:800}}>เส้นทางรับ Webhook ล่าสุด</Typography>
          <Typography variant="body2" color="text.secondary">แสดงหลักฐานตั้งแต่ LINE ติดต่อเข้ามา แม้ยังไม่ทราบบริษัท โดยไม่เก็บข้อความ รูป Token หรือ Secret</Typography>
        </Box>
        <Stack direction={{xs:'column',sm:'row'}} spacing={1}>
          <Chip label={`รับทั้งหมด ${intakes.length}`} />
          <Chip color="warning" label={`รอผูกบริษัท ${intakes.filter(item=>item.intake_status==='quarantined').length}`} />
          <Chip color="error" label={`ไม่สำเร็จ ${intakes.filter(item=>['signature_rejected','payload_rejected','failed'].includes(item.intake_status)).length}`} />
        </Stack>
        {intakes.length===0?<Alert severity="info">ยังไม่มี Webhook หลังเปิดระบบตรวจสอบนี้ ให้ส่งข้อความจากกลุ่มแล้วกดรีเฟรช</Alert>:
          <Stack divider={<Divider flexItem/>}>
            {intakes.slice(0,20).map(item=><Box key={item.id} sx={{display:'grid',gridTemplateColumns:{xs:'1fr',md:'180px 1fr 220px'},gap:1,py:1,alignItems:'center'}}>
              <Box><Chip size="small" color={['signature_rejected','payload_rejected','failed'].includes(item.intake_status)?'error':item.intake_status==='quarantined'?'warning':'success'} label={intakeLabels[item.intake_status]??item.intake_status}/></Box>
              <Box sx={{minWidth:0}}>
                <Typography variant="body2" sx={{fontWeight:700}}>{item.event_type??'HTTP request'}{item.event_type?` · ${item.event_type}`:''}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{wordBreak:'break-all'}}>{item.line_group_id?`Group ${item.line_group_id}`:'ไม่พบ Group ID'} · {item.diagnostic_code??'-'}{item.occurrence_count>1?` · ซ้ำ ${item.occurrence_count} ครั้ง`:''}</Typography>
                {item.diagnostic_message&&<Typography variant="caption" sx={{display:'block'}} color="text.secondary">{item.diagnostic_message}</Typography>}
              </Box>
              <Typography variant="caption" color="text.secondary">{new Date(item.last_seen_at).toLocaleString('th-TH')}</Typography>
            </Box>)}
          </Stack>}
      </Stack>
    </Paper>
    {requests.length>0&&<>
      <Box>
        <Typography variant="h6" sx={{fontWeight:800}}>กลุ่มใหม่รอเลือกบริษัท ({requests.length})</Typography>
        <Typography variant="body2" color="text.secondary">ช่องทางสำรองบนเว็บเมื่อ Telegram แจ้งไม่สำเร็จ ข้อมูลจะยังถูกกักไว้จน Platform Admin อนุมัติ</Typography>
      </Box>
      {requests.map(request=>{
        const requestOptions=options.filter(option=>option.request_id===request.id)
        return <Paper key={request.id} variant="outlined" sx={{p:2,borderColor:'warning.main',bgcolor:'warning.50'}}>
          <Stack direction={{xs:'column',md:'row'}} spacing={2} sx={{alignItems:{md:'center'}}}>
            <Box sx={{flex:1,minWidth:0}}>
              <Typography sx={{fontWeight:800}}>{request.display_name??'ไม่พบชื่อกลุ่ม'}</Typography>
              <Typography variant="caption" color="text.secondary">Group ID: {request.line_group_id} · พบล่าสุด {new Date(request.last_seen_at).toLocaleString('th-TH')} · Telegram: {request.notification_status}{request.notification_error?` (${request.notification_error})`:''}</Typography>
            </Box>
            <TextField select size="small" label="เลือกบริษัทเจ้าของกลุ่ม" value={requestSelection[request.id]??''} onChange={event=>setRequestSelection(current=>({...current,[request.id]:event.target.value}))} sx={{minWidth:280}}>
              {requestOptions.map(option=><MenuItem key={option.id} value={option.id}>{option.companies?.name??companies.find(company=>company.company_id===option.company_id)?.company_name??option.company_id}</MenuItem>)}
            </TextField>
            <Button variant="contained" color="warning" disabled={busy||!requestSelection[request.id]} onClick={()=>void approveRequest(request)}>อนุมัติและเริ่มรับข้อมูล</Button>
          </Stack>
        </Paper>
      })}
      <Divider/>
    </>}
    {busy&&groups.length===0?<Box sx={{display:'grid',placeItems:'center',py:5}}><CircularProgress/></Box>:groups.map(group=><Paper key={group.line_group_id} variant="outlined" sx={{p:2}}>
      <Stack direction={{xs:'column',md:'row'}} spacing={2} sx={{alignItems:{md:'center'}}}>
        <Box sx={{flex:1,minWidth:0}}>
          <Typography sx={{fontWeight:800}}>{group.display_name??'ไม่พบชื่อกลุ่ม'}</Typography>
          <Typography variant="caption" color="text.secondary">บริษัทปัจจุบัน: {group.company_name} · ข้อความย้อนหลัง {group.historical_message_count} รายการ · {group.last_event_at?`รับล่าสุด ${new Date(group.last_event_at).toLocaleString('th-TH')}`:'ยังไม่มี Webhook'}</Typography>
        </Box>
        <TextField select size="small" label="ผูกกับบริษัท" value={selection[group.line_group_id]??group.company_id} onChange={event=>setSelection(current=>({...current,[group.line_group_id]:event.target.value}))} sx={{minWidth:260}}>
          {companies.map(company=><MenuItem key={company.company_id} value={company.company_id}>{company.company_name}{company.is_active?' · กำลังใช้งาน':''}</MenuItem>)}
        </TextField>
        <Button variant="contained" disabled={busy||!selection[group.line_group_id]||selection[group.line_group_id]===group.company_id} onClick={()=>void assign(group)}>บันทึกการผูก</Button>
      </Stack>
    </Paper>)}
    {!busy&&groups.length===0&&<Alert severity="warning">ยังไม่พบกลุ่ม LINE ให้เชิญ Bot เข้ากลุ่มและส่งข้อความหนึ่งครั้งก่อน</Alert>}
  </Stack>
}

