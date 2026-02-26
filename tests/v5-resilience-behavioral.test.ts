import { describe, it, expect, beforeEach } from "vitest";
import {
  classifyOpenAiError,
  getModelAllowlist,
  openCircuit,
  clearCircuit,
  getCircuitStatus,
  isCircuitOpen,
  shouldTripCircuit,
  type LlmErrorType,
} from "@/lib/llm-resilience";
import {
  detectUserCommand,
  scrubTelemetry,
} from "@/app/api/chat/route";

// ─────────────────────────────────────────────────────────────
// 1. Circuit breaker: trip → open → TTL expiry → retry path
// ─────────────────────────────────────────────────────────────

describe("Circuit breaker lifecycle", () => {
  beforeEach(() => clearCircuit());

  it("starts in 'up' state", () => {
    expect(getCircuitStatus().status).toBe("up");
    expect(isCircuitOpen()).toBe(false);
  });

  it("trips to 'down' on AUTH_BLOCKED", () => {
    openCircuit("AUTH_BLOCKED");
    expect(getCircuitStatus().status).toBe("down");
    expect(getCircuitStatus().reason).toBe("AUTH_BLOCKED");
  });

  it("trips to 'down' on RATE_LIMITED", () => {
    openCircuit("RATE_LIMITED");
    expect(getCircuitStatus().status).toBe("down");
    expect(getCircuitStatus().reason).toBe("RATE_LIMITED");
  });

  it("trips to 'down' on PROVIDER_DOWN", () => {
    openCircuit("PROVIDER_DOWN");
    expect(getCircuitStatus().status).toBe("down");
    expect(getCircuitStatus().reason).toBe("PROVIDER_DOWN");
  });

  it("clears back to 'up'", () => {
    openCircuit("AUTH_BLOCKED");
    expect(getCircuitStatus().status).toBe("down");
    clearCircuit();
    expect(getCircuitStatus().status).toBe("up");
    expect(getCircuitStatus().reason).toBeUndefined();
  });

  it("auto-recovers after TTL expires", () => {
    // Trip with a very short TTL (1ms)
    openCircuit("RATE_LIMITED", 1);
    // Immediately after, it should still be down (or just barely)
    // Wait a tiny bit and check
    const now = Date.now() + 10;
    expect(isCircuitOpen(now)).toBe(false);
    expect(getCircuitStatus().status).toBe("up");
  });

  it("remains open before TTL expires", () => {
    openCircuit("RATE_LIMITED", 60_000);
    const beforeExpiry = Date.now() + 30_000;
    expect(isCircuitOpen(beforeExpiry)).toBe(true);
  });

  it("stores downUntil timestamp when tripped", () => {
    openCircuit("PROVIDER_DOWN", 90_000);
    const status = getCircuitStatus();
    expect(status.downUntil).toBeTypeOf("number");
    expect(status.downUntil! > Date.now()).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// 2. shouldTripCircuit for all error types
// ─────────────────────────────────────────────────────────────

describe("shouldTripCircuit", () => {
  it("returns true for AUTH_BLOCKED", () => {
    expect(shouldTripCircuit("AUTH_BLOCKED")).toBe(true);
  });

  it("returns true for RATE_LIMITED", () => {
    expect(shouldTripCircuit("RATE_LIMITED")).toBe(true);
  });

  it("returns true for PROVIDER_DOWN", () => {
    expect(shouldTripCircuit("PROVIDER_DOWN")).toBe(true);
  });

  it("returns false for MODEL_NOT_FOUND", () => {
    expect(shouldTripCircuit("MODEL_NOT_FOUND")).toBe(false);
  });

  it("returns false for UNKNOWN", () => {
    expect(shouldTripCircuit("UNKNOWN")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// 3. Model allowlist: sequential order & dedup
// ─────────────────────────────────────────────────────────────

describe("Model allowlist", () => {
  it("returns env model first, then fallbacks in strict order", () => {
    const list = getModelAllowlist("gpt-5-latest");
    expect(list).toEqual(["gpt-5-latest", "gpt-5.1", "gpt-4.1", "o4-mini"]);
  });

  it("skips undefined env model", () => {
    const list = getModelAllowlist(undefined);
    expect(list).toEqual(["gpt-5.1", "gpt-4.1", "o4-mini"]);
    expect(list.length).toBe(3);
  });

  it("skips empty string env model", () => {
    const list = getModelAllowlist("");
    expect(list).toEqual(["gpt-5.1", "gpt-4.1", "o4-mini"]);
  });

  it("includes custom model at position 0", () => {
    const list = getModelAllowlist("my-fine-tuned-model");
    expect(list[0]).toBe("my-fine-tuned-model");
  });
});

// ─────────────────────────────────────────────────────────────
// 4. Error classification edge cases
// ─────────────────────────────────────────────────────────────

describe("Error classification edge cases", () => {
  it("classifies 500 as PROVIDER_DOWN", () => {
    expect(classifyOpenAiError({ status: 500, message: "internal server error" })).toBe("PROVIDER_DOWN");
  });

  it("classifies 502 as PROVIDER_DOWN", () => {
    expect(classifyOpenAiError({ status: 502, message: "bad gateway" })).toBe("PROVIDER_DOWN");
  });

  it("classifies 503 as PROVIDER_DOWN", () => {
    expect(classifyOpenAiError({ status: 503, message: "service unavailable" })).toBe("PROVIDER_DOWN");
  });

  it("classifies timeout message as PROVIDER_DOWN", () => {
    expect(classifyOpenAiError({ status: undefined, message: "Request timeout" })).toBe("PROVIDER_DOWN");
  });

  it("classifies network error as PROVIDER_DOWN", () => {
    expect(classifyOpenAiError({ status: undefined, message: "network error" })).toBe("PROVIDER_DOWN");
  });

  it("classifies 404 with model_not_found message as MODEL_NOT_FOUND", () => {
    expect(classifyOpenAiError({ status: 404, message: "The model `gpt-5.1` does not exist or you do not have access to it. model_not_found" })).toBe("MODEL_NOT_FOUND");
  });

  it("classifies 403 as AUTH_BLOCKED", () => {
    expect(classifyOpenAiError({ status: 403, message: "forbidden" })).toBe("AUTH_BLOCKED");
  });

  it("classifies empty message as UNKNOWN for unrecognized status", () => {
    expect(classifyOpenAiError({ status: 418, message: "" })).toBe("UNKNOWN");
  });

  it("handles undefined status and message gracefully", () => {
    expect(classifyOpenAiError({ status: undefined, message: undefined })).toBe("UNKNOWN");
  });
});

// ─────────────────────────────────────────────────────────────
// 5. Report command detection — false positive guard
// ─────────────────────────────────────────────────────────────

describe("Report command: false positive guard", () => {
  it("'report' triggers", () => {
    expect(detectUserCommand("report")).toBe("REPORT_REQUEST");
  });

  it("'Report' (capitalized) triggers", () => {
    expect(detectUserCommand("Report")).toBe("REPORT_REQUEST");
  });

  it("'generate report' triggers", () => {
    expect(detectUserCommand("generate report")).toBe("REPORT_REQUEST");
  });

  it("'I will write report later' does NOT trigger", () => {
    expect(detectUserCommand("I will write report later")).toBeNull();
  });

  it("'Can you include report data?' does NOT trigger", () => {
    expect(detectUserCommand("Can you include report data?")).toBeNull();
  });

  it("'the report is not ready' does NOT trigger", () => {
    expect(detectUserCommand("the report is not ready")).toBeNull();
  });

  it("'I mentioned report in my message' does NOT trigger", () => {
    expect(detectUserCommand("I mentioned report in my message")).toBeNull();
  });

  it("'What about the report?' does NOT trigger", () => {
    expect(detectUserCommand("What about the report?")).toBeNull();
  });

  it("'репорт в сообщении' does NOT trigger (embedded)", () => {
    expect(detectUserCommand("репорт в сообщении")).toBeNull();
  });

  it("'El reporte no está listo' does NOT trigger", () => {
    expect(detectUserCommand("El reporte no está listo")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// 6. Report commands — Spanish triggers
// ─────────────────────────────────────────────────────────────

describe("Report commands: Spanish", () => {
  it("'reporte' standalone triggers", () => {
    expect(detectUserCommand("reporte")).toBe("REPORT_REQUEST");
  });

  it("'informe' standalone triggers", () => {
    expect(detectUserCommand("informe")).toBe("REPORT_REQUEST");
  });

  it("'genera el reporte' triggers", () => {
    expect(detectUserCommand("genera el reporte")).toBe("REPORT_REQUEST");
  });

  it("'genera el informe' triggers", () => {
    expect(detectUserCommand("genera el informe")).toBe("REPORT_REQUEST");
  });

  it("'haz el reporte' triggers", () => {
    expect(detectUserCommand("haz el reporte")).toBe("REPORT_REQUEST");
  });

  it("'haz el informe' triggers", () => {
    expect(detectUserCommand("haz el informe")).toBe("REPORT_REQUEST");
  });

  it("'generar el reporte ahora' leading command triggers", () => {
    expect(detectUserCommand("generar el reporte ahora")).toBe("REPORT_REQUEST");
  });

  it("'haz el informe por favor' leading command triggers", () => {
    expect(detectUserCommand("haz el informe por favor")).toBe("REPORT_REQUEST");
  });

  it("'reporte por favor' triggers", () => {
    expect(detectUserCommand("reporte por favor")).toBe("REPORT_REQUEST");
  });
});

// ─────────────────────────────────────────────────────────────
// 7. Report commands — Russian triggers
// ─────────────────────────────────────────────────────────────

describe("Report commands: Russian", () => {
  it("'репорт' standalone triggers", () => {
    expect(detectUserCommand("репорт")).toBe("REPORT_REQUEST");
  });

  it("'отчет' standalone triggers", () => {
    expect(detectUserCommand("отчет")).toBe("REPORT_REQUEST");
  });

  it("'отчёт' standalone triggers", () => {
    expect(detectUserCommand("отчёт")).toBe("REPORT_REQUEST");
  });

  it("'сделай отчёт' triggers", () => {
    expect(detectUserCommand("сделай отчёт")).toBe("REPORT_REQUEST");
  });

  it("'сделай отчет' triggers", () => {
    expect(detectUserCommand("сделай отчет")).toBe("REPORT_REQUEST");
  });

  it("'напиши отчёт' triggers", () => {
    expect(detectUserCommand("напиши отчёт")).toBe("REPORT_REQUEST");
  });

  it("'сгенерируй отчёт' triggers", () => {
    expect(detectUserCommand("сгенерируй отчёт")).toBe("REPORT_REQUEST");
  });

  it("'сделай репорт' triggers", () => {
    expect(detectUserCommand("сделай репорт")).toBe("REPORT_REQUEST");
  });

  it("'напиши репорт' triggers", () => {
    expect(detectUserCommand("напиши репорт")).toBe("REPORT_REQUEST");
  });
});

// ─────────────────────────────────────────────────────────────
// 8. Retry AI command detection (EN/RU/ES)
// ─────────────────────────────────────────────────────────────

describe("Retry AI command detection", () => {
  // EN
  it("'retry ai' triggers", () => {
    expect(detectUserCommand("retry ai")).toBe("RETRY_AI");
  });

  it("'retry' triggers", () => {
    expect(detectUserCommand("retry")).toBe("RETRY_AI");
  });

  it("'try again' triggers", () => {
    expect(detectUserCommand("try again")).toBe("RETRY_AI");
  });

  it("'Retry AI' (caps) triggers", () => {
    expect(detectUserCommand("Retry AI")).toBe("RETRY_AI");
  });

  // RU
  it("'повтори' triggers", () => {
    expect(detectUserCommand("повтори")).toBe("RETRY_AI");
  });

  it("'повтори ai' triggers", () => {
    expect(detectUserCommand("повтори ai")).toBe("RETRY_AI");
  });

  it("'попробуй снова' triggers", () => {
    expect(detectUserCommand("попробуй снова")).toBe("RETRY_AI");
  });

  // ES
  it("'reintentar' triggers", () => {
    expect(detectUserCommand("reintentar")).toBe("RETRY_AI");
  });

  it("'reintentar ai' triggers", () => {
    expect(detectUserCommand("reintentar ai")).toBe("RETRY_AI");
  });

  it("'intenta de nuevo' triggers", () => {
    expect(detectUserCommand("intenta de nuevo")).toBe("RETRY_AI");
  });

  // Negative
  it("'I want to retry something' does NOT trigger", () => {
    expect(detectUserCommand("I want to retry something")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// 9. LLM down banner: EN/RU/ES blunt style
// ─────────────────────────────────────────────────────────────

describe("LLM down banner text", () => {
  // We test by reading the route.ts source since buildLlmDownBanner is not exported
  it("route.ts contains EN banner with 'Checklist Mode'", () => {
    const fs = require("fs");
    const content = fs.readFileSync("src/app/api/chat/route.ts", "utf-8");
    expect(content).toContain("AI temporarily unavailable. Use Checklist Mode to continue.");
  });

  it("route.ts contains RU banner", () => {
    const fs = require("fs");
    const content = fs.readFileSync("src/app/api/chat/route.ts", "utf-8");
    expect(content).toContain("AI временно недоступен. Продолжайте по чек-листу.");
  });

  it("route.ts contains ES banner", () => {
    const fs = require("fs");
    const content = fs.readFileSync("src/app/api/chat/route.ts", "utf-8");
    expect(content).toContain("AI no disponible temporalmente. Continúe con el modo lista de verificación.");
  });
});

// ─────────────────────────────────────────────────────────────
// 10. pendingReportRequest metadata structure
// ─────────────────────────────────────────────────────────────

describe("pendingReportRequest metadata contract", () => {
  it("route.ts stores enriched payload with reason, requestedBy, lastKnownMode, lastKnownSystem", () => {
    const fs = require("fs");
    const content = fs.readFileSync("src/app/api/chat/route.ts", "utf-8");
    // Verify the enriched structure fields exist in setPendingReportRequest
    expect(content).toContain("requestedAt:");
    expect(content).toContain("reason: args.reason");
    expect(content).toContain("requestedBy: args.requestedBy");
    expect(content).toContain("lastKnownMode: args.lastKnownMode");
    expect(content).toContain("lastKnownSystem: args.lastKnownSystem");
  });

  it("storage.ts exports PendingReportPayload type", () => {
    const fs = require("fs");
    const content = fs.readFileSync("src/lib/storage.ts", "utf-8");
    expect(content).toContain("export type PendingReportPayload");
    expect(content).toContain("requestedAt: string");
    expect(content).toContain('reason: "llm_down" | "cause_gate"');
    expect(content).toContain('requestedBy: "command" | "auto_transition"');
    expect(content).toContain("lastKnownMode: string");
    expect(content).toContain("lastKnownSystem: string");
  });

  it("CaseMetadata.pendingReportRequest is PendingReportPayload | null (not boolean)", () => {
    const fs = require("fs");
    const content = fs.readFileSync("src/lib/storage.ts", "utf-8");
    expect(content).toContain("pendingReportRequest?: PendingReportPayload | null");
    // Must NOT have the old boolean form
    expect(content).not.toMatch(/pendingReportRequest\?:\s*boolean/);
  });

  it("route.ts passes reason='llm_down' when LLM is down", () => {
    const fs = require("fs");
    const content = fs.readFileSync("src/app/api/chat/route.ts", "utf-8");
    expect(content).toContain('reason: "llm_down"');
  });

  it("route.ts passes reason='cause_gate' when cause gate blocks", () => {
    const fs = require("fs");
    const content = fs.readFileSync("src/app/api/chat/route.ts", "utf-8");
    expect(content).toContain('reason: llmAvailable ? "cause_gate" : "llm_down"');
  });

  it("clearPendingReportRequest sets pendingReportRequest to null", () => {
    const fs = require("fs");
    const content = fs.readFileSync("src/app/api/chat/route.ts", "utf-8");
    expect(content).toContain("pendingReportRequest: null");
  });
});

// ─────────────────────────────────────────────────────────────
// 11. Checklist mode: route structure
// ─────────────────────────────────────────────────────────────

describe("Checklist mode structure", () => {
  it("route.ts checks circuit status before LLM call", () => {
    const fs = require("fs");
    const content = fs.readFileSync("src/app/api/chat/route.ts", "utf-8");
    expect(content).toContain("getCircuitStatus()");
    expect(content).toContain('llmStatus.status === "up"');
  });

  it("route.ts emits 'checklist' fallback in status payload when LLM down", () => {
    const fs = require("fs");
    const content = fs.readFileSync("src/app/api/chat/route.ts", "utf-8");
    expect(content).toContain('fallback: "checklist"');
    expect(content).toContain("buildChecklistResponse");
  });

  it("route.ts uses buildChecklistResponse when LLM call fails", () => {
    const fs = require("fs");
    const content = fs.readFileSync("src/app/api/chat/route.ts", "utf-8");
    // After errorType is set, checklist response is built
    expect(content).toContain("if (result.errorType)");
    expect(content).toContain("buildChecklistResponse(ensuredCase.id");
  });

  it("route.ts sends llm status SSE event on every request", () => {
    const fs = require("fs");
    const content = fs.readFileSync("src/app/api/chat/route.ts", "utf-8");
    expect(content).toContain('type: "status"');
    expect(content).toContain("buildStatusPayload");
  });
});

// ─────────────────────────────────────────────────────────────
// 12. Recovery path: auto-generate pending report
// ─────────────────────────────────────────────────────────────

describe("Recovery path: pending report auto-generation", () => {
  it("route.ts auto-generates report when LLM recovers and causeAllowed", () => {
    const fs = require("fs");
    const content = fs.readFileSync("src/app/api/chat/route.ts", "utf-8");
    // The recovery block: if pendingReportRequest && causeAllowed && llmAvailable
    expect(content).toContain("!reportBlocked && pendingReportRequest && computedCauseAllowed && llmAvailable");
    expect(content).toContain("clearPendingReportRequest");
    expect(content).toContain('currentMode = "final_report"');
  });

  it("recovery only triggers when cause gate allows (causeAllowed=true)", () => {
    const fs = require("fs");
    const content = fs.readFileSync("src/app/api/chat/route.ts", "utf-8");
    // The condition must include computedCauseAllowed
    expect(content).toMatch(/pendingReportRequest\s*&&\s*computedCauseAllowed\s*&&\s*llmAvailable/);
  });
});

// ─────────────────────────────────────────────────────────────
// 13. UI: retry AI button and LLM status banner
// ─────────────────────────────────────────────────────────────

describe("UI: Retry AI and LLM status banner", () => {
  it("chat-panel has retry-ai-button with data-testid", () => {
    const fs = require("fs");
    const content = fs.readFileSync("src/components/chat-panel.tsx", "utf-8");
    expect(content).toContain('data-testid="retry-ai-button"');
  });

  it("chat-panel has llm-status-banner with data-testid", () => {
    const fs = require("fs");
    const content = fs.readFileSync("src/components/chat-panel.tsx", "utf-8");
    expect(content).toContain('data-testid="llm-status-banner"');
  });

  it("retry button sends 'retry ai' command", () => {
    const fs = require("fs");
    const content = fs.readFileSync("src/components/chat-panel.tsx", "utf-8");
    expect(content).toContain('"retry ai"');
  });

  it("llm status banner shows when status is 'down'", () => {
    const fs = require("fs");
    const content = fs.readFileSync("src/components/chat-panel.tsx", "utf-8");
    expect(content).toContain('llmStatus?.status === "down"');
  });
});

// ─────────────────────────────────────────────────────────────
// 14. Continue diagnostics command
// ─────────────────────────────────────────────────────────────

describe("Continue diagnostics command", () => {
  it("'continue diagnostics' triggers CONTINUE_DIAGNOSTICS", () => {
    expect(detectUserCommand("continue diagnostics")).toBe("CONTINUE_DIAGNOSTICS");
  });

  it("'continue diagnostic' triggers CONTINUE_DIAGNOSTICS", () => {
    expect(detectUserCommand("continue diagnostic")).toBe("CONTINUE_DIAGNOSTICS");
  });

  it("'продолжаем' triggers CONTINUE_DIAGNOSTICS", () => {
    expect(detectUserCommand("продолжаем")).toBe("CONTINUE_DIAGNOSTICS");
  });

  it("'давай дальше' triggers CONTINUE_DIAGNOSTICS", () => {
    expect(detectUserCommand("давай дальше")).toBe("CONTINUE_DIAGNOSTICS");
  });

  it("'I want to continue' does NOT trigger (normal text)", () => {
    expect(detectUserCommand("I want to continue")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// 15. callOpenAIWithFallback structure
// ─────────────────────────────────────────────────────────────

describe("callOpenAIWithFallback integration", () => {
  it("route.ts uses callOpenAIWithFallback (not raw callOpenAI) for main LLM call", () => {
    const fs = require("fs");
    const content = fs.readFileSync("src/app/api/chat/route.ts", "utf-8");
    // The main chat handler should use the resilient wrapper
    expect(content).toContain("callOpenAIWithFallback(apiKey");
    // It should check for errorType on the result
    expect(content).toContain("result.errorType");
  });

  it("callOpenAIWithFallback checks circuit before calling API", () => {
    const fs = require("fs");
    const content = fs.readFileSync("src/app/api/chat/route.ts", "utf-8");
    // Inside the function, it checks circuitStatus
    expect(content).toContain("getCircuitStatus()");
    expect(content).toContain('circuitStatus.status === "down"');
  });

  it("callOpenAIWithFallback iterates model allowlist", () => {
    const fs = require("fs");
    const content = fs.readFileSync("src/app/api/chat/route.ts", "utf-8");
    expect(content).toContain("getModelAllowlist(process.env.OPENAI_MODEL)");
    expect(content).toContain("for (const model of candidates)");
  });

  it("callOpenAIWithFallback trips circuit on hard errors", () => {
    const fs = require("fs");
    const content = fs.readFileSync("src/app/api/chat/route.ts", "utf-8");
    expect(content).toContain("shouldTripCircuit(errorType)");
    expect(content).toContain("openCircuit(errorType)");
  });

  it("callOpenAIWithFallback clears circuit on success", () => {
    const fs = require("fs");
    const content = fs.readFileSync("src/app/api/chat/route.ts", "utf-8");
    expect(content).toContain("clearCircuit()");
  });
});
