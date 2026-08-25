import type { FlowRegistryFilters, FlowRegistryRecord, FlowRegistrySnapshot } from './flowRegistryGateway.ts'

export type ControlModule = 'intake' | 'ai' | 'master' | 'accounting' | 'hr' | 'payroll' | 'advance' | 'closed'
export type ControlProblemType = 'unknown' | 'audit_missing' | 'duplicate' | 'source_missing' | 'amount_mismatch' | 'name_account_mismatch' | 'waiting_approval' | 'msg_failed_retry' | 'sla_overdue'
export type FlowControlFilters = { companyId:string; from:string; to:string; module:ControlModule|'all'; status:'all'|FlowRegistryRecord['status']; source:string; owner:string; problem:ControlProblemType|'all' }
export type FlowControlNode = { key:ControlModule; label:string; total:number; normal:number; pending:number; problem:number; overdue:number; actionable:number }
export type FlowControlProblem = { id:string; type:ControlProblemType; label:string; module:ControlModule; taskId:string; sourceId:string|null; source:string; owner:string; slaDueAt:string|null; nextAction:string; status:FlowRegistryRecord['status']; auditRefs:string[]; blocker:string|null; deepLink:string }
export type FlowControlSnapshot = { records:FlowRegistryRecord[]; nodes:FlowControlNode[]; problems:FlowControlProblem[]; summary:{total:number;problems:number;overdue:number;waitingInfo:number;closedToday:number}; reconciliation:{rows:number;open:number;closed:number;consistent:boolean}; sourceWarnings:string[]; lastUpdated:string }

const nodeLabels:Record<ControlModule,string>={intake:'รับเข้า',ai:'AI แยกประเภท',master:'Master Data ตรวจ',accounting:'บัญชี',hr:'HR',payroll:'ค่าแรง',advance:'เงินสำรองจ่าย',closed:'ปิดรายการ'}
const textOf=(record:FlowRegistryRecord)=>`${record.title} ${record.destination} ${record.error??''} ${record.blocker??''} ${record.nextAction}`.toLowerCase()
const isOverdue=(record:FlowRegistryRecord,now:number)=>Boolean(record.slaDueAt&&record.status!=='closed'&&new Date(record.slaDueAt).getTime()<now)
const isProblem=(record:FlowRegistryRecord,now:number)=>record.status==='error'||Boolean(record.error||record.blocker)||isOverdue(record,now)

export const modulesForRecord=(record:FlowRegistryRecord):ControlModule[]=>{
  if(record.status==='closed'||record.stage==='ปิดงาน')return ['closed']
  const modules=new Set<ControlModule>(['intake']),text=textOf(record)
  if(record.module==='omni')modules.add('ai')
  if(record.module==='omni'&&(record.stage==='Filter'||record.stage==='ตรวจซ้ำ'||record.status==='waiting'))modules.add('master')
  if(text.includes('บัญชี')||text.includes('account')||record.module==='advance')modules.add('accounting')
  if(record.module==='attendance'||text.includes('hr'))modules.add('hr')
  if(text.includes('ค่าแรง')||text.includes('payroll')||record.module==='attendance')modules.add('payroll')
  if(record.module==='advance'||text.includes('เงินสำรอง')||text.includes('finance_primary'))modules.add('advance')
  return [...modules]
}

const deepLinkFor=(record:FlowRegistryRecord)=>`${record.detailPath}?${new URLSearchParams({task_id:record.taskId,source_id:record.sourceId??'',audit_key:record.auditKey}).toString()}`
const addProblem=(rows:FlowControlProblem[],seen:Set<string>,record:FlowRegistryRecord,type:ControlProblemType,label:string,module:ControlModule)=>{
  const id=`${type}:${record.module}:${record.id}`
  if(seen.has(id))return
  seen.add(id)
  rows.push({id,type,label,module,taskId:record.taskId,sourceId:record.sourceId,source:record.sourceRefs.join(', ')||'-',owner:record.owner||'ยังไม่กำหนด',slaDueAt:record.slaDueAt,nextAction:record.nextAction,status:record.status,auditRefs:record.auditRefs,blocker:record.blocker,deepLink:deepLinkFor(record)})
}

export function buildFlowControlSnapshot(base:FlowRegistrySnapshot,filters:Pick<FlowControlFilters,'module'|'problem'>,now=Date.now()):FlowControlSnapshot{
  const records=filters.module==='all'?base.records:base.records.filter(record=>modulesForRecord(record).includes(filters.module as ControlModule))
  const problems:FlowControlProblem[]=[],seen=new Set<string>()
  for(const record of records){
    const text=textOf(record),module=modulesForRecord(record).at(-1)??'intake'
    if(!record.destination||/ยังไม่ระบุ|unknown/.test(text))addProblem(problems,seen,record,'unknown','Unknown / ยังไม่ทราบปลายทาง',module)
    if(record.auditRefs.length===0)addProblem(problems,seen,record,'audit_missing','Audit missing',module)
    if(/duplicate|รายการซ้ำ|fingerprint ซ้ำ/.test(text)||(record.stage==='ตรวจซ้ำ'&&record.status==='error'))addProblem(problems,seen,record,'duplicate','Duplicate',module)
    if(record.sourceRefs.length===0||!record.sourceId)addProblem(problems,seen,record,'source_missing','Source missing',module)
    if(/amount[_ ]?mismatch|ยอดไม่ตรง/.test(text))addProblem(problems,seen,record,'amount_mismatch','Amount mismatch',module)
    if(/name[_ /]?account[_ ]?mismatch|ชื่อ.*บัญชี.*ไม่ตรง|ชื่อไม่ตรง|บัญชีไม่ตรง/.test(text))addProblem(problems,seen,record,'name_account_mismatch','Name / account mismatch',module)
    if(record.status==='waiting'||/รอ.*อนุมัติ|waiting approval|pending_approval/.test(text))addProblem(problems,seen,record,'waiting_approval','Waiting approval',module)
    if(/msg failed|delivery_failed|retry|ส่งไม่สำเร็จ/.test(text))addProblem(problems,seen,record,'msg_failed_retry','MSG failed / retry',module)
    if(isOverdue(record,now))addProblem(problems,seen,record,'sla_overdue','SLA overdue',module)
  }
  const filteredProblems=filters.problem==='all'?problems:problems.filter(problem=>problem.type===filters.problem)
  const order:ControlModule[]=['intake','ai','master','accounting','hr','payroll','advance','closed']
  const nodes=order.map(key=>{const matches=records.filter(record=>modulesForRecord(record).includes(key));return {key,label:nodeLabels[key],total:matches.length,normal:matches.filter(record=>record.status==='open'&&!isProblem(record,now)).length,pending:matches.filter(record=>record.status==='waiting').length,problem:matches.filter(record=>isProblem(record,now)).length,overdue:matches.filter(record=>isOverdue(record,now)).length,actionable:matches.filter(record=>record.status!=='closed'&&record.nextAction!=='ไม่มี').length}})
  const closed=records.filter(record=>record.status==='closed'),today=new Date(now).toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'})
  return {records,nodes,problems:filteredProblems,summary:{total:records.length,problems:problems.length,overdue:problems.filter(problem=>problem.type==='sla_overdue').length,waitingInfo:records.filter(record=>record.status==='waiting').length,closedToday:closed.filter(record=>new Date(record.updatedAt).toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'})===today).length},reconciliation:{rows:records.length,open:records.length-closed.length,closed:closed.length,consistent:records.length===records.length-closed.length+closed.length},sourceWarnings:base.sourceWarnings,lastUpdated:base.lastUpdated}
}

export async function loadFlowControlCenter(filters:FlowControlFilters,localFixture=false){
  const registryFilters:FlowRegistryFilters={companyId:filters.companyId,from:filters.from,to:filters.to,module:'all',status:filters.status,source:filters.source,owner:filters.owner}
  const base=localFixture?await (await import('./flowControlCenterFixture.ts')).loadFlowControlFixture(registryFilters):await (await import('./flowRegistryGateway.ts')).loadFlowRegistrySnapshot(registryFilters)
  return buildFlowControlSnapshot(base,filters)
}
