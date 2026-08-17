-- Complete the operational HR workflows that were previously schema-only.

create policy "Employees create own private profile"
  on public.employee_private_profiles for insert to authenticated
  with check (profile_id=auth.uid() and data_status in ('incomplete','pending_review'));
create policy "Employees update own unverified private profile"
  on public.employee_private_profiles for update to authenticated
  using (profile_id=auth.uid())
  with check (profile_id=auth.uid() and data_status in ('incomplete','pending_review','needs_update'));

create or replace function public.refresh_employee_leave_balance(
  target_profile_id uuid,
  target_leave_type_id uuid,
  target_year integer
) returns public.employee_leave_balances
language plpgsql
security definer
set search_path = public
as $$
declare result_row public.employee_leave_balances;
begin
  insert into public.employee_leave_balances(
    profile_id, leave_type_id, balance_year, granted_minutes, used_minutes, pending_minutes
  )
  select target_profile_id, target_leave_type_id, target_year,
    coalesce(type.annual_quota_minutes, 0), 0, 0
  from public.leave_types type where type.id=target_leave_type_id
  on conflict(profile_id,leave_type_id,balance_year) do nothing;

  update public.employee_leave_balances balance set
    granted_minutes=coalesce(type.annual_quota_minutes,balance.granted_minutes),
    used_minutes=coalesce((
      select sum(request.requested_minutes) from public.employee_leave_requests request
      where request.profile_id=target_profile_id
        and request.leave_type_id=target_leave_type_id
        and extract(year from request.starts_at at time zone 'Asia/Bangkok')::integer=target_year
        and request.status in ('approved','used')
    ),0),
    pending_minutes=coalesce((
      select sum(request.requested_minutes) from public.employee_leave_requests request
      where request.profile_id=target_profile_id
        and request.leave_type_id=target_leave_type_id
        and extract(year from request.starts_at at time zone 'Asia/Bangkok')::integer=target_year
        and request.status in ('pending','late_notice','needs_evidence')
    ),0),
    updated_at=now()
  from public.leave_types type
  where balance.profile_id=target_profile_id
    and balance.leave_type_id=target_leave_type_id
    and balance.balance_year=target_year
    and type.id=target_leave_type_id
  returning balance.* into result_row;
  return result_row;
end;
$$;

create or replace function public.refresh_leave_balance_after_change()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op <> 'INSERT' then
    perform public.refresh_employee_leave_balance(
      old.profile_id, old.leave_type_id,
      extract(year from old.starts_at at time zone 'Asia/Bangkok')::integer
    );
  end if;
  if tg_op <> 'DELETE' then
    perform public.refresh_employee_leave_balance(
      new.profile_id, new.leave_type_id,
      extract(year from new.starts_at at time zone 'Asia/Bangkok')::integer
    );
  end if;
  return coalesce(new,old);
end;
$$;

drop trigger if exists refresh_leave_balance on public.employee_leave_requests;
create trigger refresh_leave_balance
after insert or update or delete on public.employee_leave_requests
for each row execute function public.refresh_leave_balance_after_change();

create or replace function public.cancel_leave_request(target_request_id uuid)
returns public.employee_leave_requests
language plpgsql security definer set search_path=public as $$
declare result_row public.employee_leave_requests;
begin
  update public.employee_leave_requests set status='cancelled',updated_at=now()
  where id=target_request_id and profile_id=auth.uid()
    and status in ('draft','pending','late_notice','needs_evidence')
  returning * into result_row;
  if result_row.id is null then raise exception 'Leave request cannot be cancelled'; end if;
  return result_row;
end;
$$;

create or replace function public.acknowledge_overtime_assignment(target_assignment_id uuid)
returns public.employee_overtime_assignments
language plpgsql security definer set search_path=public as $$
declare result_row public.employee_overtime_assignments;
begin
  update public.employee_overtime_assignments
  set status='acknowledged',acknowledged_at=now(),updated_at=now()
  where id=target_assignment_id and profile_id=auth.uid() and status='assigned'
  returning * into result_row;
  if result_row.id is null then raise exception 'OT assignment cannot be acknowledged'; end if;
  return result_row;
end;
$$;

create or replace function public.transition_employee_payroll(
  target_payroll_id uuid,
  target_action text,
  target_payment_reference text default null
) returns public.employee_payrolls
language plpgsql security definer set search_path=public as $$
declare payroll_row public.employee_payrolls;
declare result_row public.employee_payrolls;
declare document_no text;
begin
  if not public.is_work_manager() then raise exception 'Manager permission required'; end if;
  select * into payroll_row from public.employee_payrolls
  where id=target_payroll_id for update;
  if payroll_row.id is null then raise exception 'Payroll not found'; end if;

  if target_action='approve' and payroll_row.status in ('estimated','needs_review','adjusted') then
    update public.employee_payrolls set status='approved',approved_by=auth.uid(),
      approved_at=now(),updated_at=now() where id=target_payroll_id returning * into result_row;
  elsif target_action='send_to_payment' and payroll_row.status='approved' then
    update public.employee_payrolls set status='pending_payment',updated_at=now()
      where id=target_payroll_id returning * into result_row;
  elsif target_action='mark_paid' and payroll_row.status in ('approved','closed','pending_payment') then
    if nullif(trim(target_payment_reference),'') is null then
      raise exception 'Payment reference is required';
    end if;
    update public.employee_payrolls set status='paid',
      payment_reference=trim(target_payment_reference),paid_at=now(),updated_at=now()
      where id=target_payroll_id returning * into result_row;

    document_no := 'PAY-' || to_char(current_date,'YYYYMM') || '-' ||
      upper(substr(replace(target_payroll_id::text,'-',''),1,8));
    insert into public.employee_payslips(
      payroll_id,document_number,status,approved_by,approved_at,issued_at
    ) values (
      target_payroll_id,document_no,'issued',auth.uid(),now(),now()
    ) on conflict(payroll_id) do update set
      status='issued',approved_by=auth.uid(),approved_at=now(),issued_at=now(),updated_at=now();
  else
    raise exception 'Invalid payroll transition from % using %', payroll_row.status, target_action;
  end if;

  insert into public.employee_workforce_audit_logs(
    profile_id,actor_profile_id,entity_type,entity_id,action,reason,old_values,new_values
  ) values (
    payroll_row.profile_id,auth.uid(),'payroll',target_payroll_id,target_action,
    target_payment_reference,to_jsonb(payroll_row),to_jsonb(result_row)
  );

  update public.pay_periods period set status=case
    when not exists(
      select 1 from public.employee_payrolls payroll
      where payroll.pay_period_id=period.id and payroll.status <> 'paid'
    ) then 'paid'
    when exists(
      select 1 from public.employee_payrolls payroll
      where payroll.pay_period_id=period.id and payroll.status='paid'
    ) then 'paying'
    else period.status end,
    updated_at=now()
  where period.id=result_row.pay_period_id;
  return result_row;
end;
$$;

create or replace function public.transition_document_request(
  target_request_id uuid,
  target_action text,
  target_output_path text default null,
  target_note text default null
) returns public.employee_document_requests
language plpgsql security definer set search_path=public as $$
declare before_row public.employee_document_requests;
declare result_row public.employee_document_requests;
declare next_status text;
begin
  if not public.is_work_manager() then raise exception 'Manager permission required'; end if;
  select * into before_row from public.employee_document_requests
  where id=target_request_id for update;
  if before_row.id is null then raise exception 'Document request not found'; end if;

  next_status := case target_action
    when 'reject' then 'rejected'
    when 'generate' then 'generating'
    when 'ready' then 'ready'
    when 'deliver' then 'delivered'
    else null end;
  if next_status is null then raise exception 'Unsupported document action'; end if;
  if next_status in ('ready','delivered') and nullif(trim(target_output_path),'') is null
     and nullif(trim(before_row.output_storage_path),'') is null then
    raise exception 'Document output path is required';
  end if;

  update public.employee_document_requests set
    status=next_status,
    output_storage_path=coalesce(nullif(trim(target_output_path),''),output_storage_path),
    review_note=coalesce(target_note,review_note),
    reviewed_by=coalesce(reviewed_by,auth.uid()),
    reviewed_at=coalesce(reviewed_at,now()),
    delivered_at=case when next_status='delivered' then now() else delivered_at end,
    updated_at=now()
  where id=target_request_id returning * into result_row;

  insert into public.employee_workforce_audit_logs(
    profile_id,actor_profile_id,entity_type,entity_id,action,reason,old_values,new_values
  ) values (
    before_row.profile_id,auth.uid(),'document_request',target_request_id,target_action,
    target_note,to_jsonb(before_row),to_jsonb(result_row)
  );
  return result_row;
end;
$$;

revoke all on function public.refresh_employee_leave_balance(uuid,uuid,integer) from public;
revoke all on function public.cancel_leave_request(uuid) from public;
revoke all on function public.acknowledge_overtime_assignment(uuid) from public;
revoke all on function public.transition_employee_payroll(uuid,text,text) from public;
revoke all on function public.transition_document_request(uuid,text,text,text) from public;
grant execute on function public.cancel_leave_request(uuid) to authenticated;
grant execute on function public.acknowledge_overtime_assignment(uuid) to authenticated;
grant execute on function public.transition_employee_payroll(uuid,text,text) to authenticated;
grant execute on function public.transition_document_request(uuid,text,text,text) to authenticated;
