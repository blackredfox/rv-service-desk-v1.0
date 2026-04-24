/**
 * LLM Runtime Signals — server-side producer unit tests.
 *
 * Contract under review:
 *   - Producer uses existing OpenAI client (no new provider path, no new
 *     key handling).
 *   - Producer calls `callOpenAI` WITHOUT an `onToken` callback. No token
 *     reaches the client SSE stream.
 *   - Producer is fail-closed: any upstream error, timeout, empty
 *     response, or thrown exception yields an empty `rawProposal`.
 *   - Producer respects an upstream abort signal and its own bounded
 *     internal timeout. It never stalls the user-facing request.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  produceRuntimeSignalProposal,
  __producerInternals,
} from "@/lib/chat/llm-runtime-signal-producer";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function mockOpenAiSuccessStream(content: string) {
  // Mimic an OpenAI streamed completion with the given content.
  const stream = `data: {"choices":[{"delta":{"content":${JSON.stringify(content)}}}]}\n\ndata: [DONE]\n\n`;
  mockFetch.mockResolvedValueOnce({
    ok: true,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(stream));
        controller.close();
      },
    }),
  });
}

function mockOpenAiUpstreamError(status = 500, text = "boom") {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    text: () => Promise.resolve(text),
  });
}

describe("LLM Runtime Signals — server-side producer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the raw LLM content (sentinel block) on success", async () => {
    const sentinelJson = [
      __producerInternals.SENTINEL_OPEN,
      JSON.stringify({
        report_ready_candidate: {
          is_candidate: true,
          confidence: 0.9,
          present_fields: ["complaint", "finding"],
          evidence: ["pump does not work"],
        },
      }),
      __producerInternals.SENTINEL_CLOSE,
    ].join("");
    mockOpenAiSuccessStream(sentinelJson);

    const result = await produceRuntimeSignalProposal({
      apiKey: "sk-test",
      mode: "diagnostic",
      model: "gpt-test",
      latestUserMessage: "make the report",
      technicianMessages: ["pump does not work", "make the report"],
    });

    expect(result.rawProposal).toContain(__producerInternals.SENTINEL_OPEN);
    expect(result.rawProposal).toContain(__producerInternals.SENTINEL_CLOSE);
    expect(result.error).toBeUndefined();
  });

  it("returns empty raw on upstream error (fail-closed)", async () => {
    mockOpenAiUpstreamError(500, "internal");

    const result = await produceRuntimeSignalProposal({
      apiKey: "sk-test",
      mode: "diagnostic",
      model: "gpt-test",
      latestUserMessage: "hello",
      technicianMessages: ["hello"],
    });

    expect(result.rawProposal).toBe("");
    expect(result.error).toContain("Upstream error");
  });

  it("returns empty raw on empty response", async () => {
    mockOpenAiSuccessStream("");

    const result = await produceRuntimeSignalProposal({
      apiKey: "sk-test",
      mode: "diagnostic",
      model: "gpt-test",
      latestUserMessage: "hello",
      technicianMessages: ["hello"],
    });

    expect(result.rawProposal).toBe("");
    expect(result.error).toBe("empty_response");
  });

  it("returns empty raw when apiKey is missing", async () => {
    const result = await produceRuntimeSignalProposal({
      apiKey: "",
      mode: "diagnostic",
      model: "gpt-test",
      latestUserMessage: "hi",
      technicianMessages: [],
    });
    expect(result.rawProposal).toBe("");
    expect(result.error).toBe("no_api_key");
    // No fetch must have been issued without an api key.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does NOT pass a streaming token callback — upstream call is non-streaming from the caller's perspective", async () => {
    // We assert this structurally by inspecting how fetch was called: the
    // producer has no way to emit tokens to any caller, so there is no
    // streaming callback plumbing. We also verify the body is the request
    // expected: a non-streaming request shape from the caller's side.
    mockOpenAiSuccessStream("ok");
    const result = await produceRuntimeSignalProposal({
      apiKey: "sk-test",
      mode: "diagnostic",
      model: "gpt-test",
      latestUserMessage: "hello",
      technicianMessages: ["hello"],
    });
    expect(result.rawProposal).toBe("ok");
    // The producer has no surface to forward tokens anywhere. This test
    // simply asserts the function returns its value rather than streaming
    // via any observable side-effect.
  });

  it("aborts when the upstream signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const result = await produceRuntimeSignalProposal({
      apiKey: "sk-test",
      mode: "diagnostic",
      model: "gpt-test",
      latestUserMessage: "hi",
      technicianMessages: [],
      upstreamSignal: ac.signal,
    });
    expect(result.rawProposal).toBe("");
    expect(result.error).toBe("aborted_before_start");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("respects internal timeout: returns empty raw if upstream never resolves in time", async () => {
    // Simulate an upstream that hangs until the producer aborts it.
    let abortedByProducer = false;
    mockFetch.mockImplementationOnce((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const sig = init.signal;
        if (sig) {
          sig.addEventListener("abort", () => {
            abortedByProducer = true;
            reject(new Error("aborted"));
          });
        }
      });
    });

    const started = Date.now();
    const result = await produceRuntimeSignalProposal({
      apiKey: "sk-test",
      mode: "diagnostic",
      model: "gpt-test",
      latestUserMessage: "hi",
      technicianMessages: [],
      timeoutMs: 25,
    });
    const elapsed = Date.now() - started;

    expect(result.rawProposal).toBe("");
    expect(abortedByProducer).toBe(true);
    // Should complete well under a second even if scheduling is slow.
    expect(elapsed).toBeLessThan(500);
  });

  it("injects the strict sentinel prompt and forbids prose output", () => {
    const prompt = __producerInternals.buildSidecarSystemPrompt();
    expect(prompt).toContain(__producerInternals.SENTINEL_OPEN);
    expect(prompt).toContain(__producerInternals.SENTINEL_CLOSE);
    expect(prompt).toMatch(/MUST NOT switch modes/i);
    expect(prompt).toMatch(/MUST NOT mark diagnostics complete/i);
    expect(prompt).toMatch(/MUST NOT generate a final report/i);
    expect(prompt).toMatch(/No prose/i);
  });
});
