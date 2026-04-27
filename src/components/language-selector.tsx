"use client";

import type { LanguageMode } from "@/lib/api";

type Props = {
  value: LanguageMode;
  onChange: (v: LanguageMode) => void;
};

export function LanguageSelector({ value, onChange }: Props) {
  return (
    <div data-testid="language-selector" className="flex items-center gap-2">
      <label
        htmlFor="language-selector-select"
        className="text-xs font-medium text-zinc-600 dark:text-zinc-300"
      >
        Input language
      </label>
      <select
        id="language-selector-select"
        data-testid="language-selector-select"
        value={value}
        onChange={(e) => onChange(e.target.value as LanguageMode)}
        className="
          h-10 rounded-xl border border-zinc-200 bg-white px-3 pr-8
          text-sm text-zinc-900 shadow-sm outline-none
          focus:ring-2 focus:ring-zinc-300
          dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-700
          transition-colors
        "
      >
        <option value="AUTO">Auto</option>
        <option value="EN">EN</option>
        <option value="RU">RU</option>
        <option value="ES">ES</option>
      </select>
    </div>
  );
}
