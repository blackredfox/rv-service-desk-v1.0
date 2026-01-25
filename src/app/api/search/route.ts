import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();

  if (!q) {
    return NextResponse.json({ cases: [] });
  }

  try {
    const cases = await prisma.case.findMany({
      where: {
        deletedAt: null,
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          {
            messages: {
              some: {
                content: { contains: q, mode: "insensitive" },
              },
            },
          },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: 25,
      select: {
        id: true,
        title: true,
        inputLanguage: true,
        languageSource: true,
        updatedAt: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ cases });
  } catch (err) {
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
