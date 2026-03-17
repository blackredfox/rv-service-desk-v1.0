/**
 * Labor override parsing and application for final reports.
 *
 * Responsibility: Detect labor override intent, parse hours, validation.
 * Does NOT own: flow control, diagnostic logic, mode transitions.
 */

import type { CaseMode } from "@/lib/prompt-composer";

const LABOR_OVERRIDE_MIN_HOURS = 0.1;
const LABOR_OVERRIDE_MAX_HOURS = 24;

/**
 * Normalize labor hours to one decimal place.
 */
export function normalizeLaborHours(hours: number): number {
  return Math.round(hours * 10) / 10;
}

/**
 * Format labor hours for display (one decimal place).
 */
export function formatLaborHours(hours: number): string {
  return normalizeLaborHours(hours).toFixed(1);
}

/**
 * Parse requested labor hours from a message.
 * Returns null if no valid hours found within range.
 */
export function parseRequestedLaborHours(message: string): number | null {
  const sanitized = message.replace(/,/g, ".");
  const matches = sanitized.match(/\d+(?:\.\d+)?/g);
  if (!matches) return null;

  for (const raw of matches) {
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) continue;
    if (parsed < LABOR_OVERRIDE_MIN_HOURS || parsed > LABOR_OVERRIDE_MAX_HOURS) continue;
    return normalizeLaborHours(parsed);
  }

  return null;
}

/**
 * Detect if a message intends to override labor hours.
 */
export function detectLaborOverrideIntent(message: string): boolean {
  const hasNumber = parseRequestedLaborHours(message) !== null;
  if (!hasNumber) return false;

  const hasActionWord = [
    /\b(?:recalculate|set\s+to|set|make|adjust|override|change|edit|revise|update)\b/i,
    /(?:перерасч(?:е|ё)т|пересчитай|сделай|зделай|укажи|пересчитать|измени|изменить|поменяй|поменять|поправь|правка|исправь)/i,
    /\b(?:recalcula|recalcular|ajusta|ajustar|hazlo|hacer|cambia|cambiar|edita|editar|actualiza|actualizar)\b/i,
  ].some((pattern) => pattern.test(message));

  const hasLaborWord = [
    /\b(?:labor|labour|man\s*hours?)\b/i,
    /(?:трудозатрат|трудо(?:затр|емк)|работы|рабоч(?:ее|их)?\s+время)/i,
    /\b(?:mano\s+de\s+obra)\b/i,
  ].some((pattern) => pattern.test(message));

  const hasTotalWord = [
    /\btotal\b/i,
    /(?:итого|всего)/i,
    /\btotal\b/i,
  ].some((pattern) => pattern.test(message));

  const hasTimeUnit = [
    /\b(?:hours?|hrs?|hr|h)\b/i,
    /(?:час(?:а|ов)?|ч(?=\s|$|\.)|времени)/i,
    /\b(?:hora|horas)\b/i,
  ].some((pattern) => pattern.test(message));

  if (!hasTimeUnit) return false;

  return hasLaborWord || hasTotalWord || hasActionWord;
}

/**
 * Check if the last assistant message looks like a final report.
 */
function lastAssistantLooksLikeFinalReport(history: { role: string; content: string }[]): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role === "assistant" || msg.role === "agent") {
      return looksLikeFinalReport(msg.content || "");
    }
  }
  return false;
}

/**
 * Determine if we should treat the current context as final report for override purposes.
 */
export function shouldTreatAsFinalReportForOverride(
  currentMode: CaseMode,
  history: { role: string; content: string }[]
): boolean {
  return currentMode === "final_report" || lastAssistantLooksLikeFinalReport(history);
}

/**
 * Check if text looks like a final report based on required headers.
 */
export function looksLikeFinalReport(text: string): boolean {
  const t = text.toLowerCase();
  const required = [
    "complaint:",
    "diagnostic procedure:",
    "verified condition:",
    "recommended corrective action:",
    "estimated labor:",
    "required parts:",
  ];
  const hits = required.filter((k) => t.includes(k)).length;
  return hits >= 4;
}

/**
 * Compute whether this is a labor override request.
 */
export function computeLaborOverrideRequest(
  currentMode: CaseMode,
  history: { role: string; content: string }[],
  message: string
): { isLaborOverrideRequest: boolean; requestedLaborHours: number | null } {
  const parsedRequestedLaborHours = parseRequestedLaborHours(message);
  const isLaborOverrideRequest =
    shouldTreatAsFinalReportForOverride(currentMode, history) &&
    detectLaborOverrideIntent(message) &&
    parsedRequestedLaborHours !== null;

  return {
    isLaborOverrideRequest,
    requestedLaborHours: isLaborOverrideRequest
      ? normalizeLaborHours(parsedRequestedLaborHours ?? 0)
      : null,
  };
}

/**
 * Escape regex special characters.
 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Check if a report contains the canonical total labor line format.
 */
export function hasCanonicalTotalLaborLine(reportText: string, totalHoursText: string): boolean {
  const escapedTotal = escapeRegExp(totalHoursText);
  return new RegExp(`Total\\s+labor:\\s*${escapedTotal}\\s*hr\\b`, "i").test(reportText);
}
