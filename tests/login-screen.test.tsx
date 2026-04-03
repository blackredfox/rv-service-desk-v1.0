import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/lib/dev-flags", () => ({
  isClientDevBypassDomainGatingHintEnabled: vi.fn(() => false),
}));

import { useAuth } from "@/hooks/use-auth";
import { LoginScreen } from "@/components/login-screen";

describe("LoginScreen forgot-password flow", () => {
  const mockLogin = vi.fn();
  const mockRefresh = vi.fn();
  const mockLogout = vi.fn();
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      loading: false,
      login: mockLogin,
      logout: mockLogout,
      refresh: mockRefresh,
    });
  });

  it("renders the forgot-password form from the login screen", () => {
    render(<LoginScreen />);

    fireEvent.click(screen.getByTestId("forgot-password-link"));

    expect(screen.getByTestId("forgot-password-submit-button")).toBeDefined();
    expect(screen.getByTestId("forgot-password-back-link")).toBeDefined();
    expect(screen.queryByTestId("login-password-input")).toBeNull();
  });

  it("shows the generic confirmation state after requesting a reset email", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        message: "If an account exists for that email, a reset link has been sent.",
      }),
    });

    render(<LoginScreen />);

    fireEvent.click(screen.getByTestId("forgot-password-link"));
    fireEvent.change(screen.getByTestId("login-email-input"), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByTestId("forgot-password-submit-button"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/auth/forgot-password",
        expect.objectContaining({
          method: "POST",
          credentials: "same-origin",
        })
      );
    });

    const successMessage = await screen.findByTestId("forgot-password-success-message");
    expect(successMessage.textContent).toBe(
      "If an account exists for that email, a reset link has been sent."
    );
    expect(screen.getByTestId("forgot-password-back-to-sign-in")).toBeDefined();
  });
});