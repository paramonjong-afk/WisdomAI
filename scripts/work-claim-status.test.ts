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
  false,
  "stale heartbeat is inactive",
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
  workerClaimLabel({ ...base, worker_id: null }, { doing: "กำลังทำ" }, now),
  "หยุดผิดปกติ — ไม่มี Active Claim",
);
console.log("Work claim status fake-clock boundaries passed");
