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
}

export function normalizeAdvanceHolderName(value: string | null | undefined) {
  return (value ?? '')
    .trim()
    .replace(/^(นาย|นาง|นางสาว|น\.ส\.|บริษัท|บจก\.?|หจก\.?)\s*/i, '')
    .replace(/\s+/g, '')
    .toLocaleLowerCase('th-TH')
}

export function matchAdvanceHolderSlips(holders: AdvanceHolderMatchSource[], slips: AdvanceHolderSlipEvidence[]) {
  const nameIndex = new Map<string, AdvanceHolderMatchSource[]>()
  holders.forEach((holder) => {
    const names = new Set([holder.displayName, ...holder.aliases].map(normalizeAdvanceHolderName).filter(Boolean))
    names.forEach((name) => nameIndex.set(name, [...(nameIndex.get(name) ?? []), holder]))
  })

  const results: AdvanceHolderSlipMatch[] = []
  slips.forEach((slip) => {
    if (slip.duplicateOf) return
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
      })
    })
  })

  return results.sort((left, right) => (right.transferAt ?? '').localeCompare(left.transferAt ?? ''))
}
