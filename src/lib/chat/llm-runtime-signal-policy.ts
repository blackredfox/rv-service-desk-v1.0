/**
 * LLM Runtime Signal — Server Adjudication Policy.
 *
 * Authority contract (CRITICAL):
 *   - LLM proposes. Server adjudicates. Context Engine remains authoritative.
 *   - This module MUST NOT switch modes, mark diagnostics complete,
 *     select next steps, or generate final output.
 *   - Every proposal is re-validated against:
 *       1) authority boundary (sidecar cannot claim flow authority)
 *       2) transcript grounding (no invented facts)
 *       3) server state consistency (cannot contradict Context Engine)
 *
 * All functions in this module are pure. They return an adjudicated
 * decision object describing whether each proposal is accepted or rejected,
 * with an explicit rejection reason for observability.
 */

import type {
  LlmRuntimeSignalProposal,
  ObjectHypothesisProposal,
  ReportReadyCandidateProposal,
  StepIssue,
  StepIssueSignalProposal,
  SubtypeLockProposal,
  SurfaceRequestProposal,
  RequestedSurface,
  EvidenceSummaryProposal,
} from "./llm-runtime-signal-schema";

export type AdjudicationVerdict =
  | { accepted: true; reason?: never }
  | { accepted: false; reason: string };

export type AdjudicatedSubtypeLock = AdjudicationVerdict & {
  subtype?: string;
  confidence?: number;
};

export type AdjudicatedSurfaceRequest = AdjudicationVerdict & {
  requestedSurface?: RequestedSurface;
  confidence?: number;
};

export type AdjudicatedReportReadiness = AdjudicationVerdict & {
  isCandidate?: boolean;
  confidence?: number;
  presentFields?: string[];
  missingFields?: string[];
};

export type AdjudicatedStepIssue = AdjudicationVerdict & {
  issue?: StepIssue;
  confidence?: number;
};

export type AdjudicatedObjectHypothesis = AdjudicationVerdict & {
  system?: string;
  equipment?: string;
  confidence?: number;
};

export type AdjudicatedEvidenceSummary = AdjudicationVerdict & {
  complaint?: string;
  confirmedFindings?: string[];
  technicianActions?: string[];
  restorationStatus?: string;
  labor?: string;
  requiredParts?: string[];
};

export type AdjudicatedSignals = {
  objectHypothesis: AdjudicatedObjectHypothesis;
  subtypeLock: AdjudicatedSubtypeLock;
  surfaceRequest: AdjudicatedSurfaceRequest;
  reportReadiness: AdjudicatedReportReadiness;
  stepIssue: AdjudicatedStepIssue;
  evidenceSummary: AdjudicatedEvidenceSummary;
};

/**
 * Minimal adjudication context. The server provides the transcript
 * (technician messages) and a read-only snapshot of current server state.
 *
 * No Context Engine mutation is allowed from within adjudication.
 */
export type AdjudicationServerState = {
  /** Current server-owned case mode (diagnostic / final_report / etc.). */
  caseMode: string;
  /** Whether Context Engine has confirmed diagnostic isolation. */
  isolationComplete: boolean;
  /** Current Context Engine terminal phase. */
  terminalPhase?: "normal" | "fault_candidate" | "terminal";
  /** Currently active diagnostic step id, if any. */
  activeStepId?: string | null;
  /** Text of current active step question, if any. */
  activeStepQuestion?: string | null;
  /** Number of prior turns that asked the same active step (for repeated detection). */
  priorAskCountForActiveStep?: number;
  /** Whether an active procedure is bound in the Context Engine. */
  hasActiveProcedure?: boolean;
};

export type AdjudicationInput = {
  proposal: LlmRuntimeSignalProposal;
  /** Most recent technician utterance (trusted only as user-typed). */
  latestUserMessage: string;
  /** Full transcript of technician messages for grounding. */
  technicianMessages: string[];
  serverState: AdjudicationServerState;
};

// ── Grounding helpers ───────────────────────────────────────────────────

const MIN_GROUNDING_TOKEN_LEN = 3;

/**
 * Tokenize a string into lowercase alphanumeric tokens for grounding checks.
 * Keeps tokens >= MIN_GROUNDING_TOKEN_LEN to avoid spurious matches.
 */
function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(/[^a-z0-9а-яё]+/i)
    .filter((t) => t.length >= MIN_GROUNDING_TOKEN_LEN);
}

/**
 * Return true iff every non-trivial token of `needle` appears somewhere in `haystack`.
 *
 * NOTE: this is a permissive grounding check. It tolerates paraphrase but
 * CAN false-accept when tokens are split across unrelated parts of the
 * transcript (e.g. "valve", "replaced", "water", "heater" scattered across
 * different sentences). For fields where that risk is material (e.g.
 * technician actions, required parts, restoration status) use
 * `isGroundedInSentence` instead, which enforces same-context grounding.
 */
export function isGroundedIn(needle: string, haystack: string): boolean {
  const needleTokens = tokenize(needle);
  if (needleTokens.length === 0) return false;
  const hayLower = haystack.toLowerCase();
  return needleTokens.every((tok) => hayLower.includes(tok));
}

/**
 * Split a transcript into atomic context segments for same-context grounding.
 *
 * Splits on sentence terminators, newlines, semicolons, and commas. This
 * is deliberately strict: technicians routinely enumerate facts separated
 * by commas ("LP valve open, fuse blown, fuse replaced") and those must
 * remain isolated from each other for grounding purposes.
 */
function splitTranscriptSegments(haystack: string): string[] {
  return haystack
    .split(/[.!?;,\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Stricter grounding: every token of the needle must appear in the SAME
 * segment of the transcript. Single-token needles fall back to a regular
 * whole-haystack check since a lone word cannot be "split across context".
 *
 * This rejects split-token hallucinations such as proposing
 *   "replaced water heater valve"
 * against a transcript that separately mentions "LP valve open",
 * "fuse replaced", and "water heater now works". No single segment
 * contains all four tokens, so the phrase is rejected.
 */
export function isGroundedInSentence(needle: string, haystack: string): boolean {
  const needleTokens = tokenize(needle);
  if (needleTokens.length === 0) return false;
  if (needleTokens.length === 1) {
    return haystack.toLowerCase().includes(needleTokens[0]);
  }
  const segments = splitTranscriptSegments(haystack);
  return segments.some((segment) => {
    const segLower = segment.toLowerCase();
    return needleTokens.every((tok) => segLower.includes(tok));
  });
}

function joinTranscript(messages: string[]): string {
  return messages.join("\n").toLowerCase();
}

// ── Rejection reasons (stable string constants for observability) ───────

export const REJECT = {
  AUTHORITY_BOUNDARY_VIOLATION: "authority_boundary_violation",
  UNGROUNDED_IN_TRANSCRIPT: "ungrounded_in_transcript",
  CONTRADICTS_SERVER_STATE: "contradicts_server_state",
  MISSING_REQUIRED_FIELDS: "missing_required_fields",
  LOW_CONFIDENCE: "low_confidence",
  NOT_PROPOSED: "not_proposed",
  INVALID_SURFACE_FOR_MODE: "invalid_surface_for_mode",
} as const;

const CONFIDENCE_FLOOR = 0.5;

// ── Individual adjudicators ─────────────────────────────────────────────

export function adjudicateObjectHypothesis(
  input: AdjudicationInput,
): AdjudicatedObjectHypothesis {
  const proposal: ObjectHypothesisProposal | undefined = input.proposal.object_hypothesis;
  if (!proposal) return { accepted: false, reason: REJECT.NOT_PROPOSED };

  const confidence = proposal.confidence ?? 0;
  if (confidence < CONFIDENCE_FLOOR) {
    return { accepted: false, reason: REJECT.LOW_CONFIDENCE, confidence };
  }

  const transcript = joinTranscript(input.technicianMessages);
  const system = proposal.system;
  const equipment = proposal.equipment;

  // At least one of system/equipment must be grounded in transcript.
  const systemGrounded = !!system && isGroundedIn(system, transcript);
  const equipmentGrounded = !!equipment && isGroundedIn(equipment, transcript);
  if (!systemGrounded && !equipmentGrounded) {
    return { accepted: false, reason: REJECT.UNGROUNDED_IN_TRANSCRIPT };
  }

  return {
    accepted: true,
    system: systemGrounded ? system : undefined,
    equipment: equipmentGrounded ? equipment : undefined,
    confidence,
  };
}

export function adjudicateSubtypeLock(
  input: AdjudicationInput,
): AdjudicatedSubtypeLock {
  const proposal: SubtypeLockProposal | undefined = input.proposal.subtype_lock_proposal;
  if (!proposal || !proposal.subtype) {
    return { accepted: false, reason: REJECT.NOT_PROPOSED };
  }

  const confidence = proposal.confidence ?? 0;
  if (confidence < CONFIDENCE_FLOOR) {
    return { accepted: false, reason: REJECT.LOW_CONFIDENCE, confidence };
  }

  const transcript = joinTranscript(input.technicianMessages);

  // Subtype must be grounded in transcript directly (by name, keyword, or synonym).
  // Standard subtype synonyms so adjudication does not require exact wording.
  const subtypeLower = proposal.subtype.toLowerCase();
  const synonyms: Record<string, string[]> = {
    "gas-only": ["gas only", "gas-only", "lp only", "lp-only", "propane only", "not combo", "not a combo", "no electric"],
    "lp-only": ["lp only", "lp-only", "propane only", "gas only", "not combo", "not a combo"],
    "non-combo": ["not combo", "non-combo", "not a combo", "not a combo unit", "isn't combo", "isn't a combo", "is not combo", "is not a combo", "gas only", "lp only", "propane only"],
    "combo": ["combo"],
    "mechanical-ignition": ["mechanical ignition", "manual ignition", "pilot"],
    "electronic-ignition": ["electronic ignition", "dsi"],
  };

  const candidates = synonyms[subtypeLower] ?? [subtypeLower];
  const grounded =
    candidates.some((c) => transcript.includes(c)) ||
    isGroundedIn(proposal.subtype, transcript);

  if (!grounded) {
    return { accepted: false, reason: REJECT.UNGROUNDED_IN_TRANSCRIPT };
  }

  // Evidence strings, if provided, must each be grounded too — reject inventions.
  // Use sentence-scoped grounding so multi-word evidence phrases cannot be
  // stitched together from tokens scattered across unrelated transcript parts.
  if (proposal.evidence) {
    for (const ev of proposal.evidence) {
      if (!isGroundedInSentence(ev, transcript)) {
        return { accepted: false, reason: REJECT.UNGROUNDED_IN_TRANSCRIPT };
      }
    }
  }

  return {
    accepted: true,
    subtype: proposal.subtype,
    confidence,
  };
}

export function adjudicateSurfaceRequest(
  input: AdjudicationInput,
): AdjudicatedSurfaceRequest {
  const proposal: SurfaceRequestProposal | undefined = input.proposal.surface_request_proposal;
  if (!proposal || !proposal.requested_surface) {
    return { accepted: false, reason: REJECT.NOT_PROPOSED };
  }

  const confidence = proposal.confidence ?? 0;
  if (confidence < CONFIDENCE_FLOOR) {
    return { accepted: false, reason: REJECT.LOW_CONFIDENCE, confidence };
  }

  // Surface request must be supported by the latest user message directly.
  // This is where the LLM recognizes natural "make the report" / "write up" intent.
  const latest = input.latestUserMessage.toLowerCase();
  const surfaceKeywords: Record<RequestedSurface, string[]> = {
    diagnostic: ["diagnos", "check", "проверк", "comprob"],
    portal_cause: ["portal cause", "portal", "cause"],
    shop_final_report: [
      "final report",
      "shop report",
      "write the report",
      "make the report",
      "make report",
      "generate report",
      "write up",
      "write-up",
      "report now",
      "ready for report",
      "готов отчёт",
      "сделай отчёт",
      "informe",
      "reporte",
    ],
    authorization: ["authoriz", "aprob"],
    warranty_report: ["warranty", "warranty report", "гарантий", "гарантия"],
    estimate: ["estimate", "estimado"],
    labor_confirmation: ["labor confirm", "confirm labor"],
  };

  const kws = surfaceKeywords[proposal.requested_surface] ?? [];
  const grounded = kws.some((kw) => latest.includes(kw));
  if (!grounded) {
    return { accepted: false, reason: REJECT.UNGROUNDED_IN_TRANSCRIPT };
  }

  return {
    accepted: true,
    requestedSurface: proposal.requested_surface,
    confidence,
  };
}

/**
 * Adjudicate the report-ready candidate.
 *
 * IMPORTANT: acceptance here is NOT a mode switch. It only means the sidecar's
 * claim is grounded in transcript evidence and does not contradict server state.
 * The server still owns whether a report surface opens (see consumer in route.ts).
 */
export function adjudicateReportReadiness(
  input: AdjudicationInput,
): AdjudicatedReportReadiness {
  const proposal: ReportReadyCandidateProposal | undefined =
    input.proposal.report_ready_candidate;
  if (!proposal || proposal.is_candidate === undefined) {
    return { accepted: false, reason: REJECT.NOT_PROPOSED };
  }

  if (!proposal.is_candidate) {
    // A negative candidacy claim is accepted as-is (it does not grant any surface).
    return {
      accepted: true,
      isCandidate: false,
      confidence: proposal.confidence,
      presentFields: proposal.present_fields,
      missingFields: proposal.missing_fields,
    };
  }

  const confidence = proposal.confidence ?? 0;
  if (confidence < CONFIDENCE_FLOOR) {
    return { accepted: false, reason: REJECT.LOW_CONFIDENCE, confidence };
  }

  // A positive candidacy must supply at least one present field and at least
  // one piece of evidence grounded in the transcript.
  const presentFields = proposal.present_fields ?? [];
  if (presentFields.length === 0) {
    return { accepted: false, reason: REJECT.MISSING_REQUIRED_FIELDS };
  }

  const transcript = joinTranscript(input.technicianMessages);
  const evidenceProvided = proposal.evidence ?? [];
  if (evidenceProvided.length === 0) {
    return { accepted: false, reason: REJECT.UNGROUNDED_IN_TRANSCRIPT };
  }

  // Every piece of evidence MUST be grounded in a SINGLE transcript segment.
  // Sentence-scoped check rejects invented facts and split-token stitching.
  for (const ev of evidenceProvided) {
    if (!isGroundedInSentence(ev, transcript)) {
      return { accepted: false, reason: REJECT.UNGROUNDED_IN_TRANSCRIPT };
    }
  }

  return {
    accepted: true,
    isCandidate: true,
    confidence,
    presentFields,
    missingFields: proposal.missing_fields,
  };
}

export function adjudicateStepIssue(
  input: AdjudicationInput,
): AdjudicatedStepIssue {
  const proposal: StepIssueSignalProposal | undefined = input.proposal.step_issue_signal;
  if (!proposal || !proposal.issue) {
    return { accepted: false, reason: REJECT.NOT_PROPOSED };
  }

  const confidence = proposal.confidence ?? 0;
  if (confidence < CONFIDENCE_FLOOR) {
    return { accepted: false, reason: REJECT.LOW_CONFIDENCE, confidence };
  }

  // Step-issue proposals are only meaningful while a diagnostic step is active.
  if (!input.serverState.activeStepId || input.serverState.caseMode !== "diagnostic") {
    return { accepted: false, reason: REJECT.CONTRADICTS_SERVER_STATE };
  }

  // For `repeated_step` / `already_answered`, require corroborating server state:
  // either prior-ask count >= 2 OR the latest user message references
  // a prior answer token ("already", "told you", "cannot measure", "0 amp", "2.3 amp", etc.).
  if (
    proposal.issue === "repeated_step" ||
    proposal.issue === "already_answered"
  ) {
    const alreadyByServer = (input.serverState.priorAskCountForActiveStep ?? 0) >= 2;
    const latest = input.latestUserMessage.toLowerCase();
    const alreadyByUser = /\b(already|told you|said|same|again)\b|уже\s|cannot measure|can't measure|\b\d+(\.\d+)?\s*(a|amp|amps|v|volt|volts)\b/i.test(
      latest,
    );
    if (!alreadyByServer && !alreadyByUser) {
      return { accepted: false, reason: REJECT.CONTRADICTS_SERVER_STATE };
    }
  }

  // Evidence strings, if provided, must be grounded (sentence-scoped).
  if (proposal.evidence) {
    const transcript = joinTranscript(input.technicianMessages);
    for (const ev of proposal.evidence) {
      if (!isGroundedInSentence(ev, transcript)) {
        return { accepted: false, reason: REJECT.UNGROUNDED_IN_TRANSCRIPT };
      }
    }
  }

  return {
    accepted: true,
    issue: proposal.issue,
    confidence,
  };
}

/**
 * Adjudicate the evidence summary.
 *
 * Every non-empty field must be grounded in the technician transcript
 * using the stricter sentence-scoped grounding check. A phrase like
 * "replaced water heater valve" is rejected unless those tokens appear
 * together in a single transcript segment — preventing split-token
 * hallucinations that combine facts from unrelated parts of the transcript.
 */
export function adjudicateEvidenceSummary(
  input: AdjudicationInput,
): AdjudicatedEvidenceSummary {
  const proposal: EvidenceSummaryProposal | undefined = input.proposal.evidence_summary;
  if (!proposal) return { accepted: false, reason: REJECT.NOT_PROPOSED };

  const transcript = joinTranscript(input.technicianMessages);

  const check = (value?: string): boolean =>
    !value || isGroundedInSentence(value, transcript);

  const checkArr = (values?: string[]): boolean => {
    if (!values) return true;
    for (const v of values) {
      if (!isGroundedInSentence(v, transcript)) return false;
    }
    return true;
  };

  if (
    !check(proposal.complaint) ||
    !checkArr(proposal.confirmed_findings) ||
    !checkArr(proposal.technician_actions) ||
    !check(proposal.restoration_status) ||
    !check(proposal.labor) ||
    !checkArr(proposal.required_parts)
  ) {
    return { accepted: false, reason: REJECT.UNGROUNDED_IN_TRANSCRIPT };
  }

  return {
    accepted: true,
    complaint: proposal.complaint,
    confirmedFindings: proposal.confirmed_findings,
    technicianActions: proposal.technician_actions,
    restorationStatus: proposal.restoration_status,
    labor: proposal.labor,
    requiredParts: proposal.required_parts,
  };
}

// ── Top-level adjudication ──────────────────────────────────────────────

/**
 * Adjudicate every signal in a proposal.
 *
 * Authority boundary: this function NEVER returns a value that represents a
 * mode switch, step completion, step selection, or final output. Callers may
 * only use the adjudicated signals as advisory inputs to server-owned
 * decisions, and must re-check server state when acting on them.
 */
export function adjudicateProposal(input: AdjudicationInput): AdjudicatedSignals {
  return {
    objectHypothesis: adjudicateObjectHypothesis(input),
    subtypeLock: adjudicateSubtypeLock(input),
    surfaceRequest: adjudicateSurfaceRequest(input),
    reportReadiness: adjudicateReportReadiness(input),
    stepIssue: adjudicateStepIssue(input),
    evidenceSummary: adjudicateEvidenceSummary(input),
  };
}

// ── Authority-boundary helpers for consumers ────────────────────────────

/**
 * Returns true iff the adjudicated signals may be used to OPEN a report surface
 * under bounded server rules.
 *
 * Consumer must still be gated by:
 *   - an explicit technician report/documentation request in the latest message;
 *   - no Context Engine hard block (e.g., active-procedure + isolationComplete=false
 *     without `is_candidate` evidence).
 */
export function mayOpenReportSurface(
  signals: AdjudicatedSignals,
  serverState: AdjudicationServerState,
): { allowed: boolean; reason: string } {
  // Never open a report surface during an active procedure unless Context Engine
  // has confirmed isolation. The sidecar cannot bypass the diagnostic-flow authority.
  if (serverState.hasActiveProcedure && !serverState.isolationComplete) {
    // The only way a report surface can open pre-isolation is if the sidecar's
    // report-ready candidate is accepted AND the user explicitly requested a
    // documentation surface. Even then, we require BOTH signals to align.
    const bothAligned =
      signals.reportReadiness.accepted &&
      signals.reportReadiness.isCandidate === true &&
      signals.surfaceRequest.accepted;
    if (!bothAligned) {
      return { allowed: false, reason: "active_procedure_without_isolation" };
    }
    // Still require at least one present field to be explicitly in transcript
    // (adjudicator already enforces grounded evidence).
    return { allowed: true, reason: "sidecar_aligned_with_explicit_request" };
  }

  // No active procedure or isolation already complete — a valid surface request
  // alone is sufficient to advise the server that the user wants a report.
  if (signals.surfaceRequest.accepted) {
    return { allowed: true, reason: "surface_request_grounded_in_latest_message" };
  }

  if (
    signals.reportReadiness.accepted &&
    signals.reportReadiness.isCandidate === true
  ) {
    return { allowed: true, reason: "report_ready_candidate_grounded" };
  }

  return { allowed: false, reason: "no_surface_request_or_candidate" };
}

/**
 * Returns true iff the adjudicated subtype lock may be used to exclude
 * subtype-incompatible steps. This is an ADVISORY boolean; it does not
 * itself mutate Context Engine state.
 */
export function mayEnforceSubtypeLock(
  signals: AdjudicatedSignals,
): { allowed: boolean; subtype?: string } {
  if (!signals.subtypeLock.accepted) return { allowed: false };
  return { allowed: true, subtype: signals.subtypeLock.subtype };
}
