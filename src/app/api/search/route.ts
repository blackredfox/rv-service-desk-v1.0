import { NextResponse } from "next/server";
import { storage } from "@/lib/storage";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();

  if (!q) return NextResponse.json({ cases: [] });

  try {
    const cases = await storage.searchCases(q);
    return NextResponse.json({ cases });
  } catch {
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
