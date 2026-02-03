import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getFirebaseAuth } from "@/lib/firebase-admin";
import { getMemberByUid, getOrganization } from "@/lib/firestore";
import { createSeatCheckoutSession } from "@/lib/b2b-stripe";

const SESSION_COOKIE_NAME = "rv_session";

type CheckoutBody = {
  orgId?: string;
  seatCount?: number;
  origin?: string;
};

/**
 * POST /api/billing/checkout-session
 * Create a Stripe Checkout session for seat-based subscription
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
    const email = decodedClaims.email || "";
    const uid = decodedClaims.uid;
    
    const body = (await req.json().catch(() => null)) as CheckoutBody | null;
    
    const orgId = body?.orgId;
    const seatCount = body?.seatCount || 5;
    const origin = body?.origin;
    
    if (!orgId) {
      return NextResponse.json({ error: "orgId is required" }, { status: 400 });
    }
    
    if (!origin) {
      return NextResponse.json({ error: "origin URL is required" }, { status: 400 });
    }
    
    if (seatCount < 1 || seatCount > 1000) {
      return NextResponse.json(
        { error: "seatCount must be between 1 and 1000" },
        { status: 400 }
      );
    }
    
    // Verify user is admin of the organization
    const member = await getMemberByUid(uid);
    
    if (!member || member.orgId !== orgId) {
      return NextResponse.json(
        { error: "You are not a member of this organization" },
        { status: 403 }
      );
    }
    
    if (member.role !== "admin") {
      return NextResponse.json(
        { error: "Only organization admins can manage billing" },
        { status: 403 }
      );
    }
    
    // Get organization
    const org = await getOrganization(orgId);
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }
    
    // Check if already subscribed
    if (org.subscriptionStatus === "active" || org.subscriptionStatus === "trialing") {
      return NextResponse.json(
        { error: "Organization already has an active subscription. Use billing portal to manage." },
        { status: 400 }
      );
    }
    
    // Create checkout session
    const result = await createSeatCheckoutSession({
      orgId,
      adminUid: uid,
      adminEmail: email,
      seatCount,
      origin,
    });
    
    return NextResponse.json({ url: result.url, sessionId: result.sessionId });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to create checkout";
    
    if (message.includes("session") || message.includes("token")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    
    if (message.includes("STRIPE_PRICE_SEAT_MONTHLY")) {
      return NextResponse.json(
        { error: "Subscription pricing not configured" },
        { status: 503 }
      );
    }
    
    console.error("[API /api/billing/checkout-session] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
