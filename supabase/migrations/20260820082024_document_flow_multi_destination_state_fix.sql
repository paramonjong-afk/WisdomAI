-- Multi-destination routing is an in-progress posting state.  The original
-- routing RPC already writes this value, but the ledger constraint predates
-- the multi-destination flow and did not permit it.
alter table public.document_flow_items
  drop constraint if exists document_flow_items_state_check;

alter table public.document_flow_items
  add constraint document_flow_items_state_check check (state in (
    'received', 'ai_processing', 'awaiting_classification', 'validating',
    'needs_correction', 'duplicate_hold', 'ready_for_posting',
    'destination_in_progress', 'awaiting_approval',
    'approved_waiting_gateway', 'posting', 'posted', 'rejected', 'failed',
    'dismissed'
  ));

comment on constraint document_flow_items_state_check on public.document_flow_items is
  'Valid central Document Flow states, including active multi-destination work.';

notify pgrst, 'reload schema';
