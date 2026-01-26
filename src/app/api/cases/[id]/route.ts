import { NextResponse } from "next/server";
import { normalizeLanguageMode } from "@/lib/lang";
import { storage } from "@/lib/storage";

type PatchBody = {
  title?: string;
  languageMode?: "AUTO" | "EN" | "RU" | "ES";
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const data = await storage.getCase(id);

    if (!data.case) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Failed to load case" }, { status: 500 });
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => null)) as PatchBody | null;

    const languageMode = normalizeLanguageMode(body?.languageMode);
    const updated = await storage.updateCase(id, {
      title: body?.title,
      ...(languageMode !== "AUTO"
        ? { inputLanguage: languageMode, languageSource: "MANUAL" }
        : { languageSource: "AUTO" }),
    });

    if (!updated) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }

    return NextResponse.json({ case: updated });
  } catch {
    return NextResponse.json({ error: "Failed to update case" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    await storage.softDeleteCase(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete case" }, { status: 500 });
  }
}
