-- Use E-strings so PostgreSQL receives a single regex escape, not a literal
-- backslash.  This makes "นาย ทวีชัย" compare as "ทวีชัย".
create or replace function public.normalize_advance_holder_name(value text)
returns text
language sql
immutable
set search_path=public
as $$
  select lower(
    regexp_replace(
      regexp_replace(
        btrim(coalesce(value,'')),
        E'^(นาย|นาง|นางสาว|น\\.ส\\.|บริษัท|บจก\\.?|หจก\\.?)\\s*',
        '',
        'i'
      ),
      E'\\s+',
      '',
      'g'
    )
  )
$$;

do $$
declare source_message uuid;
begin
  for source_message in select distinct source_message_id from public.financial_transactions where source_message_id is not null loop
    perform public.auto_create_safe_employee_advance_from_transfer(source_message);
  end loop;
end;
$$;

revoke all on function public.normalize_advance_holder_name(text) from public,anon,authenticated;
notify pgrst,'reload schema';
