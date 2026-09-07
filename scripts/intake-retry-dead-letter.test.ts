import assert from 'node:assert/strict'
import fs from 'node:fs'

const migration = fs.readFileSync('supabase/migrations/202608190008_document_flow_intake_quality_and_facets.sql', 'utf8')
const page = fs.readFileSync('src/pages/IntakeRoom.tsx', 'utf8')
assert.match(migration, /when 'retry'/)
assert.match(migration, /when 'recover'/)
assert.match(migration, /when 'dead_letter'/)
assert.match(migration, /intake_dead_letter_room/)
assert.match(page, /'retry' \| 'recover' \| 'dead_letter'/)
assert.match(page, /workflowTransition\(actionMenuRow, 'retry'/)
assert.match(page, /workflowTransition\(actionMenuRow, 'dead_letter'/)
assert.match(page, /last_error/)
console.log('intake retry/dead-letter contract passed')
