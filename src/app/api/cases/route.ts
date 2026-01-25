import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const cases = await prisma.case.findMany({
      where: { deletedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        title: true,
        inputLanguage: true,
        languageSource: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ cases });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to load cases" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { title?: string }
      | null;

    const title = (body?.title ?? "New Case").trim() || "New Case";

    const created = await prisma.case.create({
      data: {
        title: title.slice(0, 80),
      },
      select: {
        id: true,
        title: true,
        inputLanguage: true,
        languageSource: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ case: created }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: "Failed to create case" }, { status: 500 });
  }
}
