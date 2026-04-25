/**
 * Case-89 manual-acceptance revision — final-report fact integrity.
 *
 * Bug: when Case-88's water-pump direct-power isolation routes the
 * dense warranty input into a transcript-derived final-report draft,
 * the LLM was inventing post-repair restoration claims that the
 * technician never made (e.g. "after replacement, water pump
 * operation was restored and system is operating", labor line for
 * "post-repair operational verification").
 *
 * The technician explicitly said the pump REQUIRES replacement —
 * they did NOT say replacement was performed. Final-report fact
 * integrity requires the report to:
 *   - describe the diagnostic finding only ("pump failed
 *     direct-power test; replacement required");
 *   - RECOMMEND the future repair (imperative / future wording);
 *   - NOT claim the repair was done or that the system is operating.
 *
 * This file verifies three product axes:
 *
 *   1. Transcript repair-status assessor — narrow, deterministic
 *      check distinguishing recommended-only from completed repairs
 *      (and excluding future-intent forms like "требует замены").
 *
 *   2. Transcript-derived draft constraint text — when the assessor
 *      reports `repairPerformed: false`, the constraint MUST contain
 *      explicit prohibitions ("Do NOT claim the part was replaced",
 *      "Do NOT include 'after replacement' / 'restored' / 'system is
 *      operating'", "Do NOT include a labor line for post-repair
 *      operational verification") that the LLM consumes.
 *
 *   3. `deriveFinalReportAuthorityFacts` — does NOT false-positive
 *      "не работает" / "not working" as restored operation; closes
 *      the authority summary with a no-repair-performed line so the
 *      authority constraint stops pushing the LLM toward
 *      "repaired/restored latest state".
 *
 * Tests are deterministic and DO NOT call a real LLM.
 */

import { describe, it, expect } from "vitest";
import {
  assessTranscriptRepairStatus,
} from "@/lib/chat/repair-summary-intent";
import {
  buildFinalReportAuthorityConstraint,
  deriveFinalReportAuthorityFacts,
} from "@/lib/fact-pack";

// The route's `buildTranscriptDerivedDraftConstraint` is private to
// `route.ts`. We replicate its public shape here so the test verifies
// the contract that route.ts depends on. The actual implementation
// lives next to the route — tests import it via dynamic import below.
async function importRouteConstraint() {
  // The function is exported via `__test__` in `route.ts`. We expose a
  // narrow re-import path through the module's public surface using a
  // direct text-string assertion: route.ts builds the same string by
  // calling `assessTranscriptRepairStatus(...)` and then assembling
  // prohibition lines. We test the two pieces independently.
  return null;
}
void importRouteConstraint;

// ── Repair-status assessor ────────────────────────────────────────────

describe("Case-89 assessTranscriptRepairStatus — recommended-only", () => {
  it("Russian Case-89 input: pump bad, requires replacement → repairPerformed=false, restorationConfirmed=false", () => {
    const status = assessTranscriptRepairStatus([
      "водяной насос не работает. проверил ток. есть 12 волт, подключил 12 волт напрямую к насосу. насос не рабочий и требует замены. напиши warranty report. 0,5 h labor",
    ]);
    expect(status.repairPerformed).toBe(false);
    expect(status.restorationConfirmed).toBe(false);
  });

  it("English equivalent: pump failed direct-power, replacement required → both false", () => {
    const status = assessTranscriptRepairStatus([
      "Water pump not working. Confirmed 12V at terminals. Applied 12V directly to the pump — pump does not run. Pump is bad and requires replacement. Please write warranty report.",
    ]);
    expect(status.repairPerformed).toBe(false);
    expect(status.restorationConfirmed).toBe(false);
  });

  it("Spanish equivalent: hay que reemplazar la bomba → both false", () => {
    const status = assessTranscriptRepairStatus([
      "La bomba de agua no funciona. Apliqué 12V directamente a la bomba y la bomba no arranca. Hay que reemplazar la bomba. Prepara el informe de garantía.",
    ]);
    expect(status.repairPerformed).toBe(false);
    expect(status.restorationConfirmed).toBe(false);
  });
});

describe("Case-89 assessTranscriptRepairStatus — completed control", () => {
  it("Russian: 'заменил насос. теперь работает' → repairPerformed=true, restorationConfirmed=true", () => {
    const status = assessTranscriptRepairStatus([
      "насос не работал. проверил, 12 в есть, подал напрямую — мёртв.",
      "заменил насос. теперь работает нормально.",
    ]);
    expect(status.repairPerformed).toBe(true);
    expect(status.restorationConfirmed).toBe(true);
  });

  it("English: 'replaced the pump. now operational' → both true", () => {
    const status = assessTranscriptRepairStatus([
      "Pump dead. 12V good. Direct power test failed.",
      "Replaced the pump. Now works after repair.",
    ]);
    expect(status.repairPerformed).toBe(true);
    expect(status.restorationConfirmed).toBe(true);
  });

  it("Spanish: 'reemplacé la bomba. funciona después de la reparación' → both true", () => {
    const status = assessTranscriptRepairStatus([
      "La bomba estaba muerta. 12V presente. Probé directo, no arrancó.",
      "Reemplacé la bomba. Funciona después de la reparación.",
    ]);
    expect(status.repairPerformed).toBe(true);
    expect(status.restorationConfirmed).toBe(true);
  });

  it("future-intent ('надо заменить') is NOT confused with completion", () => {
    const status = assessTranscriptRepairStatus([
      "насос не работает. надо заменить.",
    ]);
    expect(status.repairPerformed).toBe(false);
  });

  it("future-intent ('needs to be replaced') is NOT confused with completion", () => {
    const status = assessTranscriptRepairStatus([
      "Pump is bad. Needs to be replaced.",
    ]);
    expect(status.repairPerformed).toBe(false);
  });
});

// ── deriveFinalReportAuthorityFacts truth-integrity ───────────────────

describe("Case-89 deriveFinalReportAuthorityFacts — truth integrity", () => {
  it("Case-88 isolation (no repair, no restoration) does NOT claim 'operational after repair'", () => {
    const isolationFinding =
      "Water pump failed direct-power test — 12V applied directly to the pump, pump does not run; replacement required.";
    const facts = deriveFinalReportAuthorityFacts(
      [
        {
          role: "user",
          content:
            "водяной насос не работает. проверил ток. есть 12 волт, подключил 12 волт напрямую к насосу. насос не рабочий и требует замены. напиши warranty report. 0,5 h labor",
        },
      ],
      // Minimal context shape that mirrors what the engine produces
      // for a Case-88 direct-power isolation.
      {
        isolationComplete: true,
        isolationFinding,
        terminalState: {
          phase: "normal",
          faultIdentified: { text: isolationFinding, detectedAt: "" },
          correctiveAction: null,
          restorationConfirmed: null,
        },
      } as never,
    );
    expect(facts).not.toBeNull();
    // Verified Condition must reflect ISOLATION ONLY, not restoration.
    expect(facts!.verifiedCondition).toContain("direct-power test");
    expect(facts!.verifiedCondition).not.toMatch(
      /after\s+(?:repair|replacement)/i,
    );
    expect(facts!.verifiedCondition).not.toMatch(
      /(?:operational|operating|restored|fixed)\s+after/i,
    );
    // No corrective-action line in the authority summary (since none
    // was performed).
    expect(facts!.authoritySummary).not.toMatch(
      /Corrective action performed/i,
    );
    // The closing line must instruct the LLM that no repair was performed.
    expect(facts!.authoritySummary).toMatch(
      /No corrective action has been performed/i,
    );
  });

  it("authority constraint switches to no-repair trailing line in this case", () => {
    const isolationFinding =
      "Water pump failed direct-power test — 12V applied directly to the pump, pump does not run; replacement required.";
    const facts = deriveFinalReportAuthorityFacts(
      [
        {
          role: "user",
          content:
            "водяной насос не работает. проверил ток. есть 12 волт, подключил 12 волт напрямую к насосу. насос не рабочий и требует замены. напиши warranty report. 0,5 h labor",
        },
      ],
      {
        isolationComplete: true,
        isolationFinding,
        terminalState: {
          phase: "normal",
          faultIdentified: { text: isolationFinding, detectedAt: "" },
          correctiveAction: null,
          restorationConfirmed: null,
        },
      } as never,
    );
    const constraint = buildFinalReportAuthorityConstraint(facts);
    expect(constraint).toContain("AUTHORITATIVE FINAL STATE");
    // Must NOT push the LLM toward "repaired/restored".
    expect(constraint).not.toMatch(
      /repaired\/restored\s+latest\s+state/i,
    );
    // Must explicitly forbid claiming the repair was performed.
    expect(constraint).toMatch(
      /MUST NOT state, imply, or invent that the repair was performed/i,
    );
  });

  it("'не работает' alone does NOT trigger restored-operation false-positive", () => {
    const facts = deriveFinalReportAuthorityFacts(
      [
        { role: "user", content: "насос не работает. подал 12 в напрямую — мёртв." },
      ],
      {
        isolationComplete: true,
        isolationFinding:
          "Water pump failed direct-power test; replacement required.",
        terminalState: {
          phase: "normal",
          faultIdentified: { text: "pump dead", detectedAt: "" },
          correctiveAction: null,
          restorationConfirmed: null,
        },
      } as never,
    );
    expect(facts).not.toBeNull();
    expect(facts!.verifiedCondition).not.toMatch(
      /Technician confirmed restored operation/i,
    );
  });
});

// ── Route-level transcript-derived draft constraint ──────────────────

describe("Case-89 buildTranscriptDerivedDraftConstraint — prompt prohibitions", () => {
  it("when repairPerformed=false, constraint forbids inventing post-repair claims", async () => {
    const route = await import("@/app/api/chat/route");
    const constraint = route.__test__.buildTranscriptDerivedDraftConstraint({
      repairPerformed: false,
      restorationConfirmed: false,
    });
    expect(constraint).toContain("REPORT ASSEMBLY (MANDATORY)");
    expect(constraint).toContain("TRUTH / NO-INVENTION");
    expect(constraint).toMatch(
      /Do NOT claim the part was replaced/i,
    );
    expect(constraint).toMatch(
      /Do NOT.*after replacement.*restored.*repair completed.*post-repair.*system is operating/is,
    );
    expect(constraint).toMatch(
      /Estimated Labor section must NOT include a line for post-repair operational verification/i,
    );
    expect(constraint).toContain("RESTORATION (MANDATORY)");
  });

  it("when repairPerformed=true and restorationConfirmed=true, constraint omits the prohibition blocks", async () => {
    const route = await import("@/app/api/chat/route");
    const constraint = route.__test__.buildTranscriptDerivedDraftConstraint({
      repairPerformed: true,
      restorationConfirmed: true,
    });
    expect(constraint).toContain("REPORT ASSEMBLY (MANDATORY)");
    expect(constraint).not.toMatch(/TRUTH \/ NO-INVENTION/);
    expect(constraint).not.toMatch(/^RESTORATION \(MANDATORY\)/m);
  });

  it("recommended Corrective Action wording is permitted (future / imperative)", async () => {
    const route = await import("@/app/api/chat/route");
    const constraint = route.__test__.buildTranscriptDerivedDraftConstraint({
      repairPerformed: false,
      restorationConfirmed: false,
    });
    expect(constraint).toMatch(
      /may RECOMMEND a future repair using imperative \/ future wording/i,
    );
  });
});
