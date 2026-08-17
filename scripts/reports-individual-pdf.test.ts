import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source=readFileSync(new URL('../src/pages/Reports/index.tsx',import.meta.url),'utf8')

assert.match(source,/window\.open\('','_blank'\)/,'individual PDF should open a writable same-origin blank document')
assert.doesNotMatch(source,/window\.open\('','_blank','noopener,noreferrer'\)/,'noopener makes the report window unavailable for document.write')
assert.match(source,/document\.fonts&&document\.fonts\.ready/,'print should wait for fonts before opening the print dialog')
assert.doesNotMatch(source,/window\.close\(\)/,'print preview must not be closed before the browser finishes rendering')
assert.doesNotMatch(source,/id:'worked',label:'เวลาทำงานจริง'/,'net worked duration should not be a primary daily-table column')
assert.match(source,/เวลาสุทธิเก็บอยู่ในหลักฐานเวลาเข้า–ออก/,'UI should explain where the hidden net duration is available')

console.log('reports individual PDF and compact day-result layout passed')
