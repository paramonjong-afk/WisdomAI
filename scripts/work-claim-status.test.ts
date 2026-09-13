import assert from "node:assert/strict";
import {
  CLAIM_HEARTBEAT_MAX_AGE_MS,
  hasActiveWorkerClaim,
  workerClaimLabel,
} from "../src/services/workClaimStatus.ts";

const now = Date.parse("2026-09-07T15:00:00.000Z");
const base = {
  status: "doing",
  worker_id: "worker-1",
  heartbeat_at: new Date(now - CLAIM_HEARTBEAT_MAX_AGE_MS).toISOString(),
  lease_expires_at: new Date(now + 60_000).toISOString(),
};

assert.equal(hasActiveWorkerClaim(base, now), true, "fresh heartbeat boundary is active");
assert.equal(
  hasActiveWorkerClaim(
    { ...base, heartbeat_at: new Date(now - CLAIM_HEARTBEAT_MAX_AGE_MS - 1).toISOString() },
    now,
  ),
  true,
  "a stale heartbeat under an unexpired lease is still active -- the lease is the sole authority (AGENTS.md claim protocol); heartbeat only refreshes when current_step changes, not on a fixed cadence",
);
assert.equal(
  hasActiveWorkerClaim(
    { ...base, heartbeat_at: null },
    now,
  ),
  true,
  "a missing heartbeat under an unexpired lease is still active",
);
assert.equal(
  hasActiveWorkerClaim(
    { ...base, lease_expires_at: new Date(now).toISOString() },
    now,
  ),
  false,
  "lease expiry boundary is inactive",
);
assert.equal(
  workerClaimLabel({ ...base, worker_id: null }, { doing: "กำลังทำ" }, now), "หยุดผิดปกติ - ไม่มี Active Claim");
assert.equal(
  workerClaimLabel(
    { ...base, heartbeat_at: new Date(now - CLAIM_HEARTBEAT_MAX_AGE_MS - 1).toISOString() },
    { doing: "กำลังทำ" },
    now,
  ),
  "กำลังทำจริง",
  "a valid unexpired lease reports as actively working even with a stale heartbeat",
);
assert.equal(
  workerClaimLabel(
    { ...base, lease_expires_at: new Date(now).toISOString() },
    { doing: "กำลังทำ" },
    now,
  ),
  "Worker ขาดการติดต่อ",
  "an expired lease with a worker still attached reports as disconnected",
);
console.log("Work claim status fake-clock boundaries passed");
