import { normalizeLanguageMode, type LanguageMode, type Language } from "@/lib/lang";
import { storage } from "@/lib/storage";
import { getCurrentUser } from "@/lib/auth";
import { 
  composePrompt, 
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

type ChatBody = {
  caseId?: string;
  message: string;
  languageMode?: LanguageMode;
  attachments?: Attachment[];
  /** Explicit dialogue language (optional override) */
  dialogueLanguage?: Language;
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
 * Call OpenAI and stream the response
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

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      return { response: "", error: `Upstream error (${upstream.status}) ${text}`.slice(0, 500) };
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.replace(/^data:\s*/, "");
        if (payload === "[DONE]") break;

        try {
          const json = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[];
          };
          const token = json?.choices?.[0]?.delta?.content;
          if (token) full += token;
        } catch {
          // Ignore malformed lines
        }
      }
    }

    return { response: full };
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

  const body = (await req.json().catch(() => null)) as ChatBody | null;
  const message = (body?.message ?? "").trim();
  if (!message) {
    return new Response(
      JSON.stringify({ error: "Missing message" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const languageMode = normalizeLanguageMode(body?.languageMode);
  
  // Determine the input language:
  // 1. If explicit language selected (not AUTO), use that
  // 2. If AUTO, detect from message
  let inputLanguage: Language;
  let languageSource: "AUTO" | "MANUAL";
  
  if (languageMode !== "AUTO") {
    // User explicitly selected a language - always use it
    inputLanguage = languageMode;
    languageSource = "MANUAL";
  } else {
    // Auto-detect from message content
    const detected = storage.inferLanguageForMessage(message, "AUTO");
    inputLanguage = detected.language;
    languageSource = "AUTO";
  }

  const attachments = body?.attachments?.filter(
    (a) => a.type === "image" && a.dataUrl && a.dataUrl.startsWith("data:image/")
  );

  // Ensure case exists
  const ensuredCase = await storage.ensureCase({
    caseId: body?.caseId,
    titleSeed: message,
    inputLanguage,
    languageSource,
    userId: user?.id,
  });

  // Determine the effective language for this request:
  // - If user explicitly selected a language (not AUTO), ALWAYS use it (override case)
  // - If AUTO and case already has a language, use case language (language lock)
  // - If AUTO and new case, use detected language
  let effectiveLanguage: Language;
  
  if (languageMode !== "AUTO") {
    // Explicit selection always overrides
    effectiveLanguage = languageMode;
    
    // Update case if language changed
    if (ensuredCase.inputLanguage !== effectiveLanguage) {
      await storage.updateCase(ensuredCase.id, { inputLanguage: effectiveLanguage });
      console.log(`[Chat API] Language override: ${ensuredCase.inputLanguage} → ${effectiveLanguage}`);
    }
  } else {
    // AUTO mode: use case's locked language if it exists, else use detected
    effectiveLanguage = ensuredCase.inputLanguage || inputLanguage;
  }

  // Get current mode from case
  let currentMode: CaseMode = ensuredCase.mode || "diagnostic";

  // Check for explicit mode transition commands
  const commandMode = detectModeCommand(message);
  if (commandMode && commandMode !== currentMode) {
    console.log(`[Chat API] Mode transition: ${currentMode} → ${commandMode} (explicit command)`);
    currentMode = commandMode;
    // Persist mode change
    await storage.updateCase(ensuredCase.id, { mode: currentMode });
  }

  console.log(`[Chat API] Request: caseId=${ensuredCase.id}, mode=${currentMode}, lang=${effectiveLanguage}, source=${languageSource}`);

  // Persist user message
  await storage.appendMessage({
    caseId: ensuredCase.id,
    role: "user",
    content: message,
    language: effectiveLanguage,
    userId: user?.id,
  });

  // Load conversation history (memory window)
  const history = await storage.listMessagesForContext(ensuredCase.id, DEFAULT_MEMORY_WINDOW);

  // Compose system prompt based on mode and language
  const systemPrompt = composePrompt({
    mode: currentMode,
    dialogueLanguage: effectiveLanguage,
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
        controller.enqueue(encoder.encode(sseEncode({ type: "case", caseId: ensuredCase.id })));
        controller.enqueue(encoder.encode(sseEncode({ type: "mode", mode: currentMode })));

        // Build initial request
        const openAiBody = {
          model: "gpt-4o-mini",
          stream: false, // Use non-streaming for validation/retry
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
          console.log(`[Chat API] Validation failed, retrying with correction...`);
          
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

          // If still fails, use safe fallback
          if (!validation.valid || result.error) {
            console.log(`[Chat API] Retry failed, using safe fallback`);
            result.response = getSafeFallback(currentMode, effectiveLanguage);
            
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

        // Save assistant message
        if (!aborted && full.trim()) {
          await storage.appendMessage({
            caseId: ensuredCase.id,
            role: "assistant",
            content: full,
            language: effectiveLanguage,
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
