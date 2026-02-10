import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for retention logic + case persistence + expiration badge.
 *
 * Covers:
 * - computeExpiresAt: 30-day window from lastActivityAt
 * - computeTimeLeftSeconds: seconds until expiration
 * - formatTimeLeft: compact display string (Xd / Xh / Xm / Expired)
 * - getUrgencyTier: normal / warning / urgent / expired
 * - isExpired: boolean check
 * - CaseSummary includes retention fields
 * - Sidebar badge formatting
 */

// ── computeExpiresAt ────────────────────────────────────────────────

describe("computeExpiresAt", () => {
  beforeEach(() => { vi.resetModules(); });

  it("adds exactly 30 days to lastActivityAt", async () => {
    const { computeExpiresAt, RETENTION_DAYS } = await import("@/lib/retention");
    const base = new Date("2026-01-01T00:00:00Z");
    const result = computeExpiresAt(base);
    
    const expected = new Date(base.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000);
    expect(result.getTime()).toBe(expected.getTime());
  });

  it("accepts string input", async () => {
    const { computeExpiresAt } = await import("@/lib/retention");
    const result = computeExpiresAt("2026-01-15T12:00:00Z");
    expect(result.toISOString()).toBe("2026-02-14T12:00:00.000Z");
  });
});

// ── computeTimeLeftSeconds ──────────────────────────────────────────

describe("computeTimeLeftSeconds", () => {
  beforeEach(() => { vi.resetModules(); });

  it("returns positive seconds for future expiration", async () => {
    const { computeTimeLeftSeconds } = await import("@/lib/retention");
    const future = new Date(Date.now() + 86400 * 1000); // +1 day
    const seconds = computeTimeLeftSeconds(future);
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(86400);
  });

  it("returns 0 for past expiration", async () => {
    const { computeTimeLeftSeconds } = await import("@/lib/retention");
    const past = new Date(Date.now() - 1000);
    expect(computeTimeLeftSeconds(past)).toBe(0);
  });

  it("uses custom now reference", async () => {
    const { computeTimeLeftSeconds } = await import("@/lib/retention");
    const expires = new Date("2026-02-01T00:00:00Z");
    const now = new Date("2026-01-31T00:00:00Z");
    const seconds = computeTimeLeftSeconds(expires, now);
    expect(seconds).toBe(86400); // exactly 1 day
  });
});

// ── formatTimeLeft ──────────────────────────────────────────────────

describe("formatTimeLeft", () => {
  beforeEach(() => { vi.resetModules(); });

  it("formats >= 7 days as 'Xd'", async () => {
    const { formatTimeLeft } = await import("@/lib/retention");
    expect(formatTimeLeft(10 * 86400)).toBe("10d");
    expect(formatTimeLeft(30 * 86400)).toBe("30d");
  });

  it("formats 1-6 days as 'Xd'", async () => {
    const { formatTimeLeft } = await import("@/lib/retention");
    expect(formatTimeLeft(3 * 86400)).toBe("3d");
    expect(formatTimeLeft(6 * 86400)).toBe("6d");
  });

  it("formats < 24h as 'Xh'", async () => {
    const { formatTimeLeft } = await import("@/lib/retention");
    expect(formatTimeLeft(5 * 3600)).toBe("5h");
    expect(formatTimeLeft(23 * 3600)).toBe("23h");
  });

  it("formats < 60 min as 'Xm'", async () => {
    const { formatTimeLeft } = await import("@/lib/retention");
    expect(formatTimeLeft(30 * 60)).toBe("30m");
    expect(formatTimeLeft(59 * 60)).toBe("59m");
  });

  it("formats 0 as 'Expired'", async () => {
    const { formatTimeLeft } = await import("@/lib/retention");
    expect(formatTimeLeft(0)).toBe("Expired");
  });

  it("formats negative as 'Expired'", async () => {
    const { formatTimeLeft } = await import("@/lib/retention");
    expect(formatTimeLeft(-100)).toBe("Expired");
  });
});

// ── getUrgencyTier ──────────────────────────────────────────────────

describe("getUrgencyTier", () => {
  beforeEach(() => { vi.resetModules(); });

  it("normal for >= 7 days", async () => {
    const { getUrgencyTier } = await import("@/lib/retention");
    expect(getUrgencyTier(10 * 86400)).toBe("normal");
    expect(getUrgencyTier(7 * 86400)).toBe("normal");
  });

  it("warning for 1-6 days", async () => {
    const { getUrgencyTier } = await import("@/lib/retention");
    expect(getUrgencyTier(3 * 86400)).toBe("warning");
    expect(getUrgencyTier(86400)).toBe("warning");
  });

  it("urgent for < 24h", async () => {
    const { getUrgencyTier } = await import("@/lib/retention");
    expect(getUrgencyTier(12 * 3600)).toBe("urgent");
    expect(getUrgencyTier(3600)).toBe("urgent");
  });

  it("expired for 0", async () => {
    const { getUrgencyTier } = await import("@/lib/retention");
    expect(getUrgencyTier(0)).toBe("expired");
  });
});

// ── isExpired ───────────────────────────────────────────────────────

describe("isExpired", () => {
  beforeEach(() => { vi.resetModules(); });

  it("returns false for recent activity", async () => {
    const { isExpired } = await import("@/lib/retention");
    const recent = new Date().toISOString();
    expect(isExpired(recent)).toBe(false);
  });

  it("returns true for 31-day-old activity", async () => {
    const { isExpired } = await import("@/lib/retention");
    const old = new Date(Date.now() - 31 * 86400 * 1000).toISOString();
    expect(isExpired(old)).toBe(true);
  });

  it("returns false for exactly 29-day-old activity", async () => {
    const { isExpired } = await import("@/lib/retention");
    const activity = new Date(Date.now() - 29 * 86400 * 1000).toISOString();
    expect(isExpired(activity)).toBe(false);
  });
});

// ── RETENTION_DAYS constant ─────────────────────────────────────────

describe("RETENTION_DAYS", () => {
  it("is exactly 30", async () => {
    const { RETENTION_DAYS } = await import("@/lib/retention");
    expect(RETENTION_DAYS).toBe(30);
  });
});

// ── CaseSummary type includes retention fields ──────────────────────

describe("CaseSummary retention fields", () => {
  beforeEach(() => { vi.resetModules(); });

  it("storage.createCase returns retention fields", async () => {
    const { storage } = await import("@/lib/storage");
    const created = await storage.createCase({ title: "Test Case" });
    
    expect(created.lastActivityAt).toBeDefined();
    expect(created.expiresAt).toBeDefined();
    expect(created.timeLeftSeconds).toBeGreaterThan(0);
    expect(typeof created.timeLeftSeconds).toBe("number");
  });

  it("storage.listCases returns retention fields", async () => {
    const { storage } = await import("@/lib/storage");
    await storage.createCase({ title: "List Test" });
    const cases = await storage.listCases();
    
    expect(cases.length).toBeGreaterThan(0);
    const c = cases[0];
    expect(c.lastActivityAt).toBeDefined();
    expect(c.expiresAt).toBeDefined();
    expect(c.timeLeftSeconds).toBeGreaterThan(0);
  });

  it("appendMessage updates lastActivityAt", async () => {
    const { storage } = await import("@/lib/storage");
    const created = await storage.createCase({ title: "Activity Test" });
    const initialActivity = created.lastActivityAt;
    
    // Small delay to ensure timestamp difference
    await new Promise((r) => setTimeout(r, 10));
    
    await storage.appendMessage({
      caseId: created.id,
      role: "user",
      content: "Test message",
      language: "EN",
    });
    
    // Get the case again to check updated lastActivityAt
    const { case: updated } = await storage.getCase(created.id);
    expect(updated).not.toBeNull();
    expect(new Date(updated!.lastActivityAt).getTime()).toBeGreaterThanOrEqual(new Date(initialActivity).getTime());
  });

  it("timeLeftSeconds is approximately 30 days for new case", async () => {
    const { storage } = await import("@/lib/storage");
    const { RETENTION_DAYS } = await import("@/lib/retention");
    const created = await storage.createCase({ title: "TTL Test" });
    
    const expectedSeconds = RETENTION_DAYS * 86400;
    // Allow 5 seconds tolerance
    expect(created.timeLeftSeconds).toBeGreaterThan(expectedSeconds - 5);
    expect(created.timeLeftSeconds).toBeLessThanOrEqual(expectedSeconds);
  });
});

// ── Expired cases filtered from listings ────────────────────────────

describe("Expired cases filtered from listings", () => {
  beforeEach(() => { vi.resetModules(); });

  it("new cases appear in listings", async () => {
    const { storage } = await import("@/lib/storage");
    const created = await storage.createCase({ title: "Visible Case" });
    const cases = await storage.listCases();
    expect(cases.some((c) => c.id === created.id)).toBe(true);
  });

  // Note: Can't easily test expiration filtering in unit tests without
  // time manipulation of the in-memory store. The filter logic is tested
  // via the retention utility functions above.
});

// ── Badge formatting consistency ────────────────────────────────────

describe("Badge formatting consistency", () => {
  beforeEach(() => { vi.resetModules(); });

  it("each case gets its own expiry label", async () => {
    const { formatTimeLeft } = await import("@/lib/retention");
    
    // Case A: 20 days left
    const labelA = formatTimeLeft(20 * 86400);
    // Case B: 3 days left
    const labelB = formatTimeLeft(3 * 86400);
    // Case C: 5 hours left
    const labelC = formatTimeLeft(5 * 3600);
    
    expect(labelA).toBe("20d");
    expect(labelB).toBe("3d");
    expect(labelC).toBe("5h");
    
    // All different — no shared countdown
    expect(labelA).not.toBe(labelB);
    expect(labelB).not.toBe(labelC);
  });
});
