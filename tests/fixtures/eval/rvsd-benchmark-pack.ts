import type { RVSDContractCheckInput } from "@/lib/eval/rvsd-contract-check";

import { RVSD_CONTRACT_FIXTURES } from "../rvsd-contract-check";

export type RVSDBenchmarkCase = {
  id: string;
  description: string;
  input: RVSDContractCheckInput;
  expectedPassed: boolean;
  expectedViolationIncludes?: string[];
};

export const RVSD_BENCHMARK_PACK_V1: RVSDBenchmarkCase[] = [
  {
    id: "diagnostic-valid-control",
    description: "Diagnostic control case stays in diagnostic question shape and mode.",
    input: {
      mode: "diagnostic",
      responseText: RVSD_CONTRACT_FIXTURES.diagnosticValid,
      dialogueLanguage: "EN",
    },
    expectedPassed: true,
  },
  {
    id: "diagnostic-final-report-drift",
    description: "Diagnostic output must not drift into final report structure.",
    input: {
      mode: "diagnostic",
      responseText: RVSD_CONTRACT_FIXTURES.diagnosticFinalReportDrift,
      dialogueLanguage: "EN",
    },
    expectedPassed: false,
    expectedViolationIncludes: ["CONTRACT_DIAGNOSTIC_DRIFT"],
  },
  {
    id: "diagnostic-premature-completion-transition",
    description: "Semantic completion alone must not declare isolation complete or force mode transition.",
    input: {
      mode: "diagnostic",
      responseText: RVSD_CONTRACT_FIXTURES.diagnosticPrematureCompletion,
      dialogueLanguage: "EN",
      metadata: { explicitTransitionCommandGiven: false },
    },
    expectedPassed: false,
    expectedViolationIncludes: [
      "CONTRACT_PREMATURE_COMPLETION",
      "CONTRACT_EXPLICIT_TRANSITION_REQUIRED",
    ],
  },
  {
    id: "diagnostic-translation-separator-forbidden",
    description: "Diagnostic output must not include the final-report translation separator.",
    input: {
      mode: "diagnostic",
      responseText: `System: Water heater\nStatus: Isolation not completed; Cause cannot be formed\n\nStep 5: Is 12V DC present at the control board?\n--- TRANSLATION ---\n¿Hay 12V DC en la placa?`,
      dialogueLanguage: "EN",
    },
    expectedPassed: false,
    expectedViolationIncludes: ["CONTRACT_DIAGNOSTIC_TRANSLATION_FORBIDDEN"],
  },
  {
    id: "diagnostic-question-shape-violation",
    description: "Diagnostic output must keep a valid next-question shape instead of turning into a statement block.",
    input: {
      mode: "diagnostic",
      responseText: `System: Water heater\nStatus: Isolation not completed; Cause cannot be formed\n\nCheck 12V at the control board and inspect the fuse path.`,
      dialogueLanguage: "EN",
    },
    expectedPassed: false,
    expectedViolationIncludes: ["CONTRACT_QUESTION_SHAPE"],
  },
  {
    id: "final-report-valid-control",
    description: "Final report control case satisfies required structure and translation policy.",
    input: {
      mode: "final_report",
      responseText: RVSD_CONTRACT_FIXTURES.finalReportValid,
      dialogueLanguage: "RU",
      includeTranslation: true,
    },
    expectedPassed: true,
  },
  {
    id: "final-report-missing-header",
    description: "Final report must fail when a required header is missing.",
    input: {
      mode: "final_report",
      responseText: RVSD_CONTRACT_FIXTURES.finalReportMissingHeader,
      dialogueLanguage: "RU",
      includeTranslation: true,
    },
    expectedPassed: false,
    expectedViolationIncludes: ["CONTRACT_FINAL_REPORT_STRUCTURE"],
  },
  {
    id: "final-report-language-mismatch",
    description: "Final report must fail when the translation section does not match the requested language policy.",
    input: {
      mode: "final_report",
      responseText: RVSD_CONTRACT_FIXTURES.finalReportLanguageMismatch,
      dialogueLanguage: "RU",
      includeTranslation: true,
    },
    expectedPassed: false,
    expectedViolationIncludes: ["CONTRACT_FINAL_REPORT_LANGUAGE_POLICY"],
  },
  {
    id: "final-report-prohibited-wording",
    description: "Final report must reject prohibited denial wording in the English section.",
    input: {
      mode: "final_report",
      responseText: `Complaint: Water heater ignition fault.\nDiagnostic Procedure: Verified 12V supply and checked the control-board fuse.\nVerified Condition: Failed fuse identified in the 12V supply path.\nRecommended Corrective Action: Replace the fuse and verify heater operation.\nEstimated Labor: Access and fuse replacement - 0.4 hr. Total labor: 0.4 hr.\nRequired Parts: Fuse.\n--- TRANSLATION ---\nЖалоба: Неисправность розжига водонагревателя.`,
      dialogueLanguage: "RU",
      includeTranslation: true,
    },
    expectedPassed: false,
    expectedViolationIncludes: ["CONTRACT_FINAL_REPORT_PROHIBITED_WORDING"],
  },
  {
    id: "authorization-drift-into-report",
    description: "Authorization output must not drift into final report structure.",
    input: {
      mode: "authorization",
      responseText: RVSD_CONTRACT_FIXTURES.authorizationDrift,
      dialogueLanguage: "EN",
    },
    expectedPassed: false,
    expectedViolationIncludes: ["CONTRACT_AUTHORIZATION_DRIFT"],
  },
];