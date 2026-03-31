/**
 * Route Authority Mini-Pack v1
 *
 * Offline, deterministic fixture set for the highest-risk RVSD authority boundaries.
 *
 * Focus areas:
 * - server vs LLM authority conflict
 * - completion/terminal-state continuation
 * - semantic completion without explicit transition
 * - stale/fake final-report authority
 * - hidden step progression
 */

import type { RVSDContractCheckInput } from "@/lib/eval/rvsd-contract-check";

export type RouteAuthorityCase = {
  id: string;
  description: string;
  why: string;
  input: RVSDContractCheckInput;
  expectedPassed: boolean;
  expectedViolationIncludes?: string[];
};

/**
 * Authority fixture responses
 */
export const ROUTE_AUTHORITY_FIXTURES = {
  /**
   * Valid control: After confirmed repair completion, diagnostic response
   * that offers explicit final-report command path without continuing diagnostics.
   * Key: Uses "START FINAL REPORT" offer which is allowed without question mark.
   */
  terminalCompletionOfferValid: `System: Water heater
Classification: Consumer appliance
Status: Verified restoration confirmed

Confirmed. Fault isolated: open circuit in 12V supply wiring. After wiring replacement, water heater operational.

Send START FINAL REPORT and I will generate the report.`,

  /**
   * FAIL: Response continues asking diagnostic questions after claiming completion.
   * Contains "Isolation complete" — premature completion marker.
   * Violates terminal-state authority — no further diagnostic expansion allowed.
   */
  terminalStateIllegalFollowUp: `System: Water heater
Classification: Consumer appliance
Status: Isolation complete

Good, the repair was successful. Now let's verify a few more things:

Step 6: Is the thermal cutoff relay functioning correctly?`,

  /**
   * FAIL: Response implies readiness/finality but gives no explicit command.
   * Contains semantic transition markers: "conditions are met", "ready to transition".
   * Violates transition doctrine — semantic completion alone is not a valid switch.
   */
  semanticCompletionWithoutCommand: `System: Water heater
Classification: Consumer appliance
Status: Isolation not completed; Cause cannot be formed

Based on your confirmation, isolation conditions are met. We are ready to transition to Final Report Mode.`,

  /**
   * FAIL: Final report structure appears before explicit report command.
   * Violates mode-class/authority rule — diagnostic mode cannot produce report structure.
   */
  prematureFinalReportGeneration: `Complaint: Water heater ignition fault.
Diagnostic Procedure: Verified 12V supply and checked the control-board fuse.
Verified Condition: Fuse continuity loss identified in the 12V supply path.
Recommended Corrective Action: Replace the fuse and verify heater operation.
Estimated Labor: Access and fuse replacement - 0.4 hr. Total labor: 0.4 hr.
Required Parts: Fuse.`,

  /**
   * FAIL: Final report missing required "Required Parts" header.
   * This represents a stale/incomplete authority shape — report structure is malformed.
   */
  staleFinalReportMissingHeader: `Complaint: Water heater not heating.
Diagnostic Procedure: Visual inspection performed.
Verified Condition: No fault found. Unable to determine cause.
Recommended Corrective Action: Further investigation required.
Estimated Labor: Diagnostic only - 0.5 hr. Total labor: 0.5 hr.`,

  /**
   * FAIL: Clarification request results in a statement block without question.
   * When a technician asks for clarification, response must include a question.
   * This represents hidden step progression — violates diagnostic question shape.
   */
  clarificationStatementOnly: `System: Water heater
Classification: Consumer appliance
Status: Isolation not completed; Cause cannot be formed

Understood, step complete. Moving to the next diagnostic step. Check the gas valve solenoid continuity.`,
} as const;

/**
 * Route Authority Mini-Pack v1
 *
 * 6 authority-focused cases covering the highest-risk boundaries.
 */
export const ROUTE_AUTHORITY_MINI_PACK_V1: RouteAuthorityCase[] = [
  // ── 1. Valid control ───────────────────────────────────────────────────
  {
    id: "terminal-completion-offer-valid",
    description:
      "Diagnostic response after confirmed repair completion offers explicit final-report command path without continuing diagnostics.",
    why: "Valid control case: demonstrates authority-safe completion/report transition. Response stays in diagnostic-mode class, offers explicit command path, does not ask more diagnostic questions.",
    input: {
      mode: "diagnostic",
      responseText: ROUTE_AUTHORITY_FIXTURES.terminalCompletionOfferValid,
      dialogueLanguage: "EN",
      metadata: { explicitTransitionCommandGiven: false },
    },
    expectedPassed: true,
  },

  // ── 2. Terminal state illegal follow-up ────────────────────────────────
  {
    id: "terminal-state-illegal-follow-up",
    description:
      "Response continues diagnostics after completion — should fail authority/transition boundary.",
    why: "After terminal state (isolation complete), the system must NOT ask more diagnostic questions. Continuing to ask steps violates the completion/terminal-state authority contract.",
    input: {
      mode: "diagnostic",
      responseText: ROUTE_AUTHORITY_FIXTURES.terminalStateIllegalFollowUp,
      dialogueLanguage: "EN",
      metadata: { explicitTransitionCommandGiven: false },
    },
    expectedPassed: false,
    expectedViolationIncludes: ["CONTRACT_PREMATURE_COMPLETION"],
  },

  // ── 3. Semantic completion without command ─────────────────────────────
  {
    id: "semantic-completion-without-command",
    description:
      "Response implies readiness/finality but gives no explicit command — should fail transition doctrine.",
    why: "Semantic completion alone (e.g., 'conditions met', 'ready to transition') must NOT be treated as a valid mode switch. Explicit user command is required for transition.",
    input: {
      mode: "diagnostic",
      responseText: ROUTE_AUTHORITY_FIXTURES.semanticCompletionWithoutCommand,
      dialogueLanguage: "EN",
      metadata: { explicitTransitionCommandGiven: false },
    },
    expectedPassed: false,
    expectedViolationIncludes: [
      "CONTRACT_PREMATURE_COMPLETION",
      "CONTRACT_EXPLICIT_TRANSITION_REQUIRED",
    ],
  },

  // ── 4. Premature final report generation ───────────────────────────────
  {
    id: "premature-final-report-generation",
    description:
      "Final-report structure appears before explicit report command — should fail mode-class/authority rule.",
    why: "Diagnostic mode must never produce final-report structure. Report generation requires explicit command. This violation represents server vs LLM authority conflict.",
    input: {
      mode: "diagnostic",
      responseText: ROUTE_AUTHORITY_FIXTURES.prematureFinalReportGeneration,
      dialogueLanguage: "EN",
      metadata: { explicitTransitionCommandGiven: false },
    },
    expectedPassed: false,
    expectedViolationIncludes: ["CONTRACT_DIAGNOSTIC_DRIFT"],
  },

  // ── 5. Stale final report authority shape ──────────────────────────────
  {
    id: "stale-final-report-missing-header",
    description:
      "Final report missing required header — should fail structure expectation.",
    why: "A final report with missing required headers represents a stale/incomplete authority shape. Report structure must be complete and valid.",
    input: {
      mode: "final_report",
      responseText: ROUTE_AUTHORITY_FIXTURES.staleFinalReportMissingHeader,
      dialogueLanguage: "EN",
      includeTranslation: false,
    },
    expectedPassed: false,
    expectedViolationIncludes: ["CONTRACT_FINAL_REPORT_STRUCTURE"],
  },

  // ── 6. Clarification does not silently complete ────────────────────────
  {
    id: "clarification-statement-only",
    description:
      "Clarification response without question — should fail diagnostic question shape.",
    why: "When responding to a clarification request, diagnostic mode must still include a question. A statement-only response represents hidden step progression without proper verification.",
    input: {
      mode: "diagnostic",
      responseText: ROUTE_AUTHORITY_FIXTURES.clarificationStatementOnly,
      dialogueLanguage: "EN",
      metadata: { explicitTransitionCommandGiven: false },
    },
    expectedPassed: false,
    expectedViolationIncludes: ["CONTRACT_QUESTION_SHAPE"],
  },
];
