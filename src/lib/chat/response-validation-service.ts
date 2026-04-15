import type { Language, LanguagePolicy } from "@/lib/lang";
import type { CaseMode, OutputSurface } from "@/lib/prompt-composer";
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
  buildPortalCauseFallback,
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
  outputSurface: OutputSurface;
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
    args.outputSurface,
  );

  validation = applyDiagnosticModeValidationGuard(
    validation,
    args.outputSurface === "diagnostic" ? args.mode : "final_report",
    args.response,
  );

  if (args.outputSurface === "diagnostic") {
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
  outputSurface: OutputSurface;
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

  if (args.outputSurface === "portal_cause") {
    correctionInstructionParts.push(
      [
        "OUTPUT SURFACE REPAIR (MANDATORY):",
        "- Active output surface is PORTAL_CAUSE.",
        "- Do NOT output shop-report section headers.",
        "- Do NOT output authorization-ready request wording.",
        "- Generate concise portal-cause text only.",
      ].join("\n"),
    );
  }

  if (args.outputSurface === "shop_final_report") {
    correctionInstructionParts.push(
      [
        "OUTPUT SURFACE REPAIR (MANDATORY):",
        "- Active output surface is SHOP_FINAL_REPORT.",
        "- Output the complete shop final report only.",
        "- Use the required section headers in order.",
        "- Do NOT output portal-cause-only formatting.",
      ].join("\n"),
    );
  }

  if (args.outputSurface === "authorization_ready") {
    correctionInstructionParts.push(
      [
        "OUTPUT SURFACE REPAIR (MANDATORY):",
        "- Active output surface is AUTHORIZATION_READY.",
        "- Generate authorization-ready wording only.",
        "- Do NOT output shop-report headers.",
        "- Do NOT output portal-cause-only formatting.",
      ].join("\n"),
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
  outputSurface: OutputSurface;
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

  if (args.outputSurface === "diagnostic" && hasDriftOrStepViolation) {
    return buildAuthoritativeStepFallback(
      args.activeStepMetadata,
      args.activeStepId,
      args.outputLanguage,
    );
  }

  if (args.outputSurface === "diagnostic") {
    return getSafeFallback(args.mode, args.outputLanguage);
  }

  if (args.outputSurface === "portal_cause") {
    return buildPortalCauseFallback({
      policy: args.langPolicy,
      translationLanguage: args.translationLanguage,
      complaint: args.finalReportAuthorityFacts?.complaint,
      finding: args.finalReportAuthorityFacts?.verifiedCondition,
    });
  }

  if (args.outputSurface === "shop_final_report") {
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

  if (args.outputSurface === "authorization_ready") {
    return getSafeFallback("authorization", args.outputLanguage);
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
    "shop_final_report",
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