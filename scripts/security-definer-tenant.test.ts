import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql=readFileSync(resolve("supabase/migrations/202608100004_security_definer_tenant_boundaries.sql"),"utf8");
for(const table of ["company_members","projects","project_sites","boq_documents","boq_items","accounting_documents","inventory_items","contractor_contracts","project_cost_codes","pay_periods"]){
  if(!sql.includes(`public.${table}`)) throw new Error(`missing ${table} tenant guard`);
}
if(!sql.includes("before insert or update")) throw new Error("must protect inserts and updates");
if(!sql.includes("from public,anon,authenticated")) throw new Error("trigger helper must not be callable");
if(!sql.includes("project.company_id=public.current_company_id()")) throw new Error("project assertion is not tenant scoped");
console.log("TEN-008 tenant boundary static checks passed");
