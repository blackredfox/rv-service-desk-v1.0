import { describe, it, expect, beforeEach, vi } from "vitest";

// Test the water heater procedure and diagnostic flow

describe("Water Heater Diagnostic Procedure", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("Procedure Structure", () => {
    it("should have water_heater procedure registered", async () => {
      const { getProcedure, detectSystem } = await import("@/lib/diagnostic-procedures");
      
      // Test pattern detection
      expect(detectSystem("водонагреватель не работает")).toBe("water_heater");
      expect(detectSystem("water heater not working")).toBe("water_heater");
      expect(detectSystem("Suburban gas water heater")).toBe("water_heater");
      expect(detectSystem("бойлер сломался")).toBe("water_heater");
      
      // Test procedure exists
      const proc = getProcedure("water_heater");
      expect(proc).not.toBeNull();
      expect(proc?.displayName).toBe("Water Heater (Gas/Combo)");
      expect(proc?.complex).toBe(true);
    });

    it("should have at least 10 diagnostic steps", async () => {
      const { getProcedure } = await import("@/lib/diagnostic-procedures");
      const proc = getProcedure("water_heater");
      
      expect(proc?.steps.length).toBeGreaterThanOrEqual(10);
    });

    it("should have correct step prerequisites", async () => {
      const { getProcedure } = await import("@/lib/diagnostic-procedures");
      const proc = getProcedure("water_heater");
      
      // Step 1 should have no prerequisites
      const step1 = proc?.steps.find(s => s.id === "wh_1");
      expect(step1?.prerequisites).toHaveLength(0);
      
      // LP tank check should require step 1
      const step2 = proc?.steps.find(s => s.id === "wh_2");
      expect(step2?.prerequisites).toContain("wh_1");
      
      // Other LP appliances check should require step 2
      const step3 = proc?.steps.find(s => s.id === "wh_3");
      expect(step3?.prerequisites).toContain("wh_2");
    });

    it("should have howToCheck for key steps", async () => {
      const { getProcedure } = await import("@/lib/diagnostic-procedures");
      const proc = getProcedure("water_heater");
      
      const step1 = proc?.steps.find(s => s.id === "wh_1");
      expect(step1?.howToCheck).toBeDefined();
      expect(step1?.howToCheck?.length).toBeGreaterThan(10);
    });
  });

  describe("Key Finding Detection", () => {
    it("should detect damaged orifice in Russian", async () => {
      const { detectKeyFinding } = await import("@/lib/diagnostic-registry");
      
      const result = detectKeyFinding("форсунка обгорела и разваливается");
      expect(result).toBeDefined();
      expect(result).toContain("orifice");
    });

    it("should detect burner blockage", async () => {
      const { detectKeyFinding } = await import("@/lib/diagnostic-registry");
      
      expect(detectKeyFinding("burner tube is blocked with spider webs")).toBeDefined();
      expect(detectKeyFinding("burner засорен")).toBeDefined();
    });

    it("should detect gas valve failure", async () => {
      const { detectKeyFinding } = await import("@/lib/diagnostic-registry");
      
      expect(detectKeyFinding("gas valve stuck closed")).toBeDefined();
      expect(detectKeyFinding("газовый клапан не открывается")).toBeDefined();
    });

    it("should detect thermocouple failure", async () => {
      const { detectKeyFinding } = await import("@/lib/diagnostic-registry");
      
      expect(detectKeyFinding("thermocouple reading 0 mV")).toBeDefined();
    });

    it("should detect no LP pressure", async () => {
      const { detectKeyFinding } = await import("@/lib/diagnostic-registry");
      
      const result = detectKeyFinding("no pressure at regulator, 0 PSI");
      expect(result).toBeDefined();
    });
  });

  describe("Step Sequencing", () => {
    it("should return steps in correct order based on prerequisites", async () => {
      const { getProcedure, getNextStep } = await import("@/lib/diagnostic-procedures");
      const proc = getProcedure("water_heater")!;
      
      // Start with no completed steps
      let next = getNextStep(proc, new Set(), new Set());
      expect(next?.id).toBe("wh_1"); // System type identification
      
      // After step 1 is complete
      next = getNextStep(proc, new Set(["wh_1"]), new Set());
      expect(next?.id).toBe("wh_2"); // LP tank level
      
      // After step 2 is complete
      next = getNextStep(proc, new Set(["wh_1", "wh_2"]), new Set());
      expect(next?.id).toBe("wh_3"); // Other LP appliances
    });

    it("should skip steps with unmet prerequisites", async () => {
      const { getProcedure, getNextStep } = await import("@/lib/diagnostic-procedures");
      const proc = getProcedure("water_heater")!;
      
      // Mark step 2 as unable (can't check LP level)
      // This makes wh_3 prereqs met (wh_2 is in unable = doneOrSkipped)
      // So next should be wh_3
      const next = getNextStep(proc, new Set(["wh_1"]), new Set(["wh_2"]));
      
      // wh_3 prereqs: ["wh_2"] - wh_2 is in unableIds, so prereqsMet = true
      expect(next?.id).toBe("wh_3");
    });
  });

  describe("Procedure Context Building", () => {
    it("should build correct context with active step only", async () => {
      const { getProcedure, buildProcedureContext } = await import("@/lib/diagnostic-procedures");
      const proc = getProcedure("water_heater")!;
      
      const context = buildProcedureContext(
        proc, 
        new Set(["wh_1", "wh_2"]), 
        new Set(),
        { activeStepId: "wh_3" },
      );
      
      // Should show the active step question
      expect(context).toContain("CURRENT STEP: wh_3");
      expect(context).toContain("Ask EXACTLY:");
      
      // Should NOT show completed steps list (authoritative mode)
      expect(context).not.toContain("[DONE]");
      
      // Should show progress (now 21 steps with branch steps)
      expect(context).toMatch(/2\/\d+/);
    });

    it("should show ALL STEPS COMPLETE when procedure finished", async () => {
      const { getProcedure, buildProcedureContext } = await import("@/lib/diagnostic-procedures");
      const proc = getProcedure("water_heater")!;
      
      const allStepIds = new Set(proc.steps.map(s => s.id));
      const context = buildProcedureContext(proc, allStepIds, new Set());
      
      expect(context).toContain("ALL STEPS COMPLETE");
      expect(context).toContain("START FINAL REPORT");
      expect(context).not.toContain("[TRANSITION:");
    });
  });
});

describe("Anti-Loop Step Completion", () => {
  beforeEach(async () => {
    vi.resetModules();
    // Clear any existing registry state
    const { clearRegistry } = await import("@/lib/diagnostic-registry");
    clearRegistry("test_case_1");
  });

  it("should mark step as completed when technician answers", async () => {
    const { 
      processMessage, 
      getOrCreateContext, 
      updateContext 
    } = await import("@/lib/context-engine");
    const { DEFAULT_CONFIG } = await import("@/lib/context-engine/types");
    const { initializeCase } = await import("@/lib/diagnostic-registry");
    
    // Initialize a water heater case so registry knows the procedure
    initializeCase("test_case_1", "водонагреватель не работает");
    
    // Create context with active step
    const context = getOrCreateContext("test_case_1");
    context.activeProcedureId = "water_heater";
    context.activeStepId = "wh_2";
    context.completedSteps.add("wh_1"); // wh_1 already done
    updateContext(context);
    
    // Process a diagnostic answer
    const result = processMessage("test_case_1", "да, уровень в норме", DEFAULT_CONFIG);
    
    // Step should be marked as completed
    expect(result.context.completedSteps.has("wh_2")).toBe(true);
    // Next step should be immediately assigned (not null)
    expect(result.context.activeStepId).not.toBeNull();
    expect(result.notices.some(n => n.includes("COMPLETED"))).toBe(true);
    expect(result.notices.some(n => n.includes("Next step assigned"))).toBe(true);
  });

  it("should mark step as unable when technician cannot verify", async () => {
    const { 
      processMessage, 
      getOrCreateContext, 
      updateContext 
    } = await import("@/lib/context-engine");
    const { DEFAULT_CONFIG } = await import("@/lib/context-engine/types");
    const { initializeCase } = await import("@/lib/diagnostic-registry");
    
    // Initialize so registry knows the procedure
    initializeCase("test_case_2", "водонагреватель не работает");
    
    const context = getOrCreateContext("test_case_2");
    context.activeProcedureId = "water_heater";
    context.activeStepId = "wh_3";
    context.completedSteps.add("wh_1");
    context.completedSteps.add("wh_2");
    updateContext(context);
    
    // Process an "unable to verify" answer
    const result = processMessage("test_case_2", "не могу проверить, нет доступа", DEFAULT_CONFIG);
    
    // Step should be marked as unable
    expect(result.context.unableSteps.has("wh_3")).toBe(true);
    // Next step should be immediately assigned (not null)
    expect(result.context.activeStepId).not.toBeNull();
  });

  it("should recognize 'already answered' and move forward", async () => {
    const { 
      processMessage, 
      getOrCreateContext, 
      updateContext 
    } = await import("@/lib/context-engine");
    const { DEFAULT_CONFIG } = await import("@/lib/context-engine/types");
    const { initializeCase } = await import("@/lib/diagnostic-registry");
    
    initializeCase("test_case_3", "водонагреватель не работает");
    
    const context = getOrCreateContext("test_case_3");
    context.activeProcedureId = "water_heater";
    context.activeStepId = "wh_5";
    context.completedSteps.add("wh_1");
    updateContext(context);
    
    // Process "already answered" message
    const result = processMessage("test_case_3", "я уже ответил на это, все клапаны открыты", DEFAULT_CONFIG);
    
    // Should recognize and mark as completed
    expect(result.intent.type).toBe("ALREADY_ANSWERED");
    expect(result.context.completedSteps.has("wh_5")).toBe(true);
  });

  it("should sync completion to registry", async () => {
    const { 
      processMessage, 
      getOrCreateContext, 
      updateContext 
    } = await import("@/lib/context-engine");
    const { DEFAULT_CONFIG } = await import("@/lib/context-engine/types");
    const { initializeCase, buildRegistryContext } = await import("@/lib/diagnostic-registry");
    
    // Initialize a water heater case
    initializeCase("test_case_4", "водонагреватель не работает");
    
    const context = getOrCreateContext("test_case_4");
    context.activeProcedureId = "water_heater";
    context.activeStepId = "wh_1";
    updateContext(context);
    
    // Answer the first step
    const result = processMessage("test_case_4", "газовый Suburban", DEFAULT_CONFIG);
    
    // Step wh_1 should be completed
    expect(result.context.completedSteps.has("wh_1")).toBe(true);
    
    // Next step should be assigned
    expect(result.context.activeStepId).not.toBeNull();
    
    // Registry context should show the active step (not completed list)
    const registryContext = buildRegistryContext("test_case_4", result.context.activeStepId);
    expect(registryContext).toContain("CURRENT STEP:");
  });
});

describe("Language Consistency Validation", () => {
  it("should detect English output in Russian session", async () => {
    const { validateLanguageConsistency } = await import("@/lib/mode-validators");
    
    const result = validateLanguageConsistency(
      "Step 1: What type of water heater is installed? Gas, electric, or combo?",
      "RU"
    );
    
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.includes("LANGUAGE_MISMATCH"))).toBe(true);
  });

  it("should accept Russian output in Russian session", async () => {
    const { validateLanguageConsistency } = await import("@/lib/mode-validators");
    
    const result = validateLanguageConsistency(
      "Шаг 1: Какой тип водонагревателя установлен? (газовый, электрический, комбинированный)",
      "RU"
    );
    
    expect(result.valid).toBe(true);
  });

  it("should detect Cyrillic in English session", async () => {
    const { validateLanguageConsistency } = await import("@/lib/mode-validators");
    
    const result = validateLanguageConsistency(
      "Step 1: Какой тип водонагревателя?",
      "EN"
    );
    
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.includes("LANGUAGE_MISMATCH"))).toBe(true);
  });

  it("should accept English output in English session", async () => {
    const { validateLanguageConsistency } = await import("@/lib/mode-validators");
    
    const result = validateLanguageConsistency(
      "Step 1: What type of water heater is installed? Gas, electric, or combo?",
      "EN"
    );
    
    expect(result.valid).toBe(true);
  });
});

describe("No Auto Final Report", () => {
  it("should block isolation complete language", async () => {
    const { validateDiagnosticOutput } = await import("@/lib/mode-validators");
    
    const result = validateDiagnosticOutput(
      "Принято. Изоляция завершена. Условия выполнены."
    );
    
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.includes("ISOLATION_DECLARATION_BLOCKED"))).toBe(true);
  });

  it("should block transition markers", async () => {
    const { validateDiagnosticOutput } = await import("@/lib/mode-validators");
    
    const result = validateDiagnosticOutput(
      "Finding noted. Ready to transition. [TRANSITION: FINAL_REPORT]"
    );
    
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.includes("TRANSITION_MARKER_BLOCKED"))).toBe(true);
  });

  it("should allow normal diagnostic output with question", async () => {
    const { validateDiagnosticOutput } = await import("@/lib/mode-validators");
    
    const result = validateDiagnosticOutput(
      "Принято. Давление 0 на манометре — ключевое наблюдение.\n\nШаг 3: Работают ли другие LP-приборы (плита, холодильник)?");
    
    expect(result.valid).toBe(true);
  });
});

describe("Clarification Returns to Same Step", () => {
  beforeEach(async () => {
    vi.resetModules();
    const { clearRegistry } = await import("@/lib/diagnostic-registry");
    clearRegistry("clarification_test");
  });

  it("should return to same step after clarification", async () => {
    const { 
      processMessage, 
      getOrCreateContext, 
      updateContext,
      isInClarificationSubflow,
    } = await import("@/lib/context-engine");
    const { DEFAULT_CONFIG } = await import("@/lib/context-engine/types");
    
    const context = getOrCreateContext("clarification_test");
    context.activeStepId = "wh_6";
    updateContext(context);
    
    // Ask a clarification question
    const result1 = processMessage("clarification_test", "как проверить искру?", DEFAULT_CONFIG);
    
    // Should enter clarification subflow
    expect(isInClarificationSubflow(result1.context)).toBe(true);
    
    // Active step should still be the same
    expect(result1.context.activeStepId).toBe("wh_6");
    
    // Step should NOT be marked complete
    expect(result1.context.completedSteps.has("wh_6")).toBe(false);
  });
});

describe("Authoritative Step Progression", () => {
  beforeEach(async () => {
    vi.resetModules();
    const { clearRegistry } = await import("@/lib/diagnostic-registry");
    const { clearContext } = await import("@/lib/context-engine");
    clearRegistry("auth_prog_1");
    clearContext("auth_prog_1");
  });

  it("engine assigns first step automatically when procedure is active", async () => {
    const { 
      processMessage, 
      getOrCreateContext, 
      updateContext 
    } = await import("@/lib/context-engine");
    const { DEFAULT_CONFIG } = await import("@/lib/context-engine/types");
    const { initializeCase } = await import("@/lib/diagnostic-registry");
    
    // Initialize the procedure
    initializeCase("auth_prog_1", "водонагреватель не работает");
    
    // Create context with no active step
    const context = getOrCreateContext("auth_prog_1");
    context.activeProcedureId = "water_heater";
    context.activeStepId = null;
    updateContext(context);
    
    // Process any message — the engine should assign the first step
    const result = processMessage("auth_prog_1", "начнём диагностику", DEFAULT_CONFIG);
    
    // The active step should be wh_1 (first step)
    expect(result.context.activeStepId).toBe("wh_1");
    expect(result.notices.some(n => n.includes("Active step initialized: wh_1"))).toBe(true);
  });

  it("completes a full 3-step sequence without losing track", async () => {
    const { 
      processMessage, 
      getOrCreateContext, 
      updateContext 
    } = await import("@/lib/context-engine");
    const { DEFAULT_CONFIG } = await import("@/lib/context-engine/types");
    const { initializeCase, buildRegistryContext } = await import("@/lib/diagnostic-registry");
    
    // Initialize the procedure
    initializeCase("auth_prog_1", "водонагреватель не работает");
    
    const context = getOrCreateContext("auth_prog_1");
    context.activeProcedureId = "water_heater";
    context.activeStepId = "wh_1";
    updateContext(context);
    
    // Step 1: Answer — "gas Suburban"
    const r1 = processMessage("auth_prog_1", "газовый Suburban", DEFAULT_CONFIG);
    expect(r1.context.completedSteps.has("wh_1")).toBe(true);
    expect(r1.context.activeStepId).toBe("wh_2"); // next step
    
    // Step 2: Answer — "tank is full, valve open"
    const r2 = processMessage("auth_prog_1", "бак полный, клапан открыт", DEFAULT_CONFIG);
    expect(r2.context.completedSteps.has("wh_2")).toBe(true);
    expect(r2.context.activeStepId).toBe("wh_3"); // next step
    
    // Step 3: Answer — "yes, stove works"
    const r3 = processMessage("auth_prog_1", "да, плита работает", DEFAULT_CONFIG);
    expect(r3.context.completedSteps.has("wh_3")).toBe(true);
    expect(r3.context.activeStepId).toBe("wh_4"); // next step
    
    // Verify the prompt context only shows the active step
    const promptCtx = buildRegistryContext("auth_prog_1", r3.context.activeStepId);
    expect(promptCtx).toContain("CURRENT STEP: wh_4");
    expect(promptCtx).not.toContain("[DONE]");
    expect(promptCtx).not.toContain("wh_1:");
    expect(promptCtx).not.toContain("wh_2:");
    expect(promptCtx).not.toContain("wh_3:");
  });

  it("step completion matches only against active step, not all steps", async () => {
    const { 
      processMessage, 
      getOrCreateContext, 
      updateContext 
    } = await import("@/lib/context-engine");
    const { DEFAULT_CONFIG } = await import("@/lib/context-engine/types");
    const { initializeCase } = await import("@/lib/diagnostic-registry");
    
    initializeCase("auth_prog_1", "водонагреватель не работает");
    
    const context = getOrCreateContext("auth_prog_1");
    context.activeProcedureId = "water_heater";
    context.activeStepId = "wh_1"; // Only step 1 is active
    updateContext(context);
    
    // Answer wh_1 with a message. Even though the answer looks like it could match
    // voltage patterns (wh_5), only the active step wh_1 should be completed.
    const result = processMessage("auth_prog_1", "газовый тип, Suburban модель", DEFAULT_CONFIG);
    
    expect(result.context.completedSteps.has("wh_1")).toBe(true);
    expect(result.context.completedSteps.has("wh_5")).toBe(false); // NOT completed
    // Next step should be wh_2 (not skip to wh_6)
    expect(result.context.activeStepId).toBe("wh_2");
  });

  it("never resets activeStepId to null mid-procedure", async () => {
    const { 
      processMessage, 
      getOrCreateContext, 
      updateContext 
    } = await import("@/lib/context-engine");
    const { DEFAULT_CONFIG } = await import("@/lib/context-engine/types");
    const { initializeCase } = await import("@/lib/diagnostic-registry");
    
    initializeCase("auth_prog_1", "водонагреватель не работает");
    
    const context = getOrCreateContext("auth_prog_1");
    context.activeProcedureId = "water_heater";
    context.activeStepId = "wh_1";
    updateContext(context);
    
    // Complete first 4 steps
    const steps = [
      "газовый бойлер",
      "бак полный, вентиль открыт",
      "да, плита работает",
      "клапан открыт",
    ];
    
    let lastResult;
    for (const answer of steps) {
      lastResult = processMessage("auth_prog_1", answer, DEFAULT_CONFIG);
      // After each step, activeStepId must NOT be null (unless all done)
      // Note: with branches, step count is dynamic
      const doneCount = lastResult.context.completedSteps.size + lastResult.context.unableSteps.size;
      // Only assert if there are clearly more steps to do
      if (doneCount < 10) {
        expect(lastResult.context.activeStepId).not.toBeNull();
      }
    }
  });
});

