"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "@/components/sidebar";
import { ChatPanel } from "@/components/chat-panel";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSelector } from "@/components/language-selector";
import { TermsModal } from "@/components/terms-modal";
import { fetchTerms, loadTermsAcceptance, storeTermsAcceptance } from "@/lib/terms";
import type { LanguageMode } from "@/lib/api";

function WelcomeScreen(props: {
  termsVersion: string;
  onOpenTerms: () => void;
  onAccept: () => void;
}) {
  const { termsVersion, onOpenTerms, onAccept } = props;
  const [checked, setChecked] = useState(false);

  return (
    <div className="flex h-dvh w-full items-center justify-center bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-4 w-full max-w-xl rounded-2xl border border-zinc-200 bg-white/80 p-6 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/60">
        <div className="mb-3 text-xl font-semibold">Welcome to RV Service Desk</div>

        <p className="text-sm leading-6 text-zinc-700 dark:text-zinc-200">
          This tool helps RV technicians quickly structure diagnostics and generate clear, professional
          service documentation for warranty and service workflows.
        </p>

        <p className="mt-3 text-sm leading-6 text-zinc-700 dark:text-zinc-200">
          Describe the issue in chat — the assistant will help you ask the right questions and produce
          a ready-to-copy report.
        </p>

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
            START
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [termsVersion, setTermsVersion] = useState<string>("v1.0");
  const [termsMarkdown, setTermsMarkdown] = useState<string>("");
  const [termsLoading, setTermsLoading] = useState(true);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);

  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [languageMode, setLanguageMode] = useState<LanguageMode>("AUTO");

  useEffect(() => {
    try {
      const storedCaseId = localStorage.getItem("rv:lastCaseId");
      const storedLang = localStorage.getItem("rv:languageMode") as LanguageMode | null;

      if (storedCaseId) queueMicrotask(() => setActiveCaseId(storedCaseId));
      if (storedLang === "AUTO" || storedLang === "EN" || storedLang === "RU" || storedLang === "ES") {
        queueMicrotask(() => setLanguageMode(storedLang));
      }
    } catch {
      // ignore
    }
  }, []);

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

  useEffect(() => {
    try {
      if (activeCaseId) localStorage.setItem("rv:lastCaseId", activeCaseId);
    } catch {}
  }, [activeCaseId]);

  useEffect(() => {
    try {
      localStorage.setItem("rv:languageMode", languageMode);
    } catch {}
  }, [languageMode]);

  // 1) Loading state (blocking)
  if (termsLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--background)] text-[var(--foreground)]">
        <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
          Loading Terms...
        </div>
      </div>
    );
  }

  // 2) Welcome gate (replaces the old "Accept terms" blank page)
  if (!termsAccepted) {
    return (
      <>
        <WelcomeScreen
          termsVersion={termsVersion}
          onOpenTerms={() => setShowTermsModal(true)}
          onAccept={() => {
            storeTermsAcceptance(termsVersion);
            setTermsAccepted(true);
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

  // 3) Main app
  return (
    <div className="flex h-dvh w-full bg-[var(--background)] text-[var(--foreground)]">
     <Sidebar
  activeCaseId={activeCaseId}
  onSelectCase={setActiveCaseId}
  disabled={false}
/>

      <div className="flex h-full flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-zinc-200 bg-white/70 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/50">
          <div className="flex items-center gap-3">
            <div className="text-sm font-semibold">RV Service Desk</div>
            <div className="hidden text-xs text-zinc-500 dark:text-zinc-400 md:block">
              Diagnostic & authorization agent
            </div>
            {termsError && (
              <div className="ml-3 text-xs text-red-600 dark:text-red-400">{termsError}</div>
            )}
          </div>

          <div className="flex items-center gap-3">
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

      {/* Bottom-right Terms & Privacy link */}
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
