"use client";

import { useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { isClientDevBypassDomainGatingHintEnabled } from "@/lib/dev-flags";

type Props = {
  onAuthed?: () => void;
};

type Mode = "signin" | "signup" | "forgot";

const FORGOT_PASSWORD_SUCCESS_MESSAGE =
  "If an account exists for that email, a reset link has been sent.";

export function LoginScreen(props: Props) {
  const { onAuthed } = props;
  const { login, refresh } = useAuth();

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // optional fields for signup could be added later (name, company, etc.)
  const [error, setError] = useState<string | null>(null);
  const [forgotPasswordSuccess, setForgotPasswordSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const title = useMemo(() => {
    if (mode === "signup") return "Create account";
    if (mode === "forgot") return "Reset your password";
    return "Sign in";
  }, [mode]);

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setError(null);
    if (nextMode !== "forgot") {
      setForgotPasswordSuccess(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const cleanEmail = email.trim();

      if (mode === "forgot") {
        const res = await fetch("/api/auth/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: cleanEmail }),
          credentials: "same-origin",
        });

        const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };

        if (!res.ok) {
          throw new Error(data.error || "Unable to send reset link");
        }

        setForgotPasswordSuccess(data.message || FORGOT_PASSWORD_SUCCESS_MESSAGE);
        return;
      }

      setForgotPasswordSuccess(null);

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
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            {mode === "forgot" ? "Enter your email to request a reset link." : `${title} to continue`}
          </p>

          {isClientDevBypassDomainGatingHintEnabled() ? (
            <div
              data-testid="dev-bypass-hint"
              className="mx-auto mt-3 max-w-sm rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200"
            >
              DEV ONLY: domain gating bypass is enabled. You can sign in with personal emails.
            </div>
          ) : null}
        </div>

        {mode === "forgot" ? (
          <div className="mb-3 flex items-center justify-center">
            <button
              type="button"
              data-testid="forgot-password-back-link"
              onClick={() => switchMode("signin")}
              className="text-xs font-medium text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-300"
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <div className="mb-3 flex items-center justify-center gap-2">
            <button
              type="button"
              data-testid="login-mode-signin-button"
              onClick={() => switchMode("signin")}
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
              data-testid="login-mode-signup-button"
              onClick={() => switchMode("signup")}
              className={`rounded-full px-3 py-1 text-xs font-medium border ${
                mode === "signup"
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                  : "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300"
              }`}
            >
              Sign up
            </button>
          </div>
        )}

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

          {mode === "forgot" && forgotPasswordSuccess ? (
            <div className="space-y-4">
              <div
                data-testid="forgot-password-success-message"
                className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300"
              >
                {forgotPasswordSuccess}
              </div>

              <button
                type="button"
                data-testid="forgot-password-back-to-sign-in"
                onClick={() => switchMode("signin")}
                className="w-full rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-white"
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <>
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

                {mode !== "forgot" ? (
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
                ) : null}
              </div>

              {mode === "signin" ? (
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    data-testid="forgot-password-link"
                    onClick={() => switchMode("forgot")}
                    className="text-xs font-medium text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-300"
                  >
                    Forgot password?
                  </button>
                </div>
              ) : null}

              <button
                type="submit"
                data-testid={mode === "forgot" ? "forgot-password-submit-button" : "login-submit-button"}
                disabled={loading || !email.trim() || (mode !== "forgot" && !password)}
                className="mt-6 w-full rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-white"
              >
                {loading
                  ? "Working..."
                  : mode === "signup"
                    ? "Create account"
                    : mode === "forgot"
                      ? "Send reset link"
                      : "Sign in"}
              </button>

              <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                {mode === "signup"
                  ? "You will be able to sign in after creating your account."
                  : mode === "forgot"
                    ? "Use the link in the email to finish resetting your password."
                    : "If you don't have an account yet, switch to Sign up."}
              </p>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
