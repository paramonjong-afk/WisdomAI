import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync("supabase/migrations/202608160025_filter_flow_naming.sql", "utf8");
const docs = readFileSync("docs/FILTER_FLOW_BACKLOG.md", "utf8");

for (let index = 1; index <= 8; index += 1) {
  const key = `FILTER-${String(index).padStart(3, "0")}`;
  assert.ok(docs.includes(key), `${key} missing from durable specification`);
}

for (const term of ["95%", "90%", "ห้องรอบันทึกบัญชี", "idempotent", "duplicate", "reversal", "Intake ID"]) {
  assert.ok(docs.includes(term), `Fitter Flow detail missing: ${term}`);
}

assert.match(sql, /on conflict\(work_key\) do update/);
assert.match(sql, /replace\(work_key,'FITTER-','FILTER-'\)/);
assert.ok(sql.includes("INTAKE-FLOW-001"));
assert.ok(sql.includes("POSTING-FLOW-001"));
for (const oldName of ["FITTER-001", "Fitter Flow"]) {
  assert.ok(!docs.includes(oldName), `obsolete name remains: ${oldName}`);
}

console.log("Filter Flow naming and backlog persistence: ok");
