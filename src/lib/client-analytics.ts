/**
 * Client-side analytics helper
 * Maps UI events to backend's allowed "feature.used" event
 */

type AnalyticsPayload = {
  feature: string;
  caseId?: string;
  uiSurface?: string;
  timestamp?: string;
};

export async function trackFeature(
  feature: string,
  options?: { caseId?: string; uiSurface?: string }
): Promise<void> {
  const payload: AnalyticsPayload = {
    feature,
    timestamp: new Date().toISOString(),
  };

  if (options?.caseId) payload.caseId = options.caseId;
  if (options?.uiSurface) payload.uiSurface = options.uiSurface;

  try {
    await fetch("/api/analytics/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventName: "feature.used",
        payload,
      }),
    });
  } catch {
    // Silent fail - analytics should not break the app
  }
}

export async function trackError(
  errorType: string,
  options?: { uiSurface?: string }
): Promise<void> {
  try {
    await fetch("/api/analytics/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventName: "error.occurred",
        payload: {
          errorType,
          uiSurface: options?.uiSurface,
          timestamp: new Date().toISOString(),
        },
      }),
    });
  } catch {
    // Silent fail
  }
}

// Convenience exports for specific events
export const analytics = {
  loginSuccess: () => trackFeature("auth.login", { uiSurface: "login" }),
  logout: () => trackFeature("auth.logout", { uiSurface: "header" }),
  caseCreated: (caseId: string) => trackFeature("case.created", { caseId, uiSurface: "sidebar" }),
  chatSent: (caseId?: string) => trackFeature("chat.sent", { caseId, uiSurface: "chat" }),
  billingCheckoutClicked: () => trackFeature("billing.checkout_clicked", { uiSurface: "billing" }),
  photoAttached: (caseId?: string) => trackFeature("chat.photo_attached", { caseId, uiSurface: "chat" }),
  voiceDictationUsed: () => trackFeature("chat.voice_dictation_used", { uiSurface: "chat" }),
  loginError: () => trackError("login_failed", { uiSurface: "login" }),
  chatError: () => trackError("chat_failed", { uiSurface: "chat" }),
};
