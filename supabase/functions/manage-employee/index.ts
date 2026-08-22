import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const url=Deno.env.get('SUPABASE_URL')!
const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const anonKey=Deno.env.get('SUPABASE_ANON_KEY')!
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'authorization, x-client-info, apikey, content-type'}
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'content-type':'application/json; charset=utf-8'}})
const unique=(values:string[])=>
  Array.from(new Set(values.filter((value)=>typeof value==='string'&&value.trim())))

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:cors})
  if(request.method!=='POST')return response({error:'Method not allowed'},405)
  const authorization=request.headers.get('authorization')
  if(!authorization)return response({error:'Unauthorized'},401)
  const accessToken=authorization.replace(/^Bearer\s+/i,'').trim()
  const admin=createClient(url,serviceKey,{auth:{persistSession:false}})
  const {data:auth}=await admin.auth.getUser(accessToken)
  if(!auth.user)return response({error:'Unauthorized'},401)
  const {data:actorProfile}=await admin.from('profiles').select('role').eq('id',auth.user.id).maybeSingle()
  const isPlatformAdmin=actorProfile?.role==='admin'
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
  const actorRole=actorMembership?.company_role
  const canManageEmployees = isPlatformAdmin || ['company_admin','executive','site_supervisor'].includes(actorRole ?? '')
  const today=new Date().toISOString().slice(0,10)
  const actorExpired=actorMembership?.ends_on&&actorMembership.ends_on<today
  if(!companyId||(!isPlatformAdmin&&(!actorMembership?.active||actorExpired))||!canManageEmployees){
    return response({error:'Company admin permission required'},403)
  }
  const body=await request.json() as {profileId?:string;action?:'archive'|'reactivate'|'delete'|'resign';reason?:string;lastWorkingOn?:string;statusEffectiveOn?:string;payrollEligibleUntil?:string}
  if(!body.profileId||!body.action)return response({error:'ข้อมูลไม่ครบ'},400)
  if(body.profileId===auth.user.id)return response({error:'ไม่สามารถจัดการบัญชีที่กำลังใช้งานอยู่'},400)
  const {data:targetMembershipRows,error:targetMembershipError}=await admin
    .from('company_members')
    .select('company_id,active,ends_on')
    .eq('profile_id', body.profileId)
  if(targetMembershipError)return response({error:'ไม่สามารถตรวจสิทธิ์พนักงานได้',error_code:'MEMBERSHIP_QUERY_FAILED'},400)
  const targetMembership=targetMembershipRows?.find((row)=>row.company_id===companyId)
  if(!targetMembership)return response({error:'ไม่พบพนักงานในบริษัทปัจจุบัน'},404)

  const foreignCompanies = unique((targetMembershipRows ?? []).filter((row)=>row.company_id!==companyId).map((row)=>row.company_id))
  const [employmentRowsResult, assignmentRowsResult] = await Promise.all([
    admin.from('employee_employment_records').select('company_id').eq('profile_id', body.profileId),
    admin.from('employee_site_assignments').select('company_id').eq('profile_id', body.profileId).eq('active',true),
  ])
  if (employmentRowsResult.error || assignmentRowsResult.error) {
    return response({error:'ตรวจสอบข้อมูลการจ้าง/มอบหมายไซต์ไม่สำเร็จ',error_code:'EMPLOYEE_SCOPE_CHECK_FAILED'},400)
  }
  const foreignEmploymentCompanies = unique((employmentRowsResult.data ?? []).filter((row)=>row.company_id!==companyId).map((row)=>row.company_id))
  const foreignAssignmentCompanies = unique((assignmentRowsResult.data ?? []).filter((row)=>row.company_id!==companyId).map((row)=>row.company_id))
  // Resignation is company-local: preserve foreign-company history and only close
  // the target company's membership/employment. Other actions remain strict.
  const scopeIssues = body.action === 'resign'
    ? []
    : [...foreignCompanies,...foreignEmploymentCompanies,...foreignAssignmentCompanies]
  if (scopeIssues.length > 0) {
    const companyCodes = unique(scopeIssues)
    return response({
      error: `การจัดการนี้ขัดขวางด้วยนโยบายขอบเขตบริษัท (ข้อมูลงาน/การมอบหมายไซต์งานมีค่าบริษัทไม่ตรงกัน: ${companyCodes.join(', ')})`,
      error_code: 'CROSS_COMPANY_SCOPE_MISMATCH',
      action: 'ตรวจข้อมูลบริษัท/การจ้าง/การมอบหมายไซต์ให้ตรงกันก่อนลองใหม่',
      mismatch_companies: companyCodes,
    })
  }

  if(body.action==='delete'){
    if (!['company_admin','executive'].includes(actorRole ?? '')) {
      return response({error:'Company admin permission required'},403)
    }
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
  if (body.action === 'resign') {
    const {error:activeError}=await callerClient.rpc('resign_employee',{
      target_profile_id:body.profileId,
      reason,
      target_last_working_on:body.lastWorkingOn||null,
      target_status_effective_on:body.statusEffectiveOn||null,
      target_payroll_eligible_until:body.payrollEligibleUntil||null,
    })
    if(activeError)return response({error:`บันทึกสถานะพนักงานไม่สำเร็จ: ${activeError.message}`},400)
    return response({ok:true,action:'resign'})
  }
  const makeActive=body.action==='reactivate'
  const {error:rpcError}=await callerClient.rpc('set_employee_active',{target_profile_id:body.profileId,make_active:makeActive,reason})
  if(rpcError)return response({error:`บันทึกสถานะพนักงานไม่สำเร็จ: ${rpcError.message}`},400)
  return response({ok:true,action:body.action})
})
