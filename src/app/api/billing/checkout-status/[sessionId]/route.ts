import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCheckoutStatus } from "@/lib/stripe";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ sessionId: string }> }
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { sessionId } = await ctx.params;

    if (!sessionId) {
      return NextResponse.json(
        { error: "Session ID is required" },
        { status: 400 }
      );
    }

    const status = await getCheckoutStatus(sessionId);

    return NextResponse.json(status);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to get status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
