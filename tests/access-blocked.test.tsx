import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AccessBlockedScreen } from "@/components/access-blocked";

// Mock React for testing
vi.mock("react", async () => {
  const actual = await vi.importActual("react");
  return actual;
});

describe("AccessBlockedScreen Component", () => {
  describe("Logout button", () => {
    it("should render logout button when onLogout is provided", () => {
      const onLogout = vi.fn();
      
      render(
        <AccessBlockedScreen
          reason="not_a_member"
          onLogout={onLogout}
        />
      );
      
      const logoutButton = screen.getByTestId("blocked-logout-button");
      expect(logoutButton).toBeDefined();
      expect(logoutButton.textContent).toBe("Logout");
    });

    it("should call onLogout when logout button is clicked", () => {
      const onLogout = vi.fn();
      
      render(
        <AccessBlockedScreen
          reason="not_a_member"
          onLogout={onLogout}
        />
      );
      
      const logoutButton = screen.getByTestId("blocked-logout-button");
      fireEvent.click(logoutButton);
      
      expect(onLogout).toHaveBeenCalledTimes(1);
    });

    it("should not render logout button when onLogout is not provided", () => {
      render(
        <AccessBlockedScreen
          reason="not_a_member"
        />
      );
      
      const logoutButton = screen.queryByTestId("blocked-logout-button");
      expect(logoutButton).toBeNull();
    });
  });

  describe("not_a_member reason", () => {
    it("should show correct title and message for not_a_member", () => {
      render(
        <AccessBlockedScreen
          reason="not_a_member"
          onLogout={vi.fn()}
        />
      );
      
      const title = screen.getByTestId("blocked-title");
      const message = screen.getByTestId("blocked-message");
      
      expect(title.textContent).toBe("Access Required");
      expect(message.textContent).toContain("Contact your administrator");
    });

    it("should show contact support link for not_a_member", () => {
      render(
        <AccessBlockedScreen
          reason="not_a_member"
          onLogout={vi.fn()}
        />
      );
      
      const contactSupport = screen.getByTestId("blocked-contact-support");
      expect(contactSupport).toBeDefined();
      expect(contactSupport.getAttribute("href")).toBe("mailto:support@rvservicedesk.com");
    });
  });

  describe("blocked_domain reason", () => {
    it("should show correct title for blocked_domain", () => {
      render(
        <AccessBlockedScreen
          reason="blocked_domain"
          onLogout={vi.fn()}
        />
      );
      
      const title = screen.getByTestId("blocked-title");
      expect(title.textContent).toBe("Access Restricted");
    });
  });

  describe("seat_limit_exceeded reason", () => {
    it("should show correct message for non-admin", () => {
      render(
        <AccessBlockedScreen
          reason="seat_limit_exceeded"
          isAdmin={false}
          onLogout={vi.fn()}
        />
      );
      
      const title = screen.getByTestId("blocked-title");
      const message = screen.getByTestId("blocked-message");
      
      expect(title.textContent).toBe("Seat Limit Reached");
      expect(message.textContent).toContain("Contact your administrator");
    });

    it("should show admin-specific message for admin", () => {
      render(
        <AccessBlockedScreen
          reason="seat_limit_exceeded"
          isAdmin={true}
          onLogout={vi.fn()}
        />
      );
      
      const message = screen.getByTestId("blocked-message");
      expect(message.textContent).toContain("purchase more seats");
    });
  });

  describe("inactive/pending reasons", () => {
    it("should show correct title for inactive", () => {
      render(
        <AccessBlockedScreen
          reason="inactive"
          onLogout={vi.fn()}
        />
      );
      
      const title = screen.getByTestId("blocked-title");
      expect(title.textContent).toBe("Account Deactivated");
    });

    it("should show correct title for pending", () => {
      render(
        <AccessBlockedScreen
          reason="pending"
          onLogout={vi.fn()}
        />
      );
      
      const title = screen.getByTestId("blocked-title");
      expect(title.textContent).toBe("Account Pending");
    });
  });

  describe("Refresh button", () => {
    it("should render refresh button for subscription_required", () => {
      const onRefresh = vi.fn();
      
      render(
        <AccessBlockedScreen
          reason="subscription_required"
          onRefresh={onRefresh}
          onLogout={vi.fn()}
        />
      );
      
      const refreshButton = screen.getByTestId("blocked-refresh-button");
      expect(refreshButton).toBeDefined();
      
      fireEvent.click(refreshButton);
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
  });
});
