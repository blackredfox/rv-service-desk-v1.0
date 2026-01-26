import { NextResponse } from "next/server";
import { storage } from "@/lib/storage";

export async function GET() {
  try {
    const cases = await storage.listCases();
    return NextResponse.json({ cases });
  } catch {
    return NextResponse.json({ error: "Failed to load cases" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { title?: string } | null;
    const created = await storage.createCase({ title: body?.title });
    return NextResponse.json({ case: created }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create case" }, { status: 500 });
  }
}
