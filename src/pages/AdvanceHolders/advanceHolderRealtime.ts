import type { AdvanceHolderSlipMatch } from '../../services/advanceHolderSlipMatch'

export type HolderRealtimeMovement = AdvanceHolderSlipMatch & {
  reviewRequired: boolean
  alreadyPosted: boolean
}

export type HolderRealtimeBalance = {
  realtimeReceived: number
  realtimePaid: number
  inTransit: number
  projectedBalance: number
  confirmedBalance: number
  variance: number
  reviewCount: number
  reviewAmount: number
  lastActivityAt: string | null
  movements: HolderRealtimeMovement[]
}

const amount = (value: number | null) => Number(value) || 0

export function isReviewRequired(movement: AdvanceHolderSlipMatch) {
  return movement.matchStatus !== 'exact'
    || movement.truthStatus !== 'confirmed'
    || !movement.routeResolved
}

export function movementReviewReasons(movement: AdvanceHolderSlipMatch, now = new Date()) {
  const reasons: string[] = []
  if (movement.matchStatus !== 'exact') reasons.push('ต้องยืนยันผู้ถือเงิน')
  if (movement.truthStatus !== 'confirmed') reasons.push('ข้อมูลสลิปยังไม่ยืนยัน')
  if (!movement.purposeType || movement.purposeType === 'unknown') reasons.push('ขาดประเภทเงิน')
  if (!movement.routeResolved) reasons.push('ขาดเส้นทางปลายทาง')
  if (movement.transferAt) {
    const parsed = new Date(movement.transferAt)
    const year = parsed.getUTCFullYear()
    if (Number.isNaN(parsed.getTime()) || year < 2020 || year > now.getUTCFullYear() + 1) reasons.push('วันที่ผิดปกติ')
  } else reasons.push('ขาดวันเวลาโอน')
  return [...new Set(reasons)]
}

export function calculateHolderRealtimeBalance(
  holderId: string,
  confirmedBalance: number,
  matches: AdvanceHolderSlipMatch[],
  postedIncomingTransactionIds: string[] = [],
  postedOutgoingItemIds: string[] = [],
): HolderRealtimeBalance {
  const postedIncoming = new Set(postedIncomingTransactionIds)
  const postedOutgoing = new Set(postedOutgoingItemIds)
  const movements = matches
    .filter((movement) => movement.holderId === holderId)
    .map((movement) => ({
      ...movement,
      reviewRequired: isReviewRequired(movement),
      alreadyPosted: movement.direction === 'incoming' ? postedIncoming.has(movement.transactionId) : postedOutgoing.has(movement.itemId),
    }))
    .sort((left, right) => (right.transferAt ?? '').localeCompare(left.transferAt ?? ''))

  const incoming = movements.filter((movement) => movement.direction === 'incoming' && !movement.alreadyPosted && ['advance_transfer', 'onward_transfer'].includes(movement.purposeType ?? ''))
  const outgoing = movements.filter((movement) => movement.direction === 'outgoing' && !movement.alreadyPosted)
  const realtimeReceived = incoming.reduce((total, movement) => total + amount(movement.amount), 0)
  const realtimePaid = outgoing.reduce((total, movement) => total + amount(movement.amount), 0)
  const inTransit = outgoing
    .filter((movement) => movement.reviewRequired)
    .reduce((total, movement) => total + amount(movement.amount), 0)
  const reviewMovements = movements.filter((movement) => movement.reviewRequired && !movement.alreadyPosted)
  const reviewAmount = reviewMovements.reduce((total, movement) => total + amount(movement.amount), 0)
  const projectedBalance = confirmedBalance + realtimeReceived - realtimePaid

  return {
    realtimeReceived,
    realtimePaid,
    inTransit,
    projectedBalance,
    confirmedBalance,
    variance: projectedBalance - confirmedBalance,
    reviewCount: reviewMovements.length,
    reviewAmount,
    lastActivityAt: movements.find((movement) => movement.transferAt)?.transferAt ?? null,
    movements,
  }
}
