import type { AuthUser } from "@/hooks/use-auth";

export type AccessStatusKind =
  | "loading"
  | "signed_out"
  | "blocked_domain"
  | "no_org"
  | "billing_required"
  | "ready";

export type AccessStatus =
  | { kind: "loading" }
  | { kind: "signed_out" }
  | { kind: "blocked_domain"; message?: string }
  | { kind: "no_org"; canCreateOrg: boolean; defaultDomain?: string; message?: string }
  | { kind: "billing_required"; message?: string }
  | { kind: "ready" };

/**
 * Convert the current auth context state into a stable gating status.
 * Single source of truth for route/page gating.
 */
export function deriveAccessStatus(args: {
  authLoading: boolean;
  user: AuthUser | null;
}): AccessStatus {
  const { authLoading, user } = args;

  if (authLoading) return { kind: "loading" };
  if (!user) return { kind: "signed_out" };

  const accessAllowed = Boolean(user.access?.allowed);
  if (accessAllowed) return { kind: "ready" };

  const reason = user.access?.reason || "unknown";

  switch (reason) {
    case "blocked_domain":
      return { kind: "blocked_domain", message: user.access?.message };
    case "no_organization":
      return {
        kind: "no_org",
        canCreateOrg: Boolean(user.access?.canCreateOrg),
        defaultDomain: user.access?.defaultDomain,
        message: user.access?.message,
      };
    case "subscription_required":
      // Only admins get the paywall UI; non-admins see blocked screen.
      if (user.access?.isAdmin) return { kind: "billing_required", message: user.access?.message };
      return { kind: "blocked_domain", message: user.access?.message };
    default:
      return { kind: "blocked_domain", message: user.access?.message };
  }
}
