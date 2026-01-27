import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/lib/storage", () => ({
  storage: {
    listCases: vi.fn(),
    createCase: vi.fn(),
    getCase: vi.fn(),
    updateCase: vi.fn(),
    softDeleteCase: vi.fn(),
  },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => Promise.resolve({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

import { getCurrentUser } from "@/lib/auth";
import { storage } from "@/lib/storage";

describe("Cases API Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/cases", () => {
    it("should list cases for authenticated user", async () => {
      const mockUser = { id: "user_123", email: "test@example.com", plan: "FREE" as const, status: "ACTIVE" as const };
      const mockCases = [
        { id: "case_1", title: "Test Case 1", userId: "user_123" },
        { id: "case_2", title: "Test Case 2", userId: "user_123" },
      ];

      vi.mocked(getCurrentUser).mockResolvedValue(mockUser);
      vi.mocked(storage.listCases).mockResolvedValue(mockCases as never);

      const { GET } = await import("@/app/api/cases/route");

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.cases).toHaveLength(2);
      expect(storage.listCases).toHaveBeenCalledWith("user_123");
    });

    it("should list cases for unauthenticated user (backward compat)", async () => {
      vi.mocked(getCurrentUser).mockResolvedValue(null);
      vi.mocked(storage.listCases).mockResolvedValue([]);

      const { GET } = await import("@/app/api/cases/route");

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.cases).toEqual([]);
      expect(storage.listCases).toHaveBeenCalledWith(undefined);
    });
  });

  describe("POST /api/cases", () => {
    it("should create case with user ownership", async () => {
      const mockUser = { id: "user_123", email: "test@example.com", plan: "FREE" as const, status: "ACTIVE" as const };
      const mockCase = {
        id: "case_new",
        title: "New Case",
        userId: "user_123",
        inputLanguage: "EN",
        languageSource: "AUTO",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      vi.mocked(getCurrentUser).mockResolvedValue(mockUser);
      vi.mocked(storage.createCase).mockResolvedValue(mockCase as never);

      const { POST } = await import("@/app/api/cases/route");

      const req = new Request("http://localhost/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New Case" }),
      });

      const response = await POST(req);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.case.id).toBe("case_new");
      expect(storage.createCase).toHaveBeenCalledWith({
        title: "New Case",
        userId: "user_123",
      });
    });
  });

  describe("GET /api/cases/[id]", () => {
    it("should get case with ownership check", async () => {
      const mockUser = { id: "user_123", email: "test@example.com", plan: "FREE" as const, status: "ACTIVE" as const };
      const mockCase = {
        id: "case_1",
        title: "Test Case",
        userId: "user_123",
      };

      vi.mocked(getCurrentUser).mockResolvedValue(mockUser);
      vi.mocked(storage.getCase).mockResolvedValue({ case: mockCase as never, messages: [] });

      const { GET } = await import("@/app/api/cases/[id]/route");

      const req = new Request("http://localhost/api/cases/case_1");
      const response = await GET(req, { params: Promise.resolve({ id: "case_1" }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.case.id).toBe("case_1");
      expect(storage.getCase).toHaveBeenCalledWith("case_1", "user_123");
    });

    it("should return 404 for non-existent case", async () => {
      const mockUser = { id: "user_123", email: "test@example.com", plan: "FREE" as const, status: "ACTIVE" as const };

      vi.mocked(getCurrentUser).mockResolvedValue(mockUser);
      vi.mocked(storage.getCase).mockResolvedValue({ case: null, messages: [] });

      const { GET } = await import("@/app/api/cases/[id]/route");

      const req = new Request("http://localhost/api/cases/nonexistent");
      const response = await GET(req, { params: Promise.resolve({ id: "nonexistent" }) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Case not found");
    });
  });

  describe("DELETE /api/cases/[id]", () => {
    it("should delete case with ownership check", async () => {
      const mockUser = { id: "user_123", email: "test@example.com", plan: "FREE" as const, status: "ACTIVE" as const };

      vi.mocked(getCurrentUser).mockResolvedValue(mockUser);
      vi.mocked(storage.softDeleteCase).mockResolvedValue(undefined);

      const { DELETE } = await import("@/app/api/cases/[id]/route");

      const req = new Request("http://localhost/api/cases/case_1", { method: "DELETE" });
      const response = await DELETE(req, { params: Promise.resolve({ id: "case_1" }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(storage.softDeleteCase).toHaveBeenCalledWith("case_1", "user_123");
    });
  });
});
