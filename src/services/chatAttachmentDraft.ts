const chatAttachmentDraftDatabase = 'wisdomai-chat-attachment-drafts'
const chatAttachmentDraftStore = 'drafts'
const chatAttachmentDraftVersion = 1

export const chatAttachmentDraftTtlMs = 30 * 60 * 1000

export type ChatAttachmentDraftScope = {
  companyId: string
  profileId: string
  roomId: string
}

type StoredChatAttachmentDraft = {
  key: string
  blob: Blob
  name: string
  contentType: string
  lastModified: number
  savedAt: number
}

const draftKey = ({ companyId, profileId, roomId }: ChatAttachmentDraftScope) => (
  `${companyId}:${profileId}:${roomId}`
)

const openDraftDatabase = () => new Promise<IDBDatabase | null>((resolve, reject) => {
  if (typeof indexedDB === 'undefined') {
    resolve(null)
    return
  }
  const request = indexedDB.open(chatAttachmentDraftDatabase, chatAttachmentDraftVersion)
  request.onupgradeneeded = () => {
    const database = request.result
    if (!database.objectStoreNames.contains(chatAttachmentDraftStore)) {
      database.createObjectStore(chatAttachmentDraftStore, { keyPath: 'key' })
    }
  }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error ?? new Error('เปิดพื้นที่พักไฟล์ไม่สำเร็จ'))
  request.onblocked = () => reject(new Error('พื้นที่พักไฟล์กำลังถูกใช้งานโดยหน้าอื่น'))
})

const waitForTransaction = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve()
  transaction.onerror = () => reject(transaction.error ?? new Error('บันทึกไฟล์พักไม่สำเร็จ'))
  transaction.onabort = () => reject(transaction.error ?? new Error('การบันทึกไฟล์พักถูกยกเลิก'))
})

const requestValue = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error ?? new Error('อ่านไฟล์พักไม่สำเร็จ'))
})

export async function saveChatAttachmentDraft(scope: ChatAttachmentDraftScope, file: File) {
  const database = await openDraftDatabase()
  if (!database) return false
  try {
    const transaction = database.transaction(chatAttachmentDraftStore, 'readwrite')
    const record: StoredChatAttachmentDraft = {
      key: draftKey(scope),
      blob: file.slice(0, file.size, file.type || 'application/octet-stream'),
      name: file.name,
      contentType: file.type || 'application/octet-stream',
      lastModified: file.lastModified,
      savedAt: Date.now(),
    }
    transaction.objectStore(chatAttachmentDraftStore).put(record)
    await waitForTransaction(transaction)
    return true
  } finally {
    database.close()
  }
}

export async function loadChatAttachmentDraft(scope: ChatAttachmentDraftScope) {
  const database = await openDraftDatabase()
  if (!database) return null
  try {
    const transaction = database.transaction(chatAttachmentDraftStore, 'readonly')
    const record = await requestValue(
      transaction.objectStore(chatAttachmentDraftStore).get(draftKey(scope)) as IDBRequest<StoredChatAttachmentDraft | undefined>,
    )
    await waitForTransaction(transaction)
    if (!record) return null
    if (Date.now() - record.savedAt > chatAttachmentDraftTtlMs) {
      await removeChatAttachmentDraft(scope)
      return null
    }
    return new File([record.blob], record.name, {
      type: record.contentType,
      lastModified: record.lastModified,
    })
  } finally {
    database.close()
  }
}

export async function removeChatAttachmentDraft(scope: ChatAttachmentDraftScope) {
  const database = await openDraftDatabase()
  if (!database) return
  try {
    const transaction = database.transaction(chatAttachmentDraftStore, 'readwrite')
    transaction.objectStore(chatAttachmentDraftStore).delete(draftKey(scope))
    await waitForTransaction(transaction)
  } finally {
    database.close()
  }
}
