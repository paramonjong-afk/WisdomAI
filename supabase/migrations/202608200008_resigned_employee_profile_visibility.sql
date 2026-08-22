drop policy if exists "Company profile visibility" on public.profiles;

create policy "Company profile visibility" on public.profiles as restrictive for select to authenticated
using(
  id=auth.uid()
  or exists(
    select 1
    from public.company_members mine
    join public.company_members theirs on theirs.company_id=mine.company_id
    where mine.profile_id=auth.uid()
      and mine.company_id=public.current_company_id()
      and mine.active
      and theirs.profile_id=profiles.id
      and (
        theirs.active
        or public.is_company_manager(mine.company_id)
      )
  )
);
