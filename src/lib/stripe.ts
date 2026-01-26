import Stripe from "stripe";
import { getPrisma } from "@/lib/db";
import { trackEvent } from "@/lib/analytics";

let stripeInstance: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripeInstance) {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error("Missing STRIPE_SECRET_KEY");
    }
    stripeInstance = new Stripe(secretKey, {
      apiVersion: "2025-05-28.basil",
    });
  }
  return stripeInstance;
}

export type PlanType = "PREMIUM" | "PRO";

const PLAN_PRICE_MAP: Record<PlanType, string | undefined> = {
  PREMIUM: process.env.STRIPE_PRICE_ID_PREMIUM,
  PRO: process.env.STRIPE_PRICE_ID_PRO,
};

export async function createCheckoutSession(args: {
  userId: string;
  email: string;
  plan: PlanType;
  origin: string;
}): Promise<{ url: string; sessionId: string }> {
  const stripe = getStripe();
  const prisma = await getPrisma();
  if (!prisma) throw new Error("Database not configured");

  const priceId = PLAN_PRICE_MAP[args.plan];
  if (!priceId) {
    throw new Error(`Price ID not configured for plan: ${args.plan}`);
  }

  // Build URLs from origin
  const successUrl = `${args.origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${args.origin}/billing/cancel`;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: args.email,
    metadata: {
      userId: args.userId,
      plan: args.plan,
    },
    subscription_data: {
      metadata: {
        userId: args.userId,
        plan: args.plan,
      },
    },
  });

  if (!session.url) {
    throw new Error("Failed to create checkout session");
  }

  // Create payment transaction record
  await prisma.paymentTransaction.create({
    data: {
      userId: args.userId,
      email: args.email,
      sessionId: session.id,
      paymentStatus: "PENDING",
      metadata: JSON.stringify({ plan: args.plan }),
    },
  });

  // Track analytics
  await trackEvent("checkout.started", args.userId, { plan: args.plan });

  return { url: session.url, sessionId: session.id };
}

export async function getCheckoutStatus(sessionId: string): Promise<{
  status: string;
  paymentStatus: string;
  plan: string | null;
}> {
  const stripe = getStripe();

  const session = await stripe.checkout.sessions.retrieve(sessionId);

  return {
    status: session.status ?? "unknown",
    paymentStatus: session.payment_status,
    plan: (session.metadata?.plan as string) ?? null,
  };
}

export async function handleWebhookEvent(
  body: Buffer,
  signature: string
): Promise<{ received: boolean }> {
  const stripe = getStripe();
  const prisma = await getPrisma();
  if (!prisma) throw new Error("Database not configured");

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error("Missing STRIPE_WEBHOOK_SECRET");
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    throw new Error(`Webhook signature verification failed: ${message}`);
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      await handleCheckoutCompleted(session);
      break;
    }

    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      await handleInvoicePaid(invoice);
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      await handleSubscriptionUpdated(subscription);
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      await handleSubscriptionDeleted(subscription);
      break;
    }

    default:
      // Unhandled event type
      console.log(`Unhandled event type: ${event.type}`);
  }

  return { received: true };
}

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session
): Promise<void> {
  const prisma = await getPrisma();
  if (!prisma) return;

  const userId = session.metadata?.userId;
  const plan = session.metadata?.plan as PlanType | undefined;

  if (!userId || !plan) {
    console.error("Missing userId or plan in checkout session metadata");
    return;
  }

  // Update payment transaction
  await prisma.paymentTransaction
    .update({
      where: { sessionId: session.id },
      data: {
        paymentStatus: session.payment_status === "paid" ? "PAID" : "FAILED",
        paymentId: session.payment_intent as string | undefined,
      },
    })
    .catch(() => {
      // Transaction might not exist
    });

  // Update or create subscription
  await prisma.subscription.upsert({
    where: { userId },
    update: {
      plan,
      status: "ACTIVE",
      stripeCustomerId: session.customer as string,
      stripeSubscriptionId: session.subscription as string,
    },
    create: {
      userId,
      plan,
      status: "ACTIVE",
      stripeCustomerId: session.customer as string,
      stripeSubscriptionId: session.subscription as string,
    },
  });

  // Track analytics
  await trackEvent("checkout.success", userId, { plan });
}

async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const prisma = await getPrisma();
  if (!prisma) return;

  const subscriptionId = invoice.subscription as string | undefined;
  if (!subscriptionId) return;

  const subscription = await prisma.subscription.findFirst({
    where: { stripeSubscriptionId: subscriptionId },
  });

  if (subscription) {
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: "ACTIVE",
        currentPeriodEnd: invoice.lines.data[0]?.period?.end
          ? new Date(invoice.lines.data[0].period.end * 1000)
          : null,
      },
    });
  }
}

async function handleSubscriptionUpdated(
  subscription: Stripe.Subscription
): Promise<void> {
  const prisma = await getPrisma();
  if (!prisma) return;

  const userId = subscription.metadata?.userId;
  if (!userId) return;

  const plan = subscription.metadata?.plan as PlanType | undefined;

  let status: "ACTIVE" | "INACTIVE" | "PAST_DUE" | "CANCELED" = "INACTIVE";
  switch (subscription.status) {
    case "active":
    case "trialing":
      status = "ACTIVE";
      break;
    case "past_due":
      status = "PAST_DUE";
      break;
    case "canceled":
    case "unpaid":
      status = "CANCELED";
      break;
    default:
      status = "INACTIVE";
  }

  await prisma.subscription.upsert({
    where: { userId },
    update: {
      plan: plan ?? undefined,
      status,
      stripeSubscriptionId: subscription.id,
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
    },
    create: {
      userId,
      plan: plan ?? "FREE",
      status,
      stripeSubscriptionId: subscription.id,
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
    },
  });

  await trackEvent("subscription.updated", userId, { status, plan });
}

async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription
): Promise<void> {
  const prisma = await getPrisma();
  if (!prisma) return;

  const userId = subscription.metadata?.userId;
  if (!userId) return;

  await prisma.subscription.update({
    where: { userId },
    data: {
      status: "CANCELED",
      plan: "FREE",
    },
  });

  await trackEvent("subscription.canceled", userId, {});
}
