"use client";

type Props = {
  open: boolean;
  title: string;
  markdown: string;
  onClose: () => void;
};

export function TermsModal({ open, title, markdown, onClose }: Props) {
  if (!open) return null;

  return (
    <div
      data-testid="terms-modal"
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
    >
      <div
        data-testid="terms-modal-backdrop"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div className="relative mx-4 flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div data-testid="terms-modal-title" className="text-sm font-semibold">
            {title}
          </div>
          <button
            type="button"
            data-testid="terms-modal-close-button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <pre
            data-testid="terms-modal-content"
            className="whitespace-pre-wrap text-sm leading-6 text-zinc-900 dark:text-zinc-50"
          >
            {markdown}
          </pre>
        </div>
      </div>
    </div>
  );
}
