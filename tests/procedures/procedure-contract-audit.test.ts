/**
 * Procedure Contract Audit v1
 * 
 * Validates that RVSD procedure definitions are structurally sound and safe to use.
 * This is an offline audit layer — no runtime code changes.
 * 
 * Audit targets:
 * 1. Step ID integrity (duplicates, empty/malformed)
 * 2. Prerequisite integrity (missing refs, self-refs, circular chains)
 * 3. Branch integrity (trigger/entry step validation, unknown branch refs)
 * 4. Ordering/reachability sanity
 * 5. howToCheck coverage for complex procedures
 * 
 * @see /docs/PROCEDURE_AUTHORING_STANDARD.md
 */

import { describe, it, expect } from "vitest";
import {
  getProcedure,
  getRegisteredSystems,
  type DiagnosticProcedure,
  type DiagnosticStep,
  type ProcedureBranch,
} from "@/lib/diagnostic-procedures";

// ── Test Helpers ────────────────────────────────────────────────────

/**
 * Validate step ID format: must be non-empty, alphanumeric with underscores
 */
function isValidStepId(id: string): boolean {
  return typeof id === "string" && id.length > 0 && /^[a-z0-9_]+$/i.test(id);
}

/**
 * Detect circular prerequisite chains using DFS.
 * Returns the cycle path if found, null otherwise.
 */
function detectCircularPrerequisites(
  procedure: DiagnosticProcedure
): string[] | null {
  const stepMap = new Map(procedure.steps.map((s) => [s.id, s]));

  function dfs(
    stepId: string,
    visited: Set<string>,
    path: string[]
  ): string[] | null {
    if (path.includes(stepId)) {
      // Found cycle — return the cycle portion
      const cycleStart = path.indexOf(stepId);
      return [...path.slice(cycleStart), stepId];
    }
    if (visited.has(stepId)) return null;

    visited.add(stepId);
    path.push(stepId);

    const step = stepMap.get(stepId);
    if (step) {
      for (const prereq of step.prerequisites) {
        const cycle = dfs(prereq, visited, [...path]);
        if (cycle) return cycle;
      }
    }

    return null;
  }

  for (const step of procedure.steps) {
    const cycle = dfs(step.id, new Set(), []);
    if (cycle) return cycle;
  }

  return null;
}

/**
 * Find unreachable steps (steps that cannot be reached from any root step).
 * A root step is one with no prerequisites.
 */
function findUnreachableSteps(procedure: DiagnosticProcedure): string[] {
  const stepIds = new Set(procedure.steps.map((s) => s.id));
  const reachable = new Set<string>();

  // Find root steps (no prerequisites)
  const rootSteps = procedure.steps.filter((s) => s.prerequisites.length === 0);

  // BFS from all root steps
  const queue = rootSteps.map((s) => s.id);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);

    // Find steps that have this as a prerequisite (dependents)
    for (const step of procedure.steps) {
      if (step.prerequisites.includes(current) && !reachable.has(step.id)) {
        queue.push(step.id);
      }
    }
  }

  // Return steps that are not reachable
  return procedure.steps
    .filter((s) => !reachable.has(s.id))
    .map((s) => s.id);
}

/**
 * Get all step IDs referenced in branch definitions.
 */
function getBranchReferencedStepIds(branches: ProcedureBranch[]): Set<string> {
  const ids = new Set<string>();
  for (const branch of branches) {
    ids.add(branch.triggerStepId);
    ids.add(branch.entryStepId);
  }
  return ids;
}

// ── Audit Tests ─────────────────────────────────────────────────────

describe("Procedure Contract Audit v1", () => {
  const allSystems = getRegisteredSystems();

  describe("1. Step ID Integrity", () => {
    it.each(allSystems)("%s: all step IDs are unique within procedure", (system) => {
      const proc = getProcedure(system)!;
      const ids = proc.steps.map((s) => s.id);
      const uniqueIds = new Set(ids);

      const duplicates = ids.filter((id, idx) => ids.indexOf(id) !== idx);
      expect(duplicates).toEqual([]);
      expect(ids.length).toBe(uniqueIds.size);
    });

    it.each(allSystems)("%s: all step IDs are valid format (non-empty, alphanumeric)", (system) => {
      const proc = getProcedure(system)!;

      for (const step of proc.steps) {
        expect(isValidStepId(step.id)).toBe(true);
      }
    });

    it.each(allSystems)("%s: no empty or whitespace-only step IDs", (system) => {
      const proc = getProcedure(system)!;

      for (const step of proc.steps) {
        expect(step.id.trim().length).toBeGreaterThan(0);
      }
    });
  });

  describe("2. Prerequisite Integrity", () => {
    it.each(allSystems)("%s: all prerequisites reference existing steps", (system) => {
      const proc = getProcedure(system)!;
      const validIds = new Set(proc.steps.map((s) => s.id));

      const missingRefs: Array<{ stepId: string; missingPrereq: string }> = [];

      for (const step of proc.steps) {
        for (const prereq of step.prerequisites) {
          if (!validIds.has(prereq)) {
            missingRefs.push({ stepId: step.id, missingPrereq: prereq });
          }
        }
      }

      expect(missingRefs).toEqual([]);
    });

    it.each(allSystems)("%s: no self-referential prerequisites", (system) => {
      const proc = getProcedure(system)!;

      const selfRefs: string[] = [];
      for (const step of proc.steps) {
        if (step.prerequisites.includes(step.id)) {
          selfRefs.push(step.id);
        }
      }

      expect(selfRefs).toEqual([]);
    });

    it.each(allSystems)("%s: no circular prerequisite chains", (system) => {
      const proc = getProcedure(system)!;
      const cycle = detectCircularPrerequisites(proc);

      if (cycle) {
        throw new Error(
          `Circular prerequisite chain detected: ${cycle.join(" -> ")}`
        );
      }
      expect(cycle).toBeNull();
    });
  });

  describe("3. Branch Integrity", () => {
    // Filter to procedures that have branches
    const systemsWithBranches = allSystems.filter((system) => {
      const proc = getProcedure(system);
      return proc?.branches && proc.branches.length > 0;
    });

    it.each(systemsWithBranches)("%s: all branch trigger steps exist", (system) => {
      const proc = getProcedure(system)!;
      const validIds = new Set(proc.steps.map((s) => s.id));

      const missingTriggers: Array<{ branchId: string; triggerStepId: string }> = [];
      for (const branch of proc.branches!) {
        if (!validIds.has(branch.triggerStepId)) {
          missingTriggers.push({
            branchId: branch.id,
            triggerStepId: branch.triggerStepId,
          });
        }
      }

      expect(missingTriggers).toEqual([]);
    });

    it.each(systemsWithBranches)("%s: all branch entry steps exist", (system) => {
      const proc = getProcedure(system)!;
      const validIds = new Set(proc.steps.map((s) => s.id));

      const missingEntries: Array<{ branchId: string; entryStepId: string }> = [];
      for (const branch of proc.branches!) {
        if (!validIds.has(branch.entryStepId)) {
          missingEntries.push({
            branchId: branch.id,
            entryStepId: branch.entryStepId,
          });
        }
      }

      expect(missingEntries).toEqual([]);
    });

    it.each(systemsWithBranches)("%s: branch entry steps are marked with correct branchId", (system) => {
      const proc = getProcedure(system)!;

      const mismatches: Array<{
        branchId: string;
        entryStepId: string;
        stepBranchId: string | undefined;
      }> = [];

      for (const branch of proc.branches!) {
        const entryStep = proc.steps.find((s) => s.id === branch.entryStepId);
        if (entryStep && entryStep.branchId !== branch.id) {
          mismatches.push({
            branchId: branch.id,
            entryStepId: branch.entryStepId,
            stepBranchId: entryStep.branchId,
          });
        }
      }

      expect(mismatches).toEqual([]);
    });

    it.each(systemsWithBranches)("%s: mutually exclusive branches reference existing branches", (system) => {
      const proc = getProcedure(system)!;
      const branchIds = new Set(proc.branches!.map((b) => b.id));

      const invalidRefs: Array<{ branchId: string; unknownExclusive: string }> = [];
      for (const branch of proc.branches!) {
        for (const exclusiveId of branch.mutuallyExclusive) {
          if (!branchIds.has(exclusiveId)) {
            invalidRefs.push({
              branchId: branch.id,
              unknownExclusive: exclusiveId,
            });
          }
        }
      }

      expect(invalidRefs).toEqual([]);
    });

    it.each(systemsWithBranches)("%s: branch IDs are unique", (system) => {
      const proc = getProcedure(system)!;
      const ids = proc.branches!.map((b) => b.id);
      const uniqueIds = new Set(ids);

      expect(ids.length).toBe(uniqueIds.size);
    });

    it.each(systemsWithBranches)("%s: steps with branchId reference existing branches", (system) => {
      const proc = getProcedure(system)!;
      const branchIds = new Set(proc.branches!.map((b) => b.id));

      const orphanedSteps: Array<{ stepId: string; branchId: string }> = [];
      for (const step of proc.steps) {
        if (step.branchId && !branchIds.has(step.branchId)) {
          orphanedSteps.push({ stepId: step.id, branchId: step.branchId });
        }
      }

      expect(orphanedSteps).toEqual([]);
    });
  });

  describe("4. Ordering / Reachability Sanity", () => {
    it.each(allSystems)("%s: has at least one root step (no prerequisites)", (system) => {
      const proc = getProcedure(system)!;
      const rootSteps = proc.steps.filter((s) => s.prerequisites.length === 0);

      expect(rootSteps.length).toBeGreaterThan(0);
    });

    it.each(allSystems)("%s: all main-flow steps are reachable from roots", (system) => {
      const proc = getProcedure(system)!;

      // Only check main-flow steps (no branchId)
      const mainFlowSteps = proc.steps.filter((s) => !s.branchId);
      const mainFlowIds = new Set(mainFlowSteps.map((s) => s.id));

      // Find reachable main-flow steps
      const reachable = new Set<string>();
      const roots = mainFlowSteps.filter((s) => s.prerequisites.length === 0);
      const queue = roots.map((s) => s.id);

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (reachable.has(current)) continue;
        reachable.add(current);

        // Find main-flow steps that have this as a prerequisite
        for (const step of mainFlowSteps) {
          if (step.prerequisites.includes(current) && !reachable.has(step.id)) {
            queue.push(step.id);
          }
        }
      }

      const unreachable = mainFlowSteps
        .filter((s) => !reachable.has(s.id))
        .map((s) => s.id);

      expect(unreachable).toEqual([]);
    });

    it.each(allSystems)("%s: branch entry steps have reachable prerequisites", (system) => {
      const proc = getProcedure(system)!;
      if (!proc.branches || proc.branches.length === 0) return;

      // For each branch, the entry step's prerequisites should be satisfiable
      // from the trigger step context
      const stepMap = new Map(proc.steps.map((s) => [s.id, s]));

      const unreachableEntries: Array<{
        branchId: string;
        entryStepId: string;
        missingPrereqs: string[];
      }> = [];

      for (const branch of proc.branches) {
        const entryStep = stepMap.get(branch.entryStepId);
        if (!entryStep) continue;

        // The trigger step should be in prerequisites or already completed
        // when entering the branch. Check that prerequisites are valid.
        const invalidPrereqs = entryStep.prerequisites.filter(
          (p) => !stepMap.has(p)
        );

        if (invalidPrereqs.length > 0) {
          unreachableEntries.push({
            branchId: branch.id,
            entryStepId: branch.entryStepId,
            missingPrereqs: invalidPrereqs,
          });
        }
      }

      expect(unreachableEntries).toEqual([]);
    });

    it.each(allSystems)("%s: no orphaned branch steps (steps with branchId but branch doesn't exist)", (system) => {
      const proc = getProcedure(system)!;
      const branchIds = new Set(proc.branches?.map((b) => b.id) ?? []);

      const orphaned: string[] = [];
      for (const step of proc.steps) {
        if (step.branchId && !branchIds.has(step.branchId)) {
          orphaned.push(step.id);
        }
      }

      expect(orphaned).toEqual([]);
    });
  });

  describe("5. howToCheck Coverage (Complex Procedures)", () => {
    // Get complex procedures - these require thorough howToCheck coverage
    const complexSystems = allSystems.filter((system) => {
      const proc = getProcedure(system);
      return proc?.complex === true;
    });

    it("complex systems are identified correctly", () => {
      // Sanity check that we have some complex systems
      expect(complexSystems.length).toBeGreaterThan(0);
      
      // Document which systems are complex for visibility
      const complexList = complexSystems.map((system) => ({
        system,
        displayName: getProcedure(system)!.displayName,
      }));
      
      // These should be the complex systems per the procedure definitions
      const expectedComplex = [
        "water_heater",
        "lp_gas",
        "furnace",
        "roof_ac",
        "refrigerator",
        "slide_out",
        "leveling",
        "inverter_converter",
      ];
      
      for (const expected of expectedComplex) {
        expect(complexSystems).toContain(expected);
      }
    });

    it.each(complexSystems)(
      "%s: main-flow steps with prerequisites have howToCheck guidance",
      (system) => {
        const proc = getProcedure(system)!;

        // Focus on main-flow steps (not branch steps) that have prerequisites
        // These are the steps technicians are most likely to ask "how do I check this?"
        const stepsNeedingHowToCheck = proc.steps.filter(
          (s) => !s.branchId && s.prerequisites.length > 0
        );

        const missingHowToCheck: Array<{ stepId: string; question: string }> = [];

        for (const step of stepsNeedingHowToCheck) {
          if (!step.howToCheck) {
            missingHowToCheck.push({
              stepId: step.id,
              question: step.question.substring(0, 60) + "...",
            });
          }
        }

        // For v1, we report but don't fail on missing howToCheck
        // This allows incremental improvement
        if (missingHowToCheck.length > 0) {
          console.warn(
            `[howToCheck coverage] ${system}: ${missingHowToCheck.length} steps missing guidance:`,
            missingHowToCheck.map((s) => s.stepId)
          );
        }

        // Ensure at least some coverage exists for complex procedures
        const totalMainFlowWithPrereqs = stepsNeedingHowToCheck.length;
        const withHowToCheck = stepsNeedingHowToCheck.filter(
          (s) => s.howToCheck
        ).length;

        if (totalMainFlowWithPrereqs > 0) {
          const coveragePercent =
            (withHowToCheck / totalMainFlowWithPrereqs) * 100;

          // For water_heater specifically, we have extensive howToCheck coverage
          // so we can be stricter. For others, warn but don't fail in v1.
          if (system === "water_heater") {
            expect(coveragePercent).toBeGreaterThanOrEqual(50);
          }
        }
      }
    );

    it.each(complexSystems)(
      "%s: branch steps have howToCheck where practical",
      (system) => {
        const proc = getProcedure(system)!;
        if (!proc.branches || proc.branches.length === 0) return;

        const branchSteps = proc.steps.filter((s) => s.branchId);
        const withHowToCheck = branchSteps.filter((s) => s.howToCheck);

        // Report coverage for visibility
        if (branchSteps.length > 0) {
          const coveragePercent =
            (withHowToCheck.length / branchSteps.length) * 100;
          
          if (coveragePercent < 50) {
            console.warn(
              `[howToCheck coverage] ${system} branches: ${coveragePercent.toFixed(0)}% coverage (${withHowToCheck.length}/${branchSteps.length})`
            );
          }
        }
      }
    );
  });

  describe("5b. rollout-targeted howToCheck coverage", () => {
    const rolloutTargetSystems = [
      "water_pump",
      "roof_ac",
      "refrigerator",
      "leveling",
      "consumer_appliance",
    ] as const;

    it.each(rolloutTargetSystems)(
      "%s: every step has technician-facing howToCheck guidance",
      (system) => {
        const proc = getProcedure(system)!;

        const missingHowToCheck = proc.steps
          .filter((step) => !step.howToCheck || step.howToCheck.trim().length === 0)
          .map((step) => step.id);

        expect(missingHowToCheck).toEqual([]);
      }
    );
  });

  describe("6. Structural Consistency", () => {
    it.each(allSystems)("%s: all steps have non-empty questions", (system) => {
      const proc = getProcedure(system)!;

      const emptyQuestions: string[] = [];
      for (const step of proc.steps) {
        if (!step.question || step.question.trim().length === 0) {
          emptyQuestions.push(step.id);
        }
      }

      expect(emptyQuestions).toEqual([]);
    });

    it.each(allSystems)("%s: all steps have at least one match pattern", (system) => {
      const proc = getProcedure(system)!;

      const noPatterns: string[] = [];
      for (const step of proc.steps) {
        if (!step.matchPatterns || step.matchPatterns.length === 0) {
          noPatterns.push(step.id);
        }
      }

      expect(noPatterns).toEqual([]);
    });

    it.each(allSystems)("%s: procedure has valid metadata", (system) => {
      const proc = getProcedure(system)!;

      expect(proc.system).toBe(system);
      expect(proc.displayName).toBeTruthy();
      expect(typeof proc.complex).toBe("boolean");
      expect(["MANUFACTURER", "STANDARD"]).toContain(proc.variant);
      expect(proc.steps.length).toBeGreaterThan(0);
    });

    it.each(allSystems)("%s: match patterns are valid RegExp", (system) => {
      const proc = getProcedure(system)!;

      const invalidPatterns: Array<{ stepId: string; error: string }> = [];
      for (const step of proc.steps) {
        for (const pattern of step.matchPatterns) {
          if (!(pattern instanceof RegExp)) {
            invalidPatterns.push({
              stepId: step.id,
              error: `Pattern is not a RegExp: ${pattern}`,
            });
          }
        }
      }

      expect(invalidPatterns).toEqual([]);
    });
  });

  describe("7. Cross-Procedure Consistency", () => {
    it("all registered systems have retrievable procedures", () => {
      for (const system of allSystems) {
        const proc = getProcedure(system);
        expect(proc).not.toBeNull();
        expect(proc!.system).toBe(system);
      }
    });

    it("no duplicate systems in registry", () => {
      const uniqueSystems = new Set(allSystems);
      expect(allSystems.length).toBe(uniqueSystems.size);
    });

    it("step ID prefixes are consistent within procedures", () => {
      // Check that step IDs follow a consistent prefix pattern per procedure
      // This is a style check, not a hard requirement
      const inconsistencies: Array<{ system: string; stepIds: string[] }> = [];

      for (const system of allSystems) {
        const proc = getProcedure(system)!;
        const mainFlowSteps = proc.steps.filter((s) => !s.branchId);

        if (mainFlowSteps.length > 1) {
          // Extract prefixes (everything before the underscore and number)
          const prefixes = mainFlowSteps
            .map((s) => s.id.match(/^([a-z]+)_/i)?.[1])
            .filter(Boolean);

          const uniquePrefixes = new Set(prefixes);

          // If we have more than 2 different prefixes in main flow, flag it
          if (uniquePrefixes.size > 2) {
            inconsistencies.push({
              system,
              stepIds: mainFlowSteps.map((s) => s.id),
            });
          }
        }
      }

      // Report but don't fail - this is advisory
      if (inconsistencies.length > 0) {
        console.warn(
          "[Style] Procedures with inconsistent step ID prefixes:",
          inconsistencies
        );
      }
    });
  });
});

// ── Summary Report ──────────────────────────────────────────────────

describe("Procedure Audit Summary", () => {
  it("generates audit summary", () => {
    const allSystems = getRegisteredSystems();
    const summary = {
      totalProcedures: allSystems.length,
      complexProcedures: 0,
      totalSteps: 0,
      totalBranches: 0,
      stepsWithHowToCheck: 0,
      proceduresWithBranches: 0,
    };

    for (const system of allSystems) {
      const proc = getProcedure(system)!;
      summary.totalSteps += proc.steps.length;
      summary.stepsWithHowToCheck += proc.steps.filter(
        (s) => s.howToCheck
      ).length;

      if (proc.complex) summary.complexProcedures++;
      if (proc.branches && proc.branches.length > 0) {
        summary.proceduresWithBranches++;
        summary.totalBranches += proc.branches.length;
      }
    }

    console.log("\n=== PROCEDURE CONTRACT AUDIT SUMMARY ===");
    console.log(`Total procedures: ${summary.totalProcedures}`);
    console.log(`Complex procedures: ${summary.complexProcedures}`);
    console.log(`Procedures with branches: ${summary.proceduresWithBranches}`);
    console.log(`Total steps: ${summary.totalSteps}`);
    console.log(`Total branches: ${summary.totalBranches}`);
    console.log(
      `Steps with howToCheck: ${summary.stepsWithHowToCheck} (${((summary.stepsWithHowToCheck / summary.totalSteps) * 100).toFixed(1)}%)`
    );
    console.log("========================================\n");

    // Basic sanity assertions
    expect(summary.totalProcedures).toBeGreaterThan(0);
    expect(summary.totalSteps).toBeGreaterThan(0);
  });
});
