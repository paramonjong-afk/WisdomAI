export type BlobRecord = {
  id: string
  company_id: string
  storage_bucket: string
  storage_path: string
  thumbnail_storage_path: string | null
  content_sha256: string
  content_type: string | null
}

export type StoredObject = { bucket: string; path: string; bytes?: Uint8Array }
export type DocumentSet = { id: string; company_id: string; page_count: number; actual_page_count: number }
export type FindingKind = 'orphan_object'|'dangling_db'|'missing_thumbnail'|'missing_page'|'hash_mismatch'|'wrong_tenant_namespace'
export type Finding = { kind: FindingKind; companyId: string; fingerprint: string; evidence: Record<string, unknown> }

const normalizeHash = (value: string) => value.trim().toLowerCase()
export const fingerprintFor = (kind: FindingKind, companyId: string, identity: string) =>
  `storage:${kind}:${companyId}:${identity}`.toLowerCase().replace(/[^a-z0-9:_./-]/g, '_').slice(0, 200)

export async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
}

export async function scanStorageConsistency(input: { blobs: BlobRecord[]; objects: StoredObject[]; documentSets?: DocumentSet[] }) {
  const findings: Finding[] = []
  const objectByKey = new Map(input.objects.map(object => [`${object.bucket}/${object.path}`, object]))
  const referenced = new Set<string>()
  const add = (kind: FindingKind, companyId: string, identity: string, evidence: Record<string, unknown>) =>
    findings.push({ kind, companyId, fingerprint: fingerprintFor(kind, companyId, identity), evidence })

  for (const blob of input.blobs) {
    const key = `${blob.storage_bucket}/${blob.storage_path}`
    referenced.add(key)
    if (blob.thumbnail_storage_path) referenced.add(`${blob.storage_bucket}/${blob.thumbnail_storage_path}`)
    const object = objectByKey.get(key)
    if (!object) add('dangling_db', blob.company_id, blob.id, { blob_id:blob.id, bucket:blob.storage_bucket, path:blob.storage_path })
    if (!blob.storage_path.startsWith(`${blob.company_id}/`)) add('wrong_tenant_namespace', blob.company_id, blob.id, { blob_id:blob.id, path:blob.storage_path })
    if (blob.thumbnail_storage_path && !objectByKey.has(`${blob.storage_bucket}/${blob.thumbnail_storage_path}`)) {
      add('missing_thumbnail', blob.company_id, blob.id, { blob_id:blob.id, path:blob.thumbnail_storage_path })
    }
    if (object?.bytes) {
      const actualHash = await sha256Hex(object.bytes)
      if (normalizeHash(actualHash) !== normalizeHash(blob.content_sha256)) {
        add('hash_mismatch', blob.company_id, blob.id, { blob_id:blob.id, path:blob.storage_path, expected_sha256:blob.content_sha256, actual_sha256:actualHash })
      }
    }
  }
  for (const object of input.objects) {
    const key = `${object.bucket}/${object.path}`
    if (referenced.has(key) || object.path.startsWith('.trash/')) continue
    const companyId = object.path.split('/')[0] || 'unknown'
    add('orphan_object', companyId, key, { bucket:object.bucket, path:object.path })
  }
  for (const set of input.documentSets ?? []) {
    if (set.actual_page_count !== set.page_count) add('missing_page', set.company_id, set.id, { set_id:set.id, expected_pages:set.page_count, actual_pages:set.actual_page_count })
  }
  return findings
}

export const summarizeFindings = (findings: Finding[]) => findings.reduce<Record<string,number>>((counts, finding) => {
  counts[finding.kind] = (counts[finding.kind] ?? 0) + 1
  return counts
}, {})
