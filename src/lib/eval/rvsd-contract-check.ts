import type { Language } from "@/lib/lang";
import {
  validateAuthorizationReadyOutput,
  validateDiagnosticOutput,
  validateShopFinalReportOutput,
  validateLanguageConsistency,
} from "@/lib/mode-validators";
import { resolveOutputSurfaceForMode, type OutputSurface } from "@/lib/prompt-composer";
import { validatePortalCauseOutput } from "@/lib/output-validator";

export type RVSDContractMode = "diagnostic" | "final_report" | "authorization";

export type RVSDContractCheckInput = {
  mode: RVSDContractMode;
  outputSurface?: OutputSurface;
  responseText: string;
  dialogueLanguage?: Language;
  includeTranslation?: boolean;
  metadata?: {
    explicitTransitionCommandGiven?: boolean;
  };
};

export type RVSDContractCheckResult = {
  passed: boolean;
  violations: string[];
  checks: {
    modeClassValid: boolean;
    structureValid: boolean;
    languagePolicyValid: boolean;
    transitionRuleValid: boolean;
    prematureCompletionBlocked: boolean;
  };
  summary?: string;
};

export const RVSD_EXPLICIT_TRANSITION_RULE =
  "semantic completion alone must not be treated as a valid mode switch";

const FINAL_REPORT_HEADERS = [
  "Complaint",
  "Diagnostic Procedure",
  "Verified Condition",
  "Recommended Corrective Action",
  "Estimated Labor",
  "Required Parts",
];

const SEMANTIC_TRANSITION_PATTERNS = [
  /isolation\s+(?:is\s+)?complete/i,
  /conditions?\s+(?:are\s+)?met/i,
  /ready\s+to\s+transition/i,
  /transition(?:ing)?\s+to\s+final\s+report/i,
  /изоляция\s+завершен/i,
  /условия\s+выполнен/i,
  /aislamiento\s+complet/i,
];

function hasFinalReportShape(text: string): boolean {
  const headerCount = FINAL_REPORT_HEADERS.filter((header) =>
    new RegExp(`^\\s*${header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`, "im").test(text),
  ).length;

  return headerCount >= 2;
}

function pushUnique(violations: string[], value: string) {
  if (!violations.includes(value)) {
    violations.push(value);
  }
}

function classifyDiagnosticViolations(
  result: ReturnType<typeof validateDiagnosticOutput>,
  violations: string[],
) {
  for (const violation of result.violations) {
    if (violation.includes("DIAGNOSTIC_DRIFT")) {
      pushUnique(violations, "CONTRACT_DIAGNOSTIC_DRIFT");
    }
    if (violation.includes("translation separator")) {
      pushUnique(violations, "CONTRACT_DIAGNOSTIC_TRANSLATION_FORBIDDEN");
    }
    if (violation.includes("ISOLATION_DECLARATION_BLOCKED")) {
      pushUnique(violations, "CONTRACT_PREMATURE_COMPLETION");
    }
    if (violation.includes("TRANSITION_MARKER_BLOCKED") || violation.includes("Mode transitions require explicit user command")) {
      pushUnique(violations, "CONTRACT_EXPLICIT_TRANSITION_REQUIRED");
    }
    if (violation.includes("DIAGNOSTIC_QUESTION")) {
      pushUnique(violations, "CONTRACT_QUESTION_SHAPE");
    }
    if (violation.includes("PROHIBITED_WORDS")) {
      pushUnique(violations, "CONTRACT_PROHIBITED_WORDING");
    }
  }
}

function classifyShopFinalReportViolations(
  result: ReturnType<typeof validateShopFinalReportOutput>,
  violations: string[],
) {
  for (const violation of result.violations) {
    if (violation.includes("FINAL_REPORT_FORMAT")) {
      pushUnique(violations, "CONTRACT_FINAL_REPORT_STRUCTURE");
    }
    if (violation.includes("FINAL_REPORT_LANG_POLICY")) {
      pushUnique(violations, "CONTRACT_FINAL_REPORT_LANGUAGE_POLICY");
    }
    if (violation.includes("PROHIBITED_WORDS")) {
      pushUnique(violations, "CONTRACT_FINAL_REPORT_PROHIBITED_WORDING");
    }
  }
}

function classifyPortalCauseViolations(
  result: ReturnType<typeof validatePortalCauseOutput>,
  violations: string[],
) {
  for (const violation of result.violations) {
    if (violation.includes("FORMAT_VIOLATION")) {
      pushUnique(violations, "CONTRACT_PORTAL_CAUSE_STRUCTURE");
    }
    if (violation.includes("Translation should be in")) {
      pushUnique(violations, "CONTRACT_PORTAL_CAUSE_LANGUAGE_POLICY");
    }
  }
}

function buildChecks(violations: string[]): RVSDContractCheckResult["checks"] {
  return {
    modeClassValid: !violations.some((v) =>
      [
        "CONTRACT_DIAGNOSTIC_DRIFT",
        "CONTRACT_AUTHORIZATION_DRIFT",
        "CONTRACT_AUTHORIZATION_SURFACE_MISMATCH",
        "CONTRACT_PORTAL_CAUSE_STRUCTURE",
        "CONTRACT_FINAL_REPORT_STRUCTURE",
      ].includes(v),
    ),
    structureValid: !violations.some((v) =>
      [
        "CONTRACT_QUESTION_SHAPE",
        "CONTRACT_FINAL_REPORT_STRUCTURE",
        "CONTRACT_PORTAL_CAUSE_STRUCTURE",
      ].includes(v),
    ),
    languagePolicyValid: !violations.some((v) =>
      [
        "CONTRACT_LANGUAGE_POLICY_MISMATCH",
        "CONTRACT_DIAGNOSTIC_TRANSLATION_FORBIDDEN",
        "CONTRACT_FINAL_REPORT_LANGUAGE_POLICY",
        "CONTRACT_PORTAL_CAUSE_LANGUAGE_POLICY",
      ].includes(v),
    ),
    transitionRuleValid: !violations.includes("CONTRACT_EXPLICIT_TRANSITION_REQUIRED"),
    prematureCompletionBlocked: !violations.includes("CONTRACT_PREMATURE_COMPLETION"),
  };
}

export function checkExplicitTransitionDoctrine(args: {
  responseText: string;
  explicitTransitionCommandGiven?: boolean;
}): { valid: boolean; violations: string[] } {
  const hasSemanticTransitionCue = SEMANTIC_TRANSITION_PATTERNS.some((pattern) =>
    pattern.test(args.responseText),
  );

  if (hasSemanticTransitionCue && !args.explicitTransitionCommandGiven) {
    return {
      valid: false,
      violations: ["CONTRACT_EXPLICIT_TRANSITION_REQUIRED"],
    };
  }

  return { valid: true, violations: [] };
}

export function rvsdContractCheck(args: RVSDContractCheckInput): RVSDContractCheckResult {
  const violations: string[] = [];
  const responseText = args.responseText ?? "";
  const outputSurface = resolveOutputSurfaceForMode({
    mode: args.mode,
    requestedSurface: args.outputSurface,
  });

  if (args.mode === "diagnostic") {
    classifyDiagnosticViolations(validateDiagnosticOutput(responseText), violations);

    if (args.dialogueLanguage) {
      const languageCheck = validateLanguageConsistency(responseText, args.dialogueLanguage);
      if (!languageCheck.valid) {
        pushUnique(violations, "CONTRACT_LANGUAGE_POLICY_MISMATCH");
      }
    }

    const transitionCheck = checkExplicitTransitionDoctrine({
      responseText,
      explicitTransitionCommandGiven: args.metadata?.explicitTransitionCommandGiven,
    });
    transitionCheck.violations.forEach((violation) => pushUnique(violations, violation));
  }

  if (outputSurface === "shop_final_report") {
    const includeTranslation = args.includeTranslation ?? (args.dialogueLanguage ? args.dialogueLanguage !== "EN" : true);
    classifyShopFinalReportViolations(
      validateShopFinalReportOutput(responseText, includeTranslation, args.dialogueLanguage),
      violations,
    );
  }

  if (outputSurface === "portal_cause") {
    const includeTranslation = args.includeTranslation ?? (args.dialogueLanguage ? args.dialogueLanguage !== "EN" : true);
    classifyPortalCauseViolations(
      validatePortalCauseOutput(responseText, includeTranslation, args.dialogueLanguage),
      violations,
    );
  }

  if (outputSurface === "authorization_ready") {
    const authorizationResult = validateAuthorizationReadyOutput(responseText);
    if (hasFinalReportShape(responseText) || authorizationResult.violations.some((v) => v.includes("AUTHORIZATION_DRIFT"))) {
      pushUnique(violations, "CONTRACT_AUTHORIZATION_DRIFT");
    }
    if (authorizationResult.violations.some((v) => v.includes("AUTHORIZATION_SURFACE_MISMATCH"))) {
      pushUnique(violations, "CONTRACT_AUTHORIZATION_SURFACE_MISMATCH");
    }
    if (authorizationResult.violations.some((v) => v.includes("PROHIBITED_WORDS"))) {
      pushUnique(violations, "CONTRACT_AUTHORIZATION_PROHIBITED_WORDING");
    }
  }

  const checks = buildChecks(violations);
  const passed = violations.length === 0;

  return {
    passed,
    violations,
    checks,
    summary: passed
      ? `PASS: ${outputSurface} contract satisfied`
      : `FAIL: ${outputSurface} contract violated (${violations.join(", ")})`,
  };
}