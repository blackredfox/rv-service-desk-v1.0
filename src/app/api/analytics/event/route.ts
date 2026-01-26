import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { trackEvent } from "@/lib/analytics";

type EventBody = {
  eventName?: string;
  payload?: Record<string, unknown>;
};

const ALLOWED_EVENTS = [
  "page.view",
  "feature.used",
  "error.occurred",
  "case.viewed",
  "message.copied",
];

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();

    // For Release 1, we require auth for analytics
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as EventBody | null;

    const eventName = body?.eventName?.trim();
    const payload = body?.payload;

    if (!eventName) {
      return NextResponse.json(
        { error: "eventName is required" },
        { status: 400 }
      );
    }

    // Validate event name (only allow known client events)
    if (!ALLOWED_EVENTS.includes(eventName)) {
      return NextResponse.json(
        { error: "Invalid event name" },
        { status: 400 }
      );
    }

    // Validate payload size (4KB limit)
    if (payload) {
      const payloadStr = JSON.stringify(payload);
      if (payloadStr.length > 4096) {
        return NextResponse.json(
          { error: "Payload too large (max 4KB)" },
          { status: 400 }
        );
      }
    }

    await trackEvent(eventName, user.id, payload);

    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to track event";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
