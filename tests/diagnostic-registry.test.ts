import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for the Diagnostic Registry (procedure-aware version).
 *
 * Covers:
 * - detectAlreadyAnswered: recognizes "already checked" patterns
 * - detectUnableToVerify: recognizes "don't know" / "can't see" patterns
 * - extractTopics: extracts diagnostic topic keys from messages
 * - detectKeyFinding: detects pivot triggers
 * - processUserMessage: full registry update with step tracking
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

// ── processUserMessage ──────────────────────────────────────────────

describe("processUserMessage – procedure-aware", () => {
  beforeEach(() => { vi.resetModules(); });

  it("tracks completed steps when procedure is active", async () => {
    const { initializeCase, processUserMessage, getRegistryEntry, clearRegistry } = await import("@/lib/diagnostic-registry");
    clearRegistry("pm-1");

    initializeCase("pm-1", "Water pump not working");
    const result = processUserMessage("pm-1", "No noise from pump when faucet opens, completely silent");
    expect(result.completedStepIds.length).toBeGreaterThan(0);
  });

  it("tracks unable-to-verify steps", async () => {
    const { initializeCase, processUserMessage, getRegistryEntry, clearRegistry } = await import("@/lib/diagnostic-registry");
    clearRegistry("pm-2");

    initializeCase("pm-2", "Water pump not working");
    processUserMessage("pm-2", "Pump is silent when faucet opens");
    const result = processUserMessage("pm-2", "Can't check voltage, no multimeter");
    expect(result.unableStepIds.length).toBeGreaterThan(0);
  });

  it("still tracks legacy topics", async () => {
    const { initializeCase, processUserMessage, clearRegistry } = await import("@/lib/diagnostic-registry");
    clearRegistry("pm-3");

    initializeCase("pm-3", "Water pump not working");
    const result = processUserMessage("pm-3", "Voltage at terminals is 12.4V");
    expect(result.newAnswered).toContain("voltage");
  });

  it("detects key findings", async () => {
    const { initializeCase, processUserMessage, clearRegistry } = await import("@/lib/diagnostic-registry");
    clearRegistry("pm-4");

    initializeCase("pm-4", "Furnace issue");
    const result = processUserMessage("pm-4", "Motor is seized and won't turn at all");
    expect(result.keyFinding).toContain("seized");
  });
});

// ── shouldPivot ─────────────────────────────────────────────────────

describe("shouldPivot", () => {
  beforeEach(() => { vi.resetModules(); });

  it("returns false when no key findings", async () => {
    const { initializeCase, processUserMessage, shouldPivot, clearRegistry } = await import("@/lib/diagnostic-registry");
    clearRegistry("pv-1");

    initializeCase("pv-1", "Water pump issue");
    processUserMessage("pv-1", "Voltage reads 12.4V");
    expect(shouldPivot("pv-1").pivot).toBe(false);
  });

  it("returns true when key finding is detected", async () => {
    const { initializeCase, processUserMessage, shouldPivot, clearRegistry } = await import("@/lib/diagnostic-registry");
    clearRegistry("pv-2");

    initializeCase("pv-2", "AC issue");
    processUserMessage("pv-2", "The motor is seized and won't turn at all");
    const result = shouldPivot("pv-2");
    expect(result.pivot).toBe(true);
    expect(result.finding).toContain("seized");
  });
});
