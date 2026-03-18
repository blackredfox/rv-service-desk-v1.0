import type { Language, LanguagePolicy } from "@/lib/lang";
import { composePromptV2 } from "@/lib/prompt-composer";
import { buildOpenAiMessages } from "@/lib/chat/openai-client";
import {
  buildLaborOverrideConstraints,
  buildLaborOverrideRequest,
} from "@/lib/chat/final-report-service";
import { getModelForMode } from "@/lib/chat/chat-mode-resolver";

type HistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

/**
 * Build the prompt, request, and transport body for labor override execution.
 */
export function buildLaborOverridePlan(args: {
  requestedLaborHoursText: string;
  factLockConstraint: string;
  trackedInputLanguage: Language;
  outputEffective: Language;
  langPolicy: LanguagePolicy;
  translationLanguage?: Language;
  history: HistoryMessage[];
}) {
  const overrideConstraints = buildLaborOverrideConstraints(
    args.requestedLaborHoursText,
    args.factLockConstraint,
  );

  const overridePrompt = composePromptV2({
    mode: "final_report",
    inputDetected: args.trackedInputLanguage,
    outputEffective: args.outputEffective,
    includeTranslation: args.langPolicy.includeTranslation,
    translationLanguage: args.translationLanguage,
    additionalConstraints: overrideConstraints,
  });

  const overrideRequest = buildLaborOverrideRequest(
    args.requestedLaborHoursText,
    args.langPolicy.includeTranslation,
    args.translationLanguage,
  );

  return {
    overrideConstraints,
    overridePrompt,
    overrideRequest,
    overrideBody: {
      model: getModelForMode("final_report"),
      messages: buildOpenAiMessages({
        system: overridePrompt,
        history: args.history,
        userMessage: overrideRequest,
        attachments: undefined,
      }),
    },
  };
}

/**
 * Build the retry transport body for labor override regeneration.
 */
export function buildLaborOverrideRetryBody(args: {
  overridePrompt: string;
  history: HistoryMessage[];
  overrideRequest: string;
  correctionInstruction: string;
}) {
  return {
    model: getModelForMode("final_report"),
    messages: buildOpenAiMessages({
      system: args.overridePrompt,
      history: args.history,
      userMessage: args.overrideRequest,
      attachments: undefined,
      correctionInstruction: args.correctionInstruction,
    }),
  };
}