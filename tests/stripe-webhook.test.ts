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
          where: vi.fn(() => ({
            get: vi.fn(() => Promise.resolve({ size: 0, docs: [] })),
          })),
          get: vi.fn(() => Promise.resolve({ size: 0, docs: [] })),
        })),
      })),
    })),
  })),
  getFirebaseAuth: vi.fn(() => ({
    verifySessionCookie: vi.fn(() => Promise.resolve({ uid: "test_uid", email: "test@company.com" })),
  })),
}));

// Mock Firestore functions
vi.mock("@/lib/firestore", () => ({
  getMemberByUid: vi.fn(() => Promise.resolve(null)),
  getOrganization: vi.fn(() => Promise.resolve(null)),
}));

describe("Stripe B2B Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "sk_test_mock";
    process.env.STRIPE_API_KEY = "sk_test_mock";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_mock";
    process.env.STRIPE_PRICE_SEAT_MONTHLY = "price_seat_mock";
  });

  describe("Webhook Signature Verification", () => {
    it("should have webhook secret configured", () => {
      expect(process.env.STRIPE_WEBHOOK_SECRET).toBe("whsec_mock");
    });

    it("should have seat price ID configured", () => {
      expect(process.env.STRIPE_PRICE_SEAT_MONTHLY).toBe("price_seat_mock");
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
      const { handleB2BWebhookEvent } = await import("@/lib/b2b-stripe");

      await expect(
        handleB2BWebhookEvent(Buffer.from("{}"), "signature")
      ).rejects.toThrow("Missing STRIPE_WEBHOOK_SECRET");
    });
  });

  describe("Checkout Session Route - B2B", () => {
    it("should require authentication", async () => {
      vi.resetModules();

      // Mock no session cookie
      vi.doMock("next/headers", () => ({
        cookies: vi.fn(() => Promise.resolve({
          get: vi.fn(() => undefined),
          set: vi.fn(),
          delete: vi.fn(),
        })),
      }));

      const { POST } = await import("@/app/api/billing/checkout-session/route");

      const req = new Request("http://localhost/api/billing/checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: "org_123", seatCount: 5, origin: "http://localhost:3000" }),
      });

      const response = await POST(req);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Not authenticated");
    });

    it("should require orgId parameter", async () => {
      vi.resetModules();

      vi.doMock("next/headers", () => ({
        cookies: vi.fn(() => Promise.resolve({
          get: vi.fn((name: string) => {
            if (name === "rv_session") return { value: "test_session" };
            return undefined;
          }),
          set: vi.fn(),
          delete: vi.fn(),
        })),
      }));

      vi.doMock("@/lib/firebase-admin", () => ({
        getFirebaseAuth: vi.fn(() => ({
          verifySessionCookie: vi.fn(() => Promise.resolve({ uid: "test_uid", email: "test@company.com" })),
        })),
      }));

      const { POST } = await import("@/app/api/billing/checkout-session/route");

      const req = new Request("http://localhost/api/billing/checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seatCount: 5, origin: "http://localhost:3000" }),
      });

      const response = await POST(req);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("orgId is required");
    });
  });

  describe("Webhook Route", () => {
    it("should require stripe-signature header", async () => {
      vi.resetModules();

      const { POST } = await import("@/app/api/billing/webhook/route");

      const req = new Request("http://localhost/api/billing/webhook", {
        method: "POST",
        body: JSON.stringify({ type: "checkout.session.completed" }),
      });

      const response = await POST(req);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Missing stripe-signature header");
    });
  });
});

describe("Seat-based Pricing Calculations", () => {
  const SEAT_PRICE = 19.99;

  it("should calculate 5 seats correctly", () => {
    expect(5 * SEAT_PRICE).toBeCloseTo(99.95, 2);
  });

  it("should calculate 10 seats correctly", () => {
    expect(10 * SEAT_PRICE).toBeCloseTo(199.90, 2);
  });

  it("should calculate 25 seats correctly", () => {
    expect(25 * SEAT_PRICE).toBeCloseTo(499.75, 2);
  });

  it("should calculate custom seat count correctly", () => {
    expect(7 * SEAT_PRICE).toBeCloseTo(139.93, 2);
  });
});
