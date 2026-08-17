import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const cors={
  'access-control-allow-origin':'*',
  'access-control-allow-headers':'authorization,x-user-authorization,apikey,content-type,x-client-info,x-supabase-api-version',
  'access-control-allow-methods':'POST,OPTIONS',
}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'content-type':'application/json'}})
const admin=createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',{auth:{persistSession:false}})

const extensionFor=(contentType:string)=>contentType.includes('webp')?'webp':contentType.includes('png')?'png':contentType.includes('gif')?'gif':'jpg'

Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:cors})
  if(request.method!=='POST')return json({error:'Method not allowed'},405)
  const authorization=request.headers.get('x-user-authorization')??request.headers.get('authorization')
  const token=authorization?.replace(/^Bearer\s+/i,'').trim()
  if(!token)return json({error:'Unauthorized'},401)
  const {data:authData}=await admin.auth.getUser(token)
  if(!authData.user)return json({error:'Unauthorized'},401)
  const body=await request.json().catch(()=>({})) as {batch_size?:number;retry_failed?:boolean;resume_processing?:boolean;company_id?:string}
  const [{data:profile},{data:preference}]=await Promise.all([
    admin.from('profiles').select('role').eq('id',authData.user.id).single(),
    admin.from('user_company_preferences').select('active_company_id').eq('profile_id',authData.user.id).single(),
  ])
  if(profile?.role!=='admin')return json({error:'Admin required'},403)
  const companyId=body.company_id??preference?.active_company_id
  if(!companyId)return json({error:'Active company required'},403)
  const batchSize=Math.max(1,Math.min(2,Number(body.batch_size)||1))
  // A previous Edge invocation may be terminated after claiming an image.
  // Calls are intentionally processed sequentially by the admin UI, so recover
  // any stranded claims before selecting the next item. This also supports an
  // older cached web bundle that does not send resume_processing yet.
  const {error:resumeError}=await admin.from('line_attachments').update({optimization_status:'pending',optimization_error:'Recovered after an interrupted optimization run.'})
    .eq('company_id',companyId).eq('optimization_status','processing')
  if(resumeError)return json({error:`Unable to resume interrupted images: ${resumeError.message}`},500)
  let query=admin.from('line_attachments').select('id,storage_bucket,storage_path,content_type,size_bytes,original_size_bytes,retention_class')
    .eq('company_id',companyId).eq('optimization_status',body.retry_failed?'failed':'pending').order('created_at').limit(batchSize)
  const {data:attachments,error:loadError}=await query
  if(loadError)return json({error:loadError.message},500)
  let optimized=0,kept=0,failed=0,savedBytes=0
  for(const attachment of attachments??[]){
    try{
      await admin.from('line_attachments').update({optimization_status:'processing',optimization_error:null}).eq('id',attachment.id)
      const bucket=admin.storage.from(attachment.storage_bucket)
      const profile=attachment.retention_class==='financial'||attachment.retention_class==='audit'
        ? {maxSize:2500,quality:95,thumbnailQuality:85}
        : attachment.retention_class==='system_error'
          ? {maxSize:2000,quality:90,thumbnailQuality:80}
          : {maxSize:1600,quality:80,thumbnailQuality:75}
      const optimizedDownload=await bucket.download(attachment.storage_path,{transform:{width:profile.maxSize,height:profile.maxSize,resize:'contain',quality:profile.quality}})
      if(optimizedDownload.error)throw optimizedDownload.error
      const optimizedBlob=optimizedDownload.data
      const optimizedType=optimizedBlob.type||attachment.content_type||'image/jpeg'
      const thumbnailDownload=await bucket.download(attachment.storage_path,{transform:{width:320,height:320,resize:'contain',quality:profile.thumbnailQuality}})
      if(thumbnailDownload.error)throw thumbnailDownload.error
      const thumbnailBlob=thumbnailDownload.data
      const thumbnailType=thumbnailBlob.type||optimizedType
      const originalSize=Number(attachment.original_size_bytes??attachment.size_bytes??0)
      if(originalSize>0&&optimizedBlob.size+thumbnailBlob.size>=originalSize){
        kept++
        await admin.from('line_attachments').update({optimization_status:'kept_original',optimized_at:new Date().toISOString(),optimization_error:null}).eq('id',attachment.id)
        continue
      }
      const base=attachment.storage_path.replace(/\.[^.\/]+$/,'')
      const optimizedPath=`${base}.optimized.${extensionFor(optimizedType)}`,thumbnailPath=`${base}.thumb.${extensionFor(thumbnailType)}`
      const mainUpload=await bucket.upload(optimizedPath,optimizedBlob,{contentType:optimizedType,cacheControl:'31536000',upsert:true})
      if(mainUpload.error)throw mainUpload.error
      const thumbUpload=await bucket.upload(thumbnailPath,thumbnailBlob,{contentType:thumbnailType,cacheControl:'31536000',upsert:true})
      if(thumbUpload.error){await bucket.remove([optimizedPath]);throw thumbUpload.error}
      const saved=Math.max(0,originalSize-optimizedBlob.size-thumbnailBlob.size)
      const update=await admin.from('line_attachments').update({storage_path:optimizedPath,thumbnail_storage_path:thumbnailPath,
        content_type:optimizedType,size_bytes:optimizedBlob.size,original_size_bytes:originalSize||optimizedBlob.size,
        optimized_at:new Date().toISOString(),optimization_status:'optimized',optimization_error:null,storage_bytes_saved:saved}).eq('id',attachment.id)
      if(update.error){await bucket.remove([optimizedPath,thumbnailPath]);throw update.error}
      const remove=await bucket.remove([attachment.storage_path])
      if(remove.error)throw remove.error
      optimized++;savedBytes+=saved
    }catch(error){
      failed++
      await admin.from('line_attachments').update({optimization_status:'failed',optimization_error:error instanceof Error?error.message:String(error)}).eq('id',attachment.id)
    }
  }
  const {count:pending}=await admin.from('line_attachments').select('id',{count:'exact',head:true}).eq('company_id',companyId).eq('optimization_status','pending')
  return json({status:'completed',processed:(attachments??[]).length,optimized,kept,failed,saved_bytes:savedBytes,pending:pending??0,batch_size:batchSize})
})
