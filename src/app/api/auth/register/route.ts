import { NextResponse } from "next/server";
import { headers } from "next/headers";
import {
  registerUser,
  setSessionCookie,
  checkRateLimit,
} from "@/lib/auth";
import { trackEvent } from "@/lib/analytics";

type RegisterBody = {
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

    const body = (await req.json().catch(() => null)) as RegisterBody | null;

    const email = body?.email?.trim().toLowerCase();
    const password = body?.password;

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 }
      );
    }

    // Password strength
    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    const { user, sessionId } = await registerUser(email, password);

    await setSessionCookie(sessionId);

    // Track signup
    await trackEvent("user.signup", user.id, { email: user.email });

    return NextResponse.json(
      { user: { id: user.id, email: user.email, plan: user.plan, status: user.status } },
      { status: 201 }
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Registration failed";

    if (message === "User already exists") {
      return NextResponse.json({ error: message }, { status: 409 });
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
