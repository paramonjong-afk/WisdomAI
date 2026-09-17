import { createClient } from 'npm:@supabase/supabase-js@2'

const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:cors})
  if(request.method!=='POST')return Response.json({error:'Method not allowed'},{status:405,headers:cors})
  try{
    const authorization=request.headers.get('Authorization')??''
    const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const userClient=createClient(url,anon,{global:{headers:{Authorization:authorization}}}),admin=createClient(url,service)
    const {data:auth,error:authError}=await userClient.auth.getUser()
    if(authError||!auth.user)return Response.json({error:'Unauthorized'},{status:401,headers:cors})
    const body=await request.json() as {sessionId?:string;kind?:'clock_in'|'clock_out';reason?:string}
    if(!body.sessionId||!['clock_in','clock_out'].includes(body.kind??''))throw new Error('invalid_selfie_request')
    const {data:preference}=await admin.from('user_company_preferences').select('active_company_id').eq('profile_id',auth.user.id).maybeSingle()
    const companyId=preference?.active_company_id
    if(!companyId)throw new Error('active_company_required')
    const {data:session,error:sessionError}=await admin.from('attendance_sessions')
      .select('id,company_id,profile_id,site_id,clock_in_selfie_path,clock_out_selfie_path')
      .eq('company_id',companyId).eq('id',body.sessionId).maybeSingle()
    if(sessionError||!session)throw new Error('attendance_not_found')
    let allowed=session.profile_id===auth.user.id
    if(!allowed){
      const {data:canReview,error}=await userClient.rpc('can_review_attendance_site',{target_company_id:companyId,target_site_id:session.site_id,target_profile_id:auth.user.id})
      if(error)throw error
      allowed=Boolean(canReview)
    }
    if(!allowed)throw new Error('attendance_selfie_access_denied')
    const path=body.kind==='clock_in'?session.clock_in_selfie_path:session.clock_out_selfie_path
    if(!path)throw new Error('selfie_not_found')
    const {data:signed,error:signedError}=await admin.storage.from('attendance-selfies').createSignedUrl(path,600)
    if(signedError||!signed?.signedUrl)throw signedError??new Error('signed_url_failed')
    const {error:auditError}=await admin.from('attendance_selfie_access_events').insert({company_id:companyId,session_id:session.id,actor_profile_id:auth.user.id,selfie_path:path,access_reason:String(body.reason??'attendance_review').slice(0,200)})
    if(auditError)throw auditError
    return Response.json({url:signed.signedUrl,expiresIn:600},{headers:{...cors,'Cache-Control':'no-store'}})
  }catch(error){return Response.json({error:error instanceof Error?error.message:'attendance_selfie_access_failed'},{status:400,headers:{...cors,'Cache-Control':'no-store'}})}
})
