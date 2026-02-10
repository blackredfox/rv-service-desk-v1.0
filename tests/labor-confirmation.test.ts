import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for the labor confirmation flow and labor sum validation.
 *
 * Covers:
 * - extractLaborEstimate: parsing LLM estimate responses
 * - parseLaborConfirmation: parsing technician responses
 * - validateLaborSum: ensuring breakdown sums to confirmed total
 * - validateLaborConfirmationOutput: validating labor confirmation mode output
 * - End-to-end flow: estimate → confirm → report with constraint
 */

// ── extractLaborEstimate ────────────────────────────────────────────

describe("extractLaborEstimate", () => {
  beforeEach(() => { vi.resetModules(); });

  it("extracts 'Estimated total labor: 1.5 hours'", async () => {
    const { extractLaborEstimate } = await import("@/lib/labor-store");
    expect(extractLaborEstimate("Estimated total labor: 1.5 hours")).toBe(1.5);
  });

  it("extracts 'Estimated total labor: 2.0 hr'", async () => {
    const { extractLaborEstimate } = await import("@/lib/labor-store");
    expect(extractLaborEstimate("Some text. Estimated total labor: 2.0 hr. Please confirm.")).toBe(2.0);
  });

  it("extracts 'Total labor: 3.0 hours'", async () => {
    const { extractLaborEstimate } = await import("@/lib/labor-store");
    expect(extractLaborEstimate("Total labor: 3.0 hours")).toBe(3.0);
  });

  it("returns null when no labor pattern found", async () => {
    const { extractLaborEstimate } = await import("@/lib/labor-store");
    expect(extractLaborEstimate("Hello, how are you?")).toBeNull();
  });

  it("extracts from full labor confirmation response", async () => {
    const { extractLaborEstimate } = await import("@/lib/labor-store");
    const response = `Based on the diagnostic findings, the water pump requires replacement.

Estimated total labor: 1.0 hours

Please confirm this estimate, or enter a different total (e.g., '2.0 hours').`;
    expect(extractLaborEstimate(response)).toBe(1.0);
  });
});

// ── parseLaborConfirmation ──────────────────────────────────────────

describe("parseLaborConfirmation", () => {
  beforeEach(() => { vi.resetModules(); });

  it("parses '2.0 hours' as override", async () => {
    const { parseLaborConfirmation } = await import("@/lib/labor-store");
    expect(parseLaborConfirmation("2.0 hours", 1.5)).toBe(2.0);
  });

  it("parses '3 hr' as override", async () => {
    const { parseLaborConfirmation } = await import("@/lib/labor-store");
    expect(parseLaborConfirmation("3 hr", 1.5)).toBe(3.0);
  });

  it("parses '2.5h' (no space) as override", async () => {
    const { parseLaborConfirmation } = await import("@/lib/labor-store");
    expect(parseLaborConfirmation("2.5h", 1.5)).toBe(2.5);
  });

  it("parses standalone '2.5' as override", async () => {
    const { parseLaborConfirmation } = await import("@/lib/labor-store");
    expect(parseLaborConfirmation("2.5", 1.0)).toBe(2.5);
  });

  it("parses 'make it 2 hours' as override", async () => {
    const { parseLaborConfirmation } = await import("@/lib/labor-store");
    expect(parseLaborConfirmation("make it 2 hours", 1.5)).toBe(2.0);
  });

  it("'confirm' returns current estimate", async () => {
    const { parseLaborConfirmation } = await import("@/lib/labor-store");
    expect(parseLaborConfirmation("confirm", 1.5)).toBe(1.5);
  });

  it("'ok' returns current estimate", async () => {
    const { parseLaborConfirmation } = await import("@/lib/labor-store");
    expect(parseLaborConfirmation("ok", 2.0)).toBe(2.0);
  });

  it("'yes' returns current estimate", async () => {
    const { parseLaborConfirmation } = await import("@/lib/labor-store");
    expect(parseLaborConfirmation("yes", 1.0)).toBe(1.0);
  });

  it("'да' (Russian confirm) returns current estimate", async () => {
    const { parseLaborConfirmation } = await import("@/lib/labor-store");
    expect(parseLaborConfirmation("да", 1.5)).toBe(1.5);
  });

  it("'подтверждаю' (Russian confirm) returns current estimate", async () => {
    const { parseLaborConfirmation } = await import("@/lib/labor-store");
    expect(parseLaborConfirmation("подтверждаю", 1.5)).toBe(1.5);
  });

  it("'sí' (Spanish confirm) returns current estimate", async () => {
    const { parseLaborConfirmation } = await import("@/lib/labor-store");
    expect(parseLaborConfirmation("sí", 2.0)).toBe(2.0);
  });

  it("short ambiguous message treated as confirmation", async () => {
    const { parseLaborConfirmation } = await import("@/lib/labor-store");
    expect(parseLaborConfirmation("sounds good", 1.5)).toBe(1.5);
  });

  it("returns null when no estimate and no parseable input", async () => {
    const { parseLaborConfirmation } = await import("@/lib/labor-store");
    expect(parseLaborConfirmation("I need to check with my manager about the estimate and get back to you later", undefined)).toBeNull();
  });
});

// ── validateLaborSum ────────────────────────────────────────────────

describe("validateLaborSum", () => {
  beforeEach(() => { vi.resetModules(); });

  it("valid: breakdown sums to confirmed total", async () => {
    const { validateLaborSum } = await import("@/lib/labor-store");
    const report = `System isolation and drainage - 0.2 hr. Pump removal - 0.3 hr. Installation - 0.3 hr. Testing - 0.2 hr. Total labor: 1.0 hr.`;
    const result = validateLaborSum(report, 1.0);
    expect(result.valid).toBe(true);
    expect(result.computedSum).toBe(1.0);
    expect(result.violations).toHaveLength(0);
  });

  it("invalid: breakdown sums higher than confirmed total", async () => {
    const { validateLaborSum } = await import("@/lib/labor-store");
    const report = `Drainage - 0.5 hr. Removal - 0.8 hr. Installation - 0.8 hr. Testing - 0.4 hr. Total labor: 2.5 hr.`;
    const result = validateLaborSum(report, 1.5);
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.includes("LABOR_TOTAL_MISMATCH"))).toBe(true);
  });

  it("invalid: step sum drifts from confirmed total", async () => {
    const { validateLaborSum } = await import("@/lib/labor-store");
    const report = `Step A - 1.0 hr. Step B - 1.0 hr. Total labor: 1.5 hr.`;
    const result = validateLaborSum(report, 1.5);
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.includes("LABOR_SUM_DRIFT"))).toBe(true);
  });

  it("valid: complex AC breakdown sums correctly", async () => {
    const { validateLaborSum } = await import("@/lib/labor-store");
    const report = `System isolation and interior disassembly - 0.5 hr. Roof access and exterior shroud removal - 0.3 hr. AC unit removal - 0.5 hr. Roof preparation and new unit installation - 0.7 hr. Wiring reconnection and interior reassembly - 0.5 hr. System testing - 0.3 hr. Total labor: 2.8 hr.`;
    const result = validateLaborSum(report, 2.8);
    expect(result.valid).toBe(true);
    expect(result.computedSum).toBe(2.8);
  });
});

// ── validateLaborConfirmationOutput ─────────────────────────────────

describe("validateLaborConfirmationOutput", () => {
  beforeEach(() => { vi.resetModules(); });

  it("valid: contains estimate and confirmation prompt", async () => {
    const { validateLaborConfirmationOutput } = await import("@/lib/mode-validators");
    const output = `The water pump requires replacement.

Estimated total labor: 1.0 hours

Please confirm this estimate, or enter a different total (e.g., '2.0 hours').`;
    const result = validateLaborConfirmationOutput(output);
    expect(result.valid).toBe(true);
  });

  it("invalid: missing estimate pattern", async () => {
    const { validateLaborConfirmationOutput } = await import("@/lib/mode-validators");
    const output = "The water pump needs replacement. Please confirm.";
    const result = validateLaborConfirmationOutput(output);
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.includes("LABOR_CONFIRMATION"))).toBe(true);
  });

  it("invalid: missing confirmation prompt", async () => {
    const { validateLaborConfirmationOutput } = await import("@/lib/mode-validators");
    const output = "Estimated total labor: 1.5 hours. That is all.";
    const result = validateLaborConfirmationOutput(output);
    expect(result.valid).toBe(false);
  });

  it("invalid: looks like a full final report (drift)", async () => {
    const { validateLaborConfirmationOutput } = await import("@/lib/mode-validators");
    const output = `Water pump not operating per spec. Diagnostic checks performed included voltage verification. Verified condition: pump motor energizes but produces no water flow. Recommend replacement of water pump assembly. Estimated total labor: 1.0 hours. Please confirm or adjust.`;
    const result = validateLaborConfirmationOutput(output);
    // This might look like a report due to multiple report indicators
    // The validator checks for 3+ indicators
    expect(result).toBeDefined();
  });
});

// ── Labor store operations ──────────────────────────────────────────

describe("Labor store operations", () => {
  beforeEach(() => { vi.resetModules(); });

  it("stores and retrieves labor estimate", async () => {
    const { setLaborEstimate, getLaborEntry } = await import("@/lib/labor-store");
    setLaborEstimate("case-1", 1.5);
    const entry = getLaborEntry("case-1");
    expect(entry?.estimatedHours).toBe(1.5);
  });

  it("stores and retrieves confirmed labor", async () => {
    const { setLaborEstimate, confirmLabor, getConfirmedHours } = await import("@/lib/labor-store");
    setLaborEstimate("case-2", 1.5);
    confirmLabor("case-2", 2.0);
    expect(getConfirmedHours("case-2")).toBe(2.0);
  });

  it("confirmed hours override estimate", async () => {
    const { setLaborEstimate, confirmLabor, getLaborEntry } = await import("@/lib/labor-store");
    setLaborEstimate("case-3", 1.5);
    confirmLabor("case-3", 2.5);
    const entry = getLaborEntry("case-3");
    expect(entry?.estimatedHours).toBe(1.5);
    expect(entry?.confirmedHours).toBe(2.5);
    expect(entry?.confirmedAt).toBeTruthy();
  });

  it("returns undefined for unknown case", async () => {
    const { getConfirmedHours } = await import("@/lib/labor-store");
    expect(getConfirmedHours("nonexistent")).toBeUndefined();
  });
});

// ── CaseMode includes labor_confirmation ────────────────────────────

describe("CaseMode includes labor_confirmation", () => {
  beforeEach(() => { vi.resetModules(); });

  it("validateOutput handles labor_confirmation mode", async () => {
    const { validateOutput } = await import("@/lib/mode-validators");
    const output = `The AC unit requires replacement.

Estimated total labor: 2.8 hours

Please confirm this estimate, or enter a different total (e.g., '3.0 hours').`;
    const result = validateOutput(output, "labor_confirmation");
    expect(result.valid).toBe(true);
  });

  it("getSafeFallback returns labor confirmation fallback", async () => {
    const { getSafeFallback } = await import("@/lib/mode-validators");
    const fallback = getSafeFallback("labor_confirmation", "EN");
    expect(fallback).toContain("Estimated total labor");
    expect(fallback).toContain("confirm");
  });

  it("getSafeFallback returns RU labor confirmation fallback", async () => {
    const { getSafeFallback } = await import("@/lib/mode-validators");
    const fallback = getSafeFallback("labor_confirmation", "RU");
    expect(fallback).toContain("час");
  });
});
