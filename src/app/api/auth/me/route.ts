import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getFirebaseAuth } from "@/lib/firebase-admin";
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
    reason?: string;
    requiresSubscription: boolean;
    isAdmin: boolean;
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
    
    // Compute access
    const access = computeAccess(email, org, member, REQUIRE_SUBSCRIPTION);
    
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

function computeAccess(
  email: string,
  org: Organization | null,
  member: OrgMember | null,
  requireSubscription: boolean
): MeResponse["access"] {
  const isAdmin = member?.role === "admin";
  
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
    // Check if user's domain matches any org
    const domain = getEmailDomain(email);
    
    if (isPersonalDomain(email)) {
      return {
        allowed: false,
        reason: "Personal email domains are not allowed. Please use your corporate email.",
        requiresSubscription: true,
        isAdmin: false,
      };
    }
    
    return {
      allowed: false,
      reason: "no_organization",
      requiresSubscription: true,
      isAdmin: false,
    };
  }
  
  // Member status check
  if (member.status === "inactive") {
    return {
      allowed: false,
      reason: "Your account has been deactivated. Contact your administrator.",
      requiresSubscription: true,
      isAdmin,
    };
  }
  
  if (member.status === "pending") {
    return {
      allowed: false,
      reason: "Your account is pending approval. Contact your administrator.",
      requiresSubscription: true,
      isAdmin,
    };
  }
  
  // Subscription check
  const activeStatuses = ["active", "trialing"];
  if (!activeStatuses.includes(org.subscriptionStatus)) {
    return {
      allowed: false,
      reason: isAdmin ? "subscription_required" : "Subscription inactive. Contact your administrator.",
      requiresSubscription: true,
      isAdmin,
    };
  }
  
  // Seat limit check
  if (org.activeSeatCount > org.seatLimit) {
    return {
      allowed: false,
      reason: isAdmin 
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
