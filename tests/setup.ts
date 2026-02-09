/**
 * Global test setup for Vitest
 * Mocks external services that are used across multiple test files
 */

import { vi } from "vitest";
import dotenv from "dotenv";

// Load local env for tests (Node doesn't read .env files automatically)
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" }); // optional fallback


// Mock Resend globally to prevent initialization errors in tests
vi.mock("resend", () => {
  const mockSend = vi.fn().mockResolvedValue({ data: { id: "test_email_123" }, error: null });
  return {
    Resend: class MockResend {
      emails = { send: mockSend };
    },
  };
});
