/**
 * LLM Runtime Signals — subtype lock adjudication tests.
 *
 * Covers manual acceptance anchor D: water heater non-combo.
 * Accepted subtype lock enables the server to exclude COMBO-only steps
 * (advisory — this PR only tests acceptance; broader Context Engine
 * integration is a separate follow-up).
 */

import { describe, it, expect } from "vitest";
import {
  adjudicateSubtypeLock,
  mayEnforceSubtypeLock,
  adjudicateProposal,
  REJECT,
  type AdjudicationServerState,
} from "@/lib/chat/llm-runtime-signal-policy";

const STATE: AdjudicationServerState = {
  caseMode: "diagnostic",
  isolationComplete: false,
  terminalPhase: "normal",
  activeStepId: "step_1",
  hasActiveProcedure: true,
};

describe("LLM Runtime Signals — subtype lock adjudication", () => {
  it("accepts a grounded non-combo lock when transcript says 'gas-only'", () => {
    const technicianMessages = [
      "suburban water heater issue",
      "this model is gas-only, not combo",
      "mechanical ignition",
    ];
    const verdict = adjudicateSubtypeLock({
      proposal: {
        subtype_lock_proposal: {
          subtype: "non-combo",
          confidence: 0.9,
          evidence: ["gas-only"],
        },
      },
      latestUserMessage: "this model is gas-only, not combo",
      technicianMessages,
      serverState: STATE,
    });
    expect(verdict.accepted).toBe(true);
    expect(verdict.subtype).toBe("non-combo");
  });

  it("accepts 'gas-only' subtype lock grounded via synonym 'gas only'", () => {
    const technicianMessages = [
      "suburban unit",
      "it is gas only",
    ];
    const verdict = adjudicateSubtypeLock({
      proposal: {
        subtype_lock_proposal: {
          subtype: "gas-only",
          confidence: 0.9,
        },
      },
      latestUserMessage: "it is gas only",
      technicianMessages,
      serverState: STATE,
    });
    expect(verdict.accepted).toBe(true);
  });

  it("rejects an ungrounded 'combo' lock when transcript only mentions gas-only", () => {
    const technicianMessages = ["suburban gas-only water heater"];
    const verdict = adjudicateSubtypeLock({
      proposal: {
        subtype_lock_proposal: { subtype: "combo", confidence: 0.99 },
      },
      latestUserMessage: "suburban gas-only water heater",
      technicianMessages,
      serverState: STATE,
    });
    expect(verdict.accepted).toBe(false);
    expect(verdict.accepted ? "" : verdict.reason).toBe(REJECT.UNGROUNDED_IN_TRANSCRIPT);
  });

  it("rejects low-confidence subtype lock", () => {
    const verdict = adjudicateSubtypeLock({
      proposal: {
        subtype_lock_proposal: { subtype: "gas-only", confidence: 0.2 },
      },
      latestUserMessage: "gas-only",
      technicianMessages: ["gas-only"],
      serverState: STATE,
    });
    expect(verdict.accepted).toBe(false);
    expect(verdict.accepted ? "" : verdict.reason).toBe(REJECT.LOW_CONFIDENCE);
  });

  it("rejects subtype lock when an evidence item is ungrounded", () => {
    const verdict = adjudicateSubtypeLock({
      proposal: {
        subtype_lock_proposal: {
          subtype: "gas-only",
          confidence: 0.9,
          evidence: ["electric heating element was replaced"], // invented
        },
      },
      latestUserMessage: "gas only",
      technicianMessages: ["it is gas only"],
      serverState: STATE,
    });
    expect(verdict.accepted).toBe(false);
    expect(verdict.accepted ? "" : verdict.reason).toBe(REJECT.UNGROUNDED_IN_TRANSCRIPT);
  });

  it("mayEnforceSubtypeLock returns allowed=true only for accepted locks", () => {
    const acceptedSignals = adjudicateProposal({
      proposal: {
        subtype_lock_proposal: { subtype: "gas-only", confidence: 0.9 },
      },
      latestUserMessage: "gas-only",
      technicianMessages: ["gas-only"],
      serverState: STATE,
    });
    expect(mayEnforceSubtypeLock(acceptedSignals).allowed).toBe(true);

    const rejectedSignals = adjudicateProposal({
      proposal: {
        subtype_lock_proposal: { subtype: "combo", confidence: 0.9 },
      },
      latestUserMessage: "gas-only",
      technicianMessages: ["gas-only"],
      serverState: STATE,
    });
    expect(mayEnforceSubtypeLock(rejectedSignals).allowed).toBe(false);
  });
});
