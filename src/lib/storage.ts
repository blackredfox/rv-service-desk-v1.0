import { getPrisma } from "@/lib/db";
import { detectLanguage, type Language } from "@/lib/lang";
import { trackEvent } from "@/lib/analytics";
import { computeExpiresAt, computeTimeLeftSeconds } from "@/lib/retention";
import type { CaseMode } from "./prompt-composer";


// Local structural helpers to avoid depending on generated Prisma types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any;

export type CaseSummary = {
  id: string;
  title: string;
  userId?: string | null;
  inputLanguage: Language;
  languageSource: "AUTO" | "MANUAL";
  mode: CaseMode;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  expiresAt: string;
  timeLeftSeconds: number;
};

export type ChatMessage = {
  id: string;
  caseId: string;
  role: "user" | "assistant";
  content: string;
  language: Language;
  createdAt: string;
};

type CreateCaseInput = { title?: string; userId?: string };

type EnsureCaseInput = {
  caseId?: string;
  titleSeed: string;
  inputLanguage: Language;
  languageSource: "AUTO" | "MANUAL";
  userId?: string;
};

type UpdateCaseInput = {
  title?: string;
  inputLanguage?: Language;
  languageSource?: "AUTO" | "MANUAL";
  mode?: CaseMode;
};

function nowIso() {
  return new Date().toISOString();
}

function clampTitle(t: string) {
  const title = (t ?? "").trim() || "New Case";
  return title.slice(0, 80);
}

function clampTitleSeed(seed: string) {
  const s = (seed ?? "").trim();
  return (s.slice(0, 60) || "New Case").trim();
}

/** Enrich a raw case object with computed retention fields. */
function withRetention(c: {
  createdAt: string;
  updatedAt: string;
  lastActivityAt?: string;
  [key: string]: unknown;
}): { lastActivityAt: string; expiresAt: string; timeLeftSeconds: number } {
  const lastActivityAt = c.lastActivityAt || c.updatedAt;
  const expiresAt = computeExpiresAt(lastActivityAt).toISOString();
  const timeLeftSeconds = computeTimeLeftSeconds(expiresAt);
  return { lastActivityAt, expiresAt, timeLeftSeconds };
}

function uuid() {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `id_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

type MemoryStore = {
  cases: Map<string, CaseSummary & { deletedAt: string | null }>;
  messages: Map<string, ChatMessage>;
};

function getMemoryStore(): MemoryStore {
  const g = globalThis as unknown as { __rvServiceDeskMemoryStore?: MemoryStore };
  if (!g.__rvServiceDeskMemoryStore) {
    g.__rvServiceDeskMemoryStore = {
      cases: new Map(),
      messages: new Map(),
    };
  }
  return g.__rvServiceDeskMemoryStore;
}

async function listCasesMemory(): Promise<CaseSummary[]> {
  const store = getMemoryStore();
  return [...store.cases.values()]
    .filter((c) => !c.deletedAt)
    .filter((c) => c.timeLeftSeconds > 0) // hide expired
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 50)
    .map(({ deletedAt: _d, ...rest }) => rest);
}

async function createCaseMemory(input: CreateCaseInput): Promise<CaseSummary> {
  const store = getMemoryStore();
  const id = uuid();
  const ts = nowIso();
  const c = {
    id,
    title: clampTitle(input.title ?? "New Case"),
    inputLanguage: "EN" as Language,
    languageSource: "AUTO" as const,
    mode: "diagnostic" as CaseMode,
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
  };
  store.cases.set(id, c);
  const { ...summary } = c;
  return summary;
}

async function getCaseMemory(caseId: string): Promise<{ case: CaseSummary | null; messages: ChatMessage[] }> {
  const store = getMemoryStore();
  const c = store.cases.get(caseId);
  if (!c || c.deletedAt) return { case: null, messages: [] };

  const messages = [...store.messages.values()]
    .filter((m) => m.caseId === caseId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const { ...summary } = c;
  return { case: summary, messages };
}

async function updateCaseMemory(caseId: string, input: UpdateCaseInput): Promise<CaseSummary | null> {
  const store = getMemoryStore();
  const c = store.cases.get(caseId);
  if (!c || c.deletedAt) return null;
  const updated = {
    ...c,
    title: input.title ? clampTitle(input.title) : c.title,
    inputLanguage: input.inputLanguage ?? c.inputLanguage,
    languageSource: input.languageSource ?? c.languageSource,
    mode: input.mode ?? c.mode,
    updatedAt: nowIso(),
  };
  store.cases.set(caseId, updated);
  const { ...summary } = updated;
  return summary;
}

async function softDeleteCaseMemory(caseId: string): Promise<void> {
  const store = getMemoryStore();
  const c = store.cases.get(caseId);
  if (!c || c.deletedAt) return;
  store.cases.set(caseId, { ...c, deletedAt: nowIso(), updatedAt: nowIso() });
}

async function searchCasesMemory(q: string): Promise<CaseSummary[]> {
  const query = q.trim().toLowerCase();
  if (!query) return [];

  const store = getMemoryStore();
  const matchedCaseIds = new Set<string>();

  for (const c of store.cases.values()) {
    if (c.deletedAt) continue;
    if (c.title.toLowerCase().includes(query)) matchedCaseIds.add(c.id);
  }

  for (const m of store.messages.values()) {
    if (m.content.toLowerCase().includes(query)) matchedCaseIds.add(m.caseId);
  }

  const results = [...matchedCaseIds]
    .map((id) => store.cases.get(id))
    .filter(Boolean)
    .filter((c) => c && !c.deletedAt) as (CaseSummary & { deletedAt: string | null })[];

  return results
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 25)
    .map(({ ...summary }) => summary);
}

async function appendMessageMemory(args: {
  caseId: string;
  role: "user" | "assistant";
  content: string;
  language: Language;
}): Promise<ChatMessage> {
  const store = getMemoryStore();
  const id = uuid();
  const ts = nowIso();
  const msg: ChatMessage = {
    id,
    caseId: args.caseId,
    role: args.role,
    content: args.content,
    language: args.language,
    createdAt: ts,
  };
  store.messages.set(id, msg);
  // Touch case
  const c = store.cases.get(args.caseId);
  if (c && !c.deletedAt) {
    store.cases.set(args.caseId, { ...c, updatedAt: ts });
  }
  return msg;
}

async function ensureCaseMemory(input: EnsureCaseInput): Promise<CaseSummary> {
  const store = getMemoryStore();
  const existing = input.caseId ? store.cases.get(input.caseId) : undefined;

  if (existing && !existing.deletedAt) {
    const updated = {
      ...existing,
      inputLanguage: input.inputLanguage,
      languageSource: input.languageSource,
      title: existing.title === "New Case" ? clampTitleSeed(input.titleSeed) : existing.title,
      updatedAt: nowIso(),
    };
    store.cases.set(existing.id, updated);
    const { ...summary } = updated;
    return summary;
  }

  const id = uuid();
  const ts = nowIso();
  const created = {
    id,
    title: clampTitleSeed(input.titleSeed),
    inputLanguage: input.inputLanguage,
    languageSource: input.languageSource,
    mode: "diagnostic" as CaseMode,
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
  };
  store.cases.set(id, created);
  const { ...summary } = created;
  return summary;
}

async function listMessagesForContextMemory(caseId: string, take = 30) {
  const store = getMemoryStore();
  return [...store.messages.values()]
    .filter((m) => m.caseId === caseId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-take)
    .map((m) => ({ role: m.role, content: m.content }));
}

async function listCasesDb(userId?: string): Promise<CaseSummary[]> {
  const prisma = await getPrisma();
  if (!prisma) return listCasesMemory();
  const rows = await prisma.case.findMany({
    where: { 
      deletedAt: null,
      ...(userId ? { userId } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: {
      id: true,
      title: true,
      userId: true,
      inputLanguage: true,
      languageSource: true,
      mode: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return rows.map((r: AnyObj) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

async function createCaseDb(input: CreateCaseInput): Promise<CaseSummary> {
  const prisma = await getPrisma();
  if (!prisma) return createCaseMemory(input);
  const created = await prisma.case.create({
    data: { 
      title: clampTitle(input.title ?? "New Case"),
      userId: input.userId,
    },
    select: {
      id: true,
      title: true,
      userId: true,
      inputLanguage: true,
      languageSource: true,
      mode: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // Track case creation
  if (input.userId) {
    await trackEvent("case.created", input.userId, { caseId: created.id });
  }

  return {
    ...created,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
  };
}

async function getCaseDb(caseId: string, userId?: string): Promise<{ case: CaseSummary | null; messages: ChatMessage[] }> {
  const prisma = await getPrisma();
  if (!prisma) return getCaseMemory(caseId);
  const c = await prisma.case.findFirst({
    where: { 
      id: caseId, 
      deletedAt: null,
      ...(userId ? { userId } : {}),
    },
    select: {
      id: true,
      title: true,
      userId: true,
      inputLanguage: true,
      languageSource: true,
      mode: true,
      createdAt: true,
      updatedAt: true,
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          caseId: true,
          role: true,
          content: true,
          language: true,
          createdAt: true,
        },
      },
    },
  });

  if (!c) return { case: null, messages: [] };

  return {
    case: {
      id: c.id,
      title: c.title,
      userId: c.userId,
      inputLanguage: c.inputLanguage as Language,
      languageSource: c.languageSource as "AUTO" | "MANUAL",
      mode: c.mode as CaseMode,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    },
    messages: c.messages
      .filter((m: unknown) => (m as AnyObj).role === "user" || (m as AnyObj).role === "assistant")
      .map((m: unknown) => ({
        id: (m as AnyObj).id,
        caseId: (m as AnyObj).caseId,
        role: (m as AnyObj).role as "user" | "assistant",
        content: (m as AnyObj).content,
        language: ((m as AnyObj).language ?? c.inputLanguage) as Language,
        createdAt: (m as AnyObj).createdAt.toISOString(),
      })),
  };
}

async function updateCaseDb(caseId: string, input: UpdateCaseInput, userId?: string): Promise<CaseSummary | null> {
  const prisma = await getPrisma();
  if (!prisma) return updateCaseMemory(caseId, input);

  try {
    // First verify ownership if userId is provided
    if (userId) {
      const existing = await prisma.case.findFirst({
        where: { id: caseId, userId, deletedAt: null },
      });
      if (!existing) return null;
    }

    const updated = await prisma.case.update({
      where: { id: caseId },
      data: {
        ...(input.title ? { title: clampTitle(input.title) } : {}),
        ...(input.inputLanguage ? { inputLanguage: input.inputLanguage } : {}),
        ...(input.languageSource ? { languageSource: input.languageSource } : {}),
      },
      select: {
        id: true,
        title: true,
        userId: true,
        inputLanguage: true,
        languageSource: true,
      mode: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  } catch {
    return null;
  }
}

async function softDeleteCaseDb(caseId: string, userId?: string): Promise<void> {
  const prisma = await getPrisma();
  if (!prisma) return softDeleteCaseMemory(caseId);
  
  // Verify ownership if userId is provided
  if (userId) {
    const existing = await prisma.case.findFirst({
      where: { id: caseId, userId, deletedAt: null },
    });
    if (!existing) return;
  }

  await prisma.case.update({
    where: { id: caseId },
    data: { deletedAt: new Date() },
  });
}

async function searchCasesDb(q: string, userId?: string): Promise<CaseSummary[]> {
  const query = q.trim();
  if (!query) return [];

  const prisma = await getPrisma();
  if (!prisma) return searchCasesMemory(query);

  const rows = await prisma.case.findMany({
    where: {
      deletedAt: null,
      ...(userId ? { userId } : {}),
      OR: [
        { title: { contains: query, mode: "insensitive" } },
        { messages: { some: { content: { contains: query, mode: "insensitive" } } } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 25,
    select: {
      id: true,
      title: true,
      userId: true,
      inputLanguage: true,
      languageSource: true,
      mode: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return rows.map((r: AnyObj) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

async function appendMessageDb(args: {
  caseId: string;
  role: "user" | "assistant";
  content: string;
  language: Language;
  userId?: string;
}): Promise<ChatMessage> {
  const prisma = await getPrisma();
  if (!prisma) return appendMessageMemory(args);
  const created = await prisma.message.create({
    data: {
      caseId: args.caseId,
      role: args.role,
      content: args.content,
      language: args.language,
    },
    select: {
      id: true,
      caseId: true,
      role: true,
      content: true,
      language: true,
      createdAt: true,
    },
  });

  // touch case updatedAt
  await prisma.case.update({ where: { id: args.caseId }, data: { updatedAt: new Date() } });

  // Track message sent (only for user messages)
  if (args.role === "user" && args.userId) {
    await trackEvent("message.sent", args.userId, { caseId: args.caseId });
  }

  return {
    id: created.id,
    caseId: created.caseId,
    role: created.role as "user" | "assistant",
    content: created.content,
    language: (created.language ?? args.language) as Language,
    createdAt: created.createdAt.toISOString(),
  };
}

async function ensureCaseDb(input: EnsureCaseInput): Promise<CaseSummary> {
  const prisma = await getPrisma();
  if (!prisma) return ensureCaseMemory(input);

  if (input.caseId) {
    const existing = await prisma.case.findFirst({
      where: { 
        id: input.caseId, 
        deletedAt: null,
        ...(input.userId ? { userId: input.userId } : {}),
      },
      select: { id: true, title: true, userId: true },
    });

    if (existing) {
      const updated = await prisma.case.update({
        where: { id: existing.id },
        data: {
          inputLanguage: input.inputLanguage,
          languageSource: input.languageSource,
          title: existing.title === "New Case" ? clampTitleSeed(input.titleSeed) : existing.title,
        },
        select: {
          id: true,
          title: true,
          userId: true,
          inputLanguage: true,
      mode: true,
          languageSource: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return {
        ...updated,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    }
  }

  const created = await prisma.case.create({
    data: {
      title: clampTitleSeed(input.titleSeed),
      inputLanguage: input.inputLanguage,
      languageSource: input.languageSource,
      userId: input.userId,
    },
    select: {
      id: true,
      title: true,
      userId: true,
      inputLanguage: true,
      languageSource: true,
      mode: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // Track case creation
  if (input.userId) {
    await trackEvent("case.created", input.userId, { caseId: created.id });
  }

  return {
    ...created,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
  };
}

async function listMessagesForContextDb(caseId: string, take = 30) {
  const prisma = await getPrisma();
  if (!prisma) return listMessagesForContextMemory(caseId, take);
  const rows = await prisma.message.findMany({
    where: { caseId },
    orderBy: { createdAt: "asc" },
    take,
    select: { role: true, content: true },
  });

  return rows
    .filter((m: unknown) => (m as AnyObj).role === "user" || (m as AnyObj).role === "assistant")
    .map((m: unknown) => ({ role: (m as AnyObj).role as "user" | "assistant", content: (m as AnyObj).content }));
}

async function hasDb() {
  const prisma = await getPrisma();
  return Boolean(process.env.DATABASE_URL) && prisma !== null;
}

export const storage = {
  hasDb,

  listCases: (userId?: string) => listCasesDb(userId),
  createCase: (input: CreateCaseInput) => createCaseDb(input),
  getCase: (caseId: string, userId?: string) => getCaseDb(caseId, userId),
  updateCase: (caseId: string, input: UpdateCaseInput, userId?: string) => updateCaseDb(caseId, input, userId),
  softDeleteCase: (caseId: string, userId?: string) => softDeleteCaseDb(caseId, userId),
  searchCases: (q: string, userId?: string) => searchCasesDb(q, userId),
  appendMessage: (args: {
    caseId: string;
    role: "user" | "assistant";
    content: string;
    language: Language;
    userId?: string;
  }) => appendMessageDb(args),
  ensureCase: (input: EnsureCaseInput) => ensureCaseDb(input),
  listMessagesForContext: (caseId: string, take = 30) => listMessagesForContextDb(caseId, take),

  inferLanguageForMessage: (message: string, mode: "AUTO" | Language) => {
    const detected = detectLanguage(message);
    const language = mode === "AUTO" ? detected.language : mode;
    const languageSource = mode === "AUTO" ? ("AUTO" as const) : ("MANUAL" as const);
    const confidence = mode === "AUTO" ? detected.confidence : 1;
    return { language, languageSource, confidence };
  },
};
