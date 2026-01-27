import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getFirebaseAuth } from "@/lib/firebase-admin";
import { getMemberByUid, getOrganization } from "@/lib/firestore";
import { createBillingPortalSession } from "@/lib/b2b-stripe";

const SESSION_COOKIE_NAME = "rv_session";

type PortalBody = {
  returnUrl?: string;
};

/**
 * POST /api/billing/portal
 * Create a Stripe Billing Portal session for the organization
 */
export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    
    if (!sessionCookie) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    
    const auth = getFirebaseAuth();
    const decodedClaims = await auth.verifySessionCookie(sessionCookie, true);
    const uid = decodedClaims.uid;
    
    // Verify user is admin
    const member = await getMemberByUid(uid);
    
    if (!member) {
      return NextResponse.json(
        { error: "Not a member of any organization" },
        { status: 403 }
      );
    }
    
    if (member.role !== "admin") {
      return NextResponse.json(
        { error: "Only organization admins can access billing portal" },
        { status: 403 }
      );
    }
    
    // Get organization
    const org = await getOrganization(member.orgId);
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }
    
    if (!org.stripeCustomerId) {
      return NextResponse.json(
        { error: "No billing account found. Please subscribe first." },
        { status: 400 }
      );
    }
    
    const body = (await req.json().catch(() => null)) as PortalBody | null;
    const returnUrl = body?.returnUrl || "/";
    
    // Create portal session
    const result = await createBillingPortalSession({
      stripeCustomerId: org.stripeCustomerId,
      returnUrl,
    });
    
    return NextResponse.json({ url: result.url });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to create portal session";
    
    if (message.includes("session") || message.includes("token")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    
    console.error("[API /api/billing/portal] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
