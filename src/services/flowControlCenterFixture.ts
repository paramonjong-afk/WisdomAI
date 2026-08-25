import { loadLocalFlowRegistrySnapshot } from './flowRegistryLocalFixture.ts'
import type { FlowRegistryFilters, FlowRegistryRecord } from './flowRegistryGateway.ts'

const ago=(minutes:number)=>new Date(Date.now()-minutes*60_000).toISOString()
const extraRecords=():FlowRegistryRecord[]=>[
  {id:'MASTER-LOCAL-009',taskId:'MASTER-LOCAL-009',module:'omni',stage:'Filter',status:'error',title:'ชื่อและบัญชีไม่ตรง',destination:'บัญชี',owner:'master-review-local',createdAt:ago(260),updatedAt:ago(30),ageMinutes:260,error:'name_account_mismatch',detailPath:'/master-data',sourceId:'DOC-LOCAL-009',auditKey:'omni:MASTER-LOCAL-009',sourceRefs:['DOC-LOCAL-009'],evidenceRefs:['OCR-LOCAL-009'],auditRefs:['AUDIT-LOCAL-009'],nextAction:'เปรียบเทียบ Master Data',blocker:'ชื่อไม่ตรงกับบัญชี',slaDueAt:ago(20)},
  {id:'ACCOUNT-LOCAL-010',taskId:'ACCOUNT-LOCAL-010',module:'omni',stage:'อนุมัติ/บันทึก',status:'error',title:'ยอดเอกสารไม่ตรง',destination:'บัญชี',owner:'accounting-local',createdAt:ago(180),updatedAt:ago(25),ageMinutes:180,error:'amount_mismatch',detailPath:'/accounting-documents',sourceId:'DOC-LOCAL-010',auditKey:'omni:ACCOUNT-LOCAL-010',sourceRefs:['DOC-LOCAL-010'],evidenceRefs:['SLIP-LOCAL-010'],auditRefs:['AUDIT-LOCAL-010'],nextAction:'ตรวจยอดกับหลักฐาน',blocker:'ยอดไม่ตรง',slaDueAt:ago(-60)},
  {id:'UNKNOWN-LOCAL-011',taskId:'UNKNOWN-LOCAL-011',module:'omni',stage:'วิเคราะห์',status:'waiting',title:'Unknown source classification',destination:'',owner:'intake-local',createdAt:ago(90),updatedAt:ago(10),ageMinutes:90,error:null,detailPath:'/document-flows',sourceId:null,auditKey:'omni:UNKNOWN-LOCAL-011',sourceRefs:[],evidenceRefs:['MSG-LOCAL-011'],auditRefs:[],nextAction:'ขอข้อมูลต้นทางเพิ่ม',blocker:'source missing',slaDueAt:ago(-30)},
  {id:'PAYROLL-LOCAL-012',taskId:'PAYROLL-LOCAL-012',module:'attendance',stage:'อนุมัติ/บันทึก',status:'waiting',title:'ค่าแรง waiting approval',destination:'HR / ค่าแรง',owner:'payroll-manager-local',createdAt:ago(420),updatedAt:ago(50),ageMinutes:420,error:null,detailPath:'/reports',sourceId:'ATT-LOCAL-012',auditKey:'attendance:PAYROLL-LOCAL-012',sourceRefs:['ATT-LOCAL-012'],evidenceRefs:['TIMESHEET-LOCAL-012'],auditRefs:['AUDIT-LOCAL-012'],nextAction:'อนุมัติรอบค่าแรง',blocker:'waiting approval',slaDueAt:ago(40)},
]

export async function loadFlowControlFixture(filters:FlowRegistryFilters){
  const base=await loadLocalFlowRegistrySnapshot({...filters,module:'all',status:'all',source:'',owner:''})
  const source=filters.source.toLowerCase(),owner=filters.owner.toLowerCase()
  const records=[...base.records,...extraRecords()].filter(record=>(filters.status==='all'||record.status===filters.status)&&(!source||record.sourceRefs.some(ref=>ref.toLowerCase().includes(source)))&&(!owner||record.owner.toLowerCase().includes(owner)))
  return {...base,records,lastUpdated:new Date().toISOString(),sourceWarnings:['LOCAL FIXTURE: Flow Control Center ไม่อ่านหรือเขียน Production']}
}
