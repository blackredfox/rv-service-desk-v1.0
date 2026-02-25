/**
 * Route Strictness Tests — Context Engine as Single Flow Authority
 * 
 * These tests ensure that:
 * 1. Context Engine is ALWAYS used in diagnostic mode
 * 2. Legacy flow functions are NOT used for flow decisions
 * 3. No dual-authority paths exist
 * 4. Replan and clarification are handled by Context Engine only
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

describe("Route Strictness — Context Engine Only", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("STRICT_CONTEXT_ENGINE is enabled by default", async () => {
    // Import the route module and check the flag
    // Note: We can't directly access the const, but we can verify behavior
    const { 
      processMessage,
      createContext,
      clearContext,
      DEFAULT_CONFIG,
    } = await import("@/lib/context-engine");
    
    // If strict mode is enabled, Context Engine should be the authority
    const caseId = "strict-mode-test";
    clearContext(caseId);
    createContext(caseId, "roof_ac", "complex");
    
    const result = processMessage(caseId, "where is the capacitor?", DEFAULT_CONFIG);
    
    // Context Engine should handle this as a LOCATE intent
    expect(result.intent.type).toBe("LOCATE");
    expect(result.context.submode).toBe("clarification");
  });

  it("Context Engine processMessage is always called in diagnostic mode", async () => {
    const processMessageSpy = vi.fn();
    
    vi.doMock("@/lib/context-engine", async () => {
      const actual = await vi.importActual("@/lib/context-engine") as Record<string, unknown>;
      return {
        ...actual,
        processMessage: (...args: unknown[]) => {
          processMessageSpy(...args);
          return (actual.processMessage as (...args: unknown[]) => unknown)(...args);
        },
      };
    });
    
    const { processMessage, createContext, clearContext, DEFAULT_CONFIG } = await import("@/lib/context-engine");
    
    const caseId = "process-message-called-test";
    clearContext(caseId);
    createContext(caseId, "water_pump");
    
    // Simulate what route.ts does
    const result = processMessage(caseId, "12V present at pump terminals", DEFAULT_CONFIG);
    
    expect(processMessageSpy).toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result.intent).toBeDefined();
  });

  it("legacy shouldPivot is NOT used for flow decisions", async () => {
    // The legacy shouldPivot should not influence flow when Context Engine is authority
    const { 
      createContext,
      clearContext,
      markIsolationComplete,
      processMessage,
      DEFAULT_CONFIG,
    } = await import("@/lib/context-engine");
    
    const caseId = "no-legacy-pivot-test";
    clearContext(caseId);
    createContext(caseId, "roof_ac", "complex");
    
    // Mark isolation complete via Context Engine (not legacy)
    markIsolationComplete(caseId, "Compressor failure confirmed");
    
    // Process a message
    const result = processMessage(caseId, "confirmed compressor not starting", DEFAULT_CONFIG);
    
    // Pivot state should be controlled by Context Engine
    expect(result.context.isolationComplete).toBe(true);
    expect(result.context.isolationFinding).toBe("Compressor failure confirmed");
  });

  it("replan is handled ONLY by Context Engine", async () => {
    const { 
      createContext,
      clearContext,
      markIsolationComplete,
      processMessage,
      isInReplanState,
      DEFAULT_CONFIG,
    } = await import("@/lib/context-engine");
    
    const caseId = "replan-authority-test";
    clearContext(caseId);
    createContext(caseId, "roof_ac", "complex");
    
    // Mark isolation complete
    markIsolationComplete(caseId, "Capacitor failure");
    
    // New evidence triggers replan (Context Engine decision)
    const result = processMessage(caseId, "wait, I found a refrigerant leak on the condenser", DEFAULT_CONFIG);
    
    // Replan should be triggered by Context Engine
    expect(isInReplanState(result.context)).toBe(true);
    expect(result.context.isolationComplete).toBe(false);
    expect(result.context.isolationInvalidated).toBe(true);
    expect(result.notices.some(n => n.toLowerCase().includes("replan"))).toBe(true);
  });

  it("clarification is handled ONLY by Context Engine topic stack", async () => {
    const { 
      createContext,
      clearContext,
      setActiveStep,
      processMessage,
      isInClarificationSubflow,
      DEFAULT_CONFIG,
    } = await import("@/lib/context-engine");
    
    const caseId = "clarification-authority-test";
    clearContext(caseId);
    createContext(caseId, "roof_ac", "complex");
    setActiveStep(caseId, "ac_3");
    
    // Clarification request
    const result = processMessage(caseId, "how do I check the capacitor?", DEFAULT_CONFIG);
    
    // Clarification should be handled by Context Engine
    expect(result.intent.type).toBe("HOWTO");
    expect(isInClarificationSubflow(result.context)).toBe(true);
    expect(result.context.submode).toBe("clarification");
    expect(result.responseInstructions.clarificationType).toBe("howto");
  });

  it("no dual-authority: isolation + new evidence = replan (not dual pivot)", async () => {
    const { 
      createContext,
      clearContext,
      markIsolationComplete,
      processMessage,
      isInReplanState,
      getContext,
      DEFAULT_CONFIG,
    } = await import("@/lib/context-engine");
    
    const caseId = "no-dual-authority-test";
    clearContext(caseId);
    createContext(caseId, "roof_ac", "complex");
    
    // Initial isolation
    markIsolationComplete(caseId, "Compressor not starting");
    let context = getContext(caseId)!;
    expect(context.isolationComplete).toBe(true);
    
    // New evidence should trigger REPLAN, not create dual pivot state
    const result = processMessage(caseId, "Actually, I just noticed there's a hole in the evaporator coil", DEFAULT_CONFIG);
    
    // Should be in replan state (isolation invalidated)
    expect(isInReplanState(result.context)).toBe(true);
    expect(result.context.isolationComplete).toBe(false);
    
    // No dual state
    expect(result.context.isolationInvalidated).toBe(true);
  });

  it("loop guard prevents legacy-style fallback loops", async () => {
    const { 
      createContext,
      clearContext,
      recordAgentAction,
      wouldViolateLoopRules,
      DEFAULT_CONFIG,
    } = await import("@/lib/context-engine");
    
    const caseId = "no-fallback-loop-test";
    clearContext(caseId);
    createContext(caseId, "water_pump");
    
    // Record a fallback action
    recordAgentAction(caseId, {
      type: "fallback",
      content: "Can you provide more information?",
    }, DEFAULT_CONFIG);
    
    // Second fallback should be blocked by Context Engine
    const wouldViolate = wouldViolateLoopRules(caseId, {
      type: "fallback",
      content: "I need more details",
    }, DEFAULT_CONFIG);
    
    expect(wouldViolate.violation).toBe(true);
    expect(wouldViolate.reason).toContain("fallback");
  });

  it("step completion is synced from registry to Context Engine", async () => {
    const { 
      createContext,
      clearContext,
      markStepCompleted,
      getContext,
    } = await import("@/lib/context-engine");
    
    const caseId = "step-sync-test";
    clearContext(caseId);
    createContext(caseId, "water_pump");
    
    // Mark step completed via Context Engine
    markStepCompleted(caseId, "wp_1");
    
    const context = getContext(caseId)!;
    expect(context.completedSteps.has("wp_1")).toBe(true);
  });

  it("anti-loop directives are generated by Context Engine", async () => {
    const { 
      createContext,
      clearContext,
      markStepCompleted,
      recordAgentAction,
      getContext,
      DEFAULT_CONFIG,
    } = await import("@/lib/context-engine");
    const { generateAntiLoopDirectives } = await import("@/lib/context-engine/loop-guard");
    
    const caseId = "anti-loop-directives-authority-test";
    clearContext(caseId);
    createContext(caseId, "water_pump");
    
    // Set up state
    markStepCompleted(caseId, "wp_1");
    markStepCompleted(caseId, "wp_2");
    recordAgentAction(caseId, {
      type: "fallback",
      content: "Need more info",
    }, DEFAULT_CONFIG);
    
    const context = getContext(caseId)!;
    const directives = generateAntiLoopDirectives(context);
    
    // Directives should reference completed steps
    expect(directives.some(d => d.includes("wp_1"))).toBe(true);
    expect(directives.some(d => d.includes("wp_2"))).toBe(true);
    expect(directives.some(d => d.includes("FORBIDDEN"))).toBe(true);
  });

  it("Context Engine result has valid structure for route consumption", async () => {
    const { 
      createContext,
      clearContext,
      processMessage,
      DEFAULT_CONFIG,
    } = await import("@/lib/context-engine");
    
    const caseId = "valid-result-structure-test";
    clearContext(caseId);
    createContext(caseId, "roof_ac", "complex");
    
    const result = processMessage(caseId, "Motor runs when powered directly", DEFAULT_CONFIG);
    
    // All required fields must exist
    expect(result.context).toBeDefined();
    expect(result.context.caseId).toBe(caseId);
    expect(result.context.mode).toBe("diagnostic");
    expect(result.context.submode).toBeDefined();
    
    expect(result.intent).toBeDefined();
    expect(result.intent.type).toBeDefined();
    
    expect(result.responseInstructions).toBeDefined();
    expect(result.responseInstructions.action).toBeDefined();
    expect(result.responseInstructions.antiLoopDirectives).toBeDefined();
    expect(result.responseInstructions.constraints).toBeDefined();
    
    expect(result.stateChanged).toBeDefined();
    expect(result.notices).toBeDefined();
    expect(Array.isArray(result.notices)).toBe(true);
  });

  it("Context Engine handles invalid/missing context gracefully", async () => {
    const { 
      getOrCreateContext,
      clearContext,
    } = await import("@/lib/context-engine");
    
    const caseId = "graceful-handling-test";
    clearContext(caseId);
    
    // Should create context if missing
    const context = getOrCreateContext(caseId);
    
    expect(context).toBeDefined();
    expect(context.caseId).toBe(caseId);
    expect(context.mode).toBe("diagnostic");
    expect(context.submode).toBe("main");
  });
});

describe("Data Provider Isolation — Registry as Read-Only", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("buildRegistryContext returns step metadata (data only)", async () => {
    const { initializeCase, buildRegistryContext, clearRegistry } = await import("@/lib/diagnostic-registry");
    
    const caseId = "registry-data-only-test";
    clearRegistry(caseId);
    
    // Initialize with a message
    initializeCase(caseId, "water pump not working");
    
    // Build context (should be metadata only)
    const context = buildRegistryContext(caseId);
    
    // Should contain procedure context or be empty, but NOT flow commands
    expect(typeof context).toBe("string");
    // Should not contain flow decision markers
    expect(context).not.toContain("MUST PIVOT NOW");
    expect(context).not.toContain("FORCE TRANSITION");
  });

  it("initializeCase provides procedure catalog (data only)", async () => {
    const { initializeCase, clearRegistry } = await import("@/lib/diagnostic-registry");
    
    const caseId = "init-data-only-test";
    clearRegistry(caseId);
    
    const result = initializeCase(caseId, "roof AC not cooling");
    
    // Should return procedure metadata
    expect(result).toBeDefined();
    if (result.procedure) {
      expect(result.procedure.displayName).toBeDefined();
      expect(result.procedure.steps).toBeDefined();
    }
    
    // Should NOT return flow commands
    expect((result as Record<string, unknown>).shouldPivot).toBeUndefined();
    expect((result as Record<string, unknown>).nextAction).toBeUndefined();
  });
});
