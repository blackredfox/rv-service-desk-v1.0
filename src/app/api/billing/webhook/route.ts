import { NextResponse } from "next/server";
import { handleB2BWebhookEvent } from "@/lib/b2b-stripe";

// IMPORTANT: Stripe webhook verification requires Node runtime (not Edge).
export const runtime = "nodejs";

export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    // This is the #1 reason you see "No signatures found..."
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 }
    );
  }

  // IMPORTANT: Must read RAW body. Do NOT use req.json().
  const body = Buffer.from(await req.arrayBuffer());

  try {
    const result = await handleB2BWebhookEvent(body, signature);
    // result is { received: boolean, eventType?: string }
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown webhook error";
    console.error("[Webhook] Error:", message);

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
