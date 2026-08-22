-- Canonical source attributes belong to the Intake ledger, not to page-specific joins.
alter table public.document_flow_items
  add column if not exists source_channel text not null default 'unknown',
  add column if not exists source_room_id text,
  add column if not exists source_room_name text,
  add column if not exists source_sender_id text,
  add column if not exists source_sender_name text,
  add column if not exists source_received_at timestamptz,
  add column if not exists source_file_kind text not null default 'unknown',
  add column if not exists source_attachment_count integer not null default 0;

update public.document_flow_items item set
  source_channel=case when message.id is not null then 'line' else item.source_channel end, source_room_id=message.line_group_id,
  source_room_name=coalesce(group_row.display_name,case when message.line_group_id is not null then 'กลุ่ม LINE' end),
  source_sender_id=message.line_user_id, source_sender_name=coalesce(sender.display_name,message.line_user_id),
  source_received_at=message.occurred_at,
  source_attachment_count=coalesce((select count(*) from public.line_attachments attachment where attachment.message_id=message.id),0),
  source_file_kind=case when item.review_case_id is not null then 'image_or_scan' when exists(select 1 from public.line_attachments attachment where attachment.message_id=message.id and attachment.content_type='application/pdf') then 'pdf' else 'document' end
from public.line_messages message
left join public.line_groups group_row on group_row.line_group_id=message.line_group_id
left join public.line_senders sender on sender.line_user_id=message.line_user_id
where item.source_message_id=message.id;

create index if not exists document_flow_items_intake_source_filter_idx
  on public.document_flow_items(company_id,source_channel,source_room_id,source_received_at desc);

create or replace function public.document_flow_item_preview(target_item_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'item_id',item.id,'available',exists(select 1 from public.line_attachments attachment where attachment.message_id=item.source_message_id),
    'reason',case when exists(select 1 from public.line_attachments attachment where attachment.message_id=item.source_message_id) then null else 'ไม่พบไฟล์ต้นฉบับที่ผูกกับรายการนี้' end,
    'files',coalesce((select jsonb_agg(jsonb_build_object('bucket',attachment.storage_bucket,'path',attachment.storage_path,'content_type',attachment.content_type,'created_at',attachment.created_at)) from public.line_attachments attachment where attachment.message_id=item.source_message_id),'[]'::jsonb)
  ) from public.document_flow_items item
  where item.id=target_item_id and item.company_id=public.current_company_id()
    and public.can_read_document_flow_item(item.company_id,item.target_department,item.candidate_departments,item.sensitivity);
$$;
revoke all on function public.document_flow_item_preview(uuid) from public,anon;
grant execute on function public.document_flow_item_preview(uuid) to authenticated;
