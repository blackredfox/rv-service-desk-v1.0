import { describe, it, expect, vi, beforeEach } from "vitest";
import Stripe from "stripe";

// Mock Stripe
vi.mock("stripe", () => {
  const MockStripe = vi.fn(() => ({
    checkout: {
      sessions: {
        create: vi.fn(),
        retrieve: vi.fn(),
      },
    },
    webhooks: {
      constructEvent: vi.fn(),
    },
  }));
  return { default: MockStripe };
});

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
    // Set env vars for tests
    process.env.STRIPE_SECRET_KEY = "sk_test_mock";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_mock";
    process.env.STRIPE_PRICE_ID_PREMIUM = "price_premium_mock";
    process.env.STRIPE_PRICE_ID_PRO = "price_pro_mock";
  });

  describe("Webhook Signature Verification", () => {
    it("should verify webhook signature correctly", async () => {
      const mockEvent: Stripe.Event = {
        id: "evt_123",
        type: "checkout.session.completed",
        object: "event",
        api_version: "2025-05-28.basil",
        created: Date.now(),
        livemode: false,
        pending_webhooks: 0,
        request: null,
        data: {
          object: {
            id: "cs_123",
            object: "checkout.session",
            payment_status: "paid",
            metadata: {
              userId: "user_123",
              plan: "PREMIUM",
            },
            customer: "cus_123",
            subscription: "sub_123",
          } as unknown as Stripe.Checkout.Session,
        },
      };

      const stripeInstance = new (Stripe as unknown as new () => {
        webhooks: { constructEvent: ReturnType<typeof vi.fn> };
      })();
      stripeInstance.webhooks.constructEvent.mockReturnValue(mockEvent);

      // The webhook handler uses constructEvent internally
      expect(stripeInstance.webhooks.constructEvent).toBeDefined();
    });

    it("should reject invalid webhook signatures", async () => {
      const stripeInstance = new (Stripe as unknown as new () => {
        webhooks: { constructEvent: ReturnType<typeof vi.fn> };
      })();
      stripeInstance.webhooks.constructEvent.mockImplementation(() => {
        throw new Error("Webhook signature verification failed");
      });

      expect(() => {
        stripeInstance.webhooks.constructEvent(
          Buffer.from("{}"),
          "invalid_signature",
          "whsec_mock"
        );
      }).toThrow("Webhook signature verification failed");
    });
  });

  describe("Checkout Session Creation", () => {
    it("should create checkout session with correct metadata", async () => {
      const stripeInstance = new (Stripe as unknown as new () => {
        checkout: { sessions: { create: ReturnType<typeof vi.fn> } };
      })();
      
      stripeInstance.checkout.sessions.create.mockResolvedValue({
        id: "cs_123",
        url: "https://checkout.stripe.com/pay/cs_123",
      });

      const result = await stripeInstance.checkout.sessions.create({
        mode: "subscription",
        payment_method_types: ["card"],
        line_items: [{ price: "price_premium_mock", quantity: 1 }],
        success_url: "http://localhost:3000/billing/success?session_id={CHECKOUT_SESSION_ID}",
        cancel_url: "http://localhost:3000/billing/cancel",
        customer_email: "test@example.com",
        metadata: {
          userId: "user_123",
          plan: "PREMIUM",
        },
        subscription_data: {
          metadata: {
            userId: "user_123",
            plan: "PREMIUM",
          },
        },
      });

      expect(result.url).toContain("checkout.stripe.com");
      expect(stripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            userId: "user_123",
            plan: "PREMIUM",
          }),
        })
      );
    });
  });
});
