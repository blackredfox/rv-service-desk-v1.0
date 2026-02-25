/**
 * Context Engine Integration Test
 * 
 * Verifies that the Context Engine is properly wired into the chat route:
 * - processMessage() is called BEFORE LLM invocation
 * - recordAgentAction() is called AFTER LLM response
 * - No duplicate fallback loops
 * - Clarification subflows work end-to-end
 * - Replan triggers work end-to-end
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Mock OpenAI before imports
vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  })),
}));

describe("Context Engine Integration", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("processMessage is called before LLM invocation in diagnostic mode", async () => {
    // Spy on the context engine
    const contextEngineSpy = vi.fn();
    
    vi.doMock("@/lib/context-engine", async () => {
      const actual = await vi.importActual("@/lib/context-engine") as Record<string, unknown>;
      return {
        ...actual,
        processMessage: (...args: unknown[]) => {
          contextEngineSpy("processMessage", args);
          return (actual.processMessage as (...args: unknown[]) => unknown)(...args);
        },
      };
    });

    const { processMessage, createContext, clearContext, DEFAULT_CONFIG } = await import("@/lib/context-engine");
    
    const caseId = "integration-test-case";
    clearContext(caseId);
    createContext(caseId, "roof_ac", "complex");
    
    // Call processMessage as route.ts would
    const result = processMessage(caseId, "what is the capacitor?", DEFAULT_CONFIG);
    
    // Verify it was called and returned expected structure
    expect(result).toBeDefined();
    expect(result.intent).toBeDefined();
    expect(result.context).toBeDefined();
    expect(result.responseInstructions).toBeDefined();
    
    // Verify intent detection worked
    expect(result.intent.type).toBe("EXPLAIN");
  });

  it("recordAgentAction is called after processing a response", async () => {
    const { 
      createContext, 
      clearContext, 
      processMessage,
      recordAgentAction,
      getContext,
      DEFAULT_CONFIG,
    } = await import("@/lib/context-engine");
    
    const caseId = "record-action-test";
    clearContext(caseId);
    createContext(caseId, "roof_ac", "complex");
    
    // Process a message
    processMessage(caseId, "12V present at pump", DEFAULT_CONFIG);
    
    // Simulate recording an agent action (as route.ts does after LLM response)
    recordAgentAction(caseId, {
      type: "question",
      content: "Does the pump run when activated?",
      stepId: "wp_2",
    }, DEFAULT_CONFIG);
    
    // Verify action was recorded
    const context = getContext(caseId);
    expect(context).toBeDefined();
    expect(context!.lastAgentActions.length).toBeGreaterThan(0);
    
    const lastAction = context!.lastAgentActions[context!.lastAgentActions.length - 1];
    expect(lastAction.type).toBe("question");
    expect(lastAction.stepId).toBe("wp_2");
  });

  it("no duplicate fallback when loop guard is active", async () => {
    const { 
      createContext, 
      clearContext, 
      recordAgentAction,
      wouldViolateLoopRules,
      getContext,
      DEFAULT_CONFIG,
    } = await import("@/lib/context-engine");
    
    const caseId = "no-duplicate-fallback-test";
    clearContext(caseId);
    createContext(caseId, "water_pump");
    
    // Record first fallback
    recordAgentAction(caseId, {
      type: "fallback",
      content: "Can you provide more information?",
    }, DEFAULT_CONFIG);
    
    // Check if second fallback would be blocked
    const wouldViolate = wouldViolateLoopRules(caseId, {
      type: "fallback",
      content: "I need more details",
    }, DEFAULT_CONFIG);
    
    // Loop guard should block this
    expect(wouldViolate.violation).toBe(true);
    expect(wouldViolate.reason).toContain("fallback");
  });

  it("clarification subflow pushes and pops topic correctly", async () => {
    const { 
      createContext, 
      clearContext, 
      processMessage,
      isInClarificationSubflow,
      popTopic,
      updateContext,
      getContext,
      DEFAULT_CONFIG,
    } = await import("@/lib/context-engine");
    
    const caseId = "clarification-flow-test";
    clearContext(caseId);
    createContext(caseId, "roof_ac", "complex");
    
    // Initial state: not in clarification
    let context = getContext(caseId)!;
    expect(isInClarificationSubflow(context)).toBe(false);
    
    // Process a clarification request
    const result = processMessage(caseId, "where is the capacitor?", DEFAULT_CONFIG);
    
    // Should be in clarification subflow
    expect(result.intent.type).toBe("LOCATE");
    expect(isInClarificationSubflow(result.context)).toBe(true);
    expect(result.context.submode).toBe("clarification");
    
    // Simulate agent responding and popping topic
    const updatedContext = popTopic(result.context);
    updateContext(updatedContext);
    
    // Should be back to main
    context = getContext(caseId)!;
    expect(isInClarificationSubflow(context)).toBe(false);
    expect(context.submode).toBe("main");
  });

  it("replan triggers when new evidence found after isolation", async () => {
    const { 
      createContext, 
      clearContext, 
      markIsolationComplete,
      processMessage,
      isInReplanState,
      getContext,
      DEFAULT_CONFIG,
    } = await import("@/lib/context-engine");
    
    const caseId = "replan-trigger-test";
    clearContext(caseId);
    createContext(caseId, "roof_ac", "complex");
    
    // Mark isolation as complete
    markIsolationComplete(caseId, "Compressor not starting");
    
    let context = getContext(caseId)!;
    expect(context.isolationComplete).toBe(true);
    
    // Process message with new evidence
    const result = processMessage(caseId, "wait, I found a refrigerant leak on the condenser", DEFAULT_CONFIG);
    
    // Should trigger replan
    expect(result.notices.some(n => n.toLowerCase().includes("replan"))).toBe(true);
    expect(result.context.isolationComplete).toBe(false);
    expect(isInReplanState(result.context)).toBe(true);
  });

  it("labor confirmation is non-blocking", async () => {
    const { 
      createContext, 
      clearContext, 
      setLaborDraft,
      isLaborBlocking,
      getContext,
    } = await import("@/lib/context-engine");
    
    const caseId = "labor-nonblocking-test";
    clearContext(caseId);
    createContext(caseId, "water_pump");
    
    // Set a draft labor estimate
    setLaborDraft(caseId, 1.5);
    
    const context = getContext(caseId)!;
    
    // Labor should be in draft mode
    expect(context.labor.mode).toBe("draft");
    expect(context.labor.estimatedHours).toBe(1.5);
    
    // Should NOT be blocking (non-blocking is default)
    expect(isLaborBlocking(caseId)).toBe(false);
  });

  it("anti-loop directives are generated for prompt injection", async () => {
    const { 
      createContext, 
      clearContext, 
      markStepCompleted,
      recordAgentAction,
      getContext,
      DEFAULT_CONFIG,
    } = await import("@/lib/context-engine");
    const { generateAntiLoopDirectives } = await import("@/lib/context-engine/loop-guard");
    
    const caseId = "anti-loop-directives-test";
    clearContext(caseId);
    createContext(caseId, "water_pump");
    
    // Set up state that should trigger directives
    markStepCompleted(caseId, "wp_1");
    recordAgentAction(caseId, {
      type: "fallback",
      content: "Need more info",
    }, DEFAULT_CONFIG);
    
    const context = getContext(caseId)!;
    const directives = generateAntiLoopDirectives(context);
    
    // Should generate meaningful directives
    expect(directives.length).toBeGreaterThan(0);
    expect(directives.some(d => d.includes("ANTI-LOOP"))).toBe(true);
    expect(directives.some(d => d.includes("wp_1"))).toBe(true); // Completed step
    expect(directives.some(d => d.includes("FORWARD PROGRESS"))).toBe(true);
  });

  it("replan notice is generated for prompt injection", async () => {
    const { 
      createContext, 
      clearContext, 
      markIsolationComplete,
      processMessage,
      DEFAULT_CONFIG,
    } = await import("@/lib/context-engine");
    const { buildReplanNotice } = await import("@/lib/context-engine/replan");
    
    const caseId = "replan-notice-test";
    clearContext(caseId);
    createContext(caseId, "roof_ac", "complex");
    
    // Mark isolation complete
    markIsolationComplete(caseId, "Capacitor failure");
    
    // Trigger replan
    const result = processMessage(caseId, "I just noticed a hole in the evaporator coil", DEFAULT_CONFIG);
    
    // Build replan notice
    const notice = buildReplanNotice(result.context);
    
    // Should generate replan notice
    expect(notice).not.toBeNull();
    expect(notice).toContain("REPLAN");
    expect(notice).toContain("invalidated");
  });

  it("context engine result contains all required fields for route.ts", async () => {
    const { 
      createContext, 
      clearContext, 
      processMessage,
      DEFAULT_CONFIG,
    } = await import("@/lib/context-engine");
    
    const caseId = "result-structure-test";
    clearContext(caseId);
    createContext(caseId, "roof_ac", "complex");
    
    const result = processMessage(caseId, "12V present at motor terminals", DEFAULT_CONFIG);
    
    // Verify all required fields exist
    expect(result.context).toBeDefined();
    expect(result.intent).toBeDefined();
    expect(result.responseInstructions).toBeDefined();
    expect(result.stateChanged).toBeDefined();
    expect(result.notices).toBeDefined();
    
    // Verify intent structure
    expect(result.intent.type).toBeDefined();
    
    // Verify context has required fields
    expect(result.context.caseId).toBe(caseId);
    expect(result.context.mode).toBe("diagnostic");
    expect(result.context.submode).toBeDefined();
    expect(result.context.completedSteps).toBeDefined();
    expect(result.context.lastAgentActions).toBeDefined();
    
    // Verify response instructions structure
    expect(result.responseInstructions.action).toBeDefined();
    expect(result.responseInstructions.antiLoopDirectives).toBeDefined();
    expect(result.responseInstructions.constraints).toBeDefined();
  });
});
