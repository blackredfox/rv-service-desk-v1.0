import {
  normalizeLanguageMode,
  detectInputLanguageV2,
  detectForcedOutputLanguage,
  computeOutputPolicy,
  resolveLanguagePolicy,
  type LanguageMode,
  type Language,
  type InputLanguageV2,
  type OutputLanguagePolicyV2,
  type LanguagePolicy,
} from "@/lib/lang";
import { storage } from "@/lib/storage";
import { getCurrentUser } from "@/lib/auth";
import {
  composePromptV2,
  detectModeCommand,
  type CaseMode,
  DEFAULT_MEMORY_WINDOW,
} from "@/lib/prompt-composer";
import {
  validateOutput,
  getSafeFallback,
  buildCorrectionInstruction,
  logValidation,
  validateLanguageConsistency,
} from "@/lib/mode-validators";
import { validateLaborSum } from "@/lib/labor-store";
import {
  initializeCase,
  buildRegistryContext,
} from "@/lib/diagnostic-registry";
import { getStepEnrichment } from "@/lib/retrieval-enrichment";
import {
  processMessage as processContextMessage,
  recordAgentAction,
  getOrCreateContext,
  isInReplanState,
  clearReplanState,
  generateAntiLoopDirectives,
  buildReplanNotice,
  isInClarificationSubflow,
  buildReturnToMainInstruction,
  popTopic,
  updateContext,
  isFallbackResponse,
  markStepCompleted as markContextStepCompleted,
  type ContextEngineResult,
  type DiagnosticContext,
  DEFAULT_CONFIG,
} from "@/lib/context-engine";
import { buildFactLockConstraint } from "@/lib/fact-pack";

// ── Extracted Chat Modules ─────────────────────────────────────────
import {
  sseEncode,
  callOpenAI,
  buildOpenAiMessages,
  validateAttachments,
  filterValidAttachments,
  buildVisionInstruction,
  type Attachment,
  computeLaborOverrideRequest,
  formatLaborHours,
  hasCanonicalTotalLaborLine,
  enforceLanguagePolicy,
  extractPrimaryReportBlock,
  buildFinalReportFallback,
  DIAGNOSTIC_MODE_GUARD_VIOLATION,
  isDiagnosticDriftViolation,
  applyDiagnosticModeValidationGuard,
  buildDiagnosticDriftCorrectionInstruction,
  buildDiagnosticDriftFallback,
  buildLaborOverrideConstraints,
  buildLaborOverrideRequest,
  logTiming,
  logFlow,
  // Re-export for tests
  parseRequestedLaborHours,
  detectLaborOverrideIntent,
  looksLikeFinalReport,
  shouldTreatAsFinalReportForOverride,
} from "@/lib/chat";

// ── Strict Context Engine Mode ──────────────────────────────────────
const STRICT_CONTEXT_ENGINE = true;

export const runtime = "nodejs";

const MODELS = {
  diagnostic: "gpt-5-mini-2025-08-07",
  final: "gpt-5.2-2025-12-11",
} as const;

function getModelForMode(mode: CaseMode): string {
  return mode === "final_report" || mode === "authorization"
    ? MODELS.final
    : MODELS.diagnostic;
}

/**
 * Payload v2 request body
 */
type ChatBodyV2 = {
  v?: 2;
  caseId?: string;
  message: string;
  output?: {
    mode?: LanguageMode;
  };
  languageMode?: LanguageMode;
  dialogueLanguage?: Language;
  attachments?: Attachment[];
};

export async function POST(req: Request) {
  const requestStartedAt = Date.now();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "Missing OPENAI_API_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const user = await getCurrentUser();

  const body = (await req.json().catch(() => null)) as ChatBodyV2 | null;
  const message = (body?.message ?? "").trim();
  if (!message) {
    return new Response(
      JSON.stringify({ error: "Missing message" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // ── ATTACHMENT VALIDATION ─────────────────────────────────────────
  const rawAttachments = filterValidAttachments(body?.attachments);
  const attachmentValidation = validateAttachments(rawAttachments);
  if (!attachmentValidation.valid) {
    return new Response(
      JSON.stringify({ error: attachmentValidation.error }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const attachments = rawAttachments;
  const attachmentCount = attachments?.length ?? 0;

  if (attachmentCount > 0) {
    console.log(`[Chat API v2] Attachments: count=${attachmentCount}, totalBytes=${attachmentValidation.totalBytes}`);
  }

  // ── LANGUAGE DETECTION & POLICY ───────────────────────────────────
  const detectedInputLanguage: InputLanguageV2 = detectInputLanguageV2(message);
  const forcedOutputLanguage = detectForcedOutputLanguage(message);

  let trackedInputLanguage: Language = detectedInputLanguage.detected;
  if (body?.caseId) {
    const existing = await storage.getCase(body.caseId, user?.id);
    const previousLanguage = existing.case?.inputLanguage;
    if (previousLanguage) {
      trackedInputLanguage = previousLanguage;

      const compactMessage = message.trim();
      const isShortAck =
        compactMessage.length <= 4 ||
        /^(?:ok|okay|yes|y|no|n|sí|si|да|нет)$/i.test(compactMessage);

      const shouldAutoSwitch =
        !forcedOutputLanguage &&
        previousLanguage !== detectedInputLanguage.detected &&
        (detectedInputLanguage.confidence ?? 0) >= 0.85 &&
        !isShortAck;

      if (shouldAutoSwitch) {
        trackedInputLanguage = detectedInputLanguage.detected;
        console.log(
          `[Chat API v2] Language switch detected: ${previousLanguage} → ${detectedInputLanguage.detected}`
        );
      }
    }
  }

  const requestedOutputMode: LanguageMode = normalizeLanguageMode(
    body?.output?.mode ?? body?.languageMode
  );
  const outputMode: LanguageMode = forcedOutputLanguage ?? requestedOutputMode;

  if (forcedOutputLanguage) {
    trackedInputLanguage = forcedOutputLanguage;
  }

  const outputPolicy: OutputLanguagePolicyV2 = computeOutputPolicy(outputMode, trackedInputLanguage);
  const langPolicy: LanguagePolicy = resolveLanguagePolicy(outputMode, trackedInputLanguage);
  const translationLanguage = langPolicy.includeTranslation ? trackedInputLanguage : undefined;

  console.log(`[Chat API v2] Input: detected=${detectedInputLanguage.detected} (${detectedInputLanguage.reason}), dialogue=${trackedInputLanguage}, forcedOutput=${forcedOutputLanguage ?? "none"}, Output: mode=${outputPolicy.mode}, effective=${outputPolicy.effective}, strategy=${outputPolicy.strategy}, includeTranslation=${langPolicy.includeTranslation}, translationLanguage=${translationLanguage ?? "none"}`);

  // ── CASE MANAGEMENT ───────────────────────────────────────────────
  const ensuredCase = await storage.ensureCase({
    caseId: body?.caseId,
    titleSeed: message,
    inputLanguage: trackedInputLanguage,
    languageSource: outputPolicy.strategy === "auto" ? "AUTO" : "MANUAL",
    userId: user?.id,
  });

  let currentMode: CaseMode = ensuredCase.mode || "diagnostic";

  if (currentMode === "labor_confirmation") {
    currentMode = "final_report";
    await storage.updateCase(ensuredCase.id, { mode: currentMode });
  }

  const commandMode = detectModeCommand(message);
  if (commandMode && commandMode !== currentMode) {
    console.log(`[Chat API v2] Mode transition: ${currentMode} → ${commandMode} (explicit command)`);
    currentMode = commandMode;
    await storage.updateCase(ensuredCase.id, { mode: currentMode });
  }

  await storage.appendMessage({
    caseId: ensuredCase.id,
    role: "user",
    content: message,
    language: detectedInputLanguage.detected,
    userId: user?.id,
  });

  const historyLoadStart = Date.now();
  const history = await storage.listMessagesForContext(ensuredCase.id, DEFAULT_MEMORY_WINDOW);
  logTiming("load_history", {
    caseId: ensuredCase.id,
    loadHistoryMs: Date.now() - historyLoadStart,
  });

  // ── CONTEXT ENGINE: SINGLE FLOW AUTHORITY ─────────────────────────
  let procedureContext = "";
  let engineResult: ContextEngineResult | null = null;
  let contextEngineDirectives = "";

  if (currentMode === "diagnostic") {
    if (!STRICT_CONTEXT_ENGINE) {
      console.error("[Chat API v2] STRICT_CONTEXT_ENGINE is disabled — this is not supported in production");
    }

    const initResult = initializeCase(ensuredCase.id, message);
    if (initResult.procedure && initResult.preCompletedSteps.length > 0) {
      console.log(`[Chat API v2] Procedure catalog: ${initResult.procedure.displayName}, initial steps: ${initResult.preCompletedSteps.join(", ")}`);
      for (const stepId of initResult.preCompletedSteps) {
        markContextStepCompleted(ensuredCase.id, stepId);
      }
    } else if (initResult.system) {
      console.log(`[Chat API v2] Procedure catalog: ${initResult.system}`);
    }

    engineResult = processContextMessage(ensuredCase.id, message, DEFAULT_CONFIG);

    if (!engineResult || !engineResult.context) {
      console.error("[Chat API v2] CRITICAL: Context Engine returned invalid result — using safe fallback");
      engineResult = {
        context: getOrCreateContext(ensuredCase.id) as DiagnosticContext,
        intent: { type: "UNCLEAR" },
        responseInstructions: {
          action: "ask_step",
          constraints: ["Context Engine error — ask a safe diagnostic question"],
          antiLoopDirectives: ["FORWARD PROGRESS: Move to next available step"],
        },
        stateChanged: false,
        notices: ["Context Engine error — safe fallback activated"],
      };
    }

    console.log(`[Chat API v2] Context Engine: intent=${engineResult.intent.type}, submode=${engineResult.context.submode}, stateChanged=${engineResult.stateChanged}`);

    if (engineResult.notices.length > 0) {
      console.log(`[Chat API v2] Context Engine notices: ${engineResult.notices.join(", ")}`);
    }

    if (isInReplanState(engineResult.context)) {
      console.log(`[Chat API v2] REPLAN triggered (Context Engine): ${engineResult.context.replanReason}`);
    }

    if (isInClarificationSubflow(engineResult.context)) {
      console.log(`[Chat API v2] Clarification subflow (Context Engine): ${engineResult.context.submode}`);
    }

    // Log isolation state for diagnostics (but do NOT trigger auto-transition)
    if (engineResult.context.isolationComplete && engineResult.context.isolationFinding) {
      console.log(`[Chat API v2] Context Engine isolation state: "${engineResult.context.isolationFinding}" (no auto-transition — explicit command required)`);
    }

    const antiLoopDirectives = generateAntiLoopDirectives(engineResult.context);
    const replanNotice = buildReplanNotice(engineResult.context);
    const clarificationInstruction = buildReturnToMainInstruction(engineResult.context);

    contextEngineDirectives = [
      ...antiLoopDirectives,
      replanNotice,
      clarificationInstruction,
    ].filter(Boolean).join("\n\n");

    procedureContext = buildRegistryContext(ensuredCase.id, engineResult?.context.activeStepId);
    
    // ── RETRIEVAL ENRICHMENT (optional, additive only) ──────────────
    if (engineResult?.context.activeStepId && engineResult.context.primarySystem) {
      const enrichment = getStepEnrichment(
        engineResult.context.activeStepId,
        engineResult.context.primarySystem,
        engineResult.context.equipmentIdentity,
      );
      if (enrichment) {
        procedureContext += `\n\nEQUIPMENT-SPECIFIC NOTE (${enrichment.source}):\n${enrichment.hint}`;
      }
    }
  }

  // ── FACT LOCK ─────────────────────────────────────────────────────
  let factLockConstraint = "";
  if (currentMode === "final_report") {
    factLockConstraint = buildFactLockConstraint(history);
  }

  const laborOverride = computeLaborOverrideRequest(currentMode, history, message);
  const isLaborOverrideRequest = laborOverride.isLaborOverrideRequest;
  const requestedLaborHours = laborOverride.requestedLaborHours;
  const requestedLaborHoursText =
    requestedLaborHours !== null ? formatLaborHours(requestedLaborHours) : null;

  // ── COMPOSE SYSTEM PROMPT ─────────────────────────────────────────
  const additionalConstraints = [contextEngineDirectives, procedureContext, factLockConstraint]
    .filter(Boolean)
    .join("\n\n") || undefined;

  const composePromptStart = Date.now();
  const baseSystemPrompt = composePromptV2({
    mode: currentMode,
    inputDetected: trackedInputLanguage,
    outputEffective: outputPolicy.effective,
    includeTranslation: langPolicy.includeTranslation,
    translationLanguage,
    additionalConstraints,
  });
  logTiming("compose_prompt", {
    caseId: ensuredCase.id,
    mode: currentMode,
    composePromptMs: Date.now() - composePromptStart,
  });

  const visionInstruction = buildVisionInstruction(attachmentCount);
  const systemPrompt = baseSystemPrompt + visionInstruction;

  // ── STREAMING RESPONSE ────────────────────────────────────────────
  const encoder = new TextEncoder();
  const ac = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";
      let aborted = false;
      let firstSseTokenEmitted = false;
      const emitToken = (token: string) => {
        if (aborted || !token) return;
        if (!firstSseTokenEmitted) {
          firstSseTokenEmitted = true;
          logTiming("sse_first_token", {
            caseId: ensuredCase.id,
            firstSseTokenMs: Date.now() - requestStartedAt,
          });
        }
        controller.enqueue(encoder.encode(sseEncode({ type: "token", token })));
      };

      const onAbort = () => {
        aborted = true;
        try { ac.abort(); } catch { /* ignore */ }
      };

      req.signal.addEventListener("abort", onAbort, { once: true });

      try {
        controller.enqueue(encoder.encode(sseEncode({ type: "case", caseId: ensuredCase.id })));

        controller.enqueue(encoder.encode(sseEncode({
          type: "language",
          inputDetected: trackedInputLanguage,
          outputMode: outputPolicy.mode,
          outputEffective: outputPolicy.effective,
          detector: detectedInputLanguage.source,
          confidence: detectedInputLanguage.confidence,
        })));

        controller.enqueue(encoder.encode(sseEncode({ type: "mode", mode: currentMode })));

        // ── LABOR OVERRIDE PATH ─────────────────────────────────────
        if (isLaborOverrideRequest && requestedLaborHours !== null && requestedLaborHoursText) {
          console.log(
            `[Chat API v2] Final report labor override requested: total=${requestedLaborHoursText} hr`
          );

          const overrideConstraints = buildLaborOverrideConstraints(requestedLaborHoursText, factLockConstraint);

          const overrideComposeStart = Date.now();
          const overridePrompt = composePromptV2({
            mode: "final_report",
            inputDetected: trackedInputLanguage,
            outputEffective: outputPolicy.effective,
            includeTranslation: langPolicy.includeTranslation,
            translationLanguage,
            additionalConstraints: overrideConstraints,
          });
          logTiming("compose_prompt", {
            caseId: ensuredCase.id,
            mode: "final_report",
            path: "labor_override",
            composePromptMs: Date.now() - overrideComposeStart,
          });

          const overrideRequest = buildLaborOverrideRequest(
            requestedLaborHoursText,
            langPolicy.includeTranslation,
            translationLanguage
          );

          const overrideBody = {
            model: getModelForMode("final_report"),
            messages: buildOpenAiMessages({
              system: overridePrompt,
              history,
              userMessage: overrideRequest,
              attachments: undefined,
            }),
          };

          const overrideFirstStart = Date.now();
          let overrideResult = await callOpenAI(apiKey, overrideBody, ac.signal, emitToken);
          logTiming("openai_call", {
            caseId: ensuredCase.id,
            mode: "final_report",
            path: "labor_override_first",
            openAiStartMs: overrideFirstStart - requestStartedAt,
            openAiMs: overrideResult.durationMs,
            openAiFirstTokenMs: overrideResult.firstTokenMs,
          });
          let overrideContent = overrideResult.response;

          const validateLaborOverride = (text: string) => {
            const primary = extractPrimaryReportBlock(text);
            const sumValidation = validateLaborSum(primary, requestedLaborHours);
            const hasCanonicalTotal = hasCanonicalTotalLaborLine(primary, requestedLaborHoursText);
            const violations = [
              ...sumValidation.violations,
              ...(hasCanonicalTotal
                ? []
                : [
                    `LABOR_TOTAL_FORMAT: Final report must include "Total labor: ${requestedLaborHoursText} hr" in canonical one-decimal format`,
                  ]),
            ];
            return {
              valid: violations.length === 0,
              violations,
            };
          };

          if (!overrideResult.error && overrideContent.trim()) {
            logFlow("validation_post_stream", {
              caseId: ensuredCase.id,
              mode: "final_report",
              path: "labor_override_first",
              openAiFirstTokenMs: overrideResult.firstTokenMs,
              responseChars: overrideContent.length,
            });
            const validateStart = Date.now();
            let modeValidation = validateOutput(
              overrideContent,
              "final_report",
              langPolicy.includeTranslation,
              translationLanguage
            );
            modeValidation = applyDiagnosticModeValidationGuard(modeValidation, "final_report", overrideContent);
            logValidation(modeValidation, { caseId: ensuredCase.id, mode: "final_report" });
            let laborValidation = validateLaborOverride(overrideContent);
            logTiming("validate_output", {
              caseId: ensuredCase.id,
              mode: "final_report",
              path: "labor_override_first",
              validateMs: Date.now() - validateStart,
            });

            if ((!modeValidation.valid || !laborValidation.valid) && !aborted) {
              logFlow("validation_failed", {
                caseId: ensuredCase.id,
                mode: "final_report",
                path: "labor_override_first",
                violations: modeValidation.violations.length + laborValidation.violations.length,
              });
              emitToken("\n\n[System] Repairing output...\n\n");
              const correctionViolations = [
                ...modeValidation.violations,
                ...laborValidation.violations,
              ];
              const correctionInstruction = [
                buildCorrectionInstruction(correctionViolations),
                `Regenerate in FINAL_REPORT mode only.`,
                `Do NOT output diagnostic steps or step IDs (no "Step", no "wp_").`,
                `Keep all sections except Estimated Labor semantically unchanged.`,
                `Estimated Labor must sum to exactly ${requestedLaborHoursText} hr and end with "Total labor: ${requestedLaborHoursText} hr".`,
                `Do NOT ask labor confirmation. Do NOT ask follow-up questions.`,
              ].join("\n");

              const retryBody = {
                ...overrideBody,
                messages: buildOpenAiMessages({
                  system: overridePrompt,
                  history,
                  userMessage: overrideRequest,
                  attachments: undefined,
                  correctionInstruction,
                }),
              };

              logFlow("retry_triggered", {
                caseId: ensuredCase.id,
                mode: "final_report",
                path: "labor_override_retry",
              });

              const overrideRetryStart = Date.now();
              overrideResult = await callOpenAI(apiKey, retryBody, ac.signal, emitToken);
              logTiming("openai_call", {
                caseId: ensuredCase.id,
                mode: "final_report",
                path: "labor_override_retry",
                openAiStartMs: overrideRetryStart - requestStartedAt,
                openAiMs: overrideResult.durationMs,
                openAiFirstTokenMs: overrideResult.firstTokenMs,
              });
              if (!overrideResult.error) {
                overrideContent = overrideResult.response;
                const retryValidateStart = Date.now();
                modeValidation = validateOutput(
                  overrideContent,
                  "final_report",
                  langPolicy.includeTranslation,
                  translationLanguage
                );
                modeValidation = applyDiagnosticModeValidationGuard(modeValidation, "final_report", overrideContent);
                logValidation(modeValidation, { caseId: ensuredCase.id, mode: "final_report" });
                laborValidation = validateLaborOverride(overrideContent);
                logTiming("validate_output", {
                  caseId: ensuredCase.id,
                  mode: "final_report",
                  path: "labor_override_retry",
                  validateMs: Date.now() - retryValidateStart,
                });
              }
            }

            overrideContent = enforceLanguagePolicy(overrideContent, langPolicy);

            const postValidateStart = Date.now();
            const postModeValidation = validateOutput(
              overrideContent,
              "final_report",
              langPolicy.includeTranslation,
              translationLanguage
            );
            const guardedPostModeValidation = applyDiagnosticModeValidationGuard(
              postModeValidation,
              "final_report",
              overrideContent
            );
            const postLaborValidation = validateLaborOverride(overrideContent);
            logTiming("validate_output", {
              caseId: ensuredCase.id,
              mode: "final_report",
              path: "labor_override_post",
              validateMs: Date.now() - postValidateStart,
            });

            if (!guardedPostModeValidation.valid || !postLaborValidation.valid) {
              logFlow("safe_fallback_used", {
                caseId: ensuredCase.id,
                mode: "final_report",
                path: "labor_override_post",
                reason: "validation_after_retry_failed",
              });
              console.warn(
                `[Chat API v2] Labor override response invalid after retry, using fallback for ${requestedLaborHoursText} hr`
              );
              overrideContent = buildFinalReportFallback({
                policy: langPolicy,
                translationLanguage,
                laborHours: requestedLaborHours,
              });
              emitToken(overrideContent);
            }

            if (!aborted && overrideContent.trim()) {
              await storage.appendMessage({
                caseId: ensuredCase.id,
                role: "assistant",
                content: overrideContent,
                language: outputPolicy.effective,
                userId: user?.id,
              });
            }
          } else {
            logFlow("safe_fallback_used", {
              caseId: ensuredCase.id,
              mode: "final_report",
              path: "labor_override_first",
              reason: "upstream_error_or_empty",
            });
            console.error(
              `[Chat API v2] Labor override generation error: ${overrideResult.error || "empty response"}`
            );
            const fallback = buildFinalReportFallback({
              policy: langPolicy,
              translationLanguage,
              laborHours: requestedLaborHours,
            });
            emitToken(fallback);

            if (!aborted) {
              await storage.appendMessage({
                caseId: ensuredCase.id,
                role: "assistant",
                content: fallback,
                language: outputPolicy.effective,
                userId: user?.id,
              });
            }
          }

          controller.enqueue(encoder.encode(sseEncode({ type: "done" })));
          controller.close();
          return;
        }

        // ── PRIMARY REQUEST PATH ────────────────────────────────────
        const openAiBody = {
          model: getModelForMode(currentMode),
          messages: buildOpenAiMessages({
            system: systemPrompt,
            history,
            userMessage: message,
            attachments,
          }),
        };

        const primaryFirstStart = Date.now();
        let result = await callOpenAI(apiKey, openAiBody, ac.signal, emitToken);
        logTiming("openai_call", {
          caseId: ensuredCase.id,
          mode: currentMode,
          path: "primary_first",
          openAiStartMs: primaryFirstStart - requestStartedAt,
          openAiMs: result.durationMs,
          openAiFirstTokenMs: result.firstTokenMs,
        });

        if (result.error) {
          controller.enqueue(
            encoder.encode(sseEncode({ type: "error", code: "UPSTREAM_ERROR", message: result.error }))
          );
          controller.enqueue(encoder.encode(sseEncode({ type: "done" })));
          controller.close();
          return;
        }

        logFlow("validation_post_stream", {
          caseId: ensuredCase.id,
          mode: currentMode,
          path: "primary_first",
          openAiFirstTokenMs: result.firstTokenMs,
          responseChars: result.response.length,
        });
        const validateStart = Date.now();
        let validation = validateOutput(result.response, currentMode, langPolicy.includeTranslation, translationLanguage);
        validation = applyDiagnosticModeValidationGuard(validation, currentMode, result.response);
        
        // Also validate language consistency for diagnostic mode
        if (currentMode === "diagnostic") {
          const langValidation = validateLanguageConsistency(result.response, trackedInputLanguage);
          if (!langValidation.valid) {
            validation = {
              ...validation,
              valid: false,
              violations: [...validation.violations, ...langValidation.violations],
            };
          }
        }
        
        logValidation(validation, { caseId: ensuredCase.id, mode: currentMode });
        logTiming("validate_output", {
          caseId: ensuredCase.id,
          mode: currentMode,
          path: "primary_first",
          validateMs: Date.now() - validateStart,
        });

        if (!validation.valid && !aborted) {
          logFlow("validation_failed", {
            caseId: ensuredCase.id,
            mode: currentMode,
            path: "primary_first",
            violations: validation.violations.length,
          });
          console.log(`[Chat API v2] Validation failed, retrying with correction...`);
          emitToken("\n\n[System] Repairing output...\n\n");
          const correctionInstructionParts = [buildCorrectionInstruction(validation.violations)];
          
          // Add drift correction for ANY diagnostic drift violation
          if (isDiagnosticDriftViolation(validation.violations)) {
            correctionInstructionParts.push(
              buildDiagnosticDriftCorrectionInstruction(engineResult?.context.activeStepId ?? undefined)
            );
          }
          const correctionInstruction = correctionInstructionParts.join("\n");

          const retryBody = {
            ...openAiBody,
            messages: buildOpenAiMessages({
              system: systemPrompt,
              history,
              userMessage: message,
              attachments,
              correctionInstruction,
            }),
          };

          logFlow("retry_triggered", {
            caseId: ensuredCase.id,
            mode: currentMode,
            path: "primary_retry",
          });

          const primaryRetryStart = Date.now();
          result = await callOpenAI(apiKey, retryBody, ac.signal, emitToken);
          logTiming("openai_call", {
            caseId: ensuredCase.id,
            mode: currentMode,
            path: "primary_retry",
            openAiStartMs: primaryRetryStart - requestStartedAt,
            openAiMs: result.durationMs,
            openAiFirstTokenMs: result.firstTokenMs,
          });

          if (!result.error) {
            const retryValidateStart = Date.now();
            validation = validateOutput(result.response, currentMode, langPolicy.includeTranslation, translationLanguage);
            validation = applyDiagnosticModeValidationGuard(validation, currentMode, result.response);
            logValidation(validation, { caseId: ensuredCase.id, mode: currentMode });
            logTiming("validate_output", {
              caseId: ensuredCase.id,
              mode: currentMode,
              path: "primary_retry",
              validateMs: Date.now() - retryValidateStart,
            });
          }

          if (!validation.valid || result.error) {
            logFlow("safe_fallback_used", {
              caseId: ensuredCase.id,
              mode: currentMode,
              path: "primary_retry",
              reason: result.error ? "upstream_error_on_retry" : "validation_after_retry_failed",
            });
            console.log(`[Chat API v2] Retry failed, using safe fallback in ${outputPolicy.effective}`);
            
            // Use diagnostic drift fallback for ANY diagnostic drift violation
            // NEVER use final report fallback when in diagnostic mode
            result.response =
              currentMode === "diagnostic" && isDiagnosticDriftViolation(validation.violations)
                ? buildDiagnosticDriftFallback(engineResult?.context.activeStepId ?? undefined)
                : currentMode === "diagnostic"
                ? getSafeFallback(currentMode, outputPolicy.effective)
                : currentMode === "final_report"
                ? buildFinalReportFallback({
                    policy: langPolicy,
                    translationLanguage,
                  })
                : getSafeFallback(currentMode, outputPolicy.effective);
            emitToken(result.response);

            controller.enqueue(
              encoder.encode(sseEncode({
                type: "validation_fallback",
                violations: validation.violations
              }))
            );
          }
        }

        full = result.response;

        // ── CONTEXT ENGINE: Record agent action ─────────────────────
        if (currentMode === "diagnostic" && engineResult) {
          const actionType = isFallbackResponse(full) ? "fallback" :
                            engineResult.context.submode !== "main" ? "clarification" : "question";

          recordAgentAction(ensuredCase.id, {
            type: actionType,
            content: full.slice(0, 200),
            stepId: engineResult.context.activeStepId || undefined,
            submode: engineResult.context.submode,
          }, DEFAULT_CONFIG);

          console.log(`[Chat API v2] Context Engine: recorded action type=${actionType}`);

          if (isInReplanState(engineResult.context)) {
            const updatedCtx = clearReplanState(engineResult.context);
            updateContext(updatedCtx);
            console.log(`[Chat API v2] Context Engine: cleared replan state`);
          }

          if (isInClarificationSubflow(engineResult.context)) {
            const updatedCtx = popTopic(engineResult.context);
            updateContext(updatedCtx);
            console.log(`[Chat API v2] Context Engine: popped clarification topic, returning to main`);
          }
        }

        // ── AUTO-TRANSITION DISABLED (Explicit Command Required) ────────
        // Mode transitions happen ONLY via explicit command (START FINAL REPORT)
        // Context Engine isolation state is tracked but does NOT trigger auto-transition
        // This preserves the architecture rule: explicit-only mode transitions

        // ── NO TRANSITION ───────────────────────────────────────────
        full = enforceLanguagePolicy(full, langPolicy);

        if (!validation.valid) {
          controller.enqueue(
            encoder.encode(sseEncode({ type: "validation", valid: false, violations: validation.violations }))
          );
        }

        if (!aborted && full.trim()) {
          await storage.appendMessage({
            caseId: ensuredCase.id,
            role: "assistant",
            content: full,
            language: outputPolicy.effective,
            userId: user?.id,
          });
        }

        controller.enqueue(encoder.encode(sseEncode({ type: "done" })));
        controller.close();
      } catch (e: unknown) {
        if (aborted) {
          controller.close();
          return;
        }

        const msg = e instanceof Error ? e.message : "Unknown error";
        controller.enqueue(
          encoder.encode(sseEncode({ type: "error", code: "INTERNAL_ERROR", message: msg.slice(0, 300) }))
        );
        controller.enqueue(encoder.encode(sseEncode({ type: "done" })));
        controller.close();
      } finally {
        logTiming("request_total", {
          caseId: ensuredCase.id,
          totalMs: Date.now() - requestStartedAt,
          aborted,
        });
        req.signal.removeEventListener("abort", onAbort);
      }
    },
    cancel() {
      try { ac.abort(); } catch { /* ignore */ }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export const __test__ = {
  parseRequestedLaborHours,
  detectLaborOverrideIntent,
  looksLikeFinalReport,
  shouldTreatAsFinalReportForOverride,
  applyDiagnosticModeValidationGuard,
  computeLaborOverrideRequest,
};
