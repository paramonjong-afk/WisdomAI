import { createClient } from 'npm:@supabase/supabase-js@2'

type LineEvent = {
  type: string
  webhookEventId: string
  timestamp: number
  deliveryContext?: { isRedelivery?: boolean }
  source: { type: string; userId?: string; groupId?: string; roomId?: string }
  message?: { id: string; type: string; text?: string; fileName?: string; fileSize?: number; quotedMessageId?: string }
  unsend?: { messageId: string }
}

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const encoder = new TextEncoder()

async function verifySignature(body: string, signature: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
  const expected = btoa(String.fromCharCode(...new Uint8Array(digest)))
  if (expected.length !== signature.length) return false
  let mismatch = 0
  for (let index = 0; index < expected.length; index += 1) mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index)
  return mismatch === 0
}

function classify(text: string) {
  const normalized = text.toLowerCase()
  const rules: Array<[string, string[]]> = [
    ['safety', ['อุบัติเหตุ', 'ไม่ปลอดภัย', 'safety', 'ppe']],
    ['risk', ['เสี่ยง', 'ล่าช้า', 'delay', 'อันตราย']],
    ['issue', ['ปัญหา', 'ติดขัด', 'เสีย', 'ขาด', 'ไม่ได้', 'ฝนตก']],
    ['completed', ['เสร็จ', 'เรียบร้อย', 'complete', 'completed', '100%']],
    ['planned', ['พรุ่งนี้', 'แผน', 'จะทำ', 'next', 'tomorrow']],
    ['material', ['วัสดุ', 'เหล็ก', 'ปูน', 'ทราย', 'ของเข้า', 'material']],
    ['in_progress', ['กำลัง', 'ดำเนินการ', 'อยู่ระหว่าง', 'progress']],
  ]
  return rules.find(([, words]) => words.some((word) => normalized.includes(word)))?.[0] ?? 'general'
}

function projectCodes(text: string) {
  return [...text.matchAll(/#([a-zA-Z0-9_-]+)/g)].map((match) => match[1].toUpperCase())
}

async function assignProjects(messageId: string, message: NonNullable<LineEvent['message']>, groupId: string | null) {
  const assignments = new Map<string, 'hashtag' | 'group_default' | 'reply_context'>()
  const codes = message.text ? projectCodes(message.text) : []

  if (codes.length > 0) {
    const { data, error } = await supabase.from('projects').select('id').in('code', codes)
    if (error) throw error
    for (const project of data ?? []) assignments.set(project.id, 'hashtag')
  }

  if (assignments.size === 0 && message.quotedMessageId) {
    const { data: quoted } = await supabase
      .from('line_messages')
      .select('id')
      .eq('line_message_id', message.quotedMessageId)
      .maybeSingle()
    if (quoted) {
      const { data: mappings } = await supabase
        .from('line_message_projects')
        .select('project_id')
        .eq('message_id', quoted.id)
      for (const mapping of mappings ?? []) assignments.set(mapping.project_id, 'reply_context')
    }
  }

  if (assignments.size === 0 && groupId) {
    const { data: group } = await supabase
      .from('line_groups')
      .select('project_id, group_mode')
      .eq('line_group_id', groupId)
      .maybeSingle()
    if (group?.group_mode === 'dedicated' && group.project_id) {
      assignments.set(group.project_id, 'group_default')
    }
  }

  if (assignments.size > 0) {
    const { error } = await supabase.from('line_message_projects').upsert(
      [...assignments].map(([project_id, assignment_source]) => ({ message_id: messageId, project_id, assignment_source })),
      { onConflict: 'message_id,project_id' },
    )
    if (error) throw error
  }

  return [...assignments.keys()]
}

async function lineProfile(userId: string, groupId?: string) {
  const base = groupId ? `group/${groupId}/member` : 'profile'
  const response = await fetch(`https://api.line.me/v2/bot/${base}/${userId}`, {
    headers: { Authorization: `Bearer ${Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN')!}` },
  })
  return response.ok ? await response.json() : null
}

async function processMessage(event: LineEvent) {
  const message = event.message!
  const groupId = event.source.groupId ?? event.source.roomId ?? null
  const userId = event.source.userId ?? null

  if (groupId) await supabase.from('line_groups').upsert({
    line_group_id: groupId, last_event_at: new Date(event.timestamp).toISOString(), joined_at: new Date(event.timestamp).toISOString(),
  }, { onConflict: 'line_group_id' })

  if (userId) {
    const profile = await lineProfile(userId, event.source.groupId)
    await supabase.from('line_senders').upsert({
      line_user_id: userId, display_name: profile?.displayName ?? null,
      picture_url: profile?.pictureUrl ?? null, updated_at: new Date().toISOString(),
    }, { onConflict: 'line_user_id' })
  }

  const { data: saved, error } = await supabase.from('line_messages').upsert({
    webhook_event_id: event.webhookEventId, line_message_id: message.id, line_group_id: groupId,
    line_user_id: userId, message_type: message.type, text_content: message.text ?? null,
    file_name: message.fileName ?? null, file_size: message.fileSize ?? null,
    quoted_message_id: message.quotedMessageId ?? null, occurred_at: new Date(event.timestamp).toISOString(),
    is_redelivery: event.deliveryContext?.isRedelivery ?? false, raw_event: event,
  }, { onConflict: 'webhook_event_id' }).select('id').single()
  if (error) throw error

  const assignedProjectIds = await assignProjects(saved.id, message, groupId)

  if (message.type === 'text' && message.text) {
    await supabase.from('work_summary_items').upsert({
      source_message_id: saved.id,
      project_id: assignedProjectIds.length === 1 ? assignedProjectIds[0] : null,
      work_date: new Date(event.timestamp).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }),
      category: classify(message.text), summary_text: message.text,
    }, { onConflict: 'source_message_id' })
  }

  if (['image', 'video', 'audio', 'file'].includes(message.type)) {
    const response = await fetch(`https://api-data.line.me/v2/bot/message/${message.id}/content`, {
      headers: { Authorization: `Bearer ${Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN')!}` },
    })
    if (!response.ok) throw new Error(`LINE content download failed: ${response.status}`)
    const bytes = await response.arrayBuffer()
    const contentType = response.headers.get('content-type') ?? 'application/octet-stream'
    const name = (message.fileName ?? `${message.id}.${message.type}`).replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `${groupId ?? 'direct'}/${new Date(event.timestamp).toISOString().slice(0, 10)}/${message.id}-${name}`
    const { error: uploadError } = await supabase.storage.from('line-attachments').upload(path, bytes, { contentType, upsert: true })
    if (uploadError) throw uploadError
    await supabase.from('line_attachments').upsert({
      message_id: saved.id, storage_path: path, content_type: contentType, size_bytes: bytes.byteLength,
    }, { onConflict: 'storage_path' })
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const body = await request.text()
  const signature = request.headers.get('x-line-signature') ?? ''
  const secret = Deno.env.get('LINE_CHANNEL_SECRET') ?? ''
  if (!secret || !(await verifySignature(body, signature, secret))) return new Response('Invalid signature', { status: 401 })

  try {
    const payload = JSON.parse(body) as { events?: LineEvent[] }
    for (const event of payload.events ?? []) {
      if (event.type === 'message' && event.message) await processMessage(event)
      if (event.type === 'unsend' && event.unsend) {
        await supabase.from('line_messages').update({ is_unsent: true, text_content: null }).eq('line_message_id', event.unsend.messageId)
      }
    }
    return Response.json({ ok: true })
  } catch (error) {
    console.error(error)
    return Response.json({ ok: false }, { status: 500 })
  }
})
