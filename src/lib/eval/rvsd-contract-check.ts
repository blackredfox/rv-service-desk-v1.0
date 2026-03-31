import type { Language } from "@/lib/lang";
import {
  validateAuthorizationOutput,
  validateDiagnosticOutput,
  validateFinalReportOutput,
  validateLanguageConsistency,
} from "@/lib/mode-validators";

export type RVSDContractMode = "diagnostic" | "final_report" | "authorization";

export type RVSDContractCheckInput = {
  mode: RVSDContractMode;
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

function classifyFinalReportViolations(
  result: ReturnType<typeof validateFinalReportOutput>,
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

function buildChecks(violations: string[]): RVSDContractCheckResult["checks"] {
  return {
    modeClassValid: !violations.some((v) =>
      ["CONTRACT_DIAGNOSTIC_DRIFT", "CONTRACT_AUTHORIZATION_DRIFT"].includes(v),
    ),
    structureValid: !violations.some((v) =>
      ["CONTRACT_QUESTION_SHAPE", "CONTRACT_FINAL_REPORT_STRUCTURE"].includes(v),
    ),
    languagePolicyValid: !violations.some((v) =>
      [
        "CONTRACT_LANGUAGE_POLICY_MISMATCH",
        "CONTRACT_DIAGNOSTIC_TRANSLATION_FORBIDDEN",
        "CONTRACT_FINAL_REPORT_LANGUAGE_POLICY",
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

  if (args.mode === "final_report") {
    const includeTranslation = args.includeTranslation ?? (args.dialogueLanguage ? args.dialogueLanguage !== "EN" : true);
    classifyFinalReportViolations(
      validateFinalReportOutput(responseText, includeTranslation, args.dialogueLanguage),
      violations,
    );
  }

  if (args.mode === "authorization") {
    const authorizationResult = validateAuthorizationOutput(responseText);
    if (hasFinalReportShape(responseText) || authorizationResult.violations.some((v) => v.includes("AUTHORIZATION_DRIFT"))) {
      pushUnique(violations, "CONTRACT_AUTHORIZATION_DRIFT");
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
      ? `PASS: ${args.mode} contract satisfied`
      : `FAIL: ${args.mode} contract violated (${violations.join(", ")})`,
  };
}