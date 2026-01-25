"use client";

import { useEffect, useMemo, useState } from "react";
import type { CaseSummary } from "@/lib/storage";
import { apiCreateCase, apiDeleteCase, apiListCases, apiSearch } from "@/lib/api";

type Props = {
  activeCaseId: string | null;
  onSelectCase: (caseId: string | null) => void;
};

export function Sidebar({ activeCaseId, onSelectCase, disabled, onOpenTerms, onOpenPrivacy }: Props & { disabled?: boolean; onOpenTerms?: () => void; onOpenPrivacy?: () => void }) {
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
      if (!activeCaseId && cs.length > 0) onSelectCase(cs[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void refresh().then((cs) => {
        if (!activeCaseId && cs.length > 0) onSelectCase(cs[0].id);
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

  return (
    <aside
      data-testid="cases-sidebar"
      className="flex h-full w-[320px] flex-col border-r border-zinc-200 bg-white/70 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/50"
    >
      <div className="p-3">
        <button
          type="button"
          data-testid="new-case-button"
          onClick={() => void onNewCase()}
          className="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-white"
        >
          New case
        </button>
      </div>

      <div className="px-3 pb-3">
        <input
          data-testid="case-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search"
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-700"
        />
      </div>

      {error ? (
        <div
          data-testid="cases-sidebar-error"
          className="px-3 pb-3 text-sm text-red-600 dark:text-red-400"
        >
          {error}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {loading && cases.length === 0 ? (
          <div data-testid="cases-sidebar-loading" className="px-2 py-2 text-sm text-zinc-500">
            Loading...
          </div>
        ) : null}

        <ul className="space-y-1">
          {filtered.map((c) => {
            const active = c.id === activeCaseId;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  data-testid={`case-item-${c.id}`}
                  onClick={() => onSelectCase(c.id)}
                  className={
                    "group flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm " +
                    (active
                      ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                      : "hover:bg-zinc-100 text-zinc-700 dark:hover:bg-zinc-900 dark:text-zinc-200")
                  }
                >
                  <span className="line-clamp-1 pr-2">{c.title}</span>
                  <span className="flex items-center gap-2">
                    <span className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[11px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
                      {c.inputLanguage}
                    </span>
                    <span
                      data-testid={`case-delete-${c.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void onDelete(c.id);
                      }}
                      className="hidden cursor-pointer rounded px-1 text-zinc-500 hover:text-zinc-900 group-hover:inline dark:text-zinc-400 dark:hover:text-zinc-50"
                      role="button"
                      aria-label="Delete case"
                    >
                      ×
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {!loading && filtered.length === 0 ? (
          <div data-testid="cases-sidebar-empty" className="px-2 py-2 text-sm text-zinc-500">
            No cases
          </div>
        ) : null}
      </div>
    </aside>
  );
}
