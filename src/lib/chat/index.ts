/**
 * Chat module exports.
 *
 * This module provides extracted helpers for the chat API route.
 * All exports are pure utilities — they do NOT own flow control or diagnostic authority.
 */

// SSE encoding
export { sseEncode, SseEvents, type SseEventType } from "./sse";

// OpenAI client
export {
  callOpenAI,
  buildOpenAiMessages,
  extractOpenAiChunkContent,
  type OpenAiMessage,
  type OpenAiMessageContent,
  type OpenAiCallResult,
} from "./openai-client";

// Attachment validation
export {
  validateAttachments,
  filterValidAttachments,
  buildVisionInstruction,
  type Attachment,
  type AttachmentValidationResult,
} from "./attachment-validator";

// Labor override
export {
  parseRequestedLaborHours,
  detectLaborOverrideIntent,
  looksLikeFinalReport,
  shouldTreatAsFinalReportForOverride,
  computeLaborOverrideRequest,
  normalizeLaborHours,
  formatLaborHours,
  escapeRegExp,
  hasCanonicalTotalLaborLine,
} from "./labor-override";

// Output policy
export {
  TRANSLATION_SEPARATOR,
  enforceLanguagePolicy,
  extractPrimaryReportBlock,
  buildFinalReportFallback,
  DIAGNOSTIC_MODE_GUARD_VIOLATION,
  ISOLATION_DECLARATION_VIOLATION,
  isDiagnosticDriftViolation,
  applyDiagnosticModeValidationGuard,
  buildDiagnosticDriftCorrectionInstruction,
  buildDiagnosticDriftFallback,
} from "./output-policy";

// Final report service
export {
  buildTranslationInstruction,
  buildFinalReportRequest,
  buildTransitionConstraints,
  buildLaborOverrideConstraints,
  buildLaborOverrideRequest,
  buildLaborOverrideCorrectionInstruction,
  buildFinalReportCorrectionInstruction,
} from "./final-report-service";

// Logging
export { logTiming, logFlow } from "./logging";
