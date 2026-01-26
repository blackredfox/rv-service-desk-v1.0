"use client";

import { useTheme } from "next-themes";

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const current = theme === "system" ? resolvedTheme : theme;

  return (
    <button
      type="button"
      data-testid="theme-toggle-button"
      onClick={() => setTheme(current === "dark" ? "light" : "dark")}
      className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-zinc-900"
      aria-label="Toggle theme"
    >
      {current === "dark" ? "Dark" : "Light"}
    </button>
  );
}
