/**
 * LLM Runtime Signals — step-issue signal adjudication tests.
 *
 * Covers manual acceptance anchor E: front jack repeated current-measurement loop.
 * A grounded 'repeated_step' / 'already_answered' signal is accepted only when
 * server state corroborates (prior ask count ≥ 2, OR user message clearly
 * references a prior measurement / 'cannot measure').
 */

import { describe, it, expect } from "vitest";
import {
  adjudicateStepIssue,
  REJECT,
} from "@/lib/chat/llm-runtime-signal-policy";

describe("LLM Runtime Signals — step-issue adjudication", () => {
  it("accepts 'already_answered' when user provided a numeric measurement value", () => {
    const verdict = adjudicateStepIssue({
      proposal: {
        step_issue_signal: {
          issue: "already_answered",
          confidence: 0.85,
          evidence: ["cannot measure", "0 amp", "2.3 amp"],
        },
      },
      latestUserMessage: "i told you already, 0 amp and 2.3 amp",
      technicianMessages: [
        "front jack lippert 3500-lb tongue jack",
        "silence when switch pressed",
        "fuse okay",
        "voltage present at the switch",
        "cannot measure current properly",
        "measured 0 amp in one position, 2.3 amp in another",
      ],
      serverState: {
        caseMode: "diagnostic",
        isolationComplete: false,
        terminalPhase: "normal",
        activeStepId: "step_6",
        priorAskCountForActiveStep: 1,
        hasActiveProcedure: true,
      },
    });
    expect(verdict.accepted).toBe(true);
    expect(verdict.issue).toBe("already_answered");
  });

  it("accepts 'repeated_step' when server state shows prior ask count ≥ 2", () => {
    const verdict = adjudicateStepIssue({
      proposal: {
        step_issue_signal: {
          issue: "repeated_step",
          confidence: 0.8,
        },
      },
      latestUserMessage: "what is the current draw?",
      technicianMessages: ["front jack not moving"],
      serverState: {
        caseMode: "diagnostic",
        isolationComplete: false,
        terminalPhase: "normal",
        activeStepId: "step_6",
        priorAskCountForActiveStep: 3,
        hasActiveProcedure: true,
      },
    });
    expect(verdict.accepted).toBe(true);
  });

  it("rejects 'repeated_step' when server state does not corroborate and user did not reference a prior answer", () => {
    const verdict = adjudicateStepIssue({
      proposal: {
        step_issue_signal: {
          issue: "repeated_step",
          confidence: 0.9,
        },
      },
      latestUserMessage: "ok i will check",
      technicianMessages: ["jack does not move"],
      serverState: {
        caseMode: "diagnostic",
        isolationComplete: false,
        terminalPhase: "normal",
        activeStepId: "step_6",
        priorAskCountForActiveStep: 1,
        hasActiveProcedure: true,
      },
    });
    expect(verdict.accepted).toBe(false);
    expect(verdict.accepted ? "" : verdict.reason).toBe(REJECT.CONTRADICTS_SERVER_STATE);
  });

  it("rejects step issue when no active step or not in diagnostic mode", () => {
    const verdict = adjudicateStepIssue({
      proposal: {
        step_issue_signal: { issue: "irrelevant_step", confidence: 0.9 },
      },
      latestUserMessage: "something",
      technicianMessages: ["something"],
      serverState: {
        caseMode: "final_report",
        isolationComplete: true,
        terminalPhase: "terminal",
        activeStepId: null,
        hasActiveProcedure: false,
      },
    });
    expect(verdict.accepted).toBe(false);
  });

  it("rejects when evidence references a fact not in the transcript", () => {
    const verdict = adjudicateStepIssue({
      proposal: {
        step_issue_signal: {
          issue: "already_answered",
          confidence: 0.9,
          evidence: ["converter/inverter replaced"], // not in transcript
        },
      },
      latestUserMessage: "i already told you 2.3 amp",
      technicianMessages: ["jack not moving", "2.3 amp measured"],
      serverState: {
        caseMode: "diagnostic",
        isolationComplete: false,
        terminalPhase: "normal",
        activeStepId: "step_6",
        priorAskCountForActiveStep: 2,
        hasActiveProcedure: true,
      },
    });
    expect(verdict.accepted).toBe(false);
    expect(verdict.accepted ? "" : verdict.reason).toBe(REJECT.UNGROUNDED_IN_TRANSCRIPT);
  });
});
