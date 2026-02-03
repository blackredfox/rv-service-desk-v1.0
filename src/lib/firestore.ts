import { getFirebaseAdmin } from "./firebase-admin";

let firestoreInstance: FirebaseFirestore.Firestore | null = null;

/**
 * Get Firestore instance (singleton)
 */
export function getFirestore(): FirebaseFirestore.Firestore {
  if (firestoreInstance) return firestoreInstance;
  
  const admin = getFirebaseAdmin();
  firestoreInstance = admin.firestore();
  return firestoreInstance;
}

// ============== Organization Types ==============

export type SubscriptionStatus = "active" | "trialing" | "past_due" | "canceled" | "none";

export type Organization = {
  id: string;
  name: string;
  domains: string[];
  createdAt: string;
  createdByUid: string;
  seatLimit: number;
  activeSeatCount: number;
  subscriptionStatus: SubscriptionStatus;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  currentPeriodEnd?: string;
};

export type MemberRole = "admin" | "member";
export type MemberStatus = "active" | "inactive" | "pending";

export type OrgMember = {
  id: string;
  orgId: string;
  uid: string;
  email: string;
  role: MemberRole;
  status: MemberStatus;
  createdAt: string;
  updatedAt: string;
};

// ============== Organization CRUD ==============

/**
 * Create a new organization
 */
export async function createOrganization(data: {
  name: string;
  domains: string[];
  createdByUid: string;
  createdByEmail: string;
  seatLimit?: number;
}): Promise<Organization> {
  const db = getFirestore();
  const now = new Date().toISOString();
  
  const orgRef = db.collection("organizations").doc();
  const org: Omit<Organization, "id"> = {
    name: data.name,
    domains: data.domains.map(d => d.toLowerCase()),
    createdAt: now,
    createdByUid: data.createdByUid,
    seatLimit: data.seatLimit || 5,
    activeSeatCount: 1, // creator is the first member
    subscriptionStatus: "none",
  };
  
  await orgRef.set(org);
  
  // Create the admin membership
  const memberRef = db.collection("orgMembers").doc();
  const member: Omit<OrgMember, "id"> = {
    orgId: orgRef.id,
    uid: data.createdByUid,
    email: data.createdByEmail.toLowerCase(),
    role: "admin",
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  await memberRef.set(member);
  
  return { ...org, id: orgRef.id };
}

/**
 * Get organization by ID
 */
export async function getOrganization(orgId: string): Promise<Organization | null> {
  const db = getFirestore();
  const doc = await db.collection("organizations").doc(orgId).get();
  
  if (!doc.exists) return null;
  
  return { id: doc.id, ...doc.data() } as Organization;
}

/**
 * Get organization by domain
 */
export async function getOrganizationByDomain(domain: string): Promise<Organization | null> {
  const db = getFirestore();
  const snapshot = await db
    .collection("organizations")
    .where("domains", "array-contains", domain.toLowerCase())
    .limit(1)
    .get();
  
  if (snapshot.empty) return null;
  
  const doc = snapshot.docs[0];
  return { id: doc.id, ...doc.data() } as Organization;
}

/**
 * Update organization
 */
export async function updateOrganization(
  orgId: string,
  data: Partial<Omit<Organization, "id">>
): Promise<void> {
  const db = getFirestore();
  await db.collection("organizations").doc(orgId).update(data);
}

// ============== Member CRUD ==============

/**
 * Get member by user UID
 */
export async function getMemberByUid(uid: string): Promise<OrgMember | null> {
  const db = getFirestore();
  const snapshot = await db
    .collection("orgMembers")
    .where("uid", "==", uid)
    .limit(1)
    .get();
  
  if (snapshot.empty) return null;
  
  const doc = snapshot.docs[0];
  return { id: doc.id, ...doc.data() } as OrgMember;
}

/**
 * Get member by email
 */
export async function getMemberByEmail(email: string): Promise<OrgMember | null> {
  const db = getFirestore();
  const snapshot = await db
    .collection("orgMembers")
    .where("email", "==", email.toLowerCase())
    .limit(1)
    .get();
  
  if (snapshot.empty) return null;
  
  const doc = snapshot.docs[0];
  return { id: doc.id, ...doc.data() } as OrgMember;
}

/**
 * Create or join member to an organization
 */
export async function createMember(data: {
  orgId: string;
  uid: string;
  email: string;
  role?: MemberRole;
  status?: MemberStatus;
}): Promise<OrgMember> {
  const db = getFirestore();
  const now = new Date().toISOString();
  
  const memberRef = db.collection("orgMembers").doc();
  const member: Omit<OrgMember, "id"> = {
    orgId: data.orgId,
    uid: data.uid,
    email: data.email.toLowerCase(),
    role: data.role || "member",
    status: data.status || "active",
    createdAt: now,
    updatedAt: now,
  };
  
  await memberRef.set(member);
  
  // Update active seat count
  await recalculateActiveSeatCount(data.orgId);
  
  return { id: memberRef.id, ...member };
}

/**
 * Update member
 */
export async function updateMember(
  memberId: string,
  data: Partial<Omit<OrgMember, "id">>
): Promise<void> {
  const db = getFirestore();
  await db.collection("orgMembers").doc(memberId).update({
    ...data,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Get all members of an organization
 */
export async function getOrgMembers(orgId: string): Promise<OrgMember[]> {
  const db = getFirestore();
  const snapshot = await db
    .collection("orgMembers")
    .where("orgId", "==", orgId)
    .get();
  
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as OrgMember));
}

/**
 * Get active member count for an organization
 */
export async function getActiveMemberCount(orgId: string): Promise<number> {
  const db = getFirestore();
  const snapshot = await db
    .collection("orgMembers")
    .where("orgId", "==", orgId)
    .where("status", "==", "active")
    .get();
  
  return snapshot.size;
}

/**
 * Recalculate and update active seat count for an organization
 */
export async function recalculateActiveSeatCount(orgId: string): Promise<number> {
  const count = await getActiveMemberCount(orgId);
  await updateOrganization(orgId, { activeSeatCount: count });
  return count;
}

// ============== Billing Helpers ==============

/**
 * Update organization subscription from Stripe webhook
 */
export async function updateOrgSubscription(
  orgId: string,
  data: {
    subscriptionStatus: SubscriptionStatus;
    seatLimit?: number;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    currentPeriodEnd?: string;
  }
): Promise<void> {
  console.log(`[Stripe Sync] Updating org ${orgId} with:`, JSON.stringify(data));
  
  // Only include defined values in update
  const updateData: Partial<Organization> = {
    subscriptionStatus: data.subscriptionStatus,
  };
  
  if (data.seatLimit !== undefined) {
    updateData.seatLimit = data.seatLimit;
    console.log(`[Stripe Sync] Updating org ${orgId} seatLimit to ${data.seatLimit}`);
  }
  if (data.stripeCustomerId !== undefined) {
    updateData.stripeCustomerId = data.stripeCustomerId;
  }
  if (data.stripeSubscriptionId !== undefined) {
    updateData.stripeSubscriptionId = data.stripeSubscriptionId;
  }
  if (data.currentPeriodEnd !== undefined) {
    updateData.currentPeriodEnd = data.currentPeriodEnd;
  }
  
  await updateOrganization(orgId, updateData);
  console.log(`[Stripe Sync] Successfully updated org ${orgId}`);
}

/**
 * Find organization by Stripe customer ID
 */
export async function getOrgByStripeCustomerId(customerId: string): Promise<Organization | null> {
  const db = getFirestore();
  const snapshot = await db
    .collection("organizations")
    .where("stripeCustomerId", "==", customerId)
    .limit(1)
    .get();
  
  if (snapshot.empty) return null;
  
  const doc = snapshot.docs[0];
  return { id: doc.id, ...doc.data() } as Organization;
}

// ============== Domain Validation ==============

const BLOCKED_PERSONAL_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "aol.com",
  "live.com",
  "msn.com",
  "protonmail.com",
  "zoho.com",
  "yandex.com",
  "mail.com",
  "gmx.com",
];

/**
 * Check if email domain is a personal/blocked domain
 */
export function isPersonalDomain(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return true;
  return BLOCKED_PERSONAL_DOMAINS.includes(domain);
}

/**
 * Extract domain from email
 */
export function getEmailDomain(email: string): string {
  return email.split("@")[1]?.toLowerCase() || "";
}
