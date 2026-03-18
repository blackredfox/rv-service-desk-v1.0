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
  validateStepCompliance,
  isStepAnswered,
} from "@/lib/mode-validators";
import { validateLaborSum } from "@/lib/labor-store";
import {
  initializeCase,
  buildRegistryContext,
  getActiveStepQuestion,
  getActiveStepMetadata,
  forceStepComplete,
  isProcedureFullyComplete,
  markStepCompleted as registryMarkStepCompleted,
  markStepUnable as registryMarkStepUnable,
  getNextStepId,
  processResponseForBranch,
  getBranchState,
  exitBranch,
} from "@/lib/diagnostic-registry";
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
  checkLoopViolation,
  suggestLoopRecovery,
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
  buildAuthoritativeStepFallback,
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
  let activeStepMetadata: ReturnType<typeof getActiveStepMetadata> = null;

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

    // ── Sync detected procedure to context engine (P1.6 fix) ──────────
    // route.ts identified the procedure via initializeCase() but the context engine's
    // activeProcedureId and primarySystem were never set — completion detection and
    // step 6 initialization both depend on activeProcedureId being non-null.
    const detectedSystemId = initResult.procedure?.system ?? initResult.system ?? null;
    if (detectedSystemId) {
      const ctxForSync = getOrCreateContext(ensuredCase.id);
      if (!ctxForSync.activeProcedureId) {
        ctxForSync.activeProcedureId = detectedSystemId;
        ctxForSync.primarySystem = detectedSystemId;
        updateContext(ctxForSync);
        console.log(`[Chat API v2] Context engine: activeProcedureId synced to '${detectedSystemId}'`);
      }
    }

    // Save the active step ID BEFORE context engine processes the message.
    // Used by STEP COMPLETION HARDENING to determine if the engine already advanced the step.
    const stepIdBeforeProcessing = getOrCreateContext(ensuredCase.id)?.activeStepId ?? null;

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

    // ── P1.6 COMPLETION OFFER DIRECTIVE ───────────────────────────────
    // When isolation is confirmed, inject a mandatory completion-offer instruction
    // into the prompt context. The LLM must summarize and offer START FINAL REPORT.
    // Mode transition is still ONLY triggered by the explicit technician command.
    if (engineResult.context.isolationComplete && engineResult.context.isolationFinding) {
      const completionDirective = [
        "── DIAGNOSTIC ISOLATION CONFIRMED ──",
        `Finding: ${engineResult.context.isolationFinding}`,
        "",
        "MANDATORY RESPONSE (this turn only):",
        "1. Acknowledge briefly (one line, e.g. 'Принято.' or 'Noted.')",
        "2. State the root cause or repair in 1-2 sentences.",
        "3. End with exactly: 'Send START FINAL REPORT and I will generate the report.'",
        "   (Russian: 'Отправь START FINAL REPORT — и я сформирую отчёт.')",
        "   (Spanish: 'Envía START FINAL REPORT y generaré el informe.')",
        "",
        "CRITICAL RULES:",
        "- Do NOT ask another diagnostic question.",
        "- Do NOT output the final report format (no Complaint/Procedure/Verified Condition/etc.).",
        "- Remain in diagnostic mode — mode switches ONLY via explicit START FINAL REPORT.",
      ].join("\n");

      contextEngineDirectives = [contextEngineDirectives, completionDirective].filter(Boolean).join("\n\n");
      console.log(`[Chat API v2] Completion offer directive injected`);
    }

    // ── LOOP RECOVERY ENFORCEMENT ──────────────────────────────────────
    // Check if the active step would violate loop rules, and if so, apply recovery.
    // Do NOT run if isolation is complete — loop recovery would re-assign activeStepId
    // and undo the completion detection that cleared it.
    const activeStepId = engineResult.context.activeStepId;
    if (activeStepId && !engineResult.context.isolationComplete) {
      const loopCheck = checkLoopViolation(
        { type: "question", content: "", stepId: activeStepId, timestamp: new Date().toISOString() },
        engineResult.context,
        DEFAULT_CONFIG
      );
      
      if (loopCheck.violation) {
        console.log(`[Chat API v2] Loop violation detected: ${loopCheck.reason}`);
        const recovery = suggestLoopRecovery(engineResult.context, loopCheck.reason || "");
        console.log(`[Chat API v2] Loop recovery action: ${recovery.action} — ${recovery.reason}`);
        
        // Apply recovery
        if (recovery.action.startsWith("mark_unable:")) {
          const stepToMark = recovery.action.split(":")[1];
          forceStepComplete(ensuredCase.id, stepToMark, "loop_recovery");
          registryMarkStepUnable(ensuredCase.id, stepToMark);
          // Get new next step after recovery
          const newNextStep = getNextStepId(ensuredCase.id);
          if (newNextStep) {
            engineResult.context.activeStepId = newNextStep;
            console.log(`[Chat API v2] Loop recovery: advanced to step ${newNextStep}`);
          }
        } else if (recovery.action === "force_next_step" || recovery.action === "force_forward") {
          // Mark current step unable and move on
          forceStepComplete(ensuredCase.id, activeStepId, "loop_recovery");
          registryMarkStepUnable(ensuredCase.id, activeStepId);
          const newNextStep = getNextStepId(ensuredCase.id);
          if (newNextStep) {
            engineResult.context.activeStepId = newNextStep;
            console.log(`[Chat API v2] Loop recovery: forced advance to step ${newNextStep}`);
          }
        }
      }
    }

    // ── STEP COMPLETION HARDENING ──────────────────────────────────────
    // Backup path: if context engine did NOT advance the step (intent detection failed),
    // check whether the message semantically answers the current step and advance it here.
    //
    // IMPORTANT: if context engine already advanced the step (stepIdBeforeProcessing ≠
    // activeStepId), skip this block entirely — the engine handled completion AND called
    // processResponseForBranch. Running this block again on the advanced step would
    // prematurely complete the NEXT question using the current (unrelated) message.
    const currentActiveStep = engineResult.context.activeStepId;
    const contextEngineAdvancedStep = stepIdBeforeProcessing !== currentActiveStep;

    if (!contextEngineAdvancedStep && currentActiveStep && !initResult.preCompletedSteps.includes(currentActiveStep)) {
      const stepQuestion = getActiveStepQuestion(ensuredCase.id, currentActiveStep);
      if (isStepAnswered(message, stepQuestion)) {
        // Technician's message answers the step — mark it complete
        registryMarkStepCompleted(ensuredCase.id, currentActiveStep);
        markContextStepCompleted(ensuredCase.id, currentActiveStep);
        console.log(`[Chat API v2] Step ${currentActiveStep} answered (contextual match, hardening backup)`);
        
        // ── BRANCH TRIGGER CHECK (P1.5 backup) ───────────────────────────
        // Context engine didn't advance, so check branch trigger here.
        // processResponseForBranch was NOT called by the engine for this step.
        const branchResult = processResponseForBranch(ensuredCase.id, currentActiveStep, message);
        if (branchResult.branchEntered) {
          console.log(`[Chat API v2] Branch entered (hardening backup): ${branchResult.branchEntered.id} (locked out: ${branchResult.lockedOut.join(", ") || "none"})`);
          // Sync branch state to context engine
          if (engineResult.context.branchState) {
            engineResult.context.branchState.activeBranchId = branchResult.branchEntered.id;
            engineResult.context.branchState.decisionPath.push({
              stepId: currentActiveStep,
              branchId: branchResult.branchEntered.id,
              reason: `Triggered by technician response (hardening backup)`,
              timestamp: new Date().toISOString(),
            });
            for (const lockedBranch of branchResult.lockedOut) {
              engineResult.context.branchState.lockedOutBranches.add(lockedBranch);
            }
          }
        }
        
        // Advance to next step (branch-aware)
        const nextStep = getNextStepId(ensuredCase.id);
        if (nextStep) {
          engineResult.context.activeStepId = nextStep;
          console.log(`[Chat API v2] Advanced to step ${nextStep} (hardening backup)`);
        } else {
          // Check if we need to exit branch and continue main flow
          const branchState = getBranchState(ensuredCase.id);
          if (branchState.activeBranchId) {
            exitBranch(ensuredCase.id, "Branch steps exhausted");
            console.log(`[Chat API v2] Exited branch ${branchState.activeBranchId}, checking main flow`);
            // Sync to context
            if (engineResult.context.branchState) {
              engineResult.context.branchState.activeBranchId = null;
            }
            // Try to get next main-flow step
            const mainFlowNext = getNextStepId(ensuredCase.id);
            if (mainFlowNext) {
              engineResult.context.activeStepId = mainFlowNext;
              console.log(`[Chat API v2] Resumed main flow at step ${mainFlowNext}`);
            } else {
              console.log(`[Chat API v2] All procedure steps complete`);
            }
          } else {
            console.log(`[Chat API v2] All procedure steps complete`);
          }
        }
      }
    }

    // Get active step metadata for authoritative rendering
    activeStepMetadata = getActiveStepMetadata(ensuredCase.id, engineResult.context.activeStepId);
    if (activeStepMetadata) {
      console.log(`[Chat API v2] Active step: ${activeStepMetadata.id} (${activeStepMetadata.progress.completed}/${activeStepMetadata.progress.total})`);
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
          
          // ── STEP COMPLIANCE VALIDATION ──────────────────────────────────
          // Validate that LLM response matches the engine-selected active step
          if (activeStepMetadata) {
            const stepValidation = validateStepCompliance(
              result.response,
              activeStepMetadata.id,
              activeStepMetadata.question
            );
            if (!stepValidation.valid) {
              console.log(`[Chat API v2] Step compliance violation: ${stepValidation.violations.join(", ")}`);
              validation = {
                ...validation,
                valid: false,
                violations: [...validation.violations, ...stepValidation.violations],
              };
            }
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
          if (isDiagnosticDriftViolation(validation.violations) || validation.violations.some(v => v.includes("STEP_COMPLIANCE"))) {
            correctionInstructionParts.push(
              buildDiagnosticDriftCorrectionInstruction(engineResult?.context.activeStepId ?? undefined)
            );
            // Add explicit step question for step compliance violations
            if (activeStepMetadata) {
              correctionInstructionParts.push(
                `MANDATORY: Ask this EXACT question (paraphrased naturally): "${activeStepMetadata.question}"`
              );
            }
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
            
            // Use diagnostic drift fallback for ANY diagnostic drift or step compliance violation
            // NEVER use final report fallback when in diagnostic mode
            const hasDriftOrStepViolation = 
              isDiagnosticDriftViolation(validation.violations) ||
              validation.violations.some(v => v.includes("STEP_COMPLIANCE"));
              
            result.response =
              currentMode === "diagnostic" && hasDriftOrStepViolation
                ? buildAuthoritativeStepFallback(activeStepMetadata, engineResult?.context.activeStepId ?? undefined)
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
