import { cookies } from "next/headers";
import { getPrisma } from "@/lib/db";
import { getFirebaseAuth } from "@/lib/firebase-admin";

const SESSION_COOKIE_NAME = "rv_session";
const SESSION_DURATION_DAYS = parseInt(process.env.SESSION_COOKIE_DAYS || "7", 10);
const SESSION_DURATION_MS = SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000;

export type AuthUser = {
  id: string;
  email: string;
  plan: "FREE" | "PREMIUM" | "PRO";
  status: "ACTIVE" | "INACTIVE" | "PAST_DUE" | "CANCELED";
};

// Rate limiting (simple in-memory for MVP)
const loginAttempts = new Map<string, { count: number; lastAttempt: number }>();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX_ATTEMPTS = process.env.NODE_ENV === "development" ? 200 : 10;

export function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = loginAttempts.get(ip);

  if (!record) {
    loginAttempts.set(ip, { count: 1, lastAttempt: now });
    return true;
  }

  if (now - record.lastAttempt > RATE_LIMIT_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, lastAttempt: now });
    return true;
  }

  if (record.count >= RATE_LIMIT_MAX_ATTEMPTS) {
    return false;
  }

  record.count++;
  record.lastAttempt = now;
  return true;
}

/**
 * Verify credentials using Firebase Identity Toolkit REST API
 */
export async function verifyFirebasePassword(
  email: string,
  password: string
): Promise<string> {
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!apiKey) {
    throw new Error("FIREBASE_WEB_API_KEY not configured");
  }

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true,
      }),
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorCode = errorData?.error?.message || "UNKNOWN_ERROR";
    if (
      errorCode === "EMAIL_NOT_FOUND" ||
      errorCode === "INVALID_PASSWORD" ||
      errorCode === "INVALID_LOGIN_CREDENTIALS"
    ) {
      throw new Error("Invalid credentials");
    }
    throw new Error(`Firebase auth error: ${errorCode}`);
  }

  const data = await response.json();
  return data.idToken as string;
}

/**
 * Create Firebase session cookie from ID token
 */
export async function createFirebaseSessionCookie(idToken: string): Promise<string> {
  const auth = getFirebaseAuth();
  return auth.createSessionCookie(idToken, { expiresIn: SESSION_DURATION_MS });
}

/**
 * Verify Firebase session cookie
 */
export async function verifyFirebaseSessionCookie(
  sessionCookie: string
): Promise<{ uid: string; email: string }> {
  const auth = getFirebaseAuth();
  const decodedClaims = await auth.verifySessionCookie(sessionCookie, true);
  return {
    uid: decodedClaims.uid,
    email: decodedClaims.email || "",
  };
}

/**
 * Set session cookie in response
 * Uses session cookie (no maxAge) so it expires when browser closes
 */
export async function setSessionCookie(sessionCookie: string) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, sessionCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    // No maxAge = session cookie that expires when browser closes
    path: "/",
  });
}

/**
 * Clear session cookie
 */
export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
}

/**
 * Get session cookie value
 */
export async function getSessionCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);
  return sessionCookie?.value || null;
}

/**
 * Upsert user + subscription in Prisma
 */
export async function upsertPrismaUser(
  email: string,
  firebaseUid: string
): Promise<AuthUser> {
  const prisma = await getPrisma();
  if (!prisma) {
    // When no database is configured (eg. local dev without DATABASE_URL),
    // return a minimal AuthUser so registration/login still works for auth flows.
    return {
      id: firebaseUid,
      email,
      plan: "FREE",
      status: "INACTIVE",
    };
  }

  // Upsert user
  const user = await prisma.user.upsert({
    where: { email },
    update: { firebaseUid },
    create: {
      email,
      firebaseUid,
    },
    include: { subscription: true },
  });

  // Ensure subscription exists
  if (!user.subscription) {
    await prisma.subscription.create({
      data: {
        userId: user.id,
        plan: "FREE",
        status: "INACTIVE",
      },
    });
  }

  const sub = user.subscription;
  return {
    id: user.id,
    email: user.email,
    plan: sub?.plan ?? "FREE",
    status: sub?.status ?? "INACTIVE",
  };
}

/**
 * Get current user from Firebase session cookie
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const sessionCookie = await getSessionCookie();
  if (!sessionCookie) return null;

  try {
    const { email, uid } = await verifyFirebaseSessionCookie(sessionCookie);
    if (!email) return null;

    return await upsertPrismaUser(email, uid);
  } catch {
    // Invalid or expired session
    return null;
  }
}

/**
 * Create user in Firebase and Prisma
 */
export async function registerUser(
  email: string,
  password: string
): Promise<AuthUser> {
  const auth = getFirebaseAuth();

  // Create user in Firebase
  const firebaseUser = await auth.createUser({
    email,
    password,
  });

  // Upsert in Prisma
  return upsertPrismaUser(email, firebaseUser.uid);
}

/**
 * Login user via Firebase and create session cookie
 */
export async function loginUser(
  email: string,
  password: string
): Promise<{ user: AuthUser; sessionCookie: string }> {
  // Verify credentials with Firebase REST API
  const idToken = await verifyFirebasePassword(email, password);

  // Create session cookie
  const sessionCookie = await createFirebaseSessionCookie(idToken);

  // Decode token to get uid
  const auth = getFirebaseAuth();
  const decodedToken = await auth.verifyIdToken(idToken);

  // Upsert user in Prisma
  const user = await upsertPrismaUser(email, decodedToken.uid);

  return { user, sessionCookie };
}
