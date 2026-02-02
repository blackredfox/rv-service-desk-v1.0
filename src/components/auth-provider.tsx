"use client";

import { useEffect, useState, useCallback, type ReactNode } from "react";
import { AuthContext, type AuthUser } from "@/hooks/use-auth";
import { analytics } from "@/lib/client-analytics";

type Props = {
  children: ReactNode;
};

export function AuthProvider({ children }: Props) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store", credentials: "same-origin" });
      if (res.ok) {
        const data = (await res.json()) as AuthUser;
        setUser(data);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      credentials: "same-origin",
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      void analytics.loginError();
      throw new Error(data.error || "Login failed");
    }

    const data = (await res.json()) as { user: AuthUser };
    setUser(data.user);
    void analytics.loginSuccess();
  }, []);

  const logout = useCallback(async () => {
    void analytics.logout();
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}
