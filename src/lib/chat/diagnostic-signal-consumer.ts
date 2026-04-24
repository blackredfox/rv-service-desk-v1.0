/**
 * Consume already-adjudicated LLM runtime signals inside diagnostic step
 * selection and legality handling.
 *
 * Authority contract (CRITICAL):
 *   - LLM proposes. Server adjudicates. Context Engine remains authoritative.
 *   - This module consumes ONLY signals that already passed the merged
 *     adjudication layer. Raw LLM JSON is NEVER consumed here.
 *   - The consumer NEVER:
 *       * switches modes
 *       * marks diagnostics complete
 *       * selects an arbitrary next step
 *       * mutates Context Engine state directly
 *       * generates final output
 *       * overrides safety / report legality / truth boundaries
 *   - It only updates server-owned diagnostic-registry state through the
 *     same primitives that the registry exposes for the rest of the
 *     runtime (subtype exclusions, force-complete of the active step).
 *   - All actions fail closed: if the registry has no active procedure,
 *     or the signal verdict is not `accepted`, the consumer is a no-op.
 */

import {
  addSubtypeExclusionsFromSignal,
  forceStepComplete,
  getActiveProcedure,
  getStepAskCount,
} from "@/lib/diagnostic-registry";
import type { AdjudicatedSignals } from "@/lib/chat/llm-runtime-signal-policy";
import type { StepIssue } from "@/lib/chat/llm-runtime-signal-schema";

export type DiagnosticSignalConsumerInput = {
  caseId: string;
  signals: AdjudicatedSignals;
  /** Currently active diagnostic step id from Context Engine, if any. */
  activeStepId: string | null;
};

export type DiagnosticSignalConsumerResult = {
  /** Subtype exclusions the registry gained on this turn. */
  subtypeExclusionsAdded: string[];
  /** Step-issue actions the server took on this turn. */
  stepIssueActions: Array<{
    stepId: string;
    issue: StepIssue;
    action: "force_completed" | "noted_advisory";
  }>;
};

/**
 * Map an adjudicated subtype string to the canonical registry exclusion set.
 *
 * Returns `[]` when the subtype is unknown or when consumption should stay
 * a no-op. Every value returned MUST match the `subtypeGate` discriminator
 * already used by the procedure catalog (e.g. `"combo"` suppresses
 * `subtypeGate: "combo"` steps).
 */
export function mapSubtypeLockToRegistryExclusions(
  subtype: string | undefined,
): string[] {
  if (!subtype) return [];
  const normalized = subtype.trim().toLowerCase();
  switch (normalized) {
    case "non-combo":
    case "gas-only":
    case "gas_only":
    case "lp-only":
    case "lp_only":
    case "propane-only":
    case "mechanical-ignition":
      // All of these assert the unit is NOT a combo unit. The registry
      // already interprets the `combo` exclusion as "skip subtypeGate:combo
      // steps" (see `getNextStepBranchAware`). No other exclusions are
      // introduced by this PR — staying narrow.
      return ["combo"];
    default:
      return [];
  }
}

/**
 * Consume accepted diagnostic signals. Returns a structured record of the
 * server-owned actions performed so the caller can log them.
 *
 * IMPORTANT:
 *   - If `signals` is falsy, or if there is no active procedure for
 *     `caseId`, this function returns an empty result immediately.
 *   - Only `accepted: true` verdicts are consumed.
 *   - Only `repeated_step`, `already_answered`, and
 *     `subtype_incompatible_step` step issues trigger a force-complete,
 *     because those three are the only issues that justify replacing the
 *     current active step through a server-owned primitive.
 *   - Other step issues (`irrelevant_step`, `conflicting_step`) are noted
 *     as advisories only — the server keeps the step selection authority.
 */
export function consumeAdjudicatedDiagnosticSignals(
  input: DiagnosticSignalConsumerInput,
): DiagnosticSignalConsumerResult {
  const empty: DiagnosticSignalConsumerResult = {
    subtypeExclusionsAdded: [],
    stepIssueActions: [],
  };

  if (!input.signals) return empty;
  if (!getActiveProcedure(input.caseId)) return empty;

  const result: DiagnosticSignalConsumerResult = {
    subtypeExclusionsAdded: [],
    stepIssueActions: [],
  };

  // ── 1) Subtype lock consumption ────────────────────────────────────
  const subtypeLock = input.signals.subtypeLock;
  if (subtypeLock.accepted) {
    const exclusions = mapSubtypeLockToRegistryExclusions(subtypeLock.subtype);
    if (exclusions.length > 0) {
      const added = addSubtypeExclusionsFromSignal(input.caseId, exclusions);
      if (added.length > 0) {
        result.subtypeExclusionsAdded = added;
      }
    }
  }

  // ── 2) Step issue consumption ──────────────────────────────────────
  const stepIssue = input.signals.stepIssue;
  if (stepIssue.accepted && stepIssue.issue && input.activeStepId) {
    const issue = stepIssue.issue;
    if (
      issue === "repeated_step" ||
      issue === "already_answered" ||
      issue === "subtype_incompatible_step"
    ) {
      // SAFETY:
      //   - Force-complete uses the existing registry primitive
      //     (`unableStepIds` add) — this is the same mechanism loop
      //     recovery already uses. The LLM is NOT selecting the
      //     replacement step; selection will happen through the
      //     existing `getNextStepBranchAware` path.
      //   - We only fire once per turn per active step. The ask-count
      //     check keeps us from force-completing a step that hasn't
      //     actually been asked yet (guards against spurious signals
      //     before any prompt was sent).
      const askCount = getStepAskCount(input.caseId, input.activeStepId);
      if (askCount > 0) {
        forceStepComplete(input.caseId, input.activeStepId, "loop_recovery");
        result.stepIssueActions.push({
          stepId: input.activeStepId,
          issue,
          action: "force_completed",
        });
      } else {
        result.stepIssueActions.push({
          stepId: input.activeStepId,
          issue,
          action: "noted_advisory",
        });
      }
    } else {
      // irrelevant_step / conflicting_step — advisory only.
      result.stepIssueActions.push({
        stepId: input.activeStepId,
        issue,
        action: "noted_advisory",
      });
    }
  }

  return result;
}

/**
 * Build a narrow debug payload for logging.
 */
export function buildConsumerDebug(
  result: DiagnosticSignalConsumerResult,
): Record<string, unknown> {
  return {
    subtype_exclusions_added: result.subtypeExclusionsAdded,
    step_issue_actions: result.stepIssueActions,
  };
}
