/**
 * LLM Runtime Signals — report-ready adjudication tests.
 *
 * Covers manual acceptance anchors B and C:
 *   - dense water-pump warranty report input
 *   - dense dimmer-switch report input
 *
 * The server adjudicates the sidecar's report-ready proposal against the
 * transcript. A grounded, high-confidence proposal is accepted but still
 * only opens a report surface via `mayOpenReportSurface`, which enforces
 * the active-procedure / isolation boundary.
 */

import { describe, it, expect } from "vitest";
import {
  adjudicateProposal,
  adjudicateReportReadiness,
  mayOpenReportSurface,
  REJECT,
  type AdjudicationServerState,
} from "@/lib/chat/llm-runtime-signal-policy";

const NO_PROCEDURE_STATE: AdjudicationServerState = {
  caseMode: "diagnostic",
  isolationComplete: false,
  terminalPhase: "normal",
  activeStepId: null,
  hasActiveProcedure: false,
};

const ACTIVE_UNRESOLVED_STATE: AdjudicationServerState = {
  caseMode: "diagnostic",
  isolationComplete: false,
  terminalPhase: "normal",
  activeStepId: "step_2",
  hasActiveProcedure: true,
};

describe("LLM Runtime Signals — report-ready adjudication (water pump warranty)", () => {
  const technicianMessages = [
    "water pump does not work",
    "i confirmed 12V at the pump",
    "direct 12V to pump, pump does not run",
    "replacement required",
    "warranty report requested",
    "0.5 h labor",
  ];
  const latestUserMessage = "warranty report requested, please make the report";

  it("accepts a grounded report-ready candidate with high confidence", () => {
    const verdict = adjudicateReportReadiness({
      proposal: {
        report_ready_candidate: {
          is_candidate: true,
          confidence: 0.9,
          present_fields: ["complaint", "finding", "conclusion", "parts", "labor"],
          missing_fields: [],
          evidence: [
            "pump does not work",
            "12V at the pump",
            "replacement required",
            "0.5 h labor",
          ],
        },
      },
      latestUserMessage,
      technicianMessages,
      serverState: NO_PROCEDURE_STATE,
    });
    expect(verdict.accepted).toBe(true);
    expect(verdict.isCandidate).toBe(true);
    expect(verdict.presentFields).toContain("complaint");
  });

  it("rejects ungrounded evidence claims (prevents invented facts)", () => {
    const verdict = adjudicateReportReadiness({
      proposal: {
        report_ready_candidate: {
          is_candidate: true,
          confidence: 0.9,
          present_fields: ["complaint"],
          evidence: ["valve replacement was completed"], // not in transcript
        },
      },
      latestUserMessage,
      technicianMessages,
      serverState: NO_PROCEDURE_STATE,
    });
    expect(verdict.accepted).toBe(false);
    expect(verdict.accepted ? "" : verdict.reason).toBe(REJECT.UNGROUNDED_IN_TRANSCRIPT);
  });

  it("rejects empty present_fields (missing legal content)", () => {
    const verdict = adjudicateReportReadiness({
      proposal: {
        report_ready_candidate: {
          is_candidate: true,
          confidence: 0.9,
          present_fields: [],
          evidence: ["pump"],
        },
      },
      latestUserMessage,
      technicianMessages,
      serverState: NO_PROCEDURE_STATE,
    });
    expect(verdict.accepted).toBe(false);
  });

  it("mayOpenReportSurface allows a report surface when no active procedure and valid surface request", () => {
    const signals = adjudicateProposal({
      proposal: {
        surface_request_proposal: {
          requested_surface: "warranty_report",
          confidence: 0.9,
          evidence: ["warranty report requested"],
        },
        report_ready_candidate: {
          is_candidate: true,
          confidence: 0.9,
          present_fields: ["complaint", "finding", "labor"],
          evidence: ["pump does not work", "0.5 h labor"],
        },
      },
      latestUserMessage,
      technicianMessages,
      serverState: NO_PROCEDURE_STATE,
    });
    const decision = mayOpenReportSurface(signals, NO_PROCEDURE_STATE);
    expect(decision.allowed).toBe(true);
  });

  it("mayOpenReportSurface requires BOTH surface request and report readiness when active procedure + isolation not complete", () => {
    // Surface request alone is NOT enough in this state.
    const signals1 = adjudicateProposal({
      proposal: {
        surface_request_proposal: {
          requested_surface: "warranty_report",
          confidence: 0.9,
          evidence: ["warranty report requested"],
        },
      },
      latestUserMessage,
      technicianMessages,
      serverState: ACTIVE_UNRESOLVED_STATE,
    });
    expect(mayOpenReportSurface(signals1, ACTIVE_UNRESOLVED_STATE).allowed).toBe(false);

    // With BOTH accepted + grounded → allowed.
    const signals2 = adjudicateProposal({
      proposal: {
        surface_request_proposal: {
          requested_surface: "warranty_report",
          confidence: 0.9,
          evidence: ["warranty report requested"],
        },
        report_ready_candidate: {
          is_candidate: true,
          confidence: 0.9,
          present_fields: ["complaint", "finding", "labor"],
          evidence: ["pump does not work", "0.5 h labor"],
        },
      },
      latestUserMessage,
      technicianMessages,
      serverState: ACTIVE_UNRESOLVED_STATE,
    });
    expect(mayOpenReportSurface(signals2, ACTIVE_UNRESOLVED_STATE).allowed).toBe(true);
  });
});

describe("LLM Runtime Signals — report-ready adjudication (dimmer switch)", () => {
  const technicianMessages = [
    "dimmer switches not responding in living room",
    "visual inspection shows burned contacts on the dimmer",
    "conclusion: dimmer switch failed, needs replacement",
    "parts needed: dimmer switch assembly",
    "labor 0.6 h",
    "please make the report",
  ];
  const latestUserMessage = "please make the report";

  it("accepts a grounded dimmer report-ready proposal", () => {
    const verdict = adjudicateReportReadiness({
      proposal: {
        report_ready_candidate: {
          is_candidate: true,
          confidence: 0.85,
          present_fields: ["complaint", "inspection", "conclusion", "parts", "labor"],
          evidence: [
            "dimmer switches not responding",
            "burned contacts on the dimmer",
            "dimmer switch failed",
            "dimmer switch assembly",
            "labor 0.6 h",
          ],
        },
      },
      latestUserMessage,
      technicianMessages,
      serverState: NO_PROCEDURE_STATE,
    });
    expect(verdict.accepted).toBe(true);
  });

  it("surface request 'shop_final_report' is accepted for 'please make the report'", () => {
    const signals = adjudicateProposal({
      proposal: {
        surface_request_proposal: {
          requested_surface: "shop_final_report",
          confidence: 0.85,
        },
      },
      latestUserMessage,
      technicianMessages,
      serverState: NO_PROCEDURE_STATE,
    });
    expect(signals.surfaceRequest.accepted).toBe(true);
  });

  it("surface request is rejected when latest message does not contain a report verb", () => {
    const signals = adjudicateProposal({
      proposal: {
        surface_request_proposal: {
          requested_surface: "shop_final_report",
          confidence: 0.85,
        },
      },
      latestUserMessage: "ok thanks",
      technicianMessages,
      serverState: NO_PROCEDURE_STATE,
    });
    expect(signals.surfaceRequest.accepted).toBe(false);
  });
});
