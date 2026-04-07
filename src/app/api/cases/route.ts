import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { storage } from "@/lib/storage";

export async function GET() {
  try {
    const user = await getCurrentUser();
    // Allow unauthenticated access for backward compatibility, but filter by user if authenticated
    const cases = await storage.listCases(user?.id);
    return NextResponse.json({ cases });
  } catch {
    return NextResponse.json({ error: "Failed to load cases" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  await req.json().catch(() => null);
  return NextResponse.json(
    { error: "Cases are created only after the first meaningful message is sent." },
    { status: 400 }
  );
}
