/**
 * LLM Runtime Signals — evidence integrity adjudication tests.
 *
 * Covers manual acceptance anchor F / anchor 7: water-heater fuse restoration.
 *
 * Critical invariant: when the transcript says the fuse was replaced and
 * operation restored, the adjudicator MUST NOT accept an evidence summary
 * that invents a water-heater valve replacement or any unrelated component
 * replacement. A single ungrounded field rejects the whole summary.
 */

import { describe, it, expect } from "vitest";
import {
  adjudicateEvidenceSummary,
  REJECT,
  type AdjudicationServerState,
} from "@/lib/chat/llm-runtime-signal-policy";

const STATE: AdjudicationServerState = {
  caseMode: "diagnostic",
  isolationComplete: true,
  terminalPhase: "terminal",
  activeStepId: null,
  hasActiveProcedure: true,
};

describe("LLM Runtime Signals — evidence integrity", () => {
  const transcript = [
    "water heater not working",
    "checked 12V fuse on the distribution panel",
    "fuse was blown",
    "fuse replaced",
    "water heater now operating normally",
    "labor 0.3 h",
  ];

  it("accepts a faithful grounded summary of the fuse repair", () => {
    const verdict = adjudicateEvidenceSummary({
      proposal: {
        evidence_summary: {
          complaint: "water heater not working",
          confirmed_findings: ["fuse was blown"],
          technician_actions: ["fuse replaced"],
          restoration_status: "water heater now operating normally",
          labor: "labor 0.3 h",
          required_parts: [],
        },
      },
      latestUserMessage: "START FINAL REPORT",
      technicianMessages: transcript,
      serverState: STATE,
    });
    expect(verdict.accepted).toBe(true);
    expect(verdict.complaint).toBe("water heater not working");
    expect(verdict.technicianActions).toEqual(["fuse replaced"]);
  });

  it("REJECTS a summary that invents a valve replacement not in transcript", () => {
    const verdict = adjudicateEvidenceSummary({
      proposal: {
        evidence_summary: {
          complaint: "water heater not working",
          confirmed_findings: ["fuse was blown"],
          technician_actions: ["water heater gas valve replaced"], // INVENTED
          restoration_status: "operating normally",
          labor: "0.3 h",
        },
      },
      latestUserMessage: "START FINAL REPORT",
      technicianMessages: transcript,
      serverState: STATE,
    });
    expect(verdict.accepted).toBe(false);
    expect(verdict.accepted ? "" : verdict.reason).toBe(REJECT.UNGROUNDED_IN_TRANSCRIPT);
  });

  it("REJECTS when any single required_parts entry is ungrounded", () => {
    const verdict = adjudicateEvidenceSummary({
      proposal: {
        evidence_summary: {
          complaint: "water heater not working",
          confirmed_findings: ["fuse was blown"],
          technician_actions: ["fuse replaced"],
          restoration_status: "operating normally",
          required_parts: ["fuse", "gas control valve"], // second part invented
        },
      },
      latestUserMessage: "START FINAL REPORT",
      technicianMessages: transcript,
      serverState: STATE,
    });
    expect(verdict.accepted).toBe(false);
  });

  it("REJECTS when restoration status is invented", () => {
    const verdict = adjudicateEvidenceSummary({
      proposal: {
        evidence_summary: {
          complaint: "water heater not working",
          restoration_status: "new gas valve installed and tested under pressure", // invented
        },
      },
      latestUserMessage: "START FINAL REPORT",
      technicianMessages: transcript,
      serverState: STATE,
    });
    expect(verdict.accepted).toBe(false);
  });

  it("allows an empty / partial summary (only grounded fields present)", () => {
    const verdict = adjudicateEvidenceSummary({
      proposal: {
        evidence_summary: {
          complaint: "water heater not working",
        },
      },
      latestUserMessage: "ok",
      technicianMessages: transcript,
      serverState: STATE,
    });
    expect(verdict.accepted).toBe(true);
    expect(verdict.complaint).toBe("water heater not working");
    expect(verdict.technicianActions).toBeUndefined();
  });
});
