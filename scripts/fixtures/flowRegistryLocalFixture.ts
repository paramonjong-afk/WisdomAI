import type { FlowRegistryFilters, FlowRegistryNode, FlowRegistryRecord, FlowRegistrySnapshot } from '../../src/services/flowRegistryGateway'

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

const fixtureRecords = (): FlowRegistryRecord[] => [
  {
    id: 'INTAKE-LOCAL-001', taskId: 'INTAKE-LOCAL-001', module: 'omni', stage: 'วิเคราะห์', status: 'open',
    title: 'เอกสารจาก LINE รอตรวจประเภท', destination: 'บัญชี', owner: 'intake-local', createdAt: minutesAgo(30), updatedAt: minutesAgo(12), ageMinutes: 30,
    error: null, blocker: null, nextAction: 'ตรวจประเภทเอกสาร', detailPath: '/document-flows', sourceId: 'DOC-LOCAL-001',
    sourceRefs: ['DOC-LOCAL-001', 'MSG-LOCAL-001'], evidenceRefs: ['slip-local-001.jpg'], auditRefs: ['AUDIT-LOCAL-001'], auditKey: 'omni:INTAKE-LOCAL-001', slaDueAt: minutesAgo(-210),
  },
  {
    id: 'INTAKE-LOCAL-002', taskId: 'INTAKE-LOCAL-002', module: 'omni', stage: 'ตรวจซ้ำ', status: 'error',
    title: 'พบ fingerprint ซ้ำ', destination: 'บัญชี', owner: 'reviewer-local', createdAt: minutesAgo(1_800), updatedAt: minutesAgo(90), ageMinutes: 1_800,
    error: 'possible_duplicate', blocker: 'รอตัดสินรายการต้นทางหลัก', nextAction: 'เปรียบเทียบหลักฐานซ้ำ', detailPath: '/document-flows', sourceId: 'DOC-LOCAL-002',
    sourceRefs: ['DOC-LOCAL-002', 'MSG-LOCAL-002'], evidenceRefs: ['receipt-local-002.pdf'], auditRefs: ['AUDIT-LOCAL-002'], auditKey: 'omni:INTAKE-LOCAL-002', slaDueAt: minutesAgo(360),
  },
  {
    id: 'FILTER-LOCAL-003', taskId: 'FILTER-LOCAL-003', module: 'omni', stage: 'Filter', status: 'waiting',
    title: 'ข้อมูลผู้รับไม่ครบ', destination: 'บัญชี', owner: 'accounting-local', createdAt: minutesAgo(300), updatedAt: minutesAgo(45), ageMinutes: 300,
    error: null, blocker: 'รอข้อมูลชื่อผู้รับ', nextAction: 'ขอข้อมูลเพิ่มจากต้นทาง', detailPath: '/document-flows', sourceId: 'DOC-LOCAL-003',
    sourceRefs: ['DOC-LOCAL-003', 'ROOM-LOCAL-FINANCE'], evidenceRefs: ['ocr-local-003'], auditRefs: ['AUDIT-LOCAL-003'], auditKey: 'omni:FILTER-LOCAL-003', slaDueAt: minutesAgo(-60),
  },
  {
    id: 'ROUTE-LOCAL-004', taskId: 'ROUTE-LOCAL-004', module: 'omni', stage: 'ส่งปลายทาง', status: 'open',
    title: 'ส่งเอกสารเข้าคิว HR', destination: 'HR', owner: 'system', createdAt: minutesAgo(90), updatedAt: minutesAgo(8), ageMinutes: 90,
    error: null, blocker: null, nextAction: 'HR รับงาน', detailPath: '/document-flows', sourceId: 'DOC-LOCAL-004',
    sourceRefs: ['DOC-LOCAL-004', 'ROOM-LOCAL-HR'], evidenceRefs: ['attachment-local-004'], auditRefs: ['AUDIT-LOCAL-004'], auditKey: 'omni:ROUTE-LOCAL-004', slaDueAt: minutesAgo(-150),
  },
  {
    id: 'ATT-LOCAL-005', taskId: 'ATT-LOCAL-005', module: 'attendance', stage: 'อนุมัติ/บันทึก', status: 'waiting',
    title: 'ลงเวลารอผู้จัดการอนุมัติ', destination: 'HR', owner: 'hr-manager-local', createdAt: minutesAgo(1_600), updatedAt: minutesAgo(120), ageMinutes: 1_600,
    error: null, blocker: 'ผู้อนุมัติยังไม่รับงาน', nextAction: 'อนุมัติและบันทึกเวลา', detailPath: '/chat', sourceId: 'MSG-LOCAL-005',
    sourceRefs: ['MSG-LOCAL-005', 'ROOM-LOCAL-HR'], evidenceRefs: ['attendance-local-005'], auditRefs: ['AUDIT-LOCAL-005'], auditKey: 'attendance:ATT-LOCAL-005', slaDueAt: minutesAgo(160),
  },
  {
    id: 'ADV-LOCAL-006', taskId: 'ADV-LOCAL-006', module: 'advance', stage: 'อนุมัติ/บันทึก', status: 'open',
    title: 'เงินสำรองจ่ายรอบันทึก', destination: 'เงินสำรองจ่าย', owner: 'finance-local', createdAt: minutesAgo(120), updatedAt: minutesAgo(20), ageMinutes: 120,
    error: null, blocker: null, nextAction: 'ตรวจยอดและบันทึก', detailPath: '/advance-settlements', sourceId: 'DOC-LOCAL-006',
    sourceRefs: ['DOC-LOCAL-006', 'ADV-LOCAL-006'], evidenceRefs: ['slip-local-006.jpg'], auditRefs: ['AUDIT-LOCAL-006'], auditKey: 'advance:ADV-LOCAL-006', slaDueAt: minutesAgo(-120),
  },
  {
    id: 'ADV-LOCAL-007', taskId: 'ADV-LOCAL-007', module: 'advance', stage: 'ปิดงาน', status: 'closed',
    title: 'เงินสำรองจ่ายปิดสำเร็จ', destination: 'เงินสำรองจ่าย', owner: 'finance-local', createdAt: minutesAgo(60), updatedAt: minutesAgo(5), ageMinutes: 60,
    error: null, blocker: null, nextAction: 'ไม่มี', detailPath: '/advance-settlements', sourceId: 'DOC-LOCAL-007',
    sourceRefs: ['DOC-LOCAL-007', 'ADV-LOCAL-007'], evidenceRefs: ['slip-local-007.jpg'], auditRefs: ['AUDIT-LOCAL-007'], auditKey: 'advance:ADV-LOCAL-007', slaDueAt: null,
  },
  {
    id: 'MSG-LOCAL-008', taskId: 'MSG-LOCAL-008', module: 'advance', stage: 'ส่งปลายทาง', status: 'error',
    title: 'System Confirmation ส่งไม่สำเร็จ', destination: 'เงินสำรองจ่าย', owner: 'system', createdAt: minutesAgo(75), updatedAt: minutesAgo(15), ageMinutes: 75,
    error: 'delivery_failed', blocker: 'MSG failed', nextAction: 'Retry เฉพาะ delivery นี้', detailPath: '/advance-settlements', sourceId: 'ADV-LOCAL-008',
    sourceRefs: ['ADV-LOCAL-008', 'ROOM-LOCAL-FINANCE'], evidenceRefs: ['DELIVERY-LOCAL-008'], auditRefs: ['AUDIT-LOCAL-008'], auditKey: 'advance:MSG-LOCAL-008', slaDueAt: minutesAgo(-45),
  },
]

const statusForStage = (stage: string): FlowRegistryNode['status'] => {
  if (stage === 'ปิดงาน') return 'closed'
  if (stage === 'ตรวจซ้ำ') return 'error'
  if (stage === 'Filter') return 'waiting'
  return stage === 'รับเข้า' ? 'normal' : 'working'
}

export async function loadLocalFlowRegistrySnapshot(filters: FlowRegistryFilters): Promise<FlowRegistrySnapshot> {
  const sourceNeedle = filters.source.trim().toLowerCase()
  const ownerNeedle = filters.owner.trim().toLowerCase()
  const from = new Date(filters.from).getTime()
  const to = new Date(filters.to).getTime()
  const records = fixtureRecords().filter((record) => {
    const createdAt = new Date(record.createdAt).getTime()
    return (filters.module === 'all' || record.module === filters.module)
      && (filters.status === 'all' || record.status === filters.status)
      && (!sourceNeedle || record.sourceRefs.some((ref) => ref.toLowerCase().includes(sourceNeedle)))
      && (!ownerNeedle || record.owner.toLowerCase().includes(ownerNeedle))
      && createdAt >= from && createdAt <= to
  })
  const stages = ['รับเข้า', 'วิเคราะห์', 'ตรวจซ้ำ', 'Filter', 'ส่งปลายทาง', 'อนุมัติ/บันทึก', 'ปิดงาน']
  const nodes = stages.map((stage, index): FlowRegistryNode => {
    const matches = index === 0 ? records : records.filter((record) => record.stage === stage)
    return { key: ['received', 'analysis', 'dedupe', 'filter', 'destination', 'approval', 'closed'][index], label: stage, count: matches.length, trend: 0, status: statusForStage(stage), maxAgeMinutes: matches.reduce((max, record) => Math.max(max, record.ageMinutes), 0) }
  })
  const destinationMap = new Map<string, number>()
  records.forEach((record) => destinationMap.set(record.destination, (destinationMap.get(record.destination) ?? 0) + 1))
  const open = records.filter((record) => record.status !== 'closed')
  const closed = records.filter((record) => record.status === 'closed').length
  const forwarded = records.filter((record) => ['ส่งปลายทาง', 'อนุมัติ/บันทึก', 'ปิดงาน'].includes(record.stage)).length
  return {
    receivedToday: records.filter((record) => new Date(record.createdAt).toDateString() === new Date().toDateString()).length,
    underReview: records.filter((record) => record.status === 'open' || ['วิเคราะห์', 'Filter'].includes(record.stage)).length,
    waitingForInfo: records.filter((record) => record.status === 'waiting').length,
    forwarded,
    slaBreached: open.filter((record) => record.ageMinutes > 24 * 60).length,
    closedSuccessfully: closed,
    nodes,
    destinations: [...destinationMap].map(([key, count]) => ({ key, label: key, count, status: records.some((record) => record.destination === key && record.status === 'error') ? 'error' as const : 'normal' as const })),
    destinationGroups: [
      { key: 'hr', label: 'HR', count: records.filter((record) => record.destination === 'HR').length, status: 'normal' },
      { key: 'accounting', label: 'บัญชี', count: records.filter((record) => record.destination === 'บัญชี').length, status: 'normal' },
      { key: 'advance', label: 'เงินสำรองจ่าย', count: records.filter((record) => record.destination === 'เงินสำรองจ่าย').length, status: 'normal' },
    ],
    exceptions: [
      { key: 'duplicate', label: 'รายการซ้ำ', count: records.filter((record) => record.error === 'possible_duplicate').length, status: 'error' },
      { key: 'rejected', label: 'Reject', count: records.filter((record) => record.error === 'rejected').length, status: 'error' },
      { key: 'waiting_info', label: 'รอข้อมูล', count: records.filter((record) => record.status === 'waiting').length, status: 'waiting' },
      { key: 'delivery_failed', label: 'MSG failed / retry', count: records.filter((record) => record.error === 'delivery_failed').length, status: 'error' },
      { key: 'retry', label: 'Retry queue', count: records.filter((record) => record.nextAction.toLowerCase().includes('retry')).length, status: 'waiting' },
    ],
    records,
    auditTrail: Object.fromEntries(records.map((record) => [record.auditKey, record.auditRefs.map((id) => ({ id, action: 'fixture_audit', label: 'Local fixture audit', note: record.nextAction, actor: record.owner, at: record.updatedAt, status: record.status === 'closed' ? 'closed' : record.status === 'error' ? 'error' : record.status === 'waiting' ? 'waiting' : 'working' }))])),
    lastUpdated: new Date().toISOString(),
    sourceWarnings: ['LOCAL FIXTURE: ข้อมูลชุดนี้ไม่ใช่ Production และไม่มีการเรียก Supabase'],
    reconciliation: { rowCount: records.length, received: records.length, open: open.length, closed, forwarded, consistent: records.length === open.length + closed },
  }
}
