import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db=new PGlite()
await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create schema extensions; create function extensions.digest(bytea,text) returns bytea language sql immutable as $$select decode(repeat('ab',32),'hex')$$; create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
create table public.companies(id uuid primary key); create table public.profiles(id uuid primary key);
create table public.projects(id uuid primary key,company_id uuid not null references public.companies(id));
create table public.company_members(company_id uuid,profile_id uuid,active boolean,company_role text);
create function public.current_company_id() returns uuid language sql stable as $$select nullif(current_setting('app.company_id',true),'')::uuid$$;
create function public.is_company_manager(uuid) returns boolean language sql stable as $$select true$$;
create table public.vendors(id uuid primary key,company_id uuid not null references public.companies(id));
create table public.accounting_documents(id uuid primary key,company_id uuid not null references public.companies(id),vendor_id uuid,document_type text,document_number text,document_date date,due_date date,currency text,vendor_name text,subtotal numeric,discount_amount numeric,vat_amount numeric,withholding_tax_amount numeric,total_amount numeric,status text,posting_status text,created_by uuid,updated_at timestamptz default now());
create table public.accounting_document_lines(id uuid primary key default gen_random_uuid(),document_id uuid,item_type text);
create table public.accounting_draft_entries(document_id uuid,line_number int,account_code text,account_name text,debit numeric,credit numeric,project_id uuid,description text);
create table public.document_flow_items(id uuid primary key,company_id uuid,intake_id uuid,accounting_document_id uuid,current_flow text,current_room text,state text,version int,approved_by uuid,approved_at timestamptz,updated_at timestamptz default now());
create table public.document_flow_events(id uuid primary key default gen_random_uuid(),item_id uuid,company_id uuid,event_key text unique,event_type text,from_flow text,to_flow text,from_state text,to_state text,from_room text,to_room text,note text,payload jsonb default '{}',actor_id uuid,created_at timestamptz default now());
create table public.posting_operations(id uuid primary key default gen_random_uuid(),company_id uuid not null, intake_id uuid,document_id uuid,posting_type text,idempotency_key text,status text,updated_at timestamptz default now(),gateway_reference text,created_by uuid, unique(id,company_id),unique(company_id,idempotency_key));
create table public.posting_operation_events(id uuid primary key default gen_random_uuid(),operation_id uuid,company_id uuid,event_key text unique,event_type text,from_status text,to_status text,error_code text,payload jsonb default '{}',actor_id uuid,created_at timestamptz default now());`)
await db.exec(readFileSync('supabase/migrations/202609170001_accounting_ap_gateway_persistence.sql','utf8'))
const c1='00000000-0000-0000-0000-000000000001', c2='00000000-0000-0000-0000-000000000002', d='10000000-0000-0000-0000-000000000001', i='20000000-0000-0000-0000-000000000001', f='30000000-0000-0000-0000-000000000001', v='40000000-0000-0000-0000-000000000001', p='50000000-0000-0000-0000-000000000001', a='60000000-0000-0000-0000-000000000001', ap='70000000-0000-0000-0000-000000000001', po='80000000-0000-0000-0000-000000000001'
await db.exec(`insert into companies values('${c1}'),('${c2}'); insert into vendors values('${v}','${c1}'); insert into projects values('${p}','${c1}');
insert into accounting_documents values('${d}','${c1}','${v}','quotation','INV-1','2026-09-01','2026-09-30','THB','Vendor',100,0,7,3,104,'confirmed','draft',null,now());
insert into accounting_document_lines(document_id,item_type) values('${d}','stock');
insert into accounting_draft_entries values('${d}',1,'5200','Expense',100,0,'${p}','Base'),('${d}',2,'1150','VAT',7,0,null,'VAT'),('${d}',3,'2100','AP',0,104,null,'AP'),('${d}',4,'2150','WHT',0,3,null,'WHT');
insert into document_flow_items values('${f}','${c1}','${i}','${d}','posting','posting_approval_room','awaiting_approval',1,null,null,now());
select set_config('app.company_id','${c1}',false); select set_config('request.jwt.claim.role','authenticated',false);`)
assert.equal((await db.query(`select count(*)::int n from posting_operations`)).rows[0].n,0,'no executable command exists before approval')
await assert.rejects(()=>db.query(`select approve_posting_bundle($1,99,'bad:1',null)`,[f]),/posting_approval_state_or_version_invalid/)
assert.equal((await db.query(`select count(*)::int n from posting_operations`)).rows[0].n,0,'invalid bundle rolls back all reservations')
await assert.rejects(()=>db.query(`select approve_posting_bundle($1,1,'quotation:1',null)`,[f]),/quotation_owned_by_quotation_decision_workflow/)
assert.equal((await db.query(`select count(*)::int n from posting_operations`)).rows[0].n,0,'quotation never creates Posting operations')
const supportedPostingTypes=['invoice','billing_note','receipt','cash_receipt','tax_invoice_full','tax_invoice_abbreviated','invoice_tax_invoice','receipt_tax_invoice','receipt_tax_invoice_abbreviated']
for (const [index,documentType] of supportedPostingTypes.entries()) {
  await db.exec(`update accounting_documents set document_type='${documentType}' where id='${d}'`)
  await db.query(`select approve_posting_bundle($1,1,$2,null)`,[f,`type:${index}`])
  assert.deepEqual((await db.query(`select posting_type from posting_operations order by posting_type`)).rows.map(x=>x.posting_type),['accounting','ap','stock'],`${documentType} must derive Accounting/AP/Stock from canonical stock lines`)
  await db.exec(`delete from posting_target_results; delete from posting_approval_snapshots; delete from document_flow_events; delete from posting_operations; update document_flow_items set state='awaiting_approval',current_room='posting_approval_room',version=1,approved_by=null,approved_at=null where id='${f}'`)
}
const unsupportedPostingTypes=['purchase_order','goods_receipt','delivery_note','transfer_slip','withholding_tax_certificate','payroll','other','unreadable','reference','archive','unknown_future_type']
for (const [index,documentType] of unsupportedPostingTypes.entries()) {
  await db.exec(`update accounting_documents set document_type='${documentType}' where id='${d}'`)
  await assert.rejects(()=>db.query(`select approve_posting_bundle($1,1,$2,null)`,[f,`unsupported:${index}`]),/posting_document_type_not_supported/)
  assert.deepEqual((await db.query(`select (select count(*)::int from posting_operations) operations,(select count(*)::int from document_flow_events) events,(select count(*)::int from posting_approval_snapshots) snapshots`)).rows[0],{operations:0,events:0,snapshots:0},`${documentType} must fail before every side effect`)
}
await db.exec(`update accounting_documents set document_type='invoice' where id='${d}'`)
const approved=(await db.query(`select (approve_posting_bundle($1,1,'approve:1',null)).state state`,[f])).rows[0]
assert.equal(approved.state,'approved_waiting_gateway'); assert.equal((await db.query(`select count(*)::int n from posting_operations`)).rows[0].n,3)
assert.deepEqual((await db.query(`select posting_type from posting_operations order by posting_type`)).rows.map(x=>x.posting_type),['accounting','ap','stock'])
const approvalReplay=(await db.query(`select (approve_posting_bundle($1,1,'approve:1',null)).state state`,[f])).rows[0]
assert.equal(approvalReplay.state,'approved_waiting_gateway'); assert.equal((await db.query(`select count(*)::int n from posting_operations`)).rows[0].n,3)
await db.exec(`select set_config('request.jwt.claim.role','service_role',false)`)
const snap=(await db.query(`select snapshot,snapshot_hash from posting_approval_snapshots`)).rows[0]
assert.equal(snap.snapshot.requiredTargets.includes('purchase_order'),false)
const tx=`accounting-ap-v1:${c1}:${i}:${d}:2`, payload={...snap.snapshot,approvalSnapshotHash:snap.snapshot_hash,transactionKey:tx,paymentLinkKey:`${tx}:payment-link`}
const operations=(await db.query(`select id,posting_type from posting_operations`)).rows, accountingId=operations.find(x=>x.posting_type==='accounting').id, apId=operations.find(x=>x.posting_type==='ap').id
await assert.rejects(()=>db.query(`select persist_accounting_ap_gateway($1,$2,$3,$4,$5::jsonb)`,[c1,accountingId,apId,'fp',{...payload,vendorName:'Tampered'}]),/accounting_ap_approval_snapshot_tampered/)
await assert.rejects(()=>db.query(`select persist_accounting_ap_gateway($1,$2,$3,$4,$5::jsonb)`,[c1,accountingId,apId,'fp',payload]),/accounting_ap_open_period_required/)
await db.exec(`insert into accounting_periods(company_id,period_start,period_end,status) values('${c1}','2026-09-01','2026-09-30','open')`)
const concurrent=await Promise.all([1,2].map(()=>db.query(`select persist_accounting_ap_gateway($1,$2,$3,$4,$5::jsonb) result`,[c1,accountingId,apId,'fp',payload])))
const results=concurrent.map(x=>x.rows[0].result), committed=results.find(x=>x.mode==='committed')
assert.ok(committed); assert.deepEqual(results.map(x=>x.mode).sort(),['committed','replay'])
assert.equal((await db.query(`select state,current_room from document_flow_items where id=$1`,[f])).rows[0].state,'posting','stock target keeps aggregate partial')
const projection=(await db.query(`select to_flow,to_state,to_room,payload from document_flow_events where event_type='accounting_ap_posted'`)).rows[0]
assert.deepEqual([projection.to_flow,projection.to_state,projection.to_room],['posting','posting','posting_partial_targets'])
assert.equal(projection.payload.aggregate_projection.room,'posting_partial_targets')
assert.equal(snap.snapshot_hash.length,64)
const replay=(await db.query(`select persist_accounting_ap_gateway($1,$2,$3,$4,$5::jsonb) result`,[c1,accountingId,apId,'fp',payload])).rows[0].result
assert.equal(replay.mode,'replay','committed replay must precede live-state guards')
await assert.rejects(()=>db.query(`select persist_accounting_ap_gateway($1,$2,$3,$4,$5::jsonb)`,[c1,accountingId,apId,'different',payload]),/accounting_ap_idempotency_conflict/)
await assert.rejects(()=>db.exec(`insert into accounting_ap_journal_lines(transaction_id,company_id,line_number,account_code,account_name,role,debit,credit,description) values('${committed.transaction_id}','${c2}',99,'x','x','base_debit',1,0,'x')`),/foreign key|violates/i)
assert.equal((await db.query(`select count(*)::int n from posting_operation_events where event_type in ('started','posted')`)).rows[0].n,4)
console.log('Accounting/AP PostgreSQL runtime: document-type matrix, replay, tamper, cross-tenant FK, partial targets and audit passed')
