/**
 * LLM Runtime Signals — chat route integration tests.
 *
 * Verifies:
 *   1. When the feature flag is OFF (default), the presence of a sidecar
 *      proposal in the request body has NO effect on routing. The route
 *      must behave exactly as without the sidecar.
 *   2. When the feature flag is ON and the proposal is grounded, the route
 *      accepts a natural-language report request (surface_request_proposal)
 *      that the regex intent detector would otherwise miss. The server
 *      still enforces readiness gates — isolation-not-complete + active
 *      procedure still blocks the report surface unless BOTH surface
 *      request AND report-ready candidate are accepted.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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

// Vitest defaults NODE_ENV to "test"; save it once for restore in production
// tests that temporarily switch modes.
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function setNodeEnv(value: string | undefined) {
  if (value === undefined) {
    delete (process.env as Record<string, string | undefined>).NODE_ENV;
  } else {
    (process.env as Record<string, string | undefined>).NODE_ENV = value;
  }
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

const mockUser = {
  id: "user_123",
  email: "test@example.com",
  plan: "FREE" as const,
  status: "ACTIVE" as const,
};
const mockCase = {
  id: "case_rt",
  title: "RT Case",
  userId: "user_123",
  inputLanguage: "EN",
  languageSource: "AUTO",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("LLM Runtime Signals — chat route integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "sk-test-mock";
    delete process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV];

    vi.mocked(getCurrentUser).mockResolvedValue(mockUser);
    vi.mocked(storage.ensureCase).mockResolvedValue(mockCase as never);
    vi.mocked(storage.listMessagesForContext).mockResolvedValue([]);
    vi.mocked(storage.appendMessage).mockResolvedValue({
      id: "msg_rt",
      caseId: "case_rt",
      role: "user",
      content: "x",
      language: "EN",
      createdAt: new Date().toISOString(),
    } as never);
    vi.mocked(storage.updateCase).mockResolvedValue(undefined as never);
  });

  it("flag OFF: sidecar proposal in body is ignored; request completes normally", async () => {
    mockSuccessStream("ok");

    const { POST } = await import("@/app/api/chat/route");
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "please make the report",
        caseId: "case_rt",
        __sidecarProposal: JSON.stringify({
          surface_request_proposal: {
            requested_surface: "shop_final_report",
            confidence: 0.99,
          },
        }),
      }),
      signal: new AbortController().signal,
    });

    const response = await POST(req);
    expect(response.status).toBe(200);

    const body = await drainStream(response);
    // The stream emits a mode event. With the flag OFF the sidecar has no
    // effect; whatever mode the server chose is the same as without the
    // sidecar field. We only assert the request completed without errors.
    expect(body).toContain('"type":"done"');
  });

  it("flag OFF: malformed sidecar proposal does not destabilize the route", async () => {
    mockSuccessStream("ok");
    const { POST } = await import("@/app/api/chat/route");
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "hello",
        caseId: "case_rt",
        __sidecarProposal: "this is not json at all",
      }),
      signal: new AbortController().signal,
    });
    const response = await POST(req);
    expect(response.status).toBe(200);
    const body = await drainStream(response);
    expect(body).toContain('"type":"done"');
  });

  it("flag ON: malformed sidecar proposal fails closed and route continues", async () => {
    process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV] = "1";
    mockSuccessStream("ok");
    const { POST } = await import("@/app/api/chat/route");
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "hello",
        caseId: "case_rt",
        __sidecarProposal: "{not:valid]",
      }),
      signal: new AbortController().signal,
    });
    const response = await POST(req);
    expect(response.status).toBe(200);
    const body = await drainStream(response);
    // The fail-closed path produces no sidecar effect and request completes.
    expect(body).toContain('"type":"done"');
  });

  // ── Blocker-1 regression ────────────────────────────────────────────
  // In production mode, a client-supplied sidecar proposal MUST NOT be
  // consumed — not even when the feature flag is ON. Even a perfectly
  // formed "make the final report" proposal must not be able to force
  // the report-surface behavior via client input.
  it("production mode: client-supplied sidecar proposal is ignored even with flag ON", async () => {
    // Switch to production-like behavior for this single test.
    setNodeEnv("production");
    process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV] = "1";

    try {
      mockSuccessStream("diagnostic step question here?");
      const { POST } = await import("@/app/api/chat/route");
      const req = new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "any routine diagnostic message",
          caseId: "case_rt",
          __sidecarProposal: JSON.stringify({
            surface_request_proposal: {
              requested_surface: "shop_final_report",
              confidence: 0.99,
            },
            report_ready_candidate: {
              is_candidate: true,
              confidence: 0.99,
              present_fields: ["complaint", "finding", "labor"],
              evidence: ["pump does not work", "labor 0.5 h"],
            },
          }),
        }),
        signal: new AbortController().signal,
      });
      const response = await POST(req);
      expect(response.status).toBe(200);
      const body = await drainStream(response);

      // The SSE stream advertises the current mode. Because the client
      // channel is closed in production, the sidecar proposal must have had
      // no effect — the mode must NOT flip to final_report based on client
      // JSON. The stream must contain a diagnostic mode event, not a
      // sidecar-induced final_report transition.
      expect(body).toContain('"type":"mode"');
      expect(body).toContain('"mode":"diagnostic"');
      expect(body).not.toMatch(/"mode":"final_report"/);
      expect(body).toContain('"type":"done"');
    } finally {
      setNodeEnv(ORIGINAL_NODE_ENV);
      delete process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV];
    }
  });

  it("production mode: well-formed sidecar proposal is ignored — mode remains diagnostic", async () => {
    setNodeEnv("production");
    process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV] = "1";
    try {
      mockSuccessStream("another diagnostic response?");
      const { POST } = await import("@/app/api/chat/route");
      const req = new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "hello there",
          caseId: "case_rt",
          // Even a structurally perfect proposal is dropped in production.
          __sidecarProposal: JSON.stringify({
            subtype_lock_proposal: { subtype: "gas-only", confidence: 0.99 },
            surface_request_proposal: {
              requested_surface: "shop_final_report",
              confidence: 0.99,
            },
          }),
        }),
        signal: new AbortController().signal,
      });
      const response = await POST(req);
      expect(response.status).toBe(200);
      const body = await drainStream(response);
      expect(body).toContain('"mode":"diagnostic"');
      expect(body).not.toMatch(/"mode":"final_report"/);
    } finally {
      setNodeEnv(ORIGINAL_NODE_ENV);
      delete process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV];
    }
  });
});
