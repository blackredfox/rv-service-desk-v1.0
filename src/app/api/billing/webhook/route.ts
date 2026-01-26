import { NextResponse } from "next/server";
import { handleWebhookEvent } from "@/lib/stripe";

export async function POST(req: Request) {
  try {
    const signature = req.headers.get("stripe-signature");

    if (!signature) {
      return NextResponse.json(
        { error: "Missing stripe-signature header" },
        { status: 400 }
      );
    }

    const body = await req.arrayBuffer();
    const bodyBuffer = Buffer.from(body);

    const result = await handleWebhookEvent(bodyBuffer, signature);

    return NextResponse.json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Webhook handling failed";

    if (message.includes("Webhook signature verification failed")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
