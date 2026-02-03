import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getFirebaseAuth } from "@/lib/firebase-admin";
import { getMemberByUid, getOrganization, type Organization } from "@/lib/firestore";

const SESSION_COOKIE_NAME = "rv_session";

/**
 * Debug endpoint to check org seat limit directly from Firestore
 * GET /api/debug/org-seats
 */
export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    
    if (!sessionCookie) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    
    const auth = getFirebaseAuth();
    const decodedClaims = await auth.verifySessionCookie(sessionCookie, true);
    
    const member = await getMemberByUid(decodedClaims.uid);
    
    if (!member) {
      return NextResponse.json({ error: "No member found" }, { status: 404 });
    }
    
    const org = await getOrganization(member.orgId);
    
    if (!org) {
      return NextResponse.json({ error: "No org found" }, { status: 404 });
    }
    
    // Return raw org data for debugging
    return NextResponse.json({
      debug: true,
      timestamp: new Date().toISOString(),
      org: {
        id: org.id,
        name: org.name,
        seatLimit: org.seatLimit,
        activeSeatCount: org.activeSeatCount,
        subscriptionStatus: org.subscriptionStatus,
        stripeCustomerId: org.stripeCustomerId,
        stripeSubscriptionId: org.stripeSubscriptionId,
        currentPeriodEnd: org.currentPeriodEnd,
      },
      member: {
        id: member.id,
        role: member.role,
        status: member.status,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
