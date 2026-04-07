import type { Language, LanguagePolicy } from "@/lib/lang";
import type { CaseMode } from "@/lib/prompt-composer";
import { validateLaborSum } from "@/lib/labor-store";
import {
  buildCorrectionInstruction,
  getSafeFallback,
  validateLanguageConsistency,
  validateOutput,
  validateStepCompliance,
} from "@/lib/mode-validators";
import {
  applyDiagnosticModeValidationGuard,
  buildAuthoritativeStepFallback,
  buildDiagnosticDriftCorrectionInstruction,
  buildFinalReportFallback,
  extractPrimaryReportBlock,
  isDiagnosticDriftViolation,
} from "@/lib/chat/output-policy";
import { hasCanonicalTotalLaborLine } from "@/lib/chat/labor-override";
import { buildLaborOverrideCorrectionInstruction } from "@/lib/chat/final-report-service";
import type { FinalReportAuthorityFacts } from "@/lib/fact-pack";

export type ValidationResult = {
  valid: boolean;
  violations: string[];
};

export type ActiveStepMetadata = {
  id: string;
  question: string;
  procedureName: string;
  progress: {
    completed: number;
    total: number;
  };
} | null;

/**
 * Validate the primary chat response without owning step selection.
 */
export function validatePrimaryResponse(args: {
  response: string;
  mode: CaseMode;
  trackedInputLanguage: Language;
  outputLanguage?: Language;
  includeTranslation: boolean;
  translationLanguage?: Language;
  activeStepMetadata: ActiveStepMetadata;
}): ValidationResult {
  const expectedOutputLanguage = args.outputLanguage ?? args.trackedInputLanguage;
  let validation = validateOutput(
    args.response,
    args.mode,
    args.includeTranslation,
    args.translationLanguage,
  );

  validation = applyDiagnosticModeValidationGuard(
    validation,
    args.mode,
    args.response,
  );

  if (args.mode === "diagnostic") {
    const langValidation = validateLanguageConsistency(
      args.response,
      expectedOutputLanguage,
    );

    if (!langValidation.valid) {
      validation = {
        ...validation,
        valid: false,
        violations: [...validation.violations, ...langValidation.violations],
      };
    }

    if (args.activeStepMetadata) {
      const stepValidation = validateStepCompliance(
        args.response,
        args.activeStepMetadata.id,
        args.activeStepMetadata.question,
      );

      if (!stepValidation.valid) {
        validation = {
          ...validation,
          valid: false,
          violations: [...validation.violations, ...stepValidation.violations],
        };
      }
    }
  }

  return validation;
}

/**
 * Build retry instructions for the primary chat response.
 */
export function buildPrimaryCorrectionInstruction(args: {
  validation: ValidationResult;
  activeStepMetadata: ActiveStepMetadata;
  activeStepId?: string;
}): string {
  const correctionInstructionParts = [
    buildCorrectionInstruction(args.validation.violations),
  ];

  if (
    isDiagnosticDriftViolation(args.validation.violations) ||
    args.validation.violations.some((violation) =>
      violation.includes("STEP_COMPLIANCE"),
    )
  ) {
    correctionInstructionParts.push(
      buildDiagnosticDriftCorrectionInstruction(args.activeStepId),
    );

    if (args.activeStepMetadata) {
      correctionInstructionParts.push(
        `MANDATORY: Ask this EXACT question (paraphrased naturally): "${args.activeStepMetadata.question}"`,
      );
    }
  }

  if (args.validation.violations.some((violation) => violation.includes("LANGUAGE_MISMATCH"))) {
    correctionInstructionParts.push(
      "LANGUAGE REPAIR (MANDATORY): translate every visible diagnostic label, progress line, and active-step question into the required session language. Never echo raw English procedure metadata in a non-English session.",
    );
  }

  return correctionInstructionParts.join("\n");
}

/**
 * Build the safe fallback for primary response validation failures.
 */
export function buildPrimaryFallbackResponse(args: {
  validation: ValidationResult;
  mode: CaseMode;
  outputLanguage: Language;
  langPolicy: LanguagePolicy;
  translationLanguage?: Language;
  activeStepMetadata: ActiveStepMetadata;
  activeStepId?: string;
  finalReportAuthorityFacts?: FinalReportAuthorityFacts | null;
}): string {
  const hasDriftOrStepViolation =
    isDiagnosticDriftViolation(args.validation.violations) ||
    args.validation.violations.some((violation) =>
      violation.includes("STEP_COMPLIANCE") ||
      violation.includes("LANGUAGE_MISMATCH"),
    );

  if (args.mode === "diagnostic" && hasDriftOrStepViolation) {
    return buildAuthoritativeStepFallback(
      args.activeStepMetadata,
      args.activeStepId,
      args.outputLanguage,
    );
  }

  if (args.mode === "diagnostic") {
    return getSafeFallback(args.mode, args.outputLanguage);
  }

  if (args.mode === "final_report") {
    return buildFinalReportFallback({
      policy: args.langPolicy,
      translationLanguage: args.translationLanguage,
      complaint: args.finalReportAuthorityFacts?.complaint,
      diagnosticProcedure: args.finalReportAuthorityFacts?.diagnosticProcedure,
      finding: args.finalReportAuthorityFacts?.verifiedCondition,
      correctiveAction: args.finalReportAuthorityFacts?.correctiveAction,
      requiredParts: args.finalReportAuthorityFacts?.requiredParts,
    });
  }

  return getSafeFallback(args.mode, args.outputLanguage);
}

/**
 * Validate labor override output without changing final-report authority.
 */
export function validateLaborOverrideResponse(args: {
  response: string;
  requestedLaborHours: number;
  requestedLaborHoursText: string;
  includeTranslation: boolean;
  translationLanguage?: Language;
}): {
  modeValidation: ValidationResult;
  laborValidation: ValidationResult;
} {
  let modeValidation = validateOutput(
    args.response,
    "final_report",
    args.includeTranslation,
    args.translationLanguage,
  );

  modeValidation = applyDiagnosticModeValidationGuard(
    modeValidation,
    "final_report",
    args.response,
  );

  const primary = extractPrimaryReportBlock(args.response);
  const sumValidation = validateLaborSum(primary, args.requestedLaborHours);
  const hasCanonicalTotal = hasCanonicalTotalLaborLine(
    primary,
    args.requestedLaborHoursText,
  );

  const violations = [
    ...sumValidation.violations,
    ...(hasCanonicalTotal
      ? []
      : [
          `LABOR_TOTAL_FORMAT: Final report must include "Total labor: ${args.requestedLaborHoursText} hr" in canonical one-decimal format`,
        ]),
  ];

  return {
    modeValidation,
    laborValidation: {
      valid: violations.length === 0,
      violations,
    },
  };
}

/**
 * Build retry instructions for labor override regeneration.
 */
export function buildLaborOverrideRetryInstruction(args: {
  modeViolations: string[];
  laborViolations: string[];
  requestedLaborHoursText: string;
}): string {
  const combinedViolations = [
    ...args.modeViolations,
    ...args.laborViolations,
  ];

  return buildLaborOverrideCorrectionInstruction(
    args.modeViolations,
    args.laborViolations,
    args.requestedLaborHoursText,
    buildCorrectionInstruction(combinedViolations),
  );
}