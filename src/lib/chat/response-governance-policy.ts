/**
 * Response Governance Policy — system-wide invariants for the
 * technician-facing assistant layer.
 *
 * This module centralizes the rules that previously lived as ad-hoc
 * heuristics scattered across `route.ts`. The goal is the
 * `Generalize Case-88/89/90/91` mandate: the Agent must behave like
 * ChatGPT inside RV Service Desk server boundaries, NOT like a rigid
 * procedural override layer.
 *
 * Authority contract (unchanged):
 *   - Server still owns: domain, safety, truth, Context Engine,
 *     report legality, final-output legality.
 *   - LLM / assistant-facing layer owns: phrasing, conversational
 *     clarity, language consistency, using already-provided facts.
 *
 * What this module adds:
 *   - `wasFinalReportInvitedRecently(history)` — detects whether the
 *     immediately-previous assistant message contained a START FINAL
 *     REPORT invitation. Used to enforce the START-FINAL-REPORT
 *     INVARIANT: if the assistant invited it, the next response to a
 *     report request MUST NOT generic-wall.
 *   - `buildPostInvitationGateResponse(language)` — replacement for
 *     the bare "diagnostics not complete" wall when the assistant
 *     just invited START FINAL REPORT but Context Engine cannot point
 *     at a specific missing field. Acknowledges the invitation,
 *     asks for the last-result confirmation, no robotic prose.
 */

import type { Language } from "@/lib/lang";

/** Minimal message shape this policy reads. */
export type GovernanceHistoryMessage = {
  role: string;
  content: string;
};

/**
 * Did the most-recent assistant turn invite the technician to send
 * `START FINAL REPORT`? Walks backwards to the FIRST encountered
 * assistant message (intermediate user messages are ignored).
 *
 * The invitation is detected from any of:
 *   - the literal phrase `START FINAL REPORT` (assistant prompts the
 *     technician to send it back);
 *   - the localized "Send START FINAL REPORT" / "отправьте START FINAL
 *     REPORT" / "envía START FINAL REPORT" / "envíe START FINAL REPORT"
 *     hints emitted by `buildAuthoritativeCompletionOffer` and the
 *     Context-Engine completion-instruction constraint.
 */
export function wasFinalReportInvitedRecently(
  history: GovernanceHistoryMessage[] | null | undefined,
): boolean {
  if (!history || history.length === 0) return false;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role !== "assistant") continue;
    return /\bSTART\s+FINAL\s+REPORT\b/i.test(msg.content);
  }
  return false;
}

/**
 * Localized response when:
 *   - the technician sent an explicit report request (e.g.
 *     `START FINAL REPORT`, "напиши отчёт", "write report");
 *   - the assistant's previous turn invited that exact action;
 *   - Context Engine still reports the report gate as not open.
 *
 * Replaces the historical robotic wall:
 *   "Диагностика ещё не завершена. Давайте продолжим с текущего шага..."
 *
 * with a ChatGPT-style acknowledgement that the invitation was seen
 * and asks only for the last missing confirmation. No internal
 * metadata, no raw English step text in non-EN responses, no
 * questionnaire.
 */
export function buildPostInvitationGateResponse(language: Language): string {
  switch (language) {
    case "RU":
      return [
        "Понял — вы прислали START FINAL REPORT.",
        "Чтобы оформить отчёт, мне не хватает только подтверждения по последнему диагностическому шагу.",
        "Поделитесь, пожалуйста, его результатом — и я подготовлю отчёт.",
      ].join(" ");
    case "ES":
      return [
        "Entendido — recibí START FINAL REPORT.",
        "Para preparar el informe solo me falta la confirmación del último paso de diagnóstico.",
        "Comparte el resultado y preparo el informe.",
      ].join(" ");
    default:
      return [
        "Got it — I received START FINAL REPORT.",
        "To prepare the report I just need the result of the last diagnostic check.",
        "Share that confirmation and I'll generate the report.",
      ].join(" ");
  }
}

/**
 * Pure check — given a `runtimeReportReady` flag and prior history,
 * is there a START-FINAL-REPORT invariant violation?
 *
 * A violation happens when:
 *   - runtimeReportReady === false (report gate not open), AND
 *   - the previous assistant turn explicitly invited START FINAL REPORT.
 *
 * The route uses this to choose `buildPostInvitationGateResponse`
 * instead of the legacy generic wall.
 */
export function isStartFinalReportInvariantViolated(
  history: GovernanceHistoryMessage[] | null | undefined,
  runtimeReportReady: boolean,
): boolean {
  if (runtimeReportReady) return false;
  return wasFinalReportInvitedRecently(history);
}
