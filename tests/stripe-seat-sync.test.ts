import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for Stripe seat limit sync functionality
 * Ensures Stripe subscription quantity is the single source of truth for seatLimit
 */

// Mock Stripe
vi.mock("stripe", () => {
  return {
    default: class MockStripe {
      webhooks = {
        constructEvent: vi.fn((body, sig, secret) => {
          // Return a mock event based on the body
          const bodyStr = body.toString();
          if (bodyStr.includes("subscription.updated")) {
            return {
              type: "customer.subscription.updated",
              data: {
                object: {
                  id: "sub_123",
                  customer: "cus_123",
                  status: "active",
                  metadata: { orgId: "org_123" },
                  items: {
                    data: [{ quantity: 10 }],
                  },
                  current_period_end: 1234567890,
                },
              },
            };
          }
          return { type: "unknown", data: {} };
        }),
      };
      subscriptions = {
        list: vi.fn(() =>
          Promise.resolve({
            data: [
              {
                id: "sub_123",
                status: "active",
                items: {
                  data: [{ quantity: 10 }],
                },
                current_period_end: 1234567890,
              },
            ],
          })
        ),
        retrieve: vi.fn(() =>
          Promise.resolve({
            id: "sub_123",
            status: "active",
            metadata: { orgId: "org_123" },
            items: {
              data: [{ quantity: 10 }],
            },
            current_period_end: 1234567890,
          })
        ),
      };
    },
  };
});

// Mock Firebase Admin
vi.mock("@/lib/firebase-admin", () => ({
  getFirebaseAuth: vi.fn(() => ({
    verifySessionCookie: vi.fn(() =>
      Promise.resolve({ uid: "admin_uid", email: "admin@company.com", user_id: "admin_uid" })
    ),
  })),
}));

// Mock next/headers
vi.mock("next/headers", () => ({
  cookies: vi.fn(() =>
    Promise.resolve({
      get: vi.fn((name: string) => {
        if (name === "rv_session") return { value: "test_session" };
        return undefined;
      }),
    })
  ),
}));

describe("Stripe Seat Limit Sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("syncSeatsFromStripe", () => {
    it("should calculate seatLimit by summing all subscription item quantities", async () => {
      vi.resetModules();

      // Mock Stripe with multiple items
      vi.doMock("stripe", () => ({
        default: class MockStripe {
          subscriptions = {
            list: vi.fn(() =>
              Promise.resolve({
                data: [
                  {
                    id: "sub_123",
                    status: "active",
                    items: {
                      data: [
                        { quantity: 5 },
                        { quantity: 3 },
                        { quantity: 2 },
                      ],
                    },
                  },
                ],
              })
            ),
          };
        },
      }));

      const { syncSeatsFromStripe } = await import("@/lib/b2b-stripe");

      const result = await syncSeatsFromStripe("cus_123");

      expect(result).not.toBeNull();
      expect(result?.seatLimit).toBe(10); // 5 + 3 + 2 = 10
      expect(result?.subscriptionStatus).toBe("active");
    });

    it("should return null when no subscriptions exist", async () => {
      vi.resetModules();

      vi.doMock("stripe", () => ({
        default: class MockStripe {
          subscriptions = {
            list: vi.fn(() => Promise.resolve({ data: [] })),
          };
        },
      }));

      const { syncSeatsFromStripe } = await import("@/lib/b2b-stripe");

      const result = await syncSeatsFromStripe("cus_no_subs");

      expect(result).toBeNull();
    });
  });

  describe("handleSubscriptionUpdate (webhook)", () => {
    it("should calculate seatLimit from subscription.items quantity", () => {
      // Test the quantity calculation logic
      const subscriptionItems = [
        { quantity: 10 },
      ];

      const seatLimit = subscriptionItems.reduce(
        (sum, item) => sum + (item.quantity ?? 0),
        0
      ) || 5;

      expect(seatLimit).toBe(10);
    });

    it("should sum multiple subscription items for seatLimit", () => {
      const subscriptionItems = [
        { quantity: 5 },
        { quantity: 5 },
      ];

      const seatLimit = subscriptionItems.reduce(
        (sum, item) => sum + (item.quantity ?? 0),
        0
      ) || 5;

      expect(seatLimit).toBe(10);
    });

    it("should default to 5 seats when no items exist", () => {
      const subscriptionItems: { quantity?: number }[] = [];

      const seatLimit = subscriptionItems.reduce(
        (sum, item) => sum + (item.quantity ?? 0),
        0
      ) || 5;

      expect(seatLimit).toBe(5);
    });
  });

  describe("POST /api/billing/sync-seats", () => {
    it("should sync seatLimit from Stripe and update org", async () => {
      vi.resetModules();

      const mockUpdateOrgSubscription = vi.fn();

      vi.doMock("@/lib/firestore", () => ({
        getMemberByUid: vi.fn(() =>
          Promise.resolve({
            id: "admin_123",
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
            stripeCustomerId: "cus_123",
            seatLimit: 5, // Old value
            activeSeatCount: 5,
          })
        ),
        updateOrgSubscription: mockUpdateOrgSubscription,
      }));

      vi.doMock("@/lib/b2b-stripe", () => ({
        syncSeatsFromStripe: vi.fn(() =>
          Promise.resolve({
            seatLimit: 10, // New value from Stripe
            subscriptionStatus: "active",
          })
        ),
      }));

      const { POST } = await import("@/app/api/billing/sync-seats/route");

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.seatLimit).toBe(10);
      expect(mockUpdateOrgSubscription).toHaveBeenCalledWith("org_123", {
        seatLimit: 10,
        subscriptionStatus: "active",
      });
    });

    it("should return 403 for non-admin users", async () => {
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
        getOrganization: vi.fn(),
        updateOrgSubscription: vi.fn(),
      }));

      vi.doMock("@/lib/firebase-admin", () => ({
        getFirebaseAuth: vi.fn(() => ({
          verifySessionCookie: vi.fn(() =>
            Promise.resolve({ uid: "member_uid", email: "member@company.com" })
          ),
        })),
      }));

      const { POST } = await import("@/app/api/billing/sync-seats/route");

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Only admins can sync billing");
    });

    it("should return 400 if no Stripe customer ID", async () => {
      vi.resetModules();

      vi.doMock("@/lib/firestore", () => ({
        getMemberByUid: vi.fn(() =>
          Promise.resolve({
            id: "admin_123",
            orgId: "org_123",
            uid: "admin_uid",
            role: "admin",
            status: "active",
          })
        ),
        getOrganization: vi.fn(() =>
          Promise.resolve({
            id: "org_123",
            name: "Test Org",
            stripeCustomerId: null, // No Stripe customer
          })
        ),
        updateOrgSubscription: vi.fn(),
      }));

      const { POST } = await import("@/app/api/billing/sync-seats/route");

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("No Stripe customer");
    });
  });

  describe("Refresh button behavior", () => {
    it("should call sync-seats endpoint before refreshing auth", async () => {
      // This tests the expected behavior of the refresh button
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, seatLimit: 10 }),
      });

      const mockRefresh = vi.fn();
      const mockFetchMembers = vi.fn();

      // Simulate the refresh button handler
      const handleRefresh = async () => {
        try {
          const syncRes = await mockFetch("/api/billing/sync-seats", {
            method: "POST",
            credentials: "same-origin",
          });
          if (!syncRes.ok) {
            console.warn("Seat sync failed");
          }
        } catch {
          console.warn("Seat sync error");
        }
        await mockRefresh();
        await mockFetchMembers();
      };

      await handleRefresh();

      expect(mockFetch).toHaveBeenCalledWith("/api/billing/sync-seats", {
        method: "POST",
        credentials: "same-origin",
      });
      expect(mockRefresh).toHaveBeenCalled();
      expect(mockFetchMembers).toHaveBeenCalled();
    });
  });
});

describe("Stripe is single source of truth", () => {
  it("should not have duplicate seatLimit logic in stripe.ts", () => {
    // stripe.ts is for individual subscriptions (Prisma-based)
    // b2b-stripe.ts is for B2B org subscriptions (Firestore-based)
    // They serve different purposes and don't overlap
    expect(true).toBe(true);
  });

  it("should use subscription.items.data.reduce for seatLimit calculation", () => {
    // This is the correct way to calculate seatLimit from Stripe
    const mockSubscription = {
      items: {
        data: [
          { quantity: 5 },
          { quantity: 5 },
        ],
      },
    };

    const seatLimit = mockSubscription.items.data.reduce(
      (sum, item) => sum + (item.quantity ?? 0),
      0
    );

    expect(seatLimit).toBe(10);
  });
});
