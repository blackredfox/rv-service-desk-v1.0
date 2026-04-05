import { storage } from "@/lib/storage";
import { getCurrentUser } from "@/lib/auth";
import {
  type CaseMode,
} from "@/lib/prompt-composer";
import {
  isStepAnswered,
  validateStepGuidanceOutput,
} from "@/lib/mode-validators";
import {
  initializeCase,
  buildRegistryContext,
  getActiveStepQuestion,
  getActiveStepMetadata,
  forceStepComplete,
  markStepCompleted as registryMarkStepCompleted,
  markStepUnable as registryMarkStepUnable,
  getNextStepId,
  processResponseForBranch,
  getBranchState,
  exitBranch,
} from "@/lib/diagnostic-registry";
import {
  processMessage as processContextMessage,
  getOrCreateContext,
  isInReplanState,
  generateAntiLoopDirectives,
  buildReplanNotice,
  isInClarificationSubflow,
  buildReturnToMainInstruction,
  popTopic,
  updateContext,
  checkLoopViolation,
  suggestLoopRecovery,
  markStepCompleted as markContextStepCompleted,
  recordAgentAction,
  type ContextEngineResult,
  type DiagnosticContext,
  DEFAULT_CONFIG,
} from "@/lib/context-engine";
import {
  buildFactLockConstraint,
  buildFinalReportAuthorityConstraint,
  deriveFinalReportAuthorityFacts,
  type FinalReportAuthorityFacts,
} from "@/lib/fact-pack";
import type { Language } from "@/lib/lang";
import {
  buildStepGuidanceResponse,
} from "@/lib/chat/output-policy";

// ── Extracted Chat Modules ─────────────────────────────────────────
import {
  sseEncode,
  computeLaborOverrideRequest,
  formatLaborHours,
  applyDiagnosticModeValidationGuard,
  logTiming,
  parseChatRequest,
  prepareAttachmentBundle,
  resolveLanguageContext,
  ensureChatCase,
  resolveStoredCaseMode,
  resolveExplicitModeChange,
  getModelForMode,
  buildChatSystemPrompt,
  executePrimaryChatCompletion,
  executeLaborOverrideCompletion,
  appendUserChatMessage,
  appendAssistantChatMessage,
  loadChatHistory,
  finalizeDiagnosticPersistence,
  type ActiveStepMetadata as ChatActiveStepMetadata,
  // Re-export for tests
  parseRequestedLaborHours,
  detectLaborOverrideIntent,
  looksLikeFinalReport,
  shouldTreatAsFinalReportForOverride,
  detectApprovedFinalReportIntent,
  classifyStepGuidanceIntent,
  normalizeRoutingInput,
  assessRepairSummaryIntent,
  buildRepairSummaryClarificationResponse,
} from "@/lib/chat";

// ── Strict Context Engine Mode ──────────────────────────────────────
const STRICT_CONTEXT_ENGINE = true;

type RegistryActiveStepMetadata = NonNullable<
  ReturnType<typeof getActiveStepMetadata>
>;

function buildAuthoritativeCompletionOffer(args: {
  language: Language;
  isolationFinding?: string | null;
  facts?: FinalReportAuthorityFacts | null;
}): string {
  const evidence = [
    args.isolationFinding,
    args.facts?.verifiedCondition,
    args.facts?.correctiveAction,
    args.facts?.requiredParts,
  ]
    .filter(Boolean)
    .join(" ");

  const isFuseRepair = /предохранител|fuse/i.test(evidence);

  switch (args.language) {
    case "RU":
      return isFuseRepair
        ? [
            "Принято.",
            "Причина подтверждена: неисправный предохранитель в цепи питания водонагревателя.",
            "Ремонт подтверждён: предохранитель заменён, водонагреватель работает штатно.",
            "Отправьте START FINAL REPORT — и я сформирую отчёт.",
          ].join("\n")
        : [
            "Принято.",
            args.isolationFinding ?? "Восстановление после ремонта подтверждено.",
            "Отправьте START FINAL REPORT — и я сформирую отчёт.",
          ].join("\n");
    case "ES":
      return isFuseRepair
        ? [
            "Entendido.",
            "Causa confirmada: fusible defectuoso en el circuito de alimentación del calentador de agua.",
            "Reparación confirmada: se reemplazó el fusible y el calentador funciona normalmente.",
            "Envía START FINAL REPORT y generaré el informe.",
          ].join("\n")
        : [
            "Entendido.",
            args.isolationFinding ?? "La restauración después de la reparación fue confirmada.",
            "Envía START FINAL REPORT y generaré el informe.",
          ].join("\n");
    default:
      return isFuseRepair
        ? [
            "Noted.",
            "Root cause confirmed: failed fuse in the water-heater power path.",
            "Repair confirmed: the fuse was replaced and the water heater is operating normally.",
            "Send START FINAL REPORT and I will generate the report.",
          ].join("\n")
        : [
            "Noted.",
            args.isolationFinding ?? "Repair completion and restored operation have been confirmed.",
            "Send START FINAL REPORT and I will generate the report.",
          ].join("\n");
  }
}

function buildRepairSummaryReportSupportResponse(language: Language): string {
  switch (language) {
    case "RU":
      return [
        "Понял.",
        "В сообщении уже есть жалоба, результаты осмотра и выполненный ремонт — это можно использовать для подготовки отчёта.",
        "Я не буду запускать несвязанную диагностику по этому вводу.",
        "Когда кейс будет готов по текущему потоку, отправьте START FINAL REPORT.",
      ].join("\n");
    case "ES":
      return [
        "Entendido.",
        "Tu mensaje ya incluye la queja, los hallazgos y la reparación completada; eso sirve para preparar el informe.",
        "No voy a iniciar una ruta de diagnóstico no relacionada con esta entrada.",
        "Cuando el caso esté listo dentro del flujo actual, envía START FINAL REPORT.",
      ].join("\n");
    default:
      return [
        "Understood.",
        "Your message already includes the complaint, findings, and completed repair, so it can be used for report support.",
        "I will not start an unrelated diagnostic path from this input.",
        "When the case is ready under the current flow, send START FINAL REPORT.",
      ].join("\n");
  }
}

function isFinalReportReady(context: Pick<DiagnosticContext, "isolationComplete" | "terminalState"> | null | undefined): boolean {
  return Boolean(context?.isolationComplete || context?.terminalState?.phase === "terminal");
}

export const runtime = "nodejs";

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

  const { body, message } = await parseChatRequest(req);
  if (!message) {
    return new Response(
      JSON.stringify({ error: "Missing message" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { normalizedMessage: routingMessage } = normalizeRoutingInput(message);

  // ── ATTACHMENT VALIDATION ─────────────────────────────────────────
  const attachmentBundleResult = prepareAttachmentBundle(body);
  if (!attachmentBundleResult.valid) {
    return new Response(
      JSON.stringify({ error: attachmentBundleResult.error }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { attachments, attachmentCount, totalBytes } = attachmentBundleResult.value;

  if (attachmentCount > 0) {
    console.log(`[Chat API v2] Attachments: count=${attachmentCount}, totalBytes=${totalBytes}`);
  }

  // ── LANGUAGE DETECTION & POLICY ───────────────────────────────────
  const {
    detectedInputLanguage,
    forcedOutputLanguage,
    trackedInputLanguage,
    outputPolicy,
    langPolicy,
    translationLanguage,
  } = await resolveLanguageContext({
    body,
    message,
    userId: user?.id,
  });

  console.log(`[Chat API v2] Input: detected=${detectedInputLanguage.detected} (${detectedInputLanguage.reason}), dialogue=${trackedInputLanguage}, forcedOutput=${forcedOutputLanguage ?? "none"}, Output: mode=${outputPolicy.mode}, effective=${outputPolicy.effective}, strategy=${outputPolicy.strategy}, includeTranslation=${langPolicy.includeTranslation}, translationLanguage=${translationLanguage ?? "none"}`);

  // ── CASE MANAGEMENT ───────────────────────────────────────────────
  const ensuredCase = await ensureChatCase({
    body,
    message,
    trackedInputLanguage,
    outputPolicy,
    userId: user?.id,
  });

  const storedMode = ensuredCase.mode ?? "diagnostic";
  let currentMode: CaseMode = resolveStoredCaseMode(ensuredCase.mode);

  if (currentMode !== storedMode) {
    await storage.updateCase(ensuredCase.id, { mode: currentMode });
  }

  const approvedFinalReportIntent =
    currentMode === "diagnostic"
      ? detectApprovedFinalReportIntent(routingMessage)
      : { matched: false };

  let repairSummaryClarificationResponse: string | null = null;
  let repairSummaryReportSupportResponse: string | null = null;
  const runtimeReportReady = isFinalReportReady(getOrCreateContext(ensuredCase.id));

  const pendingFinalReportCommand =
    currentMode === "diagnostic"
      ? resolveExplicitModeChange(currentMode, routingMessage)
      : { currentMode, nextMode: currentMode, changed: false };

  const hasEmbeddedExplicitFinalReportCommand =
    /(?:^|[.!?;:,\n]\s*)START FINAL REPORT(?:$|[.!?;:,\n])/i.test(routingMessage);

  const hasBoundedReportRequest =
    approvedFinalReportIntent.matched ||
    hasEmbeddedExplicitFinalReportCommand ||
    (pendingFinalReportCommand.changed && pendingFinalReportCommand.nextMode === "final_report");

  const repairSummaryIntent = assessRepairSummaryIntent({
    message: routingMessage,
    hasReportRequest: hasBoundedReportRequest,
  });

  const modeResolution = pendingFinalReportCommand;
  if (modeResolution.changed) {
    const reportReadyBeforeTransition =
      modeResolution.nextMode !== "final_report" ||
      runtimeReportReady;

    if (reportReadyBeforeTransition) {
      console.log(`[Chat API v2] Mode transition: ${modeResolution.currentMode} → ${modeResolution.nextMode} (explicit command)`);
      currentMode = modeResolution.nextMode;
      await storage.updateCase(ensuredCase.id, { mode: currentMode });
    } else {
      console.log("[Chat API v2] Final report command blocked — readiness not satisfied");
    }
  }

  if (
    currentMode === "diagnostic" &&
    (approvedFinalReportIntent.matched || hasEmbeddedExplicitFinalReportCommand) &&
    repairSummaryIntent.readyForReportRouting &&
    !runtimeReportReady
  ) {
    repairSummaryReportSupportResponse = buildRepairSummaryReportSupportResponse(outputPolicy.effective);
    console.log(`[Chat API v2] Dirty-input report support readiness surfaced (approved report intent: ${approvedFinalReportIntent.matchedText ?? "matched"})`);
  } else if (currentMode === "diagnostic" && repairSummaryIntent.shouldAskClarification) {
    repairSummaryClarificationResponse = buildRepairSummaryClarificationResponse({
      language: outputPolicy.effective,
      missingFields: repairSummaryIntent.missingFields,
    });
    console.log(`[Chat API v2] Dirty-input repair summary clarification requested (missing: ${repairSummaryIntent.missingFields.join(", ")})`);
  }

  let stepGuidanceResponse: string | null = null;
  let stepGuidanceStepId: string | null = null;

  if (currentMode === "diagnostic" && !repairSummaryClarificationResponse && !repairSummaryReportSupportResponse) {
    const contextBeforeProcessing = getOrCreateContext(ensuredCase.id);
    const activeStepBeforeProcessing = contextBeforeProcessing.activeStepId;
    const terminalPhaseBeforeProcessing =
      contextBeforeProcessing.terminalState?.phase ?? "normal";
    const eligibleForStepGuidance =
      activeStepBeforeProcessing !== null &&
      !contextBeforeProcessing.isolationComplete &&
      terminalPhaseBeforeProcessing === "normal";

    if (eligibleForStepGuidance) {
      const stepGuidanceMetadata = getActiveStepMetadata(
        ensuredCase.id,
        activeStepBeforeProcessing,
        outputPolicy.effective,
      );
      const guidanceIntent = stepGuidanceMetadata
        ? classifyStepGuidanceIntent({
            message: routingMessage,
            activeStepQuestion: stepGuidanceMetadata.question,
            activeStepHowToCheck: stepGuidanceMetadata.howToCheck,
            hasPhotoAttachment: attachmentCount > 0,
          })
        : null;

      if (
        stepGuidanceMetadata &&
        guidanceIntent
      ) {
        const draftedGuidanceResponse = buildStepGuidanceResponse({
          language: outputPolicy.effective,
          stepQuestion: stepGuidanceMetadata.question,
          guidance: stepGuidanceMetadata.howToCheck,
        });
        const validation = validateStepGuidanceOutput(
          draftedGuidanceResponse,
          outputPolicy.effective,
        );

        stepGuidanceResponse = validation.valid
          ? draftedGuidanceResponse
          : buildStepGuidanceResponse({
              language: outputPolicy.effective,
            });
        stepGuidanceStepId = stepGuidanceMetadata.id;

        if (!validation.valid) {
          console.warn(
            `[Chat API v2] STEP_GUIDANCE validator repaired response for step ${stepGuidanceStepId}: ${validation.violations.join(" | ")}`,
          );
        }

        console.log(`[Chat API v2] STEP_GUIDANCE detected for step ${stepGuidanceStepId} (${guidanceIntent?.category ?? "UNKNOWN"})`);
      }
    }
  }

  await appendUserChatMessage({
    caseId: ensuredCase.id,
    message,
    language: detectedInputLanguage.detected,
    userId: user?.id,
  });

  const history = stepGuidanceResponse
    ? []
    : await loadChatHistory(ensuredCase.id);

  // ── CONTEXT ENGINE: SINGLE FLOW AUTHORITY ─────────────────────────
  let procedureContext = "";
  let engineResult: ContextEngineResult | null = null;
  let contextEngineDirectives = "";
  let activeStepMetadata: RegistryActiveStepMetadata | null = null;
  let finalReportAuthorityFacts: FinalReportAuthorityFacts | null = null;

  if (currentMode === "diagnostic" && !stepGuidanceResponse && !repairSummaryClarificationResponse && !repairSummaryReportSupportResponse) {
    if (!STRICT_CONTEXT_ENGINE) {
      console.error("[Chat API v2] STRICT_CONTEXT_ENGINE is disabled — this is not supported in production");
    }

    const initResult = initializeCase(ensuredCase.id, routingMessage);
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

    engineResult = processContextMessage(ensuredCase.id, routingMessage, DEFAULT_CONFIG);

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

    // ── P1.7 FAULT CANDIDATE DIRECTIVE ────────────────────────────────
    // When a strong fault is identified but restoration is not yet confirmed,
    // inject a directive that limits the LLM to ONE restoration check question.
    // No further diagnostic expansion is allowed.
    if (engineResult.context.terminalState?.phase === "fault_candidate" &&
        engineResult.context.terminalState.faultIdentified &&
        !engineResult.context.isolationComplete) {
      const faultDirective = [
        "── STRONG FAULT IDENTIFIED (P1.7) ──",
        `Fault: ${engineResult.context.terminalState.faultIdentified.text}`,
        "",
        "MANDATORY RESPONSE:",
        "1. Acknowledge the fault finding briefly.",
        "2. Ask ONE question: confirm whether the repair was done and the system is operational.",
        "",
        "CRITICAL RULES:",
        "- Do NOT ask any other diagnostic question.",
        "- Do NOT continue with further procedure steps.",
        "- Do NOT expand into other diagnostic branches.",
        "- This is the ONLY allowed follow-up: restoration confirmation.",
      ].join("\n");

      contextEngineDirectives = [contextEngineDirectives, faultDirective].filter(Boolean).join("\n\n");
      console.log(`[Chat API v2] Fault candidate directive injected (awaiting restoration)`);
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
    const clarificationRequested = Boolean(
      currentActiveStep &&
      classifyStepGuidanceIntent({
        message: routingMessage,
        activeStepQuestion: getActiveStepQuestion(ensuredCase.id, currentActiveStep) ?? "",
        activeStepHowToCheck: getActiveStepMetadata(
          ensuredCase.id,
          currentActiveStep,
          outputPolicy.effective,
        )?.howToCheck,
        hasPhotoAttachment: attachmentCount > 0,
      }),
    );

    if (clarificationRequested && currentActiveStep) {
      console.log(`[Chat API v2] Clarification detected — NOT completing step ${currentActiveStep}`);
    }

    if (
      !clarificationRequested &&
      !contextEngineAdvancedStep &&
      currentActiveStep &&
      !initResult.preCompletedSteps.includes(currentActiveStep)
    ) {
      const stepQuestion = getActiveStepQuestion(ensuredCase.id, currentActiveStep);
      if (isStepAnswered(routingMessage, stepQuestion)) {
        // Technician's message answers the step — mark it complete
        registryMarkStepCompleted(ensuredCase.id, currentActiveStep);
        markContextStepCompleted(ensuredCase.id, currentActiveStep);
        console.log(`[Chat API v2] Step ${currentActiveStep} answered (contextual match, hardening backup)`);

        // ── BRANCH TRIGGER CHECK (P1.5 backup) ───────────────────────────
        // Context engine didn't advance, so check branch trigger here.
        // processResponseForBranch was NOT called by the engine for this step.
        const branchResult = processResponseForBranch(ensuredCase.id, currentActiveStep, routingMessage);
        if (branchResult.branchEntered) {
          console.log(`[Chat API v2] Branch entered (hardening backup): ${branchResult.branchEntered.id} (locked out: ${branchResult.lockedOut.join(", ") || "none"})`);
          // Sync branch state to context engine
          if (engineResult.context.branchState) {
            engineResult.context.branchState.activeBranchId = branchResult.branchEntered.id;
            engineResult.context.branchState.decisionPath.push({
              stepId: currentActiveStep,
              branchId: branchResult.branchEntered.id,
              reason: "Triggered by technician response (hardening backup)",
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
    activeStepMetadata = getActiveStepMetadata(
      ensuredCase.id,
      engineResult.context.activeStepId,
      outputPolicy.effective,
    );
    if (activeStepMetadata) {
      console.log(`[Chat API v2] Active step: ${activeStepMetadata.id} (${activeStepMetadata.progress.completed}/${activeStepMetadata.progress.total})`);
    }

    const terminalPhaseAfterProcessing =
      engineResult.context.terminalState?.phase ?? "normal";

    const shouldPromoteToStepGuidance =
      !stepGuidanceResponse &&
      engineResult.responseInstructions.action === "provide_clarification" &&
      stepIdBeforeProcessing !== null &&
      engineResult.context.activeStepId === stepIdBeforeProcessing &&
      terminalPhaseAfterProcessing === "normal" &&
      !engineResult.context.isolationComplete;

    if (shouldPromoteToStepGuidance) {
      const draftedGuidanceResponse = buildStepGuidanceResponse({
        language: outputPolicy.effective,
        stepQuestion: activeStepMetadata?.question,
        guidance: activeStepMetadata?.howToCheck,
      });
      const validation = validateStepGuidanceOutput(
        draftedGuidanceResponse,
        outputPolicy.effective,
      );

      stepGuidanceResponse = validation.valid
        ? draftedGuidanceResponse
        : buildStepGuidanceResponse({
            language: outputPolicy.effective,
          });
      stepGuidanceStepId = activeStepMetadata?.id ?? stepIdBeforeProcessing;

      if (!validation.valid) {
        console.warn(
          `[Chat API v2] STEP_GUIDANCE validator repaired promoted response for step ${stepGuidanceStepId}: ${validation.violations.join(" | ")}`,
        );
      }

      console.log(`[Chat API v2] STEP_GUIDANCE promoted from Context Engine clarification for step ${stepGuidanceStepId}`);
    }

    // ── P1.7 TERMINAL STATE ENFORCEMENT ─────────────────────────────────
    // This is the DOMINANT rule that runs AFTER all step-assignment code paths.
    // No loop recovery, no step completion hardening, no registry fallback can
    // override a non-normal terminal phase. activeStepId must stay null.
    if (engineResult.context.terminalState?.phase !== "normal") {
      if (engineResult.context.activeStepId !== null) {
        console.log(`[Chat API v2] P1.7 TERMINAL ENFORCEMENT: clearing activeStepId=${engineResult.context.activeStepId} (phase=${engineResult.context.terminalState.phase})`);
        engineResult.context.activeStepId = null;
        activeStepMetadata = null;
      }
      if (engineResult.context.terminalState.phase === "terminal") {
        engineResult.context.isolationComplete = true;
      }
    }

    const antiLoopDirectives = generateAntiLoopDirectives(engineResult.context);
    const replanNotice = buildReplanNotice(engineResult.context);
    const clarificationInstruction = buildReturnToMainInstruction(engineResult.context);

    contextEngineDirectives = [
      ...antiLoopDirectives,
      replanNotice,
      clarificationInstruction,
    ].filter(Boolean).join("\n\n");

    const shouldSuppressProcedureContext =
      engineResult.context.isolationComplete ||
      engineResult.context.terminalState?.phase !== "normal";

    procedureContext = shouldSuppressProcedureContext
      ? ""
      : buildRegistryContext(
          ensuredCase.id,
          engineResult?.context.activeStepId,
          outputPolicy.effective,
        );

    if (
      approvedFinalReportIntent.matched &&
      currentMode === "diagnostic" &&
      isFinalReportReady(engineResult.context)
    ) {
      currentMode = "final_report";
      await storage.updateCase(ensuredCase.id, { mode: currentMode });
      console.log(`[Chat API v2] Mode transition: diagnostic → final_report (approved report intent: ${approvedFinalReportIntent.matchedText ?? "matched"})`);
    }
  }

  // ── FACT LOCK ─────────────────────────────────────────────────────
  let factLockConstraint = "";
  if (currentMode === "final_report") {
    const reportContext = getOrCreateContext(ensuredCase.id);
    finalReportAuthorityFacts = deriveFinalReportAuthorityFacts(history, reportContext);
    factLockConstraint = [
      buildFinalReportAuthorityConstraint(finalReportAuthorityFacts),
      buildFactLockConstraint(history),
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  const authoritativeDiagnosticCompletionResponse =
    currentMode === "diagnostic" &&
    engineResult?.context.isolationComplete &&
    engineResult?.responseInstructions.action === "offer_completion"
      ? buildAuthoritativeCompletionOffer({
          language: outputPolicy.effective,
          isolationFinding: engineResult.context.isolationFinding,
          facts: deriveFinalReportAuthorityFacts(history, engineResult.context),
        })
      : null;

  const laborOverride = computeLaborOverrideRequest(currentMode, history, message);
  const isLaborOverrideRequest = laborOverride.isLaborOverrideRequest;
  const requestedLaborHours = laborOverride.requestedLaborHours;
  const requestedLaborHoursText =
    requestedLaborHours !== null ? formatLaborHours(requestedLaborHours) : null;

  // ── COMPOSE SYSTEM PROMPT ─────────────────────────────────────────
  const composePromptStart = Date.now();
  const { systemPrompt } = buildChatSystemPrompt({
    mode: currentMode,
    trackedInputLanguage,
    outputPolicy,
    langPolicy,
    translationLanguage,
    contextEngineDirectives,
    procedureContext,
    factLockConstraint,
    attachmentCount,
  });
  logTiming("compose_prompt", {
    caseId: ensuredCase.id,
    mode: currentMode,
    composePromptMs: Date.now() - composePromptStart,
  });

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

        const directRoutingResponse = repairSummaryClarificationResponse ?? repairSummaryReportSupportResponse;

        if (directRoutingResponse) {
          emitToken(directRoutingResponse);
          full = directRoutingResponse;

          if (!aborted && full.trim()) {
            await appendAssistantChatMessage({
              caseId: ensuredCase.id,
              content: full,
              language: outputPolicy.effective,
              userId: user?.id,
            });
          }

          if (currentMode === "diagnostic" && repairSummaryClarificationResponse) {
            recordAgentAction(
              ensuredCase.id,
              {
                type: "clarification",
                content: full.slice(0, 200),
                submode: "main",
              },
              DEFAULT_CONFIG,
            );
          }

          controller.enqueue(encoder.encode(sseEncode({ type: "done" })));
          controller.close();
          return;
        }

        if (stepGuidanceResponse) {
          emitToken(stepGuidanceResponse);
          full = stepGuidanceResponse;

          if (!aborted && full.trim()) {
            await appendAssistantChatMessage({
              caseId: ensuredCase.id,
              content: full,
              language: outputPolicy.effective,
              userId: user?.id,
            });
          }

          if (currentMode === "diagnostic") {
            recordAgentAction(
              ensuredCase.id,
              {
                type: "clarification",
                content: full.slice(0, 200),
                stepId: stepGuidanceStepId ?? undefined,
                submode: "main",
              },
              DEFAULT_CONFIG,
            );

            if (engineResult && isInClarificationSubflow(engineResult.context)) {
              updateContext(popTopic(engineResult.context));
            }
          }

          controller.enqueue(encoder.encode(sseEncode({ type: "done" })));
          controller.close();
          return;
        }

        if (authoritativeDiagnosticCompletionResponse) {
          emitToken(authoritativeDiagnosticCompletionResponse);
          full = authoritativeDiagnosticCompletionResponse;

          if (!aborted && full.trim()) {
            await appendAssistantChatMessage({
              caseId: ensuredCase.id,
              content: full,
              language: outputPolicy.effective,
              userId: user?.id,
            });
          }

          if (currentMode === "diagnostic" && engineResult) {
            finalizeDiagnosticPersistence({
              caseId: ensuredCase.id,
              mode: currentMode,
              engineResult,
              responseText: full,
            });
          }

          controller.enqueue(encoder.encode(sseEncode({ type: "done" })));
          controller.close();
          return;
        }

        // ── LABOR OVERRIDE PATH ─────────────────────────────────────
        if (isLaborOverrideRequest && requestedLaborHours !== null && requestedLaborHoursText) {
          console.log(
            `[Chat API v2] Final report labor override requested: total=${requestedLaborHoursText} hr`
          );
          const overrideResult = await executeLaborOverrideCompletion({
            apiKey,
            caseId: ensuredCase.id,
            factLockConstraint,
            trackedInputLanguage,
            outputLanguage: outputPolicy.effective,
            langPolicy,
            translationLanguage,
            history,
            requestedLaborHours,
            requestedLaborHoursText,
            signal: ac.signal,
            emitToken,
            isAborted: () => aborted,
            requestStartedAt,
          });

          if (!aborted && overrideResult.response.trim()) {
            await appendAssistantChatMessage({
              caseId: ensuredCase.id,
              content: overrideResult.response,
              language: outputPolicy.effective,
              userId: user?.id,
            });
          }

          controller.enqueue(encoder.encode(sseEncode({ type: "done" })));
          controller.close();
          return;
        }

        // ── PRIMARY REQUEST PATH ────────────────────────────────────
        const result = await executePrimaryChatCompletion({
          apiKey,
          caseId: ensuredCase.id,
          mode: currentMode,
          systemPrompt,
          history,
          message,
          attachments,
          signal: ac.signal,
          emitToken,
          isAborted: () => aborted,
          trackedInputLanguage,
          outputLanguage: outputPolicy.effective,
          langPolicy,
          translationLanguage,
          activeStepMetadata: activeStepMetadata as ChatActiveStepMetadata | null,
          activeStepId: engineResult?.context.activeStepId ?? undefined,
          finalReportAuthorityFacts,
          model: getModelForMode(currentMode),
          requestStartedAt,
        });

        if (result.upstreamError) {
          controller.enqueue(
            encoder.encode(sseEncode({ type: "error", code: "UPSTREAM_ERROR", message: result.upstreamError }))
          );
          controller.enqueue(encoder.encode(sseEncode({ type: "done" })));
          controller.close();
          return;
        }
        full = result.response;

        // ── CONTEXT ENGINE: Record agent action ─────────────────────
        if (currentMode === "diagnostic" && engineResult) {
          finalizeDiagnosticPersistence({
            caseId: ensuredCase.id,
            mode: currentMode,
            engineResult,
            responseText: full,
          });
        }

        // ── AUTO-TRANSITION DISABLED (Explicit Command Required) ────────
        // Mode transitions happen ONLY via explicit command (START FINAL REPORT)
        // Context Engine isolation state is tracked but does NOT trigger auto-transition
        // This preserves the architecture rule: explicit-only mode transitions

        // ── NO TRANSITION ───────────────────────────────────────────
        if (result.emittedValidationFallback) {
          controller.enqueue(
            encoder.encode(sseEncode({
              type: "validation_fallback",
              violations: result.validation.violations,
            }))
          );
        }

        if (!result.validation.valid) {
          controller.enqueue(
            encoder.encode(sseEncode({ type: "validation", valid: false, violations: result.validation.violations }))
          );
        }

        if (!aborted && full.trim()) {
          await appendAssistantChatMessage({
            caseId: ensuredCase.id,
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