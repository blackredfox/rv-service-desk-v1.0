import { fireEvent, render, screen } from "@testing-library/react";
import { RefObject, useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

import { AppHeader, getCompactEmailLabel } from "@/components/app-header";
import type { AuthUser } from "@/hooks/use-auth";

function HeaderHarness({ user }: { user: AuthUser | null }) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  return (
    <AppHeader
      sidebarCollapsed={false}
      onToggleSidebar={() => undefined}
      onNewCase={() => undefined}
      languageMode="AUTO"
      onLanguageChange={() => undefined}
      userMenuProps={{
        userMenuOpen,
        setUserMenuOpen,
        userMenuRef: userMenuRef as RefObject<HTMLDivElement | null>,
        userEmail: user?.email ?? "",
        user,
        logout: () => undefined,
        onOpenTerms: () => undefined,
      }}
    />
  );
}

describe("AppHeader identity display", () => {
  it("prefers the admin-managed display name in the header and keeps full email in the menu", () => {
    render(
      <HeaderHarness
        user={{
          id: "user_123",
          email: "very.long.email.address@company.com",
          displayName: "Morgan Vale",
          access: { allowed: true, requiresSubscription: true, isAdmin: false },
          membership: { role: "member", status: "active" },
          organization: null,
        }}
      />
    );

    expect(screen.getByTestId("header-user-identity").textContent).toBe("Morgan Vale");

    fireEvent.click(screen.getByTestId("user-menu-button"));

    expect(screen.getByTestId("user-menu-full-email").textContent).toBe("very.long.email.address@company.com");
  });

  it("falls back to a compact email label when display name is missing", () => {
    const email = "averyverylongtechnicianemail@company.com";

    render(
      <HeaderHarness
        user={{
          id: "user_456",
          email,
          access: { allowed: true, requiresSubscription: true, isAdmin: false },
          membership: { role: "member", status: "active" },
          organization: null,
        }}
      />
    );

    expect(screen.getByTestId("header-user-identity").textContent).toBe(getCompactEmailLabel(email));
    expect(screen.getByTestId("header-user-identity").textContent).not.toBe(email);
  });
});