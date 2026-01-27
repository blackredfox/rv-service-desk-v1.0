import { NextResponse } from "next/server";
import { handleB2BWebhookEvent } from "@/lib/b2b-stripe";

/**
 * POST /api/billing/webhook
 * Handle Stripe webhook events for B2B billing
 */
export async function POST(req: Request) {
  try {
    const signature = req.headers.get("stripe-signature");
    
    if (!signature) {
      return NextResponse.json(
        { error: "Missing stripe-signature header" },
        { status: 400 }
      );
    }
    
    // Read raw body for signature verification
    const body = await req.arrayBuffer();
    const bodyBuffer = Buffer.from(body);
    
    const result = await handleB2BWebhookEvent(bodyBuffer, signature);
    
    return NextResponse.json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Webhook handling failed";
    
    if (message.includes("Webhook signature verification failed")) {
      console.error("[Webhook] Signature verification failed:", message);
      return NextResponse.json({ error: message }, { status: 400 });
    }
    
    if (message.includes("Missing STRIPE_WEBHOOK_SECRET")) {
      console.error("[Webhook] Missing webhook secret");
      return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
    }
    
    console.error("[Webhook] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
