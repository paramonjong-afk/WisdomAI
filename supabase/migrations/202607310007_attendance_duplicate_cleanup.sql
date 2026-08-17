alter table public.attendance_sessions
  add column if not exists duplicate_of uuid references public.attendance_sessions(id) on delete set null;

alter table public.attendance_sessions
  drop constraint if exists attendance_sessions_status_check;
alter table public.attendance_sessions
  add constraint attendance_sessions_status_check
  check (status in ('pending','normal','needs_review','approved','rejected','duplicate'));

drop index if exists public.one_open_attendance_per_employee_day;

create or replace function public.prevent_multiple_attendance_sessions_per_day()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  business_date date := (new.clock_in_at at time zone 'Asia/Bangkok')::date;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.profile_id::text || business_date::text, 0));
  if exists (
    select 1
    from public.attendance_sessions existing
    where existing.profile_id = new.profile_id
      and (existing.clock_in_at at time zone 'Asia/Bangkok')::date = business_date
      and existing.status not in ('rejected','duplicate')
  ) then
    raise exception using
      errcode = '23505',
      message = 'Only one attendance session is allowed per employee per day';
  end if;
  return new;
end;
$$;

with ranked as (
  select
    session.id,
    first_value(session.id) over (
      partition by session.profile_id, (session.clock_in_at at time zone 'Asia/Bangkok')::date
      order by
        case session.status
          when 'approved' then 1
          when 'normal' then 2
          when 'needs_review' then 3
          when 'pending' then 4
          when 'rejected' then 5
          else 6
        end,
        case when session.clock_out_at is not null then 0 else 1 end,
        session.created_at,
        session.id
    ) as canonical_id,
    row_number() over (
      partition by session.profile_id, (session.clock_in_at at time zone 'Asia/Bangkok')::date
      order by
        case session.status
          when 'approved' then 1
          when 'normal' then 2
          when 'needs_review' then 3
          when 'pending' then 4
          when 'rejected' then 5
          else 6
        end,
        case when session.clock_out_at is not null then 0 else 1 end,
        session.created_at,
        session.id
    ) as row_rank
  from public.attendance_sessions session
  where session.status <> 'duplicate'
),
marked as (
  update public.attendance_sessions session set
    status = 'duplicate',
    duplicate_of = ranked.canonical_id,
    review_reason = coalesce(session.review_reason, 'รายการซ้ำในวันเดียวกัน ระบบเก็บไว้เพื่อตรวจสอบย้อนหลัง'),
    updated_at = now()
  from ranked
  where session.id = ranked.id
    and ranked.row_rank > 1
  returning session.id, session.duplicate_of
)
insert into public.attendance_audit_logs(
  session_id, actor_profile_id, action, reason, new_values
)
select
  marked.id, null, 'marked_duplicate',
  'ระบบตรวจพบรายการลงเวลาซ้ำในวันเดียวกัน',
  jsonb_build_object('duplicate_of', marked.duplicate_of)
from marked;

update public.attendance_sessions
set calculation_status = 'excluded', updated_at = now()
where status = 'duplicate' and calculation_status <> 'excluded';

create unique index one_open_attendance_per_employee_day
  on public.attendance_sessions (
    profile_id,
    ((clock_in_at at time zone 'Asia/Bangkok')::date)
  )
  where clock_out_at is null and status not in ('rejected','duplicate');

create index if not exists attendance_duplicate_of_idx
  on public.attendance_sessions(duplicate_of)
  where duplicate_of is not null;

comment on column public.attendance_sessions.duplicate_of is
  'Canonical attendance session for a historical duplicate on the same Asia/Bangkok business date.';
