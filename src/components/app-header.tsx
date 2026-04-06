"use client";

import { RefObject } from "react";
import Image from "next/image";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSelector } from "@/components/language-selector";
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

  return (
    <header
      data-testid="app-header"
      className="
        sticky top-0 z-40
        flex h-14 items-center justify-between
        border-b border-zinc-200 bg-white/95 px-3 backdrop-blur
        dark:border-zinc-800 dark:bg-zinc-950/95
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
              rounded-lg text-zinc-600 hover:bg-zinc-100
              dark:text-zinc-400 dark:hover:bg-zinc-800
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

        {/* Logo + Wordmark */}
        <div className="flex items-center gap-2">
          <Image
            src="/logo.svg"
            alt="RV Service Desk"
            width={32}
            height={26}
            className="h-6 w-auto md:h-7"
            priority
          />
          <span className="hidden text-sm font-semibold text-zinc-900 dark:text-zinc-50 sm:block">
            RV Service Desk
          </span>
        </div>

        {/* New Case CTA - always visible */}
        <button
          type="button"
          onClick={onNewCase}
          data-testid="header-new-case-btn"
          className="
            ml-2 flex items-center gap-1.5
            rounded-lg bg-orange-500 px-3 py-1.5
            text-xs font-semibold text-white
            hover:bg-orange-600
            transition-colors
            md:ml-4 md:px-4 md:py-2 md:text-sm
          "
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span className="hidden xs:inline">New Case</span>
          <span className="xs:hidden">New</span>
        </button>
      </div>

      {/* Right section: Controls */}
      <div className="flex items-center gap-1.5 md:gap-3">
        {/* User menu */}
        <div className="relative" ref={userMenuRef}>
          <button
            type="button"
            data-testid="user-menu-button"
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="
              flex items-center gap-1.5
              rounded-lg border border-zinc-200 px-2 py-1.5
              text-xs font-medium text-zinc-700 hover:bg-zinc-50
              dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900
              transition-colors
            "
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
          >
            <span className="hidden max-w-[100px] truncate md:block md:max-w-[140px]">
              {userEmail || "-"}
            </span>
            <svg className="h-4 w-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </button>

          {userMenuOpen && (
            <div
              role="menu"
              aria-label="User menu"
              className="
                absolute right-0 mt-2 w-56 overflow-hidden rounded-xl
                border border-zinc-200 bg-white shadow-lg
                dark:border-zinc-800 dark:bg-zinc-950
                z-50
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

              {/* Admin Members Dashboard (admin only) */}
              {user?.access.isAdmin && (
                <a
                  href="/admin/members"
                  role="menuitem"
                  data-testid="admin-members-link"
                  onClick={() => setUserMenuOpen(false)}
                  className="
                    block w-full px-3 py-2 text-left text-xs
                    text-zinc-700 hover:bg-zinc-50
                    dark:text-zinc-200 dark:hover:bg-zinc-900
                  "
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
                  logout();
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
          )}
        </div>

        <LanguageSelector value={languageMode} onChange={onLanguageChange} />
        <ThemeToggle />
      </div>
    </header>
  );
}
