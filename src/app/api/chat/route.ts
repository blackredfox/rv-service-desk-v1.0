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
  // Diagnostic Registry — DATA PROVIDER ONLY (not flow authority)
  // Used for: procedure catalog, step definitions, static metadata
  // NOT used for: flow decisions, step selection, pivot logic
  initializeCase,
  buildRegistryContext,
  processUserMessage,
  isProcedureComplete,
  getRegistryEntry,
} from "@/lib/diagnostic-registry";
import { getNextStep } from "@/lib/diagnostic-procedures";
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
  popTopic,
  updateContext,
  isFallbackResponse,
  markStepCompleted as markContextStepCompleted,
  markStepUnable as markContextStepUnable,
  type ContextEngineResult,
  type DiagnosticContext,
  DEFAULT_CONFIG,
} from "@/lib/context-engine";
import { buildFactLockConstraint } from "@/lib/fact-pack";
import {
  classifyOpenAiError,
  getModelAllowlist,
  getCircuitStatus,
  openCircuit,
  clearCircuit,
  shouldTripCircuit,
  type LlmErrorType,
} from "@/lib/llm-resilience";

// ── Strict Context Engine Mode ──────────────────────────────────────
// When true (default), all diagnostic flow decisions come from Context Engine.
// Legacy diagnostic-registry is used ONLY as a data provider.
const STRICT_CONTEXT_ENGINE = true;

export const runtime = "nodejs";

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5-latest";

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

type UserCommand = "REPORT_REQUEST" | "CONTINUE_DIAGNOSTICS";

export function detectUserCommand(message: string): UserCommand | null {
  const text = (message || "").toLowerCase();
  if (!text.trim()) return null;

  const reportPatterns: RegExp[] = [
    /\bwrite\s+report\b/i,
    /\bgenerate\s+report\b/i,
    /\breport\b/i,
    /\bрепорт\b/i,
    /напиши\s+репорт/i,
    /сделай\s+репорт/i,
    /напиши\s+отч(?:ет|ёт)/i,
    /сделай\s+отч(?:ет|ёт)/i,
    /\bотч(?:ет|ёт)\b/i,
  ];

  const continuePatterns: RegExp[] = [
    /продолжаем/i,
    /давай\s+дальше/i,
    /continue\s+diagnostics?/i,
    /continue\s+diagnostic/i,
  ];

  if (reportPatterns.some((p) => p.test(text))) return "REPORT_REQUEST";
  if (continuePatterns.some((p) => p.test(text))) return "CONTINUE_DIAGNOSTICS";
  return null;
}

function computeCauseAllowed(context: DiagnosticContext | null | undefined, caseId: string): boolean {
  if (!context) return false;
  const entry = getRegistryEntry(caseId);
  const hasProcedure = Boolean(entry?.procedure);
  return Boolean(
    context.isolationComplete &&
    context.isolationFinding &&
    context.submode !== "clarification" &&
    hasProcedure
  );
}

const TELEMETRY_PREFIXES = [
  "Система:",
  "System:",
  "Классификация:",
  "Classification:",
  "Статус:",
  "Status:",
  "Режим:",
  "Mode:",
  "Изоляция завершена",
  "Isolation complete",
  "Переход к режиму",
  "Transition to mode",
  "Transitioning to",
];

const TELEMETRY_LINE_PATTERNS: RegExp[] = [
  /^\s*(?:Step|Шаг)\s+\w+_/i,
];

export function scrubTelemetry(text: string): string {
  if (!text) return text;
  const withoutMarkers = text.replace(/\[TRANSITION: FINAL_REPORT\]/g, "").trim();
  const lines = withoutMarkers.split("\n");
  const filtered = lines.filter((line) => {
    const trimmed = line.trimStart();
    if (!trimmed) return false;
    if (TELEMETRY_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return false;
    if (TELEMETRY_LINE_PATTERNS.some((pattern) => pattern.test(trimmed))) return false;
    return true;
  });
  return filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function formatLlmReason(reason?: LlmErrorType): string | undefined {
  if (!reason) return undefined;
  switch (reason) {
    case "MODEL_NOT_FOUND":
      return "model_not_found";
    case "AUTH_BLOCKED":
      return "auth_blocked";
    case "RATE_LIMITED":
      return "rate_limited";
    case "PROVIDER_DOWN":
      return "provider_down";
    default:
      return "unknown";
  }
}

function buildLlmDownBanner(language: Language): string {
  const lang = (language || "EN") as "EN" | "RU" | "ES";
  const messages = {
    EN: "AI is temporarily unavailable (account/model access). Your request is saved. You can continue diagnostics or click Retry AI.",
    RU: "AI временно недоступен (доступ к аккаунту/модели). Запрос сохранён. Продолжайте диагностику или нажмите Retry AI.",
    ES: "La IA no está disponible temporalmente (acceso a cuenta/modelo). Tu solicitud se guardó. Continúa el diagnóstico o pulsa Retry AI.",
  } as const;
  return messages[lang];
}

function buildReportQueuedBanner(language: Language): string {
  const lang = (language || "EN") as "EN" | "RU" | "ES";
  const messages = {
    EN: "Report is queued. I’ll generate it as soon as isolation is complete.",
    RU: "Отчёт поставлен в очередь. Сгенерирую, как только изоляция будет завершена.",
    ES: "El reporte está en cola. Lo generaré en cuanto termine el aislamiento.",
  } as const;
  return messages[lang];
}

function getNextDiagnosticQuestion(caseId: string, context: DiagnosticContext | null | undefined): string | null {
  const entry = getRegistryEntry(caseId);
  if (!entry?.procedure) return null;

  const activeStepId = context?.activeStepId || null;
  if (activeStepId) {
    const step = entry.procedure.steps.find((s) => s.id === activeStepId);
    if (step?.question) return step.question;
  }

  const nextStep = getNextStep(entry.procedure, entry.completedStepIds, entry.unableStepIds);
  return nextStep?.question || null;
}

function buildReportRefusal(language: Language, reasons: string[], nextQuestion: string | null): string {
  const lang = (language || "EN") as "EN" | "RU" | "ES";
  const headers: Record<"EN" | "RU" | "ES", string> = {
    EN: "Report not available yet.",
    RU: "Репорт пока недоступен.",
    ES: "El reporte aún no está disponible.",
  };

  const fallbackQuestions: Record<"EN" | "RU" | "ES", string> = {
    EN: "Which RV system are you diagnosing (roof AC, furnace, water pump, etc.)?",
    RU: "Какую систему RV вы диагностируете сейчас (крышный кондиционер, печь, водяной насос и т.д.)?",
    ES: "¿Qué sistema de la RV está diagnosticando (A/C de techo, calefacción, bomba de agua, etc.)?",
  };

  const lines = [headers[lang], ...reasons];
  const question = nextQuestion || fallbackQuestions[lang];
  if (question) {
    lines.push("", question);
  }
  return lines.join("\n").trim();
}

function buildReportMissingReasons(context: DiagnosticContext | null | undefined, hasProcedure: boolean, language: Language): string[] {
  const lang = (language || "EN") as "EN" | "RU" | "ES";
  const dictionary = {
    EN: {
      isolation: "Isolation is not complete.",
      finding: "No verified finding yet.",
      clarification: "Clarification in progress.",
      procedure: "No valid procedure selected.",
    },
    RU: {
      isolation: "Изоляция не завершена.",
      finding: "Нет подтверждённого вывода.",
      clarification: "Идёт уточнение.",
      procedure: "Процедура не определена.",
    },
    ES: {
      isolation: "El aislamiento no está completo.",
      finding: "No hay un hallazgo verificado.",
      clarification: "La aclaración está en curso.",
      procedure: "No hay un procedimiento válido.",
    },
  } as const;

  const reasons: string[] = [];
  if (!context?.isolationComplete) reasons.push(dictionary[lang].isolation);
  if (!context?.isolationFinding) reasons.push(dictionary[lang].finding);
  if (context?.submode === "clarification") reasons.push(dictionary[lang].clarification);
  if (!hasProcedure) reasons.push(dictionary[lang].procedure);
  return reasons;
}

function buildChecklistResponse(caseId: string, context: DiagnosticContext | null | undefined, language: Language): string {
  const nextQuestion = getNextDiagnosticQuestion(caseId, context);
  if (nextQuestion) return nextQuestion;
  return getSafeFallback("diagnostic", language);
}

function buildBadgesPayload(caseId: string, context: DiagnosticContext | null | undefined, mode: CaseMode) {
  const entry = getRegistryEntry(caseId);
  const system = entry?.procedure?.displayName || context?.primarySystem || "Unknown";
  const complexity = entry?.procedure
    ? entry.procedure.complex
      ? "complex"
      : "non_complex"
    : context?.classification || "unknown";

  return {
    type: "badges",
    system,
    complexity,
    mode,
    isolationComplete: Boolean(context?.isolationComplete),
    finding: context?.isolationFinding || "",
    activeStepId: context?.activeStepId || "",
  };
}

function buildStatusPayload(args: {
  llmStatus: { status: "up" | "down"; reason?: LlmErrorType };
  fallback: "llm" | "checklist";
  mode: CaseMode;
  message?: string;
}) {
  return {
    type: "status",
    llm: {
      status: args.llmStatus.status,
      reason: formatLlmReason(args.llmStatus.reason),
    },
    fallback: args.fallback,
    mode: args.mode,
    message: args.message,
  };
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
): Promise<{ response: string; error?: string; status?: number; raw?: string }> {
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
      return {
        response: "",
        status: upstream.status,
        raw: text.slice(0, 500),
        error: text
          ? `Upstream error (${upstream.status}) ${text}`.slice(0, 500)
          : `Upstream error (${upstream.status})`,
      };
    }

    const json = (await upstream.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };

    if (json.error) {
      return {
        response: "",
        status: upstream.status,
        error: `OpenAI error: ${json.error.message || "Unknown"}`,
      };
    }

    const content = json.choices?.[0]?.message?.content ?? "";

    if (!content) {
      return { response: "", status: upstream.status, error: "Empty response from OpenAI" };
    }

    return { response: content };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return { response: "", error: msg };
  }
}

type ResilientOpenAiResult = {
  response: string;
  errorType?: LlmErrorType;
  errorMessage?: string;
  modelUsed?: string;
};

async function callOpenAIWithFallback(
  apiKey: string,
  body: object,
  signal: AbortSignal
): Promise<ResilientOpenAiResult> {
  const circuitStatus = getCircuitStatus();
  if (circuitStatus.status === "down") {
    return { response: "", errorType: circuitStatus.reason ?? "PROVIDER_DOWN" };
  }

  const candidates = getModelAllowlist(process.env.OPENAI_MODEL);
  let lastError: LlmErrorType | undefined;

  for (const model of candidates) {
    const result = await callOpenAI(apiKey, { ...body, model }, signal);
    if (!result.error) {
      clearCircuit();
      return { response: result.response, modelUsed: model };
    }

    const errorType = classifyOpenAiError({ status: result.status, message: result.error });
    lastError = errorType;

    if (errorType === "MODEL_NOT_FOUND") {
      continue;
    }

    if (shouldTripCircuit(errorType)) {
      openCircuit(errorType);
    }

    return { response: "", errorType, errorMessage: result.error, modelUsed: model };
  }

  if (lastError === "MODEL_NOT_FOUND") {
    openCircuit("MODEL_NOT_FOUND");
    return { response: "", errorType: "MODEL_NOT_FOUND", errorMessage: "model_not_found" };
  }

  return { response: "", errorType: lastError ?? "UNKNOWN", errorMessage: "unknown" };
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

  // Detect user-level commands (report/continue)
  const userCommand = detectUserCommand(message);

  if (userCommand === "CONTINUE_DIAGNOSTICS" && currentMode !== "diagnostic") {
    console.log(`[Chat API v2] Command: continue diagnostics → switching to diagnostic`);
    currentMode = "diagnostic";
    await storage.updateCase(ensuredCase.id, { mode: currentMode });
  }

  // Check for explicit mode transition commands (legacy aliases)
  const commandMode = userCommand ? null : detectModeCommand(message);
  if (commandMode && commandMode !== currentMode) {
    console.log(`[Chat API v2] Mode transition: ${currentMode} → ${commandMode} (explicit command)`);
    currentMode = commandMode;
    await storage.updateCase(ensuredCase.id, { mode: currentMode });
  }

  const earlyContext = getContext(ensuredCase.id);
  const earlyCauseAllowed = computeCauseAllowed(earlyContext, ensuredCase.id);
  if (currentMode === "final_report" && !earlyCauseAllowed && userCommand !== "REPORT_REQUEST") {
    console.log(`[Chat API v2] Cause gate blocked existing final_report mode; reverting to diagnostic`);
    currentMode = "diagnostic";
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
  let computedCauseAllowed = false;
  let reportBlocked = false;

  if (currentMode === "diagnostic") {
    // ── STRICT MODE GUARD ──
    if (!STRICT_CONTEXT_ENGINE) {
      console.error("[Chat API v2] STRICT_CONTEXT_ENGINE is disabled — this is not supported in production");
    }
    
    // ── DATA PROVIDER: Initialize procedure catalog ──
    // This ONLY provides step metadata; it does NOT control flow
    const initResult = initializeCase(ensuredCase.id, message);
    if (initResult.system) {
      const classification = initResult.procedure?.complex ? "complex" : "non_complex";
      getOrCreateContext(ensuredCase.id, initResult.system, classification);
    }
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

    if (!replanActive && !contextBeforeIsolation.isolationComplete) {
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

    computedCauseAllowed = computeCauseAllowed(engineResult.context, ensuredCase.id);
    if (engineResult.context.causeAllowed !== computedCauseAllowed) {
      const updatedContext = { ...engineResult.context, causeAllowed: computedCauseAllowed };
      updateContext(updatedContext);
      engineResult.context = updatedContext;
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
    if (engineResult.context.isolationComplete && engineResult.context.isolationFinding && computedCauseAllowed) {
      pivotTriggered = true;
      console.log(`[Chat API v2] Pivot triggered (Context Engine): "${engineResult.context.isolationFinding}"`);
    }
    
    // ── BUILD DIRECTIVES: Anti-loop, replan, clarification ──
    const antiLoopDirectives = generateAntiLoopDirectives(engineResult.context);
    const replanNotice = buildReplanNotice(engineResult.context);
    const clarificationInstruction = buildReturnToMainInstruction(engineResult.context);
    const causeGateDirective = computedCauseAllowed
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

  const gateContext = engineResult?.context || getContext(ensuredCase.id);
  if (gateContext) {
    const recomputed = computeCauseAllowed(gateContext, ensuredCase.id);
    if (computedCauseAllowed !== recomputed || gateContext.causeAllowed !== recomputed) {
      computedCauseAllowed = recomputed;
      const updatedGateContext = { ...gateContext, causeAllowed: computedCauseAllowed };
      updateContext(updatedGateContext);
      if (engineResult) engineResult.context = updatedGateContext;
    }
  }

  if (userCommand === "REPORT_REQUEST") {
    if (computedCauseAllowed) {
      currentMode = "final_report";
      await storage.updateCase(ensuredCase.id, { mode: currentMode });
    } else {
      reportBlocked = true;
      currentMode = "diagnostic";
      await storage.updateCase(ensuredCase.id, { mode: currentMode });
    }
  }

  const badgePayload = buildBadgesPayload(ensuredCase.id, gateContext, currentMode);
  let llmStatus = getCircuitStatus();
  let llmAvailable = llmStatus.status === "up";

  // ========================================
  // FACT LOCK: build constraint for final report
  // ========================================
  let factLockConstraint = "";
  if (currentMode === "final_report") {
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
  const constraintBlocks = currentMode === "final_report"
    ? [factLockConstraint]
    : [contextEngineDirectives, procedureContext, factLockConstraint];

  const additionalConstraints = constraintBlocks
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

        // Emit badges (UI only)
        controller.enqueue(encoder.encode(sseEncode(badgePayload)));

        const statusPayload = buildStatusPayload({
          llmStatus: { status: llmAvailable ? "up" : "down", reason: llmStatus.reason ?? undefined },
          fallback: llmAvailable ? "llm" : "checklist",
          mode: currentMode,
          message: llmAvailable ? undefined : buildLlmDownBanner(outputPolicy.effective),
        });
        controller.enqueue(encoder.encode(sseEncode(statusPayload)));

        if (reportBlocked) {
          const hasProcedure = Boolean(getRegistryEntry(ensuredCase.id)?.procedure);
          const reasons = buildReportMissingReasons(gateContext, hasProcedure, outputPolicy.effective);
          const nextQuestion = getNextDiagnosticQuestion(ensuredCase.id, gateContext);
          const refusal = scrubTelemetry(buildReportRefusal(outputPolicy.effective, reasons, nextQuestion));

          for (const char of refusal) {
            if (aborted) break;
            controller.enqueue(encoder.encode(sseEncode({ type: "token", token: char })));
          }

          if (!aborted && refusal.trim()) {
            await storage.appendMessage({
              caseId: ensuredCase.id,
              role: "assistant",
              content: refusal,
              language: outputPolicy.effective,
              userId: user?.id,
            });
          }

          full = refusal;
          controller.enqueue(encoder.encode(sseEncode({ type: "done" })));
          controller.close();
          return;
        }

        if (!llmAvailable) {
          const checklistResponse = scrubTelemetry(buildChecklistResponse(ensuredCase.id, gateContext, outputPolicy.effective));

          for (const char of checklistResponse) {
            if (aborted) break;
            controller.enqueue(encoder.encode(sseEncode({ type: "token", token: char })));
          }

          recordAgentAction(ensuredCase.id, {
            type: "question",
            content: checklistResponse.slice(0, 200),
            stepId: gateContext?.activeStepId || undefined,
            submode: gateContext?.submode,
          }, DEFAULT_CONFIG);

          if (!aborted && checklistResponse.trim()) {
            await storage.appendMessage({
              caseId: ensuredCase.id,
              role: "assistant",
              content: checklistResponse,
              language: outputPolicy.effective,
              userId: user?.id,
            });
          }

          full = checklistResponse;
          controller.enqueue(encoder.encode(sseEncode({ type: "done" })));
          controller.close();
          return;
        }

        // Build initial request
        const openAiBody = {
          model: OPENAI_MODEL,
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
        let result = await callOpenAIWithFallback(apiKey, openAiBody, ac.signal);

        if (result.errorType) {
          llmStatus = getCircuitStatus();
          llmAvailable = false;

          const statusPayload = buildStatusPayload({
            llmStatus: { status: "down", reason: llmStatus.reason ?? result.errorType },
            fallback: "checklist",
            mode: currentMode,
            message: buildLlmDownBanner(outputPolicy.effective),
          });
          controller.enqueue(encoder.encode(sseEncode(statusPayload)));

          const checklistResponse = scrubTelemetry(buildChecklistResponse(ensuredCase.id, gateContext, outputPolicy.effective));
          for (const char of checklistResponse) {
            if (aborted) break;
            controller.enqueue(encoder.encode(sseEncode({ type: "token", token: char })));
          }

          recordAgentAction(ensuredCase.id, {
            type: "question",
            content: checklistResponse.slice(0, 200),
            stepId: gateContext?.activeStepId || undefined,
            submode: gateContext?.submode,
          }, DEFAULT_CONFIG);

          if (!aborted && checklistResponse.trim()) {
            await storage.appendMessage({
              caseId: ensuredCase.id,
              role: "assistant",
              content: checklistResponse,
              language: outputPolicy.effective,
              userId: user?.id,
            });
          }

          full = checklistResponse;
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

          const retryResult = await callOpenAIWithFallback(apiKey, retryBody, ac.signal);

          if (!retryResult.errorType) {
            result = retryResult;
            validation = validateOutput(result.response, currentMode, langPolicy.includeTranslation, translationLanguage);
            logValidation(validation, { caseId: ensuredCase.id, mode: currentMode });
          }

          // If still fails, use safe fallback with EFFECTIVE OUTPUT language
          if (!validation.valid || retryResult.errorType) {
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

        const rawResponse = applyLangPolicy(result.response, currentMode, langPolicy);
        full = scrubTelemetry(rawResponse);

        if (currentMode === "diagnostic" && engineResult && !computedCauseAllowed) {
          const transitionPreview = detectTransitionSignal(rawResponse);
          if (transitionPreview) {
            full = scrubTelemetry(applyLangPolicy(transitionPreview.cleanedResponse, currentMode, langPolicy));
          }
        }

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

        const generateFinalReport = async (): Promise<string> => {
          const updatedHistory = await storage.listMessagesForContext(ensuredCase.id, DEFAULT_MEMORY_WINDOW);
          const factLock = buildFactLockConstraint(updatedHistory);
          const finalReportPrompt = composePromptV2({
            mode: "final_report",
            inputDetected: trackedInputLanguage,
            outputEffective: outputPolicy.effective,
            includeTranslation: langPolicy.includeTranslation,
            translationLanguage,
            additionalConstraints: factLock,
          });

          const translationInstruction = langPolicy.includeTranslation && translationLanguage
            ? `

After the English report, output "--- TRANSLATION ---" and provide a complete translation into ${translationLanguage === "RU" ? "Russian" : translationLanguage === "ES" ? "Spanish" : "English"}.`
            : "";

          const finalReportRequest = `Generate the FINAL SHOP REPORT now.

REQUIRED OUTPUT FORMAT (plain text, no numbering, no tables):
Complaint:
Diagnostic Procedure:
Verified Condition:
Recommended Corrective Action:
Required Parts:
Estimated Labor:

Estimated Labor must be LAST and end with "Total labor: X hr".${translationInstruction}

Generate the complete final report now.`;

          const finalReportBody = {
            model: OPENAI_MODEL,
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
            let finalContent = applyLangPolicy(finalResult.response, "final_report", langPolicy);
            finalContent = scrubTelemetry(finalContent);
            const finalValidation = validateOutput(finalContent, "final_report", langPolicy.includeTranslation, translationLanguage);
            logValidation(finalValidation, { caseId: ensuredCase.id, mode: "final_report" });
            if (!finalValidation.valid) {
              const fallback = applyLangPolicy(getSafeFallback("final_report", outputPolicy.effective), "final_report", langPolicy);
              return scrubTelemetry(fallback);
            }
            return finalContent;
          }

          const fallback = applyLangPolicy(getSafeFallback("final_report", outputPolicy.effective), "final_report", langPolicy);
          return scrubTelemetry(fallback);
        };

        // ========================================
        // TRANSITION / REPORT HANDLING
        // ========================================
        const transitionResult = detectTransitionSignal(rawResponse);
        const canGenerateReport = computedCauseAllowed;
        const contextForRefusal = getContext(ensuredCase.id) ?? engineResult?.context;
        const hasProcedure = Boolean(getRegistryEntry(ensuredCase.id)?.procedure);

        if ((pivotTriggered || transitionResult) && currentMode === "diagnostic" && canGenerateReport && !aborted) {
          console.log(`[Chat API v2] Auto-transition: diagnostic → final_report`);
          currentMode = "final_report";
          await storage.updateCase(ensuredCase.id, { mode: currentMode });
          controller.enqueue(encoder.encode(sseEncode({ type: "mode_transition", from: "diagnostic", to: currentMode })));
          controller.enqueue(encoder.encode(sseEncode(buildBadgesPayload(ensuredCase.id, getContext(ensuredCase.id) ?? engineResult?.context, currentMode))));

          const finalContent = await generateFinalReport();
          for (const char of finalContent) {
            if (aborted) break;
            controller.enqueue(encoder.encode(sseEncode({ type: "token", token: char })));
          }
          if (!aborted && finalContent.trim()) {
            await storage.appendMessage({
              caseId: ensuredCase.id,
              role: "assistant",
              content: finalContent,
              language: outputPolicy.effective,
              userId: user?.id,
            });
          }
          full = finalContent;
          controller.enqueue(encoder.encode(sseEncode({ type: "done" })));
          controller.close();
          return;
        }

        if (currentMode === "diagnostic" && transitionResult && !canGenerateReport && !aborted) {
          const reasons = buildReportMissingReasons(contextForRefusal, hasProcedure, outputPolicy.effective);
          const nextQuestion = getNextDiagnosticQuestion(ensuredCase.id, contextForRefusal);
          const refusal = scrubTelemetry(buildReportRefusal(outputPolicy.effective, reasons, nextQuestion));
          for (const char of refusal) {
            if (aborted) break;
            controller.enqueue(encoder.encode(sseEncode({ type: "token", token: char })));
          }
          if (!aborted && refusal.trim()) {
            await storage.appendMessage({
              caseId: ensuredCase.id,
              role: "assistant",
              content: refusal,
              language: outputPolicy.effective,
              userId: user?.id,
            });
          }
          full = refusal;
          controller.enqueue(encoder.encode(sseEncode({ type: "done" })));
          controller.close();
          return;
        }

        // No transition - stream the response normally
        full = scrubTelemetry(full);

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
