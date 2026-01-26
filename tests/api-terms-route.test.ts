// @vitest-environment node

import { describe, expect, it } from "vitest";

import { GET } from "../src/app/api/terms/route";

describe("/api/terms route", () => {
  it("returns {version, markdown}", async () => {
    process.env.TERMS_VERSION = "v1.2";

    const res = await GET();
    expect(res.status).toBe(200);

    const json = (await res.json()) as unknown as { version: string; markdown: string };
    expect(json.version).toBe("v1.2");
    expect(typeof json.markdown).toBe("string");
    expect(json.markdown.length).toBeGreaterThan(10);
    expect(json.markdown).toContain("RV Service Desk");
  });
});
