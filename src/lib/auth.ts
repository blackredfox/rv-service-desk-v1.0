import { cookies } from "next/headers";
import { getPrisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";

const SESSION_COOKIE_NAME = "rv_session";
const SESSION_DURATION_DAYS = 30;

export type AuthUser = {
  id: string;
  email: string;
  plan: "FREE" | "PREMIUM" | "PRO";
  status: "ACTIVE" | "INACTIVE" | "PAST_DUE" | "CANCELED";
};

// Rate limiting (simple in-memory for MVP)
const loginAttempts = new Map<string, { count: number; lastAttempt: number }>();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX_ATTEMPTS = 10;

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

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: string): Promise<string> {
  const prisma = await getPrisma();
  if (!prisma) throw new Error("Database not configured");

  const sessionId = uuidv4();
  const expiresAt = new Date(
    Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000
  );

  await prisma.session.create({
    data: {
      id: sessionId,
      userId,
      expiresAt,
    },
  });

  return sessionId;
}

export async function setSessionCookie(sessionId: string) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_DURATION_DAYS * 24 * 60 * 60,
    path: "/",
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export async function getSessionFromCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);
  return sessionCookie?.value ?? null;
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const sessionId = await getSessionFromCookie();
  if (!sessionId) return null;

  const prisma = await getPrisma();
  if (!prisma) return null;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      user: {
        include: {
          subscription: true,
        },
      },
    },
  });

  if (!session) return null;

  // Check if session expired
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: sessionId } });
    return null;
  }

  const user = session.user;
  const sub = user.subscription;

  return {
    id: user.id,
    email: user.email,
    plan: sub?.plan ?? "FREE",
    status: sub?.status ?? "INACTIVE",
  };
}

export async function invalidateSession(sessionId: string): Promise<void> {
  const prisma = await getPrisma();
  if (!prisma) return;

  await prisma.session.delete({ where: { id: sessionId } }).catch(() => {
    // Session might not exist
  });
}

export async function invalidateAllUserSessions(userId: string): Promise<void> {
  const prisma = await getPrisma();
  if (!prisma) return;

  await prisma.session.deleteMany({ where: { userId } });
}

export async function registerUser(
  email: string,
  password: string
): Promise<{ user: AuthUser; sessionId: string }> {
  const prisma = await getPrisma();
  if (!prisma) throw new Error("Database not configured");

  // Check if user exists
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new Error("User already exists");
  }

  const hashedPassword = await hashPassword(password);

  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      subscription: {
        create: {
          plan: "FREE",
          status: "ACTIVE",
        },
      },
    },
    include: {
      subscription: true,
    },
  });

  const sessionId = await createSession(user.id);

  return {
    user: {
      id: user.id,
      email: user.email,
      plan: user.subscription?.plan ?? "FREE",
      status: user.subscription?.status ?? "ACTIVE",
    },
    sessionId,
  };
}

export async function loginUser(
  email: string,
  password: string
): Promise<{ user: AuthUser; sessionId: string }> {
  const prisma = await getPrisma();
  if (!prisma) throw new Error("Database not configured");

  const user = await prisma.user.findUnique({
    where: { email },
    include: { subscription: true },
  });

  if (!user) {
    throw new Error("Invalid credentials");
  }

  const valid = await verifyPassword(password, user.password);
  if (!valid) {
    throw new Error("Invalid credentials");
  }

  const sessionId = await createSession(user.id);

  return {
    user: {
      id: user.id,
      email: user.email,
      plan: user.subscription?.plan ?? "FREE",
      status: user.subscription?.status ?? "ACTIVE",
    },
    sessionId,
  };
}
