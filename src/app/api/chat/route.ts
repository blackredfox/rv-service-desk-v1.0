import { SYSTEM_PROMPT_V1 } from "@/lib/prompts/system-prompt-v1";
import { normalizeLanguageMode, type LanguageMode } from "@/lib/lang";
import { storage } from "@/lib/storage";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

type Attachment = {
  type: "image";
  dataUrl: string; // base64 data URL, e.g., "data:image/jpeg;base64,..."
};

type ChatBody = {
  caseId?: string;
  message: string;
  languageMode?: LanguageMode;
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

  return messages;
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "Missing OPENAI_API_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Get current user (optional for backward compatibility)
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
  const { language: effectiveLanguage, languageSource } = storage.inferLanguageForMessage(
    message,
    languageMode
  );

  // Session-only attachments (images are used for this request only, not stored)
  const attachments = body?.attachments?.filter(
    (a) => a.type === "image" && a.dataUrl && a.dataUrl.startsWith("data:image/")
  );

  // Ensure a case exists
  const ensuredCase = await storage.ensureCase({
    caseId: body?.caseId,
    titleSeed: message,
    inputLanguage: effectiveLanguage,
    languageSource,
    userId: user?.id,
  });

  // Load last 30 messages for context
  const history = await storage.listMessagesForContext(ensuredCase.id, 30);

  // Persist user message (without attachments - session only)
  await storage.appendMessage({
    caseId: ensuredCase.id,
    role: "user",
    content: message,
    language: effectiveLanguage,
    userId: user?.id,
  });

  const openAiBody = {
    model: "gpt-4o-mini",
    stream: true,
    temperature: 0.2,
    messages: buildOpenAiMessages({
      system: SYSTEM_PROMPT_V1,
      history,
      userMessage: message,
      attachments,
    }),
  };

  const encoder = new TextEncoder();
  const ac = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";
      let aborted = false;

      const onAbort = () => {
        aborted = true;
        try {
          ac.abort();
        } catch {
          // ignore
        }
      };

      // Abort upstream request if client disconnects
      req.signal.addEventListener("abort", onAbort, { once: true });

      try {
        controller.enqueue(encoder.encode(sseEncode({ type: "case", caseId: ensuredCase.id })));

        const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          signal: ac.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(openAiBody),
        });

        if (!upstream.ok || !upstream.body) {
          const text = await upstream.text().catch(() => "");
          controller.enqueue(
            encoder.encode(
              sseEncode({
                type: "error",
                code: "UPSTREAM_ERROR",
                message: `Upstream error (${upstream.status}) ${text}`.slice(0, 500),
              })
            )
          );
          controller.enqueue(encoder.encode(sseEncode({ type: "done" })));
          controller.close();
          return;
        }

        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          if (aborted) break;
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.replace(/^data:\s*/, "");
            if (payload === "[DONE]") {
              break;
            }

            try {
              const json = JSON.parse(payload) as unknown as {
                choices?: { delta?: { content?: string } }[];
              };
              const token: string | undefined = json?.choices?.[0]?.delta?.content;
              if (token) {
                full += token;
                controller.enqueue(encoder.encode(sseEncode({ type: "token", token })));
              }
            } catch {
              // Ignore malformed lines
            }
          }
        }

        // Save assistant message (skip persistence if client aborted)
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
        // If the client disconnected, just stop.
        if (aborted) {
          controller.close();
          return;
        }

        const msg = e instanceof Error ? e.message : "Unknown error";
        controller.enqueue(
          encoder.encode(
            sseEncode({ type: "error", code: "INTERNAL_ERROR", message: msg.slice(0, 300) })
          )
        );
        controller.enqueue(encoder.encode(sseEncode({ type: "done" })));
        controller.close();
      } finally {
        req.signal.removeEventListener("abort", onAbort);
      }
    },
    cancel() {
      // Called if the consumer cancels the stream
      try {
        ac.abort();
      } catch {
        // ignore
      }
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
