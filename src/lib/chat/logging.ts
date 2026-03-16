/**
 * Chat API logging helpers.
 *
 * Responsibility: Structured logging for timing and flow events.
 * Does NOT own: flow control, diagnostic logic.
 */

/**
 * Log timing event with structured payload.
 */
export function logTiming(
  stage: string,
  payload: Record<string, number | string | boolean | undefined>
): void {
  console.log(`[Chat API v2][timing] ${JSON.stringify({ stage, ...payload })}`);
}

/**
 * Log flow event with structured payload.
 */
export function logFlow(
  stage: string,
  payload: Record<string, number | string | boolean | undefined>
): void {
  console.log(`[Chat API v2][flow] ${JSON.stringify({ stage, ...payload })}`);
}
