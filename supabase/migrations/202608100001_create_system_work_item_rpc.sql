create sequence if not exists public.system_work_item_command_seq;
revoke all on sequence public.system_work_item_command_seq from public, anon, authenticated;

create or replace function public.create_system_work_item(target_title text,target_detail text default null,target_category text default 'operations',target_risk text default 'medium',target_company_id uuid default null)
returns public.system_work_items language plpgsql security definer set search_path=public as $$
declare actor public.profiles; result public.system_work_items; generated_key text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  select * into actor from public.profiles where id=auth.uid();
  if actor.id is null then raise exception 'profile_not_found'; end if;
  if length(trim(coalesce(target_title,'')))<3 then raise exception 'title_too_short'; end if;
  if target_category not in ('automation','line','report','audit','tenant','operations') then raise exception 'invalid_category'; end if;
  if target_risk not in ('low','medium','high','critical') then raise exception 'invalid_risk'; end if;
  if target_company_id is null then
    if actor.role<>'admin' then raise exception 'platform_admin_required'; end if;
  elsif not public.is_company_manager(target_company_id) and actor.role<>'admin' then raise exception 'company_manager_required'; end if;
  generated_key:='CMD-'||to_char(current_date,'YYYYMMDD')||'-'||lpad(nextval('public.system_work_item_command_seq')::text,6,'0');
  insert into public.system_work_items(work_key,company_id,scope,title,category,status,progress,risk,detail,production_status,owner,updated_by)
  values(generated_key,target_company_id,case when target_company_id is null then 'platform' else 'company' end,trim(target_title),target_category,'ready',0,target_risk,nullif(trim(coalesce(target_detail,'')),''),'not_deployed',actor.full_name,actor.id)
  returning * into result;
  return result;
end $$;
revoke all on function public.create_system_work_item(text,text,text,text,uuid) from public,anon;
grant execute on function public.create_system_work_item(text,text,text,text,uuid) to authenticated;
