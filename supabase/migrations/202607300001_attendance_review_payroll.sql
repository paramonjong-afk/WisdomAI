-- Attendance review, correction audit, and employee pay foundations.

drop index if exists public.one_open_attendance_per_employee;
create unique index if not exists one_open_attendance_per_employee_day
  on public.attendance_sessions (
    profile_id,
    ((clock_in_at at time zone 'Asia/Bangkok')::date)
  )
  where clock_out_at is null;

-- Keep historical duplicates readable, but reject every new second session on
-- the same Bangkok business date. The advisory lock also closes race windows
-- from double taps or two devices.
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
      and existing.status <> 'rejected'
  ) then
    raise exception using
      errcode = '23505',
      message = 'Only one attendance session is allowed per employee per day';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_multiple_attendance_sessions_per_day
  on public.attendance_sessions;
create trigger prevent_multiple_attendance_sessions_per_day
before insert on public.attendance_sessions
for each row execute function public.prevent_multiple_attendance_sessions_per_day();

alter table public.attendance_sessions
  add column if not exists review_reason text,
  add column if not exists reviewed_by uuid references public.profiles(id),
  add column if not exists reviewed_at timestamptz;

alter table public.project_sites
  add column if not exists work_start_time time not null default time '08:00',
  add column if not exists work_end_time time not null default time '17:00';

comment on column public.project_sites.work_start_time is
  'Scheduled start time in Asia/Bangkok; default 08:00.';
comment on column public.project_sites.work_end_time is
  'Scheduled end time in Asia/Bangkok; default 17:00.';

alter table public.profiles
  add column if not exists employment_type text not null default 'daily'
    check (employment_type in ('daily', 'monthly')),
  add column if not exists daily_rate numeric(12,2) not null default 0 check (daily_rate >= 0),
  add column if not exists monthly_salary numeric(12,2) not null default 0 check (monthly_salary >= 0),
  add column if not exists ot_hourly_rate numeric(12,2) not null default 0 check (ot_hourly_rate >= 0);

create table if not exists public.attendance_correction_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  requested_clock_in_at timestamptz,
  requested_clock_out_at timestamptz,
  reason text not null check (char_length(trim(reason)) between 3 and 1000),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists attendance_corrections_profile_idx
  on public.attendance_correction_requests(profile_id, created_at desc);

create table if not exists public.attendance_audit_logs (
  id bigint generated always as identity primary key,
  session_id uuid references public.attendance_sessions(id) on delete set null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  action text not null,
  reason text,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.employee_pay_adjustments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  effective_date date not null,
  adjustment_type text not null check (adjustment_type in (
    'allowance', 'bonus', 'wage_advance', 'cash_advance',
    'reimbursement', 'deduction'
  )),
  amount numeric(12,2) not null check (amount >= 0),
  description text,
  status text not null default 'approved'
    check (status in ('pending', 'approved', 'rejected', 'paid')),
  created_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists employee_pay_adjustments_profile_date_idx
  on public.employee_pay_adjustments(profile_id, effective_date desc);

alter table public.attendance_correction_requests enable row level security;
alter table public.attendance_audit_logs enable row level security;
alter table public.employee_pay_adjustments enable row level security;

create policy "Employees read own corrections"
  on public.attendance_correction_requests for select to authenticated
  using (profile_id = auth.uid() or public.is_work_manager());
create policy "Employees create own corrections"
  on public.attendance_correction_requests for insert to authenticated
  with check (profile_id = auth.uid());
create policy "Managers review corrections"
  on public.attendance_correction_requests for update to authenticated
  using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Attendance audit visible to owner or manager"
  on public.attendance_audit_logs for select to authenticated
  using (
    public.is_work_manager()
    or exists (
      select 1 from public.attendance_sessions session
      where session.id = session_id and session.profile_id = auth.uid()
    )
  );
create policy "Pay adjustments visible to owner or manager"
  on public.employee_pay_adjustments for select to authenticated
  using (profile_id = auth.uid() or public.is_work_manager());
create policy "Managers manage pay adjustments"
  on public.employee_pay_adjustments for all to authenticated
  using (public.is_work_manager()) with check (public.is_work_manager());

create or replace function public.request_attendance_correction(
  target_session_id uuid,
  requested_in timestamptz,
  requested_out timestamptz,
  request_reason text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare request_id uuid;
begin
  if not exists (
    select 1 from public.attendance_sessions
    where id = target_session_id and profile_id = auth.uid()
  ) then raise exception 'Attendance session not found'; end if;
  if char_length(trim(request_reason)) < 3 then raise exception 'Reason is required'; end if;

  insert into public.attendance_correction_requests(
    session_id, profile_id, requested_clock_in_at, requested_clock_out_at, reason
  ) values (
    target_session_id, auth.uid(), requested_in, requested_out, trim(request_reason)
  ) returning id into request_id;

  update public.attendance_sessions
  set status = 'needs_review', updated_at = now()
  where id = target_session_id;
  return request_id;
end;
$$;

create or replace function public.review_attendance_session(
  target_session_id uuid,
  review_action text,
  corrected_clock_out_at timestamptz default null,
  review_note text default null
) returns public.attendance_sessions
language plpgsql security definer set search_path = public
as $$
declare before_row public.attendance_sessions;
declare after_row public.attendance_sessions;
begin
  if not public.is_work_manager() then raise exception 'Permission denied'; end if;
  select * into before_row from public.attendance_sessions where id = target_session_id for update;
  if not found then raise exception 'Attendance session not found'; end if;
  if review_action not in ('approve', 'reject', 'correct') then raise exception 'Invalid action'; end if;
  if review_action in ('reject', 'correct') and nullif(trim(review_note), '') is null then
    raise exception 'Review reason is required';
  end if;

  update public.attendance_sessions set
    clock_out_at = case when review_action = 'correct' then corrected_clock_out_at else clock_out_at end,
    status = case when review_action = 'reject' then 'rejected' else 'approved' end,
    review_reason = nullif(trim(review_note), ''),
    reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  where id = target_session_id returning * into after_row;

  insert into public.attendance_audit_logs(
    session_id, actor_profile_id, action, reason, old_values, new_values
  ) values (
    target_session_id, auth.uid(), review_action, review_note,
    to_jsonb(before_row), to_jsonb(after_row)
  );
  return after_row;
end;
$$;

revoke all on function public.request_attendance_correction(uuid,timestamptz,timestamptz,text) from public;
grant execute on function public.request_attendance_correction(uuid,timestamptz,timestamptz,text) to authenticated;
revoke all on function public.review_attendance_session(uuid,text,timestamptz,text) from public;
grant execute on function public.review_attendance_session(uuid,text,timestamptz,text) to authenticated;
