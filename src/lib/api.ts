import type { CaseSummary, ChatMessage } from "@/lib/storage";

export type LanguageMode = "AUTO" | "EN" | "RU" | "ES";


async function jsonOrThrow<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => null)) as T | null;
  if (!res.ok) {
    const maybe = data as unknown as { error?: string } | null;
    const msg = maybe?.error || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  if (!data) throw new Error("Empty response");
  return data;
}

export async function apiListCases() {
  return jsonOrThrow<{ cases: CaseSummary[] }>(await fetch("/api/cases", { cache: "no-store" }));
}

export async function apiCreateCase(title?: string) {
  return jsonOrThrow<{ case: CaseSummary }>(
    await fetch("/api/cases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    })
  );
}

export async function apiGetCase(id: string) {
  return jsonOrThrow<{ case: CaseSummary; messages: ChatMessage[] }>(
    await fetch(`/api/cases/${id}`, { cache: "no-store" })
  );
}

export async function apiPatchCase(id: string, input: { title?: string; languageMode?: LanguageMode }) {
  return jsonOrThrow<{ case: CaseSummary }>(
    await fetch(`/api/cases/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
  );
}

export async function apiDeleteCase(id: string) {
  return jsonOrThrow<{ ok: true }>(
    await fetch(`/api/cases/${id}`, {
      method: "DELETE",
    })
  );
}

export async function apiSearch(q: string) {
  const sp = new URLSearchParams({ q });
  return jsonOrThrow<{ cases: CaseSummary[] }>(
    await fetch(`/api/search?${sp.toString()}`, { cache: "no-store" })
  );
}

export type ChatSseEvent =
  | { type: "case"; caseId: string }
  | { type: "token"; token: string }
  | { type: "error"; message: string }
  | { type: "done" };

export async function apiChatStream(args: { caseId?: string; message: string; languageMode: LanguageMode }) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });

  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `Chat request failed (${res.status})`);
  }

  return res.body;
}

export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (ev: ChatSseEvent) => void
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const line = frame
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.startsWith("data:"));
      if (!line) continue;
      const payload = line.replace(/^data:\s*/, "");
      try {
        onEvent(JSON.parse(payload));
      } catch {
        // ignore
      }
    }
  }
}
