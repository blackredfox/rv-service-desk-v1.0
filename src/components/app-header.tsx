"use client";

import { RefObject, useState } from "react";
import { usePathname } from "next/navigation";
import type { LanguageMode } from "@/lib/api";
import type { AuthUser } from "@/hooks/use-auth";

type UserMenuProps = {
  userMenuOpen: boolean;
  setUserMenuOpen: (open: boolean) => void;
  userMenuRef: RefObject<HTMLDivElement | null>;
  userEmail: string;
  user: AuthUser | null;
  logout: () => void;
  onOpenTerms: () => void;
};

type Props = {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onNewCase: () => void;
  languageMode: LanguageMode;
  onLanguageChange: (mode: LanguageMode) => void;
  userMenuProps: UserMenuProps;
  showMobileMenuButton?: boolean;
};

const SUPPORT_EMAIL = "support@rvservicedesk.com";

export function AppHeader({
  sidebarCollapsed,
  onToggleSidebar,
  onNewCase,
  languageMode,
  onLanguageChange,
  userMenuProps,
  showMobileMenuButton = true,
}: Props) {
  const {
    userMenuOpen,
    setUserMenuOpen,
    userMenuRef,
    userEmail,
    user,
    logout,
    onOpenTerms,
  } = userMenuProps;

  const [supportOpen, setSupportOpen] = useState(false);
  const [emailCopied, setEmailCopied] = useState(false);
  const [detailsCopied, setDetailsCopied] = useState(false);
  const pathname = usePathname();

  const languageLabels: Record<LanguageMode, string> = {
    AUTO: "Auto",
    EN: "EN",
    ES: "ES",
    RU: "RU",
  };

  async function copyToClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
        return true;
      } catch {
        return false;
      }
    }
  }

  async function handleCopyEmail() {
    const success = await copyToClipboard(SUPPORT_EMAIL);
    if (success) {
      setEmailCopied(true);
      setTimeout(() => setEmailCopied(false), 2000);
    }
  }

  async function handleCopyDetails() {
    const lines = [
      "RV Service Desk – Account Details",
      "--------------------------------",
      `Email: ${userEmail || "-"}`,
      `Page: ${pathname || "/"}`,
      `Timestamp: ${new Date().toISOString()}`,
    ];
    const success = await copyToClipboard(lines.join("\n"));
    if (success) {
      setDetailsCopied(true);
      setTimeout(() => setDetailsCopied(false), 2000);
    }
  }

  // Theme toggle
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== "undefined") {
      return document.documentElement.classList.contains("dark");
    }
    return false;
  });

  function toggleTheme() {
    const html = document.documentElement;
    if (html.classList.contains("dark")) {
      html.classList.remove("dark");
      setIsDark(false);
      localStorage.setItem("theme", "light");
    } else {
      html.classList.add("dark");
      setIsDark(true);
      localStorage.setItem("theme", "dark");
    }
  }

  return (
    <>
      <header
        data-testid="app-header"
        className="
          sticky top-0 z-40
          flex h-20 items-center justify-between
          border-b border-zinc-800 bg-zinc-900 px-3
          md:px-4
        "
      >
        {/* Left section: Toggle + Logo + New Case */}
        <div className="flex items-center gap-2 md:gap-3">
          {/* Sidebar toggle button */}
          {showMobileMenuButton && (
            <button
              type="button"
              onClick={onToggleSidebar}
              data-testid="sidebar-toggle-btn"
              aria-label={sidebarCollapsed ? "Open sidebar" : "Close sidebar"}
              className="
                flex h-9 w-9 items-center justify-center
                rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white
                transition-colors
              "
            >
              {sidebarCollapsed ? (
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              ) : (
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                </svg>
              )}
            </button>
          )}

          {/* Logo - official brand image */}
          <img
            src="/logo.jpg"
            alt="RV Service Desk"
            className="h-14 w-auto"
          />

          {/* New Case CTA - PRIMARY BUTTON (orange) */}
          <button
            type="button"
            onClick={onNewCase}
            data-testid="header-new-case-btn"
            className="
              ml-2 flex items-center gap-1.5
              rounded-lg bg-[#FF6B00] px-3 py-1.5
              text-xs font-bold text-white
              hover:bg-orange-600
              transition-colors
              md:ml-4 md:px-4 md:py-2 md:text-sm
            "
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            <span className="hidden sm:inline">New Case</span>
          </button>
        </div>

        {/* Right section: Controls */}
        <div className="flex items-center gap-2 md:gap-3">
          {/* User email - cyan, slightly larger */}
          <div className="relative" ref={userMenuRef}>
            <button
              type="button"
              data-testid="user-menu-button"
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="
                flex items-center gap-1.5
                rounded-lg px-2 py-1.5
                text-sm font-medium text-[#00CED1] hover:bg-zinc-800
                transition-colors
              "
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
            >
              <span className="hidden max-w-[120px] truncate md:block">
                {userEmail || "-"}
              </span>
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </button>

            {userMenuOpen && (
              <div
                role="menu"
                aria-label="User menu"
                className="
                  absolute right-0 mt-2 w-56 overflow-hidden rounded-xl
                  border border-zinc-700 bg-zinc-900 shadow-lg
                  z-50
                "
              >
                <div className="px-3 pb-2 pt-3 text-xs font-medium text-zinc-200">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                    Signed in as
                  </div>
                  <div className="mt-1 truncate text-[#00CED1]">{userEmail || "-"}</div>
                  {user?.organization && (
                    <div className="mt-1 text-[10px] text-zinc-400">
                      {user.organization.name}
                    </div>
                  )}
                </div>

                <div className="my-1 h-px bg-zinc-800" />

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
                    className="block w-full px-3 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-800"
                  >
                    Manage Billing
                  </button>
                )}

                {user?.access.isAdmin && (
                  <a
                    href="/admin/members"
                    role="menuitem"
                    data-testid="admin-members-link"
                    onClick={() => setUserMenuOpen(false)}
                    className="block w-full px-3 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-800"
                  >
                    Manage Members
                  </a>
                )}

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setUserMenuOpen(false);
                    onOpenTerms();
                  }}
                  className="block w-full px-3 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-800"
                >
                  Terms &amp; Privacy
                </button>

                <button
                  type="button"
                  role="menuitem"
                  data-testid="logout-button"
                  onClick={() => {
                    setUserMenuOpen(false);
                    logout();
                  }}
                  className="block w-full px-3 py-2 text-left text-xs font-medium text-[#FF6B00] hover:bg-zinc-800"
                >
                  Logout
                </button>
              </div>
            )}
          </div>

          {/* Language selector - integrated, orange */}
          <div className="flex items-center rounded-lg bg-[#FF6B00]/20 border border-[#FF6B00]/50">
            <span className="px-2 text-[10px] font-bold uppercase tracking-wider text-[#FF6B00]">
              Lang
            </span>
            <select
              data-testid="language-selector"
              value={languageMode}
              onChange={(e) => onLanguageChange(e.target.value as LanguageMode)}
              className="
                h-8 bg-transparent pr-6 pl-1
                text-xs font-bold text-[#FF6B00]
                outline-none cursor-pointer
                appearance-none
              "
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23FF6B00'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 4px center",
                backgroundSize: "16px",
              }}
            >
              {(["AUTO", "EN", "ES", "RU"] as LanguageMode[]).map((mode) => (
                <option key={mode} value={mode} className="bg-zinc-900 text-white">
                  {languageLabels[mode]}
                </option>
              ))}
            </select>
          </div>

          {/* Theme toggle - white */}
          <button
            type="button"
            onClick={toggleTheme}
            data-testid="theme-toggle"
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            className="
              flex h-8 items-center rounded-lg px-2
              bg-white/10 border border-white/30
              text-white hover:bg-white/20
              transition-colors
            "
          >
            {isDark ? (
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </button>

          {/* Support ? button - in header, far right */}
          <button
            type="button"
            onClick={() => setSupportOpen(true)}
            data-testid="support-button"
            aria-label="Get support"
            className="
              flex h-8 w-8 items-center justify-center
              rounded-lg bg-[#00CED1] text-zinc-900
              hover:bg-cyan-400
              transition-colors font-bold
            "
          >
            ?
          </button>
        </div>
      </header>

      {/* Support Modal */}
      {supportOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setSupportOpen(false)}
        >
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            onClick={(e) => e.stopPropagation()}
            data-testid="support-modal"
            className="
              relative w-full max-w-sm
              rounded-2xl border border-zinc-700 bg-zinc-900 p-5 shadow-xl
              max-h-[90vh] overflow-y-auto
            "
          >
            <button
              type="button"
              onClick={() => setSupportOpen(false)}
              data-testid="support-modal-close"
              className="
                absolute right-3 top-3
                flex h-8 w-8 items-center justify-center
                rounded-full text-zinc-400 hover:bg-zinc-800 hover:text-white
              "
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <h2 className="text-lg font-bold text-white">Need Help?</h2>
            <p className="mt-2 text-sm text-zinc-400">Contact our support team.</p>

            <div className="mt-5 space-y-3">
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                data-testid="support-email-link"
                className="
                  flex w-full items-center justify-center gap-2
                  rounded-lg bg-[#FF6B00] px-4 py-2.5 text-sm font-bold text-white
                  hover:bg-orange-600 transition-colors
                "
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Email Support
              </a>

              <button
                type="button"
                onClick={handleCopyEmail}
                data-testid="copy-support-email-button"
                className="
                  flex w-full items-center justify-center gap-2
                  rounded-lg border border-[#00CED1] bg-[#00CED1]/10 px-4 py-2.5 text-sm font-bold text-[#00CED1]
                  hover:bg-[#00CED1]/20 transition-colors
                "
              >
                {emailCopied ? (
                  <>
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Email Copied!
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy {SUPPORT_EMAIL}
                  </>
                )}
              </button>

              <div className="relative py-2">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-zinc-700" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-zinc-900 px-2 text-xs text-zinc-500">Additional</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleCopyDetails}
                data-testid="copy-account-details-button"
                className="
                  flex w-full items-center justify-center gap-2
                  rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-300
                  hover:bg-zinc-700 transition-colors
                "
              >
                {detailsCopied ? (
                  <>
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Details Copied!
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy Account Details
                  </>
                )}
              </button>
            </div>

            <p className="mt-4 text-center text-xs text-zinc-500">
              Include details when contacting support.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
