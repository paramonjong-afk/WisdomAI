import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildStockTransactionKey, evaluateStockGateway, type StockGatewayCommand } from '../src/services/stockGatewayContract.ts'

const operation = {
  operationId: 'operation-stock', postingType: 'stock' as const,
  idempotencyKey: 'posting-v1:company-1:intake-1:document-1:stock', status: 'reserved' as const,
  companyId: 'company-1', intakeId: 'intake-1', documentId: 'document-1', documentVersion: 2,
  approvalEventKey: 'approval:event:1', approvalSnapshotHash: 'sha256:snapshot-1',
}
const receipt: StockGatewayCommand = {
  contractVersion: '1', commandFingerprint: 'sha256:stock-command-1', operation,
  movementKind: 'receipt', documentNumber: 'GR-001', occurredAt: '2026-09-17T08:00:00Z', totalValue: 250,
  lines: [{ lineNumber: 1, sourceLineId: 'po-line-1', inventoryItemId: 'item-1', unit: 'PCS', masterUnit: 'pcs',
    locationId: 'warehouse-1', projectId: 'project-1', quantity: 2.5, unitCost: 100, lineValue: 250,
    balanceBefore: 5, orderedQuantity: 10, previouslyReceivedQuantity: 4 }],
}
const context = {
  approvedOperation: operation,
  commandFingerprint: receipt.commandFingerprint,
  lines: [{ sourceLineId: 'po-line-1', companyId: 'company-1', inventoryItemId: 'item-1', itemActive: true,
    masterUnit: 'pcs', locationId: 'warehouse-1', locationCompanyId: 'company-1', locationActive: true,
    projectId: 'project-1', projectCompanyId: 'company-1', projectActive: true, balance: 5,
    orderedQuantity: 10, previouslyReceivedQuantity: 4 }],
}

const approved = evaluateStockGateway(receipt, context)
assert.equal(approved.allowed, true)
assert.equal(approved.mode, 'execute')
assert.equal(approved.plan?.transactionRequired, true)
assert.equal(approved.plan?.lines[0]?.receiptState, 'partial')
assert.equal(approved.plan?.lines[0]?.balanceAfter, 7.5)
assert.equal(approved.plan?.lines[0]?.quantityDelta, 2.5)
assert.deepEqual(approved.plan?.writes, ['inventory_movements', 'stock_balance_projection', 'audit', 'operation_status'])

const complete = evaluateStockGateway({ ...receipt, lines: [{ ...receipt.lines[0], quantity: 6, lineValue: 600 }], totalValue: 600 }, context)
assert.equal(complete.plan?.lines[0]?.receiptState, 'complete')
assert.equal(evaluateStockGateway({ ...receipt, lines: [{ ...receipt.lines[0], quantity: 7, lineValue: 700 }], totalValue: 700 }, context).reason,
  'stock_receipt_exceeds_ordered_quantity')
assert.equal(evaluateStockGateway({ ...receipt, lines: [{ ...receipt.lines[0], masterUnit: 'kg' }] }, context).reason, 'stock_unit_mismatch')
assert.equal(evaluateStockGateway({ ...receipt, lines: [{ ...receipt.lines[0], projectId: '' }] }, context).reason, 'stock_line_identity_required')
assert.equal(evaluateStockGateway({ ...receipt, lines: [{ ...receipt.lines[0], locationId: '' }] }, context).reason, 'stock_line_identity_required')
assert.equal(evaluateStockGateway({ ...receipt, totalValue: 249 }, context).reason, 'stock_total_value_does_not_reconcile')
assert.equal(evaluateStockGateway({ ...receipt, lines: [{ ...receipt.lines[0], lineValue: 249 }] }, context).reason,
  'stock_line_value_does_not_reconcile')
assert.equal(evaluateStockGateway(receipt, { ...context, commandFingerprint: 'sha256:other' }).reason, 'stock_approved_operation_mismatch')
assert.equal(evaluateStockGateway(receipt, { ...context, lines: [{ ...context.lines[0], locationCompanyId: 'company-2' }] }).reason,
  'stock_authoritative_scope_mismatch')
assert.equal(evaluateStockGateway(receipt, { ...context, lines: [{ ...context.lines[0], balance: 4 }] }).reason, 'stock_balance_stale')
assert.equal(evaluateStockGateway(receipt, { ...context, lines: [{ ...context.lines[0], previouslyReceivedQuantity: 3 }] }).reason,
  'stock_receipt_context_stale')
assert.equal(evaluateStockGateway({ ...receipt, operation: { ...operation, documentVersion: Number.NaN } }, context).reason,
  'stock_identity_required')

const issue: StockGatewayCommand = { ...receipt, commandFingerprint: 'sha256:issue', movementKind: 'issue', totalValue: 300,
  lines: [{ ...receipt.lines[0], quantity: 3, lineValue: 300, balanceBefore: 3, orderedQuantity: undefined, previouslyReceivedQuantity: undefined }] }
const issueContext = { ...context, commandFingerprint: issue.commandFingerprint,
  lines: [{ ...context.lines[0], balance: 3 }] }
assert.equal(evaluateStockGateway(issue, issueContext).plan?.lines[0]?.quantityDelta, -3)
assert.equal(evaluateStockGateway({ ...issue, lines: [{ ...issue.lines[0], quantity: 3.001, lineValue: 300.1 }] }, issueContext).reason,
  'stock_insufficient_balance')

const adjustment: StockGatewayCommand = { ...issue, commandFingerprint: 'sha256:adjust', movementKind: 'adjustment', totalValue: 100,
  lines: [{ ...issue.lines[0], quantity: -1, lineValue: 100, balanceBefore: 3, reason: 'cycle count correction' }] }
const adjustmentContext = { ...context, commandFingerprint: adjustment.commandFingerprint,
  lines: [{ ...context.lines[0], balance: 3 }] }
assert.equal(evaluateStockGateway(adjustment, adjustmentContext).plan?.lines[0]?.balanceAfter, 2)
assert.equal(evaluateStockGateway({ ...adjustment, lines: [{ ...adjustment.lines[0], reason: '' }] }, adjustmentContext).reason,
  'stock_adjustment_reason_required')
assert.equal(evaluateStockGateway({ ...adjustment, lines: [{ ...adjustment.lines[0], quantity: -4, lineValue: 400 }] , totalValue: 400 }, adjustmentContext).reason,
  'stock_adjustment_would_make_balance_negative')

const committed = { transactionKey: buildStockTransactionKey(receipt), commandFingerprint: receipt.commandFingerprint,
  status: 'committed' as const, movementReferences: ['movement-1'] }
assert.equal(evaluateStockGateway(receipt, context, committed).mode, 'replay')
assert.equal(evaluateStockGateway(receipt, context, { ...committed, status: 'unknown' }).mode, 'lookup')
assert.equal(evaluateStockGateway(receipt, context, { ...committed, status: 'reversed' }).reason, 'stock_execution_already_reversed')
assert.equal(evaluateStockGateway(receipt, context, { ...committed, commandFingerprint: 'sha256:different' }).reason, 'stock_idempotency_conflict')

const flow = readFileSync('docs/POSTING_APPROVAL_TRANSACTION_CONTRACT.md', 'utf8')
for (const token of ['Stock gateway command', 'partial receipt', 'over-receipt', 'warehouse', 'immutable adjustment', 'v4.0']) {
  assert.match(flow, new RegExp(token, 'i'))
}
const migration = readFileSync('supabase/migrations/202609170002_stock_gateway_persistence.sql','utf8')
assert.match(migration,/auth\.role\(\)<>'service_role'/)
assert.match(migration,/revoke insert,update,delete on public\.inventory_item_company_scopes,public\.stock_gateway_executions,public\.stock_gateway_movement_links,public\.stock_gateway_events from public,anon,authenticated/)
assert.match(migration,/stock_canonical_snapshot_missing_reapproval_required/)
assert.match(migration,/stock_insufficient_balance/)
assert.match(migration,/POSTING-008 immutable reversal/)
assert.match(migration,/capture_stock_lines_in_approval_snapshot_trigger/)
assert.match(migration,/posting_approval_snapshot_immutable/)
assert.match(migration,/stock_approval_snapshot_hash_mismatch/)
assert.match(migration,/join public\.stock_gateway_executions prior[\s\S]*prior\.movement_kind='receipt'/)
assert.match(migration,/stock_line_value_invalid/)
assert.match(migration,/stock_command_total_invalid/)
assert.match(migration,/stock_snapshot_line_identity_duplicate/)
assert.match(migration,/foreign key\(posting_operation_id,company_id\)/)
assert.match(migration,/foreign key\(company_id,inventory_item_id\) references public\.inventory_item_company_scopes/)
assert.match(migration,/revoke insert,update,delete on public\.posting_stock_approval_lines from public,anon,authenticated/)
assert.doesNotMatch(migration,/posting_stock_approval_lines for all to authenticated/)
assert.match(migration,/create or replace function public\.prepare_posting_stock_line/)
assert.match(migration,/stock_source_purchase_order_line_link_required/)
assert.match(migration,/to_jsonb\(source\)->>'purchase_order_line_id'/)
assert.match(migration,/stock_source_purchase_order_line_invalid/)
assert.match(migration,/stock_requested_quantity_exceeds_canonical_remaining/)
assert.match(migration,/stock_staging_revision_conflict/)
assert.match(migration,/stock_staging_stale_or_tampered/)
const documentFlowGateway = readFileSync('src/services/documentFlowGateway.ts','utf8')
assert.match(documentFlowGateway,/stockPreparation\?: readonly/)
assert.match(migration,/create or replace function public\.approve_posting_stock_bundle/)
assert.match(migration,/stock_bundle_exact_line_set_required/)
assert.match(migration,/result:=public\.approve_posting_bundle/)
assert.match(documentFlowGateway,/approve_posting_stock_bundle/)
assert.doesNotMatch(documentFlowGateway,/prepare_posting_stock_line/)
assert.doesNotMatch(documentFlowGateway,/expectedRevision/)

console.log('Stock gateway command contract checks passed')
