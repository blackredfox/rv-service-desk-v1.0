/**
 * Context Engine — Public API
 * 
 * Exports the context engine for use in the chat API route.
 */

// Types
export type {
  Mode,
  ClarificationType,
  Submode,
  Intent,
  EvidenceType,
  Fact,
  FactType,
  Hypothesis,
  Contradiction,
  TopicStackEntry,
  AgentAction,
  AgentActionType,
  LaborMode,
  LaborState,
  DiagnosticContext,
  LoopCheckResult,
  ReplanResult,
  ContextEngineResult,
  ResponseInstructions,
  ContextEngineConfig,
} from "./types";

export { DEFAULT_CONFIG } from "./types";

// Main context engine functions
export {
  // Context management
  createContext,
  getOrCreateContext,
  getContext,
  updateContext,
  clearContext,
  
  // Message processing
  processMessage,
  
  // Step management
  markStepCompleted,
  markStepUnable,
  setActiveStep,
  markIsolationComplete,
  
  // Fact management
  addFact,
  
  // Agent action recording
  recordAgentAction,
  wouldViolateLoopRules,
  
  // Labor management
  setLaborDraft,
  confirmLaborHours,
  isLaborBlocking,
  
  // Mode management
  setMode,
  getMode,
} from "./context-engine";

// Intent router
export {
  detectIntent,
  describeIntent,
  isClarificationRequest,
  detectNewEvidence,
} from "./intent-router";

// Loop guard
export {
  checkLoopViolation,
  generateAntiLoopDirectives,
  isFallbackResponse,
  suggestLoopRecovery,
  updateLoopState,
} from "./loop-guard";

// Replan logic
export {
  shouldReplan,
  executeReplan,
  buildReplanNotice,
  isInReplanState,
  clearReplanState,
} from "./replan";

// Topic stack
export {
  pushTopic,
  popTopic,
  isInClarificationSubflow,
  getCurrentClarificationTopic,
  buildReturnToMainInstruction,
  buildClarificationContext,
  shouldAutoPopTopic,
} from "./topic-stack";
