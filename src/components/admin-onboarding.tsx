"use client";

import { useRouter } from "next/navigation";

type Props = {
  orgName?: string;
  onSkip: () => void;
};

/**
 * Admin onboarding screen shown after org setup or first admin login
 * CTA to invite team members
 */
export function AdminOnboardingScreen({ orgName, onSkip }: Props) {
  const router = useRouter();

  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-[var(--background)] p-4">
      <div className="w-full max-w-md text-center">
        <div className="rounded-2xl border border-zinc-200 bg-white/80 p-8 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/60">
          {/* Success Icon */}
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-50 dark:bg-green-950/30">
            <svg
              className="h-8 w-8 text-green-600 dark:text-green-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>

          <h1
            data-testid="admin-onboard-title"
            className="text-xl font-semibold text-zinc-900 dark:text-zinc-50"
          >
            {orgName ? `${orgName} is Ready!` : "Organization Ready!"}
          </h1>

          <p
            data-testid="admin-onboard-message"
            className="mt-3 text-sm text-zinc-600 dark:text-zinc-400"
          >
            Your organization is all set up. Invite your team to start using RV Service Desk together.
          </p>

          <div className="mt-6 flex flex-col gap-3">
            <button
              type="button"
              onClick={() => router.push("/admin/members")}
              data-testid="admin-onboard-invite-button"
              className="w-full rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-white"
            >
              Invite Your Team
            </button>

            <button
              type="button"
              onClick={onSkip}
              data-testid="admin-onboard-skip-button"
              className="w-full rounded-md border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Skip for Now
            </button>
          </div>

          <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
            You can always invite members later from the admin dashboard.
          </p>
        </div>
      </div>
    </div>
  );
}
