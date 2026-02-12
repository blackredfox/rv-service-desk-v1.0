/**
 * Global test setup for Vitest
 * Mocks external services and ensures tests do not require real secrets.
 */

import dotenv from "dotenv";
import { vi } from "vitest";

// Load local env for tests (Node doesn't read .env files automatically)
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" }); // optional fallback

// Ensure tests never require real secrets.
// Use stubEnv for reliability under jsdom / isolated contexts.
vi.stubEnv("RESEND_API_KEY", process.env.RESEND_API_KEY || "re_test_dummy");
vi.stubEnv("STRIPE_SECRET_KEY", process.env.STRIPE_SECRET_KEY || "sk_test_dummy");
vi.stubEnv("STRIPE_API_KEY", process.env.STRIPE_API_KEY || "sk_test_dummy");

// Force memory-mode storage in tests: clear DB env vars so getPrisma() returns null.
// Use a dedicated TEST_DATABASE_URL to opt-in to real DB in integration tests.
vi.stubEnv("DATABASE_URL", process.env.TEST_DATABASE_URL || "");
vi.stubEnv("DIRECT_URL", "");

// Mock Resend globally to prevent initialization errors in tests.
// Support BOTH `import Resend from "resend"` and `import { Resend } from "resend"`.
vi.mock("resend", () => {
  const mockSend = vi.fn().mockResolvedValue({
    data: { id: "test_email_123" },
    error: null,
  });

  class MockResend {
    constructor() {}
    emails = { send: mockSend };
  }

  return {
    __esModule: true,
    default: MockResend,
    Resend: MockResend,
  };
});
