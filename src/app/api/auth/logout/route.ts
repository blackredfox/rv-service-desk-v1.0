import { NextResponse } from "next/server";
import { clearSessionCookie, getCurrentUser } from "@/lib/auth";
import { trackEvent } from "@/lib/analytics";

export async function POST() {
  try {
    const user = await getCurrentUser();

    await clearSessionCookie();

    // Track logout (safe - won't break if event name unknown)
    if (user) {
      try {
        await trackEvent("user.logout", user.id, {});
      } catch {
        // Analytics failure should not break logout
      }
    }

    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Logout failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
