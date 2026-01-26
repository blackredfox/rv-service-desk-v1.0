import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { storage } from "@/lib/storage";

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser();
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") ?? "";

    if (!q.trim()) {
      return NextResponse.json({ cases: [] });
    }

    const cases = await storage.searchCases(q, user?.id);
    return NextResponse.json({ cases });
  } catch {
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
