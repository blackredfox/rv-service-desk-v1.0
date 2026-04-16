import {
  composePromptV2,
  type CaseMode,
  type OutputSurface,
} from "@/lib/prompt-composer";
import type {
  Language,
  LanguagePolicy,
  OutputLanguagePolicyV2,
} from "@/lib/lang";
import { buildVisionInstruction } from "@/lib/chat/attachment-validator";

/**
 * Build additional prompt constraints from already-resolved orchestration inputs.
 */
export function buildAdditionalConstraints(parts: string[]): string | undefined {
  const joined = parts.filter(Boolean).join("\n\n");
  return joined || undefined;
}

/**
 * Compose the final system prompt for the current turn.
 */
export function buildChatSystemPrompt(args: {
  mode: CaseMode;
  outputSurface: OutputSurface;
  trackedInputLanguage: Language;
  outputPolicy: OutputLanguagePolicyV2;
  langPolicy: LanguagePolicy;
  translationLanguage?: Language;
  contextEngineDirectives: string;
  procedureContext: string;
  factLockConstraint: string;
  attachmentCount: number;
}): {
  additionalConstraints?: string;
  baseSystemPrompt: string;
  systemPrompt: string;
} {
  const additionalConstraints = buildAdditionalConstraints([
    args.contextEngineDirectives,
    args.procedureContext,
    args.factLockConstraint,
  ]);

  const baseSystemPrompt = composePromptV2({
    mode: args.mode,
    outputSurface: args.outputSurface,
    inputDetected: args.trackedInputLanguage,
    outputEffective: args.outputPolicy.effective,
    includeTranslation: args.langPolicy.includeTranslation,
    translationLanguage: args.translationLanguage,
    additionalConstraints,
  });

  const systemPrompt =
    baseSystemPrompt + buildVisionInstruction(args.attachmentCount);

  return {
    additionalConstraints,
    baseSystemPrompt,
    systemPrompt,
  };
}