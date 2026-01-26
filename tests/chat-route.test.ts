import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
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
    ensureCase: vi.fn(),
    listMessagesForContext: vi.fn(() => []),
    appendMessage: vi.fn(),
  },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => Promise.resolve({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

// Mock fetch for OpenAI
const mockFetch = vi.fn();
global.fetch = mockFetch;

import { getCurrentUser } from "@/lib/auth";
import { storage } from "@/lib/storage";

describe("Chat API Route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "sk-test-mock";
  });

  describe("POST /api/chat", () => {
    it("should return 500 when OPENAI_API_KEY is missing", async () => {
      delete process.env.OPENAI_API_KEY;

      const { POST } = await import("@/app/api/chat/route");

      const req = new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Hello" }),
        signal: new AbortController().signal,
      });

      const response = await POST(req);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Missing OPENAI_API_KEY");
    });

    it("should return 400 when message is missing", async () => {
      process.env.OPENAI_API_KEY = "sk-test-mock";

      const { POST } = await import("@/app/api/chat/route");

      const req = new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        signal: new AbortController().signal,
      });

      const response = await POST(req);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Missing message");
    });

    it("should process chat with mocked OpenAI response", async () => {
      process.env.OPENAI_API_KEY = "sk-test-mock";

      const mockUser = { id: "user_123", email: "test@example.com", plan: "FREE", status: "ACTIVE" };
      const mockCase = {
        id: "case_123",
        title: "Test Case",
        userId: "user_123",
        inputLanguage: "EN",
        languageSource: "AUTO",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      vi.mocked(getCurrentUser).mockResolvedValue(mockUser);
      vi.mocked(storage.ensureCase).mockResolvedValue(mockCase as never);
      vi.mocked(storage.listMessagesForContext).mockResolvedValue([]);
      vi.mocked(storage.appendMessage).mockResolvedValue({
        id: "msg_123",
        caseId: "case_123",
        role: "user",
        content: "Hello",
        language: "EN",
        createdAt: new Date().toISOString(),
      } as never);

      // Mock successful OpenAI streaming response
      const mockStreamData = `data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: {"choices":[{"delta":{"content":" there"}}]}\n\ndata: [DONE]\n\n`;
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(mockStreamData));
            controller.close();
          },
        }),
      });

      const { POST } = await import("@/app/api/chat/route");

      const req = new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Hello", caseId: "case_123" }),
        signal: new AbortController().signal,
      });

      const response = await POST(req);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
      
      // Verify storage was called correctly
      expect(storage.ensureCase).toHaveBeenCalledWith(
        expect.objectContaining({
          caseId: "case_123",
          userId: "user_123",
        })
      );
    });

    it("should handle session-only image attachments", async () => {
      process.env.OPENAI_API_KEY = "sk-test-mock";

      const mockUser = { id: "user_123", email: "test@example.com", plan: "FREE", status: "ACTIVE" };
      const mockCase = {
        id: "case_123",
        title: "Test Case",
        userId: "user_123",
        inputLanguage: "EN",
        languageSource: "AUTO",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      vi.mocked(getCurrentUser).mockResolvedValue(mockUser);
      vi.mocked(storage.ensureCase).mockResolvedValue(mockCase as never);
      vi.mocked(storage.listMessagesForContext).mockResolvedValue([]);
      vi.mocked(storage.appendMessage).mockResolvedValue({
        id: "msg_123",
        caseId: "case_123",
        role: "user",
        content: "What's in this image?",
        language: "EN",
        createdAt: new Date().toISOString(),
      } as never);

      // Mock OpenAI response
      const mockStreamData = `data: {"choices":[{"delta":{"content":"I see..."}}]}\n\ndata: [DONE]\n\n`;
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(mockStreamData));
            controller.close();
          },
        }),
      });

      const { POST } = await import("@/app/api/chat/route");

      const req = new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "What's in this image?",
          attachments: [
            { type: "image", dataUrl: "data:image/jpeg;base64,/9j/4AAQ..." },
          ],
        }),
        signal: new AbortController().signal,
      });

      const response = await POST(req);

      expect(response.status).toBe(200);

      // Verify the image was NOT stored in the message
      expect(storage.appendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "What's in this image?", // Just text, no image
        })
      );
    });
  });
});
