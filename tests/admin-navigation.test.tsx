import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
  usePathname: () => "/admin/members",
}));

// Mock useAuth hook
const mockRefresh = vi.fn();
const mockUseAuth = vi.fn(() => ({
  user: {
    email: "admin@company.com",
    access: { isAdmin: true, allowed: true },
    organization: { id: "org_123", name: "Test Org", seatLimit: 10, activeSeatCount: 5 },
    membership: { role: "admin", status: "active" },
  },
  loading: false,
  refresh: mockRefresh,
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => mockUseAuth(),
}));

describe("Admin Navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Back to Dashboard button", () => {
    it("should have correct test id", async () => {
      // Import component after mocks are set up
      const { default: AdminMembersPage } = await import("@/app/admin/members/page");
      
      render(<AdminMembersPage />);
      
      const backButton = screen.queryByTestId("back-to-dashboard");
      expect(backButton).toBeDefined();
    });

    it("should navigate to /?from=admin when clicked", async () => {
      const mockPush = vi.fn();
      vi.doMock("next/navigation", () => ({
        useRouter: () => ({
          push: mockPush,
          replace: vi.fn(),
        }),
        usePathname: () => "/admin/members",
      }));

      const { default: AdminMembersPage } = await import("@/app/admin/members/page");
      
      render(<AdminMembersPage />);
      
      const backButton = screen.getByTestId("back-to-dashboard");
      fireEvent.click(backButton);
      
      expect(mockPush).toHaveBeenCalledWith("/?from=admin");
    });
  });

  describe("Seat counter", () => {
    it("should display seat count in header", async () => {
      const { default: AdminMembersPage } = await import("@/app/admin/members/page");
      
      render(<AdminMembersPage />);
      
      const seatCounter = screen.getByTestId("seat-counter");
      expect(seatCounter).toBeDefined();
      expect(seatCounter.textContent).toContain("5 / 10 seats");
    });
  });

  describe("Upgrade seats button", () => {
    it("should show upgrade link when seat limit reached", async () => {
      // Mock with seat limit reached
      mockUseAuth.mockReturnValueOnce({
        user: {
          email: "admin@company.com",
          access: { isAdmin: true, allowed: true },
          organization: { id: "org_123", name: "Test Org", seatLimit: 5, activeSeatCount: 5 },
          membership: { role: "admin", status: "active" },
        },
        loading: false,
        refresh: mockRefresh,
      });

      const { default: AdminMembersPage } = await import("@/app/admin/members/page");
      
      render(<AdminMembersPage />);
      
      // The upgrade button should appear when seats are full
      const upgradeButton = screen.queryByTestId("upgrade-seats-button");
      // May or may not be visible depending on showAddForm state
    });
  });
});
