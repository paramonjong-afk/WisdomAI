import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const table=readFileSync('src/components/StandardDataTable.tsx','utf8')
const setup=readFileSync('src/pages/WorkforceSetup/index.tsx','utf8')

assert.match(table,/TableSortLabel/)
assert.match(table,/sortValue\?:/)
assert.match(table,/localStorage\.setItem\(stateKey/)
assert.match(table,/localeCompare\(String\(b\),'th'/)
assert.match(table,/sortedRows\.map/)
assert.match(table,/await import\('jspdf'\)/)
assert.match(table,/pdf\.save\(/)
assert.doesNotMatch(table,/window\.print\(\)/)
assert.match(setup,/defaultSort=\{\{columnId:'employee'\}\}/)
console.log('standard table sorting regression passed')
