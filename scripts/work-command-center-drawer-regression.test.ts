import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const source = readFileSync("src/pages/WorkCommandCenter/index.tsx", "utf8")

assert.match(source, /const requestId = \+\+detailRequestId\.current/)
assert.match(source, /if \(requestId !== detailRequestId\.current\) return/)
assert.match(source, /const closeDetail = \(\) => \{[\s\S]*detailRequestId\.current \+= 1[\s\S]*setEvents\(\[\]\)/)
assert.match(source, /setDetailError\(userError\(error\)\)/)
assert.match(source, /detailError/)
assert.match(source, /ลองใหม่/)
assert.match(source, /onClick=\{\(\) => void openDetail\(selected\)\}/)
assert.match(source, /onClose=\{closeDetail\}/)
assert.match(source, /else if \(silent\) setNotice\(""\)/)

console.log("work command center drawer regression tests passed")
