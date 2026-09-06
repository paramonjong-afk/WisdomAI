import { supabase } from '../lib/supabase'

type ChatUnreadScope = {
  companyId: string
  profileId: string
}

/** Returns the unread message total for rooms visible to the signed-in profile. */
export async function fetchChatUnreadCount({ companyId, profileId }: ChatUnreadScope) {
  if (!companyId || !profileId) return 0

  const { data: memberRows, error: memberError } = await supabase
    .from('chat_room_members')
    .select('room_id,joined_at,chat_rooms!inner(company_id)')
    .eq('profile_id', profileId)
    .eq('chat_rooms.company_id', companyId)

  if (memberError) throw memberError
  const memberships = (memberRows ?? []).flatMap((row) => (
    typeof row.room_id === 'string'
      ? [{ roomId: row.room_id, joinedAt: typeof row.joined_at === 'string' ? row.joined_at : null }]
      : []
  ))
  const roomIds = memberships.map((membership) => membership.roomId)
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

  const counts = await Promise.all(memberships.map(async ({ roomId, joinedAt }) => {
    let query = supabase
      .from('chat_messages')
      .select('id', { count: 'exact', head: true })
      .eq('room_id', roomId)
      .is('deleted_at', null)
      .or(`sender_profile_id.is.null,sender_profile_id.neq.${profileId}`)
    const lastReadAt = readMap.get(roomId)
    const unreadCutoff = [lastReadAt, joinedAt].filter((value): value is string => Boolean(value)).sort().at(-1)
    if (unreadCutoff) query = query.gt('created_at', unreadCutoff)
    const { count, error } = await query
    if (error) throw error
    return count ?? 0
  }))

  return counts.reduce((sum, count) => sum + count, 0)
}
