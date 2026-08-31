export type AdvanceHolderMatchSource = {
  id: string
  displayName: string
  aliases: string[]
}

export type AdvanceHolderSlipEvidence = {
  transactionId: string
  itemId: string
  senderName: string | null
  recipientName: string | null
  amount: number | null
  transferAt: string | null
  truthStatus: string
  duplicateOf: string | null
  lineageId?: string | null
  fundingSourceType?: string | null
  purposeType?: string | null
  routeStatus?: string | null
  nextDestination?: string | null
  canonicalPayerName?: string | null
  canonicalFundHolderName?: string | null
  canonicalBeneficiaryName?: string | null
}

export type AdvanceHolderSlipMatch = {
  id: string
  transactionId: string
  itemId: string
  holderId: string | null
  holderName: string
  direction: 'incoming' | 'outgoing'
  senderName: string | null
  recipientName: string | null
  amount: number | null
  transferAt: string | null
  truthStatus: string
  matchStatus: 'exact' | 'ambiguous'
  matchedName: string
  lineageId: string | null
  fundingSourceType: string | null
  purposeType: string | null
  routeStatus: string | null
  nextDestination: string | null
  canonicalPayerName: string | null
  canonicalFundHolderName: string | null
  canonicalBeneficiaryName: string | null
  routeResolved: boolean
}

export function advanceHolderSlipDestination(
  slip: Pick<AdvanceHolderSlipMatch, 'transactionId' | 'routeResolved' | 'nextDestination'>,
) {
  const transactionId = encodeURIComponent(slip.transactionId)
  if (slip.routeResolved && ['payroll', 'advance_finance'].includes(slip.nextDestination ?? '')) {
    return {
      path: `/advance-settlements?transaction_id=${transactionId}`,
      label: slip.nextDestination === 'payroll' ? 'HR/Payroll' : 'เงินทดรองและปิดยอด',
    }
  }
  return {
    path: `/accounting-documents?transaction_id=${transactionId}&detail=review`,
    label: slip.routeResolved ? 'บัญชี · รายละเอียดเส้นทาง' : 'บัญชี · ตรวจและจัดประเภท',
  }
}

export function hasResolvedMoneyRoute(slip: AdvanceHolderSlipEvidence) {
  return Boolean(
    slip.lineageId
    && slip.purposeType
    && slip.purposeType !== 'unknown'
    && slip.routeStatus
    && !['draft', 'needs_information'].includes(slip.routeStatus),
  )
}

export function normalizeAdvanceHolderName(value: string | null | undefined) {
  return (value ?? '')
    .trim()
    .replace(/^(นาย|นาง|นางสาว|น\.ส\.|บริษัท|บจก\.?|หจก\.?)\s*/i, '')
    .replace(/\s+/g, '')
    .toLocaleLowerCase('th-TH')
}

export function advanceHolderMoneyRouteParties(
  slip: Pick<AdvanceHolderSlipMatch, 'senderName' | 'recipientName' | 'canonicalPayerName' | 'canonicalFundHolderName' | 'canonicalBeneficiaryName'>,
  holderDisplayName?: string | null,
) {
  const parties: string[] = []
  const append = (name: string | null | undefined, preferThisLabel = false) => {
    if (!name?.trim()) return
    const previous = parties.at(-1)
    if (previous && normalizeAdvanceHolderName(previous) === normalizeAdvanceHolderName(name)) {
      if (preferThisLabel) parties[parties.length - 1] = name
      return
    }
    parties.push(name)
  }

  append(slip.canonicalPayerName ?? slip.senderName)
  append(slip.canonicalFundHolderName ?? holderDisplayName, true)
  append(slip.canonicalBeneficiaryName ?? slip.recipientName)
  return parties
}

export function matchAdvanceHolderSlips(holders: AdvanceHolderMatchSource[], slips: AdvanceHolderSlipEvidence[]) {
  const nameIndex = new Map<string, AdvanceHolderMatchSource[]>()
  holders.forEach((holder) => {
    const names = new Set([holder.displayName, ...holder.aliases].map(normalizeAdvanceHolderName).filter(Boolean))
    names.forEach((name) => nameIndex.set(name, [...(nameIndex.get(name) ?? []), holder]))
  })

  const results: AdvanceHolderSlipMatch[] = []
  slips.forEach((slip) => {
    if (slip.duplicateOf || slip.truthStatus === 'duplicate') return
    const parties = [
      { direction: 'outgoing' as const, name: slip.senderName },
      { direction: 'incoming' as const, name: slip.recipientName },
    ]
    parties.forEach(({ direction, name }) => {
      const normalizedName = normalizeAdvanceHolderName(name)
      if (!normalizedName) return
      const matchedHolders = nameIndex.get(normalizedName) ?? []
      if (!matchedHolders.length) return
      const exact = matchedHolders.length === 1
      results.push({
        id: `${slip.transactionId}:${direction}`,
        transactionId: slip.transactionId,
        itemId: slip.itemId,
        holderId: exact ? matchedHolders[0].id : null,
        holderName: matchedHolders.map((holder) => holder.displayName).join(' / '),
        direction,
        senderName: slip.senderName,
        recipientName: slip.recipientName,
        amount: slip.amount,
        transferAt: slip.transferAt,
        truthStatus: slip.truthStatus,
        matchStatus: exact ? 'exact' : 'ambiguous',
        matchedName: name ?? '',
        lineageId: slip.lineageId ?? null,
        fundingSourceType: slip.fundingSourceType ?? null,
        purposeType: slip.purposeType ?? null,
        routeStatus: slip.routeStatus ?? null,
        nextDestination: slip.nextDestination ?? null,
        canonicalPayerName: slip.canonicalPayerName ?? null,
        canonicalFundHolderName: slip.canonicalFundHolderName ?? null,
        canonicalBeneficiaryName: slip.canonicalBeneficiaryName ?? null,
        routeResolved: hasResolvedMoneyRoute(slip),
      })
    })
  })

  return results.sort((left, right) => (right.transferAt ?? '').localeCompare(left.transferAt ?? ''))
}
