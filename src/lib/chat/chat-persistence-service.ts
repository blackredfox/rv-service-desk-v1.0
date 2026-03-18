import type { Language } from "@/lib/lang";
import type { CaseMode } from "@/lib/prompt-composer";
import { DEFAULT_MEMORY_WINDOW } from "@/lib/prompt-composer";
import { storage } from "@/lib/storage";
import {
  DEFAULT_CONFIG,
  clearReplanState,
  isFallbackResponse,
  isInClarificationSubflow,
  isInReplanState,
  popTopic,
  recordAgentAction,
  type ContextEngineResult,
  updateContext,
} from "@/lib/context-engine";
import { logTiming } from "@/lib/chat/logging";

/**
 * Persist the user's chat message.
 */
export async function appendUserChatMessage(args: {
  caseId: string;
  message: string;
  language: Language;
  userId?: string;
}) {
  return storage.appendMessage({
    caseId: args.caseId,
    role: "user",
    content: args.message,
    language: args.language,
    userId: args.userId,
  });
}

/**
 * Persist the assistant's chat message.
 */
export async function appendAssistantChatMessage(args: {
  caseId: string;
  content: string;
  language: Language;
  userId?: string;
}) {
  return storage.appendMessage({
    caseId: args.caseId,
    role: "assistant",
    content: args.content,
    language: args.language,
    userId: args.userId,
  });
}

/**
 * Load the bounded chat history for prompt context.
 */
export async function loadChatHistory(caseId: string) {
  const historyLoadStart = Date.now();
  const history = await storage.listMessagesForContext(
    caseId,
    DEFAULT_MEMORY_WINDOW,
  );

  logTiming("load_history", {
    caseId,
    loadHistoryMs: Date.now() - historyLoadStart,
  });

  return history;
}

/**
 * Apply diagnostic-only persistence side effects after response generation.
 */
export function finalizeDiagnosticPersistence(args: {
  caseId: string;
  mode: CaseMode;
  engineResult: ContextEngineResult | null;
  responseText: string;
}) {
  if (args.mode !== "diagnostic" || !args.engineResult) {
    return;
  }

  const actionType = isFallbackResponse(args.responseText)
    ? "fallback"
    : args.engineResult.context.submode !== "main"
      ? "clarification"
      : "question";

  recordAgentAction(
    args.caseId,
    {
      type: actionType,
      content: args.responseText.slice(0, 200),
      stepId: args.engineResult.context.activeStepId || undefined,
      submode: args.engineResult.context.submode,
    },
    DEFAULT_CONFIG,
  );

  if (isInReplanState(args.engineResult.context)) {
    updateContext(clearReplanState(args.engineResult.context));
  }

  if (isInClarificationSubflow(args.engineResult.context)) {
    updateContext(popTopic(args.engineResult.context));
  }
}