/**
 * LLM Runtime Signals — server-side emission safety tests.
 *
 * Critical user-visible safety contract:
 *   - When the feature flag is ON in production, the server runs an internal
 *     sidecar LLM call. Its output is JSON (sentinel-wrapped proposal) and
 *     MUST NEVER be streamed to the user-facing SSE stream.
 *   - Two fetch calls occur: (1) the producer call whose content is
 *     internal-only, and (2) the primary user-facing completion whose
 *     content IS streamed. These tests exercise this with distinct mocked
 *     responses and assert:
 *       - The SSE body does NOT contain the sidecar sentinel or the
 *         sidecar JSON keys produced by the first mocked call.
 *       - The SSE body contains the primary response content as normal.
 *   - Fail-closed on producer: a producer upstream error must not prevent
 *     the primary user-facing path from completing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/lib/storage", () => ({
  storage: {
    inferLanguageForMessage: vi.fn(() => ({
      language: "EN",
      languageSource: "AUTO",
      confidence: 0.9,
    })),
    getCase: vi.fn(() => ({ case: null, messages: [] })),
    ensureCase: vi.fn(),
    listMessagesForContext: vi.fn(() => []),
    appendMessage: vi.fn(),
    updateCase: vi.fn(),
  },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => Promise.resolve({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { getCurrentUser } from "@/lib/auth";
import { storage } from "@/lib/storage";
import { LLM_RUNTIME_SIGNALS_FLAG_ENV } from "@/lib/chat/llm-runtime-signals";
import { __producerInternals } from "@/lib/chat/llm-runtime-signal-producer";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function setNodeEnv(value: string | undefined) {
  if (value === undefined) {
    delete (process.env as Record<string, string | undefined>).NODE_ENV;
  } else {
    (process.env as Record<string, string | undefined>).NODE_ENV = value;
  }
}

/**
 * Return the number of fetch calls whose request body contains the
 * producer's sidecar sentinel — i.e. was a sidecar-producer call. This is
 * more robust than relying on total fetch counts because the primary
 * completion path may retry on validation failures.
 */
function countSidecarProducerCalls(): number {
  return mockFetch.mock.calls.filter((call: unknown[]) => {
    const init = call[1] as RequestInit | undefined;
    const rawBody = typeof init?.body === "string" ? init.body : "";
    return rawBody.includes(__producerInternals.SENTINEL_OPEN);
  }).length;
}

async function drainStream(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let output = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }
  return output;
}

function mockSuccessStream(content: string) {
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

function mockUpstreamError(status = 500) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    text: () => Promise.resolve("boom"),
  });
}

const mockUser = {
  id: "user_s",
  email: "s@example.com",
  plan: "FREE" as const,
  status: "ACTIVE" as const,
};
const mockCase = {
  id: "case_sidecar_emit",
  title: "Sidecar Emit Case",
  userId: "user_s",
  inputLanguage: "EN",
  languageSource: "AUTO",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("LLM Runtime Signals — server-side emission safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "sk-test-mock";
    delete process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV];

    vi.mocked(getCurrentUser).mockResolvedValue(mockUser);
    vi.mocked(storage.ensureCase).mockResolvedValue(mockCase as never);
    vi.mocked(storage.listMessagesForContext).mockResolvedValue([]);
    vi.mocked(storage.appendMessage).mockResolvedValue({
      id: "m",
      caseId: "case_sidecar_emit",
      role: "user",
      content: "x",
      language: "EN",
      createdAt: new Date().toISOString(),
    } as never);
    vi.mocked(storage.updateCase).mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    setNodeEnv(ORIGINAL_NODE_ENV);
    delete process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV];
  });

  it("sidecar JSON produced server-side is NEVER streamed to the user SSE body (production)", async () => {
    setNodeEnv("production");
    process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV] = "1";

    // First mocked call: the sidecar producer. Its content is a sentinel-
    // wrapped JSON object that would be obviously visible if ever leaked.
    const sidecarContent = [
      __producerInternals.SENTINEL_OPEN,
      JSON.stringify({
        surface_request_proposal: {
          requested_surface: "shop_final_report",
          confidence: 0.95,
        },
        __sidecar_marker_for_test__: "INTERNAL_ONLY_DO_NOT_LEAK",
      }),
      __producerInternals.SENTINEL_CLOSE,
    ].join("");
    mockSuccessStream(sidecarContent);

    // Second mocked call: the primary user-facing completion.
    const primaryContent = "What is the observed voltage at the pump?";
    mockSuccessStream(primaryContent);

    const { POST } = await import("@/app/api/chat/route");
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "pump does not work, 12V present at pump",
        caseId: "case_sidecar_emit",
      }),
      signal: new AbortController().signal,
    });
    const response = await POST(req);
    expect(response.status).toBe(200);

    const body = await drainStream(response);

    // Primary content IS streamed.
    expect(body).toContain("What is the observed voltage at the pump?");

    // Sidecar content is NEVER present.
    expect(body).not.toContain(__producerInternals.SENTINEL_OPEN);
    expect(body).not.toContain(__producerInternals.SENTINEL_CLOSE);
    expect(body).not.toContain("INTERNAL_ONLY_DO_NOT_LEAK");
    expect(body).not.toContain("__sidecar_marker_for_test__");
    expect(body).not.toMatch(/surface_request_proposal/);

    // Exactly one producer call occurred (identified by sentinel in the
    // request body). The primary completion may retry on validation, so we
    // do not assert total fetch count.
    expect(countSidecarProducerCalls()).toBe(1);
  });

  it("producer upstream error does not destabilize the user-facing stream", async () => {
    setNodeEnv("production");
    process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV] = "1";

    // First mocked call: producer fails upstream.
    mockUpstreamError(500);
    // Second mocked call: primary LLM call still succeeds.
    mockSuccessStream("diagnostic question?");

    const { POST } = await import("@/app/api/chat/route");
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "hello",
        caseId: "case_sidecar_emit",
      }),
      signal: new AbortController().signal,
    });
    const response = await POST(req);
    expect(response.status).toBe(200);
    const body = await drainStream(response);

    expect(body).toContain("diagnostic question?");
    expect(body).toContain('"type":"done"');
    // Producer was invoked once; the primary path still completed.
    expect(countSidecarProducerCalls()).toBe(1);
  });

  it("flag OFF: producer is NOT called — only the primary fetch occurs", async () => {
    delete process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV];

    mockSuccessStream("primary only?");
    const { POST } = await import("@/app/api/chat/route");
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "hello",
        caseId: "case_sidecar_emit",
      }),
      signal: new AbortController().signal,
    });
    const response = await POST(req);
    expect(response.status).toBe(200);
    await drainStream(response);

    // No sidecar producer call — flag is OFF.
    expect(countSidecarProducerCalls()).toBe(0);
  });

  it("client-supplied __sidecarProposal in test mode: producer is NOT called (client test input takes precedence)", async () => {
    // NODE_ENV is already "test" under vitest.
    process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV] = "1";

    mockSuccessStream("primary response?");
    const { POST } = await import("@/app/api/chat/route");
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "hello",
        caseId: "case_sidecar_emit",
        __sidecarProposal: JSON.stringify({
          object_hypothesis: { system: "water_pump", confidence: 0.9, evidence: ["pump"] },
        }),
      }),
      signal: new AbortController().signal,
    });
    const response = await POST(req);
    expect(response.status).toBe(200);
    await drainStream(response);

    // Producer was skipped because the test/dev client input channel
    // supplied a proposal directly.
    expect(countSidecarProducerCalls()).toBe(0);
  });

  it("production mode: sidecar producer returning non-JSON garbage fails-closed and does not affect mode", async () => {
    setNodeEnv("production");
    process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV] = "1";

    mockSuccessStream("totally not JSON, just chatty prose");
    mockSuccessStream("regular diagnostic question?");

    const { POST } = await import("@/app/api/chat/route");
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "hi",
        caseId: "case_sidecar_emit",
      }),
      signal: new AbortController().signal,
    });
    const response = await POST(req);
    expect(response.status).toBe(200);
    const body = await drainStream(response);

    // Mode remains diagnostic — the non-JSON producer output could not
    // adjudicate to a mode transition. SSE body does not contain the
    // garbage producer content.
    expect(body).toContain('"mode":"diagnostic"');
    expect(body).not.toMatch(/"mode":"final_report"/);
    expect(body).not.toContain("totally not JSON");
    expect(body).toContain("regular diagnostic question?");
  });
});
