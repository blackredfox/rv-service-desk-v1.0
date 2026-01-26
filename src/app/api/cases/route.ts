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
  try {
    const user = await getCurrentUser();
    const body = (await req.json().catch(() => null)) as { title?: string } | null;
    const created = await storage.createCase({ 
      title: body?.title,
      userId: user?.id,
    });
    return NextResponse.json({ case: created }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create case" }, { status: 500 });
  }
}
