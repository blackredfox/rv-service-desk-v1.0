import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Firebase Admin
vi.mock("@/lib/firebase-admin", () => ({
  getFirebaseAdmin: vi.fn(() => ({
    firestore: vi.fn(() => ({
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({
          set: vi.fn(),
          get: vi.fn(() => Promise.resolve({ exists: true, data: () => ({}) })),
          update: vi.fn(),
          collection: vi.fn(() => ({
            where: vi.fn(() => ({
              get: vi.fn(() => Promise.resolve({ size: 0, docs: [] })),
            })),
          })),
        })),
        where: vi.fn(() => ({
          where: vi.fn(() => ({
            get: vi.fn(() => Promise.resolve({ size: 0, docs: [] })),
          })),
          orderBy: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn(() => ({
                get: vi.fn(() => Promise.resolve({ empty: true, docs: [] })),
              })),
            })),
          })),
          limit: vi.fn(() => ({
            get: vi.fn(() => Promise.resolve({ empty: true, docs: [] })),
          })),
          get: vi.fn(() => Promise.resolve({ size: 0, docs: [] })),
        })),
      })),
    })),
  })),
  getFirebaseAuth: vi.fn(() => ({
    verifySessionCookie: vi.fn(() =>
      Promise.resolve({ uid: "admin_uid", email: "admin@company.com" })
    ),
  })),
}));

// Default cookies mock
vi.mock("next/headers", () => ({
  cookies: vi.fn(() =>
    Promise.resolve({
      get: vi.fn((name: string) => {
        if (name === "rv_session") return { value: "test_session_cookie" };
        return undefined;
      }),
      set: vi.fn(),
      delete: vi.fn(),
    })
  ),
}));

describe("Team Activity API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("GET /api/org/activity", () => {
    it("should return 401 if not authenticated", async () => {
      vi.resetModules();

      vi.doMock("next/headers", () => ({
        cookies: vi.fn(() =>
          Promise.resolve({
            get: vi.fn(() => undefined),
            set: vi.fn(),
            delete: vi.fn(),
          })
        ),
      }));

      const { GET } = await import("@/app/api/org/activity/route");

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Not authenticated");
    });

    it("should return 403 if user is not a member", async () => {
      vi.resetModules();

      vi.doMock("@/lib/firestore", () => ({
        getMemberByUid: vi.fn(() => Promise.resolve(null)),
        getOrgMembers: vi.fn(() => Promise.resolve([])),
        getFirestore: vi.fn(() => ({
          collection: vi.fn(() => ({})),
        })),
      }));

      vi.doMock("next/headers", () => ({
        cookies: vi.fn(() =>
          Promise.resolve({
            get: vi.fn((name: string) => {
              if (name === "rv_session") return { value: "test_session" };
              return undefined;
            }),
            set: vi.fn(),
            delete: vi.fn(),
          })
        ),
      }));

      vi.doMock("@/lib/firebase-admin", () => ({
        getFirebaseAuth: vi.fn(() => ({
          verifySessionCookie: vi.fn(() =>
            Promise.resolve({ uid: "nonmember_uid", email: "nonmember@company.com" })
          ),
        })),
      }));

      const { GET } = await import("@/app/api/org/activity/route");

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Not a member of any organization");
    });

    it("should return 403 if user is not admin", async () => {
      vi.resetModules();

      vi.doMock("@/lib/firestore", () => ({
        getMemberByUid: vi.fn(() =>
          Promise.resolve({
            id: "member_123",
            orgId: "org_123",
            uid: "member_uid",
            email: "member@company.com",
            role: "member", // Not admin
            status: "active",
          })
        ),
        getOrgMembers: vi.fn(() => Promise.resolve([])),
        getFirestore: vi.fn(() => ({
          collection: vi.fn(() => ({})),
        })),
      }));

      vi.doMock("next/headers", () => ({
        cookies: vi.fn(() =>
          Promise.resolve({
            get: vi.fn((name: string) => {
              if (name === "rv_session") return { value: "test_session" };
              return undefined;
            }),
            set: vi.fn(),
            delete: vi.fn(),
          })
        ),
      }));

      vi.doMock("@/lib/firebase-admin", () => ({
        getFirebaseAuth: vi.fn(() => ({
          verifySessionCookie: vi.fn(() =>
            Promise.resolve({ uid: "member_uid", email: "member@company.com" })
          ),
        })),
      }));

      const { GET } = await import("@/app/api/org/activity/route");

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Only admins can view activity");
    });

    it("should return activity data for admin", async () => {
      vi.resetModules();

      const mockFirestore = {
        collection: vi.fn(() => ({
          where: vi.fn(() => ({
            where: vi.fn(() => ({
              get: vi.fn(() => Promise.resolve({ size: 0, docs: [] })),
            })),
            orderBy: vi.fn(() => ({
              orderBy: vi.fn(() => ({
                limit: vi.fn(() => ({
                  get: vi.fn(() => Promise.resolve({ empty: true, docs: [] })),
                })),
              })),
            })),
            get: vi.fn(() => Promise.resolve({ size: 0, docs: [] })),
          })),
        })),
      };

      vi.doMock("@/lib/firestore", () => ({
        getMemberByUid: vi.fn(() =>
          Promise.resolve({
            id: "admin_member_123",
            orgId: "org_123",
            uid: "admin_uid",
            email: "admin@company.com",
            role: "admin",
            status: "active",
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-15T00:00:00.000Z",
          })
        ),
        getOrgMembers: vi.fn(() =>
          Promise.resolve([
            {
              id: "admin_member_123",
              orgId: "org_123",
              uid: "admin_uid",
              email: "admin@company.com",
              role: "admin",
              status: "active",
              createdAt: "2024-01-01T00:00:00.000Z",
              updatedAt: "2024-01-15T00:00:00.000Z",
            },
            {
              id: "member_456",
              orgId: "org_123",
              uid: "member_uid",
              email: "member@company.com",
              role: "member",
              status: "active",
              createdAt: "2024-01-05T00:00:00.000Z",
              updatedAt: null,
            },
          ])
        ),
        getFirestore: vi.fn(() => mockFirestore),
      }));

      vi.doMock("next/headers", () => ({
        cookies: vi.fn(() =>
          Promise.resolve({
            get: vi.fn((name: string) => {
              if (name === "rv_session") return { value: "test_session" };
              return undefined;
            }),
            set: vi.fn(),
            delete: vi.fn(),
          })
        ),
      }));

      vi.doMock("@/lib/firebase-admin", () => ({
        getFirebaseAuth: vi.fn(() => ({
          verifySessionCookie: vi.fn(() =>
            Promise.resolve({ uid: "admin_uid", email: "admin@company.com" })
          ),
        })),
      }));

      const { GET } = await import("@/app/api/org/activity/route");

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.activity).toBeDefined();
      expect(Array.isArray(data.activity)).toBe(true);
      expect(data.activity.length).toBe(2);
      
      // Check structure
      const firstMember = data.activity[0];
      expect(firstMember).toHaveProperty("memberId");
      expect(firstMember).toHaveProperty("email");
      expect(firstMember).toHaveProperty("role");
      expect(firstMember).toHaveProperty("status");
      expect(firstMember).toHaveProperty("lastLoginAt");
      expect(firstMember).toHaveProperty("casesLast7Days");
      expect(firstMember).toHaveProperty("casesLast30Days");
      expect(firstMember).toHaveProperty("totalMessages");
    });
  });
});
