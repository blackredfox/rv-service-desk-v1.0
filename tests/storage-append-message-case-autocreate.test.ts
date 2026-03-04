import { beforeEach, describe, expect, it, vi } from "vitest";

type MockCase = {
  id: string;
  title: string;
  userId: string;
  inputLanguage: "EN" | "RU" | "ES";
  languageSource: "AUTO" | "MANUAL";
  mode: "diagnostic" | "authorization" | "final_report";
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

function buildPrismaMock() {
  const cases = new Map<string, MockCase>();
  const messages: Array<{
    id: string;
    caseId: string;
    role: "user" | "assistant";
    content: string;
    language: "EN" | "RU" | "ES";
    createdAt: Date;
  }> = [];

  const caseApi = {
    findFirst: vi.fn(async ({ where }: { where: { id?: string; userId?: string; deletedAt?: null } }) => {
      if (!where?.id) return null;
      const c = cases.get(where.id);
      if (!c) return null;
      if (where.userId && c.userId !== where.userId) return null;
      if (where.deletedAt === null && c.deletedAt !== null) return null;
      return { id: c.id, title: c.title, userId: c.userId };
    }),
    create: vi.fn(async ({ data }: { data: Partial<MockCase> & { userId: string; title: string; id?: string } }) => {
      const now = new Date();
      const id = data.id ?? `case_${cases.size + 1}`;
      const row: MockCase = {
        id,
        title: data.title,
        userId: data.userId,
        inputLanguage: (data.inputLanguage as MockCase["inputLanguage"]) ?? "EN",
        languageSource: (data.languageSource as MockCase["languageSource"]) ?? "AUTO",
        mode: "diagnostic",
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      cases.set(id, row);
      return row;
    }),
    upsert: vi.fn(async ({ where, create }: { where: { id: string }; create: Partial<MockCase> & { userId: string; title: string; id?: string } }) => {
      const existing = cases.get(where.id);
      if (existing) return existing;
      const now = new Date();
      const row: MockCase = {
        id: where.id,
        title: create.title,
        userId: create.userId,
        inputLanguage: (create.inputLanguage as MockCase["inputLanguage"]) ?? "EN",
        languageSource: (create.languageSource as MockCase["languageSource"]) ?? "AUTO",
        mode: "diagnostic",
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      cases.set(where.id, row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: { updatedAt?: Date } }) => {
      const existing = cases.get(where.id);
      if (!existing) {
        throw new Error("Case not found");
      }
      const updated = {
        ...existing,
        updatedAt: data.updatedAt ?? new Date(),
      };
      cases.set(where.id, updated);
      return updated;
    }),
  };

  const messageApi = {
    create: vi.fn(async ({ data }: { data: { caseId: string; role: "user" | "assistant"; content: string; language: "EN" | "RU" | "ES" } }) => {
      if (!cases.has(data.caseId)) {
        const err = new Error("Foreign key constraint failed") as Error & { code?: string };
        err.code = "P2003";
        throw err;
      }
      const row = {
        id: `msg_${messages.length + 1}`,
        caseId: data.caseId,
        role: data.role,
        content: data.content,
        language: data.language,
        createdAt: new Date(),
      };
      messages.push(row);
      return row;
    }),
  };

  const tx = { case: caseApi, message: messageApi };
  const prisma = {
    case: caseApi,
    message: messageApi,
    $transaction: vi.fn(async (fn: (db: typeof tx) => Promise<unknown>) => fn(tx)),
  };

  return { prisma, cases, messages };
}

describe("storage.appendMessage DB FK guard", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete (globalThis as { __rvServiceDeskMemoryStore?: unknown }).__rvServiceDeskMemoryStore;
  });

  it("new chat flow (caseId null upstream) persists case + first message without FK crash", async () => {
    const { prisma, cases, messages } = buildPrismaMock();

    vi.doMock("@/lib/db", () => ({
      getPrisma: vi.fn(async () => prisma),
    }));

    const trackEvent = vi.fn();
    vi.doMock("@/lib/analytics", () => ({
      trackEvent,
    }));

    const { storage } = await import("@/lib/storage");

    const ensured = await storage.ensureCase({
      caseId: undefined,
      titleSeed: "водяной насос не работает",
      inputLanguage: "RU",
      languageSource: "AUTO",
      userId: "user_123",
    });

    const createdMessage = await storage.appendMessage({
      caseId: ensured.id,
      role: "user",
      content: "водяной насос не работает",
      language: "RU",
      userId: "user_123",
    });

    expect(cases.has(ensured.id)).toBe(true);
    expect(createdMessage.caseId).toBe(ensured.id);
    expect(messages.length).toBe(1);
    expect(trackEvent).toHaveBeenCalledWith("message.sent", "user_123", { caseId: ensured.id });
  });

  it("explicit non-existent caseId is auto-created before message insert", async () => {
    const { prisma, cases, messages } = buildPrismaMock();

    vi.doMock("@/lib/db", () => ({
      getPrisma: vi.fn(async () => prisma),
    }));

    vi.doMock("@/lib/analytics", () => ({
      trackEvent: vi.fn(),
    }));

    const { storage } = await import("@/lib/storage");

    const explicitCaseId = "case_explicit_missing_001";
    const createdMessage = await storage.appendMessage({
      caseId: explicitCaseId,
      role: "user",
      content: "pump does not run",
      language: "EN",
      userId: "user_123",
    });

    expect(createdMessage.caseId).toBe(explicitCaseId);
    expect(cases.has(explicitCaseId)).toBe(true);
    expect(messages).toHaveLength(1);
    expect(prisma.case.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: explicitCaseId },
      })
    );
  });
});
