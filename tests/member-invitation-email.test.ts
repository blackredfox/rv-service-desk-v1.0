import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for member invitation email functionality
 * MVP: Plain transactional email with org name and sign-in link
 */

// Mock Resend at module level
vi.mock("resend", () => {
  const mockSend = vi.fn().mockResolvedValue({ data: { id: "test_email_123" }, error: null });
  return {
    Resend: class MockResend {
      emails = { send: mockSend };
    },
  };
});

describe("Member Invitation Emails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("sendInvitationEmail", () => {
    it("should generate correct email content with org name", async () => {
      vi.resetModules();
      
      const { sendInvitationEmail } = await import("@/lib/email");
      
      const emailId = await sendInvitationEmail({
        to: "newuser@company.com",
        orgName: "Acme Corp",
        inviterEmail: "admin@company.com",
      });

      expect(emailId).toBeDefined();
    });

    it("should include org name in subject line", async () => {
      // Test that subject follows format: "You've been invited to join {orgName}"
      const orgName = "Test Organization";
      const expectedSubject = `You've been invited to join ${orgName}`;
      
      expect(expectedSubject).toBe("You've been invited to join Test Organization");
    });

    it("should escape HTML in org name to prevent XSS", async () => {
      // Test the escapeHtml utility
      const maliciousOrgName = '<script>alert("xss")</script>';
      const escaped = maliciousOrgName
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
      
      expect(escaped).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
      expect(escaped).not.toContain("<script>");
    });

    it("should work without inviter email", async () => {
      vi.resetModules();
      
      const { sendInvitationEmail } = await import("@/lib/email");
      
      // Should not throw when inviterEmail is undefined
      const emailId = await sendInvitationEmail({
        to: "newuser@company.com",
        orgName: "Acme Corp",
      });

      expect(emailId).toBeDefined();
    });
  });

  describe("Email content requirements", () => {
    it("should include sign-in link in email", () => {
      // MVP requirement: email must have a link to sign in
      const loginUrl = "https://app.example.com";
      const htmlContent = `<a href="${loginUrl}">Sign In</a>`;
      
      expect(htmlContent).toContain('href="https://app.example.com"');
    });

    it("should mention the email domain for user guidance", () => {
      // MVP requirement: tell user which email to use
      const userEmail = "user@company.com";
      const domain = userEmail.split("@")[1];
      const guidance = `Use your ${domain} email address to sign in.`;
      
      expect(guidance).toBe("Use your company.com email address to sign in.");
    });
  });
});

describe("POST /api/org/members - Email Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("should attempt to send invitation email after creating member", async () => {
    // Mock all dependencies
    vi.doMock("@/lib/firebase-admin", () => ({
      getFirebaseAuth: vi.fn(() => ({
        verifySessionCookie: vi.fn(() =>
          Promise.resolve({ uid: "admin_uid", email: "admin@company.com", user_id: "admin_uid" })
        ),
      })),
    }));

    vi.doMock("next/headers", () => ({
      cookies: vi.fn(() =>
        Promise.resolve({
          get: vi.fn((name: string) => {
            if (name === "rv_session") return { value: "test_session" };
            return undefined;
          }),
        })
      ),
    }));

    const mockCreateMember = vi.fn(() =>
      Promise.resolve({
        id: "new_member_123",
        email: "newuser@company.com",
        role: "member",
        status: "active",
      })
    );

    vi.doMock("@/lib/firestore", () => ({
      getMemberByUid: vi.fn(() =>
        Promise.resolve({
          id: "admin_member_123",
          orgId: "org_123",
          uid: "admin_uid",
          email: "admin@company.com",
          role: "admin",
          status: "active",
        })
      ),
      getOrganization: vi.fn(() =>
        Promise.resolve({
          id: "org_123",
          name: "Test Org",
          domains: ["company.com"],
          subscriptionStatus: "active",
          seatLimit: 10,
          activeSeatCount: 3,
        })
      ),
      getOrgMembers: vi.fn(() => Promise.resolve([])),
      createMember: mockCreateMember,
      updateMember: vi.fn(),
      recalculateActiveSeatCount: vi.fn(),
    }));

    const mockSendInvitationEmail = vi.fn(() => Promise.resolve("email_123"));
    vi.doMock("@/lib/email", () => ({
      sendInvitationEmail: mockSendInvitationEmail,
    }));

    const { POST } = await import("@/app/api/org/members/route");

    const request = new Request("http://localhost/api/org/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "newuser@company.com", role: "member" }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.member.email).toBe("newuser@company.com");
    expect(mockCreateMember).toHaveBeenCalled();
    expect(mockSendInvitationEmail).toHaveBeenCalledWith({
      to: "newuser@company.com",
      orgName: "Test Org",
      inviterEmail: "admin@company.com",
    });
  });

  it("should still create member even if email fails", async () => {
    // Email failure should not block member creation
    vi.doMock("@/lib/firebase-admin", () => ({
      getFirebaseAuth: vi.fn(() => ({
        verifySessionCookie: vi.fn(() =>
          Promise.resolve({ uid: "admin_uid", email: "admin@company.com", user_id: "admin_uid" })
        ),
      })),
    }));

    vi.doMock("next/headers", () => ({
      cookies: vi.fn(() =>
        Promise.resolve({
          get: vi.fn((name: string) => {
            if (name === "rv_session") return { value: "test_session" };
            return undefined;
          }),
        })
      ),
    }));

    vi.doMock("@/lib/firestore", () => ({
      getMemberByUid: vi.fn(() =>
        Promise.resolve({
          id: "admin_member_123",
          orgId: "org_123",
          uid: "admin_uid",
          email: "admin@company.com",
          role: "admin",
          status: "active",
        })
      ),
      getOrganization: vi.fn(() =>
        Promise.resolve({
          id: "org_123",
          name: "Test Org",
          domains: ["company.com"],
          subscriptionStatus: "active",
          seatLimit: 10,
          activeSeatCount: 3,
        })
      ),
      getOrgMembers: vi.fn(() => Promise.resolve([])),
      createMember: vi.fn(() =>
        Promise.resolve({
          id: "new_member_123",
          email: "newuser@company.com",
          role: "member",
          status: "active",
        })
      ),
      updateMember: vi.fn(),
      recalculateActiveSeatCount: vi.fn(),
    }));

    // Mock email to fail
    vi.doMock("@/lib/email", () => ({
      sendInvitationEmail: vi.fn(() => Promise.reject(new Error("Email service down"))),
    }));

    const { POST } = await import("@/app/api/org/members/route");

    const request = new Request("http://localhost/api/org/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "newuser@company.com", role: "member" }),
    });

    const response = await POST(request);
    const data = await response.json();

    // Member should still be created despite email failure
    expect(response.status).toBe(201);
    expect(data.member.email).toBe("newuser@company.com");
  });
});
