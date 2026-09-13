export const CLAIM_HEARTBEAT_MAX_AGE_MS = 10 * 60 * 1000;

export type WorkClaimRecord = {
  status: string;
  worker_id: string | null;
  heartbeat_at: string | null;
  lease_expires_at: string | null;
};

export const hasActiveWorkerClaim = (
  item: WorkClaimRecord,
  now = Date.now(),
) =>
  // Per the repository's claim protocol (AGENTS.md), a claim is active
  // whenever worker_id is set and lease_expires_at has not passed yet --
  // heartbeat_at is only refreshed when current_step changes, not on a
  // fixed cadence, so a stale heartbeat under an unexpired lease (e.g. a
  // two-hour lease with no step change in ten minutes) must not be
  // reported as disconnected. Use hasStaleHeartbeat-style checks
  // separately for a soft "no recent update" signal, never to override
  // this classification.
  item.status === "doing" &&
  Boolean(item.worker_id) &&
  Boolean(item.lease_expires_at) &&
  new Date(item.lease_expires_at as string).getTime() > now;

export const hasExpiredWorkerLease = (
  item: WorkClaimRecord,
  now = Date.now(),
) =>
  item.status === "doing" &&
  Boolean(item.lease_expires_at) &&
  new Date(item.lease_expires_at as string).getTime() <= now;

export const workerClaimLabel = (
  item: WorkClaimRecord,
  statusLabels: Record<string, string>,
  now = Date.now(),
) => {
  if (hasActiveWorkerClaim(item, now)) return "กำลังทำจริง";
  if (item.status !== "doing") return statusLabels[item.status] ?? item.status;
  if (hasExpiredWorkerLease(item, now) || item.worker_id)
    return "Worker ขาดการติดต่อ";
  return "หยุดผิดปกติ - ไม่มี Active Claim";
};
