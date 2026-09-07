import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { scanStorageConsistency, summarizeFindings, type BlobRecord, type StoredObject } from '../_shared/storage-consistency.ts'

const admin=createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',{auth:{persistSession:false}})
const expectedSecret=Deno.env.get('STORAGE_CONSISTENCY_WORKER_SECRET')
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}})
const MAX_SCAN_RECORDS=10_000

async function listObjects(bucket:string,prefix=''):Promise<StoredObject[]> {
  const result:StoredObject[]=[]
  let offset=0
  while(true){
    const {data,error}=await admin.storage.from(bucket).list(prefix,{limit:100,offset,sortBy:{column:'name',order:'asc'}})
    if(error)throw error
    for(const item of data??[]){
      const path=prefix?`${prefix}/${item.name}`:item.name
      if(item.id===null)result.push(...await listObjects(bucket,path))
      else result.push({bucket,path})
    }
    if((data??[]).length<100)break
    offset+=100
  }
  return result
}

Deno.serve(async request=>{
  if(request.method!=='POST')return json({error:'method_not_allowed'},405)
  if(!expectedSecret)return json({error:'worker_not_configured'},503)
  if(request.headers.get('x-storage-consistency-secret')!==expectedSecret)return json({error:'unauthorized'},401)
  const body=await request.json().catch(()=>({})) as {action?:string;batch_limit?:number;verify_hashes?:boolean}
  if(body.action!=='scan')return json({error:'invalid_action'},400)
  const pageSize=Math.min(1000,Math.max(25,Number(body.batch_limit)||500))
  const blobs:BlobRecord[]=[]
  for(let offset=0;offset<MAX_SCAN_RECORDS;offset+=pageSize){
    const {data,error}=await admin.from('line_attachment_blobs')
      .select('id,company_id,storage_bucket,storage_path,thumbnail_storage_path,content_sha256,content_type').order('id').range(offset,offset+pageSize-1)
    if(error)return json({error:'blob_query_failed',detail:error.message},500)
    blobs.push(...((data??[]) as BlobRecord[]))
    if((data??[]).length<pageSize)break
  }
  if(blobs.length>=MAX_SCAN_RECORDS)return json({error:'scan_scope_exceeded',table:'line_attachment_blobs',max_records:MAX_SCAN_RECORDS},409)
  const buckets=[...new Set(blobs.map(blob=>blob.storage_bucket).filter(Boolean))]
  let objects:StoredObject[]=[]
  try { objects=(await Promise.all(buckets.map(bucket=>listObjects(bucket)))).flat() }
  catch(error){ return json({error:'storage_list_failed',detail:error instanceof Error?error.message:String(error)},500) }
  if(objects.length>=MAX_SCAN_RECORDS)return json({error:'scan_scope_exceeded',resource:'storage_objects',max_records:MAX_SCAN_RECORDS},409)
  if(body.verify_hashes){
    const candidates=new Map(blobs.map(blob=>[`${blob.storage_bucket}/${blob.storage_path}`,blob]))
    for(const object of objects){
      if(!candidates.has(`${object.bucket}/${object.path}`))continue
      const {data,error}=await admin.storage.from(object.bucket).download(object.path)
      if(error)throw error
      object.bytes=new Uint8Array(await data.arrayBuffer())
    }
  }
  const {data:setRows,error:setError}=await admin.from('accounting_document_sets').select('id,company_id,page_count').limit(MAX_SCAN_RECORDS)
  if(setError)return json({error:'document_set_query_failed',detail:setError.message},500)
  if((setRows??[]).length>=MAX_SCAN_RECORDS)return json({error:'scan_scope_exceeded',table:'accounting_document_sets',max_records:MAX_SCAN_RECORDS},409)
  const setIds=(setRows??[]).map(row=>row.id)
  const documentRows:{document_set_id:string|null}[]=[]
  if(setIds.length){
    for(let offset=0;offset<MAX_SCAN_RECORDS;offset+=pageSize){
      const {data,error}=await admin.from('accounting_documents').select('document_set_id')
        .not('document_set_id','is',null).order('id').range(offset,offset+pageSize-1)
      if(error)return json({error:'document_query_failed',detail:error.message},500)
      documentRows.push(...(data??[]))
      if((data??[]).length<pageSize)break
    }
  }
  if(documentRows.length>=MAX_SCAN_RECORDS)return json({error:'scan_scope_exceeded',table:'accounting_documents',max_records:MAX_SCAN_RECORDS},409)
  const actualCounts=(documentRows??[]).reduce<Record<string,number>>((counts,row)=>{
    if(row.document_set_id)counts[row.document_set_id]=(counts[row.document_set_id]??0)+1
    return counts
  },{})
  const documentSets=(setRows??[]).map(row=>({...row,actual_page_count:actualCounts[row.id]??0}))
  const findings=await scanStorageConsistency({blobs,objects,documentSets})
  let incidentsCreated=0,incidentsUpdated=0,failed=0
  for(const finding of findings){
    if(finding.companyId==='unknown'){ failed+=1; continue }
    const {data,error}=await admin.rpc('upsert_system_error_event',{
      target_company_id:finding.companyId,target_fingerprint:finding.fingerprint,target_correlation_key:finding.fingerprint,
      target_source:'storage_consistency_worker',target_title:`Storage consistency: ${finding.kind}`,
      target_message:JSON.stringify(finding.evidence),target_module:'document_storage',target_severity:'critical',target_metadata:finding.evidence,
    })
    if(error)failed+=1
    else if(Number(data?.occurrence_count??1)>1)incidentsUpdated+=1
    else incidentsCreated+=1
  }
  return json({action:'scan',dry_run:false,before:{checked_blobs:blobs.length,checked_objects:objects.length,checked_document_sets:documentSets.length},findings:summarizeFindings(findings),safe_repairs:{attempted:0,completed:0,reason:'no_lossless_object_repair_available'},incidents:{created:incidentsCreated,updated:incidentsUpdated,failed},after:{unresolved_findings:findings.length},hash_verification:Boolean(body.verify_hashes),page_size:pageSize})
})
