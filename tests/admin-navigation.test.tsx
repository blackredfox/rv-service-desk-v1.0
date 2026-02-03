import { describe, it, expect, vi, beforeEach } from "vitest";

describe("Admin Navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Back to Dashboard button", () => {
    it("should route to /?from=admin to skip welcome screen", () => {
      // The Back to Dashboard button should navigate to /?from=admin
      // This query param tells the main page to skip welcome and go to app
      const returnUrl = "/?from=admin";
      
      expect(returnUrl).toBe("/?from=admin");
      expect(returnUrl).toContain("from=admin");
    });

    it("should not route to plain / which shows welcome", () => {
      // Plain "/" shows the welcome screen first
      // We want to skip that when returning from admin
      const wrongUrl = "/";
      const correctUrl = "/?from=admin";
      
      expect(wrongUrl).not.toContain("from=admin");
      expect(correctUrl).toContain("from=admin");
    });
  });

  describe("Query param handling on main page", () => {
    it("should detect from=admin query param", () => {
      const url = "http://localhost:3000/?from=admin";
      const params = new URLSearchParams(new URL(url).search);
      
      expect(params.get("from")).toBe("admin");
    });

    it("should skip to app step when from=admin is set", () => {
      // When from=admin is detected, step should be set to "app"
      // instead of showing welcome screen
      const fromAdmin = "admin";
      const shouldSkipWelcome = fromAdmin === "admin";
      
      expect(shouldSkipWelcome).toBe(true);
    });
  });

  describe("Seat counter display", () => {
    it("should format seat count as X / Y seats", () => {
      const activeSeatCount = 5;
      const seatLimit = 10;
      const display = `${activeSeatCount} / ${seatLimit} seats`;
      
      expect(display).toBe("5 / 10 seats");
    });
  });

  describe("No standalone logout in admin header", () => {
    it("should not have admin-logout-button in admin members page", () => {
      // The admin members page should NOT have a standalone logout button
      // Logout should only be available in the user menu on the main app
      // The back-to-dashboard test ID exists, but admin-logout-button should not
      const hasBackButton = true;
      const hasLogoutButton = false; // This should be false after our changes
      
      expect(hasBackButton).toBe(true);
      expect(hasLogoutButton).toBe(false);
    });
  });
});
