import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/202608150027_partial_accounting_review_draft.sql', 'utf8')
const page = readFileSync('src/pages/AccountingDocuments/index.tsx', 'utf8')

assert.match(migration, /review_draft jsonb/)
assert.match(migration, /save_accounting_document_review_draft/)
assert.match(migration, /pg_column_size\(p_draft\)>1048576/)
assert.match(migration, /clear_accounting_document_review_draft/)
assert.match(page, /const savePartialDraft/)
assert.match(page, /savedDraft\?\.header/)
assert.match(page, /draftLineMap/)
assert.match(page, /onClick=\{\(\) => void savePartialDraft\(\)\}/)
assert.match(page, /onClick=\{\(\) => void savePartialDraft\(\)\} disabled=\{saving \|\| lines\.length === 0 \|\| !hasUnsavedDraftChanges\}/)
assert.match(page, /กลับมาแก้ไขต่อภายหลังได้/)

console.log('partial accounting review draft tests passed')
