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
  buildAuthoritativeStepFallback,
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

// Route decomposition services
export {
  resolveStoredCaseMode,
  resolveExplicitModeChange,
  resolveOutputSurface,
  getModelForMode,
} from "./chat-mode-resolver";

export {
  detectApprovedFinalReportIntent,
} from "./report-intent";

export {
  normalizeRoutingInput,
} from "./input-normalization";

export {
  assessRepairSummaryIntent,
  buildRepairSummaryClarificationResponse,
  type RepairSummaryIntentAssessment,
  type RepairSummaryMissingField,
} from "./repair-summary-intent";

export {
  classifyStepGuidanceIntent,
  type StepGuidanceIntentCategory,
} from "./step-guidance-intent";

export {
  parseChatRequest,
  prepareAttachmentBundle,
  resolveLanguageContext,
  ensureChatCase,
  type ChatBodyV2,
} from "./chat-request-preparer";

export {
  buildAdditionalConstraints,
  buildChatSystemPrompt,
} from "./prompt-context-builder";

export {
  validatePrimaryResponse,
  buildPrimaryCorrectionInstruction,
  buildPrimaryFallbackResponse,
  validateLaborOverrideResponse,
  buildLaborOverrideRetryInstruction,
  type ValidationResult,
  type ActiveStepMetadata,
} from "./response-validation-service";

export {
  buildLaborOverridePlan,
  buildLaborOverrideRetryBody,
} from "./final-report-flow-service";

export {
  executePrimaryChatCompletion,
  executeLaborOverrideCompletion,
  type PrimaryChatExecutionResult,
} from "./openai-execution-service";

export {
  appendUserChatMessage,
  appendAssistantChatMessage,
  loadChatHistory,
  finalizeDiagnosticPersistence,
} from "./chat-persistence-service";

// Logging
export { logTiming, logFlow } from "./logging";

// LLM Runtime Signals (feature-flagged advisory layer — sidecar is advisory only)
export {
  parseSidecarProposal,
  normalizeSidecarProposal,
  extractSidecarJson,
  type LlmRuntimeSignalProposal,
  type ObjectHypothesisProposal,
  type SubtypeLockProposal,
  type SurfaceRequestProposal,
  type ReportReadyCandidateProposal,
  type StepIssueSignalProposal,
  type EvidenceSummaryProposal,
  type RequestedSurface,
  type StepIssue,
} from "./llm-runtime-signal-schema";

export {
  adjudicateProposal,
  adjudicateObjectHypothesis,
  adjudicateSubtypeLock,
  adjudicateSurfaceRequest,
  adjudicateReportReadiness,
  adjudicateStepIssue,
  adjudicateEvidenceSummary,
  isGroundedIn,
  isGroundedInSentence,
  mayOpenReportSurface,
  mayEnforceSubtypeLock,
  REJECT,
  type AdjudicationInput,
  type AdjudicationServerState,
  type AdjudicatedSignals,
} from "./llm-runtime-signal-policy";

export {
  tryAdjudicateRuntimeSignals,
  isLlmRuntimeSignalsEnabled,
  isSidecarClientInputAllowed,
  buildAdjudicationDebug,
  LLM_RUNTIME_SIGNALS_FLAG_ENV,
  LLM_RUNTIME_SIGNALS_DEV_CLIENT_INPUT_ENV,
  type AdjudicateRuntimeSignalsInput,
  type AdjudicateRuntimeSignalsResult,
} from "./llm-runtime-signals";

// Server-side sidecar producer (internal, non-streaming). The raw output of
// this producer is NEVER forwarded to the client SSE stream; it is only
// fed into `tryAdjudicateRuntimeSignals` for server-side consumption.
export {
  produceRuntimeSignalProposal,
  type ProduceRuntimeSignalProposalInput,
  type ProduceRuntimeSignalProposalResult,
} from "./llm-runtime-signal-producer";
