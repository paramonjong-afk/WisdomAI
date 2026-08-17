import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const url=Deno.env.get('SUPABASE_URL')!
const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const anonKey=Deno.env.get('SUPABASE_ANON_KEY')!
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'authorization, x-client-info, apikey, content-type'}
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'content-type':'application/json; charset=utf-8'}})

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:cors})
  if(request.method!=='POST')return response({error:'Method not allowed'},405)
  const authorization=request.headers.get('authorization')
  if(!authorization)return response({error:'Unauthorized'},401)
  const accessToken=authorization.replace(/^Bearer\s+/i,'').trim()
  const admin=createClient(url,serviceKey,{auth:{persistSession:false}})
  const {data:auth}=await admin.auth.getUser(accessToken)
  if(!auth.user)return response({error:'Unauthorized'},401)
  const callerClient=createClient(url,anonKey,{global:{headers:{authorization}},auth:{persistSession:false}})
  const {data:preference}=await admin.from('user_company_preferences').select('active_company_id').eq('profile_id',auth.user.id).maybeSingle()
  let companyId=preference?.active_company_id??null
  if(!companyId){
    const {data:fallback}=await admin.from('company_members').select('company_id').eq('profile_id',auth.user.id).eq('active',true).order('created_at').limit(1).maybeSingle()
    companyId=fallback?.company_id??null
  }
  const {data:actorMembership}=companyId
    ? await admin.from('company_members').select('company_role,active,ends_on').eq('company_id',companyId).eq('profile_id',auth.user.id).maybeSingle()
    : {data:null}
  const today=new Date().toISOString().slice(0,10)
  const actorExpired=actorMembership?.ends_on&&actorMembership.ends_on<today
  if(!companyId||!actorMembership?.active||actorExpired||!['company_admin','executive'].includes(actorMembership.company_role)){
    return response({error:'Company admin permission required'},403)
  }
  const body=await request.json() as {profileId?:string;action?:'archive'|'reactivate'|'delete';reason?:string}
  if(!body.profileId||!body.action)return response({error:'ข้อมูลไม่ครบ'},400)
  if(body.profileId===auth.user.id)return response({error:'ไม่สามารถจัดการบัญชีที่กำลังใช้งานอยู่'},400)
  const {data:targetMembership}=await admin.from('company_members').select('active,ends_on')
    .eq('company_id',companyId).eq('profile_id',body.profileId).maybeSingle()
  if(!targetMembership)return response({error:'ไม่พบพนักงานในบริษัทปัจจุบัน'},404)
  if(body.action==='delete'){
    const {data:preview,error:previewError}=await callerClient.rpc('employee_delete_preview',{target_profile_id:body.profileId})
    if(previewError)return response({error:previewError.message},400)
    if(!preview?.can_delete)return response({error:'พนักงานมีประวัติใช้งานแล้ว กรุณาปิดใช้งานแทน',preview},409)
    const {count:otherMemberships,error:membershipError}=await admin.from('company_members')
      .select('company_id',{count:'exact',head:true}).eq('profile_id',body.profileId).neq('company_id',companyId)
    if(membershipError)return response({error:'ตรวจสอบบริษัทของพนักงานไม่สำเร็จ'},400)
    if((otherMemberships??0)>0)return response({error:'ไม่สามารถลบบัญชีที่ใช้งานในบริษัทอื่นได้'},409)
    const {error:deleteError}=await admin.auth.admin.deleteUser(body.profileId)
    if(deleteError)return response({error:deleteError.message},400)
    return response({ok:true,action:'delete'})
  }
  const reason=body.reason?.trim()||''
  if(!reason)return response({error:'กรุณาระบุเหตุผล'},400)
  const makeActive=body.action==='reactivate'
  const {error:rpcError}=await callerClient.rpc('set_employee_active',{target_profile_id:body.profileId,make_active:makeActive,reason})
  if(rpcError)return response({error:`บันทึกสถานะพนักงานไม่สำเร็จ: ${rpcError.message}`},400)
  return response({ok:true,action:body.action})
})
