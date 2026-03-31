import type { Language, LanguagePolicy } from "@/lib/lang";
import type { CaseMode } from "@/lib/prompt-composer";
import { logValidation } from "@/lib/mode-validators";
import {
  buildOpenAiMessages,
  callOpenAI,
} from "@/lib/chat/openai-client";
import {
  buildFinalReportFallback,
  enforceLanguagePolicy,
} from "@/lib/chat/output-policy";
import {
  buildLaborOverridePlan,
  buildLaborOverrideRetryBody,
} from "@/lib/chat/final-report-flow-service";
import {
  ActiveStepMetadata,
  ValidationResult,
  buildLaborOverrideRetryInstruction,
  buildPrimaryCorrectionInstruction,
  buildPrimaryFallbackResponse,
  validateLaborOverrideResponse,
  validatePrimaryResponse,
} from "@/lib/chat/response-validation-service";
import { logFlow, logTiming } from "@/lib/chat/logging";

type HistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

type TokenEmitter = (token: string) => void;

export type PrimaryChatExecutionResult = {
  response: string;
  validation: ValidationResult;
  emittedValidationFallback: boolean;
  upstreamError?: string;
};

/**
 * Execute the main OpenAI path with validation, retry, and safe fallback handling.
 */
export async function executePrimaryChatCompletion(args: {
  apiKey: string;
  caseId: string;
  mode: CaseMode;
  systemPrompt: string;
  history: HistoryMessage[];
  message: string;
  attachments?: Array<{ type: "image"; dataUrl: string }>;
  signal: AbortSignal;
  emitToken: TokenEmitter;
  isAborted: () => boolean;
  trackedInputLanguage: Language;
  outputLanguage: Language;
  langPolicy: LanguagePolicy;
  translationLanguage?: Language;
  activeStepMetadata: ActiveStepMetadata;
  activeStepId?: string;
  model: string;
  requestStartedAt: number;
}): Promise<PrimaryChatExecutionResult> {
  const openAiBody = {
    model: args.model,
    messages: buildOpenAiMessages({
      system: args.systemPrompt,
      history: args.history,
      userMessage: args.message,
      attachments: args.attachments,
    }),
  };

  const primaryFirstStart = Date.now();
  let result = await callOpenAI(
    args.apiKey,
    openAiBody,
    args.signal,
    args.emitToken,
  );

  logTiming("openai_call", {
    caseId: args.caseId,
    mode: args.mode,
    path: "primary_first",
    openAiStartMs: primaryFirstStart - args.requestStartedAt,
    openAiMs: result.durationMs,
    openAiFirstTokenMs: result.firstTokenMs,
  });

  if (result.error) {
    return {
      response: "",
      validation: { valid: false, violations: [] },
      emittedValidationFallback: false,
      upstreamError: result.error,
    };
  }

  logFlow("validation_post_stream", {
    caseId: args.caseId,
    mode: args.mode,
    path: "primary_first",
    openAiFirstTokenMs: result.firstTokenMs,
    responseChars: result.response.length,
  });

  const validateStart = Date.now();
  let validation = validatePrimaryResponse({
    response: result.response,
    mode: args.mode,
    trackedInputLanguage: args.trackedInputLanguage,
    outputLanguage: args.outputLanguage,
    includeTranslation: args.langPolicy.includeTranslation,
    translationLanguage: args.translationLanguage,
    activeStepMetadata: args.activeStepMetadata,
  });

  logValidation(validation, { caseId: args.caseId, mode: args.mode });
  logTiming("validate_output", {
    caseId: args.caseId,
    mode: args.mode,
    path: "primary_first",
    validateMs: Date.now() - validateStart,
  });

  if (!validation.valid && !args.isAborted()) {
    logFlow("validation_failed", {
      caseId: args.caseId,
      mode: args.mode,
      path: "primary_first",
      violations: validation.violations.length,
    });

    args.emitToken("\n\n[System] Repairing output...\n\n");

    const correctionInstruction = buildPrimaryCorrectionInstruction({
      validation,
      activeStepMetadata: args.activeStepMetadata,
      activeStepId: args.activeStepId,
    });

    const retryBody = {
      ...openAiBody,
      messages: buildOpenAiMessages({
        system: args.systemPrompt,
        history: args.history,
        userMessage: args.message,
        attachments: args.attachments,
        correctionInstruction,
      }),
    };

    logFlow("retry_triggered", {
      caseId: args.caseId,
      mode: args.mode,
      path: "primary_retry",
    });

    const primaryRetryStart = Date.now();
    result = await callOpenAI(
      args.apiKey,
      retryBody,
      args.signal,
      args.emitToken,
    );

    logTiming("openai_call", {
      caseId: args.caseId,
      mode: args.mode,
      path: "primary_retry",
      openAiStartMs: primaryRetryStart - args.requestStartedAt,
      openAiMs: result.durationMs,
      openAiFirstTokenMs: result.firstTokenMs,
    });

    if (!result.error) {
      const retryValidateStart = Date.now();
      validation = validatePrimaryResponse({
        response: result.response,
        mode: args.mode,
        trackedInputLanguage: args.trackedInputLanguage,
        outputLanguage: args.outputLanguage,
        includeTranslation: args.langPolicy.includeTranslation,
        translationLanguage: args.translationLanguage,
        activeStepMetadata: args.activeStepMetadata,
      });

      logValidation(validation, { caseId: args.caseId, mode: args.mode });
      logTiming("validate_output", {
        caseId: args.caseId,
        mode: args.mode,
        path: "primary_retry",
        validateMs: Date.now() - retryValidateStart,
      });
    }

    if (!validation.valid || result.error) {
      logFlow("safe_fallback_used", {
        caseId: args.caseId,
        mode: args.mode,
        path: "primary_retry",
        reason: result.error
          ? "upstream_error_on_retry"
          : "validation_after_retry_failed",
      });

      const fallbackResponse = buildPrimaryFallbackResponse({
        validation,
        mode: args.mode,
        outputLanguage: args.outputLanguage,
        langPolicy: args.langPolicy,
        translationLanguage: args.translationLanguage,
        activeStepMetadata: args.activeStepMetadata,
        activeStepId: args.activeStepId,
      });

      args.emitToken(fallbackResponse);

      return {
        response: fallbackResponse,
        validation,
        emittedValidationFallback: true,
      };
    }
  }

  return {
    response: enforceLanguagePolicy(result.response, args.langPolicy),
    validation,
    emittedValidationFallback: false,
  };
}

/**
 * Execute the labor override path with validation, retry, and safe fallback handling.
 */
export async function executeLaborOverrideCompletion(args: {
  apiKey: string;
  caseId: string;
  factLockConstraint: string;
  trackedInputLanguage: Language;
  outputLanguage: Language;
  langPolicy: LanguagePolicy;
  translationLanguage?: Language;
  history: HistoryMessage[];
  requestedLaborHours: number;
  requestedLaborHoursText: string;
  signal: AbortSignal;
  emitToken: TokenEmitter;
  isAborted: () => boolean;
  requestStartedAt: number;
}): Promise<{ response: string }> {
  const overrideComposeStart = Date.now();
  const plan = buildLaborOverridePlan({
    requestedLaborHoursText: args.requestedLaborHoursText,
    factLockConstraint: args.factLockConstraint,
    trackedInputLanguage: args.trackedInputLanguage,
    outputEffective: args.outputLanguage,
    langPolicy: args.langPolicy,
    translationLanguage: args.translationLanguage,
    history: args.history,
  });

  logTiming("compose_prompt", {
    caseId: args.caseId,
    mode: "final_report",
    path: "labor_override",
    composePromptMs: Date.now() - overrideComposeStart,
  });

  const overrideFirstStart = Date.now();
  let overrideResult = await callOpenAI(
    args.apiKey,
    plan.overrideBody,
    args.signal,
    args.emitToken,
  );

  logTiming("openai_call", {
    caseId: args.caseId,
    mode: "final_report",
    path: "labor_override_first",
    openAiStartMs: overrideFirstStart - args.requestStartedAt,
    openAiMs: overrideResult.durationMs,
    openAiFirstTokenMs: overrideResult.firstTokenMs,
  });

  let overrideContent = overrideResult.response;

  if (!overrideResult.error && overrideContent.trim()) {
    logFlow("validation_post_stream", {
      caseId: args.caseId,
      mode: "final_report",
      path: "labor_override_first",
      openAiFirstTokenMs: overrideResult.firstTokenMs,
      responseChars: overrideContent.length,
    });

    const validateStart = Date.now();
    let validation = validateLaborOverrideResponse({
      response: overrideContent,
      requestedLaborHours: args.requestedLaborHours,
      requestedLaborHoursText: args.requestedLaborHoursText,
      includeTranslation: args.langPolicy.includeTranslation,
      translationLanguage: args.translationLanguage,
    });

    logValidation(validation.modeValidation, {
      caseId: args.caseId,
      mode: "final_report",
    });
    logTiming("validate_output", {
      caseId: args.caseId,
      mode: "final_report",
      path: "labor_override_first",
      validateMs: Date.now() - validateStart,
    });

    if (
      (!validation.modeValidation.valid || !validation.laborValidation.valid) &&
      !args.isAborted()
    ) {
      logFlow("validation_failed", {
        caseId: args.caseId,
        mode: "final_report",
        path: "labor_override_first",
        violations:
          validation.modeValidation.violations.length +
          validation.laborValidation.violations.length,
      });

      args.emitToken("\n\n[System] Repairing output...\n\n");

      const correctionInstruction = buildLaborOverrideRetryInstruction({
        modeViolations: validation.modeValidation.violations,
        laborViolations: validation.laborValidation.violations,
        requestedLaborHoursText: args.requestedLaborHoursText,
      });

      const retryBody = buildLaborOverrideRetryBody({
        overridePrompt: plan.overridePrompt,
        history: args.history,
        overrideRequest: plan.overrideRequest,
        correctionInstruction,
      });

      logFlow("retry_triggered", {
        caseId: args.caseId,
        mode: "final_report",
        path: "labor_override_retry",
      });

      const overrideRetryStart = Date.now();
      overrideResult = await callOpenAI(
        args.apiKey,
        retryBody,
        args.signal,
        args.emitToken,
      );

      logTiming("openai_call", {
        caseId: args.caseId,
        mode: "final_report",
        path: "labor_override_retry",
        openAiStartMs: overrideRetryStart - args.requestStartedAt,
        openAiMs: overrideResult.durationMs,
        openAiFirstTokenMs: overrideResult.firstTokenMs,
      });

      if (!overrideResult.error) {
        overrideContent = overrideResult.response;
        const retryValidateStart = Date.now();
        validation = validateLaborOverrideResponse({
          response: overrideContent,
          requestedLaborHours: args.requestedLaborHours,
          requestedLaborHoursText: args.requestedLaborHoursText,
          includeTranslation: args.langPolicy.includeTranslation,
          translationLanguage: args.translationLanguage,
        });

        logValidation(validation.modeValidation, {
          caseId: args.caseId,
          mode: "final_report",
        });
        logTiming("validate_output", {
          caseId: args.caseId,
          mode: "final_report",
          path: "labor_override_retry",
          validateMs: Date.now() - retryValidateStart,
        });
      }
    }

    overrideContent = enforceLanguagePolicy(overrideContent, args.langPolicy);

    const postValidateStart = Date.now();
    const postValidation = validateLaborOverrideResponse({
      response: overrideContent,
      requestedLaborHours: args.requestedLaborHours,
      requestedLaborHoursText: args.requestedLaborHoursText,
      includeTranslation: args.langPolicy.includeTranslation,
      translationLanguage: args.translationLanguage,
    });

    logTiming("validate_output", {
      caseId: args.caseId,
      mode: "final_report",
      path: "labor_override_post",
      validateMs: Date.now() - postValidateStart,
    });

    if (!postValidation.modeValidation.valid || !postValidation.laborValidation.valid) {
      logFlow("safe_fallback_used", {
        caseId: args.caseId,
        mode: "final_report",
        path: "labor_override_post",
        reason: "validation_after_retry_failed",
      });

      const fallback = buildFinalReportFallback({
        policy: args.langPolicy,
        translationLanguage: args.translationLanguage,
        laborHours: args.requestedLaborHours,
      });

      args.emitToken(fallback);
      return { response: fallback };
    }

    return { response: overrideContent };
  }

  logFlow("safe_fallback_used", {
    caseId: args.caseId,
    mode: "final_report",
    path: "labor_override_first",
    reason: "upstream_error_or_empty",
  });

  const fallback = buildFinalReportFallback({
    policy: args.langPolicy,
    translationLanguage: args.translationLanguage,
    laborHours: args.requestedLaborHours,
  });

  args.emitToken(fallback);
  return { response: fallback };
}