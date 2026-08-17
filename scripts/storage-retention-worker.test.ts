import assert from 'node:assert/strict'
import fs from 'node:fs'
import { normalizeBatchLimit, trashPath } from '../supabase/functions/_shared/storage-retention.ts'

const migration=fs.readFileSync('supabase/migrations/202608160024_storage_retention_lifecycle.sql','utf8')
const worker=fs.readFileSync('supabase/functions/storage-retention-worker/index.ts','utf8')
assert.equal(normalizeBatchLimit(0),1); assert.equal(normalizeBatchLimit(1000),100); assert.equal(normalizeBatchLimit('bad'),25)
assert.equal(trashPath('blob-1','tenant/folder/a.jpg'),'.trash/blob-1/a.jpg')
assert.match(migration,/not exists\(select 1 from public\.line_attachments ref where ref\.blob_id=blob\.id\)/)
assert.match(migration,/not blob\.legal_hold/); assert.match(migration,/interval '7 days'/)
assert.match(migration,/operation_key text not null unique/); assert.match(migration,/get diagnostics changed_count=row_count/)
assert.match(migration,/where work_key='DOC-INGEST-008'/)
assert.match(worker,/body\.action === 'dry_run'/); assert.match(worker,/bytes_reclaimed/); assert.match(worker,/batchLimit/)
assert.match(worker,/bucket\.move\(candidate\.trash_storage_path, candidate\.storage_path\)/)
console.log('storage retention lifecycle contract passed')
