export type TermsPayload = {
  version: string;
  markdown: string;
};

export type TermsAcceptance = {
  accepted: boolean;
  version: string;
  acceptedAt: string;
};

const STORAGE_KEY = "rv:termsAcceptance";

export function loadTermsAcceptance(): TermsAcceptance | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TermsAcceptance;
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.accepted || typeof parsed.version !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function storeTermsAcceptance(version: string) {
  const payload: TermsAcceptance = {
    accepted: true,
    version,
    acceptedAt: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export async function fetchTerms(): Promise<TermsPayload> {
  const res = await fetch("/api/terms", { cache: "no-store" });
  const data = (await res.json().catch(() => null)) as TermsPayload | { error?: string } | null;
  if (!res.ok || !data || "error" in (data as any)) {
    throw new Error((data as any)?.error || `Failed to load terms (${res.status})`);
  }
  return data as TermsPayload;
}
