import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: {
      id: "user_123",
      email: "tech@company.com",
      access: { allowed: true, requiresSubscription: true, isAdmin: false },
      membership: { role: "member", status: "active" },
      organization: {
        id: "org_123",
        name: "Test Org",
        subscriptionStatus: "active",
        seatLimit: 5,
        activeSeatCount: 1,
      },
    },
    loading: false,
    logout: vi.fn(),
    refresh: vi.fn(async () => undefined),
  }),
}));

vi.mock("@/lib/access-status", () => ({
  deriveAccessStatus: vi.fn(() => ({ kind: "ready" })),
}));

vi.mock("@/lib/terms", () => ({
  fetchTerms: vi.fn(async () => ({ version: "v1.0", markdown: "Terms" })),
  loadTermsAcceptance: vi.fn(() => ({ accepted: true, version: "v1.0" })),
  storeTermsAcceptance: vi.fn(),
}));

vi.mock("@/components/app-header", () => ({
  AppHeader: ({ onNewCase }: { onNewCase: () => void }) => (
    <button type="button" data-testid="mock-new-case" onClick={onNewCase}>
      New Case
    </button>
  ),
}));

vi.mock("@/components/sidebar", () => ({
  Sidebar: ({ activeCaseId, onSelectCase }: { activeCaseId: string | null; onSelectCase: (id: string) => void }) => (
    <div data-testid="mock-sidebar">
      <div data-testid="sidebar-active-case">{activeCaseId ?? "draft"}</div>
      <button type="button" data-testid="select-existing-case" onClick={() => onSelectCase("case-existing")}> 
        Select Existing
      </button>
    </div>
  ),
}));

vi.mock("@/components/chat-panel", () => ({
  ChatPanel: ({ caseId, draftToken }: { caseId: string | null; draftToken: number }) => (
    <div>
      <div data-testid="chat-case-id">{caseId ?? "draft"}</div>
      <div data-testid="chat-draft-token">{String(draftToken)}</div>
    </div>
  ),
}));

vi.mock("@/components/terms-modal", () => ({ TermsModal: () => null }));
vi.mock("@/components/login-screen", () => ({ LoginScreen: () => null }));
vi.mock("@/components/org-setup-screen", () => ({ OrgSetupScreen: () => null }));
vi.mock("@/components/billing-paywall", () => ({ BillingPaywall: () => null }));
vi.mock("@/components/access-blocked", () => ({ AccessBlockedScreen: () => null }));
vi.mock("@/components/no-organization", () => ({ NoOrganizationScreen: () => null }));

import Home from "@/app/page";

describe("Home empty draft flow", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("opens a local draft and lets the user abandon it cleanly", async () => {
    localStorage.setItem("rv:lastCaseId", "case-existing");

    render(<Home />);

    fireEvent.click(screen.getByTestId("welcome-continue-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("chat-case-id").textContent).toBe("case-existing");
    });

    fireEvent.click(screen.getByTestId("mock-new-case"));

    expect(screen.getByTestId("chat-case-id").textContent).toBe("draft");
    expect(screen.getByTestId("sidebar-active-case").textContent).toBe("draft");
    expect(screen.getByTestId("chat-draft-token").textContent).toBe("1");

    fireEvent.click(screen.getByTestId("select-existing-case"));

    expect(screen.getByTestId("chat-case-id").textContent).toBe("case-existing");
    expect(screen.getByTestId("sidebar-active-case").textContent).toBe("case-existing");
  });
});