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
 * Heuristic — does the assistant message look like a generated/finalized
 * final-report draft? Used by `wasFinalReportInvitedRecently` to decide
 * whether an earlier invitation has been "consumed".
 *
 * Section-header presence is the dominant cue. We require at least
 * three of the canonical final-report headers to co-occur in the same
 * message. The trilingual list mirrors the validators that check
 * `FINAL_REPORT_FORMAT` in the response-validation service.
 */
function looksLikeFinalReportDraft(content: string): boolean {
  const headerHits = [
    /(?:^|\n)\s*Complaint\s*:/i,
    /(?:^|\n)\s*Diagnostic\s+Procedure\s*:/i,
    /(?:^|\n)\s*Verified\s+Condition\s*:/i,
    /(?:^|\n)\s*Recommended\s+Corrective\s+Action\s*:/i,
    /(?:^|\n)\s*Estimated\s+Labor\s*:/i,
    /(?:^|\n)\s*Required\s+Parts\s*:/i,
    /(?:^|\n)\s*Жалоба\s*:/iu,
    /(?:^|\n)\s*Диагностическая\s+процедура\s*:/iu,
    /(?:^|\n)\s*Подтверждённое\s+состояние\s*:/iu,
    /(?:^|\n)\s*Рекомендуемые\s+действия\s*:/iu,
    /(?:^|\n)\s*Оценка\s+трудозатрат\s*:/iu,
    /(?:^|\n)\s*Требуемые\s+запчасти\s*:/iu,
    /(?:^|\n)\s*Queja\s*:/i,
    /(?:^|\n)\s*Procedimiento\s+de\s+diagn[óo]stico\s*:/i,
    /(?:^|\n)\s*Condici[óo]n\s+verificada\s*:/i,
    /(?:^|\n)\s*Acci[óo]n\s+correctiva\s+recomendada\s*:/i,
  ];
  let count = 0;
  for (const re of headerHits) {
    if (re.test(content)) count += 1;
    if (count >= 3) return true;
  }
  return false;
}

/**
 * Did a recent assistant turn invite the technician to send
 * `START FINAL REPORT`? Walks backwards through history and returns
 * `true` as soon as it finds an assistant message containing the
 * literal phrase. Walking stops early when an assistant message that
 * looks like a generated final-report draft is encountered (the
 * invitation has been consumed by the report being produced).
 *
 * Why walk past one non-matching assistant message?
 *   When the technician sends `START FINAL REPORT` and the route
 *   emits the legacy "isolation confirmation" gate response (which
 *   does NOT itself contain the literal `START FINAL REPORT`), the
 *   invitation is still pending — the user asked, the system did
 *   not satisfy. On the technician's next attempt, the most-recent
 *   assistant message no longer contains `START FINAL REPORT`,
 *   but earlier turns do. Returning `false` because of one
 *   intermediate gate response would loop the user. (Case 107/110.)
 *
 * Authority preserved:
 *   - Server still owns the report gate. This helper only changes
 *     PROSE selection (legacy generic wall vs. acknowledgement) and
 *     mode-transition eligibility when paired with an explicit
 *     `START FINAL REPORT` user message.
 */
export function wasFinalReportInvitedRecently(
  history: GovernanceHistoryMessage[] | null | undefined,
): boolean {
  if (!history || history.length === 0) return false;
  // Walk backwards. The invitation is "live" if we encounter it before
  // a generated final-report draft. We bound the walk to the most
  // recent 8 assistant turns to keep this conservative and deterministic.
  let assistantsSeen = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role !== "assistant") continue;
    if (looksLikeFinalReportDraft(msg.content)) return false;
    if (/\bSTART\s+FINAL\s+REPORT\b/i.test(msg.content)) return true;
    assistantsSeen += 1;
    if (assistantsSeen >= 8) break;
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
