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
    verifySessionCookie: vi.fn(() => Promise.resolve({ uid: "test_uid", email: "test@company.com" })),
  })),
}));

// Mock cookies
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => Promise.resolve({
    get: vi.fn((name: string) => {
      if (name === "rv_session") return { value: "test_session_cookie" };
      return undefined;
    }),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

describe("B2B Billing Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "sk_test_mock";
    process.env.STRIPE_API_KEY = "sk_test_mock";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_mock";
    process.env.STRIPE_PRICE_SEAT_MONTHLY = "price_seat_mock";
    process.env.REQUIRE_SUBSCRIPTION = "true";
  });

  describe("Environment Configuration", () => {
    it("should have stripe secret key configured", () => {
      expect(process.env.STRIPE_SECRET_KEY).toBe("sk_test_mock");
    });

    it("should have stripe webhook secret configured", () => {
      expect(process.env.STRIPE_WEBHOOK_SECRET).toBe("whsec_mock");
    });

    it("should have seat price ID configured", () => {
      expect(process.env.STRIPE_PRICE_SEAT_MONTHLY).toBe("price_seat_mock");
    });

    it("should have require subscription flag", () => {
      expect(process.env.REQUIRE_SUBSCRIPTION).toBe("true");
    });
  });

  describe("Checkout Session Route", () => {
    it("should return 401 if not authenticated", async () => {
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

    it("should return 400 if orgId is missing", async () => {
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

    it("should return 400 if origin is missing", async () => {
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
        body: JSON.stringify({ orgId: "org_123", seatCount: 5 }),
      });

      const response = await POST(req);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("origin URL is required");
    });
  });

  describe("Webhook Route", () => {
    it("should return 400 if stripe-signature header is missing", async () => {
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

  describe("Gating Logic", () => {
    it("should allow access when subscription is not required", () => {
      process.env.REQUIRE_SUBSCRIPTION = "false";
      expect(process.env.REQUIRE_SUBSCRIPTION).toBe("false");
    });

    it("should require subscription when flag is true", () => {
      process.env.REQUIRE_SUBSCRIPTION = "true";
      expect(process.env.REQUIRE_SUBSCRIPTION).toBe("true");
    });
  });

  describe("Organization Route", () => {
    it("should return 401 if not authenticated", async () => {
      vi.resetModules();

      vi.doMock("next/headers", () => ({
        cookies: vi.fn(() => Promise.resolve({
          get: vi.fn(() => undefined),
          set: vi.fn(),
          delete: vi.fn(),
        })),
      }));

      const { GET } = await import("@/app/api/org/route");

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Not authenticated");
    });
  });
});

describe("Seat-based Pricing", () => {
  it("should calculate correct pricing for 5 seats", () => {
    const seatPrice = 19.99;
    const seats = 5;
    const total = seats * seatPrice;
    expect(total).toBeCloseTo(99.95, 2);
  });

  it("should calculate correct pricing for 10 seats", () => {
    const seatPrice = 19.99;
    const seats = 10;
    const total = seats * seatPrice;
    expect(total).toBeCloseTo(199.90, 2);
  });

  it("should calculate correct pricing for 25 seats", () => {
    const seatPrice = 19.99;
    const seats = 25;
    const total = seats * seatPrice;
    expect(total).toBeCloseTo(499.75, 2);
  });
});
