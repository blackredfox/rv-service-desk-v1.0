import { 
  normalizeLanguageMode, 
  detectInputLanguageV2, 
  computeOutputPolicy,
  type LanguageMode, 
  type Language,
  type InputLanguageV2,
  type OutputLanguagePolicyV2,
} from "@/lib/lang";
import { storage } from "@/lib/storage";
import { getCurrentUser } from "@/lib/auth";
import { 
  composePromptV2, 
  detectModeCommand, 
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

export const runtime = "nodejs";

type Attachment = {
  type: "image";
  dataUrl: string;
};

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
  
  console.log(`[Chat API v2] Input: detected=${inputLanguage.detected} (${inputLanguage.reason}), Output: mode=${outputPolicy.mode}, effective=${outputPolicy.effective}, strategy=${outputPolicy.strategy}`);

  const attachments = body?.attachments?.filter(
    (a) => a.type === "image" && a.dataUrl && a.dataUrl.startsWith("data:image/")
  );

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

  // Compose system prompt using v2 semantics:
  // - inputDetected: what language user wrote in
  // - outputEffective: what language assistant must respond in
  const systemPrompt = composePromptV2({
    mode: currentMode,
    inputDetected: inputLanguage.detected,
    outputEffective: outputPolicy.effective,
  });

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

        // Validate output
        let validation = validateOutput(result.response, currentMode);
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
            validation = validateOutput(result.response, currentMode);
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

        // Stream tokens to client
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
