import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
}));

const storageMocks = vi.hoisted(() => ({
  getCase: vi.fn(() => ({ case: null, messages: [] })),
  ensureCase: vi.fn(),
  updateCase: vi.fn(),
  listMessagesForContext: vi.fn(() => []),
  appendMessage: vi.fn(),
}));

vi.mock("@/lib/auth", () => authMocks);

vi.mock("@/lib/storage", () => ({
  storage: storageMocks,
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(() =>
    Promise.resolve({
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
    }),
  ),
}));

const fetchMock = vi.fn();
global.fetch = fetchMock as typeof fetch;

describe("Chat Route Wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.OPENAI_API_KEY = "sk-test-mock";

    authMocks.getCurrentUser.mockResolvedValue({
      id: "user_1",
      email: "tech@example.com",
      plan: "FREE",
      status: "ACTIVE",
    });

    storageMocks.ensureCase.mockResolvedValue({
      id: "case_1",
      title: "Test Case",
      userId: "user_1",
      inputLanguage: "EN",
      languageSource: "AUTO",
      mode: "diagnostic",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    storageMocks.appendMessage.mockResolvedValue({
      id: "msg_1",
      caseId: "case_1",
      role: "assistant",
      content: "ok",
      language: "EN",
      createdAt: new Date().toISOString(),
    });
  });

  it("emits SSE success lifecycle once without duplicate done events", async () => {
    const mockStreamData = [
      'data: {"choices":[{"delta":{"content":"What voltage do you measure at the pump input?"}}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    fetchMock.mockResolvedValueOnce({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(mockStreamData));
          controller.close();
        },
      }),
    });

    const { POST } = await import("@/app/api/chat/route");

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello" }),
      }),
    );

    const streamText = await response.text();

    expect(response.status).toBe(200);
    expect(streamText).toContain('"type":"case"');
    expect(streamText).toContain('"type":"language"');
    expect(streamText).toContain('"type":"mode"');
    expect(streamText).toContain('"type":"token"');
    expect(streamText.match(/"type":"done"/g)).toHaveLength(1);
    expect(streamText).not.toContain('"type":"error"');
  });

  it("emits error and done once on upstream failure", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: vi.fn(async () => "bad gateway"),
    });

    const { POST } = await import("@/app/api/chat/route");

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello" }),
      }),
    );

    const streamText = await response.text();

    expect(response.status).toBe(200);
    expect(streamText).toContain('"type":"error"');
    expect(streamText).toContain('"code":"UPSTREAM_ERROR"');
    expect(streamText.match(/"type":"done"/g)).toHaveLength(1);
    expect(streamText).not.toContain('"type":"validation_fallback"');
  });
});