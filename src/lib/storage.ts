import { getPrisma } from "@/lib/db";
import { detectLanguage, type Language } from "@/lib/lang";

export type CaseSummary = {
  id: string;
  title: string;
  inputLanguage: Language;
  languageSource: "AUTO" | "MANUAL";
  createdAt: string;
  updatedAt: string;
};

export type ChatMessage = {
  id: string;
  caseId: string;
  role: "user" | "assistant";
  content: string;
  language: Language;
  createdAt: string;
};

type CreateCaseInput = { title?: string };

type EnsureCaseInput = {
  caseId?: string;
  titleSeed: string;
  inputLanguage: Language;
  languageSource: "AUTO" | "MANUAL";
};

type UpdateCaseInput = {
  title?: string;
  inputLanguage?: Language;
  languageSource?: "AUTO" | "MANUAL";
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
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 50)
    .map(({ ...rest }) => rest);
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

async function listCasesDb(): Promise<CaseSummary[]> {
  const rows = await prisma!.case.findMany({
    where: { deletedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: {
      id: true,
      title: true,
      inputLanguage: true,
      languageSource: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

async function createCaseDb(input: CreateCaseInput): Promise<CaseSummary> {
  const created = await prisma!.case.create({
    data: { title: clampTitle(input.title ?? "New Case") },
    select: {
      id: true,
      title: true,
      inputLanguage: true,
      languageSource: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return {
    ...created,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
  };
}

async function getCaseDb(caseId: string): Promise<{ case: CaseSummary | null; messages: ChatMessage[] }> {
  const c = await prisma!.case.findFirst({
    where: { id: caseId, deletedAt: null },
    select: {
      id: true,
      title: true,
      inputLanguage: true,
      languageSource: true,
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
      inputLanguage: c.inputLanguage as Language,
      languageSource: c.languageSource as "AUTO" | "MANUAL", 
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    },
    messages: c.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        id: m.id,
        caseId: m.caseId,
        role: m.role as "user" | "assistant",
        content: m.content,
        language: (m.language ?? c.inputLanguage) as Language,
        createdAt: m.createdAt.toISOString(),
      })),
  };
}

async function updateCaseDb(caseId: string, input: UpdateCaseInput): Promise<CaseSummary | null> {
  try {
    const updated = await prisma!.case.update({
      where: { id: caseId },
      data: {
        ...(input.title ? { title: clampTitle(input.title) } : {}),
        ...(input.inputLanguage ? { inputLanguage: input.inputLanguage } : {}),
        ...(input.languageSource ? { languageSource: input.languageSource } : {}),
      },
      select: {
        id: true,
        title: true,
        inputLanguage: true,
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
  } catch {
    return null;
  }
}

async function softDeleteCaseDb(caseId: string): Promise<void> {
  await prisma!.case.update({
    where: { id: caseId },
    data: { deletedAt: new Date() },
  });
}

async function searchCasesDb(q: string): Promise<CaseSummary[]> {
  const query = q.trim();
  if (!query) return [];

  const rows = await prisma!.case.findMany({
    where: {
      deletedAt: null,
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
      inputLanguage: true,
      languageSource: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return rows.map((r) => ({
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
}): Promise<ChatMessage> {
  const created = await prisma!.message.create({
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
  await prisma!.case.update({ where: { id: args.caseId }, data: { updatedAt: new Date() } });

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
  if (input.caseId) {
    const existing = await prisma!.case.findFirst({
      where: { id: input.caseId, deletedAt: null },
      select: { id: true, title: true },
    });

    if (existing) {
      const updated = await prisma!.case.update({
        where: { id: existing.id },
        data: {
          inputLanguage: input.inputLanguage,
          languageSource: input.languageSource,
          title: existing.title === "New Case" ? clampTitleSeed(input.titleSeed) : existing.title,
        },
        select: {
          id: true,
          title: true,
          inputLanguage: true,
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

  const created = await prisma!.case.create({
    data: {
      title: clampTitleSeed(input.titleSeed),
      inputLanguage: input.inputLanguage,
      languageSource: input.languageSource,
    },
    select: {
      id: true,
      title: true,
      inputLanguage: true,
      languageSource: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return {
    ...created,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
  };
}

async function listMessagesForContextDb(caseId: string, take = 30) {
  const rows = await prisma!.message.findMany({
    where: { caseId },
    orderBy: { createdAt: "asc" },
    take,
    select: { role: true, content: true },
  });

  return rows
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
}

function hasDb() {
  return Boolean(process.env.DATABASE_URL) && prisma !== null;
}

export const storage = {
  hasDb,

  listCases: () => (hasDb() ? listCasesDb() : listCasesMemory()),
  createCase: (input: CreateCaseInput) => (hasDb() ? createCaseDb(input) : createCaseMemory(input)),
  getCase: (caseId: string) => (hasDb() ? getCaseDb(caseId) : getCaseMemory(caseId)),
  updateCase: (caseId: string, input: UpdateCaseInput) =>
    (hasDb() ? updateCaseDb(caseId, input) : updateCaseMemory(caseId, input)),
  softDeleteCase: (caseId: string) => (hasDb() ? softDeleteCaseDb(caseId) : softDeleteCaseMemory(caseId)),
  searchCases: (q: string) => (hasDb() ? searchCasesDb(q) : searchCasesMemory(q)),
  appendMessage: (args: {
    caseId: string;
    role: "user" | "assistant";
    content: string;
    language: Language;
  }) => (hasDb() ? appendMessageDb(args) : appendMessageMemory(args)),
  ensureCase: (input: EnsureCaseInput) => (hasDb() ? ensureCaseDb(input) : ensureCaseMemory(input)),
  listMessagesForContext: (caseId: string, take = 30) =>
    (hasDb() ? listMessagesForContextDb(caseId, take) : listMessagesForContextMemory(caseId, take)),

  inferLanguageForMessage: (message: string, mode: "AUTO" | Language) => {
    const detected = detectLanguage(message);
    const language = mode === "AUTO" ? detected.language : mode;
    const languageSource = mode === "AUTO" ? ("AUTO" as const) : ("MANUAL" as const);
    const confidence = mode === "AUTO" ? detected.confidence : 1;
    return { language, languageSource, confidence };
  },
};
