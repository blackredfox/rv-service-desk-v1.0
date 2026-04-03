import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getPrisma: vi.fn(),
}));

vi.mock("@/lib/firebase-admin", () => ({
  getFirebaseAuth: vi.fn(),
}));

import { requestFirebasePasswordReset } from "@/lib/auth";

describe("requestFirebasePasswordReset", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("FIREBASE_WEB_API_KEY", "firebase-web-key");
    vi.stubEnv("APP_URL", "https://rv-service-desk.example.com");
    vi.stubGlobal("fetch", mockFetch);
  });

  it("does not reveal whether the email exists when Firebase returns EMAIL_NOT_FOUND", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({
        error: { message: "EMAIL_NOT_FOUND" },
      }),
    });

    await expect(requestFirebasePasswordReset("missing@example.com")).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body)).toEqual({
      requestType: "PASSWORD_RESET",
      email: "missing@example.com",
      continueUrl: "https://rv-service-desk.example.com",
    });
  });

  it("surfaces invalid email errors without creating a custom token flow", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({
        error: { message: "INVALID_EMAIL" },
      }),
    });

    await expect(requestFirebasePasswordReset("bad-email")).rejects.toThrow(
      "Invalid email address"
    );
  });
});