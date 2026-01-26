import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    return NextResponse.json({
      id: user.id,
      email: user.email,
      plan: user.plan,
      status: user.status,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to get user";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
