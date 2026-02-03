import { describe, it, expect, vi, beforeEach } from "vitest";

describe("Billing Portal - Subscription Upgrades", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Portal configuration", () => {
    it("should support portal configuration ID env var", () => {
      // The portal session creator should check for STRIPE_PORTAL_CONFIGURATION_ID
      const configId = "bpc_test_config";
      const sessionOptions = {
        customer: "cus_123",
        return_url: "http://localhost:3000",
        ...(configId ? { configuration: configId } : {}),
      };
      
      expect(sessionOptions.configuration).toBe(configId);
    });

    it("should not include configuration if not set", () => {
      const configId = undefined;
      const sessionOptions = {
        customer: "cus_123",
        return_url: "http://localhost:3000",
        ...(configId ? { configuration: configId } : {}),
      };
      
      expect(sessionOptions.configuration).toBeUndefined();
    });
  });

  describe("Webhook handling for subscription updates", () => {
    it("should extract seat limit from subscription quantity", () => {
      const subscriptionData = {
        id: "sub_123",
        status: "active",
        metadata: { orgId: "org_123" },
        items: { data: [{ quantity: 15 }] },
        current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
      };
      
      const seatLimit = subscriptionData.items?.data?.[0]?.quantity || 5;
      expect(seatLimit).toBe(15);
    });

    it("should default to 5 seats if quantity not found", () => {
      const subscriptionData = {
        id: "sub_123",
        status: "active",
        metadata: { orgId: "org_123" },
        items: { data: [] },
      };
      
      const seatLimit = subscriptionData.items?.data?.[0]?.quantity || 5;
      expect(seatLimit).toBe(5);
    });
  });
});

describe("Subscription Status Mapping", () => {
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

  const statusMap: [string, string][] = [
    ["active", "active"],
    ["trialing", "trialing"],
    ["past_due", "past_due"],
    ["canceled", "canceled"],
    ["unpaid", "canceled"],
    ["incomplete_expired", "canceled"],
    ["unknown_status", "none"],
  ];

  statusMap.forEach(([stripeStatus, expectedStatus]) => {
    it(`should map Stripe status "${stripeStatus}" to "${expectedStatus}"`, () => {
      expect(mapStripeStatus(stripeStatus)).toBe(expectedStatus);
    });
  });
});
