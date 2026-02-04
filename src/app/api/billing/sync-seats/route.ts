import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getFirebaseAuth } from "@/lib/firebase-admin";
import { getMemberByUid, getOrganization, updateOrgSubscription } from "@/lib/firestore";
import { syncSeatsFromStripe } from "@/lib/b2b-stripe";

const SESSION_COOKIE_NAME = "rv_session";

/**
 * POST /api/billing/sync-seats
 * 
 * Manually sync seat limit from Stripe subscription.
 * This is the authoritative source of truth for seatLimit.
 * 
 * Admin only - requires authenticated admin user.
 */
export async function POST() {
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
    
    // Get member and verify admin
    const member = await getMemberByUid(decodedClaims.uid);
    
    if (!member) {
      return NextResponse.json({ error: "Not a member of any organization" }, { status: 403 });
    }
    
    if (member.role !== "admin") {
      return NextResponse.json({ error: "Only admins can sync billing" }, { status: 403 });
    }
    
    // Get organization
    const org = await getOrganization(member.orgId);
    
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }
    
    if (!org.stripeCustomerId) {
      return NextResponse.json({ 
        error: "No Stripe customer linked to this organization" 
      }, { status: 400 });
    }
    
    console.log(`[API /api/billing/sync-seats] Syncing seats for org ${org.id} (customer: ${org.stripeCustomerId})`);
    
    // Fetch current subscription from Stripe
    const stripeData = await syncSeatsFromStripe(org.stripeCustomerId);
    
    if (!stripeData) {
      return NextResponse.json({ 
        error: "No active subscription found in Stripe" 
      }, { status: 404 });
    }
    
    // Update org with Stripe's source of truth
    await updateOrgSubscription(org.id, {
      seatLimit: stripeData.seatLimit,
      subscriptionStatus: stripeData.subscriptionStatus,
    });
    
    console.log(`[API /api/billing/sync-seats] Updated org ${org.id}: seatLimit=${stripeData.seatLimit}, status=${stripeData.subscriptionStatus}`);
    
    return NextResponse.json({
      success: true,
      seatLimit: stripeData.seatLimit,
      subscriptionStatus: stripeData.subscriptionStatus,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to sync seats";
    console.error("[API /api/billing/sync-seats] Error:", message);
    
    if (message.includes("session") || message.includes("token")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
