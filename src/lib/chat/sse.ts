/**
 * SSE (Server-Sent Events) encoding helpers for chat streaming.
 *
 * Responsibility: SSE protocol encoding only.
 * Does NOT own: flow control, diagnostic logic, mode transitions.
 */

/**
 * Encode a payload as an SSE data frame.
 */
export function sseEncode(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * SSE event types emitted by the chat route.
 */
export type SseEventType =
  | "case"
  | "language"
  | "mode"
  | "mode_transition"
  | "token"
  | "validation"
  | "validation_fallback"
  | "error"
  | "done";

/**
 * Type-safe SSE event builders.
 */
export const SseEvents = {
  case: (caseId: string) => sseEncode({ type: "case", caseId }),

  language: (payload: {
    inputDetected: string;
    outputMode: string;
    outputEffective: string;
    detector: string;
    confidence?: number;
  }) => sseEncode({ type: "language", ...payload }),

  mode: (mode: string) => sseEncode({ type: "mode", mode }),

  modeTransition: (from: string, to: string) =>
    sseEncode({ type: "mode_transition", from, to }),

  token: (token: string) => sseEncode({ type: "token", token }),

  validation: (valid: boolean, violations: string[]) =>
    sseEncode({ type: "validation", valid, violations }),

  validationFallback: (violations: string[]) =>
    sseEncode({ type: "validation_fallback", violations }),

  error: (code: string, message: string) =>
    sseEncode({ type: "error", code, message }),

  done: () => sseEncode({ type: "done" }),
} as const;
