/**
 * P1.5 Branch Runtime Integration Regression Tests
 *
 * Verifies the exact failures reported in the P1.5 water-heater loop bug:
 *
 * 1. Branch entry steps are NOT reachable from main flow without a trigger
 *    (fixes accidental branch entry that caused wh_7 / wh_6a looping)
 *
 * 2. processResponseForBranch IS called before getNextStepId in the step-
 *    completion path (the missing integration point)
 *
 * 3. Branch exit works correctly and returns to distinct main-flow step IDs
 *
 * 4. Russian/multilingual responses can trigger branches
 *
 * 5. No step ID is reused across turns (distinct substep identity)
 */

import { describe, it, expect } from "vitest";
import {
  initializeCase,
  markStepCompleted,
  getNextStepId,
  processResponseForBranch,
  getBranchState,
  exitBranch,
} from "@/lib/diagnostic-registry";
// ── Helper: complete all prerequisites up to a given step ────────────
function completeSteps(caseId: string, stepIds: string[]): void {
  stepIds.forEach((id) => markStepCompleted(caseId, id));
}

describe("P1.5 — Branch Runtime Integration Fix", () => {
  // ── Fix 1: getNextStepBranchAware must NOT return branch entry steps ──
  describe("Fix 1 — getNextStepBranchAware: no branch steps in main flow", () => {
    it("returns only main-flow steps when activeBranchId is null", () => {
      const caseId = "p15_fix1_" + Date.now();
      initializeCase(caseId, "gas water heater not working");

      // Complete up to wh_6 (branch trigger step) and also wh_7 without entering any branch
      completeSteps(caseId, ["wh_1", "wh_2", "wh_3", "wh_4", "wh_5", "wh_6", "wh_7"]);

      // getNextStepId should NOT return wh_6a or wh_7a (branch entry steps)
      const next = getNextStepId(caseId);

      // Must be a main-flow step, NOT a branch entry step
      expect(next).not.toBe("wh_6a");
      expect(next).not.toBe("wh_7a");
      expect(next).not.toBe("wh_8a");

      // Should be one of the main-flow continuation steps
      // (wh_8, wh_9, wh_10, wh_11, wh_12 are main-flow steps with various prereqs)
      const mainFlowSteps = [
        "wh_8",
        "wh_9",
        "wh_10",
        "wh_11",
        "wh_12",
        null, // all done is also acceptable
      ];
      expect(mainFlowSteps).toContain(next);
    });

    it("does not expose no_ignition entry step from main flow even if prerequisites met", () => {
      const caseId = "p15_fix1b_" + Date.now();
      const init = initializeCase(caseId, "water heater no spark");
      expect(init.procedure?.system).toBe("water_heater");

      // wh_6a has prerequisites: ["wh_6"]
      // Completing wh_6 should NOT make wh_6a visible from main flow
      completeSteps(caseId, ["wh_1", "wh_2", "wh_3", "wh_4", "wh_5", "wh_6"]);

      const state = getBranchState(caseId);
      expect(state.activeBranchId).toBeNull(); // No branch entered yet

      const next = getNextStepId(caseId);
      // Should be wh_7 (next main-flow step after wh_6), NOT wh_6a (branch entry)
      expect(next).toBe("wh_7");
    });
  });

  // ── Fix 2: processResponseForBranch must be called BEFORE getNextStepId ─
  describe("Fix 2 — processResponseForBranch called before next-step resolution", () => {
    it("entering no_ignition branch: next step is wh_6a, not wh_7", () => {
      const caseId = "p15_fix2_" + Date.now();
      initializeCase(caseId, "water heater test");

      completeSteps(caseId, ["wh_1", "wh_2", "wh_3", "wh_4", "wh_5"]);
      markStepCompleted(caseId, "wh_6");

      // Trigger no_ignition BEFORE computing next step (mimics context-engine fix)
      const result = processResponseForBranch(
        caseId,
        "wh_6",
        "no clicking, no spark at all"
      );

      expect(result.branchEntered?.id).toBe("no_ignition");

      // Now getNextStepId uses updated activeBranchId
      const next = getNextStepId(caseId);
      expect(next).toBe("wh_6a"); // First branch step, NOT main-flow wh_7
    });

    it("NOT entering branch: next step is wh_7, not wh_6a", () => {
      const caseId = "p15_fix2b_" + Date.now();
      initializeCase(caseId, "water heater test");

      completeSteps(caseId, ["wh_1", "wh_2", "wh_3", "wh_4", "wh_5"]);
      markStepCompleted(caseId, "wh_6");

      // Process response that does NOT trigger any branch
      const result = processResponseForBranch(
        caseId,
        "wh_6",
        "Yes, I hear clicking and sparking"
      );

      expect(result.branchEntered).toBeNull(); // No branch triggered

      // getNextStepId should return next main-flow step, not a branch step
      const next = getNextStepId(caseId);
      expect(next).toBe("wh_7");
      expect(next).not.toBe("wh_6a");
    });
  });

  // ── Fix 3: Branch exit returns to distinct main-flow step IDs ────────
  describe("Fix 3 — branch exit and main-flow continuation", () => {
    it("after branch exhaustion, returns to main flow with distinct step ID", () => {
      const caseId = "p15_fix3_" + Date.now();
      initializeCase(caseId, "water heater test");

      // Run through main flow, enter no_ignition branch
      completeSteps(caseId, ["wh_1", "wh_2", "wh_3", "wh_4", "wh_5", "wh_6"]);
      processResponseForBranch(caseId, "wh_6", "no spark no click");

      expect(getBranchState(caseId).activeBranchId).toBe("no_ignition");

      // Complete all no_ignition branch steps
      let next = getNextStepId(caseId);
      const branchStepsTraversed: string[] = [];
      while (next && next.startsWith("wh_6")) {
        branchStepsTraversed.push(next);
        markStepCompleted(caseId, next);
        next = getNextStepId(caseId);
      }

      // Should have traversed distinct branch step IDs
      expect(new Set(branchStepsTraversed).size).toBe(branchStepsTraversed.length);

      // After all branch steps done, getNextStepId returns null (still in branch)
      expect(getNextStepId(caseId)).toBeNull();

      // Exit branch (as context-engine now does automatically)
      exitBranch(caseId, "Branch steps exhausted");
      expect(getBranchState(caseId).activeBranchId).toBeNull();

      // Main flow should resume
      const mainNext = getNextStepId(caseId);
      expect(mainNext).not.toBeNull();
      // Must NOT be any of the branch steps already traversed
      for (const branchStep of branchStepsTraversed) {
        expect(mainNext).not.toBe(branchStep);
      }
      // Must NOT be another branch entry step
      expect(mainNext).not.toBe("wh_6a");
      expect(mainNext).not.toBe("wh_7a");
    });
  });

  // ── Fix 4: Russian responses can trigger branches ─────────────────
  describe("Fix 4 — multilingual branch trigger patterns", () => {
    it("Russian 'нет щелчка' triggers no_ignition branch", () => {
      const caseId = "p15_fix4_ru_" + Date.now();
      initializeCase(caseId, "water heater test");

      completeSteps(caseId, ["wh_1", "wh_2", "wh_3", "wh_4", "wh_5", "wh_6"]);

      const result = processResponseForBranch(
        caseId,
        "wh_6",
        "нет, не слышно щелчка и искры нет"
      );

      expect(result.branchEntered).not.toBeNull();
      expect(result.branchEntered?.id).toBe("no_ignition");
    });

    it("Russian flame failure triggers flame_failure branch", () => {
      const caseId = "p15_fix4_ru2_" + Date.now();
      initializeCase(caseId, "water heater test");

      completeSteps(caseId, [
        "wh_1", "wh_2", "wh_3", "wh_4", "wh_5", "wh_6", "wh_7",
      ]);

      const result = processResponseForBranch(
        caseId,
        "wh_7",
        "пламя зажигается но быстро гаснет"
      );

      expect(result.branchEntered).not.toBeNull();
      expect(result.branchEntered?.id).toBe("flame_failure");
    });

    it("Spanish 'sin chispa' triggers no_ignition branch", () => {
      const caseId = "p15_fix4_es_" + Date.now();
      initializeCase(caseId, "water heater test");

      completeSteps(caseId, ["wh_1", "wh_2", "wh_3", "wh_4", "wh_5", "wh_6"]);

      const result = processResponseForBranch(
        caseId,
        "wh_6",
        "no hay chispa, nada de clic"
      );

      expect(result.branchEntered).not.toBeNull();
      expect(result.branchEntered?.id).toBe("no_ignition");
    });
  });

  // ── Fix 5: No step ID reuse across turns ────────────────────────────
  describe("Fix 5 — distinct step ID identity (no wh_7 loop)", () => {
    it("each step ID appears at most once in complete main-flow traversal", () => {
      const caseId = "p15_fix5_" + Date.now();
      initializeCase(caseId, "water heater test");

      const traversed: string[] = [];
      let step = getNextStepId(caseId);

      // Limit iterations to prevent accidental infinite loop
      let iterations = 0;
      while (step && iterations < 50) {
        expect(traversed).not.toContain(step); // No repeats
        traversed.push(step);
        markStepCompleted(caseId, step);
        step = getNextStepId(caseId);
        iterations++;
      }

      // Sanity: we traversed at least the core main-flow steps
      expect(traversed.length).toBeGreaterThanOrEqual(7);
      // All unique
      expect(new Set(traversed).size).toBe(traversed.length);
    });

    it("entering a branch and traversing it also yields distinct IDs", () => {
      const caseId = "p15_fix5b_" + Date.now();
      initializeCase(caseId, "water heater test");

      completeSteps(caseId, ["wh_1", "wh_2", "wh_3", "wh_4", "wh_5", "wh_6"]);
      processResponseForBranch(caseId, "wh_6", "no spark");

      const branchIds: string[] = [];
      let step = getNextStepId(caseId);

      while (step) {
        expect(branchIds).not.toContain(step);
        branchIds.push(step);
        markStepCompleted(caseId, step);
        step = getNextStepId(caseId);
      }

      expect(new Set(branchIds).size).toBe(branchIds.length);
    });
  });
});
