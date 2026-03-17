/**
 * Final report generation and repair helpers.
 *
 * Responsibility: Build prompts and requests for final report generation.
 * Does NOT own: flow control, diagnostic logic, mode transitions.
 */

import type { LanguagePolicy, Language } from "@/lib/lang";

/**
 * Build translation instruction for final report generation.
 */
export function buildTranslationInstruction(
  includeTranslation: boolean,
  translationLanguage?: Language
): string {
  if (!includeTranslation || !translationLanguage) return "";

  const languageName =
    translationLanguage === "RU"
      ? "Russian"
      : translationLanguage === "ES"
      ? "Spanish"
      : "English";

  return `\n\nAfter the English report, output "--- TRANSLATION ---" and provide a complete translation into ${languageName}.`;
}

/**
 * Build the final report generation request message.
 */
export function buildFinalReportRequest(
  includeTranslation: boolean,
  translationLanguage?: Language
): string {
  const translationInstruction = buildTranslationInstruction(includeTranslation, translationLanguage);

  return `Generate the FINAL SHOP REPORT now.

REQUIRED OUTPUT FORMAT (plain text, no numbering, no tables):
Complaint:
Diagnostic Procedure:
Verified Condition:
Recommended Corrective Action:
Estimated Labor:
Required Parts:

Estimated Labor MUST include 2-5 task-level breakdown lines and end with "Total labor: X hr".
Do NOT ask labor-confirmation questions.
Do NOT ask follow-up questions.${translationInstruction}`;
}

/**
 * Build constraints for final report generation after auto-transition.
 */
export function buildTransitionConstraints(factLock: string): string {
  return [
    "FINAL REPORT DIRECTIVE (MANDATORY): Generate the complete FINAL SHOP REPORT immediately.",
    "Do NOT ask for labor confirmation.",
    "Do NOT ask follow-up questions.",
    "Estimated Labor must include task-level breakdown lines and end with 'Total labor: X hr'.",
    factLock,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Build labor override constraints.
 */
export function buildLaborOverrideConstraints(
  requestedLaborHoursText: string,
  factLock: string
): string {
  return [
    factLock,
    `LABOR OVERRIDE (MANDATORY):
- The technician requires total labor to be exactly ${requestedLaborHoursText} hours.
- Rewrite ONLY the 'Estimated Labor' section to fit exactly ${requestedLaborHoursText} hr total.
- Keep all other sections semantically identical (no new diagnostics, no new parts, no new findings).
- Do NOT ask questions. Do NOT request confirmations.
- End the labor section with: "Total labor: ${requestedLaborHoursText} hr"`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Build labor override request message.
 */
export function buildLaborOverrideRequest(
  requestedLaborHoursText: string,
  includeTranslation: boolean,
  translationLanguage?: Language
): string {
  const translationInstruction = buildTranslationInstruction(includeTranslation, translationLanguage);

  return `Regenerate the FINAL SHOP REPORT now with the same facts and sections.

Keep Complaint, Diagnostic Procedure, Verified Condition, Recommended Corrective Action, and Required Parts semantically identical.
Rewrite only Estimated Labor so the breakdown sums to exactly ${requestedLaborHoursText} hr.
Use canonical format with one decimal and end with: "Total labor: ${requestedLaborHoursText} hr".
Do NOT ask labor confirmation questions.
Do NOT ask follow-up diagnostic questions.${translationInstruction}`;
}

/**
 * Build correction instruction for labor override retry.
 */
export function buildLaborOverrideCorrectionInstruction(
  modeViolations: string[],
  laborViolations: string[],
  requestedLaborHoursText: string,
  baseCorrectionInstruction: string
): string {
  return [
    baseCorrectionInstruction,
    `Regenerate in FINAL_REPORT mode only.`,
    `Do NOT output diagnostic steps or step IDs (no "Step", no "wp_").`,
    `Keep all sections except Estimated Labor semantically unchanged.`,
    `Estimated Labor must sum to exactly ${requestedLaborHoursText} hr and end with "Total labor: ${requestedLaborHoursText} hr".`,
    `Do NOT ask labor confirmation. Do NOT ask follow-up questions.`,
  ].join("\n");
}

/**
 * Build correction instruction for final report retry after transition.
 */
export function buildFinalReportCorrectionInstruction(
  baseCorrectionInstruction: string
): string {
  return [
    baseCorrectionInstruction,
    "Ensure Estimated Labor includes task-level breakdown and ends with 'Total labor: X hr'.",
    "Do NOT ask labor confirmation.",
    "Do NOT ask follow-up questions.",
  ].join("\n");
}
