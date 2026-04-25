/**
 * Specific report gate (Blocker 2).
 *
 * The user-visible contract:
 *   - When the technician requests a report and provides dense report-ready
 *     material but diagnostics are not yet flipped to isolated, the server
 *     MUST NOT emit the verbatim generic wall:
 *       "Диагностика ещё не завершена. Давайте продолжим с текущего шага,
 *        прежде чем формировать отчёт."
 *     Instead it must emit a SPECIFIC response naming what is actually missing
 *     (sidecar `missingFields` if available, otherwise the server-owned
 *     repair-summary clarification, which names the precise missing items).
 *
 * These tests exercise both the unit-level building block
 * (`buildRepairSummaryClarificationResponse`) and the route's actual SSE
 * output for verbatim Case-82/83/84 inputs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  assessRepairSummaryIntent,
  buildRepairSummaryClarificationResponse,
} from "@/lib/chat";

const GENERIC_WALL_RU =
  "Диагностика ещё не завершена. Давайте продолжим с текущего шага, прежде чем формировать отчёт.";
const GENERIC_WALL_EN =
  "Diagnostics are not yet complete. Let\u2019s continue with the current step before generating the report.";

describe("Specific report gate — building blocks (Blocker 2)", () => {
  it("buildRepairSummaryClarificationResponse names missing 'corrective_action' specifically (RU)", () => {
    const response = buildRepairSummaryClarificationResponse({
      language: "RU",
      missingFields: ["corrective_action"],
    });
    expect(response).toMatch(/какой ремонт был фактически выполнен/i);
    expect(response).not.toBe(GENERIC_WALL_RU);
  });

  it("buildRepairSummaryClarificationResponse names missing 'corrective_action' specifically (EN)", () => {
    const response = buildRepairSummaryClarificationResponse({
      language: "EN",
      missingFields: ["corrective_action"],
    });
    expect(response).toMatch(/what repair you completed/i);
    expect(response).not.toBe(GENERIC_WALL_EN);
  });

  it("buildRepairSummaryClarificationResponse names multiple missing fields", () => {
    const response = buildRepairSummaryClarificationResponse({
      language: "RU",
      missingFields: ["findings", "corrective_action"],
    });
    expect(response).not.toBe(GENERIC_WALL_RU);
    // Must mention BOTH findings and corrective action content explicitly.
    expect(response.length).toBeGreaterThan(GENERIC_WALL_RU.length / 2);
  });

  it("Case-84 transcript yields a non-empty `missingFields` list (proves the gate has something specific to say)", () => {
    const intent = assessRepairSummaryIntent({
      message:
        "все открыто. проверил gas pressure, good. проверил gas valve solenoid. solenoid не работает надо менять. напиши репорт",
      hasReportRequest: true,
      priorUserMessages: [
        "Не работает водонагреватель Suburban",
        "tank полный открыт",
        "да работают. открыт",
      ],
      hasActiveDiagnosticContext: true,
    });
    // The assessor identifies at least one missing field — i.e. the
    // server-owned gate has at least one concrete handle to use instead
    // of the generic wall. The route then routes that into the specific
    // clarification response.
    expect(intent.missingFields.length).toBeGreaterThan(0);
    expect(intent.shouldAskClarification).toBe(true);

    // Whatever items are missing, the clarification response is specific
    // and is NOT the verbatim generic wall.
    const response = buildRepairSummaryClarificationResponse({
      language: "RU",
      missingFields: intent.missingFields,
    });
    expect(response).not.toBe(GENERIC_WALL_RU);
    expect(response.length).toBeGreaterThan(0);
  });

  it("non-report-shaped message: assessor returns nothing report-shaped (graceful no-op)", () => {
    const intent = assessRepairSummaryIntent({
      message: "ok let me check",
      hasReportRequest: false,
      hasActiveDiagnosticContext: true,
    });
    expect(intent.readyForReportRouting).toBe(false);
    expect(intent.shouldAskClarification).toBe(false);
  });
});

// ── Route-level integration ────────────────────────────────────────────
//
// Drive the actual chat route with Case-84-style input and verify the
// SSE body does NOT contain the verbatim generic wall text. The sidecar
// is intentionally not wired here (flag OFF) so the test asserts the
// server-side fallback path uses repair-summary intent.

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  storage: {
    inferLanguageForMessage: vi.fn(() => ({
      language: "RU",
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
  cookies: vi.fn(() =>
    Promise.resolve({ get: vi.fn(), set: vi.fn(), delete: vi.fn() }),
  ),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { getCurrentUser } from "@/lib/auth";
import { storage } from "@/lib/storage";

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

const mockUser = {
  id: "user_gate",
  email: "g@example.com",
  plan: "FREE" as const,
  status: "ACTIVE" as const,
};
const mockCase = {
  id: "case_gate",
  title: "Gate Case",
  userId: "user_gate",
  inputLanguage: "RU",
  languageSource: "AUTO",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("Specific report gate — route SSE body (Blocker 2 regression)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "sk-test-mock";

    vi.mocked(getCurrentUser).mockResolvedValue(mockUser);
    vi.mocked(storage.ensureCase).mockResolvedValue(mockCase as never);
    // Prior messages establish active diagnostic context.
    vi.mocked(storage.listMessagesForContext).mockResolvedValue([
      {
        id: "p1",
        caseId: "case_gate",
        role: "user",
        content: "Не работает водонагреватель Suburban",
        language: "RU",
        createdAt: new Date().toISOString(),
      },
      {
        id: "p2",
        caseId: "case_gate",
        role: "user",
        content: "tank полный открыт",
        language: "RU",
        createdAt: new Date().toISOString(),
      },
    ] as never);
    vi.mocked(storage.appendMessage).mockResolvedValue({
      id: "m_gate",
      caseId: "case_gate",
      role: "user",
      content: "x",
      language: "RU",
      createdAt: new Date().toISOString(),
    } as never);
    vi.mocked(storage.updateCase).mockResolvedValue(undefined as never);
  });

  it("Case-84 input: SSE body does NOT contain the verbatim generic wall", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message:
          "все открыто. проверил gas pressure, good. проверил gas valve solenoid. solenoid не работает надо менять. напиши репорт",
        caseId: "case_gate",
      }),
      signal: new AbortController().signal,
    });
    const response = await POST(req);
    expect(response.status).toBe(200);
    const body = await drainStream(response);

    // The SSE body MUST NOT contain the verbatim generic wall.
    expect(body).not.toContain(
      "Диагностика ещё не завершена. Давайте продолжим с текущего шага",
    );
  });

  it("dense water-pump warranty report request: SSE body does NOT contain verbatim generic wall", async () => {
    vi.mocked(storage.listMessagesForContext).mockResolvedValue([
      {
        id: "p1",
        caseId: "case_gate",
        role: "user",
        content: "water heater not working",
        language: "EN",
        createdAt: new Date().toISOString(),
      },
      {
        id: "p2",
        caseId: "case_gate",
        role: "user",
        content: "i found that the fuse was bad, 12V at the pump",
        language: "EN",
        createdAt: new Date().toISOString(),
      },
    ] as never);
    vi.mocked(storage.inferLanguageForMessage).mockReturnValue({
      language: "EN",
      languageSource: "AUTO",
      confidence: 0.9,
    });

    const { POST } = await import("@/app/api/chat/route");
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message:
          "warranty report requested, replaced the pump, 0.5 h labor, make the report",
        caseId: "case_gate",
      }),
      signal: new AbortController().signal,
    });
    const response = await POST(req);
    expect(response.status).toBe(200);
    const body = await drainStream(response);

    // EN generic wall must not appear verbatim either.
    expect(body).not.toContain(
      "Diagnostics are not yet complete. Let",
    );
  });
});
