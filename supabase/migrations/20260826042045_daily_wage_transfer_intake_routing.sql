create table if not exists public.daily_wage_transfer_confirmations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  financial_transaction_id uuid not null references public.financial_transactions(id) on delete restrict,
  employee_profile_id uuid not null references public.profiles(id) on delete restrict,
  transfer_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  status text not null default 'pending_employee_confirmation'
    check (status in ('pending_employee_confirmation','confirmed','disputed','admin_approved','cancelled')),
  employee_response_note text,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(financial_transaction_id)
);
create index if not exists daily_wage_transfer_confirmations_employee_date_idx
  on public.daily_wage_transfer_confirmations(company_id, employee_profile_id, transfer_date desc);

create table if not exists public.daily_wage_transfer_audit (
  id uuid primary key default gen_random_uuid(),
  confirmation_id uuid not null references public.daily_wage_transfer_confirmations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  event_key text not null unique,
  action text not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists daily_wage_transfer_audit_confirmation_idx
  on public.daily_wage_transfer_audit(confirmation_id, created_at desc);

alter table public.daily_wage_transfer_confirmations enable row level security;
alter table public.daily_wage_transfer_audit enable row level security;
create policy "Company managers read daily wage confirmations"
  on public.daily_wage_transfer_confirmations for select to authenticated
  using (public.is_company_manager(company_id));
create policy "Company managers read daily wage transfer audit"
  on public.daily_wage_transfer_audit for select to authenticated
  using (public.is_company_manager(company_id));
revoke all on public.daily_wage_transfer_confirmations from anon, authenticated;
grant select on public.daily_wage_transfer_confirmations to authenticated;
revoke all on public.daily_wage_transfer_audit from anon, authenticated;
grant select on public.daily_wage_transfer_audit to authenticated;

create or replace function public.route_daily_wage_transfer_from_intake(target_transaction_id uuid, target_event_key text)
returns public.daily_wage_transfer_confirmations
language plpgsql security definer set search_path=public as $$
declare
  tx public.financial_transactions;
  employee public.employee_employment_records;
  result public.daily_wage_transfer_confirmations;
  transfer_day date;
begin
  select * into tx from public.financial_transactions where id=target_transaction_id for update;
  if tx.id is null or tx.amount_total is null or tx.amount_total <= 0 or tx.transfer_at is null then
    raise exception 'daily_wage_transfer_missing_amount_or_date';
  end if;
  if tx.review_status in ('duplicate','dismissed') or tx.duplicate_of is not null then
    raise exception 'daily_wage_transfer_duplicate';
  end if;
  if not public.is_company_manager(tx.company_id) then
    raise exception 'daily_wage_transfer_permission_denied';
  end if;
  transfer_day := (tx.transfer_at at time zone 'Asia/Bangkok')::date;
  select e.* into employee
  from public.employee_employment_records e
  join public.profiles p on p.id=e.profile_id
  where e.company_id=tx.company_id
    and e.profile_id is not null
    and e.employment_type='daily'
    and e.employment_status in ('active','probation','notice')
    and lower(regexp_replace(regexp_replace(coalesce(p.full_name,''),'^(นาย|นางสาว|นาง|น.ส.|คุณ)[[:space:]]*',''),'[[:space:]]','','g'))
      = lower(regexp_replace(regexp_replace(coalesce(tx.recipient_name,''),'^(นาย|นางสาว|นาง|น.ส.|คุณ)[[:space:]]*',''),'[[:space:]]','','g'))
  limit 1;
  if employee.profile_id is null then raise exception 'daily_wage_transfer_employee_not_exactly_matched'; end if;
  insert into public.daily_wage_transfer_confirmations(company_id,financial_transaction_id,employee_profile_id,transfer_date,amount)
  values(tx.company_id,tx.id,employee.profile_id,transfer_day,tx.amount_total)
  on conflict(financial_transaction_id) do update set updated_at=now()
  returning * into result;
  insert into public.daily_wage_transfer_audit(confirmation_id,company_id,event_key,action,actor_profile_id,after_data)
  values(result.id,tx.company_id,target_event_key,'route_daily_wage_transfer',auth.uid(),jsonb_build_object(
    'employee_profile_id',result.employee_profile_id,'transfer_date',result.transfer_date,'amount',result.amount))
  on conflict(event_key) do nothing;
  return result;
end; $$;
revoke all on function public.route_daily_wage_transfer_from_intake(uuid,text) from public,anon;
grant execute on function public.route_daily_wage_transfer_from_intake(uuid,text) to authenticated;

create table if not exists public.daily_wage_transfer_deliveries (
  id uuid primary key default gen_random_uuid(),
  confirmation_id uuid not null references public.daily_wage_transfer_confirmations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_profile_id uuid not null references public.profiles(id) on delete restrict,
  channel text not null default 'web_chat',
  status text not null default 'queued' check(status in ('queued','sent','read','failed')),
  room_id uuid references public.chat_rooms(id) on delete set null,
  chat_message_id uuid references public.chat_messages(id) on delete set null,
  delivery_key text not null unique,
  sent_at timestamptz,
  read_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists daily_wage_transfer_delivery_status_idx
  on public.daily_wage_transfer_deliveries(company_id,status,created_at desc);
alter table public.daily_wage_transfer_deliveries enable row level security;
create policy "Company managers read daily wage deliveries"
  on public.daily_wage_transfer_deliveries for select to authenticated
  using(public.is_company_manager(company_id));
revoke all on public.daily_wage_transfer_deliveries from anon,authenticated;
grant select on public.daily_wage_transfer_deliveries to authenticated;

create or replace function public.send_daily_wage_transfer_to_web_chat(target_confirmation_id uuid, target_event_key text)
returns public.daily_wage_transfer_deliveries
language plpgsql security definer set search_path=public as $$
declare
  c public.daily_wage_transfer_confirmations;
  room uuid;
  msg uuid;
  d public.daily_wage_transfer_deliveries;
  text_value text;
begin
  select * into c from public.daily_wage_transfer_confirmations where id=target_confirmation_id for update;
  if c.id is null or not public.is_company_manager(c.company_id) then raise exception 'daily_wage_delivery_permission_denied'; end if;
  select r.id into room
  from public.chat_rooms r
  join public.chat_room_members m on m.room_id=r.id
  where r.company_id=c.company_id and m.profile_id=c.employee_profile_id
  order by r.updated_at desc limit 1;
  if room is null then raise exception 'daily_wage_employee_web_chat_room_not_found'; end if;
  text_value := 'SYSTEM MSG · เงินโอนรอยืนยัน\nวันที่โอน: '||c.transfer_date||'\nยอด: '
    ||to_char(c.amount,'FM999G999G990D00')||' บาท\nกรุณาตอบ ยืนยัน / ยอดไม่ถูกต้อง / ไม่ใช่รายการของฉัน';
  insert into public.daily_wage_transfer_deliveries(confirmation_id,company_id,employee_profile_id,status,room_id,delivery_key)
  values(c.id,c.company_id,c.employee_profile_id,'queued',room,'daily-wage:'||c.id::text)
  on conflict(delivery_key) do update set updated_at=now() returning * into d;
  if d.chat_message_id is null then
    insert into public.chat_messages(company_id,room_id,sender_profile_id,message_type,text_content,message_class)
    values(c.company_id,room,null,'text',text_value,'system_confirmation') returning id into msg;
    update public.daily_wage_transfer_deliveries
    set status='sent',chat_message_id=msg,sent_at=now(),updated_at=now()
    where id=d.id returning * into d;
  end if;
  insert into public.daily_wage_transfer_audit(confirmation_id,company_id,event_key,action,actor_profile_id,after_data)
  values(c.id,c.company_id,target_event_key,'web_chat_sent',auth.uid(),jsonb_build_object(
    'delivery_id',d.id,'room_id',d.room_id,'chat_message_id',d.chat_message_id,'status',d.status))
  on conflict(event_key) do nothing;
  return d;
end; $$;
revoke all on function public.send_daily_wage_transfer_to_web_chat(uuid,text) from public,anon;
grant execute on function public.send_daily_wage_transfer_to_web_chat(uuid,text) to authenticated;
