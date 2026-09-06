create table public.manual_cash_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  receipt_number text not null,
  received_at timestamptz not null,
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'THB' check (currency = 'THB'),
  receipt_method text not null check (receipt_method in ('cash','bank_transfer','cash_deposit')),
  debit_account_code text not null,
  debit_account_name text not null,
  lender_name text not null check (btrim(lender_name) <> ''),
  borrower_holder_name text not null check (btrim(borrower_holder_name) <> ''),
  due_date date,
  terms text,
  evidence_reference text,
  evidence_storage_path text,
  remark text not null,
  status text not null default 'pending_evidence' check (status in ('pending_evidence','evidence_ready','confirmed','cancelled')),
  temporary_credit_account_code text not null default '2199',
  temporary_credit_account_name text not null default 'เงินรับรอตรวจสอบ',
  final_credit_account_code text not null default '2120',
  final_credit_account_name text not null default 'เจ้าหนี้เงินยืมผู้บริหาร/กรรมการ',
  idempotency_key text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, receipt_number),
  unique (company_id, idempotency_key)
);

create index manual_cash_receipts_company_status_idx on public.manual_cash_receipts(company_id,status,received_at desc);
alter table public.manual_cash_receipts enable row level security;
revoke all on table public.manual_cash_receipts from public, anon;
grant select on table public.manual_cash_receipts to authenticated;
create policy "Company finance reads manual cash receipts" on public.manual_cash_receipts
for select to authenticated using (
  public.is_platform_admin() or public.is_company_manager(company_id)
  or exists(select 1 from public.company_members member where member.company_id=manual_cash_receipts.company_id and member.profile_id=auth.uid() and member.active and member.company_role='accounting_hr')
);

create table public.manual_cash_receipt_audit (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.manual_cash_receipts(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  action text not null,
  before_data jsonb,
  after_data jsonb not null,
  reason text not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index manual_cash_receipt_audit_receipt_idx on public.manual_cash_receipt_audit(receipt_id,created_at desc);
alter table public.manual_cash_receipt_audit enable row level security;
revoke all on table public.manual_cash_receipt_audit from public, anon;
grant select on table public.manual_cash_receipt_audit to authenticated;
create policy "Company finance reads manual receipt audit" on public.manual_cash_receipt_audit
for select to authenticated using (public.is_platform_admin() or public.is_company_manager(company_id));

create or replace function public.create_manual_cash_receipt_v1(
  target_company_id uuid,
  target_idempotency_key text,
  target_received_at timestamptz,
  target_amount numeric,
  target_receipt_method text,
  target_debit_account_code text,
  target_debit_account_name text,
  target_lender_name text,
  target_borrower_holder_name text,
  target_due_date date,
  target_terms text,
  target_evidence_reference text,
  target_remark text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result public.manual_cash_receipts; receipt_no text;
begin
  if auth.uid() is null then raise exception 'workflow_authentication_required'; end if;
  if not public.is_platform_admin() and not public.is_company_manager(target_company_id) then raise exception 'workflow_permission_denied'; end if;
  if target_amount is null or target_amount <= 0 then raise exception 'manual_receipt_amount_required'; end if;
  if target_receipt_method not in ('cash','bank_transfer','cash_deposit') then raise exception 'manual_receipt_method_invalid'; end if;
  if nullif(btrim(target_lender_name),'') is null or nullif(btrim(target_borrower_holder_name),'') is null then raise exception 'manual_receipt_parties_required'; end if;
  if nullif(btrim(target_remark),'') is null then raise exception 'manual_receipt_remark_required'; end if;
  select * into result from public.manual_cash_receipts where company_id=target_company_id and idempotency_key=target_idempotency_key;
  if result.id is not null then return to_jsonb(result); end if;
  receipt_no := 'MR-'||to_char(target_received_at at time zone 'Asia/Bangkok','YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  insert into public.manual_cash_receipts(company_id,receipt_number,received_at,amount,receipt_method,debit_account_code,debit_account_name,lender_name,borrower_holder_name,due_date,terms,evidence_reference,remark,status,idempotency_key,created_by,updated_by)
  values(target_company_id,receipt_no,target_received_at,target_amount,target_receipt_method,btrim(target_debit_account_code),btrim(target_debit_account_name),btrim(target_lender_name),btrim(target_borrower_holder_name),target_due_date,nullif(btrim(target_terms),''),nullif(btrim(target_evidence_reference),''),btrim(target_remark),case when nullif(btrim(target_evidence_reference),'') is null then 'pending_evidence' else 'evidence_ready' end,target_idempotency_key,auth.uid(),auth.uid()) returning * into result;
  insert into public.manual_cash_receipt_audit(receipt_id,company_id,action,after_data,reason,actor_id)
  values(result.id,result.company_id,'manual_cash_received',jsonb_build_object('receipt_number',result.receipt_number,'amount',result.amount,'status',result.status,'debit_account_code',result.debit_account_code,'credit_account_code',result.temporary_credit_account_code),'รับเงินไว้ก่อนและรอหลักฐาน ไม่บันทึกเป็นรายได้',auth.uid());
  return to_jsonb(result);
end $$;
revoke all on function public.create_manual_cash_receipt_v1(uuid,text,timestamptz,numeric,text,text,text,text,text,date,text,text,text) from public,anon;
grant execute on function public.create_manual_cash_receipt_v1(uuid,text,timestamptz,numeric,text,text,text,text,text,date,text,text,text) to authenticated;

notify pgrst,'reload schema';
