import {
  normalizeLanguageMode,
  detectInputLanguageV2,
  detectForcedOutputLanguage,
  computeOutputPolicy,
  resolveLanguagePolicy,
  type LanguageMode,
  type Language,
  type InputLanguageV2,
  type OutputLanguagePolicyV2,
  type LanguagePolicy,
} from "@/lib/lang";
import { storage, type CaseSummary } from "@/lib/storage";
import {
  filterValidAttachments,
  validateAttachments,
  type Attachment,
} from "@/lib/chat/attachment-validator";

export type ChatBodyV2 = {
  v?: 2;
  caseId?: string;
  message: string;
  output?: {
    mode?: LanguageMode;
  };
  languageMode?: LanguageMode;
  dialogueLanguage?: Language;
  attachments?: Attachment[];
  /**
   * Optional LLM runtime-signal sidecar proposal.
   *
   * Advisory-only. The server always adjudicates this against the transcript
   * and its own state before using it. It is ignored unless the
   * `ENABLE_LLM_RUNTIME_SIGNALS` feature flag is enabled.
   */
  __sidecarProposal?: string;
};

export type PreparedAttachmentBundle = {
  attachments: Attachment[];
  attachmentCount: number;
  totalBytes: number;
};

export type PreparedLanguageContext = {
  detectedInputLanguage: InputLanguageV2;
  forcedOutputLanguage: Language | null;
  trackedInputLanguage: Language;
  outputMode: LanguageMode;
  outputPolicy: OutputLanguagePolicyV2;
  langPolicy: LanguagePolicy;
  translationLanguage?: Language;
};

/**
 * Parse the request body and normalize the message field.
 */
export async function parseChatRequest(req: Request): Promise<{
  body: ChatBodyV2 | null;
  message: string;
}> {
  const body = (await req.json().catch(() => null)) as ChatBodyV2 | null;

  return {
    body,
    message: (body?.message ?? "").trim(),
  };
}

/**
 * Validate and normalize attachments without owning any flow logic.
 */
export function prepareAttachmentBundle(
  body: ChatBodyV2 | null,
):
  | { valid: true; value: PreparedAttachmentBundle }
  | { valid: false; error: string } {
  const attachments = filterValidAttachments(body?.attachments) ?? [];
  const validation = validateAttachments(attachments);

  if (!validation.valid) {
    return {
      valid: false,
      error: validation.error ?? "Invalid attachment payload",
    };
  }

  return {
    valid: true,
    value: {
      attachments,
      attachmentCount: attachments.length,
      totalBytes: validation.totalBytes ?? 0,
    },
  };
}

/**
 * Resolve request language state for the current turn.
 */
export async function resolveLanguageContext(args: {
  body: ChatBodyV2 | null;
  message: string;
  userId?: string;
}): Promise<PreparedLanguageContext> {
  const detectedInputLanguage = detectInputLanguageV2(args.message);
  const forcedOutputLanguage = detectForcedOutputLanguage(args.message);

  let trackedInputLanguage: Language = detectedInputLanguage.detected;

  if (args.body?.caseId) {
    const existing = await storage.getCase(args.body.caseId, args.userId);
    const previousLanguage = existing.case?.inputLanguage;

    if (previousLanguage) {
      trackedInputLanguage = previousLanguage;

      const compactMessage = args.message.trim();
      const isShortAck =
        compactMessage.length <= 4 ||
        /^(?:ok|okay|yes|y|no|n|sí|si|да|нет)$/i.test(compactMessage);

      const shouldAutoSwitch =
        !forcedOutputLanguage &&
        previousLanguage !== detectedInputLanguage.detected &&
        (detectedInputLanguage.confidence ?? 0) >= 0.85 &&
        !isShortAck;

      if (shouldAutoSwitch) {
        trackedInputLanguage = detectedInputLanguage.detected;
      }
    }
  }

  const requestedOutputMode = normalizeLanguageMode(
    args.body?.output?.mode ?? args.body?.languageMode,
  );
  const outputMode = forcedOutputLanguage ?? requestedOutputMode;

  if (forcedOutputLanguage) {
    trackedInputLanguage = forcedOutputLanguage;
  }

  const outputPolicy = computeOutputPolicy(outputMode, trackedInputLanguage);
  const langPolicy = resolveLanguagePolicy(outputMode, trackedInputLanguage);
  const translationLanguage = langPolicy.includeTranslation
    ? trackedInputLanguage
    : undefined;

  return {
    detectedInputLanguage,
    forcedOutputLanguage,
    trackedInputLanguage,
    outputMode,
    outputPolicy,
    langPolicy,
    translationLanguage,
  };
}

/**
 * Ensure the case exists for the turn.
 */
export async function ensureChatCase(args: {
  body: ChatBodyV2 | null;
  message: string;
  trackedInputLanguage: Language;
  outputPolicy: OutputLanguagePolicyV2;
  userId?: string;
}): Promise<CaseSummary> {
  return storage.ensureCase({
    caseId: args.body?.caseId,
    titleSeed: args.message,
    inputLanguage: args.trackedInputLanguage,
    languageSource: args.outputPolicy.strategy === "auto" ? "AUTO" : "MANUAL",
    userId: args.userId,
  });
}