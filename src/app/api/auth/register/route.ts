import { NextResponse } from "next/server";
import { headers } from "next/headers";
import {
  registerUser,
  checkRateLimit,
  verifyFirebasePassword,
  createFirebaseSessionCookie,
  setSessionCookie,
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

    const user = await registerUser(email, password);

    // Try to create a session cookie by signing in the new user via REST
    // If this fails we still return 201 but include a helpful warning.
    let sessionWarning: string | null = null;
    try {
      const idToken = await verifyFirebasePassword(email, password);
      const sessionCookie = await createFirebaseSessionCookie(idToken);
      await setSessionCookie(sessionCookie);
    } catch (err) {
      // Do not log sensitive tokens; log a short message for server diagnostics
      console.error("Failed to create session cookie after registration:",
        err instanceof Error ? err.message : String(err)
      );
      sessionWarning = "Account created but session could not be established. Please sign in.";
    }

    // Track signup (safe - won't break if event name unknown)
    try {
      await trackEvent("user.signup", user.id, { email: user.email });
    } catch {
      // Analytics failure should not break registration
    }

    const payload: any = { user: { id: user.id, email: user.email, plan: user.plan, status: user.status } };
    if (sessionWarning) payload.warning = sessionWarning;

    return NextResponse.json(payload, { status: 201 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Registration failed";

    // Firebase error: user already exists
    if (message.includes("already exists") || message.includes("EMAIL_EXISTS")) {
      return NextResponse.json({ error: "User already exists" }, { status: 409 });
    }

    if (message === "Database not configured") {
      return NextResponse.json(
        { error: "Service temporarily unavailable" },
        { status: 503 }
      );
    }

    // Firebase Admin SDK initialization error
    if (message.includes("firebase") || message.includes("Firebase")) {
      console.error("Firebase error during registration:", message);
      return NextResponse.json(
        { error: "Authentication service unavailable" },
        { status: 503 }
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
