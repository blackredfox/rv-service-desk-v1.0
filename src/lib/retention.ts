/**
 * Retention Logic — single source of truth for case expiration.
 *
 * All retention math lives here. Neither frontend nor backend
 * should reimplement expiry logic.
 *
 * Rules:
 * - Retention window: 30 days from lastActivityAt
 * - expiresAt = lastActivityAt + 30 days
 * - lastActivityAt updates on any message (user or assistant)
 * - Expired cases are hidden from listings and cleaned up by cron
 */

export const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Compute the expiration timestamp from a lastActivityAt date.
 */
export function computeExpiresAt(lastActivityAt: Date | string): Date {
  const base = typeof lastActivityAt === "string" ? new Date(lastActivityAt) : lastActivityAt;
  return new Date(base.getTime() + RETENTION_MS);
}

/**
 * Compute time left in seconds until expiration.
 * Returns 0 if already expired.
 */
export function computeTimeLeftSeconds(expiresAt: Date | string, now?: Date): number {
  const exp = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
  const ref = now ?? new Date();
  const diff = exp.getTime() - ref.getTime();
  return Math.max(0, Math.floor(diff / 1000));
}

/**
 * Format time-left seconds into a compact display string.
 *
 * >= 7 days → "Xd"
 * 1–6 days → "Xd"
 * < 24h    → "Xh"
 * < 60 min → "Xm"
 * expired  → "Expired"
 */
export function formatTimeLeft(seconds: number): string {
  if (seconds <= 0) return "Expired";

  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(seconds / 3600);
  const days = Math.floor(seconds / 86400);

  if (days >= 1) return `${days}d`;
  if (hours >= 1) return `${hours}h`;
  if (minutes >= 1) return `${minutes}m`;
  return "Expired";
}

/**
 * Determine the urgency tier for styling.
 *
 * "normal"  → >= 7 days
 * "warning" → 1–6 days
 * "urgent"  → < 24 hours
 * "expired" → 0
 */
export function getUrgencyTier(seconds: number): "normal" | "warning" | "urgent" | "expired" {
  if (seconds <= 0) return "expired";
  const days = seconds / 86400;
  if (days < 1) return "urgent";
  if (days < 7) return "warning";
  return "normal";
}

/**
 * Check if a case has expired given its lastActivityAt.
 */
export function isExpired(lastActivityAt: Date | string, now?: Date): boolean {
  const expiresAt = computeExpiresAt(lastActivityAt);
  return computeTimeLeftSeconds(expiresAt, now) <= 0;
}
