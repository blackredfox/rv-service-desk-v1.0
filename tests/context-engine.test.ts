/**
 * Context Engine Tests
 * 
 * Test scenarios:
 * P0a) AC case: new evidence after isolation triggers replan
 * P0b) Loop breaker: prevents "provide more info" twice
 * P0c) Clarification handling: where/what/how returns to main flow
 * P0d) Fan alt-power: working motor prevents replacement recommendation
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── P0a: AC Replan ──────────────────────────────────────────────────

describe("Context Engine — AC Replan (P0a)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("detects new physical evidence after isolation", async () => {
    const { detectIntent, detectNewEvidence } = await import("@/lib/context-engine");
    
    // Technician reports finding a hole after isolation
    const message = "wait, I found a hole in the evaporator coil";
    
    const intent = detectIntent(message);
    expect(intent.type).toBe("DISPUTE_OR_NEW_EVIDENCE");
    
    if (intent.type === "DISPUTE_OR_NEW_EVIDENCE") {
      expect(intent.evidenceType).toBe("physical_damage");
    }
    
    const evidence = detectNewEvidence(message);
    expect(evidence.hasNewEvidence).toBe(true);
    expect(evidence.evidenceType).toBe("physical_damage");
  });

  it("triggers replan when isolation was complete", async () => {
    const { 
      createContext, 
      markIsolationComplete, 
      shouldReplan,
      getContext,
    } = await import("@/lib/context-engine");
    
    // Create context with completed isolation
    const caseId = "ac-replan-test";
    createContext(caseId, "roof_ac", "complex");
    markIsolationComplete(caseId, "Compressor not starting");
    
    const context = getContext(caseId)!;
    expect(context.isolationComplete).toBe(true);
    
    // New evidence message
    const message = "Actually, I just noticed there's a refrigerant leak on the condenser";
    
    const replanResult = shouldReplan(message, context);
    expect(replanResult.shouldReplan).toBe(true);
    expect(replanResult.reason).toContain("physical_damage");
  });

  it("does NOT trigger replan when isolation is not complete", async () => {
    const { 
      createContext, 
      shouldReplan,
      getContext,
    } = await import("@/lib/context-engine");
    
    // Create context WITHOUT completed isolation
    const caseId = "ac-no-replan-test";
    createContext(caseId, "roof_ac", "complex");
    
    const context = getContext(caseId)!;
    expect(context.isolationComplete).toBe(false);
    
    // Same evidence message
    const message = "I found a crack in the housing";
    
    const replanResult = shouldReplan(message, context);
    expect(replanResult.shouldReplan).toBe(false);
  });

  it("executeReplan invalidates prior isolation", async () => {
    const { 
      createContext, 
      markIsolationComplete, 
      shouldReplan,
      executeReplan,
      getContext,
    } = await import("@/lib/context-engine");
    
    const caseId = "ac-execute-replan-test";
    createContext(caseId, "roof_ac", "complex");
    markIsolationComplete(caseId, "Capacitor failure");
    
    let context = getContext(caseId)!;
    const message = "I discovered a hole in the evaporator coil leaking refrigerant";
    
    const replanResult = shouldReplan(message, context);
    expect(replanResult.shouldReplan).toBe(true);
    
    context = executeReplan(context, replanResult);
    
    expect(context.isolationComplete).toBe(false);
    expect(context.isolationInvalidated).toBe(true);
    expect(context.replanReason).toContain("physical_damage");
  });

  it("buildReplanNotice provides clear instructions", async () => {
    const { 
      createContext, 
      markIsolationComplete, 
      shouldReplan,
      executeReplan,
      buildReplanNotice,
      getContext,
    } = await import("@/lib/context-engine");
    
    const caseId = "ac-notice-test";
    createContext(caseId, "roof_ac", "complex");
    markIsolationComplete(caseId, "Low refrigerant charge");
    
    let context = getContext(caseId)!;
    const message = "Found a leak at the service valve";
    
    const replanResult = shouldReplan(message, context);
    context = executeReplan(context, replanResult);
    
    const notice = buildReplanNotice(context);
    expect(notice).not.toBeNull();
    expect(notice).toContain("REPLAN NOTICE");
    expect(notice).toContain("Previous isolation was invalidated");
    expect(notice).toContain("Do NOT repeat the previous conclusion");
  });
});

// ── P0b: Loop Breaker ───────────────────────────────────────────────

describe("Context Engine — Loop Breaker (P0b)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("detects fallback responses", async () => {
    const { isFallbackResponse } = await import("@/lib/context-engine");
    
    // Should detect
    expect(isFallbackResponse("Can you provide more information?")).toBe(true);
    expect(isFallbackResponse("I need more details to help you")).toBe(true);
    expect(isFallbackResponse("Please share additional info")).toBe(true);
    expect(isFallbackResponse("Could you tell me more about the issue?")).toBe(true);
    
    // Should NOT detect (valid diagnostic questions)
    expect(isFallbackResponse("Is 12V present at the pump terminals?")).toBe(false);
    expect(isFallbackResponse("Does the motor hum when activated?")).toBe(false);
    expect(isFallbackResponse("What voltage do you measure?")).toBe(false);
  });

  it("blocks consecutive fallback responses", async () => {
    const { 
      createContext, 
      recordAgentAction, 
      wouldViolateLoopRules,
      getContext,
      DEFAULT_CONFIG,
    } = await import("@/lib/context-engine");
    
    const caseId = "loop-breaker-test";
    createContext(caseId, "water_pump");
    
    // Record first fallback
    recordAgentAction(caseId, {
      type: "fallback",
      content: "Can you provide more information?",
    });
    
    let context = getContext(caseId)!;
    expect(context.consecutiveFallbacks).toBe(1);
    
    // Second fallback should be blocked
    const result = wouldViolateLoopRules(caseId, {
      type: "fallback",
      content: "I need more details",
    });
    
    expect(result.violation).toBe(true);
    expect(result.reason).toContain("fallback");
  });

  it("allows fallback after a non-fallback action", async () => {
    const { 
      createContext, 
      recordAgentAction, 
      wouldViolateLoopRules,
      getContext,
    } = await import("@/lib/context-engine");
    
    const caseId = "loop-reset-test";
    createContext(caseId, "water_pump");
    
    // Record first fallback
    recordAgentAction(caseId, {
      type: "fallback",
      content: "Can you provide more information?",
    });
    
    // Record a valid question (resets fallback counter)
    recordAgentAction(caseId, {
      type: "question",
      content: "Is 12V present at the pump?",
      stepId: "wp_2",
    });
    
    let context = getContext(caseId)!;
    expect(context.consecutiveFallbacks).toBe(0);
    
    // Now fallback should be allowed
    const result = wouldViolateLoopRules(caseId, {
      type: "fallback",
      content: "Can you clarify?",
    });
    
    expect(result.violation).toBe(false);
  });

  it("blocks re-asking completed steps", async () => {
    const { 
      createContext, 
      markStepCompleted,
      wouldViolateLoopRules,
    } = await import("@/lib/context-engine");
    
    const caseId = "completed-step-test";
    createContext(caseId, "water_pump");
    
    // Mark step as completed
    markStepCompleted(caseId, "wp_1");
    
    // Asking the completed step should be blocked
    const result = wouldViolateLoopRules(caseId, {
      type: "question",
      content: "Does the pump make noise?",
      stepId: "wp_1",
    });
    
    expect(result.violation).toBe(true);
    expect(result.reason).toContain("already completed");
  });

  it("blocks re-asking unable-to-verify steps", async () => {
    const { 
      createContext, 
      markStepUnable,
      wouldViolateLoopRules,
    } = await import("@/lib/context-engine");
    
    const caseId = "unable-step-test";
    createContext(caseId, "water_pump");
    
    // Mark step as unable to verify
    markStepUnable(caseId, "wp_2");
    
    // Asking the unable step should be blocked
    const result = wouldViolateLoopRules(caseId, {
      type: "question",
      content: "What voltage do you measure?",
      stepId: "wp_2",
    });
    
    expect(result.violation).toBe(true);
    expect(result.reason).toContain("unable to verify");
  });

  it("generates anti-loop directives for prompt", async () => {
    const { 
      createContext, 
      markStepCompleted,
      recordAgentAction,
      getContext,
    } = await import("@/lib/context-engine");
    const { generateAntiLoopDirectives } = await import("@/lib/context-engine/loop-guard");
    
    const caseId = "anti-loop-directive-test";
    createContext(caseId, "water_pump");
    
    // Set up some state
    markStepCompleted(caseId, "wp_1");
    recordAgentAction(caseId, { type: "fallback", content: "Need more info" });
    
    const context = getContext(caseId)!;
    const directives = generateAntiLoopDirectives(context);
    
    expect(directives).toContain("ANTI-LOOP RULES (CRITICAL):");
    expect(directives.some(d => d.includes("FORBIDDEN"))).toBe(true);
    expect(directives.some(d => d.includes("wp_1"))).toBe(true);
    expect(directives.some(d => d.includes("FORWARD PROGRESS"))).toBe(true);
  });
});

// ── P0c: Clarification Handling ─────────────────────────────────────

describe("Context Engine — Clarification Handling (P0c)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("detects LOCATE intent", async () => {
    const { detectIntent } = await import("@/lib/context-engine");
    
    // English
    expect(detectIntent("where is the capacitor?").type).toBe("LOCATE");
    expect(detectIntent("Where can I find the fuse panel?").type).toBe("LOCATE");
    expect(detectIntent("where do I find the pressure switch").type).toBe("LOCATE");
    
    // Russian
    expect(detectIntent("где находится конденсатор?").type).toBe("LOCATE");
    
    // Spanish
    expect(detectIntent("dónde está el capacitor?").type).toBe("LOCATE");
  });

  it("detects EXPLAIN intent", async () => {
    const { detectIntent } = await import("@/lib/context-engine");
    
    // English
    expect(detectIntent("what is a contactor?").type).toBe("EXPLAIN");
    expect(detectIntent("What's this relay for?").type).toBe("EXPLAIN");
    expect(detectIntent("explain what the sail switch does").type).toBe("EXPLAIN");
    
    // Russian
    expect(detectIntent("что такое контактор?").type).toBe("EXPLAIN");
    
    // Spanish
    expect(detectIntent("qué es un capacitor?").type).toBe("EXPLAIN");
  });

  it("detects HOWTO intent", async () => {
    const { detectIntent } = await import("@/lib/context-engine");
    
    // English
    expect(detectIntent("how do I check the voltage?").type).toBe("HOWTO");
    expect(detectIntent("how to test the capacitor?").type).toBe("HOWTO");
    expect(detectIntent("how can I measure continuity?").type).toBe("HOWTO");
    expect(detectIntent("how should I verify ground?").type).toBe("HOWTO");
    
    // Russian
    expect(detectIntent("как проверить напряжение?").type).toBe("HOWTO");
    
    // Spanish
    expect(detectIntent("cómo puedo verificar el voltaje?").type).toBe("HOWTO");
  });

  it("pushes and pops topic stack for clarifications", async () => {
    const { 
      createContext, 
      pushTopic, 
      popTopic, 
      isInClarificationSubflow,
      getCurrentClarificationTopic,
      getContext,
    } = await import("@/lib/context-engine");
    
    const caseId = "topic-stack-test";
    let context = createContext(caseId, "roof_ac");
    
    expect(isInClarificationSubflow(context)).toBe(false);
    
    // Push a locate question
    context = pushTopic(context, { type: "LOCATE", query: "capacitor" });
    
    expect(isInClarificationSubflow(context)).toBe(true);
    expect(context.submode).toBe("clarification");
    
    const topic = getCurrentClarificationTopic(context);
    expect(topic?.topic).toBe("capacitor");
    expect(topic?.clarificationType).toBe("locate");
    
    // Pop back to main
    context = popTopic(context);
    
    expect(isInClarificationSubflow(context)).toBe(false);
    expect(context.submode).toBe("main");
  });

  it("handles nested clarifications", async () => {
    const { 
      createContext, 
      pushTopic, 
      popTopic, 
      getContext,
    } = await import("@/lib/context-engine");
    
    const caseId = "nested-clarification-test";
    let context = createContext(caseId, "roof_ac");
    
    // Push locate
    context = pushTopic(context, { type: "LOCATE", query: "capacitor" });
    expect(context.topicStack.length).toBe(1);
    
    // Push explain while in locate
    context = pushTopic(context, { type: "EXPLAIN", query: "capacitor function" });
    expect(context.topicStack.length).toBe(2);
    expect(context.submode).toBe("clarification");
    
    // Pop back to locate
    context = popTopic(context);
    expect(context.topicStack.length).toBe(1);
    expect(context.submode).toBe("clarification");
    
    // Pop back to main
    context = popTopic(context);
    expect(context.topicStack.length).toBe(0);
    expect(context.submode).toBe("main");
  });

  it("builds return-to-main instruction", async () => {
    const { 
      createContext, 
      pushTopic, 
      setActiveStep,
      getContext,
    } = await import("@/lib/context-engine");
    const { buildReturnToMainInstruction } = await import("@/lib/context-engine/topic-stack");
    
    const caseId = "return-instruction-test";
    let context = createContext(caseId, "roof_ac");
    
    // Set an active step
    context.activeStepId = "ac_5";
    
    // Push clarification
    context = pushTopic(context, { type: "HOWTO", query: "check capacitor" });
    
    const instruction = buildReturnToMainInstruction(context);
    
    expect(instruction).not.toBeNull();
    expect(instruction).toContain("CLARIFICATION SUBFLOW RULES");
    expect(instruction).toContain("HOWTO");
    expect(instruction).toContain("check capacitor");
    expect(instruction).toContain("return to the diagnostic flow");
    expect(instruction).toContain("Do NOT close the diagnostic step");
  });

  it("processMessage handles clarification flow", async () => {
    const { 
      createContext, 
      setActiveStep,
      processMessage, 
      getContext,
    } = await import("@/lib/context-engine");
    
    const caseId = "process-clarification-test";
    createContext(caseId, "roof_ac");
    setActiveStep(caseId, "ac_5");
    
    // Process a how-to question
    const result = processMessage(caseId, "how do I check the capacitor?");
    
    expect(result.intent.type).toBe("HOWTO");
    expect(result.context.submode).toBe("clarification");
    expect(result.responseInstructions.action).toBe("provide_clarification");
    expect(result.responseInstructions.clarificationType).toBe("howto");
    expect(result.responseInstructions.returnToStep).toBe("ac_5");
  });
});

// ── P0d: Fan Alt-Power Rule ─────────────────────────────────────────

describe("Context Engine — Fan Alt-Power Rule (P0d)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("does NOT classify working-on-direct-power as a key finding for motor failure", async () => {
    const { detectIntent, detectNewEvidence } = await import("@/lib/context-engine");
    
    // When motor works on direct power, it's NOT a finding for motor failure
    const message = "Motor runs fine when I apply 12V directly";
    
    const intent = detectIntent(message);
    // This should be a MAIN_DIAGNOSTIC response, not a key finding
    expect(intent.type).toBe("MAIN_DIAGNOSTIC");
    
    const evidence = detectNewEvidence(message);
    expect(evidence.hasNewEvidence).toBe(false);
  });

  it("slide-out motor direct power test is tracked correctly", async () => {
    const { 
      createContext, 
      markStepCompleted, 
      addFact,
      getContext,
    } = await import("@/lib/context-engine");
    
    const caseId = "slide-out-motor-test";
    createContext(caseId, "slide_out", "complex");
    
    // Technician reports motor works on direct power
    addFact(caseId, {
      type: "finding",
      source: "technician",
      value: "Motor operates normally with direct 12V - fault is upstream",
      stepId: "so_3",
    });
    markStepCompleted(caseId, "so_3");
    
    const context = getContext(caseId)!;
    
    // Motor should NOT be isolated as the failure point
    expect(context.isolationComplete).toBe(false);
    expect(context.isolationFinding).toBeNull();
    
    // Fact should be recorded
    const motorFact = context.facts.find(f => f.value.includes("Motor operates normally"));
    expect(motorFact).toBeDefined();
  });

  it("awning motor direct power test follows correct logic", async () => {
    const { 
      createContext, 
      markStepCompleted, 
      addFact,
      markIsolationComplete,
      getContext,
    } = await import("@/lib/context-engine");
    
    const caseId = "awning-motor-test";
    createContext(caseId, "awning");
    
    // Scenario 1: Motor works on direct power = upstream fault
    addFact(caseId, {
      type: "finding",
      source: "technician",
      value: "Motor runs when powered directly - switch or wiring fault",
      stepId: "awn_6",
    });
    
    let context = getContext(caseId)!;
    
    // Should NOT conclude motor failure
    expect(context.facts.some(f => 
      f.value.includes("Motor runs") && f.value.includes("switch or wiring")
    )).toBe(true);
    
    // Scenario 2: Motor does NOT work on direct power = motor fault
    const caseId2 = "awning-motor-fault-test";
    createContext(caseId2, "awning");
    
    addFact(caseId2, {
      type: "finding",
      source: "technician",
      value: "Motor does not respond to direct power - motor failure confirmed",
      stepId: "awn_6",
    });
    markIsolationComplete(caseId2, "Motor failure - no response to direct power");
    
    context = getContext(caseId2)!;
    
    // Should conclude motor failure
    expect(context.isolationComplete).toBe(true);
    expect(context.isolationFinding).toContain("Motor failure");
  });

  it("12V electrical procedure validates alt-power test before motor diagnosis", async () => {
    const { detectIntent } = await import("@/lib/context-engine");
    
    // Messages about motor running on direct power
    const workingMessages = [
      "motor runs fine when I bypass the switch",
      "applied 12v directly and it operates",
      "works when jumped directly to battery",
    ];
    
    for (const msg of workingMessages) {
      const intent = detectIntent(msg);
      // Should be treated as diagnostic response, not key finding
      expect(intent.type).toBe("MAIN_DIAGNOSTIC");
    }
    
    // Messages about motor NOT running on direct power (failure)
    // These would be detected by the diagnostic registry's key finding patterns
    // rather than the context engine's new evidence detection
  });
});

// ── Integration Tests ───────────────────────────────────────────────

describe("Context Engine — Integration", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("full flow: diagnostic → clarification → return → continue", async () => {
    const { 
      createContext, 
      setActiveStep,
      processMessage, 
      getContext,
      clearContext,
    } = await import("@/lib/context-engine");
    
    const caseId = "full-flow-test";
    clearContext(caseId);
    createContext(caseId, "roof_ac", "complex");
    setActiveStep(caseId, "ac_5");
    
    // Step 1: In main diagnostic flow
    let context = getContext(caseId)!;
    expect(context.submode).toBe("main");
    
    // Step 2: Technician asks clarification
    let result = processMessage(caseId, "where is the capacitor located?");
    expect(result.intent.type).toBe("LOCATE");
    expect(result.context.submode).toBe("clarification");
    
    // Step 3: After clarification, simulate pop back to main
    // (This would normally happen after the LLM responds)
    const { popTopic, updateContext } = await import("@/lib/context-engine");
    context = popTopic(result.context);
    updateContext(context);
    
    context = getContext(caseId)!;
    expect(context.submode).toBe("main");
    
    // Step 4: Continue with diagnostic
    result = processMessage(caseId, "capacitor looks bulged and leaking");
    expect(result.intent.type).toBe("DISPUTE_OR_NEW_EVIDENCE");
    expect(result.intent.type === "DISPUTE_OR_NEW_EVIDENCE" && result.intent.evidenceType).toBe("physical_damage");
  });

  it("full flow: replan scenario", async () => {
    const { 
      createContext, 
      markIsolationComplete,
      processMessage, 
      getContext,
      clearContext,
      DEFAULT_CONFIG,
    } = await import("@/lib/context-engine");
    
    const caseId = "replan-flow-test";
    clearContext(caseId);
    createContext(caseId, "roof_ac", "complex");
    
    // Mark isolation complete
    markIsolationComplete(caseId, "Compressor not starting - capacitor failure suspected");
    
    let context = getContext(caseId)!;
    expect(context.isolationComplete).toBe(true);
    
    // Technician discovers new evidence
    const result = processMessage(caseId, "wait, I found a refrigerant leak on the condenser coil", DEFAULT_CONFIG);
    
    // Should trigger replan
    expect(result.notices.some(n => n.includes("Replan"))).toBe(true);
    expect(result.context.isolationComplete).toBe(false);
    expect(result.context.isolationInvalidated).toBe(true);
    expect(result.responseInstructions.action).toBe("replan_notice");
  });

});
