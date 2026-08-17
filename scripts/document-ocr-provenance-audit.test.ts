import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync("supabase/migrations/202608160023_document_ocr_provenance_audit.sql", "utf8");

for (const token of [
  "width_px", "height_px", "dpi_x", "dpi_y", "orientation_degrees",
  "original_sha256", "optimized_sha256", "perceptual_hash", "quality_score",
  "transform_recipe", "transform_version", "ocr_engine", "ocr_model", "ocr_version",
  "page_confidence", "field_name", "field_path", "confidence", "value_before", "value_after",
  "target_intake_id", "target_document_id", "target_message_id", "target_hash",
]) assert.ok(sql.includes(token), `missing audit contract token: ${token}`);

assert.match(sql, /enable row level security/g);
assert.match(sql, /security invoker/);
assert.match(sql, /revoke insert,update,delete[^;]+from anon,authenticated/g);
assert.match(sql, /where work_key='DOC-INGEST-010'/);
assert.doesNotMatch(sql, /where work_key='DOC-INGEST-(?!010)/);

console.log("document OCR provenance audit contract: ok");
