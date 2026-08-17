import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration=readFileSync(resolve("supabase/migrations/202608100006_system_work_item_error_fingerprint.sql"),"utf8");
const monitor=readFileSync(resolve("supabase/functions/health-monitor/index.ts"),"utf8");

if(!migration.includes("alter table public.system_work_items")) throw new Error("wrong target table");
if(!migration.includes("add column if not exists error_fingerprint text")) throw new Error("missing fingerprint column");
if(!migration.includes("notify pgrst,'reload schema'")) throw new Error("PostgREST schema cache is not refreshed");
if(!monitor.includes("error_fingerprint: fingerprints.join('|').slice(0, 200) || null")) throw new Error("health monitor does not persist grouped fingerprints");
if(!monitor.includes(".eq('work_key', 'SYS-004')")) throw new Error("health monitor may create duplicate work items");
console.log("SYS-004 error fingerprint schema checks passed");
