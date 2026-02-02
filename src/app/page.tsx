"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Sidebar } from "@/components/sidebar";
import { ChatPanel } from "@/components/chat-panel";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSelector } from "@/components/language-selector";
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
  | "no_org" // No organization exists for the user's domain (show create-org or contact-admin)
  | "org_setup" // Create organization
  | "billing" // Subscribe (if org exists but no subscription)
  | "blocked" // Access blocked (various reasons)
  | "start"
  | "app";

/**
 * NOTE (maintainability):
 * - We keep onboarding steps as a small state-machine in one place.
 * - No setState calls inside render branches (avoids React warnings + future debugging pain).
 * - B2B flow: welcome -> auth -> terms -> org_setup/billing -> start -> app
 */

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

function StartScreen(props: { onStart: () => void }) {
  const { onStart } = props;

  return (
    <div className="flex h-dvh w-full items-center justify-center bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-4 w-full max-w-xl rounded-2xl border border-zinc-200 bg-white/80 p-6 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/60">
        <div className="mb-3 text-xl font-semibold">All set</div>

        <p className="text-sm leading-6 text-zinc-700 dark:text-zinc-200">
          You can now start a case and chat with the assistant.
        </p>

        <div className="mt-6 flex items-center justify-end">
          <button
            type="button"
            onClick={onStart}
            data-testid="start-btn"
            className="
              rounded-xl px-5 py-2 text-sm font-semibold
              text-white
              bg-zinc-900 hover:bg-zinc-800
              dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200
            "
          >
            Start
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const { user, loading: authLoading, logout, refresh } = useAuth();

  const [step, setStep] = useState<OnboardingStep>("welcome");

  const [termsVersion, setTermsVersion] = useState<string>("v1.0");
  const [termsMarkdown, setTermsMarkdown] = useState<string>("");
  const [termsLoading, setTermsLoading] = useState(true);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);

  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [languageMode, setLanguageMode] = useState<LanguageMode>("AUTO");

  // User menu (header)
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  // Check for billing callback params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const billingStatus = params.get("billing");
    
    if (billingStatus === "success") {
      // Refresh user data to get updated subscription
      void refresh();
      // Clean URL
      window.history.replaceState({}, "", window.location.pathname);
    } else if (billingStatus === "cancel") {
      // Just clean URL
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [refresh]);

  // Load local preferences (case + language)
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

  // Load terms (version + markdown) + acceptance state
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

  /**
   * Compute the expected step based on current state
   */
  const expectedStepAfterWelcome = useMemo<OnboardingStep>(() => {
    // Not authenticated
    if (!user) return "auth";

    // Terms not accepted
    if (!termsAccepted) return "terms";

    const accessStatus = deriveAccessStatus({ authLoading: false, user });

    switch (accessStatus.kind) {
      case "no_org":
        // If user can create an org, we go straight to org setup.
        // Otherwise we show a stable "No organization" screen.
        return accessStatus.canCreateOrg ? "org_setup" : "no_org";
      case "billing_required":
        return "billing";
      case "blocked_domain":
        return "blocked";
      case "ready":
      default:
        return "start";
    }
  }, [user, termsAccepted]);

  // Sync step with state
  useEffect(() => {
    // Do not auto-advance from welcome: user must click Continue.
    if (step === "welcome") return;

    // Use a single derived access status to avoid divergent gating logic.
    const status = deriveAccessStatus({ authLoading, user });

    // During loading: freeze the UI (no redirects, no step changes).
    if (status.kind === "loading") return;

    // Signed out
    if (status.kind === "signed_out") {
      if (step !== "auth") setStep("auth");
      return;
    }

    // Terms gate (after sign-in, before any org/billing decisions)
    if (!termsAccepted) {
      if (step !== "terms") setStep("terms");
      return;
    }

    // Post-terms gating
    if (status.kind === "no_org") {
      const next: OnboardingStep = status.canCreateOrg ? "org_setup" : "no_org";
      if (step !== next) setStep(next);
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

    // Ready
    if (
      step === "auth" ||
      step === "terms" ||
      step === "no_org" ||
      step === "org_setup" ||
      step === "billing" ||
      step === "blocked"
    ) {
      setStep("start");
    }
  }, [step, user, termsAccepted, authLoading]);

  // Convenience: safe email display (prevents TS 'possibly null')
  const userEmail = user?.email ?? "";

  // Loading gate: keep stable UI while auth/me is unresolved.
  // No redirects, no step flips during loading.
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

  // 1) Welcome (always first)
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

    // If accepted already, step machine will move to start; render nothing for a moment.
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

  // 4) No organization (stable screen)
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

  // 5) Organization setup (admin creates org)
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

  // 5) Billing paywall (admin subscribes)
  if (step === "billing") {
    return (
      <BillingPaywall
        onRefresh={() => {
          void refresh();
        }}
      />
    );
  }

  // 6) Blocked screen (various reasons)
  if (step === "blocked") {
    return (
      <AccessBlockedScreen
        reason={user?.access?.reason || "unknown"}
        message={user?.access?.message}
        isAdmin={user?.access?.isAdmin}
        onRefresh={() => {
          void refresh();
        }}
      />
    );
  }

  // 7) Start (explicit step before app)
  if (step === "start") {
    return <StartScreen onStart={() => setStep("app")} />;
  }

  // 8) Main app
  return (
    <div className="flex h-dvh w-full bg-[var(--background)] text-[var(--foreground)]">
      <Sidebar activeCaseId={activeCaseId} onSelectCase={setActiveCaseId} disabled={false} />

      <div className="flex h-full flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-zinc-200 bg-white/70 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/50">
          <div className="flex items-center gap-3">
            <div className="text-sm font-semibold">RV Service Desk</div>
            <div className="hidden text-xs text-zinc-500 dark:text-zinc-400 md:block">
              Diagnostic & authorization agent
            </div>
            {user?.organization && (
              <div className="hidden text-xs text-zinc-500 dark:text-zinc-400 md:block">
                • {user.organization.name}
              </div>
            )}
            {termsError ? (
              <div className="ml-3 text-xs text-red-600 dark:text-red-400">{termsError}</div>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            {/* User menu */}
            <div className="relative" ref={userMenuRef}>
              <button
                type="button"
                data-testid="user-menu-button"
                onClick={() => setUserMenuOpen((v) => !v)}
                className="
                  flex items-center gap-2
                  rounded-md border border-zinc-200 px-2 py-1
                  text-xs font-medium text-zinc-700 hover:bg-zinc-50
                  dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900
                "
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
              >
                <span className="block max-w-[160px] truncate">{userEmail || "-"}</span>
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400">▾</span>
              </button>

              {userMenuOpen ? (
                <div
                  role="menu"
                  aria-label="User menu"
                  className="
                    absolute right-0 mt-2 w-56 overflow-hidden rounded-xl
                    border border-zinc-200 bg-white shadow-lg
                    dark:border-zinc-800 dark:bg-zinc-950
                  "
                >
                  <div className="px-3 pb-2 pt-3 text-xs font-medium text-zinc-700 dark:text-zinc-200">
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      Signed in as
                    </div>
                    <div className="mt-1 truncate">{userEmail || "-"}</div>
                    {user?.organization && (
                      <div className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                        {user.organization.name}
                      </div>
                    )}
                  </div>

                  <div className="my-1 h-px bg-zinc-200 dark:bg-zinc-800" />

                  {/* Billing portal (admin only) */}
                  {user?.access.isAdmin && user?.organization?.subscriptionStatus === "active" && (
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="billing-portal-button"
                      onClick={async () => {
                        setUserMenuOpen(false);
                        try {
                          const res = await fetch("/api/billing/portal", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ returnUrl: window.location.href }),
                            credentials: "same-origin",
                          });
                          if (res.ok) {
                            const data = await res.json();
                            window.location.href = data.url;
                          }
                        } catch {
                          // ignore
                        }
                      }}
                      className="
                        block w-full px-3 py-2 text-left text-xs
                        text-zinc-700 hover:bg-zinc-50
                        dark:text-zinc-200 dark:hover:bg-zinc-900
                      "
                    >
                      Manage Billing
                    </button>
                  )}

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setUserMenuOpen(false);
                      setShowTermsModal(true);
                    }}
                    className="
                      block w-full px-3 py-2 text-left text-xs
                      text-zinc-700 hover:bg-zinc-50
                      dark:text-zinc-200 dark:hover:bg-zinc-900
                    "
                  >
                    Terms &amp; Privacy
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    data-testid="logout-button"
                    onClick={() => {
                      setUserMenuOpen(false);
                      void logout();
                    }}
                    className="
                      block w-full px-3 py-2 text-left text-xs font-medium
                      text-red-600 hover:bg-red-50
                      dark:text-red-400 dark:hover:bg-red-950/30
                    "
                  >
                    Logout
                  </button>
                </div>
              ) : null}
            </div>

            <LanguageSelector value={languageMode} onChange={setLanguageMode} />
            <ThemeToggle />
          </div>
        </header>

        <ChatPanel
          caseId={activeCaseId}
          languageMode={languageMode}
          onCaseId={setActiveCaseId}
          disabled={false}
        />
      </div>

      <button
        type="button"
        onClick={() => setShowTermsModal(true)}
        className="
          fixed bottom-2 right-3 z-40
          text-[9px] italic uppercase
          tracking-wider
          text-red-600 hover:underline
          dark:text-red-400
        "
      >
        TERMS AND PRIVACY
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
