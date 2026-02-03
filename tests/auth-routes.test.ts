import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the auth module with Firebase-based functions
vi.mock("@/lib/auth", () => ({
  registerUser: vi.fn(),
  loginUser: vi.fn(),
  getCurrentUser: vi.fn(),
  setSessionCookie: vi.fn(),
  clearSessionCookie: vi.fn(),
  getSessionCookie: vi.fn(),
  verifyFirebasePassword: vi.fn(),
  createFirebaseSessionCookie: vi.fn(),
  checkRateLimit: vi.fn(() => true),
}));

vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(() => Promise.resolve({
    get: vi.fn(() => "127.0.0.1"),
  })),
  cookies: vi.fn(() => Promise.resolve({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

import {
  registerUser,
  loginUser,
  getCurrentUser,
  setSessionCookie,
  clearSessionCookie,
  verifyFirebasePassword,
  createFirebaseSessionCookie,
} from "@/lib/auth";
import { trackEvent } from "@/lib/analytics";
import type { AuthUser } from "@/lib/auth";

describe("Auth API Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/auth/register", () => {
    it("should register a new user successfully", async () => {
      const mockUser: AuthUser = {
        id: "user_123",
        email: "test@example.com",
        plan: "FREE",
        status: "ACTIVE",
      };

      // Firebase-based registerUser returns just user (no sessionId - auto-login is optional)
      vi.mocked(registerUser).mockResolvedValue(mockUser);
      vi.mocked(verifyFirebasePassword).mockResolvedValue("id_token_123");
      vi.mocked(createFirebaseSessionCookie).mockResolvedValue("session_cookie_123");

      // Import dynamically to get mocked version
      const { POST } = await import("@/app/api/auth/register/route");

      const req = new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "test@example.com",
          password: "password123",
        }),
      });

      const response = await POST(req);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.user.email).toBe("test@example.com");
      expect(trackEvent).toHaveBeenCalledWith("user.signup", mockUser.id, { email: mockUser.email });
      expect(setSessionCookie).toHaveBeenCalledWith("session_cookie_123");
    });

    it("should reject registration with missing email", async () => {
      const { POST } = await import("@/app/api/auth/register/route");

      const req = new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: "password123",
        }),
      });

      const response = await POST(req);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("required");
    });

    it("should reject weak passwords", async () => {
      const { POST } = await import("@/app/api/auth/register/route");

      const req = new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "test@example.com",
          password: "short",
        }),
      });

      const response = await POST(req);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("8 characters");
    });
  });

  describe("POST /api/auth/login", () => {
    it("should login user successfully", async () => {
      const mockUser: AuthUser = {
        id: "user_123",
        email: "test@example.com",
        plan: "FREE",
        status: "ACTIVE",
      };
      const mockSessionCookie = "firebase_session_cookie_123";

      // Firebase-based loginUser returns user + sessionCookie
      vi.mocked(loginUser).mockResolvedValue({
        user: mockUser,
        sessionCookie: mockSessionCookie,
      });

      const { POST } = await import("@/app/api/auth/login/route");

      const req = new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "test@example.com",
          password: "password123",
        }),
      });

      const response = await POST(req);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.user.email).toBe("test@example.com");
      expect(setSessionCookie).toHaveBeenCalledWith(mockSessionCookie);
      expect(trackEvent).toHaveBeenCalledWith("user.login", mockUser.id, {});
    });

    it("should reject invalid credentials", async () => {
      vi.mocked(loginUser).mockRejectedValue(new Error("Invalid credentials"));

      const { POST } = await import("@/app/api/auth/login/route");

      const req = new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "test@example.com",
          password: "wrongpassword",
        }),
      });

      const response = await POST(req);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Invalid credentials");
    });
  });

  describe("POST /api/auth/logout", () => {
    it("should logout user successfully", async () => {
      const mockUser: AuthUser = {
        id: "user_123",
        email: "test@example.com",
        plan: "FREE",
        status: "ACTIVE",
      };

      vi.mocked(getCurrentUser).mockResolvedValue(mockUser);

      const { POST } = await import("@/app/api/auth/logout/route");

      const req = new Request("http://localhost/api/auth/logout", {
        method: "POST",
      });

      const response = await POST(req);

      // The logout endpoint either returns a redirect (303) or JSON { success: true }
      expect([200, 303]).toContain(response.status);
      expect(clearSessionCookie).toHaveBeenCalled();
      expect(trackEvent).toHaveBeenCalledWith("user.logout", mockUser.id, {});
    });
  });

  describe("GET /api/auth/me", () => {
    it("should return 401 when not authenticated (no cookie)", async () => {
      vi.resetModules();

      vi.doMock("next/headers", () => ({
        headers: vi.fn(() => Promise.resolve({
          get: vi.fn(() => "127.0.0.1"),
        })),
        cookies: vi.fn(() => Promise.resolve({
          get: vi.fn(() => undefined), // No session cookie
          set: vi.fn(),
          delete: vi.fn(),
        })),
      }));

      const { GET } = await import("@/app/api/auth/me/route");

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Not authenticated");
    });

    it("should return 401 when session cookie is invalid", async () => {
      vi.resetModules();

      vi.doMock("next/headers", () => ({
        headers: vi.fn(() => Promise.resolve({
          get: vi.fn(() => "127.0.0.1"),
        })),
        cookies: vi.fn(() => Promise.resolve({
          get: vi.fn((name: string) => {
            if (name === "rv_session") return { value: "invalid_session" };
            return undefined;
          }),
          set: vi.fn(),
          delete: vi.fn(),
        })),
      }));

      vi.doMock("@/lib/firebase-admin", () => ({
        getFirebaseAuth: vi.fn(() => ({
          verifySessionCookie: vi.fn(() => Promise.reject(new Error("Invalid session"))),
        })),
      }));

      const { GET } = await import("@/app/api/auth/me/route");

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Not authenticated");
    });
  });
});
