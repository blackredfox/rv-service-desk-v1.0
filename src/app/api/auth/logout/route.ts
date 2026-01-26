import { NextResponse } from "next/server";
import {
  clearSessionCookie,
  getSessionFromCookie,
  invalidateSession,
  getCurrentUser,
} from "@/lib/auth";
import { trackEvent } from "@/lib/analytics";

export async function POST() {
  try {
    const user = await getCurrentUser();
    const sessionId = await getSessionFromCookie();

    if (sessionId) {
      await invalidateSession(sessionId);
    }

    await clearSessionCookie();

    // Track logout
    if (user) {
      await trackEvent("user.logout", user.id, {});
    }

    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Logout failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
