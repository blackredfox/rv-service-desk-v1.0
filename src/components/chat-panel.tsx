"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/storage";
import { apiChatStream, apiGetCase, readSseStream, type LanguageMode } from "@/lib/api";

type Props = {
  caseId: string | null;
  languageMode: LanguageMode;
  onCaseId: (caseId: string) => void;
  disabled?: boolean;
};

export function ChatPanel({ caseId, languageMode, onCaseId, disabled }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!caseId) {
      setMessages([]);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await apiGetCase(caseId);
        if (cancelled) return;
        setMessages(res.messages);
      } catch (e: unknown) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Failed to load messages";
        setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const canSend = useMemo(() => input.trim().length > 0 && !loading, [input, loading]);

  async function send() {
    const text = input.trim();
    if (!text) return;

    setInput("");
    setError(null);
    setLoading(true);

    const localId = `local_${Date.now()}`;
    const now = new Date().toISOString();

    setMessages((prev) => [
      ...prev,
      {
        id: localId,
        caseId: caseId ?? "pending",
        role: "user",
        content: text,
        language: languageMode === "AUTO" ? "EN" : languageMode,
        createdAt: now,
      },
      {
        id: `${localId}_assistant`,
        caseId: caseId ?? "pending",
        role: "assistant",
        content: "",
        language: languageMode === "AUTO" ? "EN" : languageMode,
        createdAt: now,
      },
    ]);

    try {
      const body = await apiChatStream({ caseId: caseId ?? undefined, message: text, languageMode });
      await readSseStream(body, (ev) => {
        if (ev.type === "case") {
          onCaseId(ev.caseId);
        }

        if (ev.type === "token") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === `${localId}_assistant` ? { ...m, content: m.content + ev.token } : m
            )
          );
        }

        if (ev.type === "error") {
          setError(ev.message);
        }

        if (ev.type === "done") {
          setLoading(false);
          const effectiveCaseId = caseId ?? null;
          // refresh persisted messages (works for brand new cases too)
          if (effectiveCaseId) {
            void apiGetCase(effectiveCaseId)
              .then((res) => setMessages(res.messages))
              .catch(() => {});
          }
        }
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to send";
      setError(msg);
      setLoading(false);
    }
  }

  return (
    <section data-testid="chat-panel" className="flex h-full flex-1 flex-col">
      <div className="flex-1 overflow-y-auto p-6">
        {!caseId && messages.length === 0 ? (
          <div data-testid="chat-empty-state" className="mx-auto max-w-2xl pt-12 text-zinc-600 dark:text-zinc-300">
            <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">RV Service Desk</h1>
            <p className="mt-2 text-sm">
              Start a new case from the left or send a message. The assistant will produce an English report plus a translated copy.
            </p>
          </div>
        ) : null}

        {error ? (
          <div data-testid="chat-error" className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <div className="mx-auto max-w-2xl space-y-4">
          {messages.map((m) => (
            <div
              key={m.id}
              data-testid={`chat-message-${m.role}-${m.id}`}
              className={
                "rounded-xl border px-4 py-3 text-sm leading-6 " +
                (m.role === "user"
                  ? "border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
                  : "border-zinc-200 bg-zinc-50 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-50")
              }
            >
              <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                {m.role === "user" ? "Technician" : "Assistant"}
              </div>
              <div className="whitespace-pre-wrap">{m.content}</div>
            </div>
          ))}

          {loading && messages.length === 0 ? (
            <div data-testid="chat-loading" className="text-sm text-zinc-500">
              Loading...
            </div>
          ) : null}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-zinc-200 bg-white/70 p-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/50">
        <div className="mx-auto flex max-w-2xl items-end gap-3">
          <textarea
            data-testid="chat-composer-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message"
            rows={2}
            className="max-h-40 flex-1 resize-none rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-700"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (canSend) void send();
              }
            }}
          />
          <button
            type="button"
            data-testid="chat-send-button"
            disabled={!canSend}
            onClick={() => void send()}
            className="h-10 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-white"
          >
            Send
          </button>
        </div>
        <div className="mx-auto mt-2 max-w-2xl text-xs text-zinc-500 dark:text-zinc-400">
          Enter to send. Shift+Enter for newline.
        </div>
      </div>
    </section>
  );
}
