import { describe, it, expect } from "vitest";
import {
  classifyOpenAiError,
  getModelAllowlist,
  openCircuit,
  clearCircuit,
  getCircuitStatus,
} from "@/lib/llm-resilience";

describe("llm-resilience: model allowlist", () => {
  it("returns allowlist in strict order", () => {
    const list = getModelAllowlist("custom-model");
    expect(list[0]).toBe("custom-model");
    expect(list[1]).toBe("gpt-5.1");
    expect(list[2]).toBe("gpt-4.1");
    expect(list[3]).toBe("o4-mini");
  });
});

describe("llm-resilience: error classification", () => {
  it("detects model_not_found", () => {
    expect(classifyOpenAiError({ status: 404, message: "model_not_found" })).toBe("MODEL_NOT_FOUND");
  });

  it("detects auth blocked", () => {
    expect(classifyOpenAiError({ status: 401, message: "unauthorized" })).toBe("AUTH_BLOCKED");
    expect(classifyOpenAiError({ status: 403, message: "forbidden" })).toBe("AUTH_BLOCKED");
  });

  it("detects rate limited", () => {
    expect(classifyOpenAiError({ status: 429, message: "rate limit" })).toBe("RATE_LIMITED");
  });

  it("detects provider down", () => {
    expect(classifyOpenAiError({ status: 503, message: "upstream" })).toBe("PROVIDER_DOWN");
  });

  it("falls back to unknown", () => {
    expect(classifyOpenAiError({ status: 400, message: "something else" })).toBe("UNKNOWN");
  });
});

describe("llm-resilience: circuit breaker", () => {
  it("opens and clears circuit", () => {
    clearCircuit();
    openCircuit("AUTH_BLOCKED", 10_000);
    expect(getCircuitStatus().status).toBe("down");
    clearCircuit();
    expect(getCircuitStatus().status).toBe("up");
  });
});
