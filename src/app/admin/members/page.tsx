"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { SupportButton } from "@/components/support-button";

type Member = {
  id: string;
  email: string;
  role: "admin" | "member";
  status: "active" | "inactive" | "pending";
  createdAt: string;
  updatedAt?: string;
};

type MemberActivity = {
  memberId: string;
  email: string;
  role: "admin" | "member";
  status: "active" | "inactive" | "pending";
  lastLoginAt: string | null;
  casesLast7Days: number;
  casesLast30Days: number;
  totalMessages: number;
  createdAt: string;
};

type SortField = "lastLoginAt" | "casesLast7Days" | "casesLast30Days" | "totalMessages" | "email";
type SortOrder = "asc" | "desc";

type Tab = "members" | "activity";

export default function AdminMembersPage() {
  const router = useRouter();
  const { user, loading: authLoading, refresh } = useAuth();

  const [activeTab, setActiveTab] = useState<Tab>("members");
  
  // Members tab state
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Activity tab state
  const [activity, setActivity] = useState<MemberActivity[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("lastLoginAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");

  // Add member form
  const [showAddForm, setShowAddForm] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState<"member" | "admin">("member");
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Update member state
  const [updateLoading, setUpdateLoading] = useState<string | null>(null);

  // Access check
  const isAdmin = user?.access?.isAdmin === true;
  const orgId = user?.organization?.id;
  const orgName = user?.organization?.name;
  const seatLimit = user?.organization?.seatLimit || 0;
  
  // Calculate active seat count from local members list (more accurate than stored value)
  // Only count members with status === "active"
  const localActiveSeatCount = members.filter(m => m.status === "active").length;
  
  // Use local count when we have members loaded, fallback to org's stored value
  const activeSeatCount = members.length > 0 ? localActiveSeatCount : (user?.organization?.activeSeatCount || 0);
  
  // Check if we can add more members
  const canAddMember = activeSeatCount < seatLimit;

  const fetchMembers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/org/members", { credentials: "same-origin" });
      
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to load members");
      }

      const data = await res.json();
      setMembers(data.members || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load members");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchActivity = useCallback(async () => {
    try {
      setActivityLoading(true);
      setActivityError(null);
      const res = await fetch("/api/org/activity", { credentials: "same-origin" });
      
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to load activity");
      }

      const data = await res.json();
      setActivity(data.activity || []);
    } catch (e) {
      setActivityError(e instanceof Error ? e.message : "Failed to load activity");
    } finally {
      setActivityLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    
    // Redirect non-admins
    if (!isAdmin) {
      router.replace("/");
      return;
    }

    void fetchMembers();
  }, [authLoading, isAdmin, router, fetchMembers]);

  // Fetch activity when switching to activity tab
  useEffect(() => {
    if (activeTab === "activity" && activity.length === 0 && !activityLoading) {
      void fetchActivity();
    }
  }, [activeTab, activity.length, activityLoading, fetchActivity]);

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    setAddLoading(true);

    try {
      const res = await fetch("/api/org/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: addEmail.trim().toLowerCase(), role: addRole }),
        credentials: "same-origin",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to add member");
      }

      // Success - refresh both members list and auth context (for seat counter)
      setAddEmail("");
      setAddRole("member");
      setShowAddForm(false);
      await Promise.all([fetchMembers(), refresh()]);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Failed to add member");
    } finally {
      setAddLoading(false);
    }
  }

  async function handleUpdateMember(memberId: string, update: { status?: string; role?: string }) {
    setUpdateLoading(memberId);

    try {
      const res = await fetch("/api/org/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, ...update }),
        credentials: "same-origin",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update member");
      }

      // Refresh both members list and auth context (for seat counter)
      await Promise.all([fetchMembers(), refresh()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update member");
    } finally {
      setUpdateLoading(null);
    }
  }

  // Sorting logic for activity
  const sortedActivity = [...activity].sort((a, b) => {
    let aVal: string | number | null;
    let bVal: string | number | null;

    switch (sortField) {
      case "lastLoginAt":
        aVal = a.lastLoginAt;
        bVal = b.lastLoginAt;
        // Handle null values - null should be first (most inactive)
        if (!aVal && !bVal) return 0;
        if (!aVal) return sortOrder === "asc" ? -1 : 1;
        if (!bVal) return sortOrder === "asc" ? 1 : -1;
        const aTime = new Date(aVal).getTime();
        const bTime = new Date(bVal).getTime();
        return sortOrder === "asc" ? aTime - bTime : bTime - aTime;
      case "casesLast7Days":
        aVal = a.casesLast7Days;
        bVal = b.casesLast7Days;
        break;
      case "casesLast30Days":
        aVal = a.casesLast30Days;
        bVal = b.casesLast30Days;
        break;
      case "totalMessages":
        aVal = a.totalMessages;
        bVal = b.totalMessages;
        break;
      case "email":
        aVal = a.email;
        bVal = b.email;
        return sortOrder === "asc" 
          ? aVal.localeCompare(bVal) 
          : bVal.localeCompare(aVal);
      default:
        return 0;
    }

    if (typeof aVal === "number" && typeof bVal === "number") {
      return sortOrder === "asc" ? aVal - bVal : bVal - aVal;
    }
    return 0;
  });

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      // Default to ascending for most fields, but descending for activity counts
      setSortOrder(field === "lastLoginAt" ? "asc" : "desc");
    }
  }

  function formatLastLogin(dateStr: string | null): string {
    if (!dateStr) return "Never";
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) {
      return <span className="ml-1 text-zinc-300 dark:text-zinc-600">↕</span>;
    }
    return (
      <span className="ml-1 text-zinc-900 dark:text-zinc-100">
        {sortOrder === "asc" ? "↑" : "↓"}
      </span>
    );
  }

  // Count active admins for safety check
  const adminCount = members.filter((m) => m.role === "admin" && m.status === "active").length;

  if (authLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[var(--background)]">
        <div className="text-sm text-zinc-600 dark:text-zinc-400">Loading...</div>
      </div>
    );
  }

  if (!isAdmin) {
    return null; // Will redirect
  }

  return (
    <div className="min-h-dvh bg-[var(--background)] text-[var(--foreground)]">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white/70 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/50">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <div>
            <button
              type="button"
              onClick={() => router.push("/?from=admin")}
              data-testid="back-to-dashboard"
              className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              ← Back to Dashboard
            </button>
            <h1 className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              Team Management
            </h1>
            {orgName && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{orgName}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div data-testid="seat-counter" className="text-right text-xs text-zinc-500 dark:text-zinc-400">
              <div>{activeSeatCount} / {seatLimit} seats</div>
            </div>
            <button
              type="button"
              onClick={async () => {
                await refresh();
                await fetchMembers();
              }}
              data-testid="refresh-org-data"
              title="Refresh organization data (use after upgrading subscription)"
              className="
                rounded-md border border-zinc-200 p-1.5 text-zinc-500 
                hover:bg-zinc-50 hover:text-zinc-700
                dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200
              "
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="mx-auto max-w-5xl px-4">
        <div className="flex border-b border-zinc-200 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setActiveTab("members")}
            data-testid="tab-members"
            className={`px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === "members"
                ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            Members
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("activity")}
            data-testid="tab-activity"
            className={`px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === "activity"
                ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            Activity
          </button>
        </div>
      </div>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {/* Members Tab */}
        {activeTab === "members" && (
          <>
            {/* Error */}
            {error && (
              <div
                data-testid="members-error"
                className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
              >
                {error}
              </div>
            )}

            {/* Add Member Section */}
            <div className="mb-6">
              {!showAddForm ? (
                <button
                  type="button"
                  onClick={() => setShowAddForm(true)}
                  data-testid="add-member-button"
                  disabled={activeSeatCount >= seatLimit}
                  className="
                    inline-flex items-center gap-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white
                    hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50
                    dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-white
                  "
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Member
                </button>
              ) : (
                <form
                  onSubmit={handleAddMember}
                  className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    Add New Member
                  </h3>

                  {addError && (
                    <div
                      data-testid="add-member-error"
                      className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
                    >
                      {addError}
                    </div>
                  )}

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div className="flex-1">
                      <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                        Email
                      </label>
                      <input
                        type="email"
                        value={addEmail}
                        onChange={(e) => setAddEmail(e.target.value)}
                        data-testid="add-member-email"
                        required
                        disabled={addLoading}
                        placeholder="user@company.com"
                        className="
                          w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm
                          outline-none focus:ring-2 focus:ring-zinc-300
                          disabled:cursor-not-allowed disabled:opacity-50
                          dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-700
                        "
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                        Role
                      </label>
                      <select
                        value={addRole}
                        onChange={(e) => setAddRole(e.target.value as "member" | "admin")}
                        data-testid="add-member-role"
                        disabled={addLoading}
                        className="
                          rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm
                          outline-none focus:ring-2 focus:ring-zinc-300
                          dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-700
                        "
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        data-testid="add-member-submit"
                        disabled={addLoading || !addEmail.trim()}
                        className="
                          rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white
                          hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50
                          dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-white
                        "
                      >
                        {addLoading ? "Adding..." : "Add"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddForm(false);
                          setAddEmail("");
                          setAddError(null);
                        }}
                        disabled={addLoading}
                        className="
                          rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700
                          hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50
                          dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900
                        "
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </form>
              )}

              {activeSeatCount >= seatLimit && !showAddForm && (
                <div className="mt-2 space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      Seat limit reached.
                    </p>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const res = await fetch("/api/billing/portal", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ returnUrl: window.location.href }),
                            credentials: "same-origin",
                          });
                          if (res.ok) {
                            const data = await res.json();
                            window.location.href = data.url;
                          }
                        } catch {
                          setError("Failed to open billing portal");
                        }
                      }}
                      data-testid="upgrade-seats-button"
                      className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                    >
                      Upgrade seats →
                    </button>
                  </div>
                  <p className="text-[10px] text-zinc-500 dark:text-zinc-500">
                    Already upgraded? Click the refresh button (↻) in the header to sync.
                  </p>
                </div>
              )}
            </div>

            {/* Members List */}
            <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
              <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  Organization Members ({members.length})
                </h2>
              </div>

              {loading ? (
                <div className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  Loading members...
                </div>
              ) : members.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  No members found.
                </div>
              ) : (
                <ul data-testid="members-list" className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {members.map((member) => {
                    const isCurrentUser = member.email === user?.email;
                    const isLastAdmin = member.role === "admin" && adminCount <= 1;
                    const isUpdating = updateLoading === member.id;

                    return (
                      <li
                        key={member.id}
                        data-testid={`member-row-${member.id}`}
                        className="flex items-center justify-between gap-4 px-4 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              data-testid={`member-email-${member.id}`}
                              className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50"
                            >
                              {member.email}
                            </span>
                            {isCurrentUser && (
                              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                                You
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                            <span
                              data-testid={`member-role-${member.id}`}
                              className={`rounded px-1.5 py-0.5 ${
                                member.role === "admin"
                                  ? "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400"
                                  : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                              }`}
                            >
                              {member.role}
                            </span>
                            <span
                              data-testid={`member-status-${member.id}`}
                              className={`rounded px-1.5 py-0.5 ${
                                member.status === "active"
                                  ? "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400"
                                  : member.status === "inactive"
                                  ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400"
                                  : "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                              }`}
                            >
                              {member.status}
                            </span>
                            <span className="text-zinc-400">
                              Added {new Date(member.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2">
                          {/* Toggle Active/Inactive */}
                          {!isCurrentUser && (
                            <button
                              type="button"
                              onClick={() =>
                                handleUpdateMember(member.id, {
                                  status: member.status === "active" ? "inactive" : "active",
                                })
                              }
                              data-testid={`toggle-status-${member.id}`}
                              disabled={isUpdating || (isLastAdmin && member.status === "active")}
                              title={
                                isLastAdmin && member.status === "active"
                                  ? "Cannot deactivate last admin"
                                  : member.status === "active"
                                  ? "Deactivate member"
                                  : "Activate member"
                              }
                              className="
                                rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium
                                text-zinc-700 hover:bg-zinc-50
                                disabled:cursor-not-allowed disabled:opacity-50
                                dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900
                              "
                            >
                              {isUpdating ? "..." : member.status === "active" ? "Deactivate" : "Activate"}
                            </button>
                          )}

                          {/* Promote/Demote Admin */}
                          {!isCurrentUser && member.status === "active" && (
                            <button
                              type="button"
                              onClick={() =>
                                handleUpdateMember(member.id, {
                                  role: member.role === "admin" ? "member" : "admin",
                                })
                              }
                              data-testid={`toggle-role-${member.id}`}
                              disabled={isUpdating || (isLastAdmin && member.role === "admin")}
                              title={
                                isLastAdmin && member.role === "admin"
                                  ? "Cannot demote last admin"
                                  : member.role === "admin"
                                  ? "Demote to member"
                                  : "Promote to admin"
                              }
                              className="
                                rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium
                                text-zinc-700 hover:bg-zinc-50
                                disabled:cursor-not-allowed disabled:opacity-50
                                dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900
                              "
                            >
                              {isUpdating ? "..." : member.role === "admin" ? "Demote" : "Promote"}
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}

        {/* Activity Tab */}
        {activeTab === "activity" && (
          <>
            {activityError && (
              <div
                data-testid="activity-error"
                className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
              >
                {activityError}
              </div>
            )}

            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
              <strong>Tip:</strong> Identify inactive members to optimize your seat costs. Click column headers to sort.
            </div>

            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
              <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  Team Activity
                </h2>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Sorted by {sortField === "lastLoginAt" ? "last login" : sortField} ({sortOrder === "asc" ? "ascending" : "descending"})
                </p>
              </div>

              {activityLoading ? (
                <div className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  Loading activity data...
                </div>
              ) : sortedActivity.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  No activity data available.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table data-testid="activity-table" className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50">
                        <th className="px-4 py-3 text-left font-medium text-zinc-700 dark:text-zinc-300">
                          <button
                            type="button"
                            onClick={() => handleSort("email")}
                            className="flex items-center hover:text-zinc-900 dark:hover:text-zinc-100"
                          >
                            Member
                            <SortIcon field="email" />
                          </button>
                        </th>
                        <th className="px-4 py-3 text-left font-medium text-zinc-700 dark:text-zinc-300">
                          <button
                            type="button"
                            onClick={() => handleSort("lastLoginAt")}
                            className="flex items-center hover:text-zinc-900 dark:hover:text-zinc-100"
                          >
                            Last Login
                            <SortIcon field="lastLoginAt" />
                          </button>
                        </th>
                        <th className="px-4 py-3 text-center font-medium text-zinc-700 dark:text-zinc-300">
                          <button
                            type="button"
                            onClick={() => handleSort("casesLast7Days")}
                            className="flex items-center justify-center hover:text-zinc-900 dark:hover:text-zinc-100"
                          >
                            Cases (7d)
                            <SortIcon field="casesLast7Days" />
                          </button>
                        </th>
                        <th className="px-4 py-3 text-center font-medium text-zinc-700 dark:text-zinc-300">
                          <button
                            type="button"
                            onClick={() => handleSort("casesLast30Days")}
                            className="flex items-center justify-center hover:text-zinc-900 dark:hover:text-zinc-100"
                          >
                            Cases (30d)
                            <SortIcon field="casesLast30Days" />
                          </button>
                        </th>
                        <th className="px-4 py-3 text-center font-medium text-zinc-700 dark:text-zinc-300">
                          <button
                            type="button"
                            onClick={() => handleSort("totalMessages")}
                            className="flex items-center justify-center hover:text-zinc-900 dark:hover:text-zinc-100"
                          >
                            Messages
                            <SortIcon field="totalMessages" />
                          </button>
                        </th>
                        <th className="px-4 py-3 text-center font-medium text-zinc-700 dark:text-zinc-300">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                      {sortedActivity.map((item) => {
                        const isInactive = !item.lastLoginAt || 
                          (new Date().getTime() - new Date(item.lastLoginAt).getTime()) > 30 * 24 * 60 * 60 * 1000;
                        
                        return (
                          <tr
                            key={item.memberId}
                            data-testid={`activity-row-${item.memberId}`}
                            className={`${isInactive ? "bg-red-50/50 dark:bg-red-950/10" : ""}`}
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                                  {item.email}
                                </span>
                                {item.role === "admin" && (
                                  <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950/30 dark:text-blue-400">
                                    admin
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`${isInactive ? "text-red-600 dark:text-red-400" : "text-zinc-600 dark:text-zinc-400"}`}>
                                {formatLastLogin(item.lastLoginAt)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className={`font-medium ${item.casesLast7Days === 0 ? "text-zinc-400" : "text-zinc-900 dark:text-zinc-100"}`}>
                                {item.casesLast7Days}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className={`font-medium ${item.casesLast30Days === 0 ? "text-zinc-400" : "text-zinc-900 dark:text-zinc-100"}`}>
                                {item.casesLast30Days}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className={`font-medium ${item.totalMessages === 0 ? "text-zinc-400" : "text-zinc-900 dark:text-zinc-100"}`}>
                                {item.totalMessages}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span
                                className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                                  item.status === "active"
                                    ? "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400"
                                    : item.status === "inactive"
                                    ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400"
                                    : "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                                }`}
                              >
                                {item.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => void fetchActivity()}
                disabled={activityLoading}
                className="
                  rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700
                  hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50
                  dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900
                "
              >
                {activityLoading ? "Refreshing..." : "Refresh Activity"}
              </button>
            </div>
          </>
        )}
      </main>

      {/* Support Button */}
      <SupportButton
        accountData={{
          email: user?.email,
          orgId: orgId,
          orgName: orgName,
          memberRole: user?.membership?.role,
          memberStatus: user?.membership?.status,
          seatCount: activeSeatCount,
          seatLimit: seatLimit,
          accessReason: user?.access?.reason,
          accessAllowed: user?.access?.allowed,
        }}
      />
    </div>
  );
}
