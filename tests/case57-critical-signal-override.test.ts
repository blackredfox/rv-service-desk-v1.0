/**
 * Case-57 Acceptance Regression Tests
 *
 * Delta-fix PR: Critical Signal Override + Non-Combo Gating
 *
 * Proves the four critical runtime behaviors required by this PR:
 *
 *  1. `no_12v_at_wh_6a_triggers_signal_override_branch`
 *     — "нет 12 В" at wh_6a overrides the active no_ignition branch and
 *       enters no_12v_supply, pivoting the next step to wh_5a.
 *
 *  2. `critical_signal_is_not_ignored_by_linear_checklist`
 *     — Once overridden, the system does not fall back to the generic
 *       downstream wh_6b/wh_6c spark-gap/ground checklist.
 *
 *  3. `recognized_non_combo_blocks_wh_11`
 *     — Once "combo" subtype is excluded, wh_11 is filtered out of
 *       getNextStepBranchAware, regardless of branch state.
 *
 *  4. `explicit_non_combo_does_not_repeat_wh_11`
 *     — When the technician says "это не COMBO" while wh_11 is the active
 *       step, the context engine force-skips wh_11 immediately rather
 *       than leaving it as the next question.
 *
 * Transcript anchor (Case-57 fragments):
 *   Technician at wh_6a: "нет 12 В на модуле во время попытки розжига"
 *   Technician later:    "это не COMBO"
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  initializeCase,
  clearRegistry,
  markStepCompleted,
  getNextStepId,
  getBranchState,
  processResponseForBranch,
  getRegistryEntry,
} from "@/lib/diagnostic-registry";
import {
  processMessage as processContextMessage,
  clearContext,
  getOrCreateContext,
  DEFAULT_CONFIG,
} from "@/lib/context-engine";
import {
  getProcedure,
  detectBranchTrigger,
} from "@/lib/diagnostic-procedures";

// ── 1. no_12v_at_wh_6a_triggers_signal_override_branch ──────────────

describe("Case-57 / 1. Critical signal override at wh_6a", () => {
  const caseId = "case57-critical-override";

  beforeEach(() => {
    clearRegistry(caseId);
    clearContext(caseId);
  });

  it("no_12v_supply branch declares itself critical and accepts wh_6a as a trigger step", () => {
    const proc = getProcedure("water_heater");
    expect(proc).toBeDefined();
    const branch = proc!.branches!.find((b) => b.id === "no_12v_supply");
    expect(branch).toBeDefined();
    expect(branch!.critical).toBe(true);
    expect(branch!.additionalTriggerStepIds).toContain("wh_6a");
    expect(branch!.additionalTriggerStepIds).toContain("wh_8a");
  });

  it("detectBranchTrigger at wh_6a with 'нет' matches no_12v_supply", () => {
    const proc = getProcedure("water_heater")!;
    const branch = detectBranchTrigger(proc, "wh_6a", "нет");
    expect(branch?.id).toBe("no_12v_supply");
  });

  it("detectBranchTrigger at wh_8a with 'no 12V' matches no_12v_supply", () => {
    const proc = getProcedure("water_heater")!;
    const branch = detectBranchTrigger(proc, "wh_8a", "no 12V at the solenoid");
    expect(branch?.id).toBe("no_12v_supply");
  });

  it("processResponseForBranch at wh_6a while inside no_ignition overrides into no_12v_supply", () => {
    initializeCase(caseId, "water heater not working");

    // Simulate having entered no_ignition at wh_6
    markStepCompleted(caseId, "wh_1", "gas, Suburban");
    markStepCompleted(caseId, "wh_2", "full");
    markStepCompleted(caseId, "wh_3", "yes others work");
    markStepCompleted(caseId, "wh_4", "open");
    markStepCompleted(caseId, "wh_5", "да, 12.6 В");
    // Enter no_ignition from wh_6
    const noIgnition = processResponseForBranch(caseId, "wh_6", "нет щелчков");
    expect(noIgnition.branchEntered?.id).toBe("no_ignition");
    markStepCompleted(caseId, "wh_6", "нет щелчков");

    const beforeOverride = getBranchState(caseId);
    expect(beforeOverride.activeBranchId).toBe("no_ignition");

    // Now the critical signal "no 12V" at wh_6a fires
    const override = processResponseForBranch(caseId, "wh_6a", "нет 12 В");
    expect(override.branchEntered?.id).toBe("no_12v_supply");

    const afterOverride = getBranchState(caseId);
    expect(afterOverride.activeBranchId).toBe("no_12v_supply");
  });

  it("full context-engine turn: 'нет' at wh_6a pivots activeStepId to wh_5a", () => {
    initializeCase(caseId, "water heater not working");
    getOrCreateContext(caseId, "water_heater");

    processContextMessage(caseId, "gas unit, Suburban", DEFAULT_CONFIG);
    processContextMessage(caseId, "tank full", DEFAULT_CONFIG);
    processContextMessage(caseId, "yes stove works", DEFAULT_CONFIG);
    processContextMessage(caseId, "valve open", DEFAULT_CONFIG);
    processContextMessage(caseId, "да, 12.6 В", DEFAULT_CONFIG);

    // wh_6 — "нет" enters no_ignition
    processContextMessage(caseId, "нет щелчков", DEFAULT_CONFIG);
    let ctx = getOrCreateContext(caseId);
    expect(ctx.activeStepId).toBe("wh_6a");
    expect(getBranchState(caseId).activeBranchId).toBe("no_ignition");

    // wh_6a — "нет" is the critical signal: override to no_12v_supply
    processContextMessage(
      caseId,
      "нет 12 В на модуле поджига во время попытки розжига",
      DEFAULT_CONFIG,
    );
    ctx = getOrCreateContext(caseId);
    expect(getBranchState(caseId).activeBranchId).toBe("no_12v_supply");
    expect(ctx.activeStepId).toBe("wh_5a");
  });
});

// ── 2. critical_signal_is_not_ignored_by_linear_checklist ───────────

describe("Case-57 / 2. Critical signal not ignored by linear checklist", () => {
  const caseId = "case57-no-linear-fallthrough";

  beforeEach(() => {
    clearRegistry(caseId);
    clearContext(caseId);
  });

  it("after critical override at wh_6a, wh_6b and wh_6c are not the next steps", () => {
    initializeCase(caseId, "water heater not working");
    getOrCreateContext(caseId, "water_heater");

    processContextMessage(caseId, "gas unit, Suburban", DEFAULT_CONFIG);
    processContextMessage(caseId, "tank full", DEFAULT_CONFIG);
    processContextMessage(caseId, "yes stove works", DEFAULT_CONFIG);
    processContextMessage(caseId, "valve open", DEFAULT_CONFIG);
    processContextMessage(caseId, "да, 12.6 В", DEFAULT_CONFIG);
    processContextMessage(caseId, "нет щелчков", DEFAULT_CONFIG);
    processContextMessage(caseId, "нет 12 В на модуле поджига", DEFAULT_CONFIG);

    const next = getNextStepId(caseId);
    expect(next).toBe("wh_5a");
    expect(next).not.toBe("wh_6b");
    expect(next).not.toBe("wh_6c");
  });
});

// ── 3. recognized_non_combo_blocks_wh_11 ────────────────────────────

describe("Case-57 / 3. Non-combo blocks wh_11 after subtype assertion", () => {
  const caseId = "case57-wh11-blocked";

  beforeEach(() => {
    clearRegistry(caseId);
    clearContext(caseId);
  });

  it("explicit 'это не COMBO' at any turn blocks wh_11 going forward", () => {
    initializeCase(caseId, "water heater not working");
    getOrCreateContext(caseId, "water_heater");

    // Normal initial progression
    processContextMessage(caseId, "Suburban model", DEFAULT_CONFIG);
    // Technician asserts non-combo anywhere in the transcript
    processContextMessage(caseId, "это не COMBO", DEFAULT_CONFIG);

    const entry = getRegistryEntry(caseId);
    expect(entry?.subtypeExclusions.has("combo")).toBe(true);

    // Walk remaining steps — wh_11 must be filtered out
    let next = getNextStepId(caseId);
    const served: string[] = [];
    let guard = 0;
    while (next && guard < 50) {
      served.push(next);
      markStepCompleted(caseId, next, "checked, ok");
      next = getNextStepId(caseId);
      guard++;
    }

    expect(served).not.toContain("wh_11");
  });
});

// ── 4. explicit_non_combo_does_not_repeat_wh_11 ─────────────────────

describe("Case-57 / 4. Explicit non-combo does not re-ask wh_11", () => {
  const caseId = "case57-wh11-no-reask";

  beforeEach(() => {
    clearRegistry(caseId);
    clearContext(caseId);
  });

  it("when wh_11 is the active step and tech says 'это не COMBO', wh_11 is force-skipped and next step is not wh_11", () => {
    initializeCase(caseId, "water heater not working");
    const ctx = getOrCreateContext(caseId, "water_heater");

    // Simulate that wh_11 is already the active step (as Case-57 observed)
    ctx.activeStepId = "wh_11";

    // Technician explicitly corrects the subtype
    const result = processContextMessage(caseId, "это не COMBO", DEFAULT_CONFIG);

    // wh_11 is force-skipped (moved into unableSteps via subtype gate)
    expect(result.context.unableSteps.has("wh_11")).toBe(true);
    // The next active step is NOT wh_11
    expect(result.context.activeStepId).not.toBe("wh_11");

    // And the registry will never serve wh_11 again
    expect(getNextStepId(caseId)).not.toBe("wh_11");
  });

  it("subsequent turns never re-ask wh_11", () => {
    initializeCase(caseId, "water heater not working");
    const ctx = getOrCreateContext(caseId, "water_heater");
    ctx.activeStepId = "wh_11";

    processContextMessage(caseId, "это не COMBO", DEFAULT_CONFIG);

    // Multiple subsequent turns — wh_11 still blocked
    for (let i = 0; i < 5; i++) {
      const next = getNextStepId(caseId);
      expect(next).not.toBe("wh_11");
      if (next) {
        markStepCompleted(caseId, next, "ok");
      } else {
        break;
      }
    }
  });
});

// ── 5. No unrelated regression in the existing water-heater path ────

describe("Case-57 / 5. No regression in normal water-heater path", () => {
  const caseId = "case57-no-regression";

  beforeEach(() => {
    clearRegistry(caseId);
    clearContext(caseId);
  });

  it("positive 12V at wh_5 still proceeds to wh_6 (no spurious override)", () => {
    initializeCase(caseId, "water heater not working");
    getOrCreateContext(caseId, "water_heater");

    processContextMessage(caseId, "gas unit, Suburban", DEFAULT_CONFIG);
    processContextMessage(caseId, "tank full", DEFAULT_CONFIG);
    processContextMessage(caseId, "yes stove works", DEFAULT_CONFIG);
    processContextMessage(caseId, "valve open", DEFAULT_CONFIG);
    processContextMessage(caseId, "да, 12.6 В", DEFAULT_CONFIG);

    const ctx = getOrCreateContext(caseId);
    expect(ctx.activeStepId).toBe("wh_6");
    expect(getBranchState(caseId).activeBranchId).toBeNull();
  });

  it("combo unit still allows wh_11 to be served (no spurious exclusion)", () => {
    initializeCase(caseId, "water heater not working");
    markStepCompleted(caseId, "wh_1", "combo gas and electric");

    const entry = getRegistryEntry(caseId);
    expect(entry?.subtypeExclusions.has("combo")).toBe(false);

    // Walk steps — wh_11 eventually served
    let next = getNextStepId(caseId);
    const served: string[] = [];
    let guard = 0;
    while (next && guard < 50) {
      served.push(next);
      markStepCompleted(caseId, next, "checked, ok");
      next = getNextStepId(caseId);
      guard++;
    }

    expect(served).toContain("wh_11");
  });

  it("from main flow, the critical branch still enters normally at its primary trigger step", () => {
    initializeCase(caseId, "water heater not working");
    markStepCompleted(caseId, "wh_1", "gas");
    markStepCompleted(caseId, "wh_2", "full");
    markStepCompleted(caseId, "wh_3", "yes");
    markStepCompleted(caseId, "wh_4", "open");

    // Main-flow no-12V at wh_5 → normal entry to no_12v_supply
    const r = processResponseForBranch(caseId, "wh_5", "нет");
    expect(r.branchEntered?.id).toBe("no_12v_supply");
    expect(getBranchState(caseId).activeBranchId).toBe("no_12v_supply");
  });

  it("non-critical branch trigger from within another branch is still blocked (no regression)", () => {
    initializeCase(caseId, "water heater not working");
    markStepCompleted(caseId, "wh_1", "gas");
    markStepCompleted(caseId, "wh_2", "full");
    markStepCompleted(caseId, "wh_3", "yes");
    markStepCompleted(caseId, "wh_4", "open");
    markStepCompleted(caseId, "wh_5", "12.6 В");
    // Enter no_ignition at wh_6
    processResponseForBranch(caseId, "wh_6", "нет щелчков");
    markStepCompleted(caseId, "wh_6", "нет щелчков");
    expect(getBranchState(caseId).activeBranchId).toBe("no_ignition");

    // A non-critical trigger (e.g. flame_failure pattern) from within no_ignition
    // must NOT override — only critical branches can override.
    const r = processResponseForBranch(caseId, "wh_7", "пламя гаснет");
    expect(r.branchEntered).toBeNull();
    expect(getBranchState(caseId).activeBranchId).toBe("no_ignition");
  });
});
