/**
 * LLM Runtime Signal — Orchestration Entry Point.
 *
 * Authority contract (CRITICAL):
 *   - LLM proposes. Server adjudicates. Context Engine remains authoritative.
 *   - This module is the ONLY public entry point used by the chat route.
 *   - It is feature-flagged via `ENABLE_LLM_RUNTIME_SIGNALS`. When the flag
 *     is disabled (default), `tryAdjudicateRuntimeSignals` returns `null`
 *     and the runtime behaves exactly as before.
 *   - When enabled, it parses a raw proposal JSON (emitted by the LLM
 *     sidecar around the existing execution path) and returns adjudicated
 *     signals for bounded server-side interpretation only.
 *
 * The sidecar MUST NOT:
 *   - switch modes
 *   - mark diagnostics complete
 *   - select the next diagnostic step
 *   - generate a final report
 *   - bypass Context Engine
 *   - override server legality / safety / no-invention rules
 *
 * On any parse or validation failure, this module fails closed: it returns
 * `null` and the runtime continues with existing safe behavior.
 */

import { parseSidecarProposal } from "./llm-runtime-signal-schema";
import {
  adjudicateProposal,
  type AdjudicatedSignals,
  type AdjudicationServerState,
} from "./llm-runtime-signal-policy";

export const LLM_RUNTIME_SIGNALS_FLAG_ENV = "ENABLE_LLM_RUNTIME_SIGNALS";

/**
 * Check whether the narrow sidecar feature flag is enabled.
 * Default: disabled. Truthy values are "1" and "true" (case-insensitive).
 */
export function isLlmRuntimeSignalsEnabled(): boolean {
  const raw = process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV];
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

export type AdjudicateRuntimeSignalsInput = {
  /** Raw text emitted by the LLM sidecar, possibly embedded in larger output. */
  rawProposal: string;
  /** Latest technician utterance in this turn. */
  latestUserMessage: string;
  /** Prior technician messages (grounding corpus). */
  technicianMessages: string[];
  /** Read-only snapshot of server state for consistency checks. */
  serverState: AdjudicationServerState;
};

export type AdjudicateRuntimeSignalsResult = {
  /** Adjudicated signals. Never represents a state mutation by itself. */
  signals: AdjudicatedSignals;
  /** Raw parse succeeded. Useful for debug/observability. */
  parseOk: boolean;
};

/**
 * Parse + adjudicate a raw sidecar proposal.
 *
 * Returns `null` when:
 *   - the feature flag is disabled;
 *   - the raw proposal cannot be parsed;
 *   - the parsed proposal normalizes to empty.
 *
 * Consumers MUST treat `null` as "no sidecar signal available" and continue
 * with the existing safe behavior. They MUST NOT invent a default signal.
 */
export function tryAdjudicateRuntimeSignals(
  input: AdjudicateRuntimeSignalsInput,
): AdjudicateRuntimeSignalsResult | null {
  if (!isLlmRuntimeSignalsEnabled()) return null;

  let proposal;
  try {
    proposal = parseSidecarProposal(input.rawProposal);
  } catch {
    // Defensive: the parser is already fail-closed, but wrap in try/catch
    // to guarantee the chat route cannot be destabilized by this module.
    return null;
  }

  if (!proposal) return null;

  try {
    const signals = adjudicateProposal({
      proposal,
      latestUserMessage: input.latestUserMessage,
      technicianMessages: input.technicianMessages,
      serverState: input.serverState,
    });
    return { signals, parseOk: true };
  } catch {
    return null;
  }
}

/**
 * Build a narrow debug payload for logging. Safe to emit to stdout when
 * the flag is enabled — never contains user-secret data beyond evidence
 * strings already present in the proposal.
 */
export function buildAdjudicationDebug(
  result: AdjudicateRuntimeSignalsResult | null,
): Record<string, unknown> {
  if (!result) return { sidecar: "disabled_or_no_proposal" };
  const { signals } = result;
  return {
    sidecar: "adjudicated",
    object_hypothesis: summarizeVerdict(signals.objectHypothesis),
    subtype_lock: summarizeVerdict(signals.subtypeLock),
    surface_request: summarizeVerdict(signals.surfaceRequest),
    report_readiness: summarizeVerdict(signals.reportReadiness),
    step_issue: summarizeVerdict(signals.stepIssue),
    evidence_summary: summarizeVerdict(signals.evidenceSummary),
  };
}

function summarizeVerdict(
  v: { accepted: boolean; reason?: string },
): { accepted: boolean; reason?: string } {
  return v.accepted ? { accepted: true } : { accepted: false, reason: v.reason };
}

export type { AdjudicatedSignals, AdjudicationServerState };
