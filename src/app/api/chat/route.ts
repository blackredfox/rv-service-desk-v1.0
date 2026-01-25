import { SYSTEM_PROMPT_V1 } from "@/lib/prompts/system-prompt-v1";
import { prisma } from "@/lib/db";
import { detectLanguage, normalizeLanguageMode, type LanguageMode } from "@/lib/lang";

export const runtime = "nodejs";

type ChatBody = {
  caseId?: string;
  message: string;
  languageMode?: LanguageMode; // "AUTO" | "EN" | "RU" | "ES"
};

function sseEncode(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function buildOpenAiMessages(args: {
  system: string;
  history: { role: "user" | "assistant"; content: string }[];
  userMessage: string;
}) {
  return [
    { role: "system", content: args.system },
    ...args.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: args.userMessage },
  ];
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response("Missing OPENAI_API_KEY", { status: 500 });
  }

  const body = (await req.json().catch(() => null)) as ChatBody | null;
  const message = (body?.message ?? "").trim();
  if (!message) {
    return new Response("Missing message", { status: 400 });
  }

  const languageMode = normalizeLanguageMode(body?.languageMode);
  const detected = detectLanguage(message);
  const effectiveLanguage = languageMode === "AUTO" ? detected.language : languageMode;
  const languageSource = languageMode === "AUTO" ? "AUTO" : "MANUAL";

  // Ensure a case exists
  const caseId = body?.caseId;
  const chatCase = caseId
    ? await prisma.case.findFirst({ where: { id: caseId, deletedAt: null } })
    : null;

  const ensuredCase = chatCase
    ? await prisma.case.update({
        where: { id: chatCase.id },
        data: {
          // If language is manually set, persist it.
          inputLanguage: effectiveLanguage,
          languageSource,
          // Set a title if still default.
          title:
            chatCase.title === "New Case"
              ? message.slice(0, 60)
              : chatCase.title,
        },
      })
    : await prisma.case.create({
        data: {
          title: message.slice(0, 60) || "New Case",
          inputLanguage: effectiveLanguage,
          languageSource,
        },
      });

  // Load last 30 messages for context
  const historyMessages = await prisma.message.findMany({
    where: { caseId: ensuredCase.id },
    orderBy: { createdAt: "asc" },
    take: 30,
    select: { role: true, content: true },
  });

  const history = historyMessages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  // Persist user message
  const userMsg = await prisma.message.create({
    data: {
      caseId: ensuredCase.id,
      role: "user",
      content: message,
      language: effectiveLanguage,
    },
  });

  await prisma.languageMeta.create({
    data: {
      caseId: ensuredCase.id,
      messageId: userMsg.id,
      detectedLanguage: effectiveLanguage,
      confidence: languageMode === "AUTO" ? detected.confidence : 1,
      source: languageSource,
    },
  });

  const openAiBody = {
    model: "gpt-4o-mini",
    stream: true,
    temperature: 0.2,
    messages: buildOpenAiMessages({
      system: SYSTEM_PROMPT_V1,
      history,
      userMessage: message,
    }),
  };

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";

      try {
        controller.enqueue(encoder.encode(sseEncode({ type: "case", caseId: ensuredCase.id })));

        const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
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
              const json = JSON.parse(payload) as any;
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

        // Save assistant message
        if (full.trim()) {
          await prisma.message.create({
            data: {
              caseId: ensuredCase.id,
              role: "assistant",
              content: full,
              language: effectiveLanguage,
            },
          });
        }

        controller.enqueue(encoder.encode(sseEncode({ type: "done" })));
        controller.close();
      } catch (e: any) {
        controller.enqueue(
          encoder.encode(
            sseEncode({ type: "error", message: (e?.message ?? "Unknown error").slice(0, 300) })
          )
        );
        controller.enqueue(encoder.encode(sseEncode({ type: "done" })));
        controller.close();
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
