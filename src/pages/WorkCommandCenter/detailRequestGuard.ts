export function shouldApplyDetailResponse(
  requestId: number,
  activeRequestId: number,
): boolean {
  return requestId === activeRequestId;
}
