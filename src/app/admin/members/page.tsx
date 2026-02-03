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

export default function AdminMembersPage() {
  const router = useRouter();
  const { user, loading: authLoading, logout } = useAuth();

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
  const activeSeatCount = user?.organization?.activeSeatCount || 0;

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

  useEffect(() => {
    if (authLoading) return;
    
    // Redirect non-admins
    if (!isAdmin) {
      router.replace("/");
      return;
    }

    void fetchMembers();
  }, [authLoading, isAdmin, router, fetchMembers]);

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

      // Success
      setAddEmail("");
      setAddRole("member");
      setShowAddForm(false);
      await fetchMembers();
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

      await fetchMembers();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update member");
    } finally {
      setUpdateLoading(null);
    }
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
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <div>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              ← Back to App
            </button>
            <h1 className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              Members
            </h1>
            {orgName && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{orgName}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right text-xs text-zinc-500 dark:text-zinc-400">
              <div>{activeSeatCount} / {seatLimit} seats</div>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              data-testid="admin-logout-button"
              className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
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
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
              Seat limit reached. Purchase more seats to add members.
            </p>
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
      </main>

      {/* Support Button */}
      <SupportButton
        diagnostics={{
          email: user?.email,
          orgId: orgId,
          orgName: orgName,
          memberRole: user?.membership?.role,
          memberStatus: user?.membership?.status,
          accessReason: user?.access?.reason,
          accessAllowed: user?.access?.allowed,
        }}
      />
    </div>
  );
}
