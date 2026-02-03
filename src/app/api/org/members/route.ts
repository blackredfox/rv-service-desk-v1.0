import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getFirebaseAuth } from "@/lib/firebase-admin";
import {
  getMemberByUid,
  getOrganization,
  getOrgMembers,
  createMember,
  updateMember,
  recalculateActiveSeatCount,
  type OrgMember,
} from "@/lib/firestore";

const SESSION_COOKIE_NAME = "rv_session";

/**
 * GET /api/org/members - Get all members of user's organization
 */
export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    
    if (!sessionCookie) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    
    const auth = getFirebaseAuth();
    const decodedClaims = await auth.verifySessionCookie(sessionCookie, true);
    
    // Get member record
    const member = await getMemberByUid(decodedClaims.uid);
    
    if (!member) {
      return NextResponse.json({ error: "Not a member of any organization" }, { status: 403 });
    }
    
    // Only admins can view all members
    if (member.role !== "admin") {
      return NextResponse.json({ error: "Only admins can view members" }, { status: 403 });
    }
    
    const members = await getOrgMembers(member.orgId);
    
    // Don't expose internal IDs, just necessary info
    const sanitized = members.map(m => ({
      id: m.id,
      email: m.email,
      role: m.role,
      status: m.status,
      createdAt: m.createdAt,
    }));
    
    return NextResponse.json({ members: sanitized });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to get members";
    
    if (message.includes("session") || message.includes("token")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

type InviteMemberBody = {
  email?: string;
  role?: "admin" | "member";
};

/**
 * POST /api/org/members - Invite/add a new member (admin only)
 */
export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    
    if (!sessionCookie) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    
    const auth = getFirebaseAuth();
    const decodedClaims = await auth.verifySessionCookie(sessionCookie, true);
    
    // Get admin's member record
    const adminMember = await getMemberByUid(decodedClaims.uid);
    
    if (!adminMember || adminMember.role !== "admin") {
      return NextResponse.json({ error: "Only admins can add members" }, { status: 403 });
    }
    
    // Get organization
    const org = await getOrganization(adminMember.orgId);
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }
    
    // Check subscription
    if (org.subscriptionStatus !== "active" && org.subscriptionStatus !== "trialing") {
      return NextResponse.json(
        { error: "Subscription inactive. Cannot add members." },
        { status: 403 }
      );
    }
    
    // Check seat availability
    if (org.activeSeatCount >= org.seatLimit) {
      return NextResponse.json(
        { error: "Seat limit reached. Please purchase more seats." },
        { status: 403 }
      );
    }
    
    const body = (await req.json().catch(() => null)) as InviteMemberBody | null;
    
    const email = body?.email?.trim().toLowerCase();
    const role = body?.role || "member";
    
    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
    }
    
    // Validate email domain matches org domains
    const emailDomain = email.split("@")[1];
    if (!org.domains.includes(emailDomain)) {
      return NextResponse.json(
        { error: `Email domain must be one of: ${org.domains.join(", ")}` },
        { status: 400 }
      );
    }
    
    // Check if member already exists
    const existingMembers = await getOrgMembers(org.id);
    const existing = existingMembers.find(m => m.email === email);
    if (existing) {
      return NextResponse.json(
        { error: "This email is already a member" },
        { status: 409 }
      );
    }
    
    // Create member with active status (admin explicitly grants access)
    // Note: We use a placeholder UID that will be updated when they register
    const newMember = await createMember({
      orgId: org.id,
      uid: `pending_${Date.now()}`, // Temporary UID until user signs up
      email,
      role,
      status: "active",
    });
    
    return NextResponse.json({
      member: {
        id: newMember.id,
        email: newMember.email,
        role: newMember.role,
        status: newMember.status,
      },
    }, { status: 201 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to add member";
    
    if (message.includes("session") || message.includes("token")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    
    console.error("[API /api/org/members POST] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

type UpdateMemberBody = {
  memberId?: string;
  status?: "active" | "inactive";
  role?: "admin" | "member";
};

/**
 * PATCH /api/org/members - Update a member (admin only)
 */
export async function PATCH(req: Request) {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    
    if (!sessionCookie) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    
    const auth = getFirebaseAuth();
    const decodedClaims = await auth.verifySessionCookie(sessionCookie, true);
    
    // Get admin's member record
    const adminMember = await getMemberByUid(decodedClaims.uid);
    
    if (!adminMember || adminMember.role !== "admin") {
      return NextResponse.json({ error: "Only admins can update members" }, { status: 403 });
    }
    
    const body = (await req.json().catch(() => null)) as UpdateMemberBody | null;
    
    const memberId = body?.memberId;
    const status = body?.status;
    const role = body?.role;
    
    if (!memberId) {
      return NextResponse.json({ error: "memberId is required" }, { status: 400 });
    }
    
    if (!status && !role) {
      return NextResponse.json({ error: "status or role is required" }, { status: 400 });
    }
    
    // Get the member to update
    const allMembers = await getOrgMembers(adminMember.orgId);
    const targetMember = allMembers.find(m => m.id === memberId);
    
    if (!targetMember) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }
    
    // If activating a member, check seat availability
    if (status === "active" && targetMember.status !== "active") {
      const org = await getOrganization(adminMember.orgId);
      if (org && org.activeSeatCount >= org.seatLimit) {
        return NextResponse.json(
          { error: "Seat limit reached. Cannot activate member." },
          { status: 403 }
        );
      }
    }
    
    // Update member
    const updateData: Partial<OrgMember> = {};
    if (status) updateData.status = status;
    if (role) updateData.role = role;
    
    await updateMember(memberId, updateData);
    
    // Recalculate seat count if status changed
    if (status) {
      await recalculateActiveSeatCount(adminMember.orgId);
    }
    
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to update member";
    
    if (message.includes("session") || message.includes("token")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    
    console.error("[API /api/org/members PATCH] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
