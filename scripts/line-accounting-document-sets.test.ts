import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration=readFileSync('supabase/migrations/202608160017_line_accounting_document_sets.sql','utf8')
const webhook=readFileSync('supabase/functions/line-webhook/index.ts','utf8')
const ui=readFileSync('src/pages/AccountingDocuments/index.tsx','utf8')
const splitMigration=readFileSync('supabase/migrations/202608160018_split_line_accounting_document_set.sql','utf8')
const completionMigration=readFileSync('supabase/migrations/202608160020_complete_line_accounting_document_sets.sql','utf8')

assert.match(migration,/create table if not exists public\.accounting_document_sets/)
assert.match(migration,/p_window_seconds integer default 180/)
assert.match(migration,/line_group_id is not distinct from v_message\.line_group_id/)
assert.match(migration,/line_user_id is not distinct from v_message\.line_user_id/)
assert.match(migration,/create or replace function public\.merge_accounting_document_set/)
assert.match(migration,/status='dismissed',duplicate_of=v_primary\.id/)
assert.match(migration,/accounting_document_attachments/)
assert.match(webhook,/assign_accounting_document_set/)
assert.match(webhook,/document_set_id: documentSet\?\.set_id/)
assert.match(webhook,/accounting_document_attachments/)
assert.match(ui,/ชุดเอกสารจาก LINE/)
assert.match(ui,/รวมเป็นเอกสารเดียว/)
assert.match(ui,/merge_accounting_document_set/)
assert.match(ui,/หน้า \{item\.page_number/)
assert.match(splitMigration,/detach_accounting_document_from_set/)
assert.match(ui,/แยกหน้านี้ออก/)
assert.match(readFileSync('src/pages/LineMonitor/index.tsx','utf8'),/สร้างเอกสารเข้าคิวตรวจสอบแล้ว/)

for(const pattern of [/expected_page_count integer/,/collection_closed_at/,/incomplete_notified_at/,
  /row_number\(\) over\(order by m\.occurred_at,m\.id,d\.id\)/,
  /close_accounting_document_set/,/claim_incomplete_accounting_document_sets/,/for update skip locked/,
  /document_set_incomplete_expected_/,/where work_key='DOC-INGEST-006'/]) assert.match(completionMigration,pattern)
assert.match(webhook,/onConflict: 'document_id,message_id'/)

console.log('LINE accounting multi-page document-set checks passed')
