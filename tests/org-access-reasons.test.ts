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
      Promise.resolve({ uid: "test_uid", email: "test@company.com", user_id: "test_uid" })
    ),
  })),
}));

// Mock dev flags
vi.mock("@/lib/dev-flags", () => ({
  isDevBypassDomainGatingEnabled: vi.fn(() => false),
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

describe("GET /api/auth/me - Access Reason Codes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.REQUIRE_SUBSCRIPTION = "true";
  });

  describe("not_a_member reason", () => {
    it("should return not_a_member when org exists but user is not a member", async () => {
      vi.resetModules();

      // Mock: org exists for domain but no membership
      vi.doMock("@/lib/firestore", () => ({
        getMemberByUid: vi.fn(() => Promise.resolve(null)),
        getMemberByEmail: vi.fn(() => Promise.resolve(null)),
        getOrganization: vi.fn(() => Promise.resolve(null)),
        getOrganizationByDomain: vi.fn(() =>
          Promise.resolve({
            id: "org_123",
            name: "Existing Org",
            domains: ["company.com"],
            subscriptionStatus: "active",
            seatLimit: 10,
            activeSeatCount: 5,
          })
        ),
        getEmailDomain: vi.fn(() => "company.com"),
        isPersonalDomain: vi.fn(() => false),
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
            Promise.resolve({ uid: "new_user_uid", email: "newuser@company.com", user_id: "new_user_uid" })
          ),
        })),
      }));

      const { GET } = await import("@/app/api/auth/me/route");

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.access.allowed).toBe(false);
      expect(data.access.reason).toBe("not_a_member");
      expect(data.access.canCreateOrg).toBe(false);
    });
  });

  describe("no_organization reason", () => {
    it("should return no_organization with canCreateOrg=true when no org exists for domain", async () => {
      vi.resetModules();

      // Mock: no org exists for domain
      vi.doMock("@/lib/firestore", () => ({
        getMemberByUid: vi.fn(() => Promise.resolve(null)),
        getMemberByEmail: vi.fn(() => Promise.resolve(null)),
        getOrganization: vi.fn(() => Promise.resolve(null)),
        getOrganizationByDomain: vi.fn(() => Promise.resolve(null)),
        getEmailDomain: vi.fn(() => "newcompany.com"),
        isPersonalDomain: vi.fn(() => false),
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
            Promise.resolve({ uid: "new_user_uid", email: "user@newcompany.com", user_id: "new_user_uid" })
          ),
        })),
      }));

      const { GET } = await import("@/app/api/auth/me/route");

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.access.allowed).toBe(false);
      expect(data.access.reason).toBe("no_organization");
      expect(data.access.canCreateOrg).toBe(true);
    });
  });

  describe("blocked_domain reason", () => {
    it("should return blocked_domain for personal email domains", async () => {
      vi.resetModules();

      vi.doMock("@/lib/firestore", () => ({
        getMemberByUid: vi.fn(() => Promise.resolve(null)),
        getMemberByEmail: vi.fn(() => Promise.resolve(null)),
        getOrganization: vi.fn(() => Promise.resolve(null)),
        getOrganizationByDomain: vi.fn(() => Promise.resolve(null)),
        getEmailDomain: vi.fn(() => "gmail.com"),
        isPersonalDomain: vi.fn(() => true),
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
            Promise.resolve({ uid: "personal_uid", email: "user@gmail.com", user_id: "personal_uid" })
          ),
        })),
      }));

      const { GET } = await import("@/app/api/auth/me/route");

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.access.allowed).toBe(false);
      expect(data.access.reason).toBe("blocked_domain");
    });
  });

  describe("seat_limit_exceeded reason", () => {
    it("should return seat_limit_exceeded when org exceeds seats", async () => {
      vi.resetModules();

      vi.doMock("@/lib/firestore", () => ({
        getMemberByUid: vi.fn(() =>
          Promise.resolve({
            id: "member_123",
            orgId: "org_123",
            uid: "test_uid",
            email: "user@company.com",
            role: "member",
            status: "active",
          })
        ),
        getMemberByEmail: vi.fn(() => Promise.resolve(null)),
        getOrganization: vi.fn(() =>
          Promise.resolve({
            id: "org_123",
            name: "Test Org",
            domains: ["company.com"],
            subscriptionStatus: "active",
            seatLimit: 5,
            activeSeatCount: 10, // Exceeds limit
          })
        ),
        getOrganizationByDomain: vi.fn(() => Promise.resolve(null)),
        getEmailDomain: vi.fn(() => "company.com"),
        isPersonalDomain: vi.fn(() => false),
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
            Promise.resolve({ uid: "test_uid", email: "user@company.com", user_id: "test_uid" })
          ),
        })),
      }));

      const { GET } = await import("@/app/api/auth/me/route");

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.access.allowed).toBe(false);
      expect(data.access.reason).toBe("seat_limit_exceeded");
    });
  });

  describe("subscription_required reason", () => {
    it("should return subscription_required when org subscription is inactive", async () => {
      vi.resetModules();

      vi.doMock("@/lib/firestore", () => ({
        getMemberByUid: vi.fn(() =>
          Promise.resolve({
            id: "member_123",
            orgId: "org_123",
            uid: "test_uid",
            email: "user@company.com",
            role: "admin",
            status: "active",
          })
        ),
        getMemberByEmail: vi.fn(() => Promise.resolve(null)),
        getOrganization: vi.fn(() =>
          Promise.resolve({
            id: "org_123",
            name: "Test Org",
            domains: ["company.com"],
            subscriptionStatus: "none", // Inactive
            seatLimit: 5,
            activeSeatCount: 1,
          })
        ),
        getOrganizationByDomain: vi.fn(() => Promise.resolve(null)),
        getEmailDomain: vi.fn(() => "company.com"),
        isPersonalDomain: vi.fn(() => false),
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
            Promise.resolve({ uid: "test_uid", email: "user@company.com", user_id: "test_uid" })
          ),
        })),
      }));

      const { GET } = await import("@/app/api/auth/me/route");

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.access.allowed).toBe(false);
      expect(data.access.reason).toBe("subscription_required");
      expect(data.access.isAdmin).toBe(true);
    });
  });

  describe("access allowed", () => {
    it("should allow access for active member with active subscription", async () => {
      vi.resetModules();

      vi.doMock("@/lib/firestore", () => ({
        getMemberByUid: vi.fn(() =>
          Promise.resolve({
            id: "member_123",
            orgId: "org_123",
            uid: "test_uid",
            email: "user@company.com",
            role: "member",
            status: "active",
          })
        ),
        getMemberByEmail: vi.fn(() => Promise.resolve(null)),
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
        getOrganizationByDomain: vi.fn(() => Promise.resolve(null)),
        getEmailDomain: vi.fn(() => "company.com"),
        isPersonalDomain: vi.fn(() => false),
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
            Promise.resolve({ uid: "test_uid", email: "user@company.com", user_id: "test_uid" })
          ),
        })),
      }));

      const { GET } = await import("@/app/api/auth/me/route");

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.access.allowed).toBe(true);
      expect(data.membership.role).toBe("member");
      expect(data.organization.name).toBe("Test Org");
    });
  });
});
