import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const source = readFileSync("src/pages/WorkCommandCenter/index.tsx", "utf8")

assert.match(source, /supabase\.functions\.invoke\("health-monitor",\s*\{\s*body:\s*\{ action: "send_work_approval", work_key: selected\.work_key \}/)
assert.match(source, /selected\.status === "review"/)
assert.match(source, /ส่งแจ้งเตือนเฉพาะงานนี้/)
assert.doesNotMatch(source, /send_work_escalations/)
assert.match(source, /rate_limited/)

console.log("work command center targeted notification tests passed")
