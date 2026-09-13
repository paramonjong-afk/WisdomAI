export type ApprovalLoopEvent = {
  id: number
  work_key?: string
  old_status: string | null
  new_status: string | null
  created_at: string
}

export type ApprovalLoopDetection = {
  detected: boolean
  rounds: number
  lastDetectedAt: string | null
  fingerprint: string | null
  nextAction: string
}

// A loop only counts after review was approved, claimed by a worker, and then
// returned to review. Reminder events that keep a row in review are ignored.
export function detectApprovalLoop(workKey: string, events: ApprovalLoopEvent[]): ApprovalLoopDetection {
  let phase = 0
  let rounds = 0
  let lastDetectedAt: string | null = null
  for (const event of [...events].sort((left, right) => left.created_at.localeCompare(right.created_at))) {
    if (!event.new_status || event.old_status === event.new_status) continue
    if (event.new_status === 'review') {
      if (phase === 3) {
        rounds += 1
        lastDetectedAt = event.created_at
      }
      phase = 1
    } else if (event.new_status === 'ready' && phase === 1) {
      phase = 2
    } else if (event.new_status === 'doing' && phase === 2) {
      phase = 3
    }
  }
  const detected = rounds > 0
  return {
    detected,
    rounds,
    lastDetectedAt,
    fingerprint: detected && lastDetectedAt ? `approval-loop:${workKey}:${rounds}:${lastDetectedAt}` : null,
    nextAction: detected
      ? 'หยุดวนอนุมัติอัตโนมัติชั่วคราว ตรวจเหตุผลที่ worker ส่งกลับ และตัดสินใจแก้ scope หรือปิดงานก่อนเริ่มรอบใหม่'
      : 'ยังไม่พบลำดับอนุมัติวนซ้ำ',
  }
}
