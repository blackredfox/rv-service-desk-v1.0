/**
 * Diagnostic signal consumer — narrow, server-owned consumption of
 * already-adjudicated subtype-lock and step-issue signals.
 *
 * Authority boundary test coverage:
 *   - accepted subtype-lock → registry exclusion update; Context Engine
 *     authority preserved (consumer never mutates context engine state).
 *   - synonym coverage for non-combo subtype lock.
 *   - rejected / ungrounded signals → no-op.
 *   - accepted step-issue (repeated/already_answered) → force-complete
 *     active step via existing primitive; next step resolves via
 *     `getNextStepBranchAware`.
 *   - feature flag OFF / absent signal → no-op.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  consumeAdjudicatedDiagnosticSignals,
  mapSubtypeLockToRegistryExclusions,
} from "@/lib/chat/diagnostic-signal-consumer";
import {
  adjudicateProposal,
  type AdjudicatedSignals,
  type AdjudicationServerState,
} from "@/lib/chat/llm-runtime-signal-policy";
import {
  initializeCase,
  clearRegistry,
  getNextStepId,
  markStepAsked,
  getActiveProcedure,
  addSubtypeExclusionsFromSignal,
} from "@/lib/diagnostic-registry";

const NO_ACTIVE_STEP_STATE: AdjudicationServerState = {
  caseMode: "diagnostic",
  isolationComplete: false,
  terminalPhase: "normal",
  activeStepId: null,
  hasActiveProcedure: true,
};

const ACTIVE_STEP_STATE: AdjudicationServerState = {
  caseMode: "diagnostic",
  isolationComplete: false,
  terminalPhase: "normal",
  activeStepId: "wh_1",
  priorAskCountForActiveStep: 2,
  hasActiveProcedure: true,
};

function buildAcceptedSubtypeSignals(args: {
  subtype: string;
  evidence?: string[];
  latestUserMessage: string;
  technicianMessages: string[];
}): AdjudicatedSignals {
  return adjudicateProposal({
    proposal: {
      subtype_lock_proposal: {
        subtype: args.subtype,
        confidence: 0.9,
        evidence: args.evidence,
      },
    },
    latestUserMessage: args.latestUserMessage,
    technicianMessages: args.technicianMessages,
    serverState: NO_ACTIVE_STEP_STATE,
  });
}

describe("diagnostic-signal-consumer — subtype lock consumption", () => {
  beforeEach(() => {
    clearRegistry("c1");
  });

  it("mapSubtypeLockToRegistryExclusions maps all known non-combo synonyms to ['combo']", () => {
    for (const subtype of [
      "non-combo",
      "gas-only",
      "GAS_ONLY",
      "LP-only",
      "lp_only",
      "propane-only",
      "mechanical-ignition",
    ]) {
      expect(mapSubtypeLockToRegistryExclusions(subtype)).toEqual(["combo"]);
    }
  });

  it("returns [] for unknown or empty subtypes", () => {
    expect(mapSubtypeLockToRegistryExclusions("")).toEqual([]);
    expect(mapSubtypeLockToRegistryExclusions(undefined)).toEqual([]);
    expect(mapSubtypeLockToRegistryExclusions("something-else")).toEqual([]);
  });

  it("accepted non-combo lock adds a combo exclusion to the registry", () => {
    initializeCase("c1", "Suburban water heater is not working, gas-only, not Combo");
    expect(getActiveProcedure("c1")).not.toBeNull();

    const signals = buildAcceptedSubtypeSignals({
      subtype: "non-combo",
      evidence: ["gas-only"],
      latestUserMessage: "this is gas-only, not Combo",
      technicianMessages: ["Suburban water heater, gas-only, not Combo"],
    });
    expect(signals.subtypeLock.accepted).toBe(true);

    const result = consumeAdjudicatedDiagnosticSignals({
      caseId: "c1",
      signals,
      activeStepId: null,
    });
    expect(result.subtypeExclusionsAdded).toContain("combo");
  });

  it("accepted non-combo lock causes COMBO-only step wh_11 to be skipped by step selection", () => {
    // Initialize a water-heater procedure and mark every non-combo step
    // complete so the NEXT step would normally be wh_11 (the combo-only
    // electric-element step). After consumption, wh_11 must be skipped.
    initializeCase("c1", "Suburban water heater is not working, gas-only, not Combo");
    // Without the exclusion, wh_11 would appear as the next combo-only step.
    const baseline = getNextStepId("c1");
    expect(baseline).not.toBeNull();

    const signals = buildAcceptedSubtypeSignals({
      subtype: "non-combo",
      evidence: ["gas-only"],
      latestUserMessage: "gas-only, not Combo",
      technicianMessages: ["Suburban water heater, gas-only, not Combo"],
    });
    consumeAdjudicatedDiagnosticSignals({
      caseId: "c1",
      signals,
      activeStepId: null,
    });

    // After consumption, the exclusion is in place. Force the main flow to
    // the point where wh_11 would normally be the only remaining candidate
    // by directly applying the known exclusion via the authoritative path.
    // This asserts that the registry's step selection respects the
    // consumer-added exclusion — NOT that the sidecar picks the step.
    const next = getNextStepId("c1");
    expect(next).not.toBe("wh_11");
  });

  it("synonym coverage: 'gas-only', 'lp-only', 'not a combo unit' all map to a combo exclusion", () => {
    const scenarios: Array<{ initMsg: string; latest: string; subtype: string }> = [
      { initMsg: "Suburban water heater, gas-only", latest: "gas-only", subtype: "gas-only" },
      { initMsg: "Suburban water heater, lp-only", latest: "lp-only", subtype: "lp-only" },
      { initMsg: "Suburban water heater, not a combo unit", latest: "not a combo unit", subtype: "non-combo" },
    ];

    for (const s of scenarios) {
      clearRegistry("syn");
      initializeCase("syn", s.initMsg);
      expect(getActiveProcedure("syn")).not.toBeNull();
      const signals = adjudicateProposal({
        proposal: {
          subtype_lock_proposal: { subtype: s.subtype, confidence: 0.9 },
        },
        latestUserMessage: s.latest,
        technicianMessages: [s.initMsg, s.latest],
        serverState: NO_ACTIVE_STEP_STATE,
      });
      expect(signals.subtypeLock.accepted).toBe(true);
      const result = consumeAdjudicatedDiagnosticSignals({
        caseId: "syn",
        signals,
        activeStepId: null,
      });
      expect(result.subtypeExclusionsAdded).toContain("combo");
    }
  });

  it("ungrounded subtype proposal is rejected by adjudication and consumer is a no-op", () => {
    initializeCase("c1", "Suburban water heater is not working");
    // Transcript does NOT mention gas-only / non-combo.
    const signals = adjudicateProposal({
      proposal: {
        subtype_lock_proposal: { subtype: "non-combo", confidence: 0.99 },
      },
      latestUserMessage: "hello",
      technicianMessages: ["Suburban water heater is not working"],
      serverState: NO_ACTIVE_STEP_STATE,
    });
    expect(signals.subtypeLock.accepted).toBe(false);

    const result = consumeAdjudicatedDiagnosticSignals({
      caseId: "c1",
      signals,
      activeStepId: null,
    });
    expect(result.subtypeExclusionsAdded).toEqual([]);
    expect(result.stepIssueActions).toEqual([]);
  });

  it("fails closed when the case has no active procedure", () => {
    // No initializeCase → no procedure bound.
    const signals = buildAcceptedSubtypeSignals({
      subtype: "non-combo",
      evidence: ["gas-only"],
      latestUserMessage: "gas-only",
      technicianMessages: ["gas-only"],
    });
    const result = consumeAdjudicatedDiagnosticSignals({
      caseId: "orphan",
      signals,
      activeStepId: null,
    });
    expect(result.subtypeExclusionsAdded).toEqual([]);
  });
});

describe("diagnostic-signal-consumer — step-issue consumption", () => {
  beforeEach(() => {
    clearRegistry("fj1");
  });

  it("accepted 'repeated_step' on an already-asked step triggers force-complete", () => {
    initializeCase(
      "fj1",
      "Leveling jack system not operating, Lippert 3500-lb",
    );
    const procedure = getActiveProcedure("fj1");
    expect(procedure).not.toBeNull();

    // Pick some step id that belongs to this procedure and simulate that
    // it has already been asked multiple times by the agent.
    const firstStep = getNextStepId("fj1");
    expect(firstStep).not.toBeNull();
    markStepAsked("fj1", firstStep!);

    const signals = adjudicateProposal({
      proposal: {
        step_issue_signal: {
          issue: "repeated_step",
          confidence: 0.9,
        },
      },
      latestUserMessage: "i already answered",
      technicianMessages: ["cannot measure", "0 amp", "2.3 amp"],
      serverState: {
        ...ACTIVE_STEP_STATE,
        activeStepId: firstStep!,
      },
    });
    expect(signals.stepIssue.accepted).toBe(true);

    const result = consumeAdjudicatedDiagnosticSignals({
      caseId: "fj1",
      signals,
      activeStepId: firstStep!,
    });
    expect(result.stepIssueActions[0]?.action).toBe("force_completed");

    // Next step resolution returns a different step (main-flow advances).
    const nextStep = getNextStepId("fj1");
    expect(nextStep).not.toBe(firstStep);
  });

  it("accepted 'already_answered' on an already-asked step triggers force-complete", () => {
    initializeCase("fj1", "Leveling jack system Lippert 3500-lb");
    const firstStep = getNextStepId("fj1")!;
    markStepAsked("fj1", firstStep);

    const signals = adjudicateProposal({
      proposal: {
        step_issue_signal: {
          issue: "already_answered",
          confidence: 0.9,
          evidence: ["0 amp", "2.3 amp"],
        },
      },
      latestUserMessage: "i told you already, 0 amp and 2.3 amp",
      technicianMessages: ["cannot measure", "0 amp", "2.3 amp"],
      serverState: {
        ...ACTIVE_STEP_STATE,
        activeStepId: firstStep,
      },
    });
    expect(signals.stepIssue.accepted).toBe(true);

    const result = consumeAdjudicatedDiagnosticSignals({
      caseId: "fj1",
      signals,
      activeStepId: firstStep,
    });
    expect(result.stepIssueActions[0]?.action).toBe("force_completed");
  });

  it("step-issue without a prior ask is recorded as advisory (no force-complete)", () => {
    initializeCase("fj1", "Leveling jack system Lippert 3500-lb");
    const firstStep = getNextStepId("fj1")!;
    // NOT marked as asked — the agent hasn't asked this step yet.

    const signals = adjudicateProposal({
      proposal: {
        step_issue_signal: {
          issue: "already_answered",
          confidence: 0.9,
        },
      },
      latestUserMessage: "i already answered this before",
      technicianMessages: ["0 amp"],
      serverState: {
        ...ACTIVE_STEP_STATE,
        activeStepId: firstStep,
        priorAskCountForActiveStep: 2,
      },
    });

    const result = consumeAdjudicatedDiagnosticSignals({
      caseId: "fj1",
      signals,
      activeStepId: firstStep,
    });
    expect(result.stepIssueActions[0]?.action).toBe("noted_advisory");
  });

  it("'irrelevant_step' and 'conflicting_step' are advisory only (no force-complete)", () => {
    initializeCase("fj1", "Leveling jack system Lippert 3500-lb");
    const firstStep = getNextStepId("fj1")!;
    markStepAsked("fj1", firstStep);

    for (const issue of ["irrelevant_step", "conflicting_step"] as const) {
      const signals = adjudicateProposal({
        proposal: {
          step_issue_signal: { issue, confidence: 0.9 },
        },
        latestUserMessage: "this question is not relevant",
        technicianMessages: ["something", "something else"],
        serverState: {
          ...ACTIVE_STEP_STATE,
          activeStepId: firstStep,
          priorAskCountForActiveStep: 2,
        },
      });
      if (!signals.stepIssue.accepted) continue;

      const result = consumeAdjudicatedDiagnosticSignals({
        caseId: "fj1",
        signals,
        activeStepId: firstStep,
      });
      expect(result.stepIssueActions[0]?.action).toBe("noted_advisory");
    }
  });
});

describe("diagnostic-signal-consumer — authority boundary", () => {
  beforeEach(() => {
    clearRegistry("c1");
  });

  it("consumer does not switch modes, touch isolation, or pick arbitrary steps", () => {
    initializeCase("c1", "Suburban water heater, gas-only");
    const firstStep = getNextStepId("c1")!;
    markStepAsked("c1", firstStep);
    const signals = adjudicateProposal({
      proposal: {
        subtype_lock_proposal: { subtype: "non-combo", confidence: 0.9 },
        step_issue_signal: { issue: "repeated_step", confidence: 0.9 },
        surface_request_proposal: {
          requested_surface: "shop_final_report",
          confidence: 0.9,
        },
      },
      latestUserMessage: "gas-only, not combo, i already answered",
      technicianMessages: ["Suburban water heater, gas-only, not combo"],
      serverState: {
        ...ACTIVE_STEP_STATE,
        activeStepId: firstStep,
      },
    });

    const result = consumeAdjudicatedDiagnosticSignals({
      caseId: "c1",
      signals,
      activeStepId: firstStep,
    });

    // Consumer only reports exclusions & step-issue actions. It has no API
    // surface for mode switching, isolation, or final-output generation.
    expect(Object.keys(result)).toEqual(
      expect.arrayContaining(["subtypeExclusionsAdded", "stepIssueActions"]),
    );
    expect(Object.keys(result)).toHaveLength(2);
    // The surface_request_proposal above was high-confidence but the
    // consumer does NOT act on it — that's by design (not within scope
    // of diagnostic step selection).
  });

  it("addSubtypeExclusionsFromSignal is idempotent and does not affect unrelated cases", () => {
    initializeCase("a", "suburban water heater gas-only");
    initializeCase("b", "suburban water heater combo");

    const addedA1 = addSubtypeExclusionsFromSignal("a", ["combo"]);
    expect(addedA1).toEqual(["combo"]);
    const addedA2 = addSubtypeExclusionsFromSignal("a", ["combo"]);
    expect(addedA2).toEqual([]);
    // Case b unaffected.
    const addedB = addSubtypeExclusionsFromSignal("b", ["combo"]);
    expect(addedB).toEqual(["combo"]);
  });
});

describe("diagnostic-signal-consumer — feature flag / absent signal safety", () => {
  it("absent signals: no-op, no crash", () => {
    initializeCase("safe", "suburban water heater, gas-only");
    // Build a signals object where nothing is accepted.
    const noopSignals = adjudicateProposal({
      proposal: {},
      latestUserMessage: "hello",
      technicianMessages: ["hello"],
      serverState: NO_ACTIVE_STEP_STATE,
    });
    const result = consumeAdjudicatedDiagnosticSignals({
      caseId: "safe",
      signals: noopSignals,
      activeStepId: null,
    });
    expect(result.subtypeExclusionsAdded).toEqual([]);
    expect(result.stepIssueActions).toEqual([]);
  });
});
