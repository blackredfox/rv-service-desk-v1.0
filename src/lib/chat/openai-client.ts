/**
 * OpenAI Chat API streaming client.
 *
 * Responsibility: HTTP transport to OpenAI, streaming token extraction.
 * Does NOT own: diagnostic logic, flow control, validation, retries.
 */

export type OpenAiMessageContent =
  | string
  | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;

export type OpenAiMessage = {
  role: string;
  content: OpenAiMessageContent;
};

export type OpenAiCallResult = {
  response: string;
  durationMs: number;
  firstTokenMs?: number;
  error?: string;
};

/**
 * Extract text tokens from OpenAI Chat Completions chunk payload.
 */
export function extractOpenAiChunkContent(payload: unknown): string {
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

/**
 * Call OpenAI with true streaming and emit tokens immediately.
 * Also supports non-streaming fallback responses used in unit tests.
 */
export async function callOpenAI(
  apiKey: string,
  body: object,
  signal: AbortSignal,
  onToken?: (token: string) => void
): Promise<OpenAiCallResult> {
  const startedAt = Date.now();
  let firstTokenMs: number | undefined;

  const emitUpstreamToken = (token: string) => {
    if (!token) return;
    if (firstTokenMs === undefined) {
      firstTokenMs = Date.now() - startedAt;
    }
    onToken?.(token);
  };

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
        firstTokenMs,
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
          firstTokenMs,
          error: `OpenAI error: ${json.error.message || "Unknown"}`,
        };
      }

      const content = json.choices?.[0]?.message?.content ?? "";
      emitUpstreamToken(content);
      return {
        response: content,
        durationMs: Date.now() - startedAt,
        firstTokenMs,
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
            firstTokenMs,
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
            firstTokenMs,
            error: `OpenAI error: ${parsed.error.message}`,
          };
        }

        const token = extractOpenAiChunkContent(parsed);
        if (!token) continue;

        response += token;
        emitUpstreamToken(token);
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
            emitUpstreamToken(token);
          }
        } catch {
          // ignore trailing partial chunks
        }
      }
    }

    return {
      response,
      durationMs: Date.now() - startedAt,
      firstTokenMs,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return {
      response: "",
      durationMs: Date.now() - startedAt,
      firstTokenMs,
      error: msg,
    };
  }
}

/**
 * Build OpenAI chat messages array with optional image attachments.
 */
export function buildOpenAiMessages(args: {
  system: string;
  history: { role: "user" | "assistant"; content: string }[];
  userMessage: string;
  attachments?: Array<{ type: "image"; dataUrl: string }>;
  correctionInstruction?: string;
}): OpenAiMessage[] {
  const messages: OpenAiMessage[] = [
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
