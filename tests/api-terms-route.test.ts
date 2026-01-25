import { describe, expect, it, vi } from "vitest";

// Mock fs to make the test deterministic (and not depend on build output)
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async () => "# Terms\n\nHello"),
}));

import { GET } from "../src/app/api/terms/route";

describe("/api/terms route", () => {
  it("returns {version, markdown}", async () => {
    process.env.TERMS_VERSION = "v1.2";

    const res = await GET();
    expect(res.status).toBe(200);

    const json = (await res.json()) as any;
    expect(json.version).toBe("v1.2");
    expect(typeof json.markdown).toBe("string");
    expect(json.markdown).toContain("Terms");
  });
});
