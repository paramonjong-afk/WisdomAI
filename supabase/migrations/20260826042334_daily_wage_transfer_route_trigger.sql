create or replace function public.route_daily_wage_transfer_from_intake(target_transaction_id uuid, target_event_key text)
returns public.daily_wage_transfer_confirmations
language plpgsql security definer set search_path=public as $$
declare tx public.financial_transactions; employee public.employee_employment_records; result public.daily_wage_transfer_confirmations; transfer_day date;
begin
  select * into tx from public.financial_transactions where id=target_transaction_id for update;
  if tx.id is null or tx.amount_total is null or tx.amount_total<=0 or tx.transfer_at is null then raise exception 'daily_wage_transfer_missing_amount_or_date'; end if;
  if tx.review_status in ('duplicate','dismissed') or tx.duplicate_of is not null then raise exception 'daily_wage_transfer_duplicate'; end if;
  if auth.uid() is not null and not public.is_company_manager(tx.company_id) then raise exception 'daily_wage_transfer_permission_denied'; end if;
  transfer_day := (tx.transfer_at at time zone 'Asia/Bangkok')::date;
  select e.* into employee from public.employee_employment_records e join public.profiles p on p.id=e.profile_id
  where e.company_id=tx.company_id and e.employment_type='daily' and e.employment_status in ('active','probation','notice')
    and lower(regexp_replace(regexp_replace(coalesce(p.full_name,''),'^(นาย|นางสาว|นาง|น.ส.|คุณ)[[:space:]]*',''),'[[:space:]]','','g'))
      = lower(regexp_replace(regexp_replace(coalesce(tx.recipient_name,''),'^(นาย|นางสาว|นาง|น.ส.|คุณ)[[:space:]]*',''),'[[:space:]]','','g')) limit 1;
  if employee.profile_id is null then raise exception 'daily_wage_transfer_employee_not_exactly_matched'; end if;
  insert into public.daily_wage_transfer_confirmations(company_id,financial_transaction_id,employee_profile_id,transfer_date,amount)
  values(tx.company_id,tx.id,employee.profile_id,transfer_day,tx.amount_total)
  on conflict(financial_transaction_id) do update set updated_at=now() returning * into result;
  insert into public.daily_wage_transfer_audit(confirmation_id,company_id,event_key,action,actor_profile_id,after_data)
  values(result.id,tx.company_id,target_event_key,'route_daily_wage_transfer',auth.uid(),jsonb_build_object(
    'employee_profile_id',result.employee_profile_id,'transfer_date',result.transfer_date,'amount',result.amount))
  on conflict(event_key) do nothing;
  return result;
end; $$;

create or replace function public.daily_wage_transfer_route_trigger()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  begin
    perform public.route_daily_wage_transfer_from_intake(new.id,'daily-wage-route:'||new.id::text);
  exception when others then
    null;
  end;
  return new;
end; $$;

drop trigger if exists daily_wage_transfer_route_after_transaction on public.financial_transactions;
create trigger daily_wage_transfer_route_after_transaction
after insert or update of recipient_name,transfer_at,amount_total,review_status on public.financial_transactions
for each row when (new.recipient_name is not null)
execute function public.daily_wage_transfer_route_trigger();
