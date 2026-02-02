import Stripe from "stripe";
import {
  getOrganization,
  updateOrgSubscription,
  type SubscriptionStatus,
} from "./firestore";

let stripeInstance: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripeInstance) {
    const secretKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY;
    if (!secretKey) {
      throw new Error("Missing STRIPE_SECRET_KEY or STRIPE_API_KEY");
    }
    stripeInstance = new Stripe(secretKey, {
      // Keep aligned with the installed Stripe SDK's supported apiVersion union.
      apiVersion: "2026-01-28.clover",
    });
  }
  return stripeInstance;
}

// Price per seat per month in cents
const SEAT_PRICE_CENTS = 1999; // $19.99

/**
 * Create a Stripe Checkout session for seat-based subscription
 */
export async function createSeatCheckoutSession(args: {
  orgId: string;
  adminUid: string;
  adminEmail: string;
  seatCount: number;
  origin: string;
}): Promise<{ url: string; sessionId: string }> {
  const stripe = getStripe();
  
  const priceId = process.env.STRIPE_PRICE_SEAT_MONTHLY;
  if (!priceId) {
    throw new Error("STRIPE_PRICE_SEAT_MONTHLY not configured");
  }
  
  const successUrl = `${args.origin}/?billing=success`;
  const cancelUrl = `${args.origin}/?billing=cancel`;
  
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [
      {
        price: priceId,
        quantity: args.seatCount,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: args.adminEmail,
    metadata: {
      orgId: args.orgId,
      adminUid: args.adminUid,
      adminEmail: args.adminEmail,
      seatCount: String(args.seatCount),
    },
    subscription_data: {
      metadata: {
        orgId: args.orgId,
        adminUid: args.adminUid,
        adminEmail: args.adminEmail,
      },
    },
  });
  
  if (!session.url) {
    throw new Error("Failed to create checkout session");
  }
  
  return { url: session.url, sessionId: session.id };
}

/**
 * Create Stripe Billing Portal session
 */
export async function createBillingPortalSession(args: {
  stripeCustomerId: string;
  returnUrl: string;
}): Promise<{ url: string }> {
  const stripe = getStripe();
  
  const session = await stripe.billingPortal.sessions.create({
    customer: args.stripeCustomerId,
    return_url: args.returnUrl,
  });
  
  return { url: session.url };
}

/**
 * Map Stripe subscription status to our status
 */
function mapStripeStatus(status: string): SubscriptionStatus {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
      return "past_due";
    case "canceled":
    case "unpaid":
    case "incomplete_expired":
      return "canceled";
    default:
      return "none";
  }
}

/**
 * Handle Stripe webhook events
 */
export async function handleB2BWebhookEvent(
  body: Buffer,
  signature: string
): Promise<{ received: boolean; eventType?: string }> {
  const stripe = getStripe();
  
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
  
  console.log(`[Stripe Webhook] Received event: ${event.type}`);
  
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      await handleCheckoutCompleted(session);
      break;
    }
    
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      await handleSubscriptionUpdate(subscription);
      break;
    }
    
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      await handleSubscriptionDeleted(subscription);
      break;
    }
    
    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice;
      await handleInvoicePaymentSucceeded(invoice);
      break;
    }
    
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      await handleInvoicePaymentFailed(invoice);
      break;
    }
    
    default:
      console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
  }
  
  return { received: true, eventType: event.type };
}

/**
 * Handle checkout.session.completed event
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const orgId = session.metadata?.orgId;
  const seatCount = session.metadata?.seatCount;
  
  if (!orgId) {
    console.error("[Stripe Webhook] Missing orgId in checkout session metadata");
    return;
  }
  
  console.log(`[Stripe Webhook] Checkout completed for org ${orgId}, seats: ${seatCount}`);
  
  await updateOrgSubscription(orgId, {
    subscriptionStatus: "active",
    seatLimit: seatCount ? parseInt(seatCount, 10) : 5,
    stripeCustomerId: session.customer as string,
    stripeSubscriptionId: session.subscription as string,
  });
}

/**
 * Handle subscription created/updated event
 */
async function handleSubscriptionUpdate(subscription: Stripe.Subscription): Promise<void> {
  const orgId = subscription.metadata?.orgId;
  
  if (!orgId) {
    console.error("[Stripe Webhook] Missing orgId in subscription metadata");
    return;
  }
  
  const status = mapStripeStatus(subscription.status);
  
  // Get quantity from line items
  let seatLimit = 5;
  if (subscription.items?.data?.[0]?.quantity) {
    seatLimit = subscription.items.data[0].quantity;
  }
  
  // Get period end
  const periodEnd = (subscription as unknown as { current_period_end?: number }).current_period_end;
  
  console.log(`[Stripe Webhook] Subscription ${subscription.status} for org ${orgId}, seats: ${seatLimit}`);
  
  await updateOrgSubscription(orgId, {
    subscriptionStatus: status,
    seatLimit,
    stripeSubscriptionId: subscription.id,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : undefined,
  });
}

/**
 * Handle subscription deleted event
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const orgId = subscription.metadata?.orgId;
  
  if (!orgId) {
    console.error("[Stripe Webhook] Missing orgId in subscription metadata");
    return;
  }
  
  console.log(`[Stripe Webhook] Subscription deleted for org ${orgId}`);
  
  await updateOrgSubscription(orgId, {
    subscriptionStatus: "canceled",
  });
}

/**
 * Handle invoice.payment_succeeded event
 */
async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
  // Get subscription ID
  const subscriptionId = (invoice as unknown as { subscription?: string }).subscription;
  if (!subscriptionId) return;
  
  // Try to find org by subscription metadata (requires fetching subscription)
  const stripe = getStripe();
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const orgId = subscription.metadata?.orgId;
    
    if (orgId) {
      // Get quantity from line items
      let seatLimit = 5;
      if (subscription.items?.data?.[0]?.quantity) {
        seatLimit = subscription.items.data[0].quantity;
      }
      
      const periodEnd = (subscription as unknown as { current_period_end?: number }).current_period_end;
      
      console.log(`[Stripe Webhook] Invoice paid for org ${orgId}`);
      
      await updateOrgSubscription(orgId, {
        subscriptionStatus: "active",
        seatLimit,
        currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : undefined,
      });
    }
  } catch (err) {
    console.error("[Stripe Webhook] Error handling invoice payment:", err);
  }
}

/**
 * Handle invoice.payment_failed event
 */
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = (invoice as unknown as { subscription?: string }).subscription;
  if (!subscriptionId) return;
  
  const stripe = getStripe();
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const orgId = subscription.metadata?.orgId;
    
    if (orgId) {
      console.log(`[Stripe Webhook] Invoice payment failed for org ${orgId}`);
      
      await updateOrgSubscription(orgId, {
        subscriptionStatus: "past_due",
      });
    }
  } catch (err) {
    console.error("[Stripe Webhook] Error handling invoice failure:", err);
  }
}
