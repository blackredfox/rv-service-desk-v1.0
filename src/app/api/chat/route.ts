import { storage, type ChatMessage } from "@/lib/storage";
import { getCurrentUser } from "@/lib/auth";
import {
  type CaseMode,
  type OutputSurface,
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
  detectSystem,
  hasSpecificRoofAcEvidence,
  isBroadAcFamilyMessage,
} from "@/lib/diagnostic-procedures";
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
  getStepGuidanceContinuation,
} from "@/lib/chat/output-policy";
import { executeStepGuidanceCompletion } from "@/lib/chat/openai-execution-service";
import {
  detectReportRevisionIntent,
  type ReportKind,
} from "@/lib/chat/report-intent";

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
  resolveOutputSurface,
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
  // LLM Runtime Signals (advisory sidecar)
  tryAdjudicateRuntimeSignals,
  isLlmRuntimeSignalsEnabled,
  isSidecarClientInputAllowed,
  buildAdjudicationDebug,
  mayOpenReportSurface,
  produceRuntimeSignalProposal,
  consumeAdjudicatedDiagnosticSignals,
  buildConsumerDebug,
  type AdjudicatedSignals,
  type AdjudicationServerState,
} from "@/lib/chat";

// ── Strict Context Engine Mode ──────────────────────────────────────
const STRICT_CONTEXT_ENGINE = true;

type RegistryActiveStepMetadata = NonNullable<
  ReturnType<typeof getActiveStepMetadata>
>;

type StepGuidancePlan = {
  fallbackResponse: string;
  intentCategory: string;
  metadata: RegistryActiveStepMetadata;
  source: "preclassified" | "promoted";
  systemPrompt: string;
};

function buildValidatedStepGuidanceFallback(args: {
  language: Language;
  stepQuestion?: string | null;
  guidance?: string | null;
  logLabel: string;
}): string {
  const drafted = buildStepGuidanceResponse({
    language: args.language,
    stepQuestion: args.stepQuestion,
    guidance: args.guidance,
  });
  const validation = validateStepGuidanceOutput(drafted, args.language);

  if (validation.valid) {
    return drafted;
  }

  console.warn(
    `[Chat API v2] STEP_GUIDANCE validator repaired fallback for ${args.logLabel}: ${validation.violations.join(" | ")}`,
  );

  return buildStepGuidanceResponse({
    language: args.language,
  });
}

function buildStepGuidanceClarificationSystemPrompt(args: {
  language: Language;
  stepQuestion: string;
  guidance?: string | null;
  continuation: string;
  hasPhotoAttachment: boolean;
}): string {
  const photoRule = args.hasPhotoAttachment
    ? "- The technician included a photo. Use it only for bounded same-step identification support. Do NOT treat it as automatic evidence, completion, or progression proof."
    : "";

  return [
    "You are handling a bounded same-step clarification inside an active diagnostic step.",
    "",
    `Output language: ${args.language}`,
    `Active step question: ${args.stepQuestion}`,
    `Current step guidance: ${args.guidance?.trim() || "Use only the current step context and ask for the actual finding afterward."}`,
    "",
    "MANDATORY BOUNDARIES:",
    "- Stay on the CURRENT ACTIVE STEP only.",
    "- Answer the technician's actual related question helpfully and naturally within this step.",
    "- You may clarify location, identification, appearance, confirmation, comparison, or photo-based same-step support.",
    "- Be concise, practical, and bounded to the current step context.",
    "- Do NOT advance the step.",
    "- Do NOT complete the step.",
    "- Do NOT branch.",
    "- Do NOT switch mode.",
    "- Do NOT mention final report, authorization, next step, completion, or readiness.",
    "- Do NOT claim that findings/results have already been established.",
    photoRule,
    "",
    "RESPONSE RULES:",
    "- Answer the real support question, not a generic procedural wall of text.",
    "- If certainty is limited, say what cue or comparison to use within this same step.",
    `- End with exactly this line: \"${args.continuation}\"`,
    "- Do not use report headers, progress headers, or generic section labels.",
  ]
    .filter(Boolean)
    .join("\n");
}

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
            "Если хотите отчёт сейчас, попросите меня сделать отчёт или отправьте START FINAL REPORT.",
          ].join("\n")
        : [
            "Принято.",
            args.isolationFinding ?? "Восстановление после ремонта подтверждено.",
            "Если хотите отчёт сейчас, попросите меня сделать отчёт или отправьте START FINAL REPORT.",
          ].join("\n");
    case "ES":
      return isFuseRepair
        ? [
            "Entendido.",
            "Causa confirmada: fusible defectuoso en el circuito de alimentación del calentador de agua.",
            "Reparación confirmada: se reemplazó el fusible y el calentador funciona normalmente.",
            "Si quieres el informe ahora, pídeme que lo prepare o envía START FINAL REPORT.",
          ].join("\n")
        : [
            "Entendido.",
            args.isolationFinding ?? "La restauración después de la reparación fue confirmada.",
            "Si quieres el informe ahora, pídeme que lo prepare o envía START FINAL REPORT.",
          ].join("\n");
    default:
      return isFuseRepair
        ? [
            "Noted.",
            "Root cause confirmed: failed fuse in the water-heater power path.",
            "Repair confirmed: the fuse was replaced and the water heater is operating normally.",
            "If you want the report now, ask me to write the report, or send START FINAL REPORT.",
          ].join("\n")
        : [
            "Noted.",
            args.isolationFinding ?? "Repair completion and restored operation have been confirmed.",
            "If you want the report now, ask me to write the report, or send START FINAL REPORT.",
          ].join("\n");
  }
}

function buildTranscriptDerivedDraftConstraint(): string {
  return [
    "REPORT ASSEMBLY (MANDATORY):",
    "- Assemble the final report draft yourself from the case transcript and technician-verified facts.",
    "- Propose each section (Complaint, Diagnostic Procedure, Verified Condition, Recommended Corrective Action, Estimated Labor with breakdown lines, Required Parts) using what the technician has already reported in-conversation.",
    "- Do NOT ask the technician to author or re-author the complaint, findings, or performed repair.",
    "- Do NOT ask questionnaire-style questions before generating the draft.",
    "- The technician will review and correct the draft if needed; proposing items is your job.",
    "- If a specific item is truly not inferable from the transcript, use a conservative shop-style placeholder rather than asking a question.",
  ].join("\n");
}

function buildReportTypePromptConstraint(reportKind?: ReportKind): string {
  switch (reportKind) {
    case "warranty":
      return [
        "REPORT TYPE (MANDATORY): Warranty final report.",
        "Use conservative, approval-safe warranty wording.",
        "Do not change the technician-verified facts.",
      ].join("\n");
    case "retail":
      return [
        "REPORT TYPE (MANDATORY): Retail / customer-pay final report.",
        "Use direct shop wording suitable for a retail repair record.",
        "Do not change the technician-verified facts.",
      ].join("\n");
    default:
      return "";
  }
}

function buildReportRevisionPromptConstraint(message: string): string {
  return [
    "REPORT REVISION (MANDATORY):",
    "- A final report already exists in the current case history.",
    "- Treat the technician's latest message as a bounded report edit / regenerate request.",
    "- Apply only the requested changes and regenerate the complete final report now.",
    "- Preserve every unchanged fact and unchanged section semantically.",
    "- Do NOT ask follow-up questions.",
    "- Do NOT send START FINAL REPORT.",
    `Technician revision request: ${message.trim()}`,
  ].join("\n");
}

function buildAcSubtypeClarificationResponse(language: Language): string {
  switch (language) {
    case "RU":
      return "Чтобы выбрать правильную процедуру по AC, уточните тип узла: это крышный кондиционер, кондиционер кабины, крышный кондиционер с тепловым насосом или другой вариант?";
    case "ES":
      return "Para elegir el procedimiento correcto del AC, confirma qué tipo de unidad es: ¿AC de techo, AC del tablero/cabina, AC de techo con bomba de calor u otro tipo?";
    default:
      return "Before I choose the correct AC procedure, confirm what type of unit it is: roof AC, dash/cab AC, roof AC with heat pump, or another type?";
  }
}

/**
 * Build a deterministic response when the technician requests a final report
 * but diagnostics are still in progress (isolation not complete).
 * Remains in diagnostic mode and directs the technician to continue.
 */
function buildDiagnosticsNotReadyResponse(language: Language): string {
  switch (language) {
    case "RU":
      return "Диагностика ещё не завершена. Давайте продолжим с текущего шага, прежде чем формировать отчёт.";
    case "ES":
      return "El diagnóstico aún no está completo. Continuemos con el paso actual antes de generar el informe.";
    default:
      return "Diagnostics are not yet complete. Let\u2019s continue with the current step before generating the report.";
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
  const currentContextSnapshot = getOrCreateContext(ensuredCase.id);

  if (currentMode !== storedMode) {
    await storage.updateCase(ensuredCase.id, { mode: currentMode });
  }

  const historyBeforeAppend: Pick<ChatMessage, "role" | "content">[] =
    await loadChatHistory(ensuredCase.id);
  const existingReportInContext = shouldTreatAsFinalReportForOverride(
    currentMode,
    historyBeforeAppend,
  );

  const approvedFinalReportIntent = detectApprovedFinalReportIntent(routingMessage);
  const reportRevisionIntent = detectReportRevisionIntent({
    message: routingMessage,
    hasExistingReport: existingReportInContext,
  });
  const precomputedLaborOverride = computeLaborOverrideRequest(
    currentMode,
    historyBeforeAppend,
    message,
  );

  let reportRoutingResponse: string | null = null;
  let reportPromptConstraint = "";
  const runtimeReportReady = isFinalReportReady(currentContextSnapshot);

  const pendingFinalReportCommand =
    currentMode === "final_report"
      ? { currentMode, nextMode: currentMode, changed: false }
      : resolveExplicitModeChange(currentMode, routingMessage);

  const hasEmbeddedExplicitFinalReportCommand =
    /(?:^|[.!?;:,\n]\s*)START FINAL REPORT(?:$|[.!?;:,\n])/i.test(routingMessage);

  const hasBoundedReportRequest =
    approvedFinalReportIntent.matched ||
    hasEmbeddedExplicitFinalReportCommand ||
    (pendingFinalReportCommand.changed && pendingFinalReportCommand.nextMode === "final_report");

  // ── LLM RUNTIME SIGNALS (advisory sidecar, feature-flagged) ────────
  //
  // Authority contract:
  //   - The LLM sidecar proposes; the server adjudicates; Context Engine
  //     remains the single diagnostic-flow authority.
  //   - The sidecar cannot switch modes, mark diagnostics complete,
  //     select next steps, or generate final output. It is advisory only.
  //   - When the feature flag is OFF (default), adjudication is skipped
  //     and runtime behavior is unchanged.
  //
  // Producer path (this PR):
  //   - When the flag is ON and no test/dev client proposal is available,
  //     the server runs an internal, non-streaming LLM call via
  //     `produceRuntimeSignalProposal` to obtain a JSON proposal. That call
  //     has NO `onToken` callback — its output never reaches the user's
  //     SSE stream. On any error/timeout it returns "" and the route
  //     continues exactly as if no proposal existed.
  let sidecarSignals: AdjudicatedSignals | null = null;
  let sidecarServerState: AdjudicationServerState | null = null;
  if (isLlmRuntimeSignalsEnabled()) {
    // SECURITY: The `__sidecarProposal` body field is a test/dev-only channel
    // for deterministic adjudication exercises. In production it is silently
    // ignored even when the feature flag is ON. Production proposals are
    // obtained via the server-side producer below. See
    // `isSidecarClientInputAllowed`.
    let rawProposal = "";
    let sidecarSource: "client_test_input" | "server_producer" | "none" = "none";
    if (
      isSidecarClientInputAllowed() &&
      typeof body?.__sidecarProposal === "string" &&
      body.__sidecarProposal.length > 0
    ) {
      rawProposal = body.__sidecarProposal;
      sidecarSource = "client_test_input";
    } else {
      // Server-side producer path. Runs a bounded, non-streaming LLM call
      // whose output is NEVER emitted to the client SSE stream.
      try {
        const technicianMessagesForProducer = historyBeforeAppend
          .filter((msg) => msg.role === "user")
          .map((msg) => msg.content)
          .concat(routingMessage);
        const producerResult = await produceRuntimeSignalProposal({
          apiKey,
          mode: currentMode,
          model: getModelForMode(currentMode),
          latestUserMessage: routingMessage,
          technicianMessages: technicianMessagesForProducer,
          upstreamSignal: req.signal,
        });
        if (producerResult.rawProposal) {
          rawProposal = producerResult.rawProposal;
          sidecarSource = "server_producer";
        } else if (producerResult.error) {
          console.log(
            `[Chat API v2] LLM runtime signals producer fail-closed: ${producerResult.error}`,
          );
        }
      } catch (e) {
        // Defensive: producer already fails closed, but wrap in case an
        // unexpected exception occurs. The user-facing path must never be
        // affected by sidecar failures.
        console.log(
          `[Chat API v2] LLM runtime signals producer threw, ignored:`,
          e instanceof Error ? e.message : "unknown",
        );
      }
    }

    if (rawProposal) {
      const technicianMessages = historyBeforeAppend
        .filter((msg) => msg.role === "user")
        .map((msg) => msg.content)
        .concat(routingMessage);
      sidecarServerState = {
        caseMode: currentMode,
        isolationComplete: Boolean(currentContextSnapshot.isolationComplete),
        terminalPhase: currentContextSnapshot.terminalState?.phase ?? "normal",
        activeStepId: currentContextSnapshot.activeStepId ?? null,
        hasActiveProcedure: Boolean(currentContextSnapshot.activeProcedureId),
      };
      const adjudication = tryAdjudicateRuntimeSignals({
        rawProposal,
        latestUserMessage: routingMessage,
        technicianMessages,
        serverState: sidecarServerState,
      });
      if (adjudication) {
        sidecarSignals = adjudication.signals;
        console.log(
          `[Chat API v2] LLM runtime signals adjudicated (source=${sidecarSource}):`,
          buildAdjudicationDebug(adjudication),
        );
      } else {
        console.log(
          `[Chat API v2] LLM runtime signals: fail-closed (no usable proposal; source=${sidecarSource})`,
        );
      }
    }
  }

  // Advisory: allow the sidecar to RECOGNIZE a natural-language report request
  // that the regex-based intent detector missed. The server still owns every
  // subsequent gate (readiness, legality, subtype incompatibility, etc.).
  const sidecarRecognizesReportRequest = Boolean(
    sidecarSignals?.surfaceRequest.accepted &&
      (sidecarSignals.surfaceRequest.requestedSurface === "shop_final_report" ||
        sidecarSignals.surfaceRequest.requestedSurface === "warranty_report" ||
        sidecarSignals.surfaceRequest.requestedSurface === "portal_cause"),
  );
  const effectiveHasBoundedReportRequest =
    hasBoundedReportRequest || sidecarRecognizesReportRequest;

  const repairSummaryIntent = assessRepairSummaryIntent({
    message: routingMessage,
    hasReportRequest: hasBoundedReportRequest,
    priorUserMessages: historyBeforeAppend
      .filter((msg) => msg.role === "user")
      .map((msg) => msg.content),
    hasActiveDiagnosticContext: Boolean(currentContextSnapshot.activeProcedureId),
  });
  const hasPriorUserEvidence = historyBeforeAppend.some((msg) => msg.role === "user");
  const requestedReportKind = reportRevisionIntent.reportKind ?? approvedFinalReportIntent.reportKind;
  const requestedOutputSurface =
    reportRevisionIntent.requestedSurface ?? approvedFinalReportIntent.requestedSurface;
  // Final-output availability is RUNTIME-OWNED and gated on the Context Engine's
  // isolation / terminal state. It MUST NOT be inferred from technician-wording
  // heuristics (complaint + findings + corrective-action regex signals). Allowing
  // wording-based readiness here would create a hidden second flow authority
  // outside the Context Engine, violate ARCHITECTURE_RULES A1 / G1b, and permit
  // the report surface to open before the doctrine-required readiness gate is
  // satisfied. See CUSTOMER_BEHAVIOR_SPEC §6 and ROADMAP §7.1 / §7.4.
  //
  // `repairSummaryIntent` is retained as an assessment object for observability
  // and for tests, but it is NOT consulted as a final-output gate.
  //
  // LLM RUNTIME SIGNALS (advisory): when the feature flag is ON and the sidecar
  // report-readiness proposal is accepted, server may open the report surface
  // even if Context Engine isolation hasn't been explicitly flipped — but only
  // under `mayOpenReportSurface` rules which still respect the active-procedure
  // isolation-not-complete boundary. This does NOT give the LLM state authority.
  const sidecarPermitsReportSurface = Boolean(
    sidecarSignals &&
      sidecarServerState &&
      mayOpenReportSurface(sidecarSignals, sidecarServerState).allowed,
  );
  const readyForImmediateReport =
    runtimeReportReady || sidecarPermitsReportSurface;
  // Explicit non-use marker for repairSummaryIntent — kept available for
  // observability (and for existing unit tests that import the assessor),
  // but deliberately NOT consulted in the readiness gate above.
  void repairSummaryIntent;
  // NOTE: We never ask the technician to author complaint/findings/performed
  // repair as the default path. When a report request arrives, either the
  // assistant assembles the draft from the transcript (ready case), or we
  // hold in diagnostics (not-ready case).
  void hasPriorUserEvidence;
  const storedRoofAcEvidenceMessage =
    historyBeforeAppend.find(
      (msg) => msg.role === "user" && hasSpecificRoofAcEvidence(msg.content),
    )?.content ?? null;
  const needsAcSubtypeClarification =
    currentMode === "diagnostic" &&
    !effectiveHasBoundedReportRequest &&
    !currentContextSnapshot.activeProcedureId &&
    detectSystem(routingMessage) === null &&
    isBroadAcFamilyMessage(routingMessage) &&
    !hasSpecificRoofAcEvidence(routingMessage) &&
    !storedRoofAcEvidenceMessage;
  const directDiagnosticResponse = needsAcSubtypeClarification
    ? buildAcSubtypeClarificationResponse(outputPolicy.effective)
    : null;

  const modeResolution = pendingFinalReportCommand;
  // When a final report already exists AND the technician sends a narrow
  // line-item edit (e.g. "исправь - <item>: 0.3 ч"), prefer the REPORT
  // REVISION path over the broad LABOR TOTAL OVERRIDE path. This prevents
  // the post-final "If you want the report now... / START FINAL REPORT"
  // restart loop observed in Case-58 when the labor-total regex falsely
  // captures a per-line labor correction.
  const postFinalLineEdit =
    existingReportInContext &&
    reportRevisionIntent.matched &&
    (reportRevisionIntent.isLineEdit ?? false);

  if (postFinalLineEdit) {
    reportPromptConstraint = [
      buildReportTypePromptConstraint(requestedReportKind),
      buildReportRevisionPromptConstraint(message),
    ]
      .filter(Boolean)
      .join("\n\n");

    if (currentMode !== "final_report") {
      currentMode = "final_report";
      await storage.updateCase(ensuredCase.id, { mode: currentMode });
      console.log(`[Chat API v2] Mode transition: ${storedMode} → final_report (post-final line-item revision)`);
    } else {
      console.log(`[Chat API v2] Mode held as final_report (post-final line-item revision)`);
    }
  } else if (existingReportInContext && precomputedLaborOverride.isLaborOverrideRequest) {
    currentMode = "final_report";
    console.log(`[Chat API v2] Mode held in-memory as final_report (existing report labor override)`);
  } else if (existingReportInContext && (reportRevisionIntent.matched || approvedFinalReportIntent.matched)) {
    reportPromptConstraint = [
      buildReportTypePromptConstraint(requestedReportKind),
      buildReportRevisionPromptConstraint(message),
    ]
      .filter(Boolean)
      .join("\n\n");

    if (currentMode !== "final_report") {
      currentMode = "final_report";
      await storage.updateCase(ensuredCase.id, { mode: currentMode });
      console.log(`[Chat API v2] Mode transition: ${storedMode} → final_report (existing report revision)`);
    }
  } else if (effectiveHasBoundedReportRequest) {
    if (readyForImmediateReport) {
      reportPromptConstraint = [
        buildReportTypePromptConstraint(requestedReportKind),
        buildTranscriptDerivedDraftConstraint(),
      ]
        .filter(Boolean)
        .join("\n\n");

      if (currentMode !== "final_report") {
        currentMode = "final_report";
        await storage.updateCase(ensuredCase.id, { mode: currentMode });
        console.log(`[Chat API v2] Mode transition: ${storedMode} → final_report (report request routed by readiness)`);
      }
    } else if (Boolean(currentContextSnapshot.activeProcedureId) && !runtimeReportReady) {
      // Active diagnostic procedure with isolation not complete.
      // Do NOT fall to repair-summary questionnaire — defer to post-context-engine
      // where the context engine may resolve readiness.
      console.log(`[Chat API v2] Report request deferred — active procedure, isolation not complete`);
    }
    // No other branch: we NEVER ask the technician to author
    // complaint / findings / performed repair as the default. When report
    // becomes ready, the assistant assembles the draft from the transcript.
  } else if (modeResolution.changed) {
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

  let currentOutputSurface: OutputSurface = resolveOutputSurface({
    mode: currentMode,
    requestedSurface: requestedOutputSurface,
  });

  let stepGuidancePlan: StepGuidancePlan | null = null;

  if (currentMode === "diagnostic" && !reportRoutingResponse && !directDiagnosticResponse) {
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
        stepGuidancePlan = {
          fallbackResponse: buildValidatedStepGuidanceFallback({
            language: outputPolicy.effective,
            stepQuestion: stepGuidanceMetadata.question,
            guidance: stepGuidanceMetadata.howToCheck,
            logLabel: stepGuidanceMetadata.id,
          }),
          intentCategory: guidanceIntent.category,
          metadata: stepGuidanceMetadata,
          source: "preclassified",
          systemPrompt: buildStepGuidanceClarificationSystemPrompt({
            language: outputPolicy.effective,
            stepQuestion: stepGuidanceMetadata.question,
            guidance: stepGuidanceMetadata.howToCheck,
            continuation: getStepGuidanceContinuation(outputPolicy.effective),
            hasPhotoAttachment: attachmentCount > 0,
          }),
        };

        console.log(`[Chat API v2] STEP_GUIDANCE detected for step ${stepGuidanceMetadata.id} (${guidanceIntent.category})`);
      }
    }
  }

  await appendUserChatMessage({
    caseId: ensuredCase.id,
    message,
    language: detectedInputLanguage.detected,
    userId: user?.id,
  });

  const history: Pick<ChatMessage, "role" | "content">[] = stepGuidancePlan
    ? []
    : [
        ...historyBeforeAppend,
        { role: "user", content: message },
      ];

  // ── CONTEXT ENGINE: SINGLE FLOW AUTHORITY ─────────────────────────
  let procedureContext = "";
  let engineResult: ContextEngineResult | null = null;
  let contextEngineDirectives = "";
  let activeStepMetadata: RegistryActiveStepMetadata | null = null;
  let finalReportAuthorityFacts: FinalReportAuthorityFacts | null = null;

  if (currentMode === "diagnostic" && !stepGuidancePlan && !reportRoutingResponse && !directDiagnosticResponse) {
    if (!STRICT_CONTEXT_ENGINE) {
      console.error("[Chat API v2] STRICT_CONTEXT_ENGINE is disabled — this is not supported in production");
    }

    const initResult = initializeCase(
      ensuredCase.id,
      storedRoofAcEvidenceMessage &&
        !currentContextSnapshot.activeProcedureId &&
        detectSystem(routingMessage) === null &&
        isBroadAcFamilyMessage(routingMessage)
        ? storedRoofAcEvidenceMessage
        : routingMessage,
    );
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

    // ── CONSUME ADJUDICATED DIAGNOSTIC SIGNALS ───────────────────────
    // Server-owned consumption of accepted subtype-lock / step-issue
    // signals from the already-merged sidecar adjudication layer.
    //
    // AUTHORITY BOUNDARY:
    //   - Only signals with verdict `accepted: true` are consumed.
    //   - Consumption uses existing server-owned registry primitives
    //     (`addSubtypeExclusionsFromSignal`, `forceStepComplete`).
    //   - Context Engine is NOT mutated directly here. Subsequent step
    //     selection still flows through `getNextStepBranchAware`, which
    //     reads the updated subtype-exclusion set from the registry.
    //   - Consumer fails closed if the flag is OFF, no signals exist,
    //     or no active procedure is bound to the case.
    if (sidecarSignals) {
      const consumerResult = consumeAdjudicatedDiagnosticSignals({
        caseId: ensuredCase.id,
        signals: sidecarSignals,
        activeStepId: stepIdBeforeProcessing,
      });
      if (
        consumerResult.subtypeExclusionsAdded.length > 0 ||
        consumerResult.stepIssueActions.length > 0
      ) {
        console.log(
          `[Chat API v2] Diagnostic runtime signals consumed:`,
          buildConsumerDebug(consumerResult),
        );
      }
    }

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
        "3. End with a concise report invitation that accepts either a natural report request or START FINAL REPORT.",
        "   (English example: 'If you want the report now, ask me to write the report, or send START FINAL REPORT.')",
        "   (Russian example: 'Если хотите отчёт сейчас, попросите меня сделать отчёт или отправьте START FINAL REPORT.')",
        "   (Spanish example: 'Si quieres el informe ahora, pídeme que lo prepare o envía START FINAL REPORT.')",
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
        registryMarkStepCompleted(ensuredCase.id, currentActiveStep, routingMessage);
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

    const promotedStepMetadata =
      activeStepMetadata ??
      getActiveStepMetadata(
        ensuredCase.id,
        stepIdBeforeProcessing,
        outputPolicy.effective,
      );

    const shouldPromoteToStepGuidance =
      !stepGuidancePlan &&
      engineResult.responseInstructions.action === "provide_clarification" &&
      stepIdBeforeProcessing !== null &&
      engineResult.context.activeStepId === stepIdBeforeProcessing &&
      terminalPhaseAfterProcessing === "normal" &&
      !engineResult.context.isolationComplete &&
      Boolean(promotedStepMetadata);

    if (shouldPromoteToStepGuidance) {
      stepGuidancePlan = {
        fallbackResponse: buildValidatedStepGuidanceFallback({
          language: outputPolicy.effective,
          stepQuestion: promotedStepMetadata?.question,
          guidance: promotedStepMetadata?.howToCheck,
          logLabel: promotedStepMetadata?.id ?? stepIdBeforeProcessing,
        }),
        intentCategory: engineResult.responseInstructions.clarificationType ?? "PROMOTED_CONTEXT_CLARIFICATION",
        metadata: promotedStepMetadata!,
        source: "promoted",
        systemPrompt: buildStepGuidanceClarificationSystemPrompt({
          language: outputPolicy.effective,
          stepQuestion: (promotedStepMetadata?.question ?? getActiveStepQuestion(ensuredCase.id, stepIdBeforeProcessing))!,
          guidance: promotedStepMetadata?.howToCheck,
          continuation: getStepGuidanceContinuation(outputPolicy.effective),
          hasPhotoAttachment: attachmentCount > 0,
        }),
      };

      console.log(`[Chat API v2] STEP_GUIDANCE promoted from Context Engine clarification for step ${stepGuidancePlan.metadata.id}`);
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

    // ── ANTI-INVITATION DIRECTIVE ───────────────────────────────────────
    // When isolation is NOT complete, explicitly prohibit the LLM from
    // inviting or suggesting final report generation.
    if (!engineResult.context.isolationComplete && engineResult.context.terminalState?.phase === "normal") {
      const antiInvitationDirective = [
        "PROHIBITION (MANDATORY):",
        "- Isolation is NOT complete. Diagnostics are still in progress.",
        "- Do NOT suggest or mention generating a final report.",
        "- Do NOT suggest or mention START FINAL REPORT.",
        "- Do NOT say the technician can request a report.",
        "- Continue with the active diagnostic step only.",
      ].join("\n");
      contextEngineDirectives = [contextEngineDirectives, antiInvitationDirective].filter(Boolean).join("\n\n");
    }

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

    if (effectiveHasBoundedReportRequest && currentMode === "diagnostic" && isFinalReportReady(engineResult.context)) {
      currentMode = "final_report";
      await storage.updateCase(ensuredCase.id, { mode: currentMode });
      reportPromptConstraint = [
        buildReportTypePromptConstraint(requestedReportKind),
        buildTranscriptDerivedDraftConstraint(),
      ]
        .filter(Boolean)
        .join("\n\n");
      currentOutputSurface = resolveOutputSurface({
        mode: currentMode,
        requestedSurface: requestedOutputSurface,
      });
      console.log("[Chat API v2] Mode transition: diagnostic → final_report (report request ready after context processing)");
    } else if (effectiveHasBoundedReportRequest && currentMode === "diagnostic") {
      // Diagnostics are unresolved — do NOT fall to repair-summary questionnaire.
      // Stay in diagnostic mode and continue from the correct legal state.
      reportRoutingResponse = buildDiagnosticsNotReadyResponse(outputPolicy.effective);
      console.log(`[Chat API v2] Report request blocked post-context — diagnostics unresolved`);
    }
  }

  // ── FACT LOCK ─────────────────────────────────────────────────────
  let factLockConstraint = "";
  if (currentOutputSurface === "authorization_ready") {
    factLockConstraint = buildFactLockConstraint(history);
  }

  if (currentOutputSurface === "shop_final_report" || currentOutputSurface === "portal_cause") {
    const reportContext = getOrCreateContext(ensuredCase.id);
    finalReportAuthorityFacts = deriveFinalReportAuthorityFacts(history, reportContext);
    factLockConstraint = [
      buildFinalReportAuthorityConstraint(finalReportAuthorityFacts),
      buildFactLockConstraint(history),
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  factLockConstraint = [factLockConstraint, reportPromptConstraint]
    .filter(Boolean)
    .join("\n\n");

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
  // Post-final line-item revisions are NOT labor-total overrides — they must
  // flow through the primary completion path with the REPORT REVISION prompt
  // so the LLM patches the existing report line-by-line instead of rewriting
  // the Estimated Labor section to a single-item total.
  const isLaborOverrideRequest = postFinalLineEdit
    ? false
    : laborOverride.isLaborOverrideRequest;
  const requestedLaborHours = postFinalLineEdit ? null : laborOverride.requestedLaborHours;
  const requestedLaborHoursText =
    requestedLaborHours !== null ? formatLaborHours(requestedLaborHours) : null;

  // ── COMPOSE SYSTEM PROMPT ─────────────────────────────────────────
  const composePromptStart = Date.now();
  const { systemPrompt } = buildChatSystemPrompt({
    mode: currentMode,
    outputSurface: currentOutputSurface,
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
        controller.enqueue(encoder.encode(sseEncode({ type: "output_surface", surface: currentOutputSurface })));

        const directRoutingResponse = reportRoutingResponse ?? directDiagnosticResponse;

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

          if (currentMode === "diagnostic" && reportRoutingResponse) {
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

        if (stepGuidancePlan) {
          const stepGuidanceResult = await executeStepGuidanceCompletion({
            apiKey,
            caseId: ensuredCase.id,
            systemPrompt: stepGuidancePlan.systemPrompt,
            message,
            attachments,
            signal: ac.signal,
            emitToken,
            isAborted: () => aborted,
            outputLanguage: outputPolicy.effective,
            langPolicy: langPolicy,
            fallbackResponse: stepGuidancePlan.fallbackResponse,
            requiredContinuation: getStepGuidanceContinuation(outputPolicy.effective),
            model: getModelForMode(currentMode),
            requestStartedAt,
          });

          full = stepGuidanceResult.response;

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
                stepId: stepGuidancePlan.metadata.id,
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
        if (
          currentOutputSurface === "shop_final_report" &&
          isLaborOverrideRequest &&
          requestedLaborHours !== null &&
          requestedLaborHoursText
        ) {
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
          outputSurface: currentOutputSurface,
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