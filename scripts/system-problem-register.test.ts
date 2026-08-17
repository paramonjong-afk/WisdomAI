import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source=readFileSync('src/pages/SystemHealth/index.tsx','utf8')

assert.match(source,/type ProblemStatus='pending'\|'repairing'\|'verification'\|'stuck'\|'resolved'/)
assert.match(source,/error_fingerprint,evidence,current_step,owner,created_at,updated_at/)
assert.match(source,/item\.status==='done'\?'resolved'/)
assert.match(source,/item\.status==='doing'\?'repairing'/)
assert.match(source,/item\.status==='review'\?'verification'/)
assert.match(source,/item\.status==='blocked'\?'stuck'/)
assert.match(source,/ทะเบียนปัญหา/)
assert.match(source,/รวมเหตุที่ Monitor ตรวจพบและงานซ่อมจากคิวกลาง/)
assert.match(source,/system-problem-register/)
assert.match(source,/ผลการแก้ไข/)

console.log('system problem register workflow checks passed')
