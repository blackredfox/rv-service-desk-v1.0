import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for the Diagnostic Registry.
 *
 * Covers:
 * - detectAlreadyAnswered: recognizes "already checked" patterns
 * - detectUnableToVerify: recognizes "don't know" / "can't see" patterns
 * - extractTopics: extracts diagnostic topic keys from messages
 * - detectKeyFinding: detects pivot triggers
 * - processUserMessage: full registry update
 * - buildRegistryContext: context string for prompt injection
 * - shouldPivot: checks if pivot is warranted
 */

// ── detectAlreadyAnswered ───────────────────────────────────────────

describe("detectAlreadyAnswered", () => {
  beforeEach(() => { vi.resetModules(); });

  it("detects 'already checked'", async () => {
    const { detectAlreadyAnswered } = await import("@/lib/diagnostic-registry");
    expect(detectAlreadyAnswered("I already checked the voltage")).toBe(true);
  });

  it("detects 'already told you'", async () => {
    const { detectAlreadyAnswered } = await import("@/lib/diagnostic-registry");
    expect(detectAlreadyAnswered("I already told you that")).toBe(true);
  });

  it("detects 'already answered'", async () => {
    const { detectAlreadyAnswered } = await import("@/lib/diagnostic-registry");
    expect(detectAlreadyAnswered("already answered that")).toBe(true);
  });

  it("detects 'I already verified'", async () => {
    const { detectAlreadyAnswered } = await import("@/lib/diagnostic-registry");
    expect(detectAlreadyAnswered("I already verified the ground")).toBe(true);
  });

  it("detects Russian 'уже проверил'", async () => {
    const { detectAlreadyAnswered } = await import("@/lib/diagnostic-registry");
    expect(detectAlreadyAnswered("уже проверил напряжение")).toBe(true);
  });

  it("returns false for normal message", async () => {
    const { detectAlreadyAnswered } = await import("@/lib/diagnostic-registry");
    expect(detectAlreadyAnswered("The voltage reads 12.4V")).toBe(false);
  });
});

// ── detectUnableToVerify ────────────────────────────────────────────

describe("detectUnableToVerify", () => {
  beforeEach(() => { vi.resetModules(); });

  it("detects 'don't know'", async () => {
    const { detectUnableToVerify } = await import("@/lib/diagnostic-registry");
    expect(detectUnableToVerify("I don't know what that reading is")).toBe(true);
  });

  it("detects 'can't check'", async () => {
    const { detectUnableToVerify } = await import("@/lib/diagnostic-registry");
    expect(detectUnableToVerify("Can't check the pressure switch right now")).toBe(true);
  });

  it("detects 'unable to verify'", async () => {
    const { detectUnableToVerify } = await import("@/lib/diagnostic-registry");
    expect(detectUnableToVerify("Unable to verify the ground path")).toBe(true);
  });

  it("detects 'can't see'", async () => {
    const { detectUnableToVerify } = await import("@/lib/diagnostic-registry");
    expect(detectUnableToVerify("I can't see the capacitor from here")).toBe(true);
  });

  it("detects 'no tool to check'", async () => {
    const { detectUnableToVerify } = await import("@/lib/diagnostic-registry");
    expect(detectUnableToVerify("No multimeter to check voltage")).toBe(true);
  });

  it("detects Russian 'не могу проверить'", async () => {
    const { detectUnableToVerify } = await import("@/lib/diagnostic-registry");
    expect(detectUnableToVerify("не могу проверить")).toBe(true);
  });

  it("returns false for normal message", async () => {
    const { detectUnableToVerify } = await import("@/lib/diagnostic-registry");
    expect(detectUnableToVerify("The voltage is 12.4V")).toBe(false);
  });
});

// ── extractTopics ───────────────────────────────────────────────────

describe("extractTopics", () => {
  beforeEach(() => { vi.resetModules(); });

  it("extracts voltage topic", async () => {
    const { extractTopics } = await import("@/lib/diagnostic-registry");
    expect(extractTopics("I measured 12.4 volts at the terminal")).toContain("voltage");
  });

  it("extracts ground topic", async () => {
    const { extractTopics } = await import("@/lib/diagnostic-registry");
    expect(extractTopics("Ground continuity is good")).toContain("ground");
  });

  it("extracts pump noise topic", async () => {
    const { extractTopics } = await import("@/lib/diagnostic-registry");
    expect(extractTopics("The pump makes no noise at all")).toContain("pump_noise");
  });

  it("extracts multiple topics", async () => {
    const { extractTopics } = await import("@/lib/diagnostic-registry");
    const topics = extractTopics("Voltage is 12.4V and ground continuity is OK");
    expect(topics).toContain("voltage");
    expect(topics).toContain("ground");
  });

  it("returns empty for unrelated message", async () => {
    const { extractTopics } = await import("@/lib/diagnostic-registry");
    expect(extractTopics("yes")).toHaveLength(0);
  });
});

// ── detectKeyFinding ────────────────────────────────────────────────

describe("detectKeyFinding", () => {
  beforeEach(() => { vi.resetModules(); });

  it("detects missing fan blade", async () => {
    const { detectKeyFinding } = await import("@/lib/diagnostic-registry");
    expect(detectKeyFinding("There's a missing blade on the fan")).toBe("missing fan blade");
  });

  it("detects blower wheel damage", async () => {
    const { detectKeyFinding } = await import("@/lib/diagnostic-registry");
    expect(detectKeyFinding("The blower wheel has damage and cracks")).toBe("blower wheel damage");
  });

  it("detects component contacting housing", async () => {
    const { detectKeyFinding } = await import("@/lib/diagnostic-registry");
    expect(detectKeyFinding("The blade is contacting the housing and scraping")).toBe("component contacting housing");
  });

  it("detects seized motor", async () => {
    const { detectKeyFinding } = await import("@/lib/diagnostic-registry");
    expect(detectKeyFinding("The motor is seized and won't turn at all")).toBe("seized/locked motor");
  });

  it("detects zero current draw", async () => {
    const { detectKeyFinding } = await import("@/lib/diagnostic-registry");
    expect(detectKeyFinding("The amp draw is zero")).toBe("zero current draw");
  });

  it("detects cracked housing", async () => {
    const { detectKeyFinding } = await import("@/lib/diagnostic-registry");
    expect(detectKeyFinding("There's a crack in the housing of the pump")).toBe("cracked housing");
  });

  it("returns null for normal diagnostic message", async () => {
    const { detectKeyFinding } = await import("@/lib/diagnostic-registry");
    expect(detectKeyFinding("Voltage reads 12.4V at the terminals")).toBeNull();
  });
});

// ── processUserMessage + buildRegistryContext ────────────────────────

describe("processUserMessage + registry context", () => {
  beforeEach(() => { vi.resetModules(); });

  it("tracks answered topics", async () => {
    const { processUserMessage, getRegistryEntry, clearRegistry } = await import("@/lib/diagnostic-registry");
    clearRegistry("test-1");

    processUserMessage("test-1", "The voltage reads 12.4V");
    const entry = getRegistryEntry("test-1");
    expect(entry?.answeredKeys.has("voltage")).toBe(true);
  });

  it("tracks unable-to-verify topics", async () => {
    const { processUserMessage, getRegistryEntry, clearRegistry } = await import("@/lib/diagnostic-registry");
    clearRegistry("test-2");

    processUserMessage("test-2", "I can't check the ground continuity");
    const entry = getRegistryEntry("test-2");
    expect(entry?.unableToVerifyKeys.has("ground")).toBe(true);
  });

  it("tracks key findings", async () => {
    const { processUserMessage, getRegistryEntry, clearRegistry } = await import("@/lib/diagnostic-registry");
    clearRegistry("test-3");

    const result = processUserMessage("test-3", "The fan blade is missing from the blower");
    expect(result.keyFinding).toBeTruthy();
    expect(getRegistryEntry("test-3")?.keyFindings.length).toBeGreaterThan(0);
  });

  it("detects already-answered flag", async () => {
    const { processUserMessage, clearRegistry } = await import("@/lib/diagnostic-registry");
    clearRegistry("test-4");

    const result = processUserMessage("test-4", "I already checked the voltage");
    expect(result.alreadyAnswered).toBe(true);
  });

  it("builds registry context with answered and unable topics", async () => {
    const { processUserMessage, buildRegistryContext, clearRegistry } = await import("@/lib/diagnostic-registry");
    clearRegistry("test-5");

    processUserMessage("test-5", "Voltage is 12.4V");
    processUserMessage("test-5", "I can't check the ground");
    
    const ctx = buildRegistryContext("test-5");
    expect(ctx).toContain("ALREADY ANSWERED");
    expect(ctx).toContain("voltage");
    expect(ctx).toContain("UNABLE TO VERIFY");
    expect(ctx).toContain("ground");
  });

  it("returns empty context for fresh case", async () => {
    const { buildRegistryContext, clearRegistry } = await import("@/lib/diagnostic-registry");
    clearRegistry("test-6");
    
    expect(buildRegistryContext("test-6")).toBe("");
  });
});

// ── shouldPivot ─────────────────────────────────────────────────────

describe("shouldPivot", () => {
  beforeEach(() => { vi.resetModules(); });

  it("returns false when no key findings", async () => {
    const { processUserMessage, shouldPivot, clearRegistry } = await import("@/lib/diagnostic-registry");
    clearRegistry("pivot-1");

    processUserMessage("pivot-1", "Voltage reads 12.4V");
    expect(shouldPivot("pivot-1").pivot).toBe(false);
  });

  it("returns true when key finding is detected", async () => {
    const { processUserMessage, shouldPivot, clearRegistry } = await import("@/lib/diagnostic-registry");
    clearRegistry("pivot-2");

    processUserMessage("pivot-2", "The motor is seized and won't turn at all");
    const result = shouldPivot("pivot-2");
    expect(result.pivot).toBe(true);
    expect(result.finding).toContain("seized");
  });
});
