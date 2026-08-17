import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration=readFileSync(resolve("supabase/migrations/202608100005_company_scoped_singleton_settings.sql"),"utf8");
const timeTracking=readFileSync(resolve("src/pages/TimeTracking/index.tsx"),"utf8");
const workforceSetup=readFileSync(resolve("src/pages/WorkforceSetup/index.tsx"),"utf8");

for(const table of ["attendance_system_settings","pay_cycle_settings","workforce_rule_settings"]){
  if(!migration.includes(`alter table public.${table} add primary key(company_id,singleton)`)){
    throw new Error(`${table} does not use a company-scoped singleton key`);
  }
  if(!migration.includes(`insert into public.${table}`)) throw new Error(`${table} is not backfilled`);
}
for(const required of [
  "where company_id=period.company_id and singleton=true",
  "where company_id=period.company_id and employment_status",
  "where company_id=period.company_id and profile_id=employee.profile_id",
  "on public.pay_periods(company_id,starts_on,ends_on)",
  "seed_company_singleton_settings",
]){
  if(!migration.includes(required)) throw new Error(`missing tenant assertion: ${required}`);
}
if(!timeTracking.includes(".eq('company_id', currentCompany?.company_id ?? '')")) throw new Error("TimeTracking settings are not company scoped");
if((workforceSetup.match(/\.eq\('company_id',currentCompany\?\.company_id\?\?''\)/g)??[]).length<4){
  throw new Error("Workforce settings reads and writes are not company scoped");
}
console.log("TEN-006 company settings tenant checks passed");
