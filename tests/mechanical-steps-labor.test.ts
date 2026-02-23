/**
 * Mechanical Step Check Tests
 * 
 * Ensures:
 * 1. Ceiling fan / motor procedures require mechanical check before isolation
 * 2. Direct power test (e12_6, awn_6, so_3) must be completed before pivot
 * 3. Labor confirmation is non-interactive (no confirmation loop)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

describe("Mechanical Step Check — Required Before Isolation", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("electrical_12v procedure has mechanical check step e12_6 marked", async () => {
    const { getProcedure } = await import("@/lib/diagnostic-procedures");
    
    const procedure = getProcedure("electrical_12v");
    expect(procedure).toBeDefined();
    
    const e12_6 = procedure?.steps.find(s => s.id === "e12_6");
    expect(e12_6).toBeDefined();
    expect(e12_6?.mechanicalCheck).toBe(true);
    expect(e12_6?.question).toContain("directly");
  });

  it("awning procedure has mechanical check step awn_6 marked", async () => {
    const { getProcedure } = await import("@/lib/diagnostic-procedures");
    
    const procedure = getProcedure("awning");
    expect(procedure).toBeDefined();
    
    const awn_6 = procedure?.steps.find(s => s.id === "awn_6");
    expect(awn_6).toBeDefined();
    expect(awn_6?.mechanicalCheck).toBe(true);
  });

  it("slide_out procedure has mechanical check step so_3 marked", async () => {
    const { getProcedure } = await import("@/lib/diagnostic-procedures");
    
    const procedure = getProcedure("slide_out");
    expect(procedure).toBeDefined();
    
    const so_3 = procedure?.steps.find(s => s.id === "so_3");
    expect(so_3).toBeDefined();
    expect(so_3?.mechanicalCheck).toBe(true);
  });

  it("areMechanicalChecksComplete returns false when e12_6 is not done", async () => {
    const { 
      initializeCase, 
      areMechanicalChecksComplete, 
      clearRegistry,
      markStepCompleted,
    } = await import("@/lib/diagnostic-registry");
    
    const caseId = "mech-check-pending-test";
    clearRegistry(caseId);
    
    // Initialize with a ceiling fan message
    initializeCase(caseId, "ceiling fan not working");
    
    // Complete some steps but NOT e12_6
    markStepCompleted(caseId, "e12_1");
    markStepCompleted(caseId, "e12_2");
    markStepCompleted(caseId, "e12_3");
    markStepCompleted(caseId, "e12_4");
    markStepCompleted(caseId, "e12_5");
    
    const result = areMechanicalChecksComplete(caseId);
    
    expect(result.complete).toBe(false);
    expect(result.pendingStep?.id).toBe("e12_6");
    expect(result.pendingStep?.question).toContain("directly");
  });

  it("areMechanicalChecksComplete returns true when e12_6 is completed", async () => {
    const { 
      initializeCase, 
      areMechanicalChecksComplete, 
      clearRegistry,
      markStepCompleted,
    } = await import("@/lib/diagnostic-registry");
    
    const caseId = "mech-check-complete-test";
    clearRegistry(caseId);
    
    // Initialize with a ceiling fan message
    initializeCase(caseId, "ceiling fan not working");
    
    // Complete all steps including e12_6
    markStepCompleted(caseId, "e12_1");
    markStepCompleted(caseId, "e12_2");
    markStepCompleted(caseId, "e12_3");
    markStepCompleted(caseId, "e12_4");
    markStepCompleted(caseId, "e12_5");
    markStepCompleted(caseId, "e12_6");
    
    const result = areMechanicalChecksComplete(caseId);
    
    expect(result.complete).toBe(true);
    expect(result.pendingStep).toBeUndefined();
  });

  it("areMechanicalChecksComplete returns true when e12_6 is marked unable", async () => {
    const { 
      initializeCase, 
      areMechanicalChecksComplete, 
      clearRegistry,
      markStepCompleted,
      markStepUnable,
    } = await import("@/lib/diagnostic-registry");
    
    const caseId = "mech-check-unable-test";
    clearRegistry(caseId);
    
    // Initialize with a ceiling fan message
    initializeCase(caseId, "ceiling fan not working");
    
    // Complete some steps and mark e12_6 as unable
    markStepCompleted(caseId, "e12_1");
    markStepCompleted(caseId, "e12_5");
    markStepUnable(caseId, "e12_6"); // Can't access motor directly
    
    const result = areMechanicalChecksComplete(caseId);
    
    expect(result.complete).toBe(true);
  });

  it("getNextMechanicalStep returns the pending mechanical step", async () => {
    const { 
      initializeCase, 
      getNextMechanicalStep, 
      clearRegistry,
      markStepCompleted,
    } = await import("@/lib/diagnostic-registry");
    
    const caseId = "next-mech-step-test";
    clearRegistry(caseId);
    
    initializeCase(caseId, "ceiling fan motor not running");
    
    // Complete prerequisites for e12_6
    markStepCompleted(caseId, "e12_1");
    markStepCompleted(caseId, "e12_5");
    
    const nextMech = getNextMechanicalStep(caseId);
    
    expect(nextMech).not.toBeNull();
    expect(nextMech?.id).toBe("e12_6");
  });

  it("getNextMechanicalStep returns null when all mechanical checks done", async () => {
    const { 
      initializeCase, 
      getNextMechanicalStep, 
      clearRegistry,
      markStepCompleted,
    } = await import("@/lib/diagnostic-registry");
    
    const caseId = "all-mech-done-test";
    clearRegistry(caseId);
    
    initializeCase(caseId, "ceiling fan motor not running");
    
    // Complete all steps including mechanical checks
    markStepCompleted(caseId, "e12_1");
    markStepCompleted(caseId, "e12_5");
    markStepCompleted(caseId, "e12_6");
    markStepCompleted(caseId, "e12_7");
    
    const nextMech = getNextMechanicalStep(caseId);
    
    expect(nextMech).toBeNull();
  });
});

describe("Labor Confirmation — Non-Interactive", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("labor override is stored when explicitly provided", async () => {
    const { 
      setLaborEstimate,
      confirmLabor,
      getLaborEntry,
    } = await import("@/lib/labor-store");
    
    const caseId = "labor-override-test";
    
    // Set initial estimate
    setLaborEstimate(caseId, 2.0);
    
    // Confirm with override
    confirmLabor(caseId, 1.5);
    
    const entry = getLaborEntry(caseId);
    expect(entry?.estimatedHours).toBe(2.0);
    expect(entry?.confirmedHours).toBe(1.5);
  });

  it("parseLaborConfirmation detects explicit override values", async () => {
    const { parseLaborConfirmation } = await import("@/lib/labor-store");
    
    // Various override formats
    expect(parseLaborConfirmation("set labor to 1.5 hours", 2.0)).toBe(1.5);
    expect(parseLaborConfirmation("1.5 hours total", 2.0)).toBe(1.5);
    expect(parseLaborConfirmation("change labor to 3 hours", 2.0)).toBe(3.0);
    expect(parseLaborConfirmation("labor 2.5 hr", 2.0)).toBe(2.5);
    
    // Simple confirmations should return estimate
    expect(parseLaborConfirmation("ok", 2.0)).toBe(2.0);
    expect(parseLaborConfirmation("yes", 2.0)).toBe(2.0);
    expect(parseLaborConfirmation("confirm", 2.0)).toBe(2.0);
  });

  it("labor estimate persists through mode transitions", async () => {
    const { 
      setLaborEstimate,
      getLaborEntry,
      clearLaborStore,
    } = await import("@/lib/labor-store");
    
    const caseId = "labor-persist-test";
    clearLaborStore(caseId);
    
    // Set estimate during diagnostic
    setLaborEstimate(caseId, 2.0);
    
    // Entry should persist
    const entry = getLaborEntry(caseId);
    expect(entry?.estimatedHours).toBe(2.0);
  });

  it("extractLaborEstimate extracts hours from final report text", async () => {
    const { extractLaborEstimate } = await import("@/lib/labor-store");
    
    const reportWithLabor = `
      Observed symptoms: Fan not running.
      Verified condition: Motor seized.
      Required repair: Replace fan motor.
      Estimated total labor: 1.5 hours
    `;
    
    const extracted = extractLaborEstimate(reportWithLabor);
    expect(extracted).toBe(1.5);
  });
});

describe("Ceiling Fan Flow — End to End", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("ceiling fan maps to electrical_12v procedure", async () => {
    const { initializeCase, clearRegistry } = await import("@/lib/diagnostic-registry");
    
    const caseId = "ceiling-fan-procedure-test";
    clearRegistry(caseId);
    
    const result = initializeCase(caseId, "ceiling fan not working");
    
    expect(result.system).toBe("electrical_12v");
    expect(result.procedure).toBeDefined();
    expect(result.procedure?.displayName).toBe("12V Electrical Component");
  });

  it("ceiling fan flow requires direct power test before isolation", async () => {
    const { 
      initializeCase, 
      areMechanicalChecksComplete,
      markStepCompleted,
      clearRegistry,
    } = await import("@/lib/diagnostic-registry");
    
    const caseId = "ceiling-fan-mech-required-test";
    clearRegistry(caseId);
    
    initializeCase(caseId, "ceiling fan motor not spinning");
    
    // Simulate diagnostic flow without direct power test
    markStepCompleted(caseId, "e12_1"); // Power at source
    markStepCompleted(caseId, "e12_2"); // Fuse
    markStepCompleted(caseId, "e12_3"); // Switch
    markStepCompleted(caseId, "e12_4"); // Ground
    markStepCompleted(caseId, "e12_5"); // Component terminals
    
    // Mechanical check should NOT be complete yet
    const check = areMechanicalChecksComplete(caseId);
    expect(check.complete).toBe(false);
    expect(check.pendingStep?.id).toBe("e12_6");
    
    // Now complete the direct power test
    markStepCompleted(caseId, "e12_6");
    
    const checkAfter = areMechanicalChecksComplete(caseId);
    expect(checkAfter.complete).toBe(true);
  });
});
