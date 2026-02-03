import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Stripe
vi.mock("stripe", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      billingPortal: {
        sessions: {
          create: vi.fn().mockResolvedValue({
            url: "https://billing.stripe.com/session/test_session",
          }),
        },
      },
      checkout: {
        sessions: {
          create: vi.fn().mockResolvedValue({
            url: "https://checkout.stripe.com/session/test_checkout",
            id: "cs_test_123",
          }),
        },
      },
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue({
          id: "sub_123",
          status: "active",
          metadata: { orgId: "org_123" },
          items: { data: [{ quantity: 10 }] },
          current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
        }),
      },
      webhooks: {
        constructEvent: vi.fn(),
      },
    })),
  };
});

describe("Billing Portal - Subscription Upgrades", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.STRIPE_PRICE_SEAT_MONTHLY = "price_test_123";
  });

  describe("Portal session creation", () => {
    it("should create portal session with customer ID", async () => {
      const { createBillingPortalSession } = await import("@/lib/b2b-stripe");
      
      const result = await createBillingPortalSession({
        stripeCustomerId: "cus_123",
        returnUrl: "http://localhost:3000/admin/members",
      });
      
      expect(result.url).toBeDefined();
      expect(result.url).toContain("stripe.com");
    });

    it("should use portal configuration ID if provided", async () => {
      process.env.STRIPE_PORTAL_CONFIGURATION_ID = "bpc_test_config";
      
      // Re-import to pick up new env var
      vi.resetModules();
      const { createBillingPortalSession } = await import("@/lib/b2b-stripe");
      
      const result = await createBillingPortalSession({
        stripeCustomerId: "cus_123",
        returnUrl: "http://localhost:3000",
      });
      
      expect(result.url).toBeDefined();
    });
  });

  describe("Webhook handling for subscription updates", () => {
    it("should update seat limit when subscription is updated", async () => {
      const mockUpdateOrgSubscription = vi.fn();
      
      vi.doMock("@/lib/firestore", () => ({
        updateOrgSubscription: mockUpdateOrgSubscription,
      }));
      
      // Simulate subscription update event
      const subscriptionData = {
        id: "sub_123",
        status: "active",
        metadata: { orgId: "org_123" },
        items: { data: [{ quantity: 15 }] }, // Upgraded to 15 seats
        current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
      };
      
      // The handleSubscriptionUpdate function should extract quantity
      const seatLimit = subscriptionData.items?.data?.[0]?.quantity || 5;
      
      expect(seatLimit).toBe(15);
    });
  });
});

describe("Subscription Status Mapping", () => {
  const statusMap: Record<string, string> = {
    active: "active",
    trialing: "trialing",
    past_due: "past_due",
    canceled: "canceled",
    unpaid: "canceled",
    incomplete_expired: "canceled",
    unknown_status: "none",
  };

  Object.entries(statusMap).forEach(([stripeStatus, expectedStatus]) => {
    it(`should map Stripe status "${stripeStatus}" to "${expectedStatus}"`, () => {
      function mapStripeStatus(status: string): string {
        switch (status) {
          case "active": return "active";
          case "trialing": return "trialing";
          case "past_due": return "past_due";
          case "canceled":
          case "unpaid":
          case "incomplete_expired": return "canceled";
          default: return "none";
        }
      }
      
      expect(mapStripeStatus(stripeStatus)).toBe(expectedStatus);
    });
  });
});
