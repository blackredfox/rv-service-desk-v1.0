import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for the Fact Pack Builder.
 *
 * Covers:
 * - buildFactPack: extracts facts from conversation history
 * - buildFactLockConstraint: generates constraint string for prompt injection
 * - Fact categorization: symptoms, observations, test results, statements
 * - Only user messages are scanned
 * - Deduplication of similar facts
 */

// ── buildFactPack ───────────────────────────────────────────────────

describe("buildFactPack", () => {
  beforeEach(() => { vi.resetModules(); });

  it("extracts symptom from user message", async () => {
    const { buildFactPack } = await import("@/lib/fact-pack");
    const history = [
      { role: "user", content: "The water pump doesn't work when I open the faucet." },
      { role: "assistant", content: "Understood. Let me check some things." },
    ];
    const pack = buildFactPack(history);
    expect(pack.facts.some(f => f.category === "symptom")).toBe(true);
  });

  it("extracts test results with measurements", async () => {
    const { buildFactPack } = await import("@/lib/fact-pack");
    const history = [
      { role: "user", content: "I measured 12.4 volts at the pump terminals." },
    ];
    const pack = buildFactPack(history);
    expect(pack.facts.some(f => f.category === "test_result")).toBe(true);
    expect(pack.summary).toContain("12.4");
  });

  it("extracts visual observations", async () => {
    const { buildFactPack } = await import("@/lib/fact-pack");
    const history = [
      { role: "user", content: "I see corrosion on the terminals and some burn marks." },
    ];
    const pack = buildFactPack(history);
    expect(pack.facts.some(f => f.category === "observation")).toBe(true);
  });

  it("ignores assistant messages", async () => {
    const { buildFactPack } = await import("@/lib/fact-pack");
    const history = [
      { role: "assistant", content: "The compressor appears to have intermittent operation and overheating." },
      { role: "user", content: "ok" },
    ];
    const pack = buildFactPack(history);
    // Should NOT extract "intermittent operation" from assistant message
    expect(pack.facts.every(f => !f.text.includes("intermittent operation"))).toBe(true);
  });

  it("deduplicates similar facts", async () => {
    const { buildFactPack } = await import("@/lib/fact-pack");
    const history = [
      { role: "user", content: "Voltage is 12.4V at the terminals." },
      { role: "user", content: "Voltage is 12.4V at the terminals." },
    ];
    const pack = buildFactPack(history);
    const testResults = pack.facts.filter(f => f.category === "test_result");
    expect(testResults.length).toBe(1); // Deduplicated
  });

  it("handles empty history", async () => {
    const { buildFactPack } = await import("@/lib/fact-pack");
    const pack = buildFactPack([]);
    expect(pack.facts).toHaveLength(0);
    expect(pack.summary).toContain("No specific facts");
  });

  it("handles multi-message conversation", async () => {
    const { buildFactPack } = await import("@/lib/fact-pack");
    const history = [
      { role: "user", content: "Water pump doesn't run when faucet opens." },
      { role: "assistant", content: "Please check voltage." },
      { role: "user", content: "I measured 12.4 volts at the terminals." },
      { role: "assistant", content: "Check the ground." },
      { role: "user", content: "Ground continuity is good, less than 0.5 ohms." },
    ];
    const pack = buildFactPack(history);
    expect(pack.facts.length).toBeGreaterThanOrEqual(3);
    expect(pack.summary).toContain("12.4");
  });
});

// ── buildFactLockConstraint ─────────────────────────────────────────

describe("buildFactLockConstraint", () => {
  beforeEach(() => { vi.resetModules(); });

  it("produces a FACT LOCK constraint", async () => {
    const { buildFactLockConstraint } = await import("@/lib/fact-pack");
    const history = [
      { role: "user", content: "Water pump stopped running. No noise when faucet opens." },
      { role: "user", content: "Voltage at terminals is 12.4V." },
    ];
    const constraint = buildFactLockConstraint(history);
    
    expect(constraint).toContain("FACT LOCK");
    expect(constraint).toContain("MUST use ONLY these facts");
    expect(constraint).toContain("MUST NOT add");
  });

  it("includes technician-stated facts", async () => {
    const { buildFactLockConstraint } = await import("@/lib/fact-pack");
    const history = [
      { role: "user", content: "I see burn marks on the wiring." },
      { role: "user", content: "Resistance measured at 0.3 ohms." },
    ];
    const constraint = buildFactLockConstraint(history);
    
    expect(constraint).toContain("burn marks");
    expect(constraint).toContain("0.3 ohms");
  });

  it("explicitly prohibits inventing symptoms", async () => {
    const { buildFactLockConstraint } = await import("@/lib/fact-pack");
    const constraint = buildFactLockConstraint([]);
    
    expect(constraint).toContain("MUST NOT add");
    expect(constraint).toContain("intermittent operation");
    expect(constraint).toContain("not verified");
  });
});
