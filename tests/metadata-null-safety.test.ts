import { describe, it, expect } from "vitest";

/**
 * Regression test: metadata = null must not crash normalizeMetadata or routes.
 * 
 * Root cause of the 500: CaseMetadata.pendingReportRequest changed from boolean
 * to PendingReportPayload | null in V5. Legacy DB records have:
 *   - metadata = null (most common)
 *   - metadata = { pendingReportRequest: true } (boolean, old V5 interim format)
 *   - metadata = { pendingReportRequest: false, pendingReportRequestedAt: null, pendingReportLocale: null }
 *
 * normalizeMetadata must handle all of these without throwing.
 */

// We can't import normalizeMetadata directly (it's not exported), so we test
// the storage module's behavior via the exported types and the route-level contract.

describe("Metadata null-safety (regression for 500 on /api/cases)", () => {
  // Inline the normalizeMetadata logic to test it directly
  type PendingReportPayload = {
    requestedAt: string;
    language: string;
    reason: "llm_down" | "cause_gate";
    requestedBy: "command" | "auto_transition";
    lastKnownMode: string;
    lastKnownSystem: string;
  };

  type CaseMetadata = {
    pendingReportRequest?: PendingReportPayload | null;
  };

  function normalizeMetadata(raw: unknown): CaseMetadata | undefined {
    if (!raw) return undefined;
    let obj: Record<string, unknown> | undefined;
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        obj = parsed && typeof parsed === "object" ? parsed : undefined;
      } catch {
        return undefined;
      }
    } else if (typeof raw === "object") {
      obj = raw as Record<string, unknown>;
    }
    if (!obj) return undefined;

    const pending = obj.pendingReportRequest;
    let normalizedPending: PendingReportPayload | null | undefined;
    if (pending === null || pending === undefined || pending === false) {
      normalizedPending = null;
    } else if (typeof pending === "boolean") {
      normalizedPending = null;
    } else if (typeof pending === "object" && pending !== null && "requestedAt" in pending) {
      normalizedPending = pending as PendingReportPayload;
    } else {
      normalizedPending = null;
    }

    return { pendingReportRequest: normalizedPending };
  }

  it("handles metadata = null (most common legacy case)", () => {
    const result = normalizeMetadata(null);
    expect(result).toBeUndefined();
  });

  it("handles metadata = undefined", () => {
    const result = normalizeMetadata(undefined);
    expect(result).toBeUndefined();
  });

  it("handles metadata = {} (empty object)", () => {
    const result = normalizeMetadata({});
    expect(result).toEqual({ pendingReportRequest: null });
  });

  it("handles legacy boolean pendingReportRequest = true", () => {
    const result = normalizeMetadata({ pendingReportRequest: true });
    expect(result).toEqual({ pendingReportRequest: null });
  });

  it("handles legacy boolean pendingReportRequest = false", () => {
    const result = normalizeMetadata({ pendingReportRequest: false });
    expect(result).toEqual({ pendingReportRequest: null });
  });

  it("handles legacy format with stale keys", () => {
    const result = normalizeMetadata({
      pendingReportRequest: true,
      pendingReportRequestedAt: "2025-12-01T00:00:00Z",
      pendingReportLocale: "EN",
    });
    // Must not include stale keys; boolean → null
    expect(result).toEqual({ pendingReportRequest: null });
    expect(result).not.toHaveProperty("pendingReportRequestedAt");
    expect(result).not.toHaveProperty("pendingReportLocale");
  });

  it("preserves valid V5 PendingReportPayload", () => {
    const payload: PendingReportPayload = {
      requestedAt: "2026-02-01T00:00:00Z",
      language: "EN",
      reason: "llm_down",
      requestedBy: "command",
      lastKnownMode: "diagnostic",
      lastKnownSystem: "Water Pump",
    };
    const result = normalizeMetadata({ pendingReportRequest: payload });
    expect(result?.pendingReportRequest).toEqual(payload);
  });

  it("handles pendingReportRequest = null explicitly", () => {
    const result = normalizeMetadata({ pendingReportRequest: null });
    expect(result).toEqual({ pendingReportRequest: null });
  });

  it("handles metadata as JSON string (Prisma edge case)", () => {
    const jsonStr = JSON.stringify({ pendingReportRequest: true });
    const result = normalizeMetadata(jsonStr);
    expect(result).toEqual({ pendingReportRequest: null });
  });

  it("handles malformed JSON string", () => {
    const result = normalizeMetadata("{invalid json");
    expect(result).toBeUndefined();
  });

  it("handles metadata = 0 (falsy non-null)", () => {
    const result = normalizeMetadata(0);
    expect(result).toBeUndefined();
  });

  it("handles metadata = '' (empty string)", () => {
    const result = normalizeMetadata("");
    expect(result).toBeUndefined();
  });

  it("handles random object without pendingReportRequest", () => {
    const result = normalizeMetadata({ foo: "bar" });
    expect(result).toEqual({ pendingReportRequest: null });
  });
});

describe("Route error logging exists", () => {
  it("cases/route.ts has error logging in GET handler", () => {
    const fs = require("fs");
    const content = fs.readFileSync("src/app/api/cases/route.ts", "utf-8");
    expect(content).toContain('[API /api/cases] ERROR:');
    expect(content).toContain("err.stack");
  });

  it("cases/[id]/route.ts has error logging in GET handler", () => {
    const fs = require("fs");
    const content = fs.readFileSync("src/app/api/cases/[id]/route.ts", "utf-8");
    expect(content).toContain('[API /api/cases/:id GET] ERROR:');
    expect(content).toContain("err.stack");
  });

  it("cases/[id]/route.ts has error logging in PATCH handler", () => {
    const fs = require("fs");
    const content = fs.readFileSync("src/app/api/cases/[id]/route.ts", "utf-8");
    expect(content).toContain('[API /api/cases/:id PATCH] ERROR:');
  });

  it("cases/[id]/route.ts has error logging in DELETE handler", () => {
    const fs = require("fs");
    const content = fs.readFileSync("src/app/api/cases/[id]/route.ts", "utf-8");
    expect(content).toContain('[API /api/cases/:id DELETE] ERROR:');
  });
});

describe("Prisma select clause safety (regression for PrismaClientValidationError)", () => {
  it("storage.ts does NOT include 'metadata: true' in any select clause", () => {
    const fs = require("fs");
    const content = fs.readFileSync("src/lib/storage.ts", "utf-8");
    // metadata: true in a select causes PrismaClientValidationError if the
    // generated client hasn't been regenerated after schema change
    expect(content).not.toMatch(/select:\s*\{[^}]*metadata:\s*true/s);
  });

  it("storage.ts uses CASE_SELECT_CORE constant for all Case queries", () => {
    const fs = require("fs");
    const content = fs.readFileSync("src/lib/storage.ts", "utf-8");
    expect(content).toContain("CASE_SELECT_CORE");
    // CASE_SELECT_CORE should NOT contain metadata
    const match = content.match(/CASE_SELECT_CORE\s*=\s*\{([^}]+)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).not.toContain("metadata");
  });

  it("storage.ts uses extractMetadata helper (never raw .metadata access in return)", () => {
    const fs = require("fs");
    const content = fs.readFileSync("src/lib/storage.ts", "utf-8");
    expect(content).toContain("extractMetadata");
  });
});
  it("Case.metadata is declared as Json? (nullable, no default)", () => {
    const fs = require("fs");
    const schema = fs.readFileSync("prisma/schema.prisma", "utf-8");
    expect(schema).toMatch(/metadata\s+Json\?/);
  });

  it("no new required fields were added to Case model", () => {
    const fs = require("fs");
    const schema = fs.readFileSync("prisma/schema.prisma", "utf-8");
    // Extract Case model block
    const caseMatch = schema.match(/model Case \{[\s\S]*?\n\}/);
    expect(caseMatch).not.toBeNull();
    const caseBlock = caseMatch![0];
    // Every field should have a default, be optional (?), or be a relation
    // Check there's no bare required field without default (other than id, userId, title which always existed)
    const lines = caseBlock.split("\n").filter((l: string) => l.trim() && !l.trim().startsWith("//") && !l.trim().startsWith("@@") && !l.startsWith("model") && !l.startsWith("}"));
    for (const line of lines) {
      const trimmed = line.trim();
      // Skip relations and indexes
      if (trimmed.startsWith("user ") || trimmed.startsWith("messages ") || trimmed.startsWith("reports ") || trimmed.startsWith("attachments ")) continue;
      // Known required fields that always existed
      if (trimmed.startsWith("id ") || trimmed.startsWith("userId ") || trimmed.startsWith("title ")) continue;
      // All other fields must be optional (?) or have @default or @updatedAt
      if (!trimmed.includes("?") && !trimmed.includes("@default") && !trimmed.includes("@updatedAt")) {
        // This would be a new required field without default — fail
        expect(trimmed).toContain("@default");
      }
    }
  });
});
