export type SupportingBillDocument = {
  id: string
  documentSetId: string | null
  documentType: string
  documentNumber: string | null
  documentDate: string | null
  vendorName: string | null
  totalAmount: number | null
  status: string
  projectId: string | null
}

export type SupportingBillMatch = {
  id: string
  kind: 'exact' | 'combination'
  documents: SupportingBillDocument[]
  totalAmount: number
  difference: number
}

const toCents = (value: number) => Math.round(value * 100)

function dayDistance(left: string | null, right: string | null) {
  if (!left || !right) return Number.MAX_SAFE_INTEGER
  const leftTime = new Date(left).getTime()
  const rightTime = new Date(right).getTime()
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return Number.MAX_SAFE_INTEGER
  return Math.abs(leftTime - rightTime) / 86_400_000
}

function eligibleDocuments(documents: SupportingBillDocument[], transferAt: string | null) {
  const seenSets = new Set<string>()
  return documents
    .filter((document) => (
      document.totalAmount != null
      && document.totalAmount > 0
      && !['transfer_slip', 'unreadable'].includes(document.documentType)
      && !['duplicate', 'dismissed'].includes(document.status)
      && (!document.documentDate || !transferAt || dayDistance(document.documentDate, transferAt) <= 45)
    ))
    .filter((document) => {
      const identity = document.documentSetId ?? document.id
      if (seenSets.has(identity)) return false
      seenSets.add(identity)
      return true
    })
    .sort((left, right) => {
      const statusScore = Number(right.status === 'confirmed') - Number(left.status === 'confirmed')
      return statusScore || dayDistance(left.documentDate, transferAt) - dayDistance(right.documentDate, transferAt)
    })
}

export function findSupportingBillMatches(
  targetAmount: number | null,
  transferAt: string | null,
  documents: SupportingBillDocument[],
  limit = 12,
) {
  if (targetAmount == null || targetAmount <= 0) return []
  const targetCents = toCents(targetAmount)
  const eligible = eligibleDocuments(documents, transferAt)
  const matches: SupportingBillMatch[] = []

  for (const document of eligible) {
    if (toCents(document.totalAmount ?? 0) !== targetCents) continue
    matches.push({
      id: `exact:${document.id}`,
      kind: 'exact',
      documents: [document],
      totalAmount: targetAmount,
      difference: 0,
    })
  }

  // Keep combination search bounded: closest-date candidates, at most three bills.
  const combinationPool = eligible
    .filter((document) => toCents(document.totalAmount ?? 0) < targetCents)
    .slice(0, 40)
  const combinations = new Set<string>()
  const search = (start: number, chosen: SupportingBillDocument[], sumCents: number) => {
    if (chosen.length >= 2 && sumCents === targetCents) {
      const key = chosen.map((document) => document.id).sort().join(':')
      if (!combinations.has(key)) {
        combinations.add(key)
        matches.push({
          id: `combination:${key}`,
          kind: 'combination',
          documents: [...chosen],
          totalAmount: targetAmount,
          difference: 0,
        })
      }
      return
    }
    if (chosen.length === 3 || sumCents >= targetCents) return
    for (let index = start; index < combinationPool.length; index += 1) {
      const document = combinationPool[index]
      search(index + 1, [...chosen, document], sumCents + toCents(document.totalAmount ?? 0))
    }
  }
  search(0, [], 0)

  return matches
    .sort((left, right) => (
      Number(left.kind === 'combination') - Number(right.kind === 'combination')
      || left.documents.length - right.documents.length
      || Math.min(...left.documents.map((document) => dayDistance(document.documentDate, transferAt)))
        - Math.min(...right.documents.map((document) => dayDistance(document.documentDate, transferAt)))
    ))
    .slice(0, limit)
}
