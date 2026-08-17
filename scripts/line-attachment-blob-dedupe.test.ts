import assert from 'node:assert/strict'
import fs from 'node:fs'

const migration=fs.readFileSync('supabase/migrations/202608160022_logical_line_attachment_dedupe.sql','utf8')
const webhook=fs.readFileSync('supabase/functions/line-webhook/index.ts','utf8')

assert.match(migration,/create table if not exists public\.line_attachment_blobs/)
assert.match(migration,/unique\(company_id,content_sha256\)/)
assert.match(migration,/drop constraint if exists line_attachments_storage_path_key/)
assert.match(migration,/one_logical_attachment_per_message/)
assert.match(migration,/perceptual_hash[\s\S]*never an automatic deletion key/)
assert.match(migration, /where work_key='DOC-INGEST-005'/)

assert.match(webhook,/from\('line_attachment_blobs'\)[\s\S]*eq\('company_id', companyId\)[\s\S]*eq\('content_sha256', contentHash\)/)
assert.match(webhook,/duplicate_of: duplicateAttachment\?\.id \?\? null/)
assert.doesNotMatch(webhook,/if \(duplicateAttachment\) \{[\s\S]{0,800}return 'skipped_duplicate'/)
assert.match(webhook,/blob_id: physicalBlob\.id/)
assert.match(webhook,/attachment_status: duplicateAttachment \? 'deduplicated' : 'saved'/)

console.log('line attachment physical/logical dedupe contract passed')
