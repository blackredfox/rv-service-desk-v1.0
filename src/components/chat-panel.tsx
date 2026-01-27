"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import type { ChatMessage } from "@/lib/storage";
import {
  apiChatStream,
  apiGetCase,
  readSseStream,
  type LanguageMode,
  type ChatSseEvent,
} from "@/lib/api";
import { VoiceButton } from "@/components/voice-button";
import { PhotoAttachButton, type PhotoAttachment } from "@/components/photo-attach";
import { analytics } from "@/lib/client-analytics";

type Props = {
  caseId: string | null;
  languageMode: LanguageMode;
  onCaseId: (caseId: string | null) => void;
  disabled?: boolean;
};

export function ChatPanel({ caseId, languageMode, onCaseId, disabled }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoAttachment, setPhotoAttachment] = useState<PhotoAttachment | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Show Copy (system) only when ?debug=true (or ?debug=1)
  const searchParams = useSearchParams();
  const showSystemCopy = useMemo(() => {
    const v = (searchParams?.get("debug") ?? "").toLowerCase();
    return v === "true" || v === "1";
  }, [searchParams]);

  // Voice transcript handler
  const handleVoiceTranscript = useCallback((text: string) => {
    setInput((prev) => (prev ? `${prev} ${text}` : text));
  }, []);

  useEffect(() => {
    if (!caseId) {
      setMessages([]);
      return;
    }

    // IMPORTANT: Capture the narrowed caseId in a local const so TS keeps it as `string`
    // inside the async function below (avoids `string | null` issues).
    const id = caseId;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await apiGetCase(id);
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

  const canSend = useMemo(
    () => input.trim().length > 0 && !loading && !disabled,
    [input, loading, disabled]
  );

  const isTyping = streaming && messages.length > 0;

  async function send() {
    const text = input.trim();
    if (!text) return;

    setInput("");
    setError(null);
    setLoading(true);
    setStreaming(true);

    const localId = `local_${Date.now()}`;
    const now = new Date().toISOString();

    // Capture and clear attachment before sending
    const currentAttachment = photoAttachment;
    setPhotoAttachment(null);

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
      // Build request body with optional attachment
      const requestBody: {
        caseId?: string;
        message: string;
        languageMode: LanguageMode;
        attachments?: Array<{ type: "image"; dataUrl: string }>;
      } = {
        caseId: caseId ?? undefined,
        message: text,
        languageMode,
      };

      if (currentAttachment) {
        requestBody.attachments = [
          { type: "image", dataUrl: currentAttachment.dataUrl },
        ];
      }

      const body = await apiChatStreamWithAttachments(requestBody);

      // Track chat sent
      void analytics.chatSent(caseId ?? undefined);

      let serverCaseId: string | null = null;

      const onEvent = (ev: ChatSseEvent) => {
        if (ev.type === "case") {
          // Be defensive: allow null if backend ever emits it.
          const newId = ev.caseId ?? null;
          serverCaseId = newId;
          onCaseId(newId);
          return;
        }

        if (ev.type === "token") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === `${localId}_assistant`
                ? { ...m, content: m.content + ev.token }
                : m
            )
          );
          return;
        }

        if (ev.type === "error") {
          setError(ev.message);
          void analytics.chatError();
          return;
        }

        if (ev.type === "done") {
          setLoading(false);
          setStreaming(false);

          const effectiveCaseId = serverCaseId ?? caseId;
          if (effectiveCaseId) {
            void apiGetCase(effectiveCaseId)
              .then((res) => setMessages(res.messages))
              .catch(() => {});
          }
        }
      };

      await readSseStream(body, onEvent);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to send";
      setError(msg);
      setLoading(false);
      setStreaming(false);
      void analytics.chatError();
    }
  }

  // Extended chat stream function that supports attachments
  async function apiChatStreamWithAttachments(args: {
    caseId?: string;
    message: string;
    languageMode: LanguageMode;
    attachments?: Array<{ type: "image"; dataUrl: string }>;
  }) {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });

    if (!res.ok || !res.body) {
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const parsed = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(parsed?.error || `Chat request failed (${res.status})`);
      }

      const txt = await res.text().catch(() => "");
      throw new Error(txt || `Chat request failed (${res.status})`);
    }

    return res.body;
  }

  return (
    <section data-testid="chat-panel" className="flex h-full flex-1 flex-col">
      <div className="flex-1 overflow-y-auto p-6">
        {!caseId && messages.length === 0 ? (
          <div
            data-testid="chat-empty-state"
            className="mx-auto max-w-2xl pt-12 text-zinc-600 dark:text-zinc-300"
          >
            <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
              RV Service Desk
            </h1>
            <p className="mt-2 text-sm">
              Start a new case from the left or send a message. The assistant
              will produce an English report plus a translated copy.
            </p>
          </div>
        ) : null}

        {error ? (
          <div
            data-testid="chat-error"
            className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
          >
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
              <div className="mb-1 flex items-center justify-between gap-3">
                <div className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {m.role === "user" ? "Technician" : "Assistant"}
                </div>

                {m.role === "assistant" ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      data-testid={`copy-assistant-plain-${m.id}`}
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(m.content)
                          .catch(() => setError("Copy failed"));
                      }}
                      className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
                    >
                      Copy
                    </button>

                    {showSystemCopy ? (
                      <button
                        type="button"
                        data-testid={`copy-assistant-system-${m.id}`}
                        onClick={() => {
                          const formatted = `=== RV SERVICE DESK REPORT ===\n\n${m.content}\n`;
                          void navigator.clipboard
                            .writeText(formatted)
                            .catch(() => setError("Copy failed"));
                        }}
                        className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
                      >
                        Copy (system)
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="whitespace-pre-wrap">{m.content}</div>
            </div>
          ))}

          {loading && messages.length === 0 ? (
            <div data-testid="chat-loading" className="text-sm text-zinc-500">
              Loading...
            </div>
          ) : null}

          {isTyping ? (
            <div
              data-testid="assistant-typing-indicator"
              className="text-xs text-zinc-500 dark:text-zinc-400"
            >
              Assistant is typing…
            </div>
          ) : null}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-zinc-200 bg-white/70 p-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/50">
        <div className="mx-auto max-w-2xl">
          {/* Photo preview row */}
          {photoAttachment && (
            <div className="mb-3">
              <PhotoAttachButton
                attachment={photoAttachment}
                onAttach={setPhotoAttachment}
                onRemove={() => setPhotoAttachment(null)}
                disabled={loading || disabled}
                caseId={caseId}
              />
            </div>
          )}
          
          <div className="flex items-end gap-3">
            {/* Photo attach button (hidden when attachment exists) */}
            {!photoAttachment && (
              <PhotoAttachButton
                attachment={null}
                onAttach={setPhotoAttachment}
                onRemove={() => setPhotoAttachment(null)}
                disabled={loading || disabled}
                caseId={caseId}
              />
            )}
            
            {/* Voice button */}
            <VoiceButton
              onTranscript={handleVoiceTranscript}
              disabled={loading || disabled}
            />
            
            <textarea
              data-testid="chat-composer-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={disabled ? "Accept Terms to begin" : "Message"}
              rows={2}
              disabled={Boolean(disabled)}
              className="max-h-40 flex-1 resize-none rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none disabled:cursor-not-allowed disabled:opacity-50 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-700"
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
          <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            Enter to send. Shift+Enter for newline.
          </div>
        </div>
      </div>
    </section>
  );
}
