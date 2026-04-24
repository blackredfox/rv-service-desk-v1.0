/**
 * LLM Runtime Signals — production client-input guard tests (Blocker 1).
 *
 * Contract under review:
 *   - The `__sidecarProposal` body field is a TEST/DEV-ONLY deterministic
 *     input channel. It must NEVER be consumed in production, even when
 *     the `ENABLE_LLM_RUNTIME_SIGNALS` feature flag is ON.
 *   - Real sidecar input must eventually come from server-side LLM
 *     execution (future PR), not from a user-controlled HTTP body.
 *   - The guard is:
 *       NODE_ENV === "test"                                     → allowed
 *       NODE_ENV === "development" + RVSD_ALLOW_CLIENT_SIDECAR_DEV=1 → allowed
 *       anything else (production, missing NODE_ENV, etc.)      → denied
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  isSidecarClientInputAllowed,
  LLM_RUNTIME_SIGNALS_FLAG_ENV,
  LLM_RUNTIME_SIGNALS_DEV_CLIENT_INPUT_ENV,
  tryAdjudicateRuntimeSignals,
} from "@/lib/chat/llm-runtime-signals";

// Save NODE_ENV once; vitest sets it to "test" by default for this process.
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function setNodeEnv(value: string | undefined) {
  if (value === undefined) {
    delete (process.env as Record<string, string | undefined>).NODE_ENV;
  } else {
    (process.env as Record<string, string | undefined>).NODE_ENV = value;
  }
}

describe("LLM Runtime Signals — production client-input guard (Blocker 1)", () => {
  beforeEach(() => {
    // Start each test from a known baseline.
    delete process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV];
    delete process.env[LLM_RUNTIME_SIGNALS_DEV_CLIENT_INPUT_ENV];
  });

  afterEach(() => {
    setNodeEnv(ORIGINAL_NODE_ENV);
    delete process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV];
    delete process.env[LLM_RUNTIME_SIGNALS_DEV_CLIENT_INPUT_ENV];
  });

  it("in production: client-input channel is CLOSED", () => {
    setNodeEnv("production");
    expect(isSidecarClientInputAllowed()).toBe(false);
  });

  it("in production: even with the dev env var set, client-input channel stays CLOSED", () => {
    setNodeEnv("production");
    process.env[LLM_RUNTIME_SIGNALS_DEV_CLIENT_INPUT_ENV] = "1";
    expect(isSidecarClientInputAllowed()).toBe(false);
  });

  it("with NODE_ENV undefined: client-input channel is CLOSED (fail-safe default)", () => {
    setNodeEnv(undefined);
    expect(isSidecarClientInputAllowed()).toBe(false);
  });

  it("in development WITHOUT the dev env var: client-input channel is CLOSED", () => {
    setNodeEnv("development");
    expect(isSidecarClientInputAllowed()).toBe(false);
  });

  it("in development WITH the dev env var: client-input channel is OPEN", () => {
    setNodeEnv("development");
    process.env[LLM_RUNTIME_SIGNALS_DEV_CLIENT_INPUT_ENV] = "1";
    expect(isSidecarClientInputAllowed()).toBe(true);
  });

  it("in test: client-input channel is OPEN", () => {
    setNodeEnv("test");
    expect(isSidecarClientInputAllowed()).toBe(true);
  });

  // The guard is consumed by route.ts — see `route-integration.test.ts` for
  // the end-to-end assertion that a client-supplied proposal is ignored in
  // production mode. Here we assert the lower-level invariant: when the
  // client channel is closed, NO adjudication can occur from client input
  // because the route will never pass the raw string through.
  // This is the core architectural guarantee:
  //   client JSON → [route guard] → [adjudication] → [server consumers]
  // without the guard, the adjudicator itself is content-agnostic and would
  // process whatever it was given. That is BY DESIGN — the guard belongs at
  // the route level so this test documents the contract.
  it("tryAdjudicateRuntimeSignals itself is content-agnostic (the guard lives in the route)", () => {
    setNodeEnv("test");
    process.env[LLM_RUNTIME_SIGNALS_FLAG_ENV] = "1";
    // The adjudication function processes whatever it is given. This
    // confirms that the trust boundary is the route-level guard, not this
    // function. Production safety depends on `isSidecarClientInputAllowed()`
    // being checked before the raw proposal ever reaches this function.
    const result = tryAdjudicateRuntimeSignals({
      rawProposal: JSON.stringify({
        surface_request_proposal: {
          requested_surface: "shop_final_report",
          confidence: 0.99,
        },
      }),
      latestUserMessage: "make the report",
      technicianMessages: ["pump does not work"],
      serverState: {
        caseMode: "diagnostic",
        isolationComplete: false,
        hasActiveProcedure: false,
        terminalPhase: "normal",
        activeStepId: null,
      },
    });
    expect(result).not.toBeNull();
    expect(result?.signals.surfaceRequest.accepted).toBe(true);
  });
});
