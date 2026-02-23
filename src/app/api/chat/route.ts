import { 
  normalizeLanguageMode, 
  detectInputLanguageV2, 
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
  detectTransitionSignal,
  type CaseMode,
  DEFAULT_MEMORY_WINDOW,
} from "@/lib/prompt-composer";
import {
  validateOutput,
  getSafeFallback,
  buildCorrectionInstruction,
  logValidation,
} from "@/lib/mode-validators";
import {
  setLaborEstimate,
  confirmLabor,
  getLaborEntry,
  extractLaborEstimate,
  parseLaborConfirmation,
} from "@/lib/labor-store";
import {
  // Diagnostic Registry — DATA PROVIDER ONLY (not flow authority)
  // Used for: procedure catalog, step definitions, static metadata
  // NOT used for: flow decisions, step selection, pivot logic
  initializeCase,
  buildRegistryContext,
  areMechanicalChecksComplete,
} from "@/lib/diagnostic-registry";
import {
  // Context Engine — SINGLE FLOW AUTHORITY
  // All flow decisions, submode selection, replan, loop guard come from here
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

// ── Strict Context Engine Mode ──────────────────────────────────────
// When true (default), all diagnostic flow decisions come from Context Engine.
// Legacy diagnostic-registry is used ONLY as a data provider.
const STRICT_CONTEXT_ENGINE = true;

export const runtime = "nodejs";

// Translation separator (must match mode-validators / output-validator)
const TRANSLATION_SEPARATOR = "--- TRANSLATION ---";

// Debug flag for Context Engine state tracing (local/dev only).
// Enable with: DEBUG_CONTEXT_ENGINE=1
const DEBUG_CONTEXT_ENGINE = process.env.DEBUG_CONTEXT_ENGINE === "1";

function debugContextEngineState(label: string, ctx: DiagnosticContext) {
  if (!DEBUG_CONTEXT_ENGINE) return;

  // Use a safe "any" view to avoid tight coupling to internal context shape.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = ctx;

  const completedSteps: string[] | undefined = Array.isArray(c.completedSteps) ? c.completedSteps : undefined;
  const lastCompletedStepId = completedSteps && completedSteps.length > 0 ? completedSteps[completedSteps.length - 1] : undefined;

  const topicStackDepth = Array.isArray(c.topicStack) ? c.topicStack.length : undefined;

  console.log("[Chat API v2][DEBUG][ContextEngine]", label, {
    activeProcedureId: c.activeProcedureId ?? undefined,
    activeStepId: c.activeStepId ?? undefined,
    submode: c.submode ?? undefined,
    isolationComplete: c.isolationComplete ?? undefined,
    isolationFinding: c.isolationFinding ?? undefined,
    replanReason: c.replanReason ?? undefined,
    completedStepsCount: completedSteps?.length ?? undefined,
    lastCompletedStepId,
    topicStackDepth,
  });
}


/**
 * Output-layer enforcement: strip translation block when policy says none.
 * This is the final safety net — even if the LLM produces a translation,
 * it will be removed before the user sees it.
 */
function enforceLanguagePolicy(text: string, policy: LanguagePolicy): string {
  if (!policy.includeTranslation && text.includes(TRANSLATION_SEPARATOR)) {
    return text.split(TRANSLATION_SEPARATOR)[0].trim();
  }
  return text;
}

// Attachment validation constants
const MAX_ATTACHMENTS = 10;
const MAX_TOTAL_ATTACHMENT_BYTES = 6_000_000; // 6MB server-side (slightly higher than client)

type Attachment = {
  type: "image";
  dataUrl: string;
};

/**
 * Validate attachments array
 */
function validateAttachments(attachments: Attachment[] | undefined): { 
  valid: boolean; 
  error?: string;
  totalBytes?: number;
} {
  if (!attachments || attachments.length === 0) {
    return { valid: true, totalBytes: 0 };
  }

  // Check count
  if (attachments.length > MAX_ATTACHMENTS) {
    return { 
      valid: false, 
      error: `Maximum ${MAX_ATTACHMENTS} images allowed per message. Received ${attachments.length}.`
    };
  }

  let totalBytes = 0;
  
  for (let i = 0; i < attachments.length; i++) {
    const attachment = attachments[i];
    
    // Check type
    if (attachment.type !== "image") {
      return { valid: false, error: `Attachment ${i + 1} has invalid type: ${attachment.type}` };
    }
    
    // Check dataUrl format
    if (!attachment.dataUrl || typeof attachment.dataUrl !== "string") {
      return { valid: false, error: `Attachment ${i + 1} has invalid dataUrl` };
    }
    
    if (!attachment.dataUrl.startsWith("data:image/")) {
      return { valid: false, error: `Attachment ${i + 1} is not a valid image (must be image/*)` };
    }
    
    // Calculate approximate byte size
    const base64Data = attachment.dataUrl.split(",")[1] || "";
    const sizeBytes = Math.ceil(base64Data.length * 0.75);
    totalBytes += sizeBytes;
  }
  
  // Check total size
  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    const totalMB = (totalBytes / 1024 / 1024).toFixed(1);
    const maxMB = (MAX_TOTAL_ATTACHMENT_BYTES / 1024 / 1024).toFixed(0);
    return { 
      valid: false, 
      error: `Total attachment size (${totalMB}MB) exceeds limit (${maxMB}MB)` 
    };
  }
  
  return { valid: true, totalBytes };
}

/**
 * Build vision enforcement instruction for the model
 */
function buildVisionInstruction(attachmentCount: number): string {
  if (attachmentCount === 0) return "";
  
  const plural = attachmentCount > 1 ? "s" : "";
  return `

VISION INPUT: ${attachmentCount} image${plural} attached.

CRITICAL VISION RULES:
- You MUST describe what you ACTUALLY SEE in the image${plural}.
- Start your response with a brief summary of visible observations from the image${plural}.
- Do NOT invent, guess, or hallucinate any details not visible in the image${plural}.
- Do NOT make up serial numbers, part numbers, readings, or measurements unless clearly visible.
- If an image is unclear, blurry, too dark, or does not show relevant information, state this explicitly and request a clearer photo.
- Use observations from images as additional diagnostic evidence alongside technician's verbal reports.
- If the image shows damage, wear, or abnormal conditions, describe them using neutral technical language.

After your visual observations, continue with the appropriate diagnostic mode response.
`;
}

/**
 * Payload v2 request body
 */
type ChatBodyV2 = {
  v?: 2;
  caseId?: string;
  message: string;
  
  // V2: output policy (selector value)
  output?: {
    mode?: LanguageMode;
  };
  
  // Legacy v1 fields (backward compatibility)
  languageMode?: LanguageMode;
  dialogueLanguage?: Language;
  
  attachments?: Attachment[];
};

function sseEncode(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

type OpenAiMessageContent =
  | string
  | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;

function buildOpenAiMessages(args: {
  system: string;
  history: { role: "user" | "assistant"; content: string }[];
  userMessage: string;
  attachments?: Attachment[];
  correctionInstruction?: string;
}): Array<{ role: string; content: OpenAiMessageContent }> {
  const messages: Array<{ role: string; content: OpenAiMessageContent }> = [
    { role: "system", content: args.system },
    ...args.history.map((m) => ({ role: m.role, content: m.content })),
  ];

  // Build user message with optional image attachments
  if (args.attachments && args.attachments.length > 0) {
    const contentParts: Array<
      { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
    > = [{ type: "text", text: args.userMessage }];

    for (const attachment of args.attachments) {
      if (attachment.type === "image" && attachment.dataUrl) {
        contentParts.push({
          type: "image_url",
          image_url: { url: attachment.dataUrl },
        });
      }
    }

    messages.push({ role: "user", content: contentParts });
  } else {
    messages.push({ role: "user", content: args.userMessage });
  }

  // Add correction instruction if retrying
  if (args.correctionInstruction) {
    messages.push({ role: "user", content: args.correctionInstruction });
  }

  return messages;
}

/**
 * Call OpenAI (non-streaming) and return the response
 */
async function callOpenAI(
  apiKey: string,
  body: object,
  signal: AbortSignal
): Promise<{ response: string; error?: string }> {
  try {
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      return { response: "", error: `Upstream error (${upstream.status}) ${text}`.slice(0, 500) };
    }

    // Non-streaming: read the full JSON response
    const json = await upstream.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };

    // Check for API error in response
    if (json.error) {
      return { response: "", error: `OpenAI error: ${json.error.message || "Unknown"}` };
    }

    // Extract content from chat completions format
    const content = json.choices?.[0]?.message?.content ?? "";
    
    if (!content) {
      console.warn("[Chat API] Empty content from OpenAI response:", JSON.stringify(json).slice(0, 500));
    }

    return { response: content };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return { response: "", error: msg };
  }
}

export async function POST(req: Request) {
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

  // ========================================
  // ATTACHMENT VALIDATION
  // ========================================
  const rawAttachments = body?.attachments?.filter(
    (a) => a.type === "image" && a.dataUrl && a.dataUrl.startsWith("data:image/")
  );
  
  const attachmentValidation = validateAttachments(rawAttachments);
  if (!attachmentValidation.valid) {
    return new Response(
      JSON.stringify({ error: attachmentValidation.error }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
  
  const attachments = rawAttachments;
  const attachmentCount = attachments?.length ?? 0;
  
  // Log attachment stats (never log raw data)
  if (attachmentCount > 0) {
    console.log(`[Chat API v2] Attachments: count=${attachmentCount}, totalBytes=${attachmentValidation.totalBytes}`);
  }

  // ========================================
  // PAYLOAD V2: Language Detection & Policy
  // ========================================
  
  // 1. ALWAYS detect input language from message text (source of truth)
  const inputLanguage: InputLanguageV2 = detectInputLanguageV2(message);
  
  // 2. Get output mode from request (v2 or legacy v1)
  const outputMode: LanguageMode = normalizeLanguageMode(
    body?.output?.mode ?? body?.languageMode
  );
  
  // 3. Compute effective output language
  const outputPolicy: OutputLanguagePolicyV2 = computeOutputPolicy(outputMode, inputLanguage.detected);
  
  // 4. Resolve declarative language policy (single source of truth for translation behavior)
  const langPolicy: LanguagePolicy = resolveLanguagePolicy(outputMode, inputLanguage.detected);
  
  console.log(`[Chat API v2] Input: detected=${inputLanguage.detected} (${inputLanguage.reason}), Output: mode=${outputPolicy.mode}, effective=${outputPolicy.effective}, strategy=${outputPolicy.strategy}, includeTranslation=${langPolicy.includeTranslation}`);

  // Ensure case exists - use detected language for case, not forced output
  const ensuredCase = await storage.ensureCase({
    caseId: body?.caseId,
    titleSeed: message,
    inputLanguage: inputLanguage.detected,
    languageSource: outputPolicy.strategy === "auto" ? "AUTO" : "MANUAL",
    userId: user?.id,
  });

  // Get current mode from case
  let currentMode: CaseMode = ensuredCase.mode || "diagnostic";

  // Check for explicit mode transition commands
  const commandMode = detectModeCommand(message);
  if (commandMode && commandMode !== currentMode) {
    console.log(`[Chat API v2] Mode transition: ${currentMode} → ${commandMode} (explicit command)`);
    currentMode = commandMode;
    await storage.updateCase(ensuredCase.id, { mode: currentMode });
  }

  // Persist user message with detected language
  await storage.appendMessage({
    caseId: ensuredCase.id,
    role: "user",
    content: message,
    language: inputLanguage.detected,
    userId: user?.id,
  });

  // Load conversation history (memory window)
  const history = await storage.listMessagesForContext(ensuredCase.id, DEFAULT_MEMORY_WINDOW);

  // ========================================
  // CONTEXT ENGINE: SINGLE FLOW AUTHORITY
  // ========================================
  // All diagnostic flow decisions come from Context Engine.
  // Legacy registry is used ONLY as a data provider for step metadata.
  
  let procedureContext = "";  // Step metadata from registry (data only)
  let pivotTriggered = false;
  let engineResult: ContextEngineResult | null = null;
  let contextEngineDirectives = "";

  if (currentMode === "diagnostic") {
    // ── STRICT MODE GUARD ──
    if (!STRICT_CONTEXT_ENGINE) {
      console.error("[Chat API v2] STRICT_CONTEXT_ENGINE is disabled — this is not supported in production");
    }
    
    // ── DATA PROVIDER: Initialize procedure catalog ──
    // This ONLY provides step metadata; it does NOT control flow
    const initResult = initializeCase(ensuredCase.id, message);
    if (initResult.procedure && initResult.preCompletedSteps.length > 0) {
      console.log(`[Chat API v2] Procedure catalog: ${initResult.procedure.displayName}, initial steps: ${initResult.preCompletedSteps.join(", ")}`);
      // Sync pre-completed steps to Context Engine
      for (const stepId of initResult.preCompletedSteps) {
        markContextStepCompleted(ensuredCase.id, stepId);
      }
    } else if (initResult.system) {
      console.log(`[Chat API v2] Procedure catalog: ${initResult.system}`);
    }


    // ── CONTEXT ENGINE SYNC (production-safe) ─────────────────────────────
    // Registry is a DATA PROVIDER. Context Engine is the SINGLE flow authority.
    // However, the Context Engine still needs the active procedure/step IDs so that
    // clarification requests like “How do I check that?” remain anchored to the
    // correct step instead of drifting.
    if (initResult.procedure) {
      const ctx = getOrCreateContext(ensuredCase.id) as DiagnosticContext;

      const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
      const getString = (obj: unknown, key: string): string | null => {
        if (!isRecord(obj)) return null;
        const val = obj[key];
        return typeof val === "string" && val.trim().length > 0 ? val : null;
      };
      const getSteps = (obj: unknown): Array<Record<string, unknown>> => {
        if (!isRecord(obj)) return [];
        const candidate = obj["steps"];
        return Array.isArray(candidate) ? candidate.filter(isRecord) : [];
      };

      const procUnknown: unknown = initResult.procedure;
      const procedureId = getString(procUnknown, "id") ?? getString(procUnknown, "procedureId") ?? getString(procUnknown, "key");
      const steps = getSteps(procUnknown);

      const completedStepsRaw = (ctx as unknown as { completedSteps?: unknown }).completedSteps;
      const completedSteps: string[] = Array.isArray(completedStepsRaw)
        ? completedStepsRaw.filter((x): x is string => typeof x === "string")
        : [];

      const firstRemainingStepId =
        steps
          .map((s) => getString(s, "id"))
          .find((id): id is string => typeof id === "string" && !completedSteps.includes(id)) ?? undefined;

      const nextCtx: DiagnosticContext = {
        ...ctx,
        activeProcedureId: (ctx as unknown as { activeProcedureId?: unknown }).activeProcedureId ?? procedureId ?? undefined,
        activeStepId: (ctx as unknown as { activeStepId?: unknown }).activeStepId ?? firstRemainingStepId,
      } as DiagnosticContext;

      const beforeProc = (ctx as unknown as { activeProcedureId?: unknown }).activeProcedureId;
      const beforeStep = (ctx as unknown as { activeStepId?: unknown }).activeStepId;
      const afterProc = (nextCtx as unknown as { activeProcedureId?: unknown }).activeProcedureId;
      const afterStep = (nextCtx as unknown as { activeStepId?: unknown }).activeStepId;

      if (beforeProc !== afterProc || beforeStep !== afterStep) {
        updateContext(nextCtx);
        console.log(
          `[Chat API v2] Context synced: activeProcedureId=${typeof afterProc === "string" ? afterProc : "n/a"}, ` +
          `activeStepId=${typeof afterStep === "string" ? afterStep : "n/a"}`
        );
      }
    }

    // ── FLOW AUTHORITY: Context Engine ──
    // Process message through Context Engine (BEFORE LLM invocation)
    engineResult = processContextMessage(ensuredCase.id, message, DEFAULT_CONFIG);
    
    // Validate engine result (strict guard)
    if (!engineResult || !engineResult.context) {
      console.error("[Chat API v2] CRITICAL: Context Engine returned invalid result — using safe fallback");
      // Safe controlled response instead of legacy fallback
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
    
    // Log context engine decision (SINGLE SOURCE OF TRUTH)
    console.log(`[Chat API v2] Context Engine: intent=${engineResult.intent.type}, submode=${engineResult.context.submode}, stateChanged=${engineResult.stateChanged}`);
    debugContextEngineState("after_processMessage", engineResult.context);

    
    if (engineResult.notices.length > 0) {
      console.log(`[Chat API v2] Context Engine notices: ${engineResult.notices.join(", ")}`);
    }

    // ── FLOW DECISION: Replan ──
    // Replan is controlled ONLY by Context Engine
    if (isInReplanState(engineResult.context)) {
      console.log(`[Chat API v2] REPLAN triggered (Context Engine): ${engineResult.context.replanReason}`);
      pivotTriggered = false; // Reset pivot — we're replanning
    }
    
    // ── FLOW DECISION: Clarification ──
    // Clarification subflows are controlled ONLY by Context Engine
    if (isInClarificationSubflow(engineResult.context)) {
      console.log(`[Chat API v2] Clarification subflow (Context Engine): ${engineResult.context.submode}`);
    }
    
    // ── FLOW DECISION: Pivot ──
    // Isolation/pivot is controlled ONLY by Context Engine
    // BUT we MUST check mechanical steps are complete first
    if (engineResult.context.isolationComplete && engineResult.context.isolationFinding) {
      // Check if mechanical checks are done
      const mechanicalCheck = areMechanicalChecksComplete(ensuredCase.id);
      
      if (!mechanicalCheck.complete && mechanicalCheck.pendingStep) {
        // Mechanical check pending — DO NOT pivot yet
        console.log(`[Chat API v2] Pivot BLOCKED — mechanical check pending: ${mechanicalCheck.pendingStep.id}`);
        pivotTriggered = false;
        
        // Add directive to ask the mechanical step
        contextEngineDirectives = [
          `MECHANICAL CHECK REQUIRED (MUST ASK BEFORE PORTAL):`,
          `The following step MUST be completed before isolation can be confirmed:`,
          `- Step ${mechanicalCheck.pendingStep.id}: "${mechanicalCheck.pendingStep.question}"`,
          `Ask this question NOW. Do not proceed to Portal/Final Report until this is answered.`,
          contextEngineDirectives,
        ].filter(Boolean).join("\n\n");
      } else {
        pivotTriggered = true;
        console.log(`[Chat API v2] Pivot triggered (Context Engine): "${engineResult.context.isolationFinding}"`);
      }
    }
    
    // ── BUILD DIRECTIVES: Anti-loop, replan, clarification ──
    const antiLoopDirectives = generateAntiLoopDirectives(engineResult.context);
    const replanNotice = buildReplanNotice(engineResult.context);
    const clarificationInstruction = buildReturnToMainInstruction(engineResult.context);
    
    contextEngineDirectives = [
      ...antiLoopDirectives,
      replanNotice,
      clarificationInstruction,
    ].filter(Boolean).join("\n\n");
    
    // ── DATA PROVIDER: Step metadata context ──
    // This provides step text/questions to the LLM; it does NOT control flow
    procedureContext = buildRegistryContext(ensuredCase.id);
  }

  // ========================================
  // FACT LOCK: build constraint for final report
  // ========================================
  let factLockConstraint = "";
  if (currentMode === "final_report" || currentMode === "labor_confirmation") {
    factLockConstraint = buildFactLockConstraint(history);
  }

  // Compose system prompt using v2 semantics:
  // - inputDetected: what language user wrote in
  // - outputEffective: what language assistant must respond in
  // - includeTranslation / translationLanguage: from LanguagePolicy (declarative)
  // - Add vision instruction if images are attached
  //
  // Constraints hierarchy (Context Engine is authority):
  // 1. contextEngineDirectives: anti-loop, replan, clarification (FLOW AUTHORITY)
  // 2. procedureContext: step metadata, questions (DATA PROVIDER)
  // 3. factLockConstraint: fact lock for final report
  const additionalConstraints = [contextEngineDirectives, procedureContext, factLockConstraint]
    .filter(Boolean)
    .join("\n\n") || undefined;

  const baseSystemPrompt = composePromptV2({
    mode: currentMode,
    inputDetected: inputLanguage.detected,
    outputEffective: outputPolicy.effective,
    includeTranslation: langPolicy.includeTranslation,
    translationLanguage: langPolicy.translationLanguage,
    additionalConstraints,
  });
  
  const visionInstruction = buildVisionInstruction(attachmentCount);
  const systemPrompt = baseSystemPrompt + visionInstruction;

  const encoder = new TextEncoder();
  const ac = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";
      let aborted = false;

      const onAbort = () => {
        aborted = true;
        try { ac.abort(); } catch { /* ignore */ }
      };

      req.signal.addEventListener("abort", onAbort, { once: true });

      try {
        // Emit case ID
        controller.enqueue(encoder.encode(sseEncode({ type: "case", caseId: ensuredCase.id })));
        
        // Emit v2 language event (new!)
        controller.enqueue(encoder.encode(sseEncode({
          type: "language",
          inputDetected: inputLanguage.detected,
          outputMode: outputPolicy.mode,
          outputEffective: outputPolicy.effective,
          detector: inputLanguage.source,
          confidence: inputLanguage.confidence,
        })));
        
        // Emit mode
        controller.enqueue(encoder.encode(sseEncode({ type: "mode", mode: currentMode })));

        // Build initial request
        const openAiBody = {
          model: "gpt-4o-mini",
          stream: false,
          temperature: 0.2,
          messages: buildOpenAiMessages({
            system: systemPrompt,
            history,
            userMessage: message,
            attachments,
          }),
        };

        // First attempt
        let result = await callOpenAI(apiKey, openAiBody, ac.signal);

        if (result.error) {
          controller.enqueue(
            encoder.encode(sseEncode({ type: "error", code: "UPSTREAM_ERROR", message: result.error }))
          );
          controller.enqueue(encoder.encode(sseEncode({ type: "done" })));
          controller.close();
          return;
        }

        // Validate output (pass language policy for translation enforcement)
        let validation = validateOutput(result.response, currentMode, langPolicy.includeTranslation);
        logValidation(validation, { caseId: ensuredCase.id, mode: currentMode });

        // If validation fails, retry once with correction
        if (!validation.valid && !aborted) {
          console.log(`[Chat API v2] Validation failed, retrying with correction...`);
          
          const correctionInstruction = buildCorrectionInstruction(validation.violations);
          
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

          result = await callOpenAI(apiKey, retryBody, ac.signal);

          if (!result.error) {
            validation = validateOutput(result.response, currentMode, langPolicy.includeTranslation);
            logValidation(validation, { caseId: ensuredCase.id, mode: currentMode });
          }

          // If still fails, use safe fallback with EFFECTIVE OUTPUT language
          if (!validation.valid || result.error) {
            console.log(`[Chat API v2] Retry failed, using safe fallback in ${outputPolicy.effective}`);
            result.response = getSafeFallback(currentMode, outputPolicy.effective);
            
            controller.enqueue(
              encoder.encode(sseEncode({ 
                type: "validation_fallback", 
                violations: validation.violations 
              }))
            );
          }
        }

        full = result.response;

        // ========================================
        // CONTEXT ENGINE: Record agent action (AFTER LLM response)
        // ========================================
        if (currentMode === "diagnostic" && engineResult) {
          // Determine action type based on response content
          const actionType = isFallbackResponse(full) ? "fallback" : 
                            engineResult.context.submode !== "main" ? "clarification" : "question";

          debugContextEngineState("before_recordAgentAction", engineResult.context);
          
          recordAgentAction(ensuredCase.id, {
            type: actionType,
            content: full.slice(0, 200), // Truncate for storage
            stepId: engineResult.context.activeStepId || undefined,
            submode: engineResult.context.submode,
          }, DEFAULT_CONFIG);
          
          console.log(`[Chat API v2] Context Engine: recorded action type=${actionType}`);
          
          // Clear replan state after acknowledgment
          if (isInReplanState(engineResult.context)) {
            const updatedCtx = clearReplanState(engineResult.context);
            updateContext(updatedCtx);
            console.log(`[Chat API v2] Context Engine: cleared replan state`);
          }
          
          // Pop clarification topic if agent provided the clarification
          if (isInClarificationSubflow(engineResult.context)) {
            const updatedCtx = popTopic(engineResult.context);
            updateContext(updatedCtx);
            console.log(`[Chat API v2] Context Engine: popped clarification topic, returning to main`);
          }
        }

        // ========================================
        // PIVOT CHECK: key finding forces early transition
        // ========================================
        if (pivotTriggered && currentMode === "diagnostic" && !aborted) {
          // If the LLM didn't already transition, force it
          const existingTransition = detectTransitionSignal(full);
          if (!existingTransition) {
            console.log(`[Chat API v2] Forcing pivot transition due to key finding`);
            // Stream what the LLM said
            for (const char of full) {
              if (aborted) break;
              controller.enqueue(encoder.encode(sseEncode({ type: "token", token: char })));
            }
            if (full.trim()) {
              await storage.appendMessage({
                caseId: ensuredCase.id,
                role: "assistant",
                content: full,
                language: outputPolicy.effective,
                userId: user?.id,
              });
            }

            // Now force transition DIRECTLY to final_report (skip labor_confirmation)
            // Labor estimate is included in the final report, no interactive confirmation
            currentMode = "final_report";
            await storage.updateCase(ensuredCase.id, { mode: currentMode });
            controller.enqueue(encoder.encode(sseEncode({ type: "mode_transition", from: "diagnostic", to: currentMode })));

            const separator = "\n\n";
            for (const char of separator) {
              controller.enqueue(encoder.encode(sseEncode({ type: "token", token: char })));
            }

            // Check for any explicit labor override in message history
            const laborEntry = getLaborEntry(ensuredCase.id);
            const laborOverride = laborEntry?.confirmedHours ?? laborEntry?.estimatedHours;
            const laborConstraint = laborOverride 
              ? `LABOR CONSTRAINT: Use exactly ${laborOverride} hours as the total labor estimate.`
              : `LABOR ESTIMATE: Include a best-effort labor estimate based on the repair complexity. Format: "Estimated total labor: X.X hours"`;

            // Generate final report directly (no labor confirmation step)
            const finalPrompt = composePromptV2({
              mode: "final_report",
              inputDetected: inputLanguage.detected,
              outputEffective: outputPolicy.effective,
              includeTranslation: langPolicy.includeTranslation,
              translationLanguage: langPolicy.translationLanguage,
              additionalConstraints: laborConstraint,
            });
            const updatedHistoryPivot = await storage.listMessagesForContext(ensuredCase.id, DEFAULT_MEMORY_WINDOW);
            const factLock = buildFactLockConstraint(updatedHistoryPivot);
            
            const finalBody = {
              model: "gpt-4o-mini",
              stream: false,
              temperature: 0.2,
              messages: buildOpenAiMessages({
                system: finalPrompt + (factLock ? `\n\n${factLock}` : ""),
                history: updatedHistoryPivot,
                userMessage: "Key finding confirmed. Generate the Portal/Cause output with labor estimate.",
                attachments: undefined,
              }),
            };
            const finalResult = await callOpenAI(apiKey, finalBody, ac.signal);
            if (!finalResult.error && finalResult.response.trim()) {
              // Extract labor estimate from final report (for records)
              const estimatedHours = extractLaborEstimate(finalResult.response);
              if (estimatedHours) setLaborEstimate(ensuredCase.id, estimatedHours);
              
              for (const char of finalResult.response) {
                if (aborted) break;
                controller.enqueue(encoder.encode(sseEncode({ type: "token", token: char })));
              }
              await storage.appendMessage({
                caseId: ensuredCase.id,
                role: "assistant",
                content: finalResult.response,
                language: outputPolicy.effective,
                userId: user?.id,
              });
              full = full + separator + finalResult.response;
            } else {
              const fallback = getSafeFallback("final_report", outputPolicy.effective);
              for (const char of fallback) {
                if (aborted) break;
                controller.enqueue(encoder.encode(sseEncode({ type: "token", token: char })));
              }
              full = full + separator + fallback;
            }

            controller.enqueue(encoder.encode(sseEncode({ type: "done" })));
            controller.close();
            return; // Early return — pivot handled
          }
        }

        // ========================================
        // AUTOMATIC MODE TRANSITION
        // ========================================
        // Check if LLM signaled a transition (e.g., isolation complete)
        const transitionResult = detectTransitionSignal(full);
        
        if (transitionResult && currentMode === "diagnostic" && !aborted) {
          // Check mechanical steps before allowing transition
          const mechanicalCheck = areMechanicalChecksComplete(ensuredCase.id);
          
          if (!mechanicalCheck.complete && mechanicalCheck.pendingStep) {
            // Mechanical check pending — DO NOT transition yet
            console.log(`[Chat API v2] Auto-transition BLOCKED — mechanical check pending: ${mechanicalCheck.pendingStep.id}`);
            // Stream the response but stay in diagnostic mode
            for (const char of transitionResult.cleanedResponse) {
              if (aborted) break;
              controller.enqueue(encoder.encode(sseEncode({ type: "token", token: char })));
            }
            
            // Append a reminder to ask the mechanical step
            const mechanicalReminder = `\n\nBefore we proceed, I need to verify one more thing: ${mechanicalCheck.pendingStep.question}`;
            for (const char of mechanicalReminder) {
              if (aborted) break;
              controller.enqueue(encoder.encode(sseEncode({ type: "token", token: char })));
            }
            
            await storage.appendMessage({
              caseId: ensuredCase.id,
              role: "assistant",
              content: transitionResult.cleanedResponse + mechanicalReminder,
              language: outputPolicy.effective,
              userId: user?.id,
            });
            
            full = transitionResult.cleanedResponse + mechanicalReminder;
          } else {
            // Mechanical checks complete — transition DIRECTLY to final_report (skip labor_confirmation)
            console.log(`[Chat API v2] Auto-transition detected: diagnostic → final_report (skip labor_confirmation)`);
            
            // Stream the transition message first
            for (const char of transitionResult.cleanedResponse) {
              if (aborted) break;
              controller.enqueue(encoder.encode(sseEncode({ type: "token", token: char })));
            }
            
            // Save the transition message
            if (transitionResult.cleanedResponse.trim()) {
              await storage.appendMessage({
                caseId: ensuredCase.id,
                role: "assistant",
                content: transitionResult.cleanedResponse,
                language: outputPolicy.effective,
                userId: user?.id,
              });
            }
            
            // Update mode DIRECTLY to final_report (skip labor_confirmation)
            currentMode = "final_report";
            await storage.updateCase(ensuredCase.id, { mode: currentMode });
            
            // Emit mode change event
            controller.enqueue(encoder.encode(sseEncode({ type: "mode_transition", from: "diagnostic", to: currentMode })));
            
            // Add a visual separator
            const separator = "\n\n";
            for (const char of separator) {
              controller.enqueue(encoder.encode(sseEncode({ type: "token", token: char })));
            }
            
            // Check for any explicit labor override in message history
            const laborEntry = getLaborEntry(ensuredCase.id);
            const laborOverride = laborEntry?.confirmedHours ?? laborEntry?.estimatedHours;
            const laborConstraint = laborOverride 
              ? `LABOR CONSTRAINT: Use exactly ${laborOverride} hours as the total labor estimate.`
              : `LABOR ESTIMATE: Include a best-effort labor estimate based on the repair complexity. Format: "Estimated total labor: X.X hours"`;
            
            // Generate final report directly (no labor confirmation step)
            const finalPrompt = composePromptV2({
              mode: "final_report",
              inputDetected: inputLanguage.detected,
              outputEffective: outputPolicy.effective,
              includeTranslation: langPolicy.includeTranslation,
              translationLanguage: langPolicy.translationLanguage,
              additionalConstraints: laborConstraint,
            });
            
            const updatedHistory = await storage.listMessagesForContext(ensuredCase.id, DEFAULT_MEMORY_WINDOW);
            const factLock = buildFactLockConstraint(updatedHistory);
            
            const finalBody = {
              model: "gpt-4o-mini",
              stream: false,
              temperature: 0.2,
              messages: buildOpenAiMessages({
                system: finalPrompt + (factLock ? `\n\n${factLock}` : ""),
                history: updatedHistory,
                userMessage: "Generate the Portal/Cause output with labor estimate based on the diagnostic findings.",
                attachments: undefined,
              }),
            };
            
            const finalResult = await callOpenAI(apiKey, finalBody, ac.signal);
            
            if (!finalResult.error && finalResult.response.trim()) {
              const finalContent = finalResult.response;
              
              // Extract and store the estimated hours (for records)
              const estimatedHours = extractLaborEstimate(finalContent);
              if (estimatedHours) {
                setLaborEstimate(ensuredCase.id, estimatedHours);
                console.log(`[Chat API v2] Labor estimate extracted: ${estimatedHours} hr`);
              }
              
              // Stream the final report
              for (const char of finalContent) {
                if (aborted) break;
                controller.enqueue(encoder.encode(sseEncode({ type: "token", token: char })));
              }
              
              // Save the final report message
              await storage.appendMessage({
                caseId: ensuredCase.id,
                role: "assistant",
                content: finalContent,
                language: outputPolicy.effective,
                userId: user?.id,
              });
              
              full = transitionResult.cleanedResponse + separator + finalContent;
            } else if (finalResult.error) {
              console.error(`[Chat API v2] Final report generation error: ${finalResult.error}`);
              // Use fallback
              const fallback = getSafeFallback("final_report", outputPolicy.effective);
              for (const char of fallback) {
                if (aborted) break;
                controller.enqueue(encoder.encode(sseEncode({ type: "token", token: char })));
              }
              await storage.appendMessage({
                caseId: ensuredCase.id,
                role: "assistant",
                content: fallback,
                language: outputPolicy.effective,
                userId: user?.id,
              });
              full = transitionResult.cleanedResponse + separator + fallback;
            }
          }
        } else if (currentMode === "labor_confirmation" && !aborted) {
          // ========================================
          // LEGACY LABOR_CONFIRMATION HANDLER
          // ========================================
          // This mode should no longer be entered (we skip directly to final_report).
          // However, if a case is stuck in this mode, handle it gracefully.
          
          const laborEntry = getLaborEntry(ensuredCase.id);
          
          // Check for explicit labor override in message
          const laborOverridePatterns = [
            /(?:set\s+)?labor\s+(?:to\s+)?(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|hr|h)?/i,
            /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|hr|h)\s*(?:total|labor)/i,
            /change\s+labor\s+to\s+(\d+(?:\.\d+)?)/i,
          ];
          
          let laborOverride: number | null = null;
          for (const pattern of laborOverridePatterns) {
            const match = message.match(pattern);
            if (match) {
              laborOverride = parseFloat(match[1]);
              if (laborOverride > 0 && laborOverride <= 20) break;
              laborOverride = null;
            }
          }
          
          // Also try the standard parser
          if (!laborOverride) {
            laborOverride = parseLaborConfirmation(message, laborEntry?.estimatedHours);
          }
          
          // Store override if found
          if (laborOverride) {
            confirmLabor(ensuredCase.id, laborOverride);
            console.log(`[Chat API v2] Labor override stored: ${laborOverride} hr`);
          }
          
          // Transition directly to final_report (no more confirmation loop)
          console.log(`[Chat API v2] Legacy labor_confirmation → final_report (no confirmation loop)`);
          currentMode = "final_report";
          await storage.updateCase(ensuredCase.id, { mode: currentMode });
          controller.enqueue(encoder.encode(sseEncode({ type: "mode_transition", from: "labor_confirmation", to: currentMode })));
          
          // Generate final report
          const effectiveLaborHours = laborOverride ?? laborEntry?.confirmedHours ?? laborEntry?.estimatedHours ?? 1.0;
          const laborConstraint = `LABOR CONSTRAINT: Use exactly ${effectiveLaborHours} hours as the total labor estimate.`;
          
          const updatedHistoryForReport = await storage.listMessagesForContext(ensuredCase.id, DEFAULT_MEMORY_WINDOW);
          const factLock = buildFactLockConstraint(updatedHistoryForReport);
          
          const finalReportPrompt = composePromptV2({
            mode: currentMode,
            inputDetected: inputLanguage.detected,
            outputEffective: outputPolicy.effective,
            includeTranslation: langPolicy.includeTranslation,
            translationLanguage: langPolicy.translationLanguage,
            additionalConstraints: `${laborConstraint}\n\n${factLock}`,
          });
          
          const finalReportBody = {
            model: "gpt-4o-mini",
            stream: false,
            temperature: 0.2,
            messages: buildOpenAiMessages({
              system: finalReportPrompt,
              history: updatedHistoryForReport,
              userMessage: "Generate the Portal/Cause output with labor estimate.",
              attachments: undefined,
            }),
          };
          
          const finalResult = await callOpenAI(apiKey, finalReportBody, ac.signal);
          
          if (!finalResult.error && finalResult.response.trim()) {
            const finalContent = enforceLanguagePolicy(finalResult.response, langPolicy);
            
            for (const char of finalContent) {
              if (aborted) break;
              controller.enqueue(encoder.encode(sseEncode({ type: "token", token: char })));
            }
            
            await storage.appendMessage({
              caseId: ensuredCase.id,
              role: "assistant",
              content: finalContent,
              language: outputPolicy.effective,
              userId: user?.id,
            });
            
            full = finalContent;
          } else {
            const fallback = getSafeFallback(currentMode, outputPolicy.effective);
            for (const char of fallback) {
              if (aborted) break;
              controller.enqueue(encoder.encode(sseEncode({ type: "token", token: char })));
            }
            full = fallback;
          }
        } else {
          // No transition - apply output-layer enforcement before streaming
          full = enforceLanguagePolicy(full, langPolicy);

          // Stream the response normally
          for (const char of full) {
            if (aborted) break;
            controller.enqueue(encoder.encode(sseEncode({ type: "token", token: char })));
          }

          // Send validation info
          if (!validation.valid) {
            controller.enqueue(
              encoder.encode(sseEncode({ type: "validation", valid: false, violations: validation.violations }))
            );
          }

          // Save assistant message with effective output language
          if (!aborted && full.trim()) {
            await storage.appendMessage({
              caseId: ensuredCase.id,
              role: "assistant",
              content: full,
              language: outputPolicy.effective,
              userId: user?.id,
            });
          }
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
