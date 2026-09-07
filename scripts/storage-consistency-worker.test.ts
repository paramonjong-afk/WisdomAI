import assert from 'node:assert/strict'
import { scanStorageConsistency, summarizeFindings, sha256Hex } from '../supabase/functions/_shared/storage-consistency.ts'

const bytes=new TextEncoder().encode('correct bytes')
const correctHash=await sha256Hex(bytes)
const findings=await scanStorageConsistency({
  blobs:[
    {id:'missing',company_id:'tenant-a',storage_bucket:'docs',storage_path:'tenant-a/blobs/missing',thumbnail_storage_path:null,content_sha256:correctHash,content_type:'application/pdf'},
    {id:'thumb',company_id:'tenant-a',storage_bucket:'docs',storage_path:'tenant-a/blobs/thumb',thumbnail_storage_path:'tenant-a/blobs/thumb.webp',content_sha256:correctHash,content_type:'image/webp'},
    {id:'hash',company_id:'tenant-a',storage_bucket:'docs',storage_path:'tenant-a/blobs/hash',thumbnail_storage_path:null,content_sha256:'0'.repeat(64),content_type:'image/webp'},
    {id:'tenant',company_id:'tenant-a',storage_bucket:'docs',storage_path:'tenant-b/blobs/wrong',thumbnail_storage_path:null,content_sha256:correctHash,content_type:'image/webp'},
  ],
  objects:[
    {bucket:'docs',path:'tenant-a/blobs/thumb',bytes},{bucket:'docs',path:'tenant-a/blobs/hash',bytes},
    {bucket:'docs',path:'tenant-b/blobs/wrong',bytes},{bucket:'docs',path:'tenant-a/blobs/orphan',bytes},
  ],
  documentSets:[{id:'set-1',company_id:'tenant-a',page_count:3,actual_page_count:2}],
})
assert.deepEqual(summarizeFindings(findings),{dangling_db:1,missing_thumbnail:1,hash_mismatch:1,wrong_tenant_namespace:1,orphan_object:1,missing_page:1})
assert.equal(new Set(findings.map(item=>item.fingerprint)).size,findings.length)
const repeated=await scanStorageConsistency({blobs:[],objects:[{bucket:'docs',path:'tenant-a/blobs/orphan'}]})
assert.equal(repeated[0].fingerprint,findings.find(item=>item.kind==='orphan_object')?.fingerprint)
console.log('storage consistency fault-injection contract passed')
