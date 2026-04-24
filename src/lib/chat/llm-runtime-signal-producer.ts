/**
 * LLM Runtime Signal — server-side Producer.
 *
 * Authority contract (CRITICAL):
 *   - LLM proposes. Server adjudicates. Context Engine remains authoritative.
 *
 * Safety contract (CRITICAL):
 *   - The producer runs an internal, non-streaming LLM call and returns raw
 *     text. It MUST NOT be wired to any user-visible token emitter. Callers
 *     in the chat route do NOT pass a streaming callback, so no produced
 *     token ever reaches the client SSE stream.
 *   - The producer uses the existing OpenAI client / provider / keys /
 *     model. It introduces no new provider path and no new key handling.
 *   - It is fail-closed: any error, timeout, upstream failure, or empty
 *     response yields an empty string. The route then continues exactly
 *     as if no sidecar proposal was available.
 *
 * The output of this producer is intended to be passed as-is to
 * `tryAdjudicateRuntimeSignals` (already merged) which validates, grounds,
 * and adjudicates the proposal before any server-side consumption.
 */

import { callOpenAI, buildOpenAiMessages } from "./openai-client";
import type { CaseMode } from "@/lib/prompt-composer";

// Bounded timeout for the sidecar call. The sidecar is an optional hint; it
// must NEVER stall the primary user-facing response path. 2s is generous
// for a bounded JSON completion on any existing model.
const SIDECAR_TIMEOUT_MS = 2000;

/**
 * Sentinel used by the prompt and by the fail-closed parser
 * (see llm-runtime-signal-schema.ts -> extractSidecarJson).
 */
const SENTINEL_OPEN = "<<<RVSD_SIDECAR_JSON>>>";
const SENTINEL_CLOSE = "<<<END>>>";

/**
 * Build the system prompt for a single internal sidecar-proposal call.
 *
 * The prompt is intentionally narrow. It forbids any prose output, asks
 * ONLY for a sentinel-wrapped JSON object, and reminds the LLM of the
 * authority contract so it does not propose illegal signals. Even if it
 * did, the server would still reject them in the adjudication layer.
 */
function buildSidecarSystemPrompt(): string {
  return [
    "You are an internal, non-user-visible sidecar analyzer for an RV service",
    "desk runtime. Your sole job is to OBSERVE the technician's latest input",
    "and transcript, then emit a single JSON object describing structured",
    "interpretation signals for the server to adjudicate.",
    "",
    "AUTHORITY BOUNDARIES (hard):",
    "- You MUST NOT switch modes.",
    "- You MUST NOT mark diagnostics complete.",
    "- You MUST NOT select or advance the next diagnostic step.",
    "- You MUST NOT generate a final report.",
    "- You MUST NOT mutate Context Engine state.",
    "- You MUST NOT invent facts not present in the transcript.",
    "- You propose; the server validates and adjudicates.",
    "",
    "OUTPUT FORMAT (mandatory, exact):",
    `Wrap the JSON object between the sentinels ${SENTINEL_OPEN} and ${SENTINEL_CLOSE}.`,
    "Emit NOTHING else. No prose, no commentary, no markdown fences.",
    "",
    "SCHEMA (all fields optional; omit any field you cannot ground in transcript):",
    "{",
    '  "object_hypothesis": { "system": string, "equipment": string, "confidence": number, "evidence": string[] },',
    '  "subtype_lock_proposal": { "subtype": string, "confidence": number, "evidence": string[] },',
    '  "surface_request_proposal": { "requested_surface": "diagnostic"|"portal_cause"|"shop_final_report"|"authorization"|"warranty_report"|"estimate"|"labor_confirmation", "confidence": number, "evidence": string[] },',
    '  "report_ready_candidate": { "is_candidate": boolean, "confidence": number, "present_fields": string[], "missing_fields": string[], "evidence": string[] },',
    '  "step_issue_signal": { "issue": "repeated_step"|"irrelevant_step"|"already_answered"|"conflicting_step"|"subtype_incompatible_step", "confidence": number, "evidence": string[] },',
    '  "evidence_summary": { "complaint": string, "confirmed_findings": string[], "technician_actions": string[], "restoration_status": string, "labor": string, "required_parts": string[], "unknowns": string[], "conflicts": string[] }',
    "}",
    "",
    "GROUNDING RULES:",
    "- Every evidence item must quote/paraphrase text actually present in the transcript.",
    "- Use confidence in [0, 1]. Prefer 0.8+ only when the signal is unambiguous in the transcript.",
    "- Omit any field you are not confident is grounded.",
    "- If nothing material is observable, emit an empty object: {}.",
  ].join("\n");
}

/**
 * Build the user turn for the sidecar call. The user turn gives the LLM
 * the transcript and the latest technician utterance, clearly labeled.
 */
function buildSidecarUserMessage(args: {
  latestUserMessage: string;
  technicianMessages: string[];
}): string {
  const priorMessages = args.technicianMessages.slice(0, -1); // exclude the latest which is shown separately
  const priorBlock =
    priorMessages.length > 0
      ? priorMessages.map((m, i) => `[T${i + 1}] ${m}`).join("\n")
      : "(no prior technician messages)";

  return [
    "PRIOR TECHNICIAN MESSAGES:",
    priorBlock,
    "",
    "LATEST TECHNICIAN MESSAGE:",
    args.latestUserMessage,
    "",
    "Emit the single sentinel-wrapped JSON object now.",
  ].join("\n");
}

export type ProduceRuntimeSignalProposalInput = {
  apiKey: string;
  mode: CaseMode;
  model: string;
  latestUserMessage: string;
  /**
   * Full technician message history (chronological). The last entry is the
   * latest and will be highlighted in the user turn; prior entries are
   * provided as context for grounding.
   */
  technicianMessages: string[];
  /**
   * Upstream abort signal (e.g. from `req.signal`). When this aborts, the
   * sidecar call is aborted too. The sidecar NEVER extends the user-visible
   * request lifetime.
   */
  upstreamSignal?: AbortSignal;
  /** Optional override for the internal timeout; defaults to 2000ms. */
  timeoutMs?: number;
};

export type ProduceRuntimeSignalProposalResult = {
  /** Raw text emitted by the LLM. Empty string on any failure. */
  rawProposal: string;
  /** Upstream error or timeout reason, for observability only. */
  error?: string;
};

/**
 * Run a single internal, non-streaming LLM call to obtain a raw sidecar
 * proposal.
 *
 * NON-STREAMING GUARANTEE:
 *   This function calls `callOpenAI` WITHOUT an `onToken` callback. No
 *   produced token ever reaches the client SSE stream. Callers MUST NOT
 *   wire the returned raw string to `emitToken`.
 *
 * Fail-closed: returns `{ rawProposal: "" }` on any error. The route then
 * continues with existing safe behavior.
 */
export async function produceRuntimeSignalProposal(
  input: ProduceRuntimeSignalProposalInput,
): Promise<ProduceRuntimeSignalProposalResult> {
  if (!input.apiKey) return { rawProposal: "", error: "no_api_key" };

  const system = buildSidecarSystemPrompt();
  const userMessage = buildSidecarUserMessage({
    latestUserMessage: input.latestUserMessage,
    technicianMessages: input.technicianMessages,
  });

  const body = {
    model: input.model,
    messages: buildOpenAiMessages({
      system,
      history: [],
      userMessage,
    }),
  };

  const ac = new AbortController();
  const timeoutMs = input.timeoutMs ?? SIDECAR_TIMEOUT_MS;
  const timer = setTimeout(() => {
    try { ac.abort(); } catch { /* ignore */ }
  }, timeoutMs);

  const onUpstreamAbort = () => {
    try { ac.abort(); } catch { /* ignore */ }
  };
  if (input.upstreamSignal) {
    if (input.upstreamSignal.aborted) {
      clearTimeout(timer);
      return { rawProposal: "", error: "aborted_before_start" };
    }
    input.upstreamSignal.addEventListener("abort", onUpstreamAbort, { once: true });
  }

  try {
    // CRITICAL: no onToken is passed — tokens never reach the user stream.
    const result = await callOpenAI(input.apiKey, body, ac.signal);

    if (result.error) {
      return { rawProposal: "", error: result.error };
    }

    const raw = (result.response ?? "").trim();
    if (!raw) return { rawProposal: "", error: "empty_response" };

    return { rawProposal: raw };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown_error";
    return { rawProposal: "", error: msg };
  } finally {
    clearTimeout(timer);
    if (input.upstreamSignal) {
      input.upstreamSignal.removeEventListener("abort", onUpstreamAbort);
    }
  }
}

/**
 * Exported for tests only: same-shape sentinel constants the prompt uses.
 */
export const __producerInternals = {
  SENTINEL_OPEN,
  SENTINEL_CLOSE,
  SIDECAR_TIMEOUT_MS,
  buildSidecarSystemPrompt,
  buildSidecarUserMessage,
};
