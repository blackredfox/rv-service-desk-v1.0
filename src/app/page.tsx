"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "@/components/sidebar";
import { ChatPanel } from "@/components/chat-panel";
import dynamic from "next/dynamic";
const ThemeToggle = dynamic(
  () => import("@/components/theme-toggle").then((m) => m.ThemeToggle),
  { ssr: false }
);
import { LanguageSelector } from "@/components/language-selector";
import { TermsGate } from "@/components/terms-gate";
import { TermsModal } from "@/components/terms-modal";
import { fetchTerms, loadTermsAcceptance, storeTermsAcceptance } from "@/lib/terms";
import type { LanguageMode } from "@/lib/api";

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

  const termsGateOpen = !termsLoading && !termsAccepted;
  const appDisabled = termsGateOpen || termsLoading;

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

  return (
    <div className="flex h-dvh w-full bg-[var(--background)] text-[var(--foreground)]">
      <Sidebar
        activeCaseId={activeCaseId}
        onSelectCase={setActiveCaseId}
        disabled={appDisabled}
      />

      <div className="flex h-full flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-zinc-200 bg-white/70 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/50">
          <div className="flex items-center gap-3">
            <div className="text-sm font-semibold">RV Service Desk</div>
            <div className="hidden text-xs text-zinc-500 dark:text-zinc-400 md:block">
              Diagnostic & authorization agent
            </div>
            {termsError && (
              <div className="ml-3 text-xs text-red-600 dark:text-red-400">
                {termsError}
              </div>
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
          disabled={appDisabled}
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

      <TermsGate
        open={termsGateOpen}
        termsVersion={termsVersion}
        onOpenTerms={() => setShowTermsModal(true)}
        onAccept={() => {
          storeTermsAcceptance(termsVersion);
          setTermsAccepted(true);
        }}
      />

      {termsLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--background)]">
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
            Loading Terms...
          </div>
        </div>
      )}

      <TermsModal
        open={showTermsModal}
        title="Terms of Use & Privacy Notice"
        markdown={termsMarkdown}
        onClose={() => setShowTermsModal(false)}
      />
    </div>
  );
}
