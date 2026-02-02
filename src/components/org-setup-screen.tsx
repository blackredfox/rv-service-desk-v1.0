"use client";

import { useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { isClientDevBypassDomainGatingHintEnabled } from "@/lib/dev-flags";

type Props = {
  onComplete: () => void;
};

const SEAT_PRICE = 19.99;

const SUGGESTED_TIERS = [
  { seats: 5, label: "Small Team" },
  { seats: 10, label: "Medium Team" },
  { seats: 25, label: "Large Team" },
];

export function OrgSetupScreen({ onComplete }: Props) {
  const { user, refresh } = useAuth();
  
  const [step, setStep] = useState<"create" | "seats">("create");
  const [orgName, setOrgName] = useState("");
  const [domains, setDomains] = useState<string[]>([]);
  const [domainInput, setDomainInput] = useState("");
  const [selectedSeats, setSelectedSeats] = useState(5);
  const [customSeats, setCustomSeats] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdOrgId, setCreatedOrgId] = useState<string | null>(null);
  
  // Extract user's email domain
  const userDomain = user?.email?.split("@")[1] || "";

  // DEV UX: for personal emails, default to a safe fake corp domain.
  const defaultDomain = useMemo(() => {
    const devHint = isClientDevBypassDomainGatingHintEnabled();
    if (!devHint) return userDomain;
    const personal = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com"];
    if (personal.includes(userDomain.toLowerCase())) return "local.test";
    return userDomain;
  }, [userDomain]);
  
  async function handleCreateOrg(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // Use default domain if no domains specified
      const finalDomains = domains.length > 0 ? domains : [defaultDomain];

      const res = await fetch("/api/org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: orgName.trim(),
          domains: finalDomains,
          seatLimit: selectedSeats,
        }),
        credentials: "same-origin",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create organization");
      }

      const data = await res.json();
      setCreatedOrgId(data.organization.id);

      // Refresh user data
      await refresh();

      // Notify parent (advances gating state machine)
      onComplete();

      // Billing is handled by the main gating state machine (BillingPaywall).
      // Keep this screen stable; parent will transition to the next step.

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create organization";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }
  
  async function handleSubscribe() {
    if (!createdOrgId && !user?.organization?.id) {
      setError("Organization not found");
      return;
    }
    
    setError(null);
    setLoading(true);
    
    try {
      const finalSeats = customSeats ? parseInt(customSeats, 10) : selectedSeats;
      
      if (finalSeats < 1 || finalSeats > 1000) {
        throw new Error("Seat count must be between 1 and 1000");
      }
      
      const res = await fetch("/api/billing/checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId: createdOrgId || user?.organization?.id,
          seatCount: finalSeats,
          origin: window.location.origin,
        }),
        credentials: "same-origin",
      });
      
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to start checkout");
      }
      
      const data = await res.json();
      
      // Redirect to Stripe Checkout
      window.location.href = data.url;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to start checkout";
      setError(msg);
      setLoading(false);
    }
  }
  
  function addDomain() {
    const domain = domainInput.trim().toLowerCase();
    if (domain && !domains.includes(domain)) {
      setDomains([...domains, domain]);
      setDomainInput("");
    }
  }
  
  function removeDomain(domain: string) {
    setDomains(domains.filter(d => d !== domain));
  }
  
  const effectiveSeats = customSeats ? parseInt(customSeats, 10) || 0 : selectedSeats;
  const monthlyPrice = (effectiveSeats * SEAT_PRICE).toFixed(2);
  
  if (step === "create") {
    return (
      <div className="flex min-h-dvh w-full items-center justify-center bg-[var(--background)] p-4">
        <div className="w-full max-w-lg">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
              Set Up Your Organization
            </h1>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Create your company workspace to get started
            </p>
          </div>
          
          <form
            onSubmit={handleCreateOrg}
            className="rounded-2xl border border-zinc-200 bg-white/80 p-6 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/60"
          >
            {error && (
              <div
                data-testid="org-setup-error"
                className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
              >
                {error}
              </div>
            )}
            
            <div className="space-y-5">
              <div>
                <label
                  htmlFor="orgName"
                  className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                >
                  Organization Name
                </label>
                <input
                  id="orgName"
                  data-testid="org-name-input"
                  type="text"
                  required
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  disabled={loading}
                  className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none disabled:cursor-not-allowed disabled:opacity-50 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-700"
                  placeholder="Acme RV Services"
                />
              </div>
              
              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Approved Email Domains
                </label>
                <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
                  Users with these email domains can join your organization
                </p>
                
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={domainInput}
                    onChange={(e) => setDomainInput(e.target.value)}
                    disabled={loading}
                    className="flex-1 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none disabled:cursor-not-allowed disabled:opacity-50 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-700"
                    placeholder="example.com"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addDomain();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={addDomain}
                    disabled={loading || !domainInput.trim()}
                    className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  >
                    Add
                  </button>
                </div>
                
                <div className="mt-2 flex flex-wrap gap-2">
                  {domains.length === 0 && defaultDomain && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                      {defaultDomain}
                      <span className="text-zinc-400">(default)</span>
                    </span>
                  )}
                  {domains.map((domain) => (
                    <span
                      key={domain}
                      className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                    >
                      {domain}
                      <button
                        type="button"
                        onClick={() => removeDomain(domain)}
                        className="ml-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>
            
            <button
              type="submit"
              data-testid="create-org-button"
              disabled={loading || !orgName.trim()}
              className="mt-6 w-full rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-white"
            >
              {loading ? "Creating..." : "Continue to Billing"}
            </button>
          </form>
        </div>
      </div>
    );
  }
  
  // Seats selection step
  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-[var(--background)] p-4">
      <div className="w-full max-w-lg">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            Choose Your Plan
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            $19.99 per technician seat / month
          </p>
        </div>
        
        <div className="rounded-2xl border border-zinc-200 bg-white/80 p-6 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/60">
          {error && (
            <div
              data-testid="billing-error"
              className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
            >
              {error}
            </div>
          )}
          
          {/* Tier options */}
          <div className="space-y-3">
            {SUGGESTED_TIERS.map((tier) => (
              <button
                key={tier.seats}
                type="button"
                onClick={() => {
                  setSelectedSeats(tier.seats);
                  setCustomSeats("");
                }}
                disabled={loading}
                data-testid={`tier-${tier.seats}-btn`}
                className={`w-full rounded-xl border p-4 text-left transition-all ${
                  selectedSeats === tier.seats && !customSeats
                    ? "border-zinc-900 bg-zinc-50 dark:border-zinc-50 dark:bg-zinc-900"
                    : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                      {tier.seats} Seats
                    </div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">
                      {tier.label}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
                      ${(tier.seats * SEAT_PRICE).toFixed(2)}
                    </div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">
                      / month
                    </div>
                  </div>
                </div>
              </button>
            ))}
            
            {/* Custom seats */}
            <div className="mt-4">
              <label className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Or enter custom seat count:
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={customSeats}
                  onChange={(e) => setCustomSeats(e.target.value)}
                  disabled={loading}
                  data-testid="custom-seats-input"
                  className="w-24 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none disabled:cursor-not-allowed disabled:opacity-50 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-700"
                  placeholder="Custom"
                />
                {customSeats && (
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">
                    = ${(parseInt(customSeats, 10) * SEAT_PRICE).toFixed(2)} / month
                  </span>
                )}
              </div>
            </div>
            
            {/* Contact for 25+ */}
            <div className="mt-4 rounded-lg bg-zinc-50 p-3 text-center text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
              Need more than 25 seats?{" "}
              <a
                href="mailto:sales@rvservicedesk.com"
                className="font-medium text-zinc-900 hover:underline dark:text-zinc-200"
              >
                Contact us
              </a>
            </div>
          </div>
          
          {/* Summary */}
          <div className="mt-6 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">
                {effectiveSeats} seat{effectiveSeats !== 1 ? "s" : ""} × $19.99
              </span>
              <span className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
                ${monthlyPrice}/mo
              </span>
            </div>
          </div>
          
          <button
            type="button"
            onClick={handleSubscribe}
            data-testid="subscribe-button"
            disabled={loading || effectiveSeats < 1}
            className="mt-6 w-full rounded-md bg-zinc-900 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-white"
          >
            {loading ? "Processing..." : `Subscribe — $${monthlyPrice}/month`}
          </button>
          
          <p className="mt-3 text-center text-xs text-zinc-500 dark:text-zinc-400">
            You can change seats anytime from the billing portal
          </p>
        </div>
      </div>
    </div>
  );
}
