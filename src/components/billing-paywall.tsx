"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";

type Props = {
  onRefresh: () => void;
};

const SEAT_PRICE = 19.99;

const SUGGESTED_TIERS = [
  { seats: 5, label: "Small Team" },
  { seats: 10, label: "Medium Team" },
  { seats: 25, label: "Large Team" },
];

/**
 * Billing paywall shown to admins when subscription is required but not active
 */
export function BillingPaywall({ onRefresh }: Props) {
  const { user } = useAuth();
  
  const [selectedSeats, setSelectedSeats] = useState(5);
  const [customSeats, setCustomSeats] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  async function handleSubscribe() {
    if (!user?.organization?.id) {
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
          orgId: user.organization.id,
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
  
  const effectiveSeats = customSeats ? parseInt(customSeats, 10) || 0 : selectedSeats;
  const monthlyPrice = (effectiveSeats * SEAT_PRICE).toFixed(2);
  
  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-[var(--background)] p-4">
      <div className="w-full max-w-lg">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            Subscription Required
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Subscribe to RV Service Desk for your team
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
          
          {user?.organization && (
            <div className="mb-4 rounded-lg bg-zinc-50 px-4 py-3 dark:bg-zinc-900">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">Organization</div>
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {user.organization.name}
              </div>
            </div>
          )}
          
          {/* Pricing tiers */}
          <div className="space-y-3">
            <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Select team size:
            </div>
            
            {SUGGESTED_TIERS.map((tier) => (
              <button
                key={tier.seats}
                type="button"
                onClick={() => {
                  setSelectedSeats(tier.seats);
                  setCustomSeats("");
                }}
                disabled={loading}
                data-testid={`paywall-tier-${tier.seats}-btn`}
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
                  data-testid="paywall-custom-seats-input"
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
            data-testid="paywall-subscribe-button"
            disabled={loading || effectiveSeats < 1}
            className="mt-6 w-full rounded-md bg-zinc-900 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-white"
          >
            {loading ? "Processing..." : `Subscribe — $${monthlyPrice}/month`}
          </button>
          
          <div className="mt-4 flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={onRefresh}
              data-testid="paywall-refresh-button"
              disabled={loading}
              className="text-sm text-zinc-600 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              I already subscribed — refresh
            </button>
          </div>
          
          <p className="mt-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
            $19.99 per technician seat / month. Cancel anytime.
          </p>
        </div>
      </div>
    </div>
  );
}
