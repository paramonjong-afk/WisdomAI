-- Rename only the canonical default tenant. Company identity, slug, members,
-- room ownership and all business records remain attached to the same UUID.
do $$
declare
  target_company public.companies%rowtype;
  previous_name text;
  audit_action text;
begin
  select company.*
  into target_company
  from public.companies company
  where company.slug = 'wisdomai-default'
  for update;

  if target_company.id is null then
    raise exception 'Canonical company wisdomai-default was not found';
  end if;

  if target_company.name not in ('WisdomAI Construction', 'Wisdom Power') then
    raise exception 'Refusing to rename unexpected company name: %', target_company.name;
  end if;

  previous_name := target_company.name;
  if target_company.name = 'Wisdom Power' then
    audit_action := 'company_display_name_rename_noop';
  else
    update public.companies
    set name = 'Wisdom Power', updated_at = now()
    where id = target_company.id;
    audit_action := 'company_display_name_renamed';
  end if;

  insert into public.master_data_audit(
    company_id,
    event_key,
    action,
    before_data,
    after_data,
    reason
  ) values (
    target_company.id,
    'company-brand:wisdomai-default:wisdom-power:v1',
    audit_action,
    jsonb_build_object('name', previous_name, 'slug', target_company.slug),
    jsonb_build_object('name', 'Wisdom Power', 'slug', target_company.slug),
    'Brand Owner confirmed the canonical company display name Wisdom Power on 31/8/2569'
  ) on conflict(event_key) do nothing;
end $$;

-- Recovery (manual, audited): set only companies.name for slug
-- wisdomai-default back to WisdomAI Construction and append a new rollback
-- master_data_audit event. Never change the company UUID or slug.
