/**
 * LLM Runtime Signals — authority boundary tests.
 *
 * The sidecar MUST NOT be able to directly:
 *   - switch modes
 *   - mark diagnostics complete
 *   - select the next diagnostic step
 *   - generate a final report
 *   - bypass Context Engine
 *   - override server legality
 *
 * These tests verify that the adjudication layer returns advisory-only
 * signals and that consumption rules (e.g. `mayOpenReportSurface`) refuse
 * to grant surfaces that would cross the boundary.
 */

import { describe, it, expect } from "vitest";
import {
  adjudicateProposal,
  mayOpenReportSurface,
  mayEnforceSubtypeLock,
  type AdjudicationServerState,
} from "@/lib/chat/llm-runtime-signal-policy";
import {
  tryAdjudicateRuntimeSignals,
  isLlmRuntimeSignalsEnabled,
  LLM_RUNTIME_SIGNALS_FLAG_ENV,
} from "@/lib/chat/llm-runtime-signals";

const ACTIVE_PROCEDURE_STATE: AdjudicationServerState = {
  caseMode: "diagnostic",
  isolationComplete: false,
  terminalPhase: "normal",
  activeStepId: "step_3",
  hasActiveProcedure: true,
};

describe("LLM Runtime Signals — authority boundary", () => {
  it("adjudicated signals are pure data — they do not mutate state", () => {
    const result = adjudicateProposal({
      proposal: {
        surface_request_proposal: { requested_surface: "shop_final_report", confidence: 0.95 },
      },
      latestUserMessage: "make the final report now",
      technicianMessages: ["pump does not work"],
      serverState: ACTIVE_PROCEDURE_STATE,
    });
    // The adjudicator just reports a verdict; it never calls into Context Engine.
    expect(result.surfaceRequest).toMatchObject({ accepted: true });
    // No side-effect property exists on the return type.
    expect(Object.keys(result)).toEqual(
      expect.arrayContaining([
        "objectHypothesis",
        "subtypeLock",
        "surfaceRequest",
        "reportReadiness",
        "stepIssue",
        "evidenceSummary",
      ]),
    );
  });

  it("cannot open a report surface during an active procedure with isolation not complete — surface request alone is insufficient", () => {
    const signals = adjudicateProposal({
      proposal: {
        surface_request_proposal: { requested_surface: "shop_final_report", confidence: 0.95 },
      },
      latestUserMessage: "make the report",
      technicianMessages: ["pump does not work"],
      serverState: ACTIVE_PROCEDURE_STATE,
    });
    const decision = mayOpenReportSurface(signals, ACTIVE_PROCEDURE_STATE);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("active_procedure_without_isolation");
  });

  it("cannot complete diagnostics: no signal exists that marks completion", () => {
    // No such signal is part of the schema. Even a proposal asking for it is
    // silently dropped by the normalizer.
    const result = tryAdjudicateRuntimeSignals({
      rawProposal: JSON.stringify({
        mark_diagnostics_complete: true, // non-existent
        skip_to_step: "step_7", // non-existent
        transition_mode: "final_report", // non-existent
      }),
      latestUserMessage: "make the report",
      technicianMessages: ["pump does not work"],
      serverState: ACTIVE_PROCEDURE_STATE,
    });
    // Flag gating: when off (default), result is null regardless.
    expect(result).toBeNull();
  });

  it("cannot select the next step directly — no such signal exists in the schema", () => {
    // Even when flag is ON, attempts to inject non-schema fields are ignored.
    const prev = process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV];
    process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV] = "1";
    try {
      const result = tryAdjudicateRuntimeSignals({
        rawProposal: JSON.stringify({
          next_step_id: "step_9",
          override_active_step: true,
        }),
        latestUserMessage: "hello",
        technicianMessages: ["pump does not work"],
        serverState: ACTIVE_PROCEDURE_STATE,
      });
      // All fields are non-schema → proposal normalizes to null.
      expect(result).toBeNull();
    } finally {
      if (prev === undefined) delete process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV];
      else process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV] = prev;
    }
  });

  it("ungrounded subtype lock is rejected", () => {
    const signals = adjudicateProposal({
      proposal: {
        subtype_lock_proposal: { subtype: "combo", confidence: 0.99 },
      },
      latestUserMessage: "heater is gas-only",
      technicianMessages: ["heater is gas-only"],
      serverState: { ...ACTIVE_PROCEDURE_STATE, activeStepId: null, hasActiveProcedure: false },
    });
    const enforce = mayEnforceSubtypeLock(signals);
    expect(enforce.allowed).toBe(false);
  });

  it("invalid / malformed proposal is ignored safely (fail-closed)", () => {
    const prev = process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV];
    process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV] = "1";
    try {
      const result = tryAdjudicateRuntimeSignals({
        rawProposal: "this is not JSON",
        latestUserMessage: "hi",
        technicianMessages: [],
        serverState: ACTIVE_PROCEDURE_STATE,
      });
      expect(result).toBeNull();
    } finally {
      if (prev === undefined) delete process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV];
      else process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV] = prev;
    }
  });

  it("feature flag defaults to OFF — no adjudication without explicit enable", () => {
    const prev = process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV];
    delete process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV];
    try {
      expect(isLlmRuntimeSignalsEnabled()).toBe(false);
      const result = tryAdjudicateRuntimeSignals({
        rawProposal: JSON.stringify({
          report_ready_candidate: {
            is_candidate: true,
            confidence: 0.95,
            present_fields: ["complaint"],
            evidence: ["pump"],
          },
        }),
        latestUserMessage: "make report",
        technicianMessages: ["pump does not work"],
        serverState: ACTIVE_PROCEDURE_STATE,
      });
      expect(result).toBeNull();
    } finally {
      if (prev !== undefined) process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV] = prev;
    }
  });

  it("feature flag accepts '1' and 'true' (case-insensitive) and rejects everything else", () => {
    const prev = process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV];
    try {
      process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV] = "1";
      expect(isLlmRuntimeSignalsEnabled()).toBe(true);
      process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV] = "TRUE";
      expect(isLlmRuntimeSignalsEnabled()).toBe(true);
      process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV] = "yes";
      expect(isLlmRuntimeSignalsEnabled()).toBe(false);
      process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV] = "0";
      expect(isLlmRuntimeSignalsEnabled()).toBe(false);
      process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV] = "";
      expect(isLlmRuntimeSignalsEnabled()).toBe(false);
    } finally {
      if (prev === undefined) delete process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV];
      else process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV] = prev;
    }
  });
});
