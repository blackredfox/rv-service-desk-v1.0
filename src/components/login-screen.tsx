"use client";

import { useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";

type Props = {
  onAuthed?: () => void;
};

type Mode = "signin" | "signup";

export function LoginScreen(props: Props) {
  const { onAuthed } = props;
  const { login, refresh } = useAuth();

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // optional fields for signup could be added later (name, company, etc.)
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const title = useMemo(() => (mode === "signin" ? "Sign in" : "Create account"), [mode]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const cleanEmail = email.trim();

      if (mode === "signup") {
        // Release-1 onboarding fix: allow first user to create account.
        // Backend route exists per Neo discovery: POST /api/auth/register
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: cleanEmail, password }),
          credentials: "same-origin",
        });

        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || "Registration failed");
        }
      }

      // After signup (or directly on signin) -> login
      await login(cleanEmail, password);

      // Ensure context is in sync (cookie/session)
      await refresh();

      onAuthed?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-[var(--background)] p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">RV Service Desk</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{title} to continue</p>
        </div>

        <div className="mb-3 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setMode("signin")}
            className={`rounded-full px-3 py-1 text-xs font-medium border ${
              mode === "signin"
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                : "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300"
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={`rounded-full px-3 py-1 text-xs font-medium border ${
              mode === "signup"
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                : "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300"
            }`}
          >
            Sign up
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-zinc-200 bg-white/80 p-6 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/60"
        >
          {error && (
            <div
              data-testid="login-error"
              className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
            >
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Email
              </label>
              <input
                id="email"
                data-testid="login-email-input"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none disabled:cursor-not-allowed disabled:opacity-50 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-700"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Password
              </label>
              <input
                id="password"
                data-testid="login-password-input"
                type="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none disabled:cursor-not-allowed disabled:opacity-50 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-700"
                placeholder={mode === "signup" ? "Create a password" : "Enter your password"}
              />
            </div>
          </div>

          <button
            type="submit"
            data-testid="login-submit-button"
            disabled={loading || !email.trim() || !password}
            className="mt-6 w-full rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-white"
          >
            {loading ? "Working..." : mode === "signup" ? "Create account" : "Sign in"}
          </button>

          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            {mode === "signup"
              ? "You will be able to sign in after creating your account."
              : "If you don't have an account yet, switch to Sign up."}
          </p>
        </form>
      </div>
    </div>
  );
}
