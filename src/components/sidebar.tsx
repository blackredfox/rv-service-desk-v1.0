"use client";

import { useEffect, useMemo, useState } from "react";
import type { CaseSummary } from "@/lib/storage";
import { apiCreateCase, apiDeleteCase, apiListCases, apiSearch } from "@/lib/api";
import { analytics } from "@/lib/client-analytics";
import { formatTimeLeft, getUrgencyTier } from "@/lib/retention";

type Props = {
  activeCaseId: string | null;
  onSelectCase: (caseId: string | null) => void;
  disabled?: boolean;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
};

export function Sidebar({
  activeCaseId,
  onSelectCase,
  disabled,
  collapsed = false,
  onCollapsedChange,
  isMobileOpen = false,
  onMobileClose,
}: Props) {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return cases;
    const q = query.trim().toLowerCase();
    return cases.filter((c) => c.title.toLowerCase().includes(q));
  }, [cases, query]);

  async function refresh(): Promise<CaseSummary[]> {
    setLoading(true);
    setError(null);
    try {
      const res = query.trim() ? await apiSearch(query.trim()) : await apiListCases();
      setCases(res.cases);
      return res.cases;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load cases";
      setError(msg);
      return [];
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh().then((cs) => {
      if (!activeCaseId && cs.length > 0) {
        onSelectCase(cs[0].id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void refresh().then((cs) => {
        if (!activeCaseId && cs.length > 0) {
          onSelectCase(cs[0].id);
        }
      });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function onNewCase() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiCreateCase();
      await refresh();
      onSelectCase(res.case.id);
      void analytics.caseCreated(res.case.id);
      // Close mobile sidebar after creating case
      onMobileClose?.();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to create case";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function onDelete(caseId: string) {
    if (!confirm("Delete this case?")) return;
    setLoading(true);
    setError(null);
    try {
      await apiDeleteCase(caseId);
      const updated = await refresh();
      if (activeCaseId === caseId) {
        const next = updated.find((c) => c.id !== caseId);
        onSelectCase(next ? next.id : null);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to delete case";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  function handleCaseSelect(caseId: string) {
    onSelectCase(caseId);
    // Close mobile sidebar after selecting
    onMobileClose?.();
  }

  // Mobile overlay backdrop
  const mobileOverlay = isMobileOpen && (
    <div
      className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
      onClick={onMobileClose}
      data-testid="sidebar-mobile-overlay"
    />
  );

  // Collapsed state (desktop only) - narrow rail with icons
  if (collapsed && !isMobileOpen) {
    return (
      <aside
        data-testid="cases-sidebar-collapsed"
        className="
          hidden md:flex
          h-full w-16 flex-col items-center
          border-r border-zinc-200 bg-white/70 py-3 backdrop-blur
          dark:border-zinc-800 dark:bg-zinc-950/50
        "
      >
        {/* Expand button */}
        <button
          type="button"
          onClick={() => onCollapsedChange?.(false)}
          data-testid="sidebar-expand-btn"
          className="
            flex h-10 w-10 items-center justify-center
            rounded-lg text-zinc-600 hover:bg-zinc-100
            dark:text-zinc-400 dark:hover:bg-zinc-800
            mb-3
          "
          title="Expand sidebar"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </button>

        {/* New case button (icon only) */}
        <button
          type="button"
          data-testid="new-case-button-collapsed"
          onClick={() => void onNewCase()}
          disabled={Boolean(disabled)}
          className="
            flex h-10 w-10 items-center justify-center
            rounded-lg bg-zinc-900 text-white
            disabled:cursor-not-allowed disabled:opacity-50
            hover:bg-zinc-800
            dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-white
            mb-4
          "
          title="New case"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>

        {/* Case icons */}
        <div className="flex-1 overflow-y-auto w-full px-2 space-y-1">
          {filtered.slice(0, 10).map((c, index) => {
            const active = c.id === activeCaseId;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => handleCaseSelect(c.id)}
                className={`
                  flex h-10 w-full items-center justify-center
                  rounded-lg text-xs font-medium
                  ${active
                    ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
                  }
                `}
                title={c.title}
              >
                {index + 1}
              </button>
            );
          })}
        </div>
      </aside>
    );
  }

  // Full sidebar content
  const sidebarContent = (
    <>
      {/* Header with collapse button (desktop only) */}
      <div className="hidden md:flex items-center justify-between p-3 border-b border-zinc-200 dark:border-zinc-800">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Cases</span>
        <button
          type="button"
          onClick={() => onCollapsedChange?.(true)}
          data-testid="sidebar-collapse-btn"
          className="
            flex h-8 w-8 items-center justify-center
            rounded-lg text-zinc-500 hover:bg-zinc-100
            dark:text-zinc-400 dark:hover:bg-zinc-800
          "
          title="Collapse sidebar"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>
      </div>

      {/* Mobile header with close button */}
      <div className="flex md:hidden items-center justify-between p-3 border-b border-zinc-200 dark:border-zinc-800">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Cases</span>
        <button
          type="button"
          onClick={onMobileClose}
          data-testid="sidebar-mobile-close-btn"
          className="
            flex h-8 w-8 items-center justify-center
            rounded-lg text-zinc-500 hover:bg-zinc-100
            dark:text-zinc-400 dark:hover:bg-zinc-800
          "
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* New case button */}
      <div className="p-3">
        <button
          type="button"
          data-testid="new-case-button"
          onClick={() => void onNewCase()}
          disabled={Boolean(disabled)}
          className="w-full rounded-lg bg-zinc-900 px-3 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-white"
        >
          New case
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pb-3">
        <input
          data-testid="case-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search"
          disabled={Boolean(disabled)}
          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none disabled:cursor-not-allowed disabled:opacity-50 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-700"
        />
      </div>

      {error && <div className="px-3 pb-3 text-sm text-red-600 dark:text-red-400">{error}</div>}

      {/* Case list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {disabled && (
          <div className="px-2 py-2 text-xs text-zinc-500 dark:text-zinc-400">Accept Terms to begin.</div>
        )}

        {loading && cases.length === 0 && <div className="px-2 py-2 text-sm text-zinc-500">Loading...</div>}

        <ul className="space-y-1">
          {filtered.map((c) => {
            const active = c.id === activeCaseId;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => handleCaseSelect(c.id)}
                  className={
                    "group flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm " +
                    (active
                      ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                      : "hover:bg-zinc-100 text-zinc-700 dark:hover:bg-zinc-900 dark:text-zinc-200")
                  }
                >
                  <span className="line-clamp-1 pr-2 min-w-0">{c.title}</span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    <ExpiryBadge timeLeftSeconds={c.timeLeftSeconds} />
                    <span className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[11px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
                      {c.inputLanguage}
                    </span>
                    <span
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void onDelete(c.id);
                      }}
                      className="hidden cursor-pointer rounded px-1 text-zinc-500 hover:text-zinc-900 group-hover:inline dark:text-zinc-400 dark:hover:text-zinc-50"
                    >
                      ×
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {!loading && filtered.length === 0 && <div className="px-2 py-2 text-sm text-zinc-500">No cases</div>}
      </div>
    </>
  );

  return (
    <>
      {mobileOverlay}

      {/* Mobile drawer */}
      <aside
        data-testid="cases-sidebar-mobile"
        className={`
          fixed inset-y-0 left-0 z-50
          flex w-[280px] max-w-[85vw] flex-col
          border-r border-zinc-200 bg-white backdrop-blur
          dark:border-zinc-800 dark:bg-zinc-950
          transform transition-transform duration-300 ease-in-out
          md:hidden
          ${isMobileOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {sidebarContent}
      </aside>

      {/* Desktop sidebar */}
      <aside
        data-testid="cases-sidebar"
        className="
          hidden md:flex
          h-full w-[280px] flex-col
          border-r border-zinc-200
          bg-white/70 backdrop-blur
          dark:border-zinc-800 dark:bg-zinc-950/50
        "
      >
        {sidebarContent}
      </aside>
    </>
  );
}

/** Compact expiration badge. */
function ExpiryBadge({ timeLeftSeconds }: { timeLeftSeconds: number }) {
  const label = formatTimeLeft(timeLeftSeconds);
  const tier = getUrgencyTier(timeLeftSeconds);

  const tierStyles: Record<string, string> = {
    normal:  "border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400",
    warning: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400",
    urgent:  "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400",
    expired: "border-red-400 bg-red-100 text-red-800 dark:border-red-700 dark:bg-red-950/60 dark:text-red-300",
  };

  return (
    <span
      data-testid="expiry-badge"
      className={`rounded border px-1 py-0.5 text-[10px] font-medium leading-none tabular-nums ${tierStyles[tier]}`}
      title={tier === "expired" ? "Case expired" : `Expires in ${label}`}
    >
      {label}
    </span>
  );
}
