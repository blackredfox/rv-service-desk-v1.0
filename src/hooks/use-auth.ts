"use client";

import { createContext, useContext } from "react";

export type AuthUser = {
  id: string;
  email: string;
  plan: "FREE" | "PREMIUM" | "PRO";
  status: "ACTIVE" | "INACTIVE" | "PAST_DUE" | "CANCELED";
};

export type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
