import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { shouldApplyDetailResponse } from "../src/pages/WorkCommandCenter/detailRequestGuard.ts"

const source = readFileSync("src/pages/WorkCommandCenter/index.tsx", "utf8")

assert.match(source, /const requestId = \+\+detailRequestId\.current/)
assert.match(source, /shouldApplyDetailResponse\(requestId, detailRequestId\.current\)/)
assert.match(source, /const closeDetail = \(\) => \{[\s\S]*detailRequestId\.current \+= 1[\s\S]*setEvents\(\[\]\)/)
assert.match(source, /setDetailError\(userError\(error\)\)/)
assert.match(source, /detailError/)
assert.match(source, /ลองใหม่/)
assert.match(source, /onClick=\{\(\) => void openDetail\(selected\)\}/)
assert.match(source, /onClose=\{closeDetail\}/)
assert.match(source, /else if \(silent\) setNotice\(""\)/)

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function simulateDrawerRequests() {
  let activeRequestId = 0
  let events: string[] = []
  let selected: string | null = null

  const open = async (workKey: string, delay: number) => {
    const requestId = ++activeRequestId
    selected = workKey
    await wait(delay)
    if (!shouldApplyDetailResponse(requestId, activeRequestId)) return
    events = [workKey]
  }

  const first = open("A", 30)
  const second = open("B", 1)
  await Promise.all([first, second])
  assert.equal(selected, "B")
  assert.deepEqual(events, ["B"], "older A response must not overwrite B")

  activeRequestId += 1
  selected = null
  events = []
  await wait(35)
  assert.equal(selected, null)
  assert.deepEqual(events, [], "closed Drawer must discard late responses")

  let failed = true
  const retry = async () => {
    const requestId = ++activeRequestId
    await wait(1)
    if (!shouldApplyDetailResponse(requestId, activeRequestId)) return
    failed = false
  }
  await retry()
  assert.equal(failed, false, "retry must be able to replace a failed detail load")
}

await simulateDrawerRequests()
console.log("work command center drawer regression tests passed")
