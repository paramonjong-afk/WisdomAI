-- CHAT-ATTENDANCE-002: pin the trigger helper search_path for database linter/security safety.
create or replace function public.touch_chat_attendance_integration_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
