import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { loginUser, setSessionCookie, checkRateLimit } from "@/lib/auth";
import { trackEvent } from "@/lib/analytics";

type LoginBody = {
  email?: string;
  password?: string;
};

export async function POST(req: Request) {
  try {
    // Rate limiting
    const headersList = await headers();
    const ip =
      headersList.get("x-forwarded-for")?.split(",")[0] ??
      headersList.get("x-real-ip") ??
      "unknown";

    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }

    const body = (await req.json().catch(() => null)) as LoginBody | null;

    const email = body?.email?.trim().toLowerCase();
    const password = body?.password;

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    const { user, sessionId } = await loginUser(email, password);

    await setSessionCookie(sessionId);

    // Track login
    await trackEvent("user.login", user.id, {});

    return NextResponse.json({
      user: { id: user.id, email: user.email, plan: user.plan, status: user.status },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Login failed";

    if (message === "Invalid credentials") {
      return NextResponse.json({ error: message }, { status: 401 });
    }

    if (message === "Database not configured") {
      return NextResponse.json(
        { error: "Service temporarily unavailable" },
        { status: 503 }
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
