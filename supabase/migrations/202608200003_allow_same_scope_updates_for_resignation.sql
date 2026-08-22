-- Allow updates to an existing row when its company/profile scope is unchanged.
-- New rows and cross-company changes remain subject to the original boundary checks.
do $$
declare
  definition text;
  needle text:='    elsif not exists(';
  position integer;
begin
  select pg_get_functiondef(p.oid) into definition
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='enforce_company_reference_boundary'
  order by p.oid desc limit 1;
  position:=strpos(definition,needle);
  if position=0 then raise exception 'boundary trigger profile check not found'; end if;
  definition:=left(definition,position-1)
    ||'    elsif not (tg_op = ''UPDATE'' and old.company_id = new.company_id and old.profile_id = new.profile_id) and not exists('
    ||substr(definition,position+length(needle));
  execute definition;
end $$;
