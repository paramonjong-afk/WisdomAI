import { createClient } from 'npm:@supabase/supabase-js@2'

type PurgeJob={id:string;company_id:string;session_id:string;selfie_path:string;attempts:number}

Deno.serve(async(request)=>{
  const secret=Deno.env.get('ATTENDANCE_MAINTENANCE_SECRET')
  if(!secret||request.headers.get('x-maintenance-secret')!==secret)return Response.json({error:'Unauthorized'},{status:401})
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const {data,error}=await admin.rpc('claim_attendance_selfie_purge_jobs',{batch_size:25})
  if(error)return Response.json({error:error.message},{status:500})
  const results=[]
  for(const job of (data??[]) as PurgeJob[]){
    try{
      // Storage API deletion is authoritative; never delete storage.objects directly.
      const {error:removeError}=await admin.storage.from('attendance-selfies').remove([job.selfie_path])
      if(removeError)throw removeError
      const {data:remaining,error:verifyError}=await admin.storage.from('attendance-selfies').list(job.selfie_path.split('/').slice(0,-1).join('/'),{search:job.selfie_path.split('/').at(-1),limit:1})
      if(verifyError)throw verifyError
      if((remaining??[]).some(item=>job.selfie_path.endsWith(`/${item.name}`)))throw new Error('storage_delete_not_verified')
      await admin.from('attendance_selfie_purge_jobs').update({status:'succeeded',lease_expires_at:null,last_error:null,updated_at:new Date().toISOString()}).eq('id',job.id)
      await admin.from('attendance_selfie_retention_events').upsert({company_id:job.company_id,session_id:job.session_id,selfie_path:job.selfie_path,action:'purged',reason:'Storage API deletion verified'},{onConflict:'session_id,selfie_path,action'})
      results.push({id:job.id,status:'succeeded'})
    }catch(caught){
      const message=caught instanceof Error?caught.message:'purge_failed'
      await admin.from('attendance_selfie_purge_jobs').update({status:'failed',available_at:new Date(Date.now()+Math.min(3600000,30000*2**job.attempts)).toISOString(),lease_expires_at:null,last_error:message.slice(0,500),updated_at:new Date().toISOString()}).eq('id',job.id)
      await admin.from('attendance_selfie_retention_events').upsert({company_id:job.company_id,session_id:job.session_id,selfie_path:job.selfie_path,action:'failed',reason:message.slice(0,500)},{onConflict:'session_id,selfie_path,action'})
      results.push({id:job.id,status:'failed'})
    }
  }
  return Response.json({processed:results.length,results},{headers:{'Cache-Control':'no-store'}})
})
