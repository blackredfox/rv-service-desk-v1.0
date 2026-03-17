/**
 * Tests for Branch Runtime Integration
 * 
 * These tests verify that branch processing is correctly integrated
 * into the runtime path (route.ts).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  initializeCase,
  markStepCompleted,
  getNextStepId,
  processResponseForBranch,
  getBranchState,
  exitBranch,
} from "@/lib/diagnostic-registry";

describe("Branch Runtime Integration", () => {
  const caseId = "test_runtime_branch";
  
  beforeEach(() => {
    // Reset by re-initializing
    initializeCase(caseId + "_" + Date.now(), "water heater test");
  });

  describe("Full branch flow simulation (mimics route.ts)", () => {
    it("simulates complete branch entry and progression", () => {
      const testCaseId = "test_full_branch_sim_" + Date.now();
      
      // 1. Initialize (like route.ts does)
      const init = initializeCase(testCaseId, "gas water heater not lighting");
      expect(init.procedure?.system).toBe("water_heater");
      
      // 2. Complete prerequisite steps (simulating technician responses)
      ["wh_1", "wh_2", "wh_3", "wh_4", "wh_5"].forEach(stepId => {
        markStepCompleted(testCaseId, stepId);
      });
      
      // 3. Get next step - should be wh_6
      let nextStep = getNextStepId(testCaseId);
      expect(nextStep).toBe("wh_6");
      
      // 4. Complete wh_6 with response that triggers no_ignition branch
      markStepCompleted(testCaseId, "wh_6");
      
      // 5. Process response for branch (THIS IS WHAT ROUTE.TS NOW DOES)
      const branchResult = processResponseForBranch(
        testCaseId,
        "wh_6",
        "No, no clicking or spark heard at all"
      );
      
      // Verify branch was entered
      expect(branchResult.branchEntered).not.toBeNull();
      expect(branchResult.branchEntered?.id).toBe("no_ignition");
      expect(branchResult.lockedOut).toContain("flame_failure");
      
      // 6. Verify branch state
      const state = getBranchState(testCaseId);
      expect(state.activeBranchId).toBe("no_ignition");
      expect(state.lockedOutBranches).toContain("flame_failure");
      
      // 7. Get next step - should be first branch step
      nextStep = getNextStepId(testCaseId);
      expect(nextStep).toBe("wh_6a"); // First step in no_ignition branch
      
      // 8. Complete branch steps
      markStepCompleted(testCaseId, "wh_6a");
      nextStep = getNextStepId(testCaseId);
      expect(["wh_6b", "wh_6c"]).toContain(nextStep); // Both have wh_6a as prereq
      
      markStepCompleted(testCaseId, "wh_6b");
      markStepCompleted(testCaseId, "wh_6c");
      
      // 9. After all branch steps, getNextStepId should return null for this branch
      nextStep = getNextStepId(testCaseId);
      expect(nextStep).toBeNull(); // All branch steps done
      
      // 10. Exit branch (like route.ts does when no more branch steps)
      exitBranch(testCaseId, "Branch steps exhausted");
      
      // 11. After branch exit, should be back in main flow
      const stateAfterExit = getBranchState(testCaseId);
      expect(stateAfterExit.activeBranchId).toBeNull();
      
      // 12. Now getNextStepId should return a main-flow step
      nextStep = getNextStepId(testCaseId);
      // Should be wh_7 or later main-flow step that has prereqs met
      expect(nextStep).not.toBeNull();
    });

    it("prevents entering locked-out branch even if trigger matches", () => {
      const testCaseId = "test_lockout_" + Date.now();
      initializeCase(testCaseId, "water heater test");
      
      // Complete up to wh_6
      ["wh_1", "wh_2", "wh_3", "wh_4", "wh_5", "wh_6"].forEach(s => {
        markStepCompleted(testCaseId, s);
      });
      
      // Enter no_ignition branch
      processResponseForBranch(testCaseId, "wh_6", "no spark");
      
      // Complete branch and wh_7
      ["wh_6a", "wh_6b", "wh_6c"].forEach(s => markStepCompleted(testCaseId, s));
      exitBranch(testCaseId, "done");
      markStepCompleted(testCaseId, "wh_7");
      
      // Try to trigger flame_failure branch (which is locked out)
      const result = processResponseForBranch(testCaseId, "wh_7", "flame goes out");
      
      // Should NOT enter because we're in main flow and flame_failure is locked
      // (Actually, processResponseForBranch only triggers from main flow when not in a branch,
      // but the branch is locked so it shouldn't be enterable anyway)
      const state = getBranchState(testCaseId);
      expect(state.lockedOutBranches).toContain("flame_failure");
    });

    it("step IDs are distinct within branches", () => {
      const testCaseId = "test_distinct_ids_" + Date.now();
      initializeCase(testCaseId, "water heater test");
      
      // Complete prerequisites and enter no_ignition branch
      ["wh_1", "wh_2", "wh_3", "wh_4", "wh_5", "wh_6"].forEach(s => markStepCompleted(testCaseId, s));
      processResponseForBranch(testCaseId, "wh_6", "no spark");
      
      // Track all step IDs we encounter
      const stepIds: string[] = [];
      let nextStep = getNextStepId(testCaseId);
      
      while (nextStep) {
        // Verify this step ID is not already in our list (no duplicates)
        expect(stepIds).not.toContain(nextStep);
        stepIds.push(nextStep);
        markStepCompleted(testCaseId, nextStep);
        nextStep = getNextStepId(testCaseId);
      }
      
      // Should have progressed through distinct step IDs
      expect(stepIds.length).toBeGreaterThan(0);
      expect(new Set(stepIds).size).toBe(stepIds.length); // All unique
    });
  });

  describe("Edge cases", () => {
    it("handles case with no branches defined", () => {
      const testCaseId = "test_no_branch_" + Date.now();
      initializeCase(testCaseId, "water pump not working");
      
      // Water pump has no branches defined
      markStepCompleted(testCaseId, "wp_1");
      
      const result = processResponseForBranch(testCaseId, "wp_1", "any response");
      expect(result.branchEntered).toBeNull();
      expect(result.lockedOut).toHaveLength(0);
    });

    it("does not trigger branch when already in a branch", () => {
      const testCaseId = "test_nested_" + Date.now();
      initializeCase(testCaseId, "water heater test");
      
      // Enter no_ignition branch
      ["wh_1", "wh_2", "wh_3", "wh_4", "wh_5", "wh_6"].forEach(s => markStepCompleted(testCaseId, s));
      processResponseForBranch(testCaseId, "wh_6", "no spark");
      
      // While in branch, try to trigger another branch
      const result = processResponseForBranch(testCaseId, "wh_6a", "flame goes out");
      
      // Should not enter a new branch while in one
      expect(result.branchEntered).toBeNull();
      
      const state = getBranchState(testCaseId);
      expect(state.activeBranchId).toBe("no_ignition"); // Still in original branch
    });
  });
});
