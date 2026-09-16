import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { db,c1,c2,d,f,p } from './accounting-ap-gateway-postgres.test.mjs'

await db.exec(`create table if not exists inventory_items(id uuid primary key,name text,unit text,status text);
create table if not exists inventory_locations(id uuid primary key,company_id uuid references companies(id),name text,active boolean);
create table if not exists purchase_orders(id uuid primary key,company_id uuid,project_id uuid,status text);
create table if not exists purchase_order_lines(id uuid primary key,company_id uuid,purchase_order_id uuid,product_code text,quantity numeric,unit text,unit_price numeric,received_quantity numeric);
alter table accounting_document_lines add column if not exists line_number int;
alter table accounting_document_lines add column if not exists inventory_item_id uuid;
alter table accounting_document_lines add column if not exists unit text;
alter table accounting_document_lines add column if not exists project_id uuid;
alter table accounting_document_lines add column if not exists quantity numeric;
alter table accounting_document_lines add column if not exists unit_price numeric;`)
await db.exec(`alter table accounting_document_lines add column if not exists product_code text; alter table accounting_document_lines add column if not exists purchase_order_line_id uuid;`)
await db.exec(`create table if not exists inventory_movements(id uuid primary key default gen_random_uuid(),company_id uuid,inventory_item_id uuid,document_line_id uuid,project_id uuid,location_id uuid,movement_type text,quantity numeric,unit_cost numeric,occurred_at timestamptz,notes text,created_by uuid,created_at timestamptz default now());`)
await db.exec(readFileSync('supabase/migrations/202609170002_stock_gateway_persistence.sql','utf8'))
const inv='90000000-0000-0000-0000-000000000001',loc='91000000-0000-0000-0000-000000000001',po='92000000-0000-0000-0000-000000000001',poLine='93000000-0000-0000-0000-000000000001'
const line=(await db.query(`select id from accounting_document_lines where document_id=$1 limit 1`,[d])).rows[0].id
await db.exec(`insert into inventory_items values('${inv}','Item','pcs','active'); insert into inventory_locations values('${loc}','${c1}','WH',true);
insert into inventory_item_company_scopes(company_id,inventory_item_id,master_unit) values('${c1}','${inv}','pcs');
update accounting_document_lines set line_number=1,inventory_item_id='${inv}',product_code='SKU-1',unit='pcs',project_id='${p}',quantity=10,unit_price=100,purchase_order_line_id='${poLine}' where id='${line}';
insert into purchase_orders values('${po}','${c1}','${p}','approved'); insert into purchase_order_lines values('${poLine}','${c1}','${po}','SKU-1',10,'pcs',100,0);`)
await db.exec(`select set_config('request.jwt.claim.role','authenticated',false)`)
const e2eD='10000000-0000-0000-0000-000000000005',e2eI='20000000-0000-0000-0000-000000000005',e2eF='30000000-0000-0000-0000-000000000005',e2ePo='92000000-0000-0000-0000-000000000005',e2ePoLine='93000000-0000-0000-0000-000000000005',e2ePoLine2='93000000-0000-0000-0000-000000000006'
await db.exec(`insert into accounting_documents values('${e2eD}','${c1}','40000000-0000-0000-0000-000000000001','invoice','INV-STOCK-E2E','2026-09-17','2026-09-30','THB','Vendor',100,0,7,3,104,'confirmed','draft',null,now());
insert into accounting_document_lines(document_id,item_type,line_number,inventory_item_id,product_code,unit,project_id,quantity,unit_price,purchase_order_line_id) values('${e2eD}','stock',1,'${inv}','SKU-E2E','pcs','${p}',10,100,'${e2ePoLine}');
insert into accounting_document_lines(document_id,item_type,line_number,inventory_item_id,product_code,unit,project_id,quantity,unit_price,purchase_order_line_id) values('${e2eD}','stock',2,'${inv}','SKU-E2E-2','pcs','${p}',5,100,'${e2ePoLine2}');
insert into accounting_draft_entries values('${e2eD}',1,'5200','Expense',100,0,'${p}','Base'),('${e2eD}',2,'1150','VAT',7,0,null,'VAT'),('${e2eD}',3,'2100','AP',0,104,null,'AP'),('${e2eD}',4,'2150','WHT',0,3,null,'WHT');
insert into document_flow_items values('${e2eF}','${c1}','${e2eI}','${e2eD}','posting','posting_approval_room','awaiting_approval',1,null,null,now());
insert into purchase_orders values('${e2ePo}','${c1}','${p}','approved'); insert into purchase_order_lines values('${e2ePoLine}','${c1}','${e2ePo}','SKU-E2E',10,'pcs',100,0),('${e2ePoLine2}','${c1}','${e2ePo}','SKU-E2E-2',5,'pcs',100,0);`)
const e2eSourceLines=(await db.query(`select id from accounting_document_lines where document_id=$1 order by line_number`,[e2eD])).rows
const e2eLine=e2eSourceLines[0].id,e2eLine2=e2eSourceLines[1].id
assert.equal((await db.query(`select count(*)::int n from posting_stock_approval_lines where document_id=$1`,[e2eD])).rows[0].n,0)
await db.exec(`select set_config('app.company_id','${c2}',false)`)
await assert.rejects(()=>db.query(`select approve_posting_stock_bundle($1,1,'stock-e2e-cross:1',null,$2::jsonb)`,[e2eF,JSON.stringify([{sourceLineId:e2eLine,locationId:loc,requestedQuantity:4},{sourceLineId:e2eLine2,locationId:loc,requestedQuantity:2}])]),/stock_bundle_not_authorized/)
await db.exec(`select set_config('app.company_id','${c1}',false)`)
await assert.rejects(()=>db.query(`select approve_posting_stock_bundle($1,1,'stock-e2e-inflated:1',null,$2::jsonb)`,[e2eF,JSON.stringify([{sourceLineId:e2eLine,locationId:loc,requestedQuantity:4},{sourceLineId:e2eLine2,locationId:loc,requestedQuantity:6}])]),/stock_requested_quantity_exceeds_canonical_remaining/)
assert.equal((await db.query(`select count(*)::int n from posting_operations where document_id=$1`,[e2eD])).rows[0].n,0)
assert.equal((await db.query(`select count(*)::int n from posting_stock_approval_lines where document_id=$1`,[e2eD])).rows[0].n,0)
const e2eInputs=JSON.stringify([{sourceLineId:e2eLine,locationId:loc,requestedQuantity:4},{sourceLineId:e2eLine2,locationId:loc,requestedQuantity:2}])
await assert.rejects(()=>db.query(`select approve_posting_stock_bundle($1,99,'stock-e2e-approve-failure:1',null,$2::jsonb)`,[e2eF,e2eInputs]),/posting_approval_state_or_version_invalid/)
assert.equal((await db.query(`select count(*)::int n from posting_stock_approval_lines where document_id=$1`,[e2eD])).rows[0].n,0)
assert.equal((await db.query(`select count(*)::int n from posting_operations where document_id=$1`,[e2eD])).rows[0].n,0)
await db.query(`select approve_posting_stock_bundle($1,1,'stock-e2e-approval:1',null,$2::jsonb)`,[e2eF,e2eInputs])
await db.query(`select approve_posting_stock_bundle($1,1,'stock-e2e-approval:1',null,$2::jsonb)`,[e2eF,e2eInputs])
const e2eApproval=(await db.query(`select snapshot_hash,snapshot from posting_approval_snapshots where document_id=$1`,[e2eD])).rows[0]
assert.equal(e2eApproval.snapshot.stockLines[0].purchaseOrderLineId,e2ePoLine)
assert.ok((await db.query(`select frozen_at is not null frozen from posting_stock_approval_lines where document_id=$1`,[e2eD])).rows[0].frozen)
const e2eOp=(await db.query(`select id from posting_operations where document_id=$1 and posting_type='stock'`,[e2eD])).rows[0].id
const e2eFp=(await db.query(`select encode(extensions.digest(convert_to(snapshot_hash||':'||$2||':receipt:'||(snapshot->'stockLines')::text,'UTF8'),'sha256'),'hex') value from posting_approval_snapshots where document_id=$1`,[e2eD,e2eOp])).rows[0].value
await db.exec(`select set_config('request.jwt.claim.role','service_role',false)`)
assert.equal((await db.query(`select persist_stock_gateway($1,$2,$3,'receipt') result`,[c1,e2eOp,e2eFp])).rows[0].result.mode,'committed')
await db.exec(`select set_config('request.jwt.claim.role','authenticated',false)`)
const staged=(await db.query(`select p.* from prepare_posting_stock_line($1,$2,$3,4,0) p`,[d,line,loc])).rows[0]
assert.equal(staged.purchase_order_line_id,poLine); assert.equal(Number(staged.ordered_quantity),10); assert.equal(Number(staged.previously_received_quantity),0); assert.equal(staged.revision,1); assert.equal(staged.staging_hash.length,64)
await assert.rejects(()=>db.query(`select prepare_posting_stock_line($1,$2,$3,11,1)`,[d,line,loc]),/stock_requested_quantity_exceeds_canonical_remaining/)
await assert.rejects(()=>db.query(`select prepare_posting_stock_line($1,$2,$3,4,0)`,[d,line,loc]),/stock_staging_revision_conflict/)
await db.exec(`select set_config('request.jwt.claim.role','service_role',false)`)
await db.exec(`insert into posting_approval_snapshots(company_id,document_flow_item_id,document_id,intake_id,approval_event_key,source_version,snapshot_hash,snapshot,required_targets,approved_at) select company_id,document_flow_item_id,document_id,intake_id,'future-stock-capture',999,'placeholder',snapshot,array['stock'],now() from posting_approval_snapshots limit 1`)
const captured=(await db.query(`select snapshot,snapshot_hash from posting_approval_snapshots where approval_event_key='future-stock-capture'`)).rows[0]
assert.equal(captured.snapshot.stockLines[0].locationId,loc)
assert.equal(captured.snapshot.stockTotalValue,400)
assert.equal(captured.snapshot_hash.length,64)
await db.exec(`select set_config('app.reviewed_stock_recovery','true',false); delete from posting_approval_snapshots where approval_event_key='future-stock-capture'`)
const stockLines=[{lineNumber:1,sourceLineId:line,inventoryItemId:inv,unit:'pcs',locationId:loc,projectId:p,sourceQuantity:10,unitCost:100,quantity:4,lineValue:400,orderedQuantity:10,previouslyReceivedQuantity:0,movementKind:'receipt',occurredAt:'2026-09-17T08:00:00Z'}]
await db.exec(`select set_config('app.reviewed_stock_recovery','true',false)`)
const installSnapshot=async lines=>{
  const total=lines.reduce((sum,x)=>sum+x.lineValue,0)
  await db.query(`update posting_approval_snapshots set snapshot=jsonb_set(jsonb_set(snapshot,'{stockLines}',$1::jsonb),'{stockTotalValue}',$2::jsonb),snapshot_hash=encode(extensions.digest(convert_to(jsonb_set(jsonb_set(snapshot,'{stockLines}',$1::jsonb),'{stockTotalValue}',$2::jsonb)::text,'UTF8'),'sha256'),'hex') where document_id=$3`,[JSON.stringify(lines),JSON.stringify(total),d])
  return (await db.query(`select snapshot_hash from posting_approval_snapshots where document_id=$1`,[d])).rows[0].snapshot_hash
}
let snapshotHash=await installSnapshot(stockLines)
await db.exec(`select set_config('app.reviewed_stock_recovery','false',false)`)
await assert.rejects(()=>db.exec(`update posting_approval_snapshots set snapshot_hash='tampered'`),/posting_approval_snapshot_immutable/)
await db.exec(`select set_config('app.reviewed_stock_recovery','true',false)`)
const op=(await db.query(`select id from posting_operations where posting_type='stock'`)).rows[0].id
const fp=(await db.query(`select encode(extensions.digest(convert_to($1||':'||$2||':receipt:'||$3::jsonb::text,'UTF8'),'sha256'),'hex') value`,[snapshotHash,op,JSON.stringify(stockLines)])).rows[0].value
await assert.rejects(()=>db.query(`select persist_stock_gateway($1,$2,$3,'receipt')`,[c2,op,fp]),/stock_operation_not_found_or_scope_mismatch/)
await db.exec(`select set_config('app.reviewed_stock_recovery','true',false); update posting_approval_snapshots set snapshot=jsonb_set(snapshot,'{stockTotalValue}','401'::jsonb)`)
await assert.rejects(()=>db.query(`select persist_stock_gateway($1,$2,$3,'receipt')`,[c1,op,fp]),/stock_approval_snapshot_hash_mismatch/)
snapshotHash=await installSnapshot(stockLines)
const invalidValue=[{...stockLines[0],lineValue:399}]
snapshotHash=await installSnapshot(invalidValue)
let invalidFp=(await db.query(`select encode(extensions.digest(convert_to($1||':'||$2||':receipt:'||$3::jsonb::text,'UTF8'),'sha256'),'hex') value`,[snapshotHash,op,JSON.stringify(invalidValue)])).rows[0].value
await assert.rejects(()=>db.query(`select persist_stock_gateway($1,$2,$3,'receipt')`,[c1,op,invalidFp]),/stock_line_value_invalid/)
const duplicateLines=[stockLines[0],{...stockLines[0]}]
snapshotHash=await installSnapshot(duplicateLines)
invalidFp=(await db.query(`select encode(extensions.digest(convert_to($1||':'||$2||':receipt:'||$3::jsonb::text,'UTF8'),'sha256'),'hex') value`,[snapshotHash,op,JSON.stringify(duplicateLines)])).rows[0].value
await assert.rejects(()=>db.query(`select persist_stock_gateway($1,$2,$3,'receipt')`,[c1,op,invalidFp]),/stock_snapshot_line_identity_duplicate/)
snapshotHash=await installSnapshot(stockLines)
const committed=await Promise.allSettled([1,2].map(()=>db.query(`select persist_stock_gateway($1,$2,$3,'receipt') result`,[c1,op,fp])))
if (committed.every(x=>x.status==='rejected')) throw committed[0].reason
assert.equal(committed.filter(x=>x.status==='fulfilled').length,2)
assert.deepEqual(committed.map(x=>x.value.rows[0].result.mode).sort(),['committed','replay'])
assert.equal(Number((await db.query(`select quantity from inventory_movements where inventory_item_id=$1`,[inv])).rows[0].quantity),4)
assert.equal((await db.query(`select receipt_state,balance_before,balance_after from stock_gateway_movement_links`)).rows[0].receipt_state,'partial')
assert.equal((await db.query(`select state from document_flow_items where id=$1`,[f])).rows[0].state,'posted')
const flowEvent=(await db.query(`select from_flow,from_state,from_room,to_flow,to_state,to_room,payload from document_flow_events where event_type='stock_posted' and item_id=$1`,[f])).rows[0]
assert.deepEqual([flowEvent.from_flow,flowEvent.from_state,flowEvent.from_room],['posting','posting','posting_partial_targets'])
assert.deepEqual([flowEvent.to_flow,flowEvent.to_state,flowEvent.to_room],['completed','posted','completed_archive'])
assert.deepEqual(flowEvent.payload.aggregate_projection,{flow:'completed',state:'posted',room:'completed_archive'})
await assert.rejects(()=>db.query(`select persist_stock_gateway($1,$2,'different','receipt')`,[c1,op]),/stock_idempotency_conflict/)
assert.equal((await db.query(`select count(*)::int n from stock_gateway_events e join stock_gateway_executions x on x.id=e.execution_id where e.event_type='committed' and x.posting_operation_id=$1`,[op])).rows[0].n,1)

// Fresh approved operation exercises over-receipt and rollback with no movement side effect.
await db.exec(`update posting_operations set status='reserved',gateway_reference=null where id='${op}'; delete from stock_gateway_events; delete from stock_gateway_movement_links; delete from stock_gateway_executions; delete from inventory_movements; delete from posting_operation_events where operation_id='${op}'; delete from document_flow_events where event_type='stock_posted'; update document_flow_items set current_flow='posting',state='approved_waiting_gateway',current_room='posting_gateway_queue' where id='${f}'; update posting_target_results set status='pending',gateway_reference=null,posted_at=null where target='stock'`)
stockLines[0].quantity=11; stockLines[0].lineValue=1100
snapshotHash=await installSnapshot(stockLines)
const fpOver=(await db.query(`select encode(extensions.digest(convert_to($1||':'||$2||':receipt:'||$3::jsonb::text,'UTF8'),'sha256'),'hex') value`,[snapshotHash,op,JSON.stringify(stockLines)])).rows[0].value
await assert.rejects(()=>db.query(`select persist_stock_gateway($1,$2,$3,'receipt')`,[c1,op,fpOver]),/stock_receipt_exceeds_ordered_quantity/)
assert.equal((await db.query(`select count(*)::int n from inventory_movements`)).rows[0].n,0)
assert.equal((await db.query(`select count(*)::int n from stock_gateway_executions`)).rows[0].n,0)

// Legacy approval without canonical Stock evidence fails closed.
await db.exec(`update posting_approval_snapshots set snapshot=snapshot-'stockLines'`)
await assert.rejects(()=>db.query(`select persist_stock_gateway($1,$2,$3,'receipt')`,[c1,op,fp]),/stock_canonical_snapshot_missing_reapproval_required/)

// Issue and adjustment both recheck the locked live balance and roll back on negative stock.
stockLines[0]={...stockLines[0],quantity:1,lineValue:100,movementKind:'issue',orderedQuantity:undefined,previouslyReceivedQuantity:undefined}
snapshotHash=await installSnapshot(stockLines)
const fpIssue=(await db.query(`select encode(extensions.digest(convert_to($1||':'||$2||':issue:'||$3::jsonb::text,'UTF8'),'sha256'),'hex') value`,[snapshotHash,op,JSON.stringify(stockLines)])).rows[0].value
await assert.rejects(()=>db.query(`select persist_stock_gateway($1,$2,$3,'issue')`,[c1,op,fpIssue]),/stock_insufficient_balance/)
stockLines[0]={...stockLines[0],quantity:-1,movementKind:'adjustment',reason:'cycle count'}
snapshotHash=await installSnapshot(stockLines)
const fpAdjustment=(await db.query(`select encode(extensions.digest(convert_to($1||':'||$2||':adjustment:'||$3::jsonb::text,'UTF8'),'sha256'),'hex') value`,[snapshotHash,op,JSON.stringify(stockLines)])).rows[0].value
await assert.rejects(()=>db.query(`select persist_stock_gateway($1,$2,$3,'adjustment')`,[c1,op,fpAdjustment]),/stock_adjustment_would_make_balance_negative/)
assert.equal((await db.query(`select count(*)::int n from inventory_movements`)).rows[0].n,0)
console.log('Stock PostgreSQL runtime: tenant scope, concurrency/replay, partial receipt, overreceipt, insufficient issue/adjustment rollback, audit/projection and legacy fail-closed passed')
