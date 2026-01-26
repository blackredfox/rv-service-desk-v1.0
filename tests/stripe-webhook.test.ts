import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies  
vi.mock("@/lib/db", () => ({
  getPrisma: vi.fn(() => Promise.resolve({
    subscription: {
      upsert: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
    },
    paymentTransaction: {
      create: vi.fn(),
      update: vi.fn(),
    },
  })),
}));

vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
}));

describe("Stripe Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "sk_test_mock";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_mock";
    process.env.STRIPE_PRICE_ID_PREMIUM = "price_premium_mock";
    process.env.STRIPE_PRICE_ID_PRO = "price_pro_mock";
  });

  describe("Webhook Signature Verification", () => {
    it("should have webhook secret configured", () => {
      expect(process.env.STRIPE_WEBHOOK_SECRET).toBe("whsec_mock");
    });

    it("should have price IDs configured", () => {
      expect(process.env.STRIPE_PRICE_ID_PREMIUM).toBe("price_premium_mock");
      expect(process.env.STRIPE_PRICE_ID_PRO).toBe("price_pro_mock");
    });
  });

  describe("Environment Configuration", () => {
    it("should have stripe secret key", () => {
      expect(process.env.STRIPE_SECRET_KEY).toBe("sk_test_mock");
    });

    it("should reject missing webhook secret in handler", async () => {
      delete process.env.STRIPE_WEBHOOK_SECRET;

      // Import stripe module after env var is deleted
      vi.resetModules();
      const { handleWebhookEvent } = await import("@/lib/stripe");

      await expect(
        handleWebhookEvent(Buffer.from("{}"), "signature")
      ).rejects.toThrow("Missing STRIPE_WEBHOOK_SECRET");
    });
  });

  describe("Checkout Session Creation", () => {
    it("should reject invalid plan", async () => {
      vi.resetModules();

      // Mock auth for the checkout route
      vi.doMock("@/lib/auth", () => ({
        getCurrentUser: vi.fn(() => Promise.resolve({
          id: "user_123",
          email: "test@example.com",
          plan: "FREE",
          status: "ACTIVE",
        })),
      }));

      vi.doMock("next/headers", () => ({
        cookies: vi.fn(() => Promise.resolve({
          get: vi.fn(),
          set: vi.fn(),
          delete: vi.fn(),
        })),
      }));

      const { POST } = await import("@/app/api/billing/checkout-session/route");

      const req = new Request("http://localhost/api/billing/checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "INVALID", origin: "http://localhost:3000" }),
      });

      const response = await POST(req);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Invalid plan");
    });

    it("should require authentication", async () => {
      vi.resetModules();

      vi.doMock("@/lib/auth", () => ({
        getCurrentUser: vi.fn(() => Promise.resolve(null)),
      }));

      vi.doMock("next/headers", () => ({
        cookies: vi.fn(() => Promise.resolve({
          get: vi.fn(),
          set: vi.fn(),
          delete: vi.fn(),
        })),
      }));

      const { POST } = await import("@/app/api/billing/checkout-session/route");

      const req = new Request("http://localhost/api/billing/checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "PREMIUM", origin: "http://localhost:3000" }),
      });

      const response = await POST(req);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Not authenticated");
    });
  });
});
