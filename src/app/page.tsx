"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "@/components/sidebar";
import { ChatPanel } from "@/components/chat-panel";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSelector } from "@/components/language-selector";
import { TermsGate } from "@/components/terms-gate";
import { TermsModal } from "@/components/terms-modal";
import { fetchTerms, loadTermsAcceptance, storeTermsAcceptance } from "@/lib/terms";
import type { LanguageMode } from "@/lib/api";

  const [termsVersion, setTermsVersion] = useState<string>("v1.0");
  const [termsMarkdown, setTermsMarkdown] = useState<string>("");
  const [termsLoading, setTermsLoading] = useState(true);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);

export default function Home() {
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [languageMode, setLanguageMode] = useState<LanguageMode>("AUTO");

  useEffect(() => {
    // restore last session
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

  return (
    <div data-testid="app-shell" className="flex h-dvh w-full bg-[var(--background)] text-[var(--foreground)]">
      <Sidebar activeCaseId={activeCaseId} onSelectCase={setActiveCaseId} />

      <div className="flex h-full flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-zinc-200 bg-white/70 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/50">
          <div className="flex items-center gap-3">
            <div className="text-sm font-semibold">RV Service Desk</div>
            <div className="hidden text-xs text-zinc-500 dark:text-zinc-400 md:block">
              Diagnostic & authorization agent
            </div>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSelector value={languageMode} onChange={setLanguageMode} />
            <ThemeToggle />
          </div>
        </header>

        <ChatPanel caseId={activeCaseId} languageMode={languageMode} onCaseId={setActiveCaseId} />
      </div>
    </div>
  );
}
