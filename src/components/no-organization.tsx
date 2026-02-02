"use client";

import { isClientDevBypassDomainGatingHintEnabled } from "@/lib/dev-flags";

export function NoOrganizationScreen(props: {
  message?: string;
  canCreateOrg: boolean;
  defaultDomain?: string;
  onCreateOrg: () => void;
}) {
  const { message, canCreateOrg, defaultDomain, onCreateOrg } = props;

  const devHint = isClientDevBypassDomainGatingHintEnabled();

  return (
    <div
      data-testid="no-org-screen"
      className="flex min-h-dvh w-full items-center justify-center bg-[var(--background)] p-4"
    >
      <div className="w-full max-w-md text-center">
        <div className="rounded-2xl border border-zinc-200 bg-white/80 p-8 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/60">
          <h1
            data-testid="no-org-title"
            className="text-xl font-semibold text-zinc-900 dark:text-zinc-50"
          >
            No Organization
          </h1>

          <p
            data-testid="no-org-message"
            className="mt-3 text-sm text-zinc-600 dark:text-zinc-400"
          >
            {message || "Your email domain is not registered with any organization."}
          </p>

          {defaultDomain ? (
            <div className="mt-4 rounded-lg bg-zinc-50 px-4 py-3 text-left text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
              Suggested domain: <span className="font-medium">{defaultDomain}</span>
            </div>
          ) : null}

          {devHint ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              DEV MODE: Domain gating bypass hint is enabled.
            </div>
          ) : null}

          <div className="mt-6 flex flex-col gap-3">
            {canCreateOrg ? (
              <button
                type="button"
                data-testid="no-org-create-org-button"
                onClick={onCreateOrg}
                className="w-full rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-white"
              >
                Set up organization
              </button>
            ) : (
              <div data-testid="no-org-contact-admin" className="text-xs text-zinc-500 dark:text-zinc-400">
                Please contact your organization administrator for access.
              </div>
            )}

            <a
              data-testid="no-org-contact-support"
              href="mailto:support@rvservicedesk.com"
              className="text-xs text-zinc-600 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              Contact support
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
