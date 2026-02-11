import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for the Diagnostic Procedures model.
 *
 * Covers:
 * - detectSystem: identifies system from initial message
 * - getProcedure: returns correct procedure for each system
 * - getNextStep: respects prerequisites and completed/unable steps
 * - mapInitialMessageToSteps: parses initial message for pre-completed steps
 * - buildProcedureContext: generates correct prompt context
 * - LP Gas procedure: pressure test precedes ignition
 */

// ── detectSystem ────────────────────────────────────────────────────

describe("detectSystem", () => {
  beforeEach(() => { vi.resetModules(); });

  it("detects water pump", async () => {
    const { detectSystem } = await import("@/lib/diagnostic-procedures");
    expect(detectSystem("Water pump not working when faucet opened")).toBe("water_pump");
  });

  it("detects furnace", async () => {
    const { detectSystem } = await import("@/lib/diagnostic-procedures");
    expect(detectSystem("Furnace won't ignite")).toBe("furnace");
  });

  it("detects roof AC", async () => {
    const { detectSystem } = await import("@/lib/diagnostic-procedures");
    expect(detectSystem("AC not cooling")).toBe("roof_ac");
  });

  it("detects LP gas", async () => {
    const { detectSystem } = await import("@/lib/diagnostic-procedures");
    expect(detectSystem("LP gas system issue, no flame")).toBe("lp_gas");
  });

  it("detects refrigerator", async () => {
    const { detectSystem } = await import("@/lib/diagnostic-procedures");
    expect(detectSystem("Fridge not cooling")).toBe("refrigerator");
  });

  it("detects slide-out", async () => {
    const { detectSystem } = await import("@/lib/diagnostic-procedures");
    expect(detectSystem("Slide-out won't extend")).toBe("slide_out");
  });

  it("detects leveling system", async () => {
    const { detectSystem } = await import("@/lib/diagnostic-procedures");
    expect(detectSystem("Leveling jack system not responding")).toBe("leveling");
  });

  it("detects inverter/converter", async () => {
    const { detectSystem } = await import("@/lib/diagnostic-procedures");
    expect(detectSystem("Inverter not producing AC output")).toBe("inverter_converter");
  });

  it("detects consumer appliance", async () => {
    const { detectSystem } = await import("@/lib/diagnostic-procedures");
    expect(detectSystem("TV won't turn on")).toBe("consumer_appliance");
  });

  it("returns null for unknown system", async () => {
    const { detectSystem } = await import("@/lib/diagnostic-procedures");
    expect(detectSystem("Something is wrong")).toBeNull();
  });
});

// ── getProcedure ────────────────────────────────────────────────────

describe("getProcedure", () => {
  beforeEach(() => { vi.resetModules(); });

  it("returns water_pump procedure", async () => {
    const { getProcedure } = await import("@/lib/diagnostic-procedures");
    const proc = getProcedure("water_pump");
    expect(proc).not.toBeNull();
    expect(proc!.system).toBe("water_pump");
    expect(proc!.steps.length).toBeGreaterThan(0);
  });

  it("returns lp_gas procedure with correct step order", async () => {
    const { getProcedure } = await import("@/lib/diagnostic-procedures");
    const proc = getProcedure("lp_gas");
    expect(proc).not.toBeNull();
    expect(proc!.complex).toBe(true);
    // Pressure test (lpg_2) must come before ignition (lpg_5)
    const pressureIdx = proc!.steps.findIndex(s => s.id === "lpg_2");
    const ignitionIdx = proc!.steps.findIndex(s => s.id === "lpg_5");
    expect(pressureIdx).toBeLessThan(ignitionIdx);
  });

  it("returns null for unknown system", async () => {
    const { getProcedure } = await import("@/lib/diagnostic-procedures");
    expect(getProcedure("antigravity_drive")).toBeNull();
  });

  it("all procedures have unique step IDs", async () => {
    const { getProcedure, getRegisteredSystems } = await import("@/lib/diagnostic-procedures");
    for (const system of getRegisteredSystems()) {
      const proc = getProcedure(system)!;
      const ids = proc.steps.map(s => s.id);
      const uniqueIds = new Set(ids);
      expect(ids.length).toBe(uniqueIds.size);
    }
  });
});

// ── getNextStep ─────────────────────────────────────────────────────

describe("getNextStep", () => {
  beforeEach(() => { vi.resetModules(); });

  it("returns first step when nothing completed", async () => {
    const { getProcedure, getNextStep } = await import("@/lib/diagnostic-procedures");
    const proc = getProcedure("water_pump")!;
    const next = getNextStep(proc, new Set(), new Set());
    expect(next).not.toBeNull();
    expect(next!.id).toBe("wp_1");
  });

  it("skips completed steps", async () => {
    const { getProcedure, getNextStep } = await import("@/lib/diagnostic-procedures");
    const proc = getProcedure("water_pump")!;
    const next = getNextStep(proc, new Set(["wp_1"]), new Set());
    expect(next).not.toBeNull();
    expect(next!.id).toBe("wp_2"); // wp_2 has prerequisite wp_1 which is completed
  });

  it("skips unable-to-verify steps", async () => {
    const { getProcedure, getNextStep } = await import("@/lib/diagnostic-procedures");
    const proc = getProcedure("water_pump")!;
    const next = getNextStep(proc, new Set(["wp_1"]), new Set(["wp_2"]));
    expect(next!.id).toBe("wp_3"); // wp_3 has prerequisite wp_1 (completed)
  });

  it("respects prerequisites", async () => {
    const { getProcedure, getNextStep } = await import("@/lib/diagnostic-procedures");
    const proc = getProcedure("lp_gas")!;
    // lpg_2 (pressure) requires lpg_1 (tank check)
    // Without lpg_1 completed, lpg_2 should not be next
    const next = getNextStep(proc, new Set(), new Set());
    expect(next!.id).toBe("lpg_1"); // First step with no prerequisites
  });

  it("LP gas: pressure test before ignition", async () => {
    const { getProcedure, getNextStep } = await import("@/lib/diagnostic-procedures");
    const proc = getProcedure("lp_gas")!;
    // Complete tank check
    let next = getNextStep(proc, new Set(["lpg_1"]), new Set());
    expect(next!.id).toBe("lpg_2"); // Pressure test

    // Complete pressure test + leak test
    next = getNextStep(proc, new Set(["lpg_1", "lpg_2", "lpg_3"]), new Set());
    expect(next!.id).toBe("lpg_4"); // Manual valve

    // Complete valve check
    next = getNextStep(proc, new Set(["lpg_1", "lpg_2", "lpg_3", "lpg_4"]), new Set());
    expect(next!.id).toBe("lpg_5"); // Ignition — only AFTER pressure and valve
  });

  it("returns null when all steps done", async () => {
    const { getProcedure, getNextStep } = await import("@/lib/diagnostic-procedures");
    const proc = getProcedure("water_pump")!;
    const allIds = new Set(proc.steps.map(s => s.id));
    const next = getNextStep(proc, allIds, new Set());
    expect(next).toBeNull();
  });
});

// ── mapInitialMessageToSteps ────────────────────────────────────────

describe("mapInitialMessageToSteps", () => {
  beforeEach(() => { vi.resetModules(); });

  it("maps voltage reading to completed step", async () => {
    const { getProcedure, mapInitialMessageToSteps } = await import("@/lib/diagnostic-procedures");
    const proc = getProcedure("water_pump")!;
    const completed = mapInitialMessageToSteps(
      "Water pump dead. I checked voltage at terminals, 12.4V present. No pump noise at all.",
      proc
    );
    expect(completed).toContain("wp_1"); // pump noise mentioned
    expect(completed).toContain("wp_2"); // voltage measurement mentioned
  });

  it("does not map ambiguous messages", async () => {
    const { getProcedure, mapInitialMessageToSteps } = await import("@/lib/diagnostic-procedures");
    const proc = getProcedure("water_pump")!;
    const completed = mapInitialMessageToSteps("Pump not working", proc);
    // "not working" matches pump_noise but not other specific steps
    expect(completed.length).toBeLessThanOrEqual(1);
  });

  it("maps multiple LP gas steps from detailed initial message", async () => {
    const { getProcedure, mapInitialMessageToSteps } = await import("@/lib/diagnostic-procedures");
    const proc = getProcedure("lp_gas")!;
    const completed = mapInitialMessageToSteps(
      "LP tank is full, valve open. Regulator pressure reads 11 WC. No leaks found at connections. Gas valve at furnace is open.",
      proc
    );
    expect(completed).toContain("lpg_1"); // tank level
    expect(completed).toContain("lpg_2"); // regulator pressure
    expect(completed).toContain("lpg_3"); // leak test
  });
});

// ── buildProcedureContext ───────────────────────────────────────────

describe("buildProcedureContext", () => {
  beforeEach(() => { vi.resetModules(); });

  it("shows next step when nothing completed", async () => {
    const { getProcedure, buildProcedureContext } = await import("@/lib/diagnostic-procedures");
    const proc = getProcedure("water_pump")!;
    const ctx = buildProcedureContext(proc, new Set(), new Set());
    expect(ctx).toContain("ACTIVE DIAGNOSTIC PROCEDURE: Water Pump");
    expect(ctx).toContain("NEXT REQUIRED STEP: wp_1");
    expect(ctx).toContain("Do NOT invent diagnostic steps");
  });

  it("shows completed steps and next step", async () => {
    const { getProcedure, buildProcedureContext } = await import("@/lib/diagnostic-procedures");
    const proc = getProcedure("water_pump")!;
    const ctx = buildProcedureContext(proc, new Set(["wp_1", "wp_2"]), new Set());
    expect(ctx).toContain("[DONE] wp_1");
    expect(ctx).toContain("[DONE] wp_2");
    expect(ctx).toContain("NEXT REQUIRED STEP: wp_3");
    expect(ctx).toContain("Progress: 2/5");
  });

  it("shows unable-to-verify steps", async () => {
    const { getProcedure, buildProcedureContext } = await import("@/lib/diagnostic-procedures");
    const proc = getProcedure("water_pump")!;
    const ctx = buildProcedureContext(proc, new Set(["wp_1"]), new Set(["wp_2"]));
    expect(ctx).toContain("[SKIP] wp_2");
  });

  it("shows 'ALL STEPS COMPLETE' when done", async () => {
    const { getProcedure, buildProcedureContext } = await import("@/lib/diagnostic-procedures");
    const proc = getProcedure("water_pump")!;
    const allIds = new Set(proc.steps.map(s => s.id));
    const ctx = buildProcedureContext(proc, allIds, new Set());
    expect(ctx).toContain("ALL STEPS COMPLETE");
    expect(ctx).toContain("[TRANSITION: FINAL_REPORT]");
  });

  it("prevents cross-system questions", async () => {
    const { getProcedure, buildProcedureContext } = await import("@/lib/diagnostic-procedures");
    const proc = getProcedure("water_pump")!;
    const ctx = buildProcedureContext(proc, new Set(), new Set());
    expect(ctx).toContain("Do NOT ask about systems other than Water Pump");
  });
});

// ── Integration: initializeCase + processUserMessage ────────────────

describe("Integration: procedure-aware registry", () => {
  beforeEach(() => { vi.resetModules(); });

  it("initializes case with procedure from first message", async () => {
    const { initializeCase, clearRegistry } = await import("@/lib/diagnostic-registry");
    clearRegistry("int-1");

    const result = initializeCase("int-1", "Water pump not working, no noise when faucet opens");
    expect(result.system).toBe("water_pump");
    expect(result.procedure).not.toBeNull();
    expect(result.procedure!.displayName).toBe("Water Pump");
  });

  it("pre-completes steps from initial message", async () => {
    const { initializeCase, getRegistryEntry, clearRegistry } = await import("@/lib/diagnostic-registry");
    clearRegistry("int-2");

    initializeCase("int-2", "Water pump dead. Measured 12.4V at pump terminals. Ground is good, 0.2 ohms.");
    const entry = getRegistryEntry("int-2");
    expect(entry?.completedStepIds.has("wp_2")).toBe(true); // voltage
    expect(entry?.completedStepIds.has("wp_3")).toBe(true); // ground
  });

  it("buildRegistryContext uses procedure context when available", async () => {
    const { initializeCase, buildRegistryContext, clearRegistry } = await import("@/lib/diagnostic-registry");
    clearRegistry("int-3");

    initializeCase("int-3", "Furnace won't ignite");
    const ctx = buildRegistryContext("int-3");
    expect(ctx).toContain("ACTIVE DIAGNOSTIC PROCEDURE: Furnace");
    expect(ctx).toContain("NEXT REQUIRED STEP");
  });

  it("falls back to legacy context when no procedure", async () => {
    const { initializeCase, processUserMessage, buildRegistryContext, clearRegistry } = await import("@/lib/diagnostic-registry");
    clearRegistry("int-4");

    initializeCase("int-4", "Something is wrong");
    processUserMessage("int-4", "I checked the voltage, it's 12V");
    const ctx = buildRegistryContext("int-4");
    expect(ctx).toContain("ALREADY ANSWERED");
    expect(ctx).toContain("voltage");
  });

  it("does not re-initialize on second message", async () => {
    const { initializeCase, clearRegistry } = await import("@/lib/diagnostic-registry");
    clearRegistry("int-5");

    const first = initializeCase("int-5", "Water pump dead");
    expect(first.system).toBe("water_pump");

    const second = initializeCase("int-5", "Furnace also broken");
    // Should return same water_pump, not switch to furnace
    expect(second.system).toBe("water_pump");
  });
});

// ── Test scenario: confusing input ──────────────────────────────────

describe("Confusing input handling", () => {
  beforeEach(() => { vi.resetModules(); });

  it("cross-system bait: procedure context restricts to active system", async () => {
    const { initializeCase, buildRegistryContext, clearRegistry } = await import("@/lib/diagnostic-registry");
    clearRegistry("conf-1");

    initializeCase("conf-1", "Water pump not working");
    const ctx = buildRegistryContext("conf-1");
    expect(ctx).toContain("Do NOT ask about systems other than Water Pump");
  });

  it("unknown manufacturer: standard procedure used", async () => {
    const { initializeCase, clearRegistry } = await import("@/lib/diagnostic-registry");
    clearRegistry("conf-2");

    const result = initializeCase("conf-2", "LP gas furnace won't ignite, don't know the model");
    expect(result.procedure).not.toBeNull();
    expect(result.procedure!.variant).toBe("STANDARD");
  });
});
