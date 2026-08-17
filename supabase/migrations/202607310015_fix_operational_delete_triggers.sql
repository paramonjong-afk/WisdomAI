-- BEFORE DELETE triggers must return OLD. Returning NEW (NULL on DELETE)
-- silently cancels otherwise valid deletes.

create or replace function public.protect_locked_attendance()
returns trigger language plpgsql set search_path=public as $$
begin
  if exists(
    select 1 from public.employee_payrolls payroll
    join public.pay_periods period on period.id=payroll.pay_period_id
    where payroll.profile_id=old.profile_id
      and (old.clock_in_at at time zone 'Asia/Bangkok')::date between period.starts_on and period.ends_on
      and (payroll.status in ('closed','pending_payment','paid') or period.status in ('closed','paying','paid'))
  ) then
    raise exception 'รอบค่าจ้างนี้ปิดหรือจ่ายแล้ว กรุณาสร้างรายการปรับปรุงแทนการแก้เวลาเดิม';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.protect_paid_contractor_claim()
returns trigger language plpgsql set search_path=public as $$
begin
  if old.status='paid' then
    raise exception 'งวดผู้รับเหมาจ่ายแล้ว กรุณาสร้างรายการปรับปรุงใหม่';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
