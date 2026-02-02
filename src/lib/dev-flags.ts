/**
 * DEV ONLY: bypass corporate domain gating for local testing.
 *
 * This must be impossible to enable in production even if the env var is accidentally set.
 */
export function isDevBypassDomainGatingEnabled(): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  return process.env.RVSD_DEV_BYPASS_DOMAIN_GATING === "1";
}

/**
 * Optional client-side hint (UX only).
 *
 * IMPORTANT: do NOT use this for security decisions.
 */
export function isClientDevBypassDomainGatingHintEnabled(): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  return process.env.NEXT_PUBLIC_DEV_BYPASS_DOMAIN_GATING === "1";
}
