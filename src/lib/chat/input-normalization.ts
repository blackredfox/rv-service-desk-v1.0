/**
 * Bounded, loss-minimizing preprocessing for routing/classification only.
 *
 * Responsibility: normalize noisy technician input without inventing facts.
 * Does NOT own: diagnosis, readiness, step advancement, or mode transitions.
 */

export type NormalizedRoutingInput = {
  normalizedMessage: string;
};

export function normalizeRoutingInput(message: string): NormalizedRoutingInput {
  const normalizedMessage = message
    .replace(/\r\n?/g, "\n")
    .replace(/[•·]+/g, " ; ")
    .replace(/[|]+/g, " ; ")
    .replace(/[—–]+/g, " - ")
    .replace(/([!?.,;:])\1+/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\s*([,.;:!?])\s*/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();

  return { normalizedMessage };
}
