import { getPrisma } from "@/lib/db";

const MAX_PAYLOAD_SIZE = 4096; // 4KB limit

export type AnalyticsEventName =
  | "user.signup"
  | "user.login"
  | "user.logout"
  | "case.created"
  | "message.sent"
  | "checkout.started"
  | "checkout.success"
  | "subscription.updated"
  | "subscription.canceled";

export async function trackEvent(
  eventName: AnalyticsEventName | string,
  userId: string | null,
  payload?: Record<string, unknown>
): Promise<void> {
  const prisma = await getPrisma();
  if (!prisma) return; // Skip if DB not configured

  let payloadJson: string | null = null;

  if (payload) {
    // Sanitize: remove any potentially sensitive data
    const sanitized = { ...payload };
    delete sanitized.password;
    delete sanitized.token;
    delete sanitized.apiKey;

    const jsonStr = JSON.stringify(sanitized);

    // Enforce size limit
    if (jsonStr.length > MAX_PAYLOAD_SIZE) {
      payloadJson = JSON.stringify({
        _truncated: true,
        _originalSize: jsonStr.length,
      });
    } else {
      payloadJson = jsonStr;
    }
  }

  try {
    await prisma.analyticsEvent.create({
      data: {
        userId,
        eventName,
        payloadJson,
      },
    });
  } catch {
    // Silent fail - analytics should not break the app
    console.error(`Failed to track event: ${eventName}`);
  }
}
