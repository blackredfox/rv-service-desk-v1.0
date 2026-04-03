import { NextResponse } from "next/server";
import { requestFirebasePasswordReset } from "@/lib/auth";

type ForgotPasswordBody = {
  email?: string;
};

const SUCCESS_MESSAGE = "If an account exists for that email, a reset link has been sent.";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as ForgotPasswordBody | null;
    const email = body?.email?.trim().toLowerCase();

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
    }

    await requestFirebasePasswordReset(email);

    return NextResponse.json(
      { success: true, message: SUCCESS_MESSAGE },
      { status: 200 }
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Password reset failed";

    if (message === "Invalid email address") {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (message === "FIREBASE_WEB_API_KEY not configured") {
      return NextResponse.json(
        { error: "Authentication service not configured" },
        { status: 503 }
      );
    }

    if (message.includes("Firebase") || message.includes("firebase")) {
      console.error("Firebase error during forgot password:", message);
      return NextResponse.json(
        { error: "Authentication service unavailable" },
        { status: 503 }
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}