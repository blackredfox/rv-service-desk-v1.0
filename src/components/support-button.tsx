"use client";

import { useState } from "react";

type DiagnosticsData = {
  email?: string;
  orgId?: string;
  orgName?: string;
  memberRole?: string;
  memberStatus?: string;
  accessReason?: string;
  accessAllowed?: boolean;
  appVersion?: string;
};

type Props = {
  diagnostics?: DiagnosticsData;
};

/**
 * Floating support button with modal for contact + diagnostics copy
 */
export function SupportButton({ diagnostics }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const appVersion = diagnostics?.appVersion || process.env.NEXT_PUBLIC_APP_VERSION || "1.0.0";

  function formatDiagnostics(): string {
    const lines = [
      "--- RV Service Desk Diagnostics ---",
      `Timestamp: ${new Date().toISOString()}`,
      `App Version: ${appVersion}`,
    ];

    if (diagnostics?.email) {
      lines.push(`Email: ${diagnostics.email}`);
    }
    if (diagnostics?.orgId) {
      lines.push(`Org ID: ${diagnostics.orgId}`);
    }
    if (diagnostics?.orgName) {
      lines.push(`Org Name: ${diagnostics.orgName}`);
    }
    if (diagnostics?.memberRole) {
      lines.push(`Role: ${diagnostics.memberRole}`);
    }
    if (diagnostics?.memberStatus) {
      lines.push(`Status: ${diagnostics.memberStatus}`);
    }
    if (diagnostics?.accessReason) {
      lines.push(`Access Reason: ${diagnostics.accessReason}`);
    }
    if (diagnostics?.accessAllowed !== undefined) {
      lines.push(`Access Allowed: ${diagnostics.accessAllowed}`);
    }

    lines.push("-----------------------------------");
    return lines.join("\n");
  }

  async function handleCopyDiagnostics() {
    try {
      await navigator.clipboard.writeText(formatDiagnostics());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for browsers without clipboard API
      const textarea = document.createElement("textarea");
      textarea.value = formatDiagnostics();
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <>
      {/* Floating Button */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        data-testid="support-button"
        aria-label="Get support"
        className="
          fixed bottom-4 right-4 z-50
          flex h-12 w-12 items-center justify-center
          rounded-full bg-zinc-900 text-white shadow-lg
          hover:bg-zinc-800
          dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white
          transition-transform hover:scale-105
        "
      >
        <svg
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </button>

      {/* Modal Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-end p-4 sm:items-center sm:justify-center"
          onClick={() => setIsOpen(false)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />

          {/* Modal Panel */}
          <div
            onClick={(e) => e.stopPropagation()}
            data-testid="support-modal"
            className="
              relative w-full max-w-sm
              rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl
              dark:border-zinc-800 dark:bg-zinc-950
            "
          >
            {/* Close button */}
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              data-testid="support-modal-close"
              className="
                absolute right-3 top-3
                flex h-8 w-8 items-center justify-center
                rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600
                dark:hover:bg-zinc-900 dark:hover:text-zinc-300
              "
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              Need Help?
            </h2>

            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Contact our support team for assistance.
            </p>

            <div className="mt-5 space-y-3">
              {/* Contact Support */}
              <a
                href="mailto:support@rvservicedesk.com"
                data-testid="support-email-link"
                className="
                  flex w-full items-center justify-center gap-2
                  rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white
                  hover:bg-zinc-800
                  dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-white
                "
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Contact Support
              </a>

              {/* Copy Diagnostics */}
              <button
                type="button"
                onClick={handleCopyDiagnostics}
                data-testid="copy-diagnostics-button"
                className="
                  flex w-full items-center justify-center gap-2
                  rounded-md border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700
                  hover:bg-zinc-50
                  dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900
                "
              >
                {copied ? (
                  <>
                    <svg className="h-4 w-4 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Copied!
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy Diagnostics
                  </>
                )}
              </button>
            </div>

            <p className="mt-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
              Include diagnostics when contacting support for faster resolution.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
