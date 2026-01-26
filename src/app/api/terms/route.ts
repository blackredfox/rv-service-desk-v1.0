import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

function getTermsVersion() {
  return process.env.TERMS_VERSION ?? "v1.0";
}

export async function GET() {
  try {
    const p = path.join(process.cwd(), "docs", "TERMS_AND_PRIVACY.md");
    const markdown = await readFile(p, "utf-8");

    return NextResponse.json({
      version: getTermsVersion(),
      markdown,
    });
  } catch {
    return NextResponse.json(
      { error: "Terms document not found" },
      { status: 404 }
    );
  }
}
