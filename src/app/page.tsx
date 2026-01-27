"use client";

import { useEffect, useMemo, useState } from "react";
import { Sidebar } from "@/components/sidebar";
import { ChatPanel } from "@/components/chat-panel";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSelector } from "@/components/language-selector";
import { TermsModal } from "@/components/terms-modal";
import { LoginScreen } from "@/components/login-screen";
import { useAuth } from "@/hooks/use-auth";
import { fetchTerms, loadTermsAcceptance, storeTermsAcceptance } from "@/lib/terms";
import type { LanguageMode } from "@/lib/api";

type OnboardingStep = "welcome" | "auth" | "terms" | "start" | "app";

/**
 * NOTE (maintainability):
 * - We keep onboarding steps as a small state-machine in one place.
 * - No setState calls inside render branches (avoids React warnings + future debugging pain).
 * - Later (Release 1.1) we can move Welcome/Terms/Start into /components/onboarding/* without logic changes.
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
          Next: sign in, accept Terms &amp; Privacy, then start a case chat.
        </p>

        <div className="mt-6 flex items-center justify-end">
          <button
            type="button"
            onClick={onContinue}
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
  const { user, loading: authLoading, logout } = useAuth();

  const [step, setStep] = useState<OnboardingStep>("welcome");

  const [termsVersion, setTermsVersion] = useState<string>("v1.0");
  const [termsMarkdown, setTermsMarkdown] = useState<string>("");
  const [termsLoading, setTermsLoading] = useState(true);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);

  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [languageMode, setLanguageMode] = useState<LanguageMode>("AUTO");

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
   * Step machine guard:
   * Keeps step consistent when auth/terms state changes.
   * Example: user logs out -> force step to "auth" (unless still at welcome).
   */
  const expectedStepAfterWelcome = useMemo<OnboardingStep>(() => {
    if (!user) return "auth";
    if (!termsAccepted) return "terms";
    return "start";
  }, [user, termsAccepted]);

  useEffect(() => {
    // Do not auto-advance from welcome: user must click Continue.
    if (step === "welcome") return;

    // If user is not authenticated, only "auth" is allowed.
    if (!user) {
      if (step !== "auth") setStep("auth");
      return;
    }

    // If user is authenticated but terms not accepted, force "terms"
    if (!termsAccepted) {
      if (step !== "terms") setStep("terms");
      return;
    }

    // If auth + terms accepted, "start" or "app" are allowed.
    if (step === "auth" || step === "terms") {
      setStep("start");
    }
  }, [step, user, termsAccepted]);

  // Convenience: safe email display (prevents TS 'possibly null')
  const userEmail = user?.email ?? "";

  // Loading gate (but do NOT force login; we still want Welcome first)
  if (authLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--background)] text-[var(--foreground)]">
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
            setStep("start");
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

  // 4) Start (explicit step before app)
  if (step === "start") {
    return <StartScreen onStart={() => setStep("app")} />;
  }

  // 5) Main app
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
            {termsError ? (
              <div className="ml-3 text-xs text-red-600 dark:text-red-400">{termsError}</div>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              {userEmail ? (
                <span className="hidden text-xs text-zinc-600 dark:text-zinc-400 sm:inline">
                  {userEmail}
                </span>
              ) : null}

              <button
                type="button"
                data-testid="logout-button"
                onClick={() => void logout()}
                className="rounded-md border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Logout
              </button>
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
