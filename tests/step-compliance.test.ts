/**
 * Tests for Step Compliance Validation and Execution Authority
 * 
 * These tests verify that the Context Engine has execution authority
 * over diagnostic step selection, not just advisory prompt context.
 */

import { describe, it, expect } from "vitest";
import { validateStepCompliance, isStepAnswered } from "@/lib/mode-validators";

describe("Step Compliance Validation", () => {
  describe("validateStepCompliance", () => {
    it("passes when response matches the active step question", () => {
      const result = validateStepCompliance(
        "Does the pump attempt to run when you open a faucet? Any noise or humming?",
        "wp_1",
        "Does the pump attempt to run when a faucet is opened?"
      );
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("fails when response completely diverges from active step", () => {
      const result = validateStepCompliance(
        "Let's check the thermocouple millivolt reading with your multimeter.",
        "wp_1",
        "Does the pump attempt to run when a faucet is opened?"
      );
      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes("STEP_COMPLIANCE"))).toBe(true);
    });

    it("allows natural paraphrasing of the same question", () => {
      const result = validateStepCompliance(
        "When you open a faucet, does the pump try to run? Can you hear anything?",
        "wp_1",
        "Does the pump attempt to run when a faucet is opened?"
      );
      expect(result.valid).toBe(true);
    });

    it("passes when no active step is defined", () => {
      const result = validateStepCompliance(
        "Any response here",
        null,
        null
      );
      expect(result.valid).toBe(true);
    });

    it("detects wrong step ID references", () => {
      const result = validateStepCompliance(
        "Let's check step wh_g_5 now - is there flame present?",
        "wp_1",
        "Does the pump attempt to run when a faucet is opened?"
      );
      // Should flag because it references wh_g_5 when active is wp_1
      expect(result.violations.some(v => v.includes("STEP_COMPLIANCE") || v.includes("wrong step"))).toBe(true);
    });
  });

  describe("isStepAnswered (contextual completion)", () => {
    it("detects simple yes/no answers", () => {
      expect(isStepAnswered("yes", "Does the pump run?")).toBe(true);
      expect(isStepAnswered("no", "Does the pump run?")).toBe(true);
      expect(isStepAnswered("nope", "Does the pump run?")).toBe(true);
      expect(isStepAnswered("yeah", "Does the pump run?")).toBe(true);
    });

    it("detects Russian yes/no answers", () => {
      expect(isStepAnswered("да", "Does the pump run?")).toBe(true);
      expect(isStepAnswered("нет", "Does the pump run?")).toBe(true);
    });

    it("detects voltage measurements", () => {
      expect(isStepAnswered("12.4v", "Voltage at pump terminals?")).toBe(true);
      expect(isStepAnswered("12.4 volts", "Voltage at pump terminals?")).toBe(true);
      expect(isStepAnswered("0v", "Voltage at pump terminals?")).toBe(true);
    });

    it("detects state descriptions", () => {
      expect(isStepAnswered("open", "Is the valve open or closed?")).toBe(true);
      expect(isStepAnswered("closed", "Is the valve open or closed?")).toBe(true);
      expect(isStepAnswered("running", "Is the pump running?")).toBe(true);
    });

    it("detects findings with conclusion indicators", () => {
      expect(isStepAnswered("found a burnt fuse", "Check the fuse condition")).toBe(true);
      expect(isStepAnswered("checked it, looks good", "Check the fuse condition")).toBe(true);
      expect(isStepAnswered("measured 12.5V", "Voltage at terminals?")).toBe(true);
    });

    it("detects 'already checked' patterns", () => {
      expect(isStepAnswered("already checked that", "Is the valve open?")).toBe(true);
      expect(isStepAnswered("told you earlier it's open", "Is the valve open?")).toBe(true);
    });

    it("detects 'unable to check' patterns", () => {
      expect(isStepAnswered("can't check that", "Measure thermocouple millivolts?")).toBe(true);
      expect(isStepAnswered("no tool for that", "Measure thermocouple millivolts?")).toBe(true);
      expect(isStepAnswered("unable to access", "Check the element?")).toBe(true);
    });

    it("returns false for unrelated questions", () => {
      expect(isStepAnswered("what is a thermocouple?", "Does the pump run?")).toBe(false);
      expect(isStepAnswered("where is the capacitor located?", "Does the pump run?")).toBe(false);
    });
  });
});

describe("Loop Recovery Enforcement", () => {
  // These tests verify that the loop guard recovery is actually applied,
  // not just detected. The integration is in route.ts.
  
  it("suggestLoopRecovery returns actionable recovery", async () => {
    const { suggestLoopRecovery } = await import("@/lib/context-engine");
    
    // Create a context with a repeated step
    const context = {
      caseId: "test_case",
      mode: "diagnostic" as const,
      submode: "main" as const,
      activeStepId: "wp_1",
      completedStepIds: [],
      unableStepIds: [],
      facts: [],
      agentActions: [
        { type: "question", stepId: "wp_1", timestamp: new Date().toISOString() },
        { type: "question", stepId: "wp_1", timestamp: new Date().toISOString() },
        { type: "question", stepId: "wp_1", timestamp: new Date().toISOString() },
      ],
      topicStack: [],
      hypotheses: [],
      contradictions: [],
      isolationComplete: false,
      isolationFinding: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    const recovery = suggestLoopRecovery(context as any, "Step wp_1 asked 3 times");
    
    expect(recovery.action).toBeTruthy();
    expect(recovery.reason).toBeTruthy();
  });
});
