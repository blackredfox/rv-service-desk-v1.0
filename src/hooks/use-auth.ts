"use client";

import { createContext, useContext } from "react";

export type AuthUser = {
  id: string;
  email: string;
  // Organization info
  organization: {
    id: string;
    name: string;
    subscriptionStatus: string;
    seatLimit: number;
    activeSeatCount: number;
  } | null;
  // Membership info
  membership: {
    role: "admin" | "member";
    status: "active" | "inactive" | "pending";
  } | null;
  // Access status
  access: {
    allowed: boolean;
    reason?:
      | "blocked_domain"
      | "no_organization"
      | "subscription_required"
      | "seat_limit_exceeded"
      | "inactive"
      | "pending"
      | "unknown";
    message?: string;
    requiresSubscription: boolean;
    isAdmin: boolean;
    canCreateOrg?: boolean;
    defaultDomain?: string;
  };
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
