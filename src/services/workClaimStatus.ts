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
  item.status === "doing" &&
  Boolean(item.worker_id) &&
  Boolean(item.lease_expires_at) &&
  new Date(item.lease_expires_at as string).getTime() > now &&
  Boolean(item.heartbeat_at) &&
  new Date(item.heartbeat_at as string).getTime() >= now - CLAIM_HEARTBEAT_MAX_AGE_MS;

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
  return "หยุดผิดปกติ — ไม่มี Active Claim";
};
