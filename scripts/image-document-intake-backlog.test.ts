import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/202608160019_image_document_intake_storage_backlog.sql", "utf8");
const documentation = readFileSync("docs/IMAGE_DOCUMENT_INTAKE_BACKLOG.md", "utf8");

for (let index = 1; index <= 15; index += 1) {
  const key = `DOC-INGEST-${String(index).padStart(3, "0")}`;
  assert.match(migration, new RegExp(key), `${key} must be persisted in the work list migration`);
  assert.match(documentation, new RegExp(key), `${key} must have durable documentation`);
}

for (const required of [
  "เกณฑ์ตรวจรับ",
  "magic bytes",
  "Chain of Custody",
  "expected page count",
  "Retention",
  "OCR Confidence",
  "Local-first",
  "Stock",
  "PDF",
  "Dead-letter",
]) {
  assert.ok(documentation.includes(required), `documentation must retain detail: ${required}`);
}

assert.match(migration, /on conflict\(work_key\) do update/);
assert.match(migration, /current_step=coalesce/);

console.log("image/document intake backlog persistence: ok");
