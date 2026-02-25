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
  buildMessagesWithMemory,
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
  getConfirmedHours,
  extractLaborEstimate,
  parseLaborConfirmation,
  validateLaborSum,
} from "@/lib/labor-store";
import {
  // Diagnostic Registry — DATA PROVIDER ONLY (not flow authority)
  // Used for: procedure catalog, step definitions, static metadata
  // NOT used for: flow decisions, step selection, pivot logic
  initializeCase,
  buildRegistryContext,
  processUserMessage,
  isProcedureComplete,
} from "@/lib/diagnostic-registry";
import {
  // Context Engine — SINGLE FLOW AUTHORITY
  // All flow decisions, submode selection, replan, loop guard come from here
  processMessage as processContextMessage,
  recordAgentAction,
  getOrCreateContext,
  getContext,
  markIsolationComplete,
  isInReplanState,
  clearReplanState,
  generateAntiLoopDirectives,
  buildReplanNotice,
  isInClarificationSubflow,
  buildReturnToMainInstruction,
  buildClarificationContext,
  popTopic,
  updateContext,
  isFallbackResponse,
  setActiveStep,
  markStepCompleted as markContextStepCompleted,
  markStepUnable as markContextStepUnable,
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

/**
 * Output-layer enforcement: apply declarative language policy to all assistant outputs.
 * - No translation blocks outside final_report mode
 * - In final_report: strip translation if policy says none
 */
function applyLangPolicy(text: string, mode: CaseMode, policy: LanguagePolicy): string {
  if (!text) return text;

  // Translation blocks are NEVER allowed outside final report mode
  if (mode !== "final_report") {
    if (text.includes(TRANSLATION_SEPARATOR)) {
      return text.split(TRANSLATION_SEPARATOR)[0].trim();
    }
    return text;
  }

  // Final report mode: only allow translation when policy requires it
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
  const detectedInputLanguage: InputLanguageV2 = detectInputLanguageV2(message);

  // 1b. Respect tracked dialogue language from case metadata (update on explicit switch)
  let trackedInputLanguage: Language = detectedInputLanguage.detected;
  if (body?.caseId) {
    const existing = await storage.getCase(body.caseId, user?.id);
    const previousLanguage = existing.case?.inputLanguage;
    if (previousLanguage) {
      trackedInputLanguage = previousLanguage;
      if (previousLanguage !== detectedInputLanguage.detected) {
        trackedInputLanguage = detectedInputLanguage.detected;
        console.log(`[Chat API v2] Language switch detected: ${previousLanguage} → ${detectedInputLanguage.detected}`);
      }
    }
  }

  // 2. Get output mode from request (v2 or legacy v1)
  const outputMode: LanguageMode = normalizeLanguageMode(
    body?.output?.mode ?? body?.languageMode
  );

  // 3. Compute effective output language
  const outputPolicy: OutputLanguagePolicyV2 = computeOutputPolicy(outputMode, trackedInputLanguage);

  // 4. Resolve declarative language policy (single source of truth for translation behavior)
  const langPolicy: LanguagePolicy = resolveLanguagePolicy(outputMode, trackedInputLanguage);

  // Translation language must follow tracked dialogue language (case metadata)
  const translationLanguage = langPolicy.includeTranslation ? trackedInputLanguage : undefined;

  console.log(`[Chat API v2] Input: detected=${detectedInputLanguage.detected} (${detectedInputLanguage.reason}), dialogue=${trackedInputLanguage}, Output: mode=${outputPolicy.mode}, effective=${outputPolicy.effective}, strategy=${outputPolicy.strategy}, includeTranslation=${langPolicy.includeTranslation}, translationLanguage=${translationLanguage ?? "none"}`);

  // Ensure case exists - use detected language for case, not forced output
  const ensuredCase = await storage.ensureCase({
    caseId: body?.caseId,
    titleSeed: message,
    inputLanguage: trackedInputLanguage,
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
    language: detectedInputLanguage.detected,
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

    // ── DATA PROVIDER: Sync registry step tracking to Context Engine (data only) ──
    const registryUpdate = processUserMessage(ensuredCase.id, message);
    if (registryUpdate.completedStepIds.length > 0) {
      for (const stepId of registryUpdate.completedStepIds) {
        markContextStepCompleted(ensuredCase.id, stepId);
      }
    }
    if (registryUpdate.unableStepIds.length > 0) {
      for (const stepId of registryUpdate.unableStepIds) {
        markContextStepUnable(ensuredCase.id, stepId);
      }
    }

    const contextBeforeIsolation = getContext(ensuredCase.id) ?? engineResult.context;
    const replanActive = isInReplanState(contextBeforeIsolation);

    if (!replanActive) {
      if (registryUpdate.keyFinding) {
        markIsolationComplete(ensuredCase.id, registryUpdate.keyFinding);
      } else if (isProcedureComplete(ensuredCase.id)) {
        markIsolationComplete(ensuredCase.id, "Diagnostic procedure complete");
      }
    }

    const syncedContext = getContext(ensuredCase.id);
    if (syncedContext) {
      engineResult.context = syncedContext;
    }
    
    // Log context engine decision (SINGLE SOURCE OF TRUTH)
    console.log(`[Chat API v2] Context Engine: intent=${engineResult.intent.type}, submode=${engineResult.context.submode}, stateChanged=${engineResult.stateChanged}`);
    
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
    if (engineResult.context.isolationComplete && engineResult.context.isolationFinding && engineResult.context.causeAllowed) {
      pivotTriggered = true;
      console.log(`[Chat API v2] Pivot triggered (Context Engine): "${engineResult.context.isolationFinding}"`);
    }
    
    // ── BUILD DIRECTIVES: Anti-loop, replan, clarification ──
    const antiLoopDirectives = generateAntiLoopDirectives(engineResult.context);
    const replanNotice = buildReplanNotice(engineResult.context);
    const clarificationInstruction = buildReturnToMainInstruction(engineResult.context);
    const causeGateDirective = engineResult.context.causeAllowed
      ? ""
      : "CAUSE GATE (SERVER AUTHORITY): Cause/report generation is NOT allowed. Continue diagnostics and ask the next valid step.";
    
    contextEngineDirectives = [
      ...antiLoopDirectives,
      replanNotice,
      clarificationInstruction,
      causeGateDirective,
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
    inputDetected: trackedInputLanguage,
    outputEffective: outputPolicy.effective,
    includeTranslation: langPolicy.includeTranslation,
    translationLanguage,
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
          inputDetected: trackedInputLanguage,
          outputMode: outputPolicy.mode,
          outputEffective: outputPolicy.effective,
          detector: detectedInputLanguage.source,
          confidence: detectedInputLanguage.confidence,
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
        let validation = validateOutput(result.response, currentMode, langPolicy.includeTranslation, translationLanguage);
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
            validation = validateOutput(result.response, currentMode, langPolicy.includeTranslation, translationLanguage);
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

        full = applyLangPolicy(result.response, currentMode, langPolicy);

        // ========================================
        // CONTEXT ENGINE: Record agent action (AFTER LLM response)
        // ========================================
        if (currentMode === "diagnostic" && engineResult) {
          // Determine action type based on response content
          const actionType = isFallbackResponse(full) ? "fallback" : 
                            engineResult.context.submode === "clarification" ? "clarification" : "question";
          
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

          // Reset unable submode after response
          if (engineResult.context.submode === "unable") {
            const latestCtx = getContext(ensuredCase.id) ?? engineResult.context;
            updateContext({
              ...latestCtx,
              submode: "main",
              previousSubmode: "unable",
            });
            console.log(`[Chat API v2] Context Engine: cleared unable submode`);
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

            // Now force transition to labor_confirmation
            currentMode = "labor_confirmation";
            await storage.updateCase(ensuredCase.id, { mode: currentMode });
            controller.enqueue(encoder.encode(sseEncode({ type: "mode_transition", from: "diagnostic", to: currentMode })));

            const separator = "\n\n";
            for (const char of separator) {
              controller.enqueue(encoder.encode(sseEncode({ type: "token", token: char })));
            }

            // Generate labor confirmation
            const laborPrompt = composePromptV2({
              mode: "labor_confirmation",
              inputDetected: trackedInputLanguage,
              outputEffective: outputPolicy.effective,
              includeTranslation: false,
            });
            const updatedHistoryPivot = await storage.listMessagesForContext(ensuredCase.id, DEFAULT_MEMORY_WINDOW);
            const laborBody = {
              model: "gpt-4o-mini",
              stream: false,
              temperature: 0.2,
              messages: buildOpenAiMessages({
                system: laborPrompt,
                history: updatedHistoryPivot,
                userMessage: "Key finding confirmed during diagnostics. Generate a labor estimate and ask for confirmation.",
                attachments: undefined,
              }),
            };
            const laborResult = await callOpenAI(apiKey, laborBody, ac.signal);
            if (!laborResult.error && laborResult.response.trim()) {
              const laborContent = applyLangPolicy(laborResult.response, currentMode, langPolicy);
              const estimatedHours = extractLaborEstimate(laborContent);
              if (estimatedHours) setLaborEstimate(ensuredCase.id, estimatedHours);
              for (const char of laborContent) {
                if (aborted) break;
                controller.enqueue(encoder.encode(sseEncode({ type: "token", token: char })));
              }
              await storage.appendMessage({
                caseId: ensuredCase.id,
                role: "assistant",
                content: laborContent,
                language: outputPolicy.effective,
                userId: user?.id,
              });
              full = full + separator + laborContent;
            } else {
              const fallback = applyLangPolicy(
                getSafeFallback("labor_confirmation", outputPolicy.effective),
                currentMode,
                langPolicy
              );
              for (const char of fallback) {
                if (aborted) break;
                controller.enqueue(encoder.encode(sseEncode({ type: "token", token: char })));
              }
              setLaborEstimate(ensuredCase.id, 1.0);
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
        const canTransition = currentMode === "diagnostic" && (engineResult?.context?.causeAllowed ?? false);

        if (transitionResult && currentMode === "diagnostic" && !canTransition) {
          full = applyLangPolicy(transitionResult.cleanedResponse, currentMode, langPolicy);
        }
        if (transitionResult && currentMode === "diagnostic" && !aborted && canTransition) {
          // Transition: diagnostic → labor_confirmation (NOT directly to final_report)
          console.log(`[Chat API v2] Auto-transition detected: diagnostic → labor_confirmation`);
          
          const transitionResponse = applyLangPolicy(transitionResult.cleanedResponse, currentMode, langPolicy);

          // Stream the transition message first
          for (const char of transitionResponse) {
            if (aborted) break;
            controller.enqueue(encoder.encode(sseEncode({ type: "token", token: char })));
          }
          
          // Save the transition message
          if (transitionResponse.trim()) {
            await storage.appendMessage({
              caseId: ensuredCase.id,
              role: "assistant",
              content: transitionResponse,
              language: outputPolicy.effective,
              userId: user?.id,
            });
          }
          
          // Update mode to labor_confirmation
          currentMode = "labor_confirmation";
          await storage.updateCase(ensuredCase.id, { mode: currentMode });
          
          // Emit mode change event
          controller.enqueue(encoder.encode(sseEncode({ type: "mode_transition", from: "diagnostic", to: currentMode })));
          
          // Add a visual separator
          const separator = "\n\n";
          for (const char of separator) {
            controller.enqueue(encoder.encode(sseEncode({ type: "token", token: char })));
          }
          
          // Generate labor confirmation prompt
          const laborPrompt = composePromptV2({
            mode: "labor_confirmation",
            inputDetected: trackedInputLanguage,
            outputEffective: outputPolicy.effective,
            includeTranslation: false, // No translation in labor confirmation
          });
          
          const updatedHistory = await storage.listMessagesForContext(ensuredCase.id, DEFAULT_MEMORY_WINDOW);
          
          const laborBody = {
            model: "gpt-4o-mini",
            stream: false,
            temperature: 0.2,
            messages: buildOpenAiMessages({
              system: laborPrompt,
              history: updatedHistory,
              userMessage: "Generate a labor estimate for the repair identified during diagnostics. Present the total and ask for confirmation.",
              attachments: undefined,
            }),
          };
          
          const laborResult = await callOpenAI(apiKey, laborBody, ac.signal);
          
          if (!laborResult.error && laborResult.response.trim()) {
            let laborContent = applyLangPolicy(laborResult.response, currentMode, langPolicy);
            
            // Extract and store the estimated hours
            const estimatedHours = extractLaborEstimate(laborContent);
            if (estimatedHours) {
              setLaborEstimate(ensuredCase.id, estimatedHours);
              console.log(`[Chat API v2] Labor estimate extracted: ${estimatedHours} hr`);
            }
            
            // Stream the labor confirmation prompt
            for (const char of laborContent) {
              if (aborted) break;
              controller.enqueue(encoder.encode(sseEncode({ type: "token", token: char })));
            }
            
            // Save the labor confirmation message
            await storage.appendMessage({
              caseId: ensuredCase.id,
              role: "assistant",
              content: laborContent,
              language: outputPolicy.effective,
              userId: user?.id,
            });
            
            full = transitionResponse + separator + laborContent;
          } else if (laborResult.error) {
            console.error(`[Chat API v2] Labor confirmation generation error: ${laborResult.error}`);
            // Use fallback
            const fallback = applyLangPolicy(
              getSafeFallback("labor_confirmation", outputPolicy.effective),
              currentMode,
              langPolicy
            );
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
            // Set fallback estimate
            setLaborEstimate(ensuredCase.id, 1.0);
            full = transitionResponse + separator + fallback;
          }
        } else if (currentMode === "labor_confirmation" && !aborted) {
          // ========================================
          // LABOR CONFIRMATION → FINAL REPORT (NON-BLOCKING)
          // ========================================
          // Parse technician's response for labor confirmation/override
          const laborEntry = getLaborEntry(ensuredCase.id);
          const confirmedHours = parseLaborConfirmation(message, laborEntry?.estimatedHours);
          
          // Check if technician wants to continue diagnostics (non-blocking labor)
          const continuePatterns = [
            /(?:continue|back\s+to|return\s+to)\s+diagnostic/i,
            /(?:more\s+)?(?:check|test|verify|diagnose)/i,
            /(?:wait|hold|not\s+ready|skip)/i,
            /(?:продолж|вернуться|проверить|подожд)/i,
            /(?:continuar|volver|verificar|espera)/i,
          ];
          const wantsContinueDiagnostics = continuePatterns.some(p => p.test(message));
          
          if (wantsContinueDiagnostics) {
            // NON-BLOCKING: Allow return to diagnostics
            console.log(`[Chat API v2] Labor confirmation: technician wants to continue diagnostics (non-blocking)`);
            currentMode = "diagnostic";
            await storage.updateCase(ensuredCase.id, { mode: currentMode });
            controller.enqueue(encoder.encode(sseEncode({ type: "mode_transition", from: "labor_confirmation", to: currentMode })));
            
            // Stream acknowledgment and return to diagnostic flow
            const rawAcknowledgment = outputPolicy.effective === "RU" 
              ? "Понял. Продолжаем диагностику."
              : outputPolicy.effective === "ES"
              ? "Entendido. Continuamos con el diagnóstico."
              : "Understood. Returning to diagnostics.";
            const acknowledgment = applyLangPolicy(rawAcknowledgment, currentMode, langPolicy);
            
            for (const char of acknowledgment) {
              if (aborted) break;
              controller.enqueue(encoder.encode(sseEncode({ type: "token", token: char })));
            }
            
            await storage.appendMessage({
              caseId: ensuredCase.id,
              role: "assistant",
              content: acknowledgment,
              language: outputPolicy.effective,
              userId: user?.id,
            });
            
            full = acknowledgment;
          } else if (confirmedHours) {
            confirmLabor(ensuredCase.id, confirmedHours);
            console.log(`[Chat API v2] Labor confirmed: ${confirmedHours} hr (estimate was ${laborEntry?.estimatedHours ?? "unknown"})`);
            
            // Transition to final_report
            currentMode = "final_report";
            await storage.updateCase(ensuredCase.id, { mode: currentMode });
            
            controller.enqueue(encoder.encode(sseEncode({ type: "mode_transition", from: "labor_confirmation", to: currentMode })));
            
            // Generate final report with confirmed labor as a hard constraint + fact lock
            const updatedHistoryForReport = await storage.listMessagesForContext(ensuredCase.id, DEFAULT_MEMORY_WINDOW);
            const factLock = buildFactLockConstraint(updatedHistoryForReport);
            
            const finalReportPrompt = composePromptV2({
              mode: currentMode,
              inputDetected: trackedInputLanguage,
              outputEffective: outputPolicy.effective,
              includeTranslation: langPolicy.includeTranslation,
              translationLanguage,
              additionalConstraints: `LABOR BUDGET CONSTRAINT (MANDATORY - DO NOT VIOLATE):
The technician has confirmed a total labor budget of exactly ${confirmedHours} hours.
Your labor breakdown MUST sum to exactly ${confirmedHours} hours.
Do NOT exceed or reduce this total under any circumstances.
Distribute the ${confirmedHours} hours across the repair steps.
State "Total labor: ${confirmedHours} hr" at the end of the labor section.

${factLock}`,
            });
            
            const updatedHistory = await storage.listMessagesForContext(ensuredCase.id, DEFAULT_MEMORY_WINDOW);
            
            const translationInstruction = langPolicy.includeTranslation && translationLanguage
              ? `\n\nAfter the English report, output "--- TRANSLATION ---" and provide a complete translation into ${translationLanguage === "RU" ? "Russian" : translationLanguage === "ES" ? "Spanish" : "English"}.`
              : "";

            const finalReportRequest = `The technician has confirmed a total labor budget of ${confirmedHours} hours. Generate the FINAL SHOP REPORT now.

REQUIRED OUTPUT FORMAT (plain text, no numbering, no tables):
Complaint:
Diagnostic Procedure:
Verified Condition:
Recommended Corrective Action:
Required Parts:
Estimated Labor:

Estimated Labor must include task breakdowns that sum to exactly ${confirmedHours} hr and end with "Total labor: ${confirmedHours} hr". Labor justification must be LAST.${translationInstruction}

Generate the complete final report now.`;
            
            const finalReportBody = {
              model: "gpt-4o-mini",
              stream: false,
              temperature: 0.2,
              messages: buildOpenAiMessages({
                system: finalReportPrompt,
                history: updatedHistory,
                userMessage: finalReportRequest,
                attachments: undefined,
              }),
            };
            
            const finalResult = await callOpenAI(apiKey, finalReportBody, ac.signal);
            
            if (!finalResult.error && finalResult.response.trim()) {
              const finalValidation = validateOutput(finalResult.response, currentMode, langPolicy.includeTranslation, translationLanguage);
              logValidation(finalValidation, { caseId: ensuredCase.id, mode: currentMode });
              
              let finalContent = finalResult.response;
              
              // Output-layer enforcement: strip translation for EN mode
              finalContent = applyLangPolicy(finalContent, currentMode, langPolicy);
              
              // Validate labor sum consistency
              const laborValidation = validateLaborSum(finalContent, confirmedHours);
              if (!laborValidation.valid) {
                console.warn(`[Chat API v2] Labor sum validation failed:`, laborValidation.violations);
                // Don't reject — the constraint was injected, just log the drift
              }
              
              // If mode validation fails, try enforcement-based recovery
              if (!finalValidation.valid) {
                const postEnforcementValidation = validateOutput(finalContent, currentMode, langPolicy.includeTranslation, translationLanguage);
                if (!postEnforcementValidation.valid) {
                  console.log(`[Chat API v2] Final report validation failed, using fallback`);
                  finalContent = applyLangPolicy(
                    getSafeFallback(currentMode, outputPolicy.effective),
                    currentMode,
                    langPolicy
                  );
                }
              }
              
              // Stream the final report
              for (const char of finalContent) {
                if (aborted) break;
                controller.enqueue(encoder.encode(sseEncode({ type: "token", token: char })));
              }
              
              // Save the final report
              await storage.appendMessage({
                caseId: ensuredCase.id,
                role: "assistant",
                content: finalContent,
                language: outputPolicy.effective,
                userId: user?.id,
              });
              
              full = finalContent;
            } else if (finalResult.error) {
              console.error(`[Chat API v2] Final report generation error: ${finalResult.error}`);
              const fallback = getSafeFallback(currentMode, outputPolicy.effective);
              for (const char of fallback) {
                if (aborted) break;
                controller.enqueue(encoder.encode(sseEncode({ type: "token", token: char })));
              }
              full = fallback;
            }
          } else {
            // Could not parse confirmation — NON-BLOCKING: allow technician to respond or continue
            // Instead of blocking, let the LLM handle the response naturally
            full = applyLangPolicy(full, currentMode, langPolicy);
            for (const char of full) {
              if (aborted) break;
              controller.enqueue(encoder.encode(sseEncode({ type: "token", token: char })));
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
            
            // Emit non-blocking labor hint
            controller.enqueue(encoder.encode(sseEncode({ 
              type: "labor_status", 
              status: "draft",
              estimatedHours: laborEntry?.estimatedHours,
              message: "Labor estimate is a draft. Confirm, adjust, or continue diagnostics."
            })));
          }
        } else {
          // No transition - apply output-layer enforcement before streaming
          full = applyLangPolicy(full, currentMode, langPolicy);

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
