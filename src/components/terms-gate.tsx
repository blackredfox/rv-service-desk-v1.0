"use client";

import { useState } from "react";

type Props = {
  open: boolean;
  termsVersion: string;
  onAccept: () => void;
  onOpenTerms: () => void;
};

export function TermsGate({ open, termsVersion, onAccept, onOpenTerms }: Props) {
  const [checked, setChecked] = useState(false);

  if (!open) return null;

  return (
    <div
      data-testid="terms-gate"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--background)]"
    >
      <div className="mx-4 w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
        <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Terms of Use & Privacy Notice
        </div>
        <div data-testid="terms-gate-version" className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Version: {termsVersion}
        </div>

        <p className="mt-4 text-sm leading-6 text-zinc-700 dark:text-zinc-200">
          Before using RV Service Desk, you must review and accept the Terms of Use and Privacy Notice.
        </p>

        <button
          type="button"
          data-testid="terms-gate-open-doc-button"
          onClick={onOpenTerms}
          className="mt-4 inline-flex items-center rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-zinc-900"
        >
          View full Terms & Privacy
        </button>

        <label className="mt-5 flex items-start gap-3 text-sm text-zinc-700 dark:text-zinc-200">
          <input
            data-testid="terms-gate-checkbox"
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-950"
          />
          <span>I agree to the Terms of Use and Privacy Notice.</span>
        </label>

        <button
          type="button"
          data-testid="terms-gate-accept-button"
          disabled={!checked}
          onClick={onAccept}
          className="mt-5 w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-white"
        >
          Accept and Continue
        </button>

        <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          This tool assists with documentation only. Technicians remain responsible for all decisions and actions.
        </div>
      </div>
    </div>
  );
}
