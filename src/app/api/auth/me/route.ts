import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getFirebaseAuth } from "@/lib/firebase-admin";
import { isDevBypassDomainGatingEnabled } from "@/lib/dev-flags";
import {
  getMemberByUid,
  getMemberByEmail,
  getOrganization,
  getOrganizationByDomain,
  getEmailDomain,
  isPersonalDomain,
  type Organization,
  type OrgMember,
} from "@/lib/firestore";

const SESSION_COOKIE_NAME = "rv_session";

// Feature flag for subscription requirement
const REQUIRE_SUBSCRIPTION = process.env.REQUIRE_SUBSCRIPTION !== "false";

export type MeResponse = {
  id: string;
  email: string;
  // Organization info
  organization: {
    id: string;
    name: string;
    subscriptionStatus: string;
    seatLimit: number;
    activeSeatCount: number;
  } | null;
  // Membership info
  membership: {
    role: "admin" | "member";
    status: "active" | "inactive" | "pending";
  } | null;
  // Access status
  access: {
    allowed: boolean;
    /**
     * Stable reason code for UI gating.
     * Avoid using free-form messages for control-flow.
     */
    reason?:
      | "blocked_domain"
      | "no_organization"
      | "subscription_required"
      | "seat_limit_exceeded"
      | "inactive"
      | "pending"
      | "unknown";
    /** User-facing message (optional). */
    message?: string;
    /** True if subscription gating is enabled in this environment. */
    requiresSubscription: boolean;
    /** Member is admin of the org (if member exists). */
    isAdmin: boolean;
    /** When no org exists, whether the user can create one. */
    canCreateOrg?: boolean;
    /** Suggested default domain for org creation. */
    defaultDomain?: string;
  };
};

export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    
    if (!sessionCookie) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    
    const auth = getFirebaseAuth();
    let decodedClaims;
    
    try {
      decodedClaims = await auth.verifySessionCookie(sessionCookie, true);
    } catch {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    
    const uid = decodedClaims.uid;
    const email = decodedClaims.email || "";
    
    // Get membership
    let member: OrgMember | null = await getMemberByUid(uid);
    
    // If no member by UID, try by email (for pending members)
    if (!member && email) {
      const memberByEmail = await getMemberByEmail(email);
      if (memberByEmail && memberByEmail.status === "pending") {
        // Update the pending member with actual UID
        // This happens when admin invited them before they signed up
        member = memberByEmail;
      }
    }
    
    let org: Organization | null = null;
    
    if (member) {
      org = await getOrganization(member.orgId);
    }
    
    // DEV ONLY: bypass corporate-domain gating for local testing.
    // Server-side authoritative; impossible to enable in prod (see isDevBypassDomainGatingEnabled).
    const bypassDomainGating = isDevBypassDomainGatingEnabled();

    // Compute access
    const access = computeAccess(email, org, member, REQUIRE_SUBSCRIPTION, bypassDomainGating);
    
    const response: MeResponse = {
      id: uid,
      email,
      organization: org ? {
        id: org.id,
        name: org.name,
        subscriptionStatus: org.subscriptionStatus,
        seatLimit: org.seatLimit,
        activeSeatCount: org.activeSeatCount,
      } : null,
      membership: member ? {
        role: member.role,
        status: member.status,
      } : null,
      access,
    };
    
    return NextResponse.json(response);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to get user";
    
    if (message.includes("session") || message.includes("token")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    
    console.error("[API /api/auth/me] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function computeAccess(
  email: string,
  org: Organization | null,
  member: OrgMember | null,
  requireSubscription: boolean,
  bypassDomainGating: boolean
): Promise<MeResponse["access"]> {
  const isAdmin = member?.role === "admin";
  const domain = getEmailDomain(email);

  // If subscription not required (dev mode), allow access
  if (!requireSubscription) {
    return {
      allowed: true,
      requiresSubscription: false,
      isAdmin,
    };
  }

  // No organization membership
  if (!org || !member) {
    // Production behavior: block personal domains at the server.
    // DEV ONLY: when bypassDomainGating is enabled, allow personal domains through
    // so local dev can still reach org setup flows.
    if (!bypassDomainGating && isPersonalDomain(email)) {
      return {
        allowed: false,
        reason: "blocked_domain",
        message: "Personal email domains are not allowed. Please use your corporate email.",
        requiresSubscription: true,
        isAdmin: false,
      };
    }

    // Determine if an org already exists for this domain.
    // - If org exists, user should contact admin (cannot create)
    // - If no org exists, user can create org
    const existingOrgForDomain = domain ? await getOrganizationByDomain(domain) : null;

    return {
      allowed: false,
      reason: "no_organization",
      message: existingOrgForDomain
        ? "An organization exists for your email domain, but you are not a member. Please contact your administrator."
        : "No organization found for your email domain.",
      requiresSubscription: true,
      isAdmin: false,
      canCreateOrg: !existingOrgForDomain,
      defaultDomain: domain || undefined,
    };
  }

  // Member status check
  if (member.status === "inactive") {
    return {
      allowed: false,
      reason: "inactive",
      message: "Your account has been deactivated. Contact your administrator.",
      requiresSubscription: true,
      isAdmin,
    };
  }

  if (member.status === "pending") {
    return {
      allowed: false,
      reason: "pending",
      message: "Your account is pending approval. Contact your administrator.",
      requiresSubscription: true,
      isAdmin,
    };
  }

  // Subscription check
  const activeStatuses = ["active", "trialing"];
  if (!activeStatuses.includes(org.subscriptionStatus)) {
    return {
      allowed: false,
      reason: "subscription_required",
      message: isAdmin
        ? "subscription_required"
        : "Subscription inactive. Contact your administrator.",
      requiresSubscription: true,
      isAdmin,
    };
  }

  // Seat limit check
  if (org.activeSeatCount > org.seatLimit) {
    return {
      allowed: false,
      reason: "seat_limit_exceeded",
      message: isAdmin
        ? "seat_limit_exceeded"
        : "Seat limit reached. Contact your administrator to add seats.",
      requiresSubscription: true,
      isAdmin,
    };
  }

  // All checks passed
  return {
    allowed: true,
    requiresSubscription: true,
    isAdmin,
  };
}
