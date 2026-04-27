"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Sidebar } from "@/components/sidebar";
import { ChatPanel } from "@/components/chat-panel";
import { AppHeader } from "@/components/app-header";
import { TermsModal } from "@/components/terms-modal";
import { LoginScreen } from "@/components/login-screen";
import { OrgSetupScreen } from "@/components/org-setup-screen";
import { BillingPaywall } from "@/components/billing-paywall";
import { AccessBlockedScreen } from "@/components/access-blocked";
import { NoOrganizationScreen } from "@/components/no-organization";
import { useAuth } from "@/hooks/use-auth";
import { deriveAccessStatus } from "@/lib/access-status";
import { fetchTerms, loadTermsAcceptance, storeTermsAcceptance } from "@/lib/terms";
import type { LanguageMode } from "@/lib/api";

type OnboardingStep =
  | "welcome"
  | "auth"
  | "terms"
  | "no_org"
  | "not_a_member"
  | "org_setup"
  | "billing"
  | "blocked"
  | "admin_onboard"
  | "app";

function WelcomeScreen(props: { onContinue: () => void }) {
  const { onContinue } = props;

  return (
    <div className="flex h-dvh w-full items-center justify-center bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-4 w-full max-w-xl rounded-2xl border border-zinc-200 bg-white/80 p-6 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/60">
        <div className="mb-3 text-xl font-semibold">Welcome to RV Service Desk</div>

        <p className="text-sm leading-6 text-zinc-700 dark:text-zinc-200">
          This tool helps RV technicians structure diagnostics and generate clear service documentation.
        </p>

        <p className="mt-3 text-sm leading-6 text-zinc-700 dark:text-zinc-200">
          Next: sign in with your corporate email, accept Terms &amp; Privacy, then start a case chat.
        </p>

        <div className="mt-6 flex items-center justify-end">
          <button
            type="button"
            onClick={onContinue}
            data-testid="welcome-continue-btn"
            className="
              rounded-xl px-5 py-2 text-sm font-semibold
              text-white
              bg-zinc-900 hover:bg-zinc-800
              dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200
            "
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

function TermsAcceptanceScreen(props: {
  termsVersion: string;
  onOpenTerms: () => void;
  onAccept: () => void;
  error?: string | null;
}) {
  const { termsVersion, onOpenTerms, onAccept, error } = props;
  const [checked, setChecked] = useState(false);

  return (
    <div className="flex h-dvh w-full items-center justify-center bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-4 w-full max-w-xl rounded-2xl border border-zinc-200 bg-white/80 p-6 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/60">
        <div className="mb-3 text-xl font-semibold">Terms &amp; Privacy</div>

        <p className="text-sm leading-6 text-zinc-700 dark:text-zinc-200">
          Please review and accept the Terms &amp; Privacy Policy to continue.
        </p>

        {error ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <div className="mt-6 flex items-start gap-3">
          <input
            id="terms"
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <label htmlFor="terms" className="text-sm text-zinc-700 dark:text-zinc-200">
            I agree to the{" "}
            <button
              type="button"
              onClick={onOpenTerms}
              className="font-medium text-red-600 hover:underline dark:text-red-400"
            >
              Terms &amp; Privacy Policy
            </button>{" "}
            (version {termsVersion}).
          </label>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={onOpenTerms}
            className="text-xs italic uppercase tracking-wider text-red-600 hover:underline dark:text-red-400"
          >
            View Terms &amp; Privacy
          </button>

          <button
            type="button"
            onClick={onAccept}
            disabled={!checked}
            data-testid="terms-accept-btn"
            className="
              rounded-xl px-5 py-2 text-sm font-semibold
              text-white
              disabled:cursor-not-allowed disabled:opacity-50
              bg-zinc-900 hover:bg-zinc-800
              dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200
            "
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const { user, loading: authLoading, logout, refresh } = useAuth();

  const [step, setStep] = useState<OnboardingStep>(() => {
    return "welcome";
  });

  const [termsVersion, setTermsVersion] = useState<string>("v1.0");
  const [termsMarkdown, setTermsMarkdown] = useState<string>("");
  const [termsLoading, setTermsLoading] = useState(true);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);

  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [hasActiveDraft, setHasActiveDraft] = useState(false);
  const [draftToken, setDraftToken] = useState(0);
  const [languageMode, setLanguageMode] = useState<LanguageMode>("AUTO");

  // User menu (header)
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  // Admin onboarding flag
  const [showAdminOnboarding, setShowAdminOnboarding] = useState(false);

  // Sidebar state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Check for billing callback params AND returning from admin pages
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const billingStatus = params.get("billing");
    const fromAdmin = params.get("from");
    
    if (billingStatus === "success") {
      void refresh();
      setShowAdminOnboarding(true);
      window.history.replaceState({}, "", window.location.pathname);
    } else if (billingStatus === "cancel") {
      window.history.replaceState({}, "", window.location.pathname);
    }
    
    if (fromAdmin === "admin") {
      setStep("app");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [refresh]);

  // Load local preferences
  useEffect(() => {
    try {
      const storedCaseId = localStorage.getItem("rv:lastCaseId");
      const storedLang = localStorage.getItem("rv:languageMode") as LanguageMode | null;

      if (storedCaseId) setActiveCaseId(storedCaseId);

      if (storedLang === "AUTO" || storedLang === "EN" || storedLang === "RU" || storedLang === "ES") {
        setLanguageMode(storedLang);
      }
    } catch {
      // ignore
    }
  }, []);

  // Persist preferences
  useEffect(() => {
    try {
      if (activeCaseId) localStorage.setItem("rv:lastCaseId", activeCaseId);
    } catch {
      // ignore
    }
  }, [activeCaseId]);

  useEffect(() => {
    try {
      localStorage.setItem("rv:languageMode", languageMode);
    } catch {
      // ignore
    }
  }, [languageMode]);

  // Close menu on outside click + ESC
  useEffect(() => {
    if (!userMenuOpen) return;

    function onMouseDown(e: MouseEvent) {
      const root = userMenuRef.current;
      if (!root) return;
      if (e.target instanceof Node && !root.contains(e.target)) {
        setUserMenuOpen(false);
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setUserMenuOpen(false);
    }

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [userMenuOpen]);

  // Load terms
  useEffect(() => {
    let cancelled = false;

    async function loadTerms() {
      setTermsLoading(true);
      setTermsError(null);

      try {
        const t = await fetchTerms();
        if (cancelled) return;

        setTermsVersion(t.version);
        setTermsMarkdown(t.markdown);

        const acc = loadTermsAcceptance();
        const ok = Boolean(acc?.accepted) && acc?.version === t.version;
        setTermsAccepted(ok);
      } catch (e: unknown) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Failed to load Terms";
        setTermsError(msg);
        setTermsAccepted(false);
      } finally {
        if (!cancelled) setTermsLoading(false);
      }
    }

    void loadTerms();
    return () => {
      cancelled = true;
    };
  }, []);

  const expectedStepAfterWelcome = useMemo<OnboardingStep>(() => {
    if (!user) return "auth";
    if (!termsAccepted) return "terms";

    const accessStatus = deriveAccessStatus({ authLoading: false, user });

    switch (accessStatus.kind) {
      case "no_org":
        return accessStatus.canCreateOrg ? "org_setup" : "no_org";
      case "not_a_member":
        return "not_a_member";
      case "billing_required":
        return "billing";
      case "blocked_domain":
        return "blocked";
      case "ready":
      default:
        return "app";
    }
  }, [user, termsAccepted]);

  // Sync step with state
  useEffect(() => {
    if (step === "welcome") return;

    const status = deriveAccessStatus({ authLoading, user });

    if (status.kind === "loading") return;

    if (status.kind === "signed_out") {
      if (step !== "auth") setStep("auth");
      return;
    }

    if (!termsAccepted) {
      if (step !== "terms") setStep("terms");
      return;
    }

    if (status.kind === "no_org") {
      const next: OnboardingStep = status.canCreateOrg ? "org_setup" : "no_org";
      if (step !== next) setStep(next);
      return;
    }

    if (status.kind === "not_a_member") {
      if (step !== "not_a_member") setStep("not_a_member");
      return;
    }

    if (status.kind === "billing_required") {
      if (step !== "billing") setStep("billing");
      return;
    }

    if (status.kind === "blocked_domain") {
      if (step !== "blocked") setStep("blocked");
      return;
    }

    if (
      step === "auth" ||
      step === "terms" ||
      step === "no_org" ||
      step === "not_a_member" ||
      step === "org_setup" ||
      step === "billing" ||
      step === "blocked"
    ) {
      setStep("app");
    }
  }, [step, user, termsAccepted, authLoading]);

  const userEmail = user?.email ?? "";

  // New case handler for header
  const handleNewCase = useCallback(async () => {
    setHasActiveDraft(true);
    setDraftToken((prev) => prev + 1);
    setActiveCaseId(null);
    setMobileMenuOpen(false);
  }, []);

  const handleSidebarCaseSelect = useCallback((caseId: string | null) => {
    setHasActiveDraft(false);
    setActiveCaseId(caseId);
  }, []);

  const handleChatCaseId = useCallback((caseId: string | null) => {
    if (caseId) {
      setHasActiveDraft(false);
    }
    setActiveCaseId(caseId);
  }, []);

  // Toggle sidebar
  const handleToggleSidebar = useCallback(() => {
    // On mobile, toggle drawer
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setMobileMenuOpen((prev) => !prev);
    } else {
      // On desktop, toggle collapse
      setSidebarCollapsed((prev) => !prev);
    }
  }, []);

  // Loading gate
  if (authLoading) {
    return (
      <div
        data-testid="auth-loading"
        className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--background)] text-[var(--foreground)]"
      >
        <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
          Loading...
        </div>
      </div>
    );
  }

  // 1) Welcome
  if (step === "welcome") {
    return <WelcomeScreen onContinue={() => setStep(expectedStepAfterWelcome)} />;
  }

  // 2) Auth
  if (step === "auth") {
    return <LoginScreen onAuthed={() => setStep(expectedStepAfterWelcome)} />;
  }

  // 3) Terms
  if (step === "terms") {
    if (termsLoading) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--background)] text-[var(--foreground)]">
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
            Loading Terms...
          </div>
        </div>
      );
    }

    if (termsAccepted) return null;

    return (
      <>
        <TermsAcceptanceScreen
          termsVersion={termsVersion}
          error={termsError}
          onOpenTerms={() => setShowTermsModal(true)}
          onAccept={() => {
            storeTermsAcceptance(termsVersion);
            setTermsAccepted(true);
            setStep(expectedStepAfterWelcome);
          }}
        />

        <TermsModal
          open={showTermsModal}
          title="Terms of Use & Privacy Notice"
          markdown={termsMarkdown}
          onClose={() => setShowTermsModal(false)}
        />
      </>
    );
  }

  // 4) No organization
  if (step === "no_org") {
    const status = deriveAccessStatus({ authLoading: false, user });
    const canCreateOrg = status.kind === "no_org" ? status.canCreateOrg : false;
    const defaultDomain = status.kind === "no_org" ? status.defaultDomain : undefined;
    const message = status.kind === "no_org" ? status.message : undefined;

    return (
      <NoOrganizationScreen
          message={message}
          canCreateOrg={canCreateOrg}
          defaultDomain={defaultDomain}
          onCreateOrg={() => setStep("org_setup")}
        />
    );
  }

  // 4b) Not a member
  if (step === "not_a_member") {
    return (
      <AccessBlockedScreen
          reason="not_a_member"
          message={user?.access?.message || "Contact your administrator to be added."}
          isAdmin={false}
          onLogout={() => void logout()}
        />
    );
  }

  // 5) Organization setup
  if (step === "org_setup") {
    return (
      <OrgSetupScreen
        onComplete={() => {
          void refresh().then(() => {
            setStep(expectedStepAfterWelcome);
          });
        }}
      />
    );
  }

  // 6) Billing paywall
  if (step === "billing") {
    return (
      <BillingPaywall
        onRefresh={() => {
          void refresh();
        }}
      />
    );
  }

  // 7) Blocked screen
  if (step === "blocked") {
    return (
      <AccessBlockedScreen
          reason={user?.access?.reason || "unknown"}
          message={user?.access?.message}
          isAdmin={user?.access?.isAdmin}
          onRefresh={() => {
            void refresh();
          }}
          onLogout={() => void logout()}
        />
    );
  }

  // 9) Main app
  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      {/* Sticky Header */}
      <AppHeader
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={handleToggleSidebar}
        onNewCase={handleNewCase}
        languageMode={languageMode}
        onLanguageChange={setLanguageMode}
        userMenuProps={{
          userMenuOpen,
          setUserMenuOpen,
          userMenuRef,
          userEmail,
          user,
          logout: () => void logout(),
          onOpenTerms: () => setShowTermsModal(true),
        }}
      />

      {/* Admin Onboarding Banner */}
      {showAdminOnboarding && user?.access?.isAdmin && (
        <div
          data-testid="admin-onboard-banner"
          className="flex items-center justify-between gap-4 border-b border-green-200 bg-green-50 px-4 py-3 dark:border-green-900/50 dark:bg-green-950/30"
        >
          <div className="flex items-center gap-3 min-w-0">
            <svg className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-sm font-medium text-green-800 dark:text-green-200 truncate">
              {user?.organization?.name || "Organization"} is ready! Invite your team to get started.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href="/admin/members"
              data-testid="admin-onboard-invite-link"
              className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-400"
            >
              Invite Team
            </a>
            <button
              type="button"
              onClick={() => setShowAdminOnboarding(false)}
              data-testid="admin-onboard-dismiss"
              className="rounded-md px-2 py-1 text-xs text-green-700 hover:bg-green-100 dark:text-green-300 dark:hover:bg-green-900/30"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Main content area */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar
          activeCaseId={activeCaseId}
          hasActiveDraft={hasActiveDraft}
          onSelectCase={handleSidebarCaseSelect}
          disabled={false}
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
          isMobileOpen={mobileMenuOpen}
          onMobileClose={() => setMobileMenuOpen(false)}
        />

        <main className="flex flex-1 flex-col min-w-0 overflow-hidden">
          <ChatPanel
            caseId={activeCaseId}
            draftToken={draftToken}
            languageMode={languageMode}
            onCaseId={handleChatCaseId}
            disabled={false}
          />
        </main>
      </div>

      <div className="safe-area-bottom shrink-0 border-t border-zinc-200 bg-white/80 px-4 py-2 text-right backdrop-blur md:hidden dark:border-zinc-800 dark:bg-zinc-950/70">
        <button
          type="button"
          onClick={() => setShowTermsModal(true)}
          data-testid="terms-privacy-mobile-btn"
          className="rounded px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-[#FF6B00] transition-colors hover:text-orange-400 hover:underline"
        >
          Terms &amp; Privacy
        </button>
      </div>

      {/* Terms & Privacy link - bottom-right, orange/red color */}
      <button
        type="button"
        onClick={() => setShowTermsModal(true)}
        data-testid="terms-privacy-btn"
        className="
          fixed bottom-4 right-4 z-30 hidden md:block
          px-2 py-1 rounded
          text-[11px] font-bold uppercase tracking-wide
          text-[#FF6B00] hover:text-orange-400 hover:underline
          transition-colors
        "
      >
        Terms & Privacy
      </button>

      <TermsModal
        open={showTermsModal}
        title="Terms of Use & Privacy Notice"
        markdown={termsMarkdown}
        onClose={() => setShowTermsModal(false)}
      />
    </div>
  );
}
