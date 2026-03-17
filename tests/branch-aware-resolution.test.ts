/**
 * Tests for Branch-Aware Step Resolution (P1.5)
 * 
 * These tests verify that the diagnostic system properly handles
 * branching logic and prevents parallel incompatible branches.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  getProcedure,
  getNextStep,
  getNextStepBranchAware,
  detectBranchTrigger,
  getMutuallyExclusiveBranches,
} from "@/lib/diagnostic-procedures";
import {
  initializeCase,
  markStepCompleted,
  getNextStepId,
  processResponseForBranch,
  getBranchState,
  setActiveBranch,
  exitBranch,
} from "@/lib/diagnostic-registry";

describe("Branch-Aware Step Resolution (P1.5)", () => {
  const caseId = "test_case_branch";
  
  beforeEach(() => {
    // Clear the registry between tests
    // Note: This may need adjustment based on registry implementation
  });

  describe("getNextStepBranchAware", () => {
    it("returns only main-flow steps when no branch is active", () => {
      const procedure = getProcedure("water_heater");
      expect(procedure).not.toBeNull();
      if (!procedure) return;
      
      const step = getNextStepBranchAware(
        procedure,
        new Set(),
        new Set(),
        null, // No active branch
        new Set(), // No locked branches
      );
      
      expect(step).not.toBeNull();
      expect(step?.branchId).toBeUndefined(); // Main flow step
    });

    it("returns only branch steps when a branch is active", () => {
      const procedure = getProcedure("water_heater");
      expect(procedure).not.toBeNull();
      if (!procedure) return;
      
      // Complete prerequisites for no_ignition branch entry point
      const completed = new Set(["wh_1", "wh_2", "wh_3", "wh_4", "wh_5", "wh_6"]);
      
      const step = getNextStepBranchAware(
        procedure,
        completed,
        new Set(),
        "no_ignition", // Active branch
        new Set(),
      );
      
      expect(step).not.toBeNull();
      expect(step?.id).toBe("wh_6a"); // First step in no_ignition branch
      expect(step?.branchId).toBe("no_ignition");
    });

    it("skips locked-out branch steps", () => {
      const procedure = getProcedure("water_heater");
      expect(procedure).not.toBeNull();
      if (!procedure) return;
      
      // Complete prerequisites
      const completed = new Set(["wh_1", "wh_2", "wh_3", "wh_4", "wh_5", "wh_6", "wh_7"]);
      
      // Lock out flame_failure branch
      const lockedOut = new Set(["flame_failure"]);
      
      const step = getNextStepBranchAware(
        procedure,
        completed,
        new Set(),
        null, // Main flow
        lockedOut,
      );
      
      // Should NOT return flame_failure branch entry step
      expect(step?.branchId).not.toBe("flame_failure");
    });
  });

  describe("detectBranchTrigger", () => {
    it("detects no_ignition branch trigger", () => {
      const procedure = getProcedure("water_heater");
      expect(procedure).not.toBeNull();
      if (!procedure) return;
      
      const branch = detectBranchTrigger(
        procedure,
        "wh_6",
        "No, no clicking or sparking heard"
      );
      
      expect(branch).not.toBeNull();
      expect(branch?.id).toBe("no_ignition");
    });

    it("detects flame_failure branch trigger", () => {
      const procedure = getProcedure("water_heater");
      expect(procedure).not.toBeNull();
      if (!procedure) return;
      
      const branch = detectBranchTrigger(
        procedure,
        "wh_7",
        "Flame lights but goes out after a few seconds"
      );
      
      expect(branch).not.toBeNull();
      expect(branch?.id).toBe("flame_failure");
    });

    it("detects no_gas branch trigger", () => {
      const procedure = getProcedure("water_heater");
      expect(procedure).not.toBeNull();
      if (!procedure) return;
      
      const branch = detectBranchTrigger(
        procedure,
        "wh_8",
        "No gas smell at burner tube"
      );
      
      expect(branch).not.toBeNull();
      expect(branch?.id).toBe("no_gas");
    });

    it("returns null when no branch is triggered", () => {
      const procedure = getProcedure("water_heater");
      expect(procedure).not.toBeNull();
      if (!procedure) return;
      
      const branch = detectBranchTrigger(
        procedure,
        "wh_6",
        "Yes, I hear clicking"
      );
      
      expect(branch).toBeNull();
    });

    it("returns null for non-trigger steps", () => {
      const procedure = getProcedure("water_heater");
      expect(procedure).not.toBeNull();
      if (!procedure) return;
      
      const branch = detectBranchTrigger(
        procedure,
        "wh_1", // Not a trigger step
        "No clicking"
      );
      
      expect(branch).toBeNull();
    });
  });

  describe("getMutuallyExclusiveBranches", () => {
    it("returns mutually exclusive branches for no_ignition", () => {
      const procedure = getProcedure("water_heater");
      expect(procedure).not.toBeNull();
      if (!procedure) return;
      
      const exclusive = getMutuallyExclusiveBranches(procedure, "no_ignition");
      expect(exclusive).toContain("flame_failure");
    });

    it("returns mutually exclusive branches for flame_failure", () => {
      const procedure = getProcedure("water_heater");
      expect(procedure).not.toBeNull();
      if (!procedure) return;
      
      const exclusive = getMutuallyExclusiveBranches(procedure, "flame_failure");
      expect(exclusive).toContain("no_ignition");
    });

    it("returns empty array for branches without exclusions", () => {
      const procedure = getProcedure("water_heater");
      expect(procedure).not.toBeNull();
      if (!procedure) return;
      
      const exclusive = getMutuallyExclusiveBranches(procedure, "no_gas");
      expect(exclusive).toHaveLength(0);
    });
  });

  describe("Registry branch state management", () => {
    it("initializes with no active branch", () => {
      initializeCase(caseId, "water heater not working");
      const state = getBranchState(caseId);
      
      expect(state.activeBranchId).toBeNull();
      expect(state.decisionPath).toHaveLength(0);
      expect(state.lockedOutBranches).toHaveLength(0);
    });

    it("processResponseForBranch enters branch and locks exclusives", () => {
      const testCaseId = "test_branch_entry";
      initializeCase(testCaseId, "water heater no ignition");
      
      // Simulate completing steps up to wh_6
      markStepCompleted(testCaseId, "wh_1");
      markStepCompleted(testCaseId, "wh_2");
      markStepCompleted(testCaseId, "wh_3");
      markStepCompleted(testCaseId, "wh_4");
      markStepCompleted(testCaseId, "wh_5");
      
      // Process response that triggers no_ignition branch
      const result = processResponseForBranch(
        testCaseId,
        "wh_6",
        "No clicking or sparking"
      );
      
      expect(result.branchEntered).not.toBeNull();
      expect(result.branchEntered?.id).toBe("no_ignition");
      expect(result.lockedOut).toContain("flame_failure");
      
      const state = getBranchState(testCaseId);
      expect(state.activeBranchId).toBe("no_ignition");
      expect(state.lockedOutBranches).toContain("flame_failure");
    });

    it("setActiveBranch records decision in path", () => {
      const testCaseId = "test_manual_branch";
      initializeCase(testCaseId, "water heater test");
      
      setActiveBranch(testCaseId, "flame_failure", "Manual test");
      
      const state = getBranchState(testCaseId);
      expect(state.activeBranchId).toBe("flame_failure");
      expect(state.decisionPath.length).toBeGreaterThan(0);
      expect(state.decisionPath[state.decisionPath.length - 1].branchId).toBe("flame_failure");
    });

    it("exitBranch returns to main flow", () => {
      const testCaseId = "test_exit_branch";
      initializeCase(testCaseId, "water heater test");
      
      setActiveBranch(testCaseId, "no_gas", "Test entry");
      exitBranch(testCaseId, "Branch completed");
      
      const state = getBranchState(testCaseId);
      expect(state.activeBranchId).toBeNull();
      expect(state.decisionPath.length).toBe(2); // Entry + exit
    });
  });

  describe("Linear progression with branching", () => {
    it("follows main flow when no branch triggered", () => {
      const testCaseId = "test_main_flow";
      initializeCase(testCaseId, "gas water heater problem");
      
      // Step through main flow with positive responses
      const steps = ["wh_1", "wh_2", "wh_3", "wh_4", "wh_5"];
      for (const stepId of steps) {
        markStepCompleted(testCaseId, stepId);
      }
      
      // Get next step - should be wh_6 (ignition check)
      const nextStep = getNextStepId(testCaseId);
      expect(nextStep).toBe("wh_6");
      
      // Complete wh_6 with positive response (no branch trigger)
      markStepCompleted(testCaseId, "wh_6");
      processResponseForBranch(testCaseId, "wh_6", "Yes, clicking heard");
      
      // Next should be wh_7 (flame check)
      const afterIgnition = getNextStepId(testCaseId);
      expect(afterIgnition).toBe("wh_7");
    });

    it("enters branch and stays in branch until complete", () => {
      const testCaseId = "test_branch_flow";
      initializeCase(testCaseId, "gas water heater no ignition");
      
      // Complete prerequisites
      ["wh_1", "wh_2", "wh_3", "wh_4", "wh_5", "wh_6"].forEach(s => markStepCompleted(testCaseId, s));
      
      // Trigger no_ignition branch
      processResponseForBranch(testCaseId, "wh_6", "No clicking or spark");
      
      // Next step should be in no_ignition branch
      const branchStep1 = getNextStepId(testCaseId);
      expect(branchStep1).toBe("wh_6a");
      
      // Complete branch steps
      markStepCompleted(testCaseId, "wh_6a");
      const branchStep2 = getNextStepId(testCaseId);
      expect(["wh_6b", "wh_6c"]).toContain(branchStep2); // Either is valid
      
      markStepCompleted(testCaseId, "wh_6b");
      markStepCompleted(testCaseId, "wh_6c");
      
      // After branch complete, should return to main flow
      // (Branch exit is manual in current implementation)
      exitBranch(testCaseId, "Branch steps complete");
      
      const state = getBranchState(testCaseId);
      expect(state.activeBranchId).toBeNull();
    });

    it("prevents flame_failure branch after no_ignition entered", () => {
      const testCaseId = "test_exclusive_branches";
      initializeCase(testCaseId, "water heater test");
      
      // Complete prerequisites
      ["wh_1", "wh_2", "wh_3", "wh_4", "wh_5", "wh_6"].forEach(s => markStepCompleted(testCaseId, s));
      
      // Enter no_ignition branch
      processResponseForBranch(testCaseId, "wh_6", "No spark");
      
      const state = getBranchState(testCaseId);
      expect(state.lockedOutBranches).toContain("flame_failure");
      
      // Even if we try to process a flame_failure trigger, it shouldn't work
      // because we're already in a branch
      const result = processResponseForBranch(testCaseId, "wh_7", "Flame goes out");
      expect(result.branchEntered).toBeNull(); // Can't enter new branch while in one
    });
  });
});
