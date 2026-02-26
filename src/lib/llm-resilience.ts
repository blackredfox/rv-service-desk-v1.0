export type LlmErrorType =
  | "MODEL_NOT_FOUND"
  | "AUTH_BLOCKED"
  | "RATE_LIMITED"
  | "PROVIDER_DOWN"
  | "UNKNOWN";

export type LlmStatus = {
  status: "up" | "down";
  reason?: LlmErrorType;
  downUntil?: number | null;
};

const DEFAULT_TTL_MS = 90_000;

let llmDownUntil: number | null = null;
let llmDownReason: LlmErrorType | null = null;

export function getModelAllowlist(envModel?: string): string[] {
  return [envModel, "gpt-5.1", "gpt-4.1", "o4-mini"].filter(
    (value): value is string => Boolean(value)
  );
}

export function classifyOpenAiError(args: { status?: number; message?: string }): LlmErrorType {
  const status = args.status;
  const message = (args.message || "").toLowerCase();

  if (status === 401 || status === 403) return "AUTH_BLOCKED";
  if (status === 429) return "RATE_LIMITED";
  if (status && status >= 500) return "PROVIDER_DOWN";

  if (message.includes("model_not_found") || message.includes("model not found")) {
    return "MODEL_NOT_FOUND";
  }

  if (message.includes("timeout") || message.includes("network") || message.includes("upstream")) {
    return "PROVIDER_DOWN";
  }

  return "UNKNOWN";
}

export function isCircuitOpen(now = Date.now()): boolean {
  if (!llmDownUntil) return false;
  if (now >= llmDownUntil) {
    llmDownUntil = null;
    llmDownReason = null;
    return false;
  }
  return true;
}

export function openCircuit(reason: LlmErrorType, ttlMs = DEFAULT_TTL_MS): void {
  llmDownReason = reason;
  llmDownUntil = Date.now() + ttlMs;
}

export function clearCircuit(): void {
  llmDownUntil = null;
  llmDownReason = null;
}

export function getCircuitStatus(): LlmStatus {
  const down = isCircuitOpen();
  return {
    status: down ? "down" : "up",
    reason: down ? llmDownReason ?? undefined : undefined,
    downUntil: down ? llmDownUntil : null,
  };
}

export function shouldTripCircuit(reason: LlmErrorType): boolean {
  return reason === "AUTH_BLOCKED" || reason === "RATE_LIMITED" || reason === "PROVIDER_DOWN";
}
