create or replace function public.manage_pay_period_close_flow(
  target_pay_period_id uuid,
  target_action text,
  action_reason text default null,
  target_payment_reference text default null
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  target_company_id uuid := public.current_company_id();
  period_before public.pay_periods;
  period_after public.pay_periods;
  unresolved_count integer := 0;
  payroll_count integer := 0;
  payroll_row public.employee_payrolls;
  document_no text;
begin
  if not public.is_work_manager() then
    raise exception 'Manager permission required';
  end if;

  select * into period_before
  from public.pay_periods
  where id = target_pay_period_id and company_id = target_company_id
  for update;

  if not found then
    raise exception 'Pay period not found';
  end if;

  if target_action = 'generate' then
    perform public.generate_pay_period(target_pay_period_id);
  elsif target_action = 'close' then
    if period_before.status in ('closed','paying','paid','cancelled') then
      raise exception 'Pay period is already locked';
    end if;

    select count(*) into unresolved_count
    from public.attendance_sessions session
    where session.company_id = target_company_id
      and (session.clock_in_at at time zone 'Asia/Bangkok')::date between period_before.starts_on and period_before.ends_on
      and session.status not in ('rejected','duplicate')
      and (session.clock_out_at is null or session.status in ('pending','needs_review') or coalesce(session.calculation_status,'') = 'needs_review');

    if unresolved_count > 0 then
      raise exception 'Payroll period has unresolved attendance items: %', unresolved_count;
    end if;

    select count(*) into payroll_count
    from public.employee_payrolls payroll
    where payroll.company_id = target_company_id and payroll.pay_period_id = target_pay_period_id;

    if payroll_count = 0 then
      raise exception 'Please generate payroll before closing the period';
    end if;

    select count(*) into unresolved_count
    from public.employee_payrolls payroll
    where payroll.company_id = target_company_id
      and payroll.pay_period_id = target_pay_period_id
      and payroll.status in ('needs_review');

    if unresolved_count > 0 then
      raise exception 'Payroll period has payroll rows requiring review: %', unresolved_count;
    end if;

    update public.employee_payrolls
    set status = case when status in ('estimated','adjusted','approved') then 'approved' else status end,
        approved_by = coalesce(approved_by, auth.uid()),
        approved_at = coalesce(approved_at, now()),
        updated_at = now()
    where company_id = target_company_id
      and pay_period_id = target_pay_period_id
      and status in ('estimated','adjusted','approved');

    update public.pay_periods
    set status = 'closed',
        updated_at = now()
    where id = target_pay_period_id and company_id = target_company_id;
  elsif target_action = 'send_to_payment' then
    if period_before.status not in ('closed','paying') then
      raise exception 'Close payroll period before sending to payment';
    end if;

    update public.employee_payrolls
    set status = 'pending_payment',
        updated_at = now()
    where company_id = target_company_id
      and pay_period_id = target_pay_period_id
      and status in ('approved','closed','pending_payment');

    update public.pay_periods
    set status = 'paying',
        updated_at = now()
    where id = target_pay_period_id and company_id = target_company_id;
  elsif target_action = 'mark_paid' then
    if nullif(trim(target_payment_reference),'') is null then
      raise exception 'Payment reference is required';
    end if;

    if period_before.status not in ('closed','paying','paid') then
      raise exception 'Close payroll period before marking paid';
    end if;

    for payroll_row in
      select * from public.employee_payrolls
      where company_id = target_company_id
        and pay_period_id = target_pay_period_id
        and status in ('approved','closed','pending_payment','paid')
      for update
    loop
      update public.employee_payrolls
      set status = 'paid',
          payment_reference = trim(target_payment_reference),
          paid_at = coalesce(paid_at, now()),
          updated_at = now()
      where id = payroll_row.id;

      document_no := 'PAY-' || to_char(current_date,'YYYYMM') || '-' ||
        upper(substr(replace(payroll_row.id::text,'-',''),1,8));

      insert into public.employee_payslips(
        company_id,payroll_id,document_number,status,approved_by,approved_at,issued_at
      ) values (
        target_company_id,payroll_row.id,document_no,'issued',auth.uid(),now(),now()
      ) on conflict(payroll_id) do update set
        status='issued',approved_by=auth.uid(),approved_at=now(),issued_at=now(),updated_at=now();
    end loop;

    update public.pay_periods
    set status = 'paid',
        updated_at = now()
    where id = target_pay_period_id and company_id = target_company_id;
  elsif target_action = 'reopen' then
    if period_before.status = 'paid' then
      raise exception 'Paid payroll period cannot be reopened; use next-period adjustment';
    end if;
    if nullif(trim(action_reason),'') is null then
      raise exception 'Reopen reason is required';
    end if;

    update public.pay_periods
    set status = 'review',
        updated_at = now()
    where id = target_pay_period_id and company_id = target_company_id;
  else
    raise exception 'Unsupported pay period action: %', target_action;
  end if;

  select * into period_after
  from public.pay_periods
  where id = target_pay_period_id and company_id = target_company_id;

  insert into public.employee_workforce_audit_logs(
    company_id,profile_id,actor_profile_id,entity_type,entity_id,action,reason,old_values,new_values
  ) values (
    target_company_id,null,auth.uid(),'pay_period',target_pay_period_id,target_action,
    nullif(trim(coalesce(action_reason,target_payment_reference,'')),''),
    to_jsonb(period_before),to_jsonb(period_after)
  );

  return jsonb_build_object(
    'pay_period_id', target_pay_period_id,
    'action', target_action,
    'status', period_after.status
  );
end;
$$;

revoke all on function public.manage_pay_period_close_flow(uuid,text,text,text) from public, anon;
grant execute on function public.manage_pay_period_close_flow(uuid,text,text,text) to authenticated;
