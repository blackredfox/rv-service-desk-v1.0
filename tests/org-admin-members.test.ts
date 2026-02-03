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
        })),
        where: vi.fn(() => ({
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

describe("Admin Members API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("GET /api/org/members", () => {
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

      const { GET } = await import("@/app/api/org/members/route");

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

      const { GET } = await import("@/app/api/org/members/route");

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

      const { GET } = await import("@/app/api/org/members/route");

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Only admins can view members");
    });
  });

  describe("POST /api/org/members - Add member", () => {
    it("should add member with active status", async () => {
      vi.resetModules();

      const mockCreateMember = vi.fn(() =>
        Promise.resolve({
          id: "new_member_123",
          orgId: "org_123",
          uid: "pending_123",
          email: "newuser@company.com",
          role: "member",
          status: "active",
        })
      );

      vi.doMock("@/lib/firestore", () => ({
        getMemberByUid: vi.fn(() =>
          Promise.resolve({
            id: "admin_member_123",
            orgId: "org_123",
            uid: "admin_uid",
            email: "admin@company.com",
            role: "admin",
            status: "active",
          })
        ),
        getOrganization: vi.fn(() =>
          Promise.resolve({
            id: "org_123",
            name: "Test Org",
            domains: ["company.com"],
            subscriptionStatus: "active",
            seatLimit: 10,
            activeSeatCount: 5,
          })
        ),
        getOrgMembers: vi.fn(() => Promise.resolve([])),
        createMember: mockCreateMember,
        recalculateActiveSeatCount: vi.fn(() => Promise.resolve(6)),
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

      const { POST } = await import("@/app/api/org/members/route");

      const req = new Request("http://localhost/api/org/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "newuser@company.com", role: "member" }),
      });

      const response = await POST(req);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.member.status).toBe("active");
      expect(data.member.email).toBe("newuser@company.com");

      // Verify createMember was called with status: "active"
      expect(mockCreateMember).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "newuser@company.com",
          role: "member",
          status: "active",
        })
      );
    });

    it("should reject if subscription inactive", async () => {
      vi.resetModules();

      vi.doMock("@/lib/firestore", () => ({
        getMemberByUid: vi.fn(() =>
          Promise.resolve({
            id: "admin_member_123",
            orgId: "org_123",
            uid: "admin_uid",
            email: "admin@company.com",
            role: "admin",
            status: "active",
          })
        ),
        getOrganization: vi.fn(() =>
          Promise.resolve({
            id: "org_123",
            name: "Test Org",
            domains: ["company.com"],
            subscriptionStatus: "none", // Inactive
            seatLimit: 10,
            activeSeatCount: 5,
          })
        ),
        getOrgMembers: vi.fn(() => Promise.resolve([])),
        createMember: vi.fn(),
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

      const { POST } = await import("@/app/api/org/members/route");

      const req = new Request("http://localhost/api/org/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "newuser@company.com" }),
      });

      const response = await POST(req);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toContain("Subscription inactive");
    });

    it("should reject if seat limit reached", async () => {
      vi.resetModules();

      vi.doMock("@/lib/firestore", () => ({
        getMemberByUid: vi.fn(() =>
          Promise.resolve({
            id: "admin_member_123",
            orgId: "org_123",
            uid: "admin_uid",
            email: "admin@company.com",
            role: "admin",
            status: "active",
          })
        ),
        getOrganization: vi.fn(() =>
          Promise.resolve({
            id: "org_123",
            name: "Test Org",
            domains: ["company.com"],
            subscriptionStatus: "active",
            seatLimit: 5,
            activeSeatCount: 5, // At limit
          })
        ),
        getOrgMembers: vi.fn(() => Promise.resolve([])),
        createMember: vi.fn(),
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

      const { POST } = await import("@/app/api/org/members/route");

      const req = new Request("http://localhost/api/org/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "newuser@company.com" }),
      });

      const response = await POST(req);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toContain("Seat limit");
    });

    it("should reject email from wrong domain", async () => {
      vi.resetModules();

      vi.doMock("@/lib/firestore", () => ({
        getMemberByUid: vi.fn(() =>
          Promise.resolve({
            id: "admin_member_123",
            orgId: "org_123",
            uid: "admin_uid",
            email: "admin@company.com",
            role: "admin",
            status: "active",
          })
        ),
        getOrganization: vi.fn(() =>
          Promise.resolve({
            id: "org_123",
            name: "Test Org",
            domains: ["company.com"],
            subscriptionStatus: "active",
            seatLimit: 10,
            activeSeatCount: 5,
          })
        ),
        getOrgMembers: vi.fn(() => Promise.resolve([])),
        createMember: vi.fn(),
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

      const { POST } = await import("@/app/api/org/members/route");

      const req = new Request("http://localhost/api/org/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "user@otherdomain.com" }),
      });

      const response = await POST(req);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("domain must be");
    });
  });

  describe("PATCH /api/org/members - Update member", () => {
    it("should prevent demoting last admin", async () => {
      vi.resetModules();

      vi.doMock("@/lib/firestore", () => ({
        getMemberByUid: vi.fn(() =>
          Promise.resolve({
            id: "admin_member_123",
            orgId: "org_123",
            uid: "admin_uid",
            email: "admin@company.com",
            role: "admin",
            status: "active",
          })
        ),
        getOrganization: vi.fn(() =>
          Promise.resolve({
            id: "org_123",
            name: "Test Org",
            domains: ["company.com"],
            subscriptionStatus: "active",
            seatLimit: 10,
            activeSeatCount: 2,
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
            },
            {
              id: "target_member_456",
              orgId: "org_123",
              uid: "target_uid",
              email: "other_admin@company.com",
              role: "admin",
              status: "active",
            },
          ])
        ),
        updateMember: vi.fn(),
        recalculateActiveSeatCount: vi.fn(),
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

      // First test: demoting when there's only 1 admin
      const { PATCH } = await import("@/app/api/org/members/route");

      // Reset to have only 1 admin
      vi.doMock("@/lib/firestore", () => ({
        getMemberByUid: vi.fn(() =>
          Promise.resolve({
            id: "admin_member_123",
            orgId: "org_123",
            uid: "admin_uid",
            email: "admin@company.com",
            role: "admin",
            status: "active",
          })
        ),
        getOrganization: vi.fn(() =>
          Promise.resolve({
            id: "org_123",
            name: "Test Org",
            domains: ["company.com"],
            subscriptionStatus: "active",
            seatLimit: 10,
            activeSeatCount: 2,
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
            },
            {
              id: "member_456",
              orgId: "org_123",
              uid: "member_uid",
              email: "member@company.com",
              role: "member",
              status: "active",
            },
          ])
        ),
        updateMember: vi.fn(),
        recalculateActiveSeatCount: vi.fn(),
      }));

      vi.resetModules();

      const { PATCH: PATCH2 } = await import("@/app/api/org/members/route");

      const req = new Request("http://localhost/api/org/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: "admin_member_123", role: "member" }),
      });

      const response = await PATCH2(req);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toContain("last admin");
    });

    it("should allow deactivating non-admin member", async () => {
      vi.resetModules();

      const mockUpdateMember = vi.fn(() => Promise.resolve());

      vi.doMock("@/lib/firestore", () => ({
        getMemberByUid: vi.fn(() =>
          Promise.resolve({
            id: "admin_member_123",
            orgId: "org_123",
            uid: "admin_uid",
            email: "admin@company.com",
            role: "admin",
            status: "active",
          })
        ),
        getOrganization: vi.fn(() =>
          Promise.resolve({
            id: "org_123",
            name: "Test Org",
            domains: ["company.com"],
            subscriptionStatus: "active",
            seatLimit: 10,
            activeSeatCount: 2,
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
            },
            {
              id: "member_456",
              orgId: "org_123",
              uid: "member_uid",
              email: "member@company.com",
              role: "member",
              status: "active",
            },
          ])
        ),
        updateMember: mockUpdateMember,
        recalculateActiveSeatCount: vi.fn(() => Promise.resolve(1)),
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

      const { PATCH } = await import("@/app/api/org/members/route");

      const req = new Request("http://localhost/api/org/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: "member_456", status: "inactive" }),
      });

      const response = await PATCH(req);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockUpdateMember).toHaveBeenCalledWith("member_456", { status: "inactive" });
    });
  });
});
