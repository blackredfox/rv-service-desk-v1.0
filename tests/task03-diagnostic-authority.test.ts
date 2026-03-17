/**
 * Task 03 Tests — Diagnostic Authority, Equipment Identity, and Retrieval Enrichment
 *
 * Tests:
 * - Part A: Procedure authority hardening (drift guard, "problem not found" resume)
 * - Part B: Water heater gas branch extension
 * - Part C: Equipment identity extraction
 * - Part D: Retrieval enrichment safety
 * - Part E: Prompt contract (enrichment injection)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Part A: Procedure Authority Hardening ────────────────────────────

describe("Part A — Procedure Authority", () => {
  beforeEach(async () => {
    vi.resetModules();
    const { clearRegistry } = await import("@/lib/diagnostic-registry");
    const { clearContext } = await import("@/lib/context-engine");
    clearRegistry("auth_a_1");
    clearContext("auth_a_1");
  });

  it("completed step is never repeated (drift guard)", async () => {
    const {
      processMessage,
      getOrCreateContext,
      updateContext,
    } = await import("@/lib/context-engine");
    const { DEFAULT_CONFIG } = await import("@/lib/context-engine/types");
    const { initializeCase } = await import("@/lib/diagnostic-registry");

    initializeCase("auth_a_1", "water pump not working");

    const ctx = getOrCreateContext("auth_a_1");
    ctx.activeProcedureId = "water_pump";
    ctx.activeStepId = "wp_1";
    updateContext(ctx);

    // Complete wp_1
    const r1 = processMessage("auth_a_1", "pump is silent, no noise", DEFAULT_CONFIG);
    expect(r1.context.completedSteps.has("wp_1")).toBe(true);
    // activeStepId must NOT be wp_1 (completed)
    expect(r1.context.activeStepId).not.toBe("wp_1");

    // Even if we somehow try to set it back, the drift guard should catch it
    const ctx2 = getOrCreateContext("auth_a_1");
    ctx2.activeStepId = "wp_1"; // Force backward drift
    updateContext(ctx2);
    const r2 = processMessage("auth_a_1", "yes, pump is still silent", DEFAULT_CONFIG);
    // Drift guard should have reassigned away from wp_1
    expect(r2.context.activeStepId).not.toBe("wp_1");
  });

  it("clarification returns to same active step", async () => {
    const {
      processMessage,
      getOrCreateContext,
      updateContext,
    } = await import("@/lib/context-engine");
    const { DEFAULT_CONFIG } = await import("@/lib/context-engine/types");
    const { initializeCase } = await import("@/lib/diagnostic-registry");

    initializeCase("auth_a_1", "water pump not working");

    const ctx = getOrCreateContext("auth_a_1");
    ctx.activeProcedureId = "water_pump";
    ctx.activeStepId = "wp_2";
    ctx.completedSteps.add("wp_1");
    updateContext(ctx);

    // Technician asks "where is the pump?" — clarification, not an answer
    const r = processMessage("auth_a_1", "where is the pump located?", DEFAULT_CONFIG);
    // Step should NOT be closed
    expect(r.context.completedSteps.has("wp_2")).toBe(false);
    // Active step should still be wp_2
    expect(r.context.activeStepId).toBe("wp_2");
  });

  it('"problem not found" resumes diagnostics, does not restart', async () => {
    const {
      processMessage,
      getOrCreateContext,
      updateContext,
    } = await import("@/lib/context-engine");
    const { DEFAULT_CONFIG } = await import("@/lib/context-engine/types");
    const { initializeCase, markStepCompleted } = await import("@/lib/diagnostic-registry");

    initializeCase("auth_a_1", "water pump not working");

    // Sync completed steps to both context AND registry
    markStepCompleted("auth_a_1", "wp_1");
    markStepCompleted("auth_a_1", "wp_2");

    const ctx = getOrCreateContext("auth_a_1");
    ctx.activeProcedureId = "water_pump";
    ctx.activeStepId = "wp_3";
    ctx.completedSteps.add("wp_1");
    ctx.completedSteps.add("wp_2");
    updateContext(ctx);

    // Technician says "everything looks normal" — should complete current step
    const r = processMessage("auth_a_1", "looks normal, no corrosion", DEFAULT_CONFIG);
    expect(r.context.completedSteps.has("wp_3")).toBe(true);
    // Should advance, not restart
    expect(r.context.activeStepId).not.toBe("wp_1");
    expect(r.context.activeStepId).not.toBe("wp_2");
    expect(r.context.activeStepId).not.toBe("wp_3");
  });

  it("no backward drift after downstream evidence", async () => {
    const {
      processMessage,
      getOrCreateContext,
      updateContext,
    } = await import("@/lib/context-engine");
    const { DEFAULT_CONFIG } = await import("@/lib/context-engine/types");
    const { initializeCase, markStepCompleted } = await import("@/lib/diagnostic-registry");

    initializeCase("auth_a_1", "water pump not working");

    // Sync completed steps to both context AND registry
    markStepCompleted("auth_a_1", "wp_1");
    markStepCompleted("auth_a_1", "wp_2");
    markStepCompleted("auth_a_1", "wp_3");

    const ctx = getOrCreateContext("auth_a_1");
    ctx.activeProcedureId = "water_pump";
    ctx.activeStepId = "wp_4";
    ctx.completedSteps.add("wp_1");
    ctx.completedSteps.add("wp_2");
    ctx.completedSteps.add("wp_3");
    updateContext(ctx);

    // Complete wp_4
    const r = processMessage("auth_a_1", "no damage, looks clean", DEFAULT_CONFIG);
    expect(r.context.completedSteps.has("wp_4")).toBe(true);
    // Next step must be wp_5, not any earlier step
    expect(r.context.activeStepId).toBe("wp_5");
  });
});

// ── Part B: Water Heater Gas Branch Extension ───────────────────────

describe("Part B — Water Heater Gas Branch", () => {
  it("water heater procedure has upstream restriction steps (wh_13-wh_16)", async () => {
    const { getProcedure } = await import("@/lib/diagnostic-procedures");
    const proc = getProcedure("water_heater")!;

    expect(proc).toBeTruthy();
    const stepIds = proc.steps.map((s) => s.id);
    expect(stepIds).toContain("wh_13");
    expect(stepIds).toContain("wh_14");
    expect(stepIds).toContain("wh_15");
    expect(stepIds).toContain("wh_16");
  });

  it("wh_13 (inlet pressure) depends on wh_8 (gas flow check)", async () => {
    const { getProcedure } = await import("@/lib/diagnostic-procedures");
    const proc = getProcedure("water_heater")!;
    const step13 = proc.steps.find((s) => s.id === "wh_13")!;
    expect(step13.prerequisites).toContain("wh_8");
  });

  it("wh_14 (regulator) depends on wh_13 (inlet pressure)", async () => {
    const { getProcedure } = await import("@/lib/diagnostic-procedures");
    const proc = getProcedure("water_heater")!;
    const step14 = proc.steps.find((s) => s.id === "wh_14")!;
    expect(step14.prerequisites).toContain("wh_13");
  });

  it("wh_16 (kink/blockage) depends on wh_15 (hose routing)", async () => {
    const { getProcedure } = await import("@/lib/diagnostic-procedures");
    const proc = getProcedure("water_heater")!;
    const step16 = proc.steps.find((s) => s.id === "wh_16")!;
    expect(step16.prerequisites).toContain("wh_15");
  });

  it("low-pressure branch continues to upstream restriction path", async () => {
    const { getProcedure, getNextStep } = await import("@/lib/diagnostic-procedures");
    const proc = getProcedure("water_heater")!;

    // Simulate: wh_1 through wh_8 all done
    const completed = new Set(["wh_1", "wh_2", "wh_3", "wh_4", "wh_5", "wh_6", "wh_7", "wh_8"]);
    const next = getNextStep(proc, completed, new Set());

    // With wh_8 done, next eligible step should include wh_9, wh_10, wh_11, wh_12, or wh_13
    // (those whose prerequisites are met)
    expect(next).toBeTruthy();
    // The step should be from the remaining set, not go back
    expect(completed.has(next!.id)).toBe(false);
  });

  it("total water heater steps is 16 after branch extension", async () => {
    const { getProcedure } = await import("@/lib/diagnostic-procedures");
    const proc = getProcedure("water_heater")!;
    expect(proc.steps.length).toBe(16);
  });
});

// ── Part C: Equipment Identity Extraction ───────────────────────────

describe("Part C — Equipment Identity", () => {
  it("should extract manufacturer from message", async () => {
    const { extractEquipmentIdentity } = await import("@/lib/context-engine");
    const id = extractEquipmentIdentity("It's a Suburban gas water heater");
    expect(id.manufacturer).toBe("Suburban");
  });

  it("should extract model from message", async () => {
    const { extractEquipmentIdentity } = await import("@/lib/context-engine");
    const id = extractEquipmentIdentity("газовый Suburban SW6DE");
    expect(id.manufacturer).toBe("Suburban");
    expect(id.model).toBe("SW6DE");
  });

  it("should extract year from message", async () => {
    const { extractEquipmentIdentity } = await import("@/lib/context-engine");
    const id = extractEquipmentIdentity("2019 Suburban SW10DE");
    expect(id.year).toBe(2019);
  });

  it("should extract Atwood model", async () => {
    const { extractEquipmentIdentity } = await import("@/lib/context-engine");
    const id = extractEquipmentIdentity("Atwood G6A-8E water heater");
    expect(id.manufacturer).toBe("Atwood");
    expect(id.model).toBe("G6A-8E");
  });

  it("should handle Russian manufacturer names", async () => {
    const { extractEquipmentIdentity } = await import("@/lib/context-engine");
    const id = extractEquipmentIdentity("бойлер Субурбан, не работает");
    expect(id.manufacturer).toBe("Suburban");
  });

  it("should return nulls for unknown equipment", async () => {
    const { extractEquipmentIdentity } = await import("@/lib/context-engine");
    const id = extractEquipmentIdentity("водонагреватель не работает");
    expect(id.manufacturer).toBeNull();
    expect(id.model).toBeNull();
    expect(id.year).toBeNull();
  });

  it("should store identity in context during processMessage", async () => {
    vi.resetModules();
    const { clearRegistry } = await import("@/lib/diagnostic-registry");
    const { clearContext, processMessage, getOrCreateContext, updateContext } = await import("@/lib/context-engine");
    const { DEFAULT_CONFIG } = await import("@/lib/context-engine/types");
    const { initializeCase } = await import("@/lib/diagnostic-registry");

    clearRegistry("identity_1");
    clearContext("identity_1");
    initializeCase("identity_1", "Suburban SW6DE water heater not lighting");

    const ctx = getOrCreateContext("identity_1");
    ctx.activeProcedureId = "water_heater";
    ctx.activeStepId = "wh_1";
    updateContext(ctx);

    const r = processMessage("identity_1", "газовый Suburban SW6DE", DEFAULT_CONFIG);
    expect(r.context.equipmentIdentity.manufacturer).toBe("Suburban");
    expect(r.context.equipmentIdentity.model).toBe("SW6DE");
  });
});

// ── Part D: Retrieval Safety Tests ──────────────────────────────────

describe("Part D — Retrieval Safety", () => {
  it("manufacturer known → enriched wording appears", async () => {
    const { getStepEnrichment } = await import("@/lib/retrieval-enrichment");
    const result = getStepEnrichment("wh_6", "water_heater", {
      manufacturer: "Suburban",
      model: "SW6DE",
      year: null,
    });
    expect(result).toBeTruthy();
    expect(result!.hint).toContain("spark");
    expect(result!.source).toContain("Suburban");
  });

  it("manufacturer unknown → generic path continues (null)", async () => {
    const { getStepEnrichment } = await import("@/lib/retrieval-enrichment");
    const result = getStepEnrichment("wh_6", "water_heater", {
      manufacturer: null,
      model: null,
      year: null,
    });
    expect(result).toBeNull();
  });

  it("retrieval unavailable (unknown manufacturer) → no crash", async () => {
    const { getStepEnrichment } = await import("@/lib/retrieval-enrichment");
    const result = getStepEnrichment("wh_6", "water_heater", {
      manufacturer: "UnknownBrand",
      model: "X99",
      year: 2020,
    });
    expect(result).toBeNull();
  });

  it("retrieval never changes active step", async () => {
    vi.resetModules();
    const { clearRegistry } = await import("@/lib/diagnostic-registry");
    const { clearContext, processMessage, getOrCreateContext, updateContext } = await import("@/lib/context-engine");
    const { DEFAULT_CONFIG } = await import("@/lib/context-engine/types");
    const { initializeCase, buildRegistryContext } = await import("@/lib/diagnostic-registry");
    const { getStepEnrichment } = await import("@/lib/retrieval-enrichment");

    clearRegistry("retr_1");
    clearContext("retr_1");
    initializeCase("retr_1", "Suburban water heater");

    const ctx = getOrCreateContext("retr_1");
    ctx.activeProcedureId = "water_heater";
    ctx.activeStepId = "wh_5";
    ctx.completedSteps.add("wh_1");
    updateContext(ctx);

    // Get enrichment for a DIFFERENT step (wh_6) — this is allowed but should NOT change activeStepId
    const enrichment = getStepEnrichment("wh_6", "water_heater", {
      manufacturer: "Suburban",
      model: null,
      year: null,
    });
    expect(enrichment).toBeTruthy();

    // Active step remains wh_5 (enrichment is just data, not control)
    const r = processMessage("retr_1", "12.4 volts at the board", DEFAULT_CONFIG);
    // Even after processing, the step that was active should have been wh_5
    expect(r.context.completedSteps.has("wh_5")).toBe(true);
  });

  it("retrieval never causes implicit mode transition", async () => {
    const { getStepEnrichment } = await import("@/lib/retrieval-enrichment");
    // Enrichment for last step in procedure — should not trigger transition
    const result = getStepEnrichment("wh_12", "water_heater", {
      manufacturer: "Suburban",
      model: null,
      year: null,
    });
    // Should return enrichment data, not a transition signal
    if (result) {
      expect(result.hint).not.toContain("[TRANSITION");
      expect(result.hint).not.toContain("isolation complete");
      expect(result.hint).not.toContain("FINAL REPORT");
    }
  });

  it("model-specific enrichment prefers model match", async () => {
    const { getStepEnrichment } = await import("@/lib/retrieval-enrichment");

    // Atwood GC-series should get DSI-specific hint
    const gcResult = getStepEnrichment("wh_6", "water_heater", {
      manufacturer: "Atwood",
      model: "GC6AA-10E",
      year: null,
    });
    expect(gcResult).toBeTruthy();
    expect(gcResult!.hint).toContain("DSI");

    // Atwood G-series should get pilot-specific hint
    const gResult = getStepEnrichment("wh_6", "water_heater", {
      manufacturer: "Atwood",
      model: "G6A-8E",
      year: null,
    });
    expect(gResult).toBeTruthy();
    expect(gResult!.hint).toContain("pilot");
  });
});

// ── Part E: Prompt Contract ─────────────────────────────────────────

describe("Part E — Prompt Contract", () => {
  it("buildProcedureContext includes enrichment slot but not enrichment itself", async () => {
    const { getProcedure, buildProcedureContext } = await import("@/lib/diagnostic-procedures");
    const proc = getProcedure("water_heater")!;

    const ctx = buildProcedureContext(proc, new Set(), new Set(), { activeStepId: "wh_1" });

    // Should contain the active step question
    expect(ctx).toContain("CURRENT STEP: wh_1");
    // Should NOT contain enrichment (that's injected separately in route.ts)
    expect(ctx).not.toContain("EQUIPMENT-SPECIFIC NOTE");
    // Should contain rendering rules
    expect(ctx).toContain("RULES:");
    expect(ctx).toContain("Render the question in the session language");
  });

  it("buildRegistryContext passes activeStepId correctly", async () => {
    const { initializeCase, buildRegistryContext, clearRegistry } = await import("@/lib/diagnostic-registry");
    clearRegistry("prompt_1");
    initializeCase("prompt_1", "water pump not working");
    const ctx = buildRegistryContext("prompt_1", "wp_1");
    expect(ctx).toContain("CURRENT STEP: wp_1");
  });
});
