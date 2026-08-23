-- Restrict the room-provisioning helper to signed-in managers/system callers.
-- The helper is SECURITY DEFINER and must never be callable by anon or PUBLIC.
revoke execute on function public.ensure_advance_confirmation_room(uuid,text,uuid,text,uuid,uuid,text) from public, anon;
grant execute on function public.ensure_advance_confirmation_room(uuid,text,uuid,text,uuid,uuid,text) to authenticated, service_role;
