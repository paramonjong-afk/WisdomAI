import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildAccountingApTransactionKey,
  evaluateAccountingApGateway,
  type AccountingApGatewayCommand,
} from '../src/services/accountingApGatewayContract.ts'

const operation = {
  operationId: 'operation-accounting',
  postingType: 'accounting' as const,
  idempotencyKey: 'posting-v1:company-1:intake-1:document-1:accounting',
  status: 'reserved' as const,
  companyId: 'company-1',
  intakeId: 'intake-1',
  documentId: 'document-1',
  documentVersion: 4,
  approvalEventKey: 'approval:event:1',
  approvalSnapshotHash: 'sha256:snapshot-1',
}

const command: AccountingApGatewayCommand = {
  contractVersion: '1',
  commandFingerprint: 'sha256:accounting-ap-command-1',
  accountingOperation: operation,
  apOperation: { ...operation, operationId: 'operation-ap', postingType: 'ap', idempotencyKey: 'posting-v1:company-1:intake-1:document-1:ap' },
  documentNumber: 'INV-001',
  documentDate: '2026-09-01',
  dueDate: '2026-09-30',
  currency: 'THB',
  vendorId: 'vendor-1',
  vendorName: 'Vendor One',
  taxableBase: 100,
  inputTax: 7,
  withholdingTax: 3,
  netPayable: 104,
  journal: [
    { lineNumber: 1, accountCode: '5200', accountName: 'Expense', role: 'base_debit', debit: 100, credit: 0, description: 'Invoice base' },
    { lineNumber: 2, accountCode: '1150', accountName: 'Input tax', role: 'input_tax', debit: 7, credit: 0, description: 'Input VAT' },
    { lineNumber: 3, accountCode: '2100', accountName: 'Trade AP', role: 'accounts_payable', debit: 0, credit: 104, description: 'Vendor payable' },
    { lineNumber: 4, accountCode: '2150', accountName: 'Withholding tax payable', role: 'withholding_tax', debit: 0, credit: 3, description: 'Withholding tax' },
  ],
}

const approved = evaluateAccountingApGateway(command)
assert.equal(approved.allowed, true)
assert.equal(approved.mode, 'execute')
assert.equal(approved.plan?.transactionRequired, true)
assert.deepEqual(approved.plan?.writes, ['journal', 'payable', 'input_tax', 'payment_link', 'audit', 'operation_statuses'])
assert.equal(approved.plan?.rollback.beforeCommit, 'rollback_transaction')
assert.equal(approved.plan?.rollback.afterCommit, 'immutable_reversal_required')
assert.match(approved.plan?.paymentLinkKey ?? '', /:payment-link$/)
assert.equal(buildAccountingApTransactionKey(command), approved.plan?.transactionKey)

const committed = {
  transactionKey: approved.plan!.transactionKey,
  commandFingerprint: command.commandFingerprint,
  status: 'committed' as const,
  journalReference: 'journal-1', payableReference: 'payable-1', paymentLinkReference: 'payment-link-1',
}
assert.equal(evaluateAccountingApGateway(command, committed).mode, 'replay')
assert.equal(evaluateAccountingApGateway(command, { ...committed, status: 'unknown' }).mode, 'lookup')
assert.equal(evaluateAccountingApGateway(command, { ...committed, commandFingerprint: 'sha256:different' }).reason, 'accounting_ap_idempotency_conflict')

assert.equal(evaluateAccountingApGateway({ ...command, dueDate: '2026-08-31' }).reason, 'accounting_ap_due_date_invalid')
assert.equal(evaluateAccountingApGateway({ ...command, netPayable: 105 }).reason, 'accounting_ap_document_amounts_do_not_reconcile')
assert.equal(evaluateAccountingApGateway({ ...command, journal: command.journal.map((line) => line.role === 'accounts_payable' ? { ...line, credit: 105 } : line) }).reason, 'accounting_ap_journal_unbalanced')
assert.equal(evaluateAccountingApGateway({ ...command, journal: command.journal.map((line) => line.role === 'input_tax' ? { ...line, role: 'base_debit' as const } : line) }).reason, 'accounting_ap_journal_ap_tax_do_not_reconcile')
assert.equal(evaluateAccountingApGateway({ ...command, apOperation: { ...command.apOperation, companyId: 'company-2' } }).reason, 'accounting_ap_operation_scope_mismatch')
assert.equal(evaluateAccountingApGateway({ ...command, apOperation: { ...command.apOperation, status: 'posted' as never } }).reason, 'accounting_ap_operation_not_executable')

const flow = readFileSync('docs/POSTING_APPROVAL_TRANSACTION_CONTRACT.md', 'utf8')
for (const token of ['Accounting/AP gateway command', 'payment link', 'lookup-before-retry', 'immutable reversal', 'v3.0']) assert.match(flow, new RegExp(token, 'i'))

const migration = readFileSync('supabase/migrations/202609170001_accounting_ap_gateway_persistence.sql', 'utf8')
for (const table of ['accounting_ap_transactions','accounting_ap_journal_lines','ap_obligations','ap_payment_links','accounting_ap_events']) assert.match(migration,new RegExp(`create table if not exists public\\.${table}`))
assert.match(migration,/coalesce\(auth\.role\(\),''\)<>'service_role'/)
assert.match(migration,/revoke all on function public\.persist_accounting_ap_gateway[\s\S]*from public,anon,authenticated/)
assert.match(migration,/grant execute on function public\.persist_accounting_ap_gateway[\s\S]*to service_role/)
assert.match(migration,/accounting_op\.document_id is distinct from ap_op\.document_id/)
assert.match(migration,/foreign key\(accounting_operation_id,company_id\) references public\.posting_operations\(id,company_id\)/)
const postingOperationParentKey=migration.indexOf('create unique index if not exists posting_operations_id_company_uniq on public.posting_operations(id,company_id)')
const postingOperationDependentFk=migration.indexOf('foreign key(accounting_operation_id,company_id) references public.posting_operations(id,company_id)')
assert.ok(postingOperationParentKey>=0 && postingOperationParentKey<postingOperationDependentFk,'Production-missing Posting composite parent key must be installed before dependent FKs')
assert.match(migration,/foreign key\(transaction_id,company_id\) references public\.accounting_ap_transactions\(id,company_id\)/)
assert.match(migration,/foreign key\(obligation_id,company_id\) references public\.ap_obligations\(id,company_id\)/)
assert.match(migration,/flow_item\.state<>'approved_waiting_gateway'/)
assert.match(migration,/new\.event_type<>'approve'/)
assert.match(migration,/accounting_ap_idempotency_conflict/)
assert.match(migration,/update public\.posting_operations set status='posted'/)
assert.match(migration,/update public\.document_flow_items set state='posted'/)
assert.match(migration,/update public\.accounting_documents set posting_status='posted'/)
assert.match(migration,/accounting_ap_posted/)
assert.match(migration,/accounting_ap_open_period_required/)
assert.match(migration,/array_agg\(distinct operation\.posting_type/)
assert.match(migration,/extensions\.digest\(convert_to\(canonical::text,'UTF8'\),'sha256'\)/)
assert.match(migration,/flow_item\.current_flow,projected\.current_flow,flow_item\.state,projected\.state/)
assert.match(migration,/create or replace function public\.approve_posting_bundle/)
assert.match(migration,/posting_approval_preexisting_operations_refused/)
assert.match(migration,/grant execute on function public\.approve_posting_bundle\(uuid,integer,text,text\) to authenticated/)
assert.match(migration,/line\.item_type='stock'[\s\S]*array_append\(targets,'stock'\)/)
assert.match(migration,/doc\.document_type='quotation'[\s\S]*quotation_owned_by_quotation_decision_workflow/)
for (const type of ['invoice','billing_note','receipt','cash_receipt','tax_invoice_full','tax_invoice_abbreviated','invoice_tax_invoice','receipt_tax_invoice','receipt_tax_invoice_abbreviated']) assert.match(migration,new RegExp(`'${type}'`))
assert.match(migration,/doc\.document_type not in \([\s\S]*posting_document_type_not_supported/)
assert.ok(!/doc\.document_type='quotation'[\s\S]{0,200}array_append\(targets,'purchase_order'\)/.test(migration))
const gateway = readFileSync('src/services/documentFlowGateway.ts','utf8')
assert.match(gateway,/if \(input\.action === 'approve'\)[\s\S]*approve_posting_bundle/)
assert.ok(!gateway.includes('target_approved_targets'))
assert.ok(!/grant (insert|update|delete).*authenticated/i.test(migration))

console.log('Accounting/AP gateway command contract checks passed')
