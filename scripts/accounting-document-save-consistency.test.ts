import fs from 'node:fs'
import assert from 'node:assert/strict'
const page=fs.readFileSync('src/pages/AccountingDocuments/index.tsx','utf8')
assert.match(page,/const persistCurrentDocumentType = async/)
assert.match(page,/if \(!await persistCurrentDocumentType\(\)\) \{ setSaving\(false\); return \}/)
assert.match(page,/บันทึกร่างและประเภท/)
assert.match(page,/documentLabels\[documentType\]/)
for(const action of ['processQuotation','confirmGoodsReceipt','confirmMatchedInvoice']){
  const start=page.indexOf(`const ${action} = async`)
  assert.ok(start>=0,`${action} missing`)
  assert.match(page.slice(start,start+1800),/persistCurrentDocumentType/)
}
console.log('accounting document save consistency checks passed')
