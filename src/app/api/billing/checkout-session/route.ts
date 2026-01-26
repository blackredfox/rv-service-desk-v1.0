import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createCheckoutSession, type PlanType } from "@/lib/stripe";

type CheckoutBody = {
  plan?: string;
  origin?: string;
};

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as CheckoutBody | null;

    const plan = body?.plan?.toUpperCase();
    const origin = body?.origin;

    if (!plan || (plan !== "PREMIUM" && plan !== "PRO")) {
      return NextResponse.json(
        { error: "Invalid plan. Must be PREMIUM or PRO" },
        { status: 400 }
      );
    }

    if (!origin) {
      return NextResponse.json(
        { error: "Origin URL is required" },
        { status: 400 }
      );
    }

    const result = await createCheckoutSession({
      userId: user.id,
      email: user.email,
      plan: plan as PlanType,
      origin,
    });

    return NextResponse.json({ url: result.url, sessionId: result.sessionId });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to create checkout";

    if (message.includes("Price ID not configured")) {
      return NextResponse.json(
        { error: "Subscription plans not configured" },
        { status: 503 }
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
