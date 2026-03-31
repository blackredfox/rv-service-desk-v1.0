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
      const step1 = proc?.steps.find((s) => s.id === "wh_1");
      expect(step1?.prerequisites).toHaveLength(0);

      // LP tank check should require step 1
      const step2 = proc?.steps.find((s) => s.id === "wh_2");
      expect(step2?.prerequisites).toContain("wh_1");

      // Other LP appliances check should require step 2
      const step3 = proc?.steps.find((s) => s.id === "wh_3");
      expect(step3?.prerequisites).toContain("wh_2");
    });

    it("should have howToCheck for key steps", async () => {
      const { getProcedure } = await import("@/lib/diagnostic-procedures");
      const proc = getProcedure("water_heater");

      const step1 = proc?.steps.find((s) => s.id === "wh_1");
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

      // Should show progress (water heater includes branch steps)
      expect(context).toMatch(/2\/\d+/);
    });

    it("should show ALL STEPS COMPLETE when procedure finished", async () => {
      const { getProcedure, buildProcedureContext } = await import("@/lib/diagnostic-procedures");
      const proc = getProcedure("water_heater")!;

      const allStepIds = new Set(proc.steps.map((s) => s.id));
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
    const { clearRegistry } = await import("@/lib/diagnostic-registry");
    clearRegistry("test_case_1");
  });

  it("should mark step as completed when technician answers", async () => {
    const {
      processMessage,
      getOrCreateContext,
      updateContext,
    } = await import("@/lib/context-engine");
    const { DEFAULT_CONFIG } = await import("@/lib/context-engine/types");
    const { initializeCase } = await import("@/lib/diagnostic-registry");

    initializeCase("test_case_1", "водонагреватель не работает");

    const context = getOrCreateContext("test_case_1");
    context.activeProcedureId = "water_heater";
    context.activeStepId = "wh_2";
    context.completedSteps.add("wh_1");
    updateContext(context);

    const result = processMessage("test_case_1", "да, уровень в норме", DEFAULT_CONFIG);

    expect(result.context.completedSteps.has("wh_2")).toBe(true);
    expect(result.context.activeStepId).not.toBeNull();
    expect(result.notices.some((n) => n.includes("COMPLETED"))).toBe(true);
    expect(result.notices.some((n) => n.includes("Next step assigned"))).toBe(true);
  });

  it("should mark step as unable when technician cannot verify", async () => {
    const {
      processMessage,
      getOrCreateContext,
      updateContext,
    } = await import("@/lib/context-engine");
    const { DEFAULT_CONFIG } = await import("@/lib/context-engine/types");
    const { initializeCase } = await import("@/lib/diagnostic-registry");

    initializeCase("test_case_2", "водонагреватель не работает");

    const context = getOrCreateContext("test_case_2");
    context.activeProcedureId = "water_heater";
    context.activeStepId = "wh_3";
    context.completedSteps.add("wh_1");
    context.completedSteps.add("wh_2");
    updateContext(context);

    const result = processMessage("test_case_2", "не могу проверить, нет доступа", DEFAULT_CONFIG);

    expect(result.context.unableSteps.has("wh_3")).toBe(true);
    expect(result.context.activeStepId).not.toBeNull();
  });

  it("should recognize 'already answered' and move forward", async () => {
    const {
      processMessage,
      getOrCreateContext,
      updateContext,
    } = await import("@/lib/context-engine");
    const { DEFAULT_CONFIG } = await import("@/lib/context-engine/types");
    const { initializeCase } = await import("@/lib/diagnostic-registry");

    initializeCase("test_case_3", "водонагреватель не работает");

    const context = getOrCreateContext("test_case_3");
    context.activeProcedureId = "water_heater";
    context.activeStepId = "wh_5";
    context.completedSteps.add("wh_1");
    updateContext(context);

    const result = processMessage("test_case_3", "я уже ответил на это, все клапаны открыты", DEFAULT_CONFIG);

    expect(result.intent.type).toBe("ALREADY_ANSWERED");
    expect(result.context.completedSteps.has("wh_5")).toBe(true);
  });

  it("should sync completion to registry", async () => {
    const {
      processMessage,
      getOrCreateContext,
      updateContext,
    } = await import("@/lib/context-engine");
    const { DEFAULT_CONFIG } = await import("@/lib/context-engine/types");
    const { initializeCase, buildRegistryContext } = await import("@/lib/diagnostic-registry");

    initializeCase("test_case_4", "водонагреватель не работает");

    const context = getOrCreateContext("test_case_4");
    context.activeProcedureId = "water_heater";
    context.activeStepId = "wh_1";
    updateContext(context);

    const result = processMessage("test_case_4", "газовый Suburban", DEFAULT_CONFIG);

    expect(result.context.completedSteps.has("wh_1")).toBe(true);
    expect(result.context.activeStepId).not.toBeNull();

    const registryContext = buildRegistryContext("test_case_4", result.context.activeStepId);
    expect(registryContext).toContain("CURRENT STEP:");
  });
});

describe("Language Consistency Validation", () => {
  it("should detect English output in Russian session", async () => {
    const { validateLanguageConsistency } = await import("@/lib/mode-validators");

    const result = validateLanguageConsistency(
      "Step 1: What type of water heater is installed? Gas, electric, or combo?",
      "RU",
    );

    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes("LANGUAGE_MISMATCH"))).toBe(true);
  });

  it("should accept Russian output in Russian session", async () => {
    const { validateLanguageConsistency } = await import("@/lib/mode-validators");

    const result = validateLanguageConsistency(
      "Шаг 1: Какой тип водонагревателя установлен? (газовый, электрический, комбинированный)",
      "RU",
    );

    expect(result.valid).toBe(true);
  });

  it("should detect Cyrillic in English session", async () => {
    const { validateLanguageConsistency } = await import("@/lib/mode-validators");

    const result = validateLanguageConsistency(
      "Step 1: Какой тип водонагревателя?",
      "EN",
    );

    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes("LANGUAGE_MISMATCH"))).toBe(true);
  });

  it("should accept English output in English session", async () => {
    const { validateLanguageConsistency } = await import("@/lib/mode-validators");

    const result = validateLanguageConsistency(
      "Step 1: What type of water heater is installed? Gas, electric, or combo?",
      "EN",
    );

    expect(result.valid).toBe(true);
  });
});

describe("No Auto Final Report", () => {
  it("should block isolation complete language", async () => {
    const { validateDiagnosticOutput } = await import("@/lib/mode-validators");

    const result = validateDiagnosticOutput(
      "Принято. Изоляция завершена. Условия выполнены.",
    );

    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes("ISOLATION_DECLARATION_BLOCKED"))).toBe(true);
  });

  it("should block transition markers", async () => {
    const { validateDiagnosticOutput } = await import("@/lib/mode-validators");

    const result = validateDiagnosticOutput(
      "Finding noted. Ready to transition. [TRANSITION: FINAL_REPORT]",
    );

    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes("TRANSITION_MARKER_BLOCKED"))).toBe(true);
  });

  it("should allow normal diagnostic output with question", async () => {
    const { validateDiagnosticOutput } = await import("@/lib/mode-validators");

    const result = validateDiagnosticOutput(
      "Принято. Давление 0 на манометре — ключевое наблюдение.\n\nШаг 3: Работают ли другие LP-приборы (плита, холодильник)?",
    );

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

    const result1 = processMessage("clarification_test", "как проверить искру?", DEFAULT_CONFIG);

    expect(isInClarificationSubflow(result1.context)).toBe(true);
    expect(result1.context.activeStepId).toBe("wh_6");
    expect(result1.context.completedSteps.has("wh_6")).toBe(false);
  });
});

describe("Route-Level Clarification Hardening", () => {
  beforeEach(async () => {
    vi.resetModules();
    const { clearRegistry } = await import("@/lib/diagnostic-registry");
    const { clearContext } = await import("@/lib/context-engine");
    clearRegistry("route_clarification_test");
    clearContext("route_clarification_test");
  });

  it("does not advance the active step when technician asks how to check it", async () => {
    const {
      initializeCase,
      markStepCompleted,
      getNextStepId,
      getActiveStepQuestion,
    } = await import("@/lib/diagnostic-registry");
    const {
      getOrCreateContext,
      updateContext,
    } = await import("@/lib/context-engine");
    const { isStepAnswered } = await import("@/lib/mode-validators");

    initializeCase("route_clarification_test", "gas water heater not working");

    ["wh_1", "wh_2", "wh_3", "wh_4"].forEach((stepId) => {
      markStepCompleted("route_clarification_test", stepId);
    });

    const context = getOrCreateContext("route_clarification_test");
    context.activeProcedureId = "water_heater";
    context.activeStepId = "wh_5";
    updateContext(context);

    const clarificationMessage = "How do I check that voltage?";
    const stepQuestion = getActiveStepQuestion("route_clarification_test", "wh_5");

    expect(isStepAnswered(clarificationMessage, stepQuestion)).toBe(false);

    const nextStepBefore = getNextStepId("route_clarification_test");
    expect(nextStepBefore).toBe("wh_5");

    const contextAfter = getOrCreateContext("route_clarification_test");
    expect(contextAfter.activeStepId).toBe("wh_5");
    expect(contextAfter.completedSteps.has("wh_5")).toBe(false);

    const nextStepAfter = getNextStepId("route_clarification_test");
    expect(nextStepAfter).toBe("wh_5");
  });

  it("does not advance ignition check step on clarification request", async () => {
    const {
      initializeCase,
      markStepCompleted,
      getNextStepId,
      getActiveStepQuestion,
    } = await import("@/lib/diagnostic-registry");
    const {
      getOrCreateContext,
      updateContext,
    } = await import("@/lib/context-engine");
    const { isStepAnswered } = await import("@/lib/mode-validators");

    initializeCase("route_clarification_test", "gas water heater no ignition");
    ["wh_1", "wh_2", "wh_3", "wh_4", "wh_5"].forEach((stepId) => {
      markStepCompleted("route_clarification_test", stepId);
    });

    const context = getOrCreateContext("route_clarification_test");
    context.activeProcedureId = "water_heater";
    context.activeStepId = "wh_6";
    updateContext(context);

    const clarificationMessage = "Как проверить искру?";
    const stepQuestion = getActiveStepQuestion("route_clarification_test", "wh_6");

    expect(isStepAnswered(clarificationMessage, stepQuestion)).toBe(false);

    const nextStepBefore = getNextStepId("route_clarification_test");
    expect(nextStepBefore).toBe("wh_6");

    const contextAfter = getOrCreateContext("route_clarification_test");
    expect(contextAfter.activeStepId).toBe("wh_6");
    expect(contextAfter.completedSteps.has("wh_6")).toBe(false);

    const nextStepAfter = getNextStepId("route_clarification_test");
    expect(nextStepAfter).toBe("wh_6");
  });
});

describe("wh_5 dominant 12V supply routing", () => {
  async function seedWh5Case(caseId: string) {
    const { initializeCase, clearRegistry, markStepCompleted } = await import("@/lib/diagnostic-registry");
    const { clearContext, getOrCreateContext, updateContext } = await import("@/lib/context-engine");

    clearRegistry(caseId);
    clearContext(caseId);
    initializeCase(caseId, "gas water heater not working");

    ["wh_1", "wh_2", "wh_3", "wh_4"].forEach((stepId) => {
      markStepCompleted(caseId, stepId);
    });

    const context = getOrCreateContext(caseId);
    context.primarySystem = "water_heater";
    context.activeProcedureId = "water_heater";
    context.activeStepId = "wh_5";
    ["wh_1", "wh_2", "wh_3", "wh_4"].forEach((stepId) => {
      context.completedSteps.add(stepId);
    });
    updateContext(context);
  }

  it("blocks downstream ignition steps when wh_5 confirms no 12V", async () => {
    const { processMessage } = await import("@/lib/context-engine");
    const { DEFAULT_CONFIG } = await import("@/lib/context-engine/types");
    const { getNextStepId, getBranchState } = await import("@/lib/diagnostic-registry");

    await seedWh5Case("wh5_dominant_negative");

    const result = processMessage(
      "wh5_dominant_negative",
      "No 12V DC at the control board, reading 0.0V",
      DEFAULT_CONFIG,
    );

    expect(result.context.completedSteps.has("wh_5")).toBe(true);
    expect(result.context.activeStepId).toBe("wh_5a");
    expect(result.context.activeStepId).not.toBe("wh_6");
    expect(getNextStepId("wh5_dominant_negative")).toBe("wh_5a");
    expect(getBranchState("wh5_dominant_negative").activeBranchId).toBe("no_12v_supply");
  });

  it("keeps the normal ignition path when wh_5 confirms 12V is present", async () => {
    const { processMessage } = await import("@/lib/context-engine");
    const { DEFAULT_CONFIG } = await import("@/lib/context-engine/types");
    const { getBranchState } = await import("@/lib/diagnostic-registry");

    await seedWh5Case("wh5_dominant_positive");

    const result = processMessage(
      "wh5_dominant_positive",
      "12.6V DC is present at the control board",
      DEFAULT_CONFIG,
    );

    expect(result.context.completedSteps.has("wh_5")).toBe(true);
    expect(result.context.activeStepId).toBe("wh_6");
    expect(getBranchState("wh5_dominant_positive").activeBranchId).toBeNull();
  });

  it("preserves wh_5 clarification behavior without triggering the dominance branch", async () => {
    const { processMessage, isInClarificationSubflow } = await import("@/lib/context-engine");
    const { DEFAULT_CONFIG } = await import("@/lib/context-engine/types");
    const { getBranchState } = await import("@/lib/diagnostic-registry");

    await seedWh5Case("wh5_dominant_clarification");

    const result = processMessage(
      "wh5_dominant_clarification",
      "How do I check that voltage?",
      DEFAULT_CONFIG,
    );

    expect(isInClarificationSubflow(result.context)).toBe(true);
    expect(result.context.activeStepId).toBe("wh_5");
    expect(result.context.completedSteps.has("wh_5")).toBe(false);
    expect(getBranchState("wh5_dominant_clarification").activeBranchId).toBeNull();
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
      updateContext,
    } = await import("@/lib/context-engine");
    const { DEFAULT_CONFIG } = await import("@/lib/context-engine/types");
    const { initializeCase } = await import("@/lib/diagnostic-registry");

    initializeCase("auth_prog_1", "водонагреватель не работает");

    const context = getOrCreateContext("auth_prog_1");
    context.activeProcedureId = "water_heater";
    context.activeStepId = null;
    updateContext(context);

    const result = processMessage("auth_prog_1", "начнём диагностику", DEFAULT_CONFIG);

    expect(result.context.activeStepId).toBe("wh_1");
    expect(result.notices.some((n) => n.includes("Active step initialized: wh_1"))).toBe(true);
  });

  it("completes a full 3-step sequence without losing track", async () => {
    const {
      processMessage,
      getOrCreateContext,
      updateContext,
    } = await import("@/lib/context-engine");
    const { DEFAULT_CONFIG } = await import("@/lib/context-engine/types");
    const { initializeCase, buildRegistryContext } = await import("@/lib/diagnostic-registry");

    initializeCase("auth_prog_1", "водонагреватель не работает");

    const context = getOrCreateContext("auth_prog_1");
    context.activeProcedureId = "water_heater";
    context.activeStepId = "wh_1";
    updateContext(context);

    const r1 = processMessage("auth_prog_1", "газовый Suburban", DEFAULT_CONFIG);
    expect(r1.context.completedSteps.has("wh_1")).toBe(true);
    expect(r1.context.activeStepId).toBe("wh_2");

    const r2 = processMessage("auth_prog_1", "бак полный, клапан открыт", DEFAULT_CONFIG);
    expect(r2.context.completedSteps.has("wh_2")).toBe(true);
    expect(r2.context.activeStepId).toBe("wh_3");

    const r3 = processMessage("auth_prog_1", "да, плита работает", DEFAULT_CONFIG);
    expect(r3.context.completedSteps.has("wh_3")).toBe(true);
    expect(r3.context.activeStepId).toBe("wh_4");

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
      updateContext,
    } = await import("@/lib/context-engine");
    const { DEFAULT_CONFIG } = await import("@/lib/context-engine/types");
    const { initializeCase } = await import("@/lib/diagnostic-registry");

    initializeCase("auth_prog_1", "водонагреватель не работает");

    const context = getOrCreateContext("auth_prog_1");
    context.activeProcedureId = "water_heater";
    context.activeStepId = "wh_1";
    updateContext(context);

    const result = processMessage("auth_prog_1", "газовый тип, Suburban модель", DEFAULT_CONFIG);

    expect(result.context.completedSteps.has("wh_1")).toBe(true);
    expect(result.context.completedSteps.has("wh_5")).toBe(false);
    expect(result.context.activeStepId).toBe("wh_2");
  });

  it("never resets activeStepId to null mid-procedure", async () => {
    const {
      processMessage,
      getOrCreateContext,
      updateContext,
    } = await import("@/lib/context-engine");
    const { DEFAULT_CONFIG } = await import("@/lib/context-engine/types");
    const { initializeCase } = await import("@/lib/diagnostic-registry");

    initializeCase("auth_prog_1", "водонагреватель не работает");

    const context = getOrCreateContext("auth_prog_1");
    context.activeProcedureId = "water_heater";
    context.activeStepId = "wh_1";
    updateContext(context);

    const steps = [
      "газовый бойлер",
      "бак полный, вентиль открыт",
      "да, плита работает",
      "клапан открыт",
    ];

    let lastResult;
    for (const answer of steps) {
      lastResult = processMessage("auth_prog_1", answer, DEFAULT_CONFIG);
      const doneCount = lastResult.context.completedSteps.size + lastResult.context.unableSteps.size;
      if (doneCount < 10) {
        expect(lastResult.context.activeStepId).not.toBeNull();
      }
    }
  });
});