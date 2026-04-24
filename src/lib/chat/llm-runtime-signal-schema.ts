/**
 * LLM Runtime Signal — Schema & Parser.
 *
 * Authority contract (CRITICAL):
 *   - The LLM sidecar MAY propose interpretation signals.
 *   - The server MUST adjudicate them (see llm-runtime-signal-policy.ts).
 *   - The Context Engine remains the single diagnostic-flow authority.
 *
 * This module owns ONLY shape validation and safe parsing of raw proposals.
 * It performs NO grounding, NO authority decisions, and NO state changes.
 *
 * Parser is fail-closed: malformed / partial / injected input yields `null`
 * without throwing. Callers must treat a `null` parse as "no sidecar signal".
 */
export type RequestedSurface =
  | "diagnostic"
  | "portal_cause"
  | "shop_final_report"
  | "authorization"
  | "warranty_report"
  | "estimate"
  | "labor_confirmation";

export type StepIssue =
  | "repeated_step"
  | "irrelevant_step"
  | "already_answered"
  | "conflicting_step"
  | "subtype_incompatible_step";

export type ObjectHypothesisProposal = {
  system?: string;
  equipment?: string;
  confidence?: number;
  evidence?: string[];
};

export type SubtypeLockProposal = {
  subtype?: string;
  confidence?: number;
  evidence?: string[];
};

export type SurfaceRequestProposal = {
  requested_surface?: RequestedSurface;
  confidence?: number;
  evidence?: string[];
};

export type ReportReadyCandidateProposal = {
  is_candidate?: boolean;
  confidence?: number;
  present_fields?: string[];
  missing_fields?: string[];
  evidence?: string[];
};

export type StepIssueSignalProposal = {
  issue?: StepIssue;
  confidence?: number;
  evidence?: string[];
};

export type EvidenceSummaryProposal = {
  complaint?: string;
  confirmed_findings?: string[];
  technician_actions?: string[];
  restoration_status?: string;
  labor?: string;
  required_parts?: string[];
  unknowns?: string[];
  conflicts?: string[];
};

export type LlmRuntimeSignalProposal = {
  object_hypothesis?: ObjectHypothesisProposal;
  subtype_lock_proposal?: SubtypeLockProposal;
  surface_request_proposal?: SurfaceRequestProposal;
  report_ready_candidate?: ReportReadyCandidateProposal;
  step_issue_signal?: StepIssueSignalProposal;
  evidence_summary?: EvidenceSummaryProposal;
};

const VALID_SURFACES: ReadonlySet<RequestedSurface> = new Set<RequestedSurface>([
  "diagnostic",
  "portal_cause",
  "shop_final_report",
  "authorization",
  "warranty_report",
  "estimate",
  "labor_confirmation",
]);

const VALID_STEP_ISSUES: ReadonlySet<StepIssue> = new Set<StepIssue>([
  "repeated_step",
  "irrelevant_step",
  "already_answered",
  "conflicting_step",
  "subtype_incompatible_step",
]);

// Hard cap on individual string/array sizes to limit memory and prevent
// pathological payloads (e.g. prompt-injection walls). 4 KB per string is
// generous for evidence snippets while still bounding the proposal.
const MAX_STRING_LEN = 4000;
const MAX_ARRAY_LEN = 32;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_STRING_LEN);
}

function coerceStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    const s = coerceString(item);
    if (s) out.push(s);
    if (out.length >= MAX_ARRAY_LEN) break;
  }
  return out.length > 0 ? out : undefined;
}

function coerceConfidence(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value !== "boolean") return undefined;
  return value;
}

/**
 * Extract a JSON object from a raw string safely.
 *
 * Accepts:
 *  - a bare JSON object ("{...}")
 *  - a fenced block (```json ... ```)
 *  - a sentinel-wrapped block (<<<RVSD_SIDECAR_JSON>>> ... <<<END>>>)
 *  - raw LLM output that contains a JSON object anywhere (takes first top-level)
 *
 * Returns `null` on any failure. Never throws.
 */
export function extractSidecarJson(raw: string): unknown {
  if (typeof raw !== "string") return null;
  if (raw.length === 0) return null;

  // 1) Sentinel-wrapped block wins.
  const sentinelMatch = /<<<RVSD_SIDECAR_JSON>>>([\s\S]*?)<<<END>>>/.exec(raw);
  if (sentinelMatch) {
    return safeJsonParse(sentinelMatch[1]);
  }

  // 2) Fenced code block.
  const fencedMatch = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  if (fencedMatch) {
    const parsed = safeJsonParse(fencedMatch[1]);
    if (parsed) return parsed;
  }

  // 3) First balanced top-level JSON object in the string.
  const firstBrace = raw.indexOf("{");
  if (firstBrace < 0) return null;

  // Find matching closing brace via naive scan with string/escape awareness.
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = firstBrace; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return safeJsonParse(raw.slice(firstBrace, i + 1));
      }
    }
  }

  return null;
}

function safeJsonParse(input: string): unknown {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/**
 * Validate and normalize a raw parsed value into a `LlmRuntimeSignalProposal`.
 *
 * Unknown / malformed / illegally-typed fields are silently dropped.
 * If the resulting proposal is empty, returns `null` (fail-closed).
 */
export function normalizeSidecarProposal(raw: unknown): LlmRuntimeSignalProposal | null {
  if (!isPlainObject(raw)) return null;

  const proposal: LlmRuntimeSignalProposal = {};

  const oh = raw.object_hypothesis;
  if (isPlainObject(oh)) {
    const norm: ObjectHypothesisProposal = {};
    const system = coerceString(oh.system);
    if (system) norm.system = system;
    const equipment = coerceString(oh.equipment);
    if (equipment) norm.equipment = equipment;
    const confidence = coerceConfidence(oh.confidence);
    if (confidence !== undefined) norm.confidence = confidence;
    const evidence = coerceStringArray(oh.evidence);
    if (evidence) norm.evidence = evidence;
    if (Object.keys(norm).length > 0) proposal.object_hypothesis = norm;
  }

  const stl = raw.subtype_lock_proposal;
  if (isPlainObject(stl)) {
    const norm: SubtypeLockProposal = {};
    const subtype = coerceString(stl.subtype);
    if (subtype) norm.subtype = subtype;
    const confidence = coerceConfidence(stl.confidence);
    if (confidence !== undefined) norm.confidence = confidence;
    const evidence = coerceStringArray(stl.evidence);
    if (evidence) norm.evidence = evidence;
    if (Object.keys(norm).length > 0) proposal.subtype_lock_proposal = norm;
  }

  const srp = raw.surface_request_proposal;
  if (isPlainObject(srp)) {
    const norm: SurfaceRequestProposal = {};
    const requestedSurface = coerceString(srp.requested_surface);
    if (requestedSurface && VALID_SURFACES.has(requestedSurface as RequestedSurface)) {
      norm.requested_surface = requestedSurface as RequestedSurface;
    }
    const confidence = coerceConfidence(srp.confidence);
    if (confidence !== undefined) norm.confidence = confidence;
    const evidence = coerceStringArray(srp.evidence);
    if (evidence) norm.evidence = evidence;
    if (Object.keys(norm).length > 0) proposal.surface_request_proposal = norm;
  }

  const rrc = raw.report_ready_candidate;
  if (isPlainObject(rrc)) {
    const norm: ReportReadyCandidateProposal = {};
    const isCandidate = coerceBoolean(rrc.is_candidate);
    if (isCandidate !== undefined) norm.is_candidate = isCandidate;
    const confidence = coerceConfidence(rrc.confidence);
    if (confidence !== undefined) norm.confidence = confidence;
    const presentFields = coerceStringArray(rrc.present_fields);
    if (presentFields) norm.present_fields = presentFields;
    const missingFields = coerceStringArray(rrc.missing_fields);
    if (missingFields) norm.missing_fields = missingFields;
    const evidence = coerceStringArray(rrc.evidence);
    if (evidence) norm.evidence = evidence;
    if (Object.keys(norm).length > 0) proposal.report_ready_candidate = norm;
  }

  const sis = raw.step_issue_signal;
  if (isPlainObject(sis)) {
    const norm: StepIssueSignalProposal = {};
    const issue = coerceString(sis.issue);
    if (issue && VALID_STEP_ISSUES.has(issue as StepIssue)) {
      norm.issue = issue as StepIssue;
    }
    const confidence = coerceConfidence(sis.confidence);
    if (confidence !== undefined) norm.confidence = confidence;
    const evidence = coerceStringArray(sis.evidence);
    if (evidence) norm.evidence = evidence;
    if (Object.keys(norm).length > 0) proposal.step_issue_signal = norm;
  }

  const es = raw.evidence_summary;
  if (isPlainObject(es)) {
    const norm: EvidenceSummaryProposal = {};
    const complaint = coerceString(es.complaint);
    if (complaint) norm.complaint = complaint;
    const confirmedFindings = coerceStringArray(es.confirmed_findings);
    if (confirmedFindings) norm.confirmed_findings = confirmedFindings;
    const technicianActions = coerceStringArray(es.technician_actions);
    if (technicianActions) norm.technician_actions = technicianActions;
    const restorationStatus = coerceString(es.restoration_status);
    if (restorationStatus) norm.restoration_status = restorationStatus;
    const labor = coerceString(es.labor);
    if (labor) norm.labor = labor;
    const requiredParts = coerceStringArray(es.required_parts);
    if (requiredParts) norm.required_parts = requiredParts;
    const unknowns = coerceStringArray(es.unknowns);
    if (unknowns) norm.unknowns = unknowns;
    const conflicts = coerceStringArray(es.conflicts);
    if (conflicts) norm.conflicts = conflicts;
    if (Object.keys(norm).length > 0) proposal.evidence_summary = norm;
  }

  return Object.keys(proposal).length > 0 ? proposal : null;
}

/**
 * Parse a raw LLM output (or embedded JSON block) into a normalized proposal.
 * Fail-closed: returns `null` if parsing or normalization fails.
 */
export function parseSidecarProposal(raw: string): LlmRuntimeSignalProposal | null {
  const extracted = extractSidecarJson(raw);
  if (extracted === null) return null;
  return normalizeSidecarProposal(extracted);
}
