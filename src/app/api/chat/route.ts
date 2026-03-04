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
import { validateLaborSum } from "@/lib/labor-store";
import {
  // Diagnostic Registry — DATA PROVIDER ONLY (not flow authority)
  // Used for: procedure catalog, step definitions, static metadata
  // NOT used for: flow decisions, step selection, pivot logic
  initializeCase,
  buildRegistryContext,
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

const MODELS = {
  diagnostic: "gpt-5-mini-2025-08-07",
  final: "gpt-5.2-2025-12-11",
} as const;

function getModelForMode(mode: CaseMode): string {
  return mode === "final_report" || mode === "authorization"
    ? MODELS.final
    : MODELS.diagnostic;
}

const LABOR_OVERRIDE_MIN_HOURS = 0.1;
const LABOR_OVERRIDE_MAX_HOURS = 24;

function normalizeLaborHours(hours: number): number {
  return Math.round(hours * 10) / 10;
}

function formatLaborHours(hours: number): string {
  return normalizeLaborHours(hours).toFixed(1);
}

function parseRequestedLaborHours(message: string): number | null {
  const sanitized = message.replace(/,/g, ".");
  const matches = sanitized.match(/\d+(?:\.\d+)?/g);
  if (!matches) return null;

  for (const raw of matches) {
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) continue;
    if (parsed < LABOR_OVERRIDE_MIN_HOURS || parsed > LABOR_OVERRIDE_MAX_HOURS) continue;
    return normalizeLaborHours(parsed);
  }

  return null;
}

function detectLaborOverrideIntent(message: string): boolean {
  const hasNumber = parseRequestedLaborHours(message) !== null;
  if (!hasNumber) return false;

  const hasActionWord = [
    /\b(?:recalculate|set\s+to|set|make|adjust|override|change|edit|revise|update)\b/i,
    /(?:перерасч(?:е|ё)т|пересчитай|сделай|зделай|укажи|пересчитать|измени|изменить|поменяй|поменять|поправь|правка|исправь)/i,
    /\b(?:recalcula|recalcular|ajusta|ajustar|hazlo|hacer|cambia|cambiar|edita|editar|actualiza|actualizar)\b/i,
  ].some((pattern) => pattern.test(message));

  const hasLaborWord = [
    /\b(?:labor|labour|man\s*hours?)\b/i,
    /(?:трудозатрат|трудо(?:затр|емк)|работы|рабоч(?:ее|их)?\s+время)/i,
    /\b(?:mano\s+de\s+obra)\b/i,
  ].some((pattern) => pattern.test(message));

  const hasTotalWord = [
    /\btotal\b/i,
    /(?:итого|всего)/i,
    /\btotal\b/i,
  ].some((pattern) => pattern.test(message));

  const hasTimeUnit = [
    /\b(?:hours?|hrs?|hr|h)\b/i,
    /(?:час(?:а|ов)?|ч(?=\s|$|\.)|времени)/i,
    /\b(?:hora|horas)\b/i,
  ].some((pattern) => pattern.test(message));

  if (!hasTimeUnit) return false;

  return hasLaborWord || hasTotalWord || hasActionWord;
}

const DIAGNOSTIC_MODE_GUARD_VIOLATION =
  "DIAGNOSTIC_MODE_GUARD: Diagnostic mode output must not use final report section format";

function looksLikeFinalReport(text: string): boolean {
  const t = text.toLowerCase();
  const required = [
    "complaint:",
    "diagnostic procedure:",
    "verified condition:",
    "recommended corrective action:",
    "estimated labor:",
    "required parts:",
  ];
  const hits = required.filter((k) => t.includes(k)).length;
  return hits >= 4;
}

function lastAssistantLooksLikeFinalReport(history: { role: string; content: string }[]): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role === "assistant" || msg.role === "agent") {
      return looksLikeFinalReport(msg.content || "");
    }
  }
  return false;
}

function shouldTreatAsFinalReportForOverride(currentMode: CaseMode, history: { role: string; content: string }[]): boolean {
  return currentMode === "final_report" || lastAssistantLooksLikeFinalReport(history);
}

function extractPrimaryReportBlock(text: string): string {
  if (!text.includes(TRANSLATION_SEPARATOR)) return text;
  return text.split(TRANSLATION_SEPARATOR)[0].trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasCanonicalTotalLaborLine(reportText: string, totalHoursText: string): boolean {
  const escapedTotal = escapeRegExp(totalHoursText);
  return new RegExp(`Total\\s+labor:\\s*${escapedTotal}\\s*hr\\b`, "i").test(reportText);
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

function applyDiagnosticModeValidationGuard(
  validation: ReturnType<typeof validateOutput>,
  mode: CaseMode,
  responseText: string
): ReturnType<typeof validateOutput> {
  if (mode !== "diagnostic") return validation;
  if (!looksLikeFinalReport(responseText)) return validation;

  if (validation.violations.includes(DIAGNOSTIC_MODE_GUARD_VIOLATION)) {
    return {
      ...validation,
      valid: false,
    };
  }

  return {
    ...validation,
    valid: false,
    violations: [...validation.violations, DIAGNOSTIC_MODE_GUARD_VIOLATION],
  };
}

function buildDiagnosticDriftCorrectionInstruction(activeStepId?: string): string {
  const stepHint = activeStepId
    ? `Return to the active guided step (${activeStepId}).`
    : "Return to the active guided diagnostic step.";

  return [
    "Diagnostic drift correction (MANDATORY):",
    "- You are in DIAGNOSTIC mode, not FINAL_REPORT mode.",
    "- Do NOT output final report headers (Complaint/Diagnostic Procedure/Verified Condition/etc.).",
    `- ${stepHint}`,
    "- Ask exactly ONE concise diagnostic question that advances the procedure.",
  ].join("\n");
}

function buildDiagnosticDriftFallback(activeStepId?: string): string {
  const stepLabel = activeStepId ? ` (${activeStepId})` : "";
  return `Guided Diagnostics${stepLabel}: What is the observed result for this active diagnostic step?`;
}

function computeLaborOverrideRequest(
  currentMode: CaseMode,
  history: { role: string; content: string }[],
  message: string
): { isLaborOverrideRequest: boolean; requestedLaborHours: number | null } {
  const parsedRequestedLaborHours = parseRequestedLaborHours(message);
  const isLaborOverrideRequest =
    shouldTreatAsFinalReportForOverride(currentMode, history) &&
    detectLaborOverrideIntent(message) &&
    parsedRequestedLaborHours !== null;

  return {
    isLaborOverrideRequest,
    requestedLaborHours: isLaborOverrideRequest
      ? normalizeLaborHours(parsedRequestedLaborHours ?? 0)
      : null,
  };
}

function buildFinalReportFallback(args: {
  policy: LanguagePolicy;
  translationLanguage?: Language;
  laborHours?: number;
}): string {
  const totalLaborText = formatLaborHours(args.laborHours ?? 1.0);
  const englishReport = `Complaint: Complaint details pending verification.
Diagnostic Procedure: Diagnostic isolation completed based on available technician inputs.
Verified Condition: Condition not operating per specification under reported test conditions.
Recommended Corrective Action: Perform unit-level corrective action aligned to verified condition.
Estimated Labor: System isolation and access - ${totalLaborText} hr. Total labor: ${totalLaborText} hr.
Required Parts: Part number to be confirmed at service counter.`;

  if (!args.policy.includeTranslation || !args.translationLanguage || args.translationLanguage === "EN") {
    return englishReport;
  }

  const translation =
    args.translationLanguage === "RU"
      ? `Жалоба: Детали жалобы ожидают подтверждения.
Диагностическая процедура: Диагностическая изоляция завершена на основе доступных данных техника.
Подтверждённое состояние: Состояние не соответствует спецификации при заявленных условиях проверки.
Рекомендуемое корректирующее действие: Выполнить корректирующее действие на уровне узла в соответствии с подтверждённым состоянием.
Оценка трудозатрат: Изоляция системы и доступ - ${totalLaborText} ч. Total labor: ${totalLaborText} hr.
Необходимые детали: Номер детали будет уточнён на сервисной стойке.`
      : `Queja: Los detalles de la queja están pendientes de verificación.
Procedimiento de diagnóstico: El aislamiento diagnóstico se completó con base en la información disponible del técnico.
Condición verificada: La condición no opera según especificación bajo las condiciones de prueba reportadas.
Acción correctiva recomendada: Realizar una acción correctiva a nivel de unidad alineada con la condición verificada.
Mano de obra estimada: Aislamiento del sistema y acceso - ${totalLaborText} hr. Total labor: ${totalLaborText} hr.
Partes requeridas: El número de parte se confirmará en el mostrador de servicio.`;

  return `${englishReport}\n\n${TRANSLATION_SEPARATOR}\n\n${translation}`;
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
 * Extract text tokens from OpenAI Chat Completions chunk payload.
 */
function extractOpenAiChunkContent(payload: unknown): string {
  const choice = (payload as { choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown } }> })
    ?.choices?.[0];

  const deltaContent = choice?.delta?.content;
  if (typeof deltaContent === "string") return deltaContent;
  if (Array.isArray(deltaContent)) {
    return deltaContent
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part === "object" && part && "text" in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .join("");
  }

  const messageContent = choice?.message?.content;
  if (typeof messageContent === "string") return messageContent;
  if (Array.isArray(messageContent)) {
    return messageContent
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part === "object" && part && "text" in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .join("");
  }

  return "";
}

function logTiming(stage: string, payload: Record<string, number | string | boolean | undefined>) {
  console.log(`[Chat API v2][timing] ${JSON.stringify({ stage, ...payload })}`);
}

/**
 * Call OpenAI with true streaming and emit tokens immediately.
 * Also supports non-streaming fallback responses used in unit tests.
 */
async function callOpenAI(
  apiKey: string,
  body: object,
  signal: AbortSignal,
  onToken?: (token: string) => void
): Promise<{ response: string; durationMs: number; error?: string }> {
  const startedAt = Date.now();
  try {
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ ...body, stream: true }),
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      return {
        response: "",
        durationMs: Date.now() - startedAt,
        error: `Upstream error (${upstream.status}) ${text}`.slice(0, 500),
      };
    }

    // Fallback path for mocked/non-streaming test responses
    if (!upstream.body) {
      const json = (await upstream.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      };

      if (json.error) {
        return {
          response: "",
          durationMs: Date.now() - startedAt,
          error: `OpenAI error: ${json.error.message || "Unknown"}`,
        };
      }

      const content = json.choices?.[0]?.message?.content ?? "";
      if (content) onToken?.(content);
      return {
        response: content,
        durationMs: Date.now() - startedAt,
      };
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let response = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || !line.startsWith("data:")) continue;

        const data = line.slice(5).trim();
        if (!data) continue;
        if (data === "[DONE]") {
          return {
            response,
            durationMs: Date.now() - startedAt,
          };
        }

        let parsed: { error?: { message?: string } } | null = null;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }

        if (parsed?.error?.message) {
          return {
            response,
            durationMs: Date.now() - startedAt,
            error: `OpenAI error: ${parsed.error.message}`,
          };
        }

        const token = extractOpenAiChunkContent(parsed);
        if (!token) continue;

        response += token;
        onToken?.(token);
      }
    }

    if (buffer.trim().startsWith("data:")) {
      const data = buffer.trim().slice(5).trim();
      if (data && data !== "[DONE]") {
        try {
          const parsed = JSON.parse(data) as unknown;
          const token = extractOpenAiChunkContent(parsed);
          if (token) {
            response += token;
            onToken?.(token);
          }
        } catch {
          // ignore trailing partial chunks
        }
      }
    }

    return {
      response,
      durationMs: Date.now() - startedAt,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return {
      response: "",
      durationMs: Date.now() - startedAt,
      error: msg,
    };
  }
}

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

  // 2. Get output mode from request (v2 or legacy v1), with explicit in-message override
  const requestedOutputMode: LanguageMode = normalizeLanguageMode(
    body?.output?.mode ?? body?.languageMode
  );
  const forcedOutputLanguage = detectForcedOutputLanguage(message);
  const outputMode: LanguageMode = forcedOutputLanguage ?? requestedOutputMode;

  if (forcedOutputLanguage) {
    trackedInputLanguage = forcedOutputLanguage;
  }

  // 3. Compute effective output language
  const outputPolicy: OutputLanguagePolicyV2 = computeOutputPolicy(outputMode, trackedInputLanguage);

  // 4. Resolve declarative language policy (single source of truth for translation behavior)
  const langPolicy: LanguagePolicy = resolveLanguagePolicy(outputMode, trackedInputLanguage);

  // Translation language must follow tracked dialogue language (case metadata)
  const translationLanguage = langPolicy.includeTranslation ? trackedInputLanguage : undefined;

  console.log(`[Chat API v2] Input: detected=${detectedInputLanguage.detected} (${detectedInputLanguage.reason}), dialogue=${trackedInputLanguage}, forcedOutput=${forcedOutputLanguage ?? "none"}, Output: mode=${outputPolicy.mode}, effective=${outputPolicy.effective}, strategy=${outputPolicy.strategy}, includeTranslation=${langPolicy.includeTranslation}, translationLanguage=${translationLanguage ?? "none"}`);

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

  // Legacy recovery: labor_confirmation mode is retired.
  // Migrate stuck cases directly to final_report.
  if (currentMode === "labor_confirmation") {
    currentMode = "final_report";
    await storage.updateCase(ensuredCase.id, { mode: currentMode });
  }

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
  const historyLoadStart = Date.now();
  const history = await storage.listMessagesForContext(ensuredCase.id, DEFAULT_MEMORY_WINDOW);
  logTiming("load_history", {
    caseId: ensuredCase.id,
    loadHistoryMs: Date.now() - historyLoadStart,
  });

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
    if (engineResult.context.isolationComplete && engineResult.context.isolationFinding) {
      pivotTriggered = true;
      console.log(`[Chat API v2] Pivot triggered (Context Engine): "${engineResult.context.isolationFinding}"`);
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
  if (currentMode === "final_report") {
    factLockConstraint = buildFactLockConstraint(history);
  }

  const laborOverride = computeLaborOverrideRequest(currentMode, history, message);
  const isLaborOverrideRequest = laborOverride.isLaborOverrideRequest;
  const requestedLaborHours = laborOverride.requestedLaborHours;
  const requestedLaborHoursText =
    requestedLaborHours !== null ? formatLaborHours(requestedLaborHours) : null;

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

  const encoder = new TextEncoder();
  const ac = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";
      let aborted = false;
      const emitToken = (token: string) => {
        if (aborted || !token) return;
        controller.enqueue(encoder.encode(sseEncode({ type: "token", token })));
      };

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

        if (isLaborOverrideRequest && requestedLaborHours !== null && requestedLaborHoursText) {
          console.log(
            `[Chat API v2] Final report labor override requested: total=${requestedLaborHoursText} hr`
          );

          const overrideConstraints = [
            factLockConstraint,
            `LABOR OVERRIDE (MANDATORY):
- The technician requires total labor to be exactly ${requestedLaborHoursText} hours.
- Rewrite ONLY the 'Estimated Labor' section to fit exactly ${requestedLaborHoursText} hr total.
- Keep all other sections semantically identical (no new diagnostics, no new parts, no new findings).
- Do NOT ask questions. Do NOT request confirmations.
- End the labor section with: "Total labor: ${requestedLaborHoursText} hr"`,
          ]
            .filter(Boolean)
            .join("\n\n");

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

          const translationInstruction =
            langPolicy.includeTranslation && translationLanguage
              ? `\n\nAfter the English report, output "--- TRANSLATION ---" and provide a complete translation into ${
                  translationLanguage === "RU"
                    ? "Russian"
                    : translationLanguage === "ES"
                    ? "Spanish"
                    : "English"
                }.`
              : "";

          const overrideRequest = `Regenerate the FINAL SHOP REPORT now with the same facts and sections.

Keep Complaint, Diagnostic Procedure, Verified Condition, Recommended Corrective Action, and Required Parts semantically identical.
Rewrite only Estimated Labor so the breakdown sums to exactly ${requestedLaborHoursText} hr.
Use canonical format with one decimal and end with: "Total labor: ${requestedLaborHoursText} hr".
Do NOT ask labor confirmation questions.
Do NOT ask follow-up diagnostic questions.${translationInstruction}`;

          const overrideBody = {
            model: getModelForMode("final_report"),
            messages: buildOpenAiMessages({
              system: overridePrompt,
              history,
              userMessage: overrideRequest,
              attachments: undefined,
            }),
          };

          let overrideResult = await callOpenAI(apiKey, overrideBody, ac.signal, emitToken);
          logTiming("openai_call", {
            caseId: ensuredCase.id,
            mode: "final_report",
            path: "labor_override_first",
            openAiMs: overrideResult.durationMs,
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
                    `LABOR_TOTAL_FORMAT: Final report must include \"Total labor: ${requestedLaborHoursText} hr\" in canonical one-decimal format`,
                  ]),
            ];
            return {
              valid: violations.length === 0,
              violations,
            };
          };

          if (!overrideResult.error && overrideContent.trim()) {
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
              emitToken("\n\n[System] Repairing output...\n\n");
              const correctionViolations = [
                ...modeValidation.violations,
                ...laborValidation.violations,
              ];
              const correctionInstruction = [
                buildCorrectionInstruction(correctionViolations),
                `Regenerate in FINAL_REPORT mode only.`,
                `Do NOT output diagnostic steps or step IDs (no \"Step\", no \"wp_\").`,
                `Keep all sections except Estimated Labor semantically unchanged.`,
                `Estimated Labor must sum to exactly ${requestedLaborHoursText} hr and end with \"Total labor: ${requestedLaborHoursText} hr\".`,
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

              overrideResult = await callOpenAI(apiKey, retryBody, ac.signal, emitToken);
              logTiming("openai_call", {
                caseId: ensuredCase.id,
                mode: "final_report",
                path: "labor_override_retry",
                openAiMs: overrideResult.durationMs,
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

        // Build initial request
        const openAiBody = {
          model: getModelForMode(currentMode),
          messages: buildOpenAiMessages({
            system: systemPrompt,
            history,
            userMessage: message,
            attachments,
          }),
        };

        // First attempt
        let result = await callOpenAI(apiKey, openAiBody, ac.signal, emitToken);
        logTiming("openai_call", {
          caseId: ensuredCase.id,
          mode: currentMode,
          path: "primary_first",
          openAiMs: result.durationMs,
        });

        if (result.error) {
          controller.enqueue(
            encoder.encode(sseEncode({ type: "error", code: "UPSTREAM_ERROR", message: result.error }))
          );
          controller.enqueue(encoder.encode(sseEncode({ type: "done" })));
          controller.close();
          return;
        }

        // Validate output (pass language policy for translation enforcement)
        const validateStart = Date.now();
        let validation = validateOutput(result.response, currentMode, langPolicy.includeTranslation, translationLanguage);
        validation = applyDiagnosticModeValidationGuard(validation, currentMode, result.response);
        logValidation(validation, { caseId: ensuredCase.id, mode: currentMode });
        logTiming("validate_output", {
          caseId: ensuredCase.id,
          mode: currentMode,
          path: "primary_first",
          validateMs: Date.now() - validateStart,
        });

        // If validation fails, retry once with correction
        if (!validation.valid && !aborted) {
          console.log(`[Chat API v2] Validation failed, retrying with correction...`);
          emitToken("\n\n[System] Repairing output...\n\n");
          const correctionInstructionParts = [buildCorrectionInstruction(validation.violations)];
          if (validation.violations.includes(DIAGNOSTIC_MODE_GUARD_VIOLATION)) {
            correctionInstructionParts.push(
              buildDiagnosticDriftCorrectionInstruction(engineResult?.context.activeStepId)
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

          result = await callOpenAI(apiKey, retryBody, ac.signal, emitToken);
          logTiming("openai_call", {
            caseId: ensuredCase.id,
            mode: currentMode,
            path: "primary_retry",
            openAiMs: result.durationMs,
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

          // If still fails, use safe fallback with EFFECTIVE OUTPUT language
          if (!validation.valid || result.error) {
            console.log(`[Chat API v2] Retry failed, using safe fallback in ${outputPolicy.effective}`);
            result.response =
              currentMode === "diagnostic" && validation.violations.includes(DIAGNOSTIC_MODE_GUARD_VIOLATION)
                ? buildDiagnosticDriftFallback(engineResult?.context.activeStepId)
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

        // ========================================
        // CONTEXT ENGINE: Record agent action (AFTER LLM response)
        // ========================================
        if (currentMode === "diagnostic" && engineResult) {
          // Determine action type based on response content
          const actionType = isFallbackResponse(full) ? "fallback" : 
                            engineResult.context.submode !== "main" ? "clarification" : "question";
          
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
        // AUTOMATIC MODE TRANSITION: diagnostic -> final_report
        // ========================================
        const transitionResult = detectTransitionSignal(full);
        const shouldGenerateFinalReport =
          currentMode === "diagnostic" &&
          !aborted &&
          (pivotTriggered || Boolean(transitionResult));

        if (shouldGenerateFinalReport) {
          const diagnosticContent = transitionResult?.cleanedResponse ?? full;
          const transitionReason = pivotTriggered
            ? "context-engine-pivot"
            : "transition-signal";

          console.log(`[Chat API v2] Auto-transition to final_report (${transitionReason})`);

          // 1) Persist diagnostic response (already streamed in real-time)
          if (!aborted && diagnosticContent.trim()) {
            await storage.appendMessage({
              caseId: ensuredCase.id,
              role: "assistant",
              content: diagnosticContent,
              language: outputPolicy.effective,
              userId: user?.id,
            });
          }

          // 2) Transition to final_report immediately
          currentMode = "final_report";
          await storage.updateCase(ensuredCase.id, { mode: currentMode });
          controller.enqueue(
            encoder.encode(
              sseEncode({ type: "mode_transition", from: "diagnostic", to: currentMode })
            )
          );

          emitToken("\n\n");

          // 3) Compose and request final report
          const transitionHistoryStart = Date.now();
          const updatedHistoryForReport = await storage.listMessagesForContext(
            ensuredCase.id,
            DEFAULT_MEMORY_WINDOW
          );
          logTiming("load_history", {
            caseId: ensuredCase.id,
            mode: "final_report",
            path: "transition",
            loadHistoryMs: Date.now() - transitionHistoryStart,
          });
          const factLock = buildFactLockConstraint(updatedHistoryForReport);
          const transitionConstraints = [
            "FINAL REPORT DIRECTIVE (MANDATORY): Generate the complete FINAL SHOP REPORT immediately.",
            "Do NOT ask for labor confirmation.",
            "Do NOT ask follow-up questions.",
            "Estimated Labor must include task-level breakdown lines and end with 'Total labor: X hr'.",
            factLock,
          ]
            .filter(Boolean)
            .join("\n\n");

          const transitionComposeStart = Date.now();
          const finalReportPrompt = composePromptV2({
            mode: currentMode,
            inputDetected: trackedInputLanguage,
            outputEffective: outputPolicy.effective,
            includeTranslation: langPolicy.includeTranslation,
            translationLanguage,
            additionalConstraints: transitionConstraints,
          });
          logTiming("compose_prompt", {
            caseId: ensuredCase.id,
            mode: currentMode,
            path: "transition",
            composePromptMs: Date.now() - transitionComposeStart,
          });

          const translationInstruction =
            langPolicy.includeTranslation && translationLanguage
              ? `\n\nAfter the English report, output "--- TRANSLATION ---" and provide a complete translation into ${
                  translationLanguage === "RU"
                    ? "Russian"
                    : translationLanguage === "ES"
                    ? "Spanish"
                    : "English"
                }.`
              : "";

          const finalReportRequest = `Generate the FINAL SHOP REPORT now.

REQUIRED OUTPUT FORMAT (plain text, no numbering, no tables):
Complaint:
Diagnostic Procedure:
Verified Condition:
Recommended Corrective Action:
Estimated Labor:
Required Parts:

Estimated Labor MUST include 2-5 task-level breakdown lines and end with "Total labor: X hr".
Do NOT ask labor-confirmation questions.
Do NOT ask follow-up questions.${translationInstruction}`;

          const finalReportBody = {
            model: getModelForMode("final_report"),
            temperature: 0.2,
            messages: buildOpenAiMessages({
              system: finalReportPrompt,
              history: updatedHistoryForReport,
              userMessage: finalReportRequest,
              attachments: undefined,
            }),
          };

          let finalResult = await callOpenAI(apiKey, finalReportBody, ac.signal, emitToken);
          logTiming("openai_call", {
            caseId: ensuredCase.id,
            mode: "final_report",
            path: "transition_first",
            openAiMs: finalResult.durationMs,
          });
          let finalContent = finalResult.response;

          if (!finalResult.error && finalContent.trim()) {
            const finalValidateStart = Date.now();
            let finalValidation = validateOutput(
              finalContent,
              currentMode,
              langPolicy.includeTranslation,
              translationLanguage
            );
            finalValidation = applyDiagnosticModeValidationGuard(finalValidation, currentMode, finalContent);
            logValidation(finalValidation, { caseId: ensuredCase.id, mode: currentMode });
            logTiming("validate_output", {
              caseId: ensuredCase.id,
              mode: currentMode,
              path: "transition_first",
              validateMs: Date.now() - finalValidateStart,
            });

            if (!finalValidation.valid && !aborted) {
              emitToken("\n\n[System] Repairing output...\n\n");
              const correctionInstruction = [
                buildCorrectionInstruction(finalValidation.violations),
                "Ensure Estimated Labor includes task-level breakdown and ends with 'Total labor: X hr'.",
                "Do NOT ask labor confirmation.",
                "Do NOT ask follow-up questions.",
              ].join("\n");

              const retryBody = {
                ...finalReportBody,
                messages: buildOpenAiMessages({
                  system: finalReportPrompt,
                  history: updatedHistoryForReport,
                  userMessage: finalReportRequest,
                  attachments: undefined,
                  correctionInstruction,
                }),
              };

              finalResult = await callOpenAI(apiKey, retryBody, ac.signal, emitToken);
              logTiming("openai_call", {
                caseId: ensuredCase.id,
                mode: currentMode,
                path: "transition_retry",
                openAiMs: finalResult.durationMs,
              });
              if (!finalResult.error) {
                finalContent = finalResult.response;
                const retryValidateStart = Date.now();
                finalValidation = validateOutput(
                  finalContent,
                  currentMode,
                  langPolicy.includeTranslation,
                  translationLanguage
                );
                finalValidation = applyDiagnosticModeValidationGuard(finalValidation, currentMode, finalContent);
                logValidation(finalValidation, { caseId: ensuredCase.id, mode: currentMode });
                logTiming("validate_output", {
                  caseId: ensuredCase.id,
                  mode: currentMode,
                  path: "transition_retry",
                  validateMs: Date.now() - retryValidateStart,
                });
              }
            }

            // Output-layer enforcement: strip translation for EN mode
            finalContent = enforceLanguagePolicy(finalContent, langPolicy);

            const postValidation = validateOutput(
              finalContent,
              currentMode,
              langPolicy.includeTranslation,
              translationLanguage
            );
            const guardedPostValidation = applyDiagnosticModeValidationGuard(
              postValidation,
              currentMode,
              finalContent
            );

            if (!guardedPostValidation.valid) {
              console.log(`[Chat API v2] Final report validation failed after retry, using fallback`);
              finalContent = buildFinalReportFallback({
                policy: langPolicy,
                translationLanguage,
              });
              emitToken(finalContent);
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
          } else {
            console.error(
              `[Chat API v2] Final report generation error after transition: ${finalResult.error || "empty response"}`
            );
            const fallback = buildFinalReportFallback({
              policy: langPolicy,
              translationLanguage,
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
        } else {
          // No transition - apply output-layer enforcement for persisted content
          full = enforceLanguagePolicy(full, langPolicy);

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
