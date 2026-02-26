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
import { 
  PhotoAttachButton, 
  PhotoPreviewGrid,
  type PhotoAttachment,
  MAX_IMAGES,
  MAX_TOTAL_BYTES,
  calculateTotalBytes,
} from "@/components/photo-attach";
import { analytics } from "@/lib/client-analytics";

type Props = {
  caseId: string | null;
  languageMode: LanguageMode;
  onCaseId: (caseId: string | null) => void;
  disabled?: boolean;
};

type BadgeState = {
  system: string;
  complexity: string;
  mode: string;
  isolationComplete: boolean;
  finding: string;
  activeStepId: string;
};

export function ChatPanel({ caseId, languageMode, onCaseId, disabled }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoAttachments, setPhotoAttachments] = useState<PhotoAttachment[]>([]);
  const [reportCopied, setReportCopied] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [badges, setBadges] = useState<BadgeState | null>(null);
  const [llmStatus, setLlmStatus] = useState<{ status: "up" | "down"; message?: string; fallback?: string } | null>(null);

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

  // Get the latest assistant report (if exists)
  // Report is identified by having structured content (multiple sections)
  const latestReport = useMemo(() => {
    const assistantMessages = messages.filter(m => m.role === "assistant" && m.content.length > 100);
    if (assistantMessages.length === 0) return null;
    
    // Return the last substantial assistant message as the report
    const lastMessage = assistantMessages[assistantMessages.length - 1];
    
    // Check if it looks like a report (has structured content)
    // Reports typically have section headers or multiple paragraphs
    const hasHeaders = [
      "Complaint:",
      "Diagnostic Procedure:",
      "Verified Condition:",
      "Recommended Corrective Action:",
      "Required Parts:",
      "Estimated Labor:",
    ].every((header) => lastMessage.content.includes(header));

    const hasStructure = lastMessage.content.includes("\n\n") || 
                         lastMessage.content.includes("---") ||
                         lastMessage.content.includes("**") ||
                         lastMessage.content.includes("##") ||
                         hasHeaders;
    
    return hasStructure ? lastMessage.content : null;
  }, [messages]);

  // Handle copy report
  const handleCopyReport = useCallback(async () => {
    if (!latestReport) return;
    
    try {
      await navigator.clipboard.writeText(latestReport);
      setReportCopied(true);
      setTimeout(() => setReportCopied(false), 2000);
    } catch {
      setError("Failed to copy report");
    }
  }, [latestReport]);

  useEffect(() => {
    if (!caseId) {
      setMessages([]);
      setBadges(null);
      setLlmStatus(null);
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

  const canRetryAi = useMemo(() => !loading && !disabled, [loading, disabled]);

  const isTyping = streaming && messages.length > 0;

  const handleRetryAi = () => {
    if (!canRetryAi) return;
    void send("retry ai");
  };

  async function send(overrideText?: string) {
    const isOverride = typeof overrideText === "string";
    const text = (isOverride ? overrideText : input).trim();
    if (!text) return;

    if (!isOverride) {
      // Validate attachments before sending
      if (photoAttachments.length > MAX_IMAGES) {
        setError(`Maximum ${MAX_IMAGES} photos allowed per message.`);
        return;
      }
      
      const totalBytes = calculateTotalBytes(photoAttachments);
      if (totalBytes > MAX_TOTAL_BYTES) {
        setError(`Total attachment size exceeds 5MB limit. Please remove some photos.`);
        return;
      }
    }

    if (!isOverride) {
      setInput("");
    }
    setError(null);
    setLoading(true);
    setStreaming(true);

    const localId = `local_${Date.now()}`;
    const now = new Date().toISOString();

    // Capture and clear attachments before sending
    const currentAttachments = isOverride ? [] : [...photoAttachments];
    if (!isOverride) {
      setPhotoAttachments([]);
    }

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
      // Build request body with optional attachments
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

      if (currentAttachments.length > 0) {
        requestBody.attachments = currentAttachments.map((a) => ({
          type: "image" as const,
          dataUrl: a.dataUrl,
        }));
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

        if (ev.type === "status") {
          setLlmStatus({
            status: ev.llm.status,
            message: ev.message,
            fallback: ev.fallback,
          });
          return;
        }

        if (ev.type === "badges") {
          setBadges({
            system: ev.system,
            complexity: ev.complexity,
            mode: ev.mode,
            isolationComplete: ev.isolationComplete,
            finding: ev.finding,
            activeStepId: ev.activeStepId,
          });
          return;
        }

        if (ev.type === "mode") {
          setBadges((prev) => (prev ? { ...prev, mode: ev.mode } : prev));
          return;
        }

        if (ev.type === "mode_transition") {
          setBadges((prev) => (prev ? { ...prev, mode: ev.to } : prev));
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
      <div className="flex-1 flex flex-col md:flex-row">
        <aside
          data-testid="badges-panel"
          className="border-b border-zinc-200 bg-white/70 px-4 py-4 text-sm text-zinc-700 backdrop-blur md:w-60 md:shrink-0 md:border-b-0 md:border-r dark:border-zinc-800 dark:bg-zinc-950/50 dark:text-zinc-200"
        >
          <div
            data-testid="badges-title"
            className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
          >
            Live Status
          </div>
          <div className="mt-3 space-y-3">
            <div data-testid="badge-system-card" className="rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/40">
              <div className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">System</div>
              <div data-testid="badge-system" className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {badges?.system || "—"}
              </div>
            </div>
            <div data-testid="badge-complexity-card" className="rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/40">
              <div className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Complexity</div>
              <div data-testid="badge-complexity" className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {badges?.complexity || "—"}
              </div>
            </div>
            <div data-testid="badge-mode-card" className="rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/40">
              <div className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Mode</div>
              <div data-testid="badge-mode" className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {badges?.mode || "—"}
              </div>
            </div>
            <div data-testid="badge-isolation-card" className="rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/40">
              <div className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Isolation</div>
              <div data-testid="badge-isolation" className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {badges ? (badges.isolationComplete ? "Complete" : "In progress") : "—"}
              </div>
            </div>
            <div data-testid="badge-finding-card" className="rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/40">
              <div className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Finding</div>
              <div data-testid="badge-finding" className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {badges?.finding || "—"}
              </div>
            </div>
            <div data-testid="badge-active-step-card" className="rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/40">
              <div className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Active Step</div>
              <div data-testid="badge-active-step" className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {badges?.activeStepId || "—"}
              </div>
            </div>
          </div>
        </aside>
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

        {llmStatus?.status === "down" ? (
          <div
            data-testid="llm-status-banner"
            className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <div className="font-semibold">AI status</div>
            <div className="mt-1">{llmStatus.message ?? "AI is temporarily unavailable."}</div>
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
                          .then(() => {
                            setCopiedMessageId(m.id);
                            setTimeout(() => setCopiedMessageId((prev) => prev === m.id ? null : prev), 1500);
                          })
                          .catch(() => setError("Copy failed"));
                      }}
                      className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-all duration-200 ${
                        copiedMessageId === m.id
                          ? "border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/40 dark:text-green-400"
                          : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
                      }`}
                    >
                      {copiedMessageId === m.id ? (
                        <>
                          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Copied!
                        </>
                      ) : (
                        "Copy"
                      )}
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
    </div>

      <div className="border-t border-zinc-200 bg-white/70 p-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/50">
        <div className="mx-auto max-w-2xl">
          {/* Photo preview grid */}
          {photoAttachments.length > 0 && (
            <div className="mb-3">
              <PhotoPreviewGrid
                attachments={photoAttachments}
                onRemove={(id) => setPhotoAttachments((prev) => prev.filter((a) => a.id !== id))}
                disabled={loading || disabled}
              />
            </div>
          )}
          
          <div className="flex items-end gap-3">
            {/* Photo attach button */}
            <div className="relative">
              <PhotoAttachButton
                attachments={photoAttachments}
                onAttach={(attachment) => setPhotoAttachments((prev) => [...prev, attachment])}
                onRemove={(id) => setPhotoAttachments((prev) => prev.filter((a) => a.id !== id))}
                disabled={loading || disabled}
                caseId={caseId}
              />
            </div>
            
            {/* Voice button with language support */}
            <VoiceButton
              onTranscript={handleVoiceTranscript}
              disabled={loading || disabled}
              language={languageMode === "AUTO" ? "EN" : languageMode}
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
          <div className="mt-2 flex items-center justify-between">
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              Enter to send. Shift+Enter for newline.
            </div>
            
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleRetryAi}
                disabled={!canRetryAi}
                data-testid="retry-ai-button"
                className={
                  `flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ` +
                  `${canRetryAi
                    ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-900/40"
                    : "cursor-not-allowed border-zinc-100 bg-zinc-50 text-zinc-400 dark:border-zinc-900 dark:bg-zinc-950 dark:text-zinc-600"}`
                }
              >
                Retry AI
              </button>

              {/* Copy Report Button */}
              <button
                type="button"
                onClick={handleCopyReport}
                disabled={!latestReport || loading}
                data-testid="copy-report-button"
                title={latestReport ? "Copy the generated report" : "Generate a report first"}
                className={`
                  flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium
                  transition-colors
                  ${latestReport 
                    ? "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
                    : "cursor-not-allowed border-zinc-100 bg-zinc-50 text-zinc-400 dark:border-zinc-900 dark:bg-zinc-950 dark:text-zinc-600"
                  }
                `}
              >
                {reportCopied ? (
                  <>
                    <svg className="h-3.5 w-3.5 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Copied!
                  </>
                ) : (
                  <>
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Copy Report
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
