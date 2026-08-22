import { supabase } from '../lib/supabase'

type ChatUnreadScope = {
  companyId: string
  profileId: string
}

/** Returns the unread message total for rooms visible to the signed-in profile. */
export async function fetchChatUnreadCount({ companyId, profileId }: ChatUnreadScope) {
  if (!companyId || !profileId) return 0

  const { data: roomRows, error: roomError } = await supabase
    .from('chat_rooms')
    .select('id')
    .eq('company_id', companyId)

  if (roomError) throw roomError
  const roomIds = (roomRows ?? [])
    .map((row) => (typeof row.id === 'string' ? row.id : ''))
    .filter(Boolean)
  if (roomIds.length === 0) return 0

  const { data: readRows, error: readError } = await supabase
    .from('chat_room_read_states')
    .select('room_id,last_read_at')
    .eq('profile_id', profileId)
    .in('room_id', roomIds)

  if (readError) throw readError
  const readMap = new Map<string, string>()
  ;(readRows ?? []).forEach((row) => {
    if (typeof row.room_id === 'string' && typeof row.last_read_at === 'string') {
      readMap.set(row.room_id, row.last_read_at)
    }
  })

  const counts = await Promise.all(roomIds.map(async (roomId) => {
    let query = supabase
      .from('chat_messages')
      .select('id', { count: 'exact', head: true })
      .eq('room_id', roomId)
    const lastReadAt = readMap.get(roomId)
    if (lastReadAt) query = query.gt('created_at', lastReadAt)
    const { count, error } = await query
    if (error) throw error
    return count ?? 0
  }))

  return counts.reduce((sum, count) => sum + count, 0)
}
