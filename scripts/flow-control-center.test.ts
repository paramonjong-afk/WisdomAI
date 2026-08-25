import assert from 'node:assert/strict'
import fs from 'node:fs'
import { loadFlowControlCenter } from '../src/services/flowControlCenter.ts'

const page=fs.readFileSync('src/pages/FlowControlCenter/index.tsx','utf8')
const service=fs.readFileSync('src/services/flowControlCenter.ts','utf8')
const navigation=fs.readFileSync('src/utils/navigation.ts','utf8')
const router=fs.readFileSync('src/router/index.tsx','utf8')
const topBar=fs.readFileSync('src/layouts/TopBar.tsx','utf8')

for(const label of ['รับเข้า','AI แยกประเภท','Master Data ตรวจ','บัญชี','HR','ค่าแรง','เงินสำรองจ่าย','ปิดรายการ'])assert.match(service,new RegExp(label))
for(const problem of ['unknown','audit_missing','duplicate','source_missing','amount_mismatch','name_account_mismatch','waiting_approval','msg_failed_retry','sla_overdue'])assert.match(service,new RegExp(problem))
assert.match(page,/useSearchParams/)
assert.match(page,/Problem Queue/)
assert.match(page,/Count reconciliation/)
assert.match(page,/local_test_data/)
assert.match(page,/เปิดงานจริง/)
assert.match(page,/component="button" type="button"/, 'flow nodes must be keyboard and screen-reader actionable')
assert.match(router,/flow-control-center/)
for(const group of ['ภาพรวมและควบคุมงาน','Intake และข้อมูลกลาง','บุคคลและเวลา','บัญชีและการเงิน','ค่าแรงและเงินสำรอง','โครงการและวัสดุ','การสื่อสาร','ระบบและตรวจสอบ'])assert.match(navigation,new RegExp(group))
assert.match(topBar,/mobileNavigationGroups/)
assert.doesNotMatch(topBar,/mobileNavigationItems = navigationItems\.filter/, 'mobile menu must not collapse to attendance and profile only')

const filters={companyId:'local-fixture-company',from:new Date(Date.now()-7*86400000).toISOString(),to:new Date(Date.now()+60000).toISOString(),module:'all' as const,status:'all' as const,source:'',owner:'',problem:'all' as const}
const snapshot=await loadFlowControlCenter(filters,true)
assert.equal(snapshot.reconciliation.consistent,true)
assert.equal(snapshot.reconciliation.rows,snapshot.reconciliation.open+snapshot.reconciliation.closed)
assert.equal(new Set(snapshot.problems.map(problem=>problem.id)).size,snapshot.problems.length,'Problem IDs must be idempotent')
for(const type of ['unknown','audit_missing','duplicate','source_missing','amount_mismatch','name_account_mismatch','waiting_approval','msg_failed_retry','sla_overdue'])assert.ok(snapshot.problems.some(problem=>problem.type===type),`fixture must include ${type}`)
assert.ok(snapshot.problems.every(problem=>problem.deepLink.startsWith('/')&&problem.deepLink.includes('task_id=')&&problem.deepLink.includes('audit_key=')))
assert.ok(snapshot.nodes.every(node=>node.total>=node.normal&&node.total>=node.pending&&node.total>=node.problem&&node.total>=node.overdue))

const problemOnly=await loadFlowControlCenter({...filters,problem:'amount_mismatch'},true)
assert.ok(problemOnly.problems.length>0&&problemOnly.problems.every(problem=>problem.type==='amount_mismatch'))
const ownerOnly=await loadFlowControlCenter({...filters,owner:'payroll-manager-local'},true)
assert.ok(ownerOnly.records.length===1&&ownerOnly.records[0].taskId==='PAYROLL-LOCAL-012')
const moduleOnly=await loadFlowControlCenter({...filters,module:'advance'},true)
assert.ok(moduleOnly.records.length>0&&moduleOnly.records.every(record=>record.module==='advance'))

console.log(`flow control center tests passed: ${snapshot.records.length} tasks, ${snapshot.problems.length} deterministic problems`)
