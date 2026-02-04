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
      Promise.resolve({ uid: "new_user_uid", email: "member@company.com", user_id: "new_user_uid" })
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

describe("Member Claim on First Sign-Up", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.REQUIRE_SUBSCRIPTION = "true";
  });

  describe("Happy path: pre-added member claims access", () => {
    it("should allow pre-added member to claim membership on first sign-up", async () => {
      vi.resetModules();

      const mockUpdateMember = vi.fn(() => Promise.resolve());

      // Mock: member exists by email with placeholder UID, but not by real UID
      vi.doMock("@/lib/firestore", () => ({
        getMemberByUid: vi.fn(() => Promise.resolve(null)), // Not found by UID
        getMemberByEmail: vi.fn(() =>
          Promise.resolve({
            id: "member_123",
            orgId: "org_123",
            uid: "pending_1234567890", // Placeholder UID from admin add
            email: "member@company.com",
            role: "member",
            status: "active",
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
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
        getOrganizationByDomain: vi.fn(() => Promise.resolve(null)),
        getEmailDomain: vi.fn(() => "company.com"),
        isPersonalDomain: vi.fn(() => false),
        updateMember: mockUpdateMember,
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
            Promise.resolve({ uid: "new_user_uid", email: "member@company.com", user_id: "new_user_uid" })
          ),
        })),
      }));

      const { GET } = await import("@/app/api/auth/me/route");

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.access.allowed).toBe(true);
      expect(data.membership.role).toBe("member");
      
      // Verify updateMember was called to claim the membership
      expect(mockUpdateMember).toHaveBeenCalledWith("member_123", { uid: "new_user_uid" });
    });
  });

  describe("Inactive member stays blocked", () => {
    it("should block inactive pre-added member with correct message", async () => {
      vi.resetModules();

      const mockUpdateMember = vi.fn(() => Promise.resolve());

      vi.doMock("@/lib/firestore", () => ({
        getMemberByUid: vi.fn(() => Promise.resolve(null)),
        getMemberByEmail: vi.fn(() =>
          Promise.resolve({
            id: "member_123",
            orgId: "org_123",
            uid: "pending_1234567890",
            email: "member@company.com",
            role: "member",
            status: "inactive", // Inactive status
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
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
        getOrganizationByDomain: vi.fn(() => Promise.resolve(null)),
        getEmailDomain: vi.fn(() => "company.com"),
        isPersonalDomain: vi.fn(() => false),
        updateMember: mockUpdateMember,
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
            Promise.resolve({ uid: "new_user_uid", email: "member@company.com", user_id: "new_user_uid" })
          ),
        })),
      }));

      const { GET } = await import("@/app/api/auth/me/route");

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.access.allowed).toBe(false);
      expect(data.access.reason).toBe("inactive");
      expect(data.access.message).toContain("inactive");
      
      // Still should claim the membership (update UID) even if inactive
      expect(mockUpdateMember).toHaveBeenCalledWith("member_123", { uid: "new_user_uid" });
    });
  });

  describe("Seat limit blocks claim", () => {
    it("should block when seat limit reached", async () => {
      vi.resetModules();

      const mockUpdateMember = vi.fn(() => Promise.resolve());

      vi.doMock("@/lib/firestore", () => ({
        getMemberByUid: vi.fn(() => Promise.resolve(null)),
        getMemberByEmail: vi.fn(() =>
          Promise.resolve({
            id: "member_123",
            orgId: "org_123",
            uid: "pending_1234567890",
            email: "member@company.com",
            role: "member",
            status: "active",
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          })
        ),
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
        updateMember: mockUpdateMember,
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
            Promise.resolve({ uid: "new_user_uid", email: "member@company.com", user_id: "new_user_uid" })
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

  describe("Email not present stays blocked", () => {
    it("should return not_a_member when email not in org members", async () => {
      vi.resetModules();

      vi.doMock("@/lib/firestore", () => ({
        getMemberByUid: vi.fn(() => Promise.resolve(null)),
        getMemberByEmail: vi.fn(() => Promise.resolve(null)), // No member with this email
        getOrganization: vi.fn(() => Promise.resolve(null)),
        getOrganizationByDomain: vi.fn(() =>
          Promise.resolve({
            id: "org_123",
            name: "Test Org",
            domains: ["company.com"],
            subscriptionStatus: "active",
            seatLimit: 10,
            activeSeatCount: 5,
          })
        ), // Org exists for domain
        getEmailDomain: vi.fn(() => "company.com"),
        isPersonalDomain: vi.fn(() => false),
        updateMember: vi.fn(),
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
            Promise.resolve({ uid: "random_uid", email: "random@company.com", user_id: "random_uid" })
          ),
        })),
      }));

      const { GET } = await import("@/app/api/auth/me/route");

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.access.allowed).toBe(false);
      expect(data.access.reason).toBe("not_a_member");
    });
  });

  describe("Security: already claimed email", () => {
    it("should not overwrite UID when email already claimed by another user", async () => {
      vi.resetModules();

      const mockUpdateMember = vi.fn(() => Promise.resolve());

      vi.doMock("@/lib/firestore", () => ({
        getMemberByUid: vi.fn(() => Promise.resolve(null)), // Current user not found by UID
        getMemberByEmail: vi.fn(() =>
          Promise.resolve({
            id: "member_123",
            orgId: "org_123",
            uid: "existing_real_uid", // Not a placeholder - already claimed
            email: "member@company.com",
            role: "member",
            status: "active",
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          })
        ),
        getOrganization: vi.fn(() => Promise.resolve(null)),
        getOrganizationByDomain: vi.fn(() =>
          Promise.resolve({
            id: "org_123",
            name: "Test Org",
            domains: ["company.com"],
            subscriptionStatus: "active",
            seatLimit: 10,
            activeSeatCount: 5,
          })
        ),
        getEmailDomain: vi.fn(() => "company.com"),
        isPersonalDomain: vi.fn(() => false),
        updateMember: mockUpdateMember,
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
            Promise.resolve({ uid: "attacker_uid", email: "member@company.com", user_id: "attacker_uid" })
          ),
        })),
      }));

      const { GET } = await import("@/app/api/auth/me/route");

      const response = await GET();
      const data = await response.json();

      // Should NOT update the member (security check)
      expect(mockUpdateMember).not.toHaveBeenCalled();
      
      // Should return not_a_member since claim failed
      expect(data.access.allowed).toBe(false);
      expect(data.access.reason).toBe("not_a_member");
    });
  });
});
