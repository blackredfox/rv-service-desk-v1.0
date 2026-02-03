import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getFirebaseAuth } from "@/lib/firebase-admin";
import {
  getMemberByUid,
  getOrgMembers,
} from "@/lib/firestore";
import { getFirestore } from "@/lib/firestore";

const SESSION_COOKIE_NAME = "rv_session";

type MemberActivity = {
  memberId: string;
  email: string;
  role: "admin" | "member";
  status: "active" | "inactive" | "pending";
  lastLoginAt: string | null;
  casesLast7Days: number;
  casesLast30Days: number;
  totalMessages: number;
  createdAt: string;
};

/**
 * GET /api/org/activity - Get activity metrics for all members (admin only)
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
    
    // Only admins can view activity
    if (member.role !== "admin") {
      return NextResponse.json({ error: "Only admins can view activity" }, { status: 403 });
    }
    
    const members = await getOrgMembers(member.orgId);
    const db = getFirestore();
    
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    
    // Get activity for each member
    const activityPromises = members.map(async (m): Promise<MemberActivity> => {
      // Get last login from analytics events
      let lastLoginAt: string | null = null;
      try {
        const loginEvents = await db
          .collection("analyticsEvents")
          .where("eventName", "==", "user.login")
          .where("payloadJson", ">=", JSON.stringify({ email: m.email }))
          .orderBy("payloadJson")
          .orderBy("createdAt", "desc")
          .limit(1)
          .get();
        
        if (!loginEvents.empty) {
          const event = loginEvents.docs[0].data();
          lastLoginAt = event.createdAt?.toDate?.()?.toISOString() || event.createdAt || null;
        }
      } catch {
        // If query fails, try simpler approach - check member's updatedAt
        lastLoginAt = m.updatedAt || null;
      }
      
      // Get case counts - we need to query by the member's UID
      // Since we store cases by userId (Firebase UID), we use the member's uid field
      let casesLast7Days = 0;
      let casesLast30Days = 0;
      let totalMessages = 0;
      
      try {
        // Query Firestore for cases created by this member
        // Note: This assumes cases are stored in Firestore with createdByUid field
        const casesRef = db.collection("cases");
        
        // Cases in last 7 days
        const cases7 = await casesRef
          .where("createdByUid", "==", m.uid)
          .where("createdAt", ">=", sevenDaysAgo.toISOString())
          .get();
        casesLast7Days = cases7.size;
        
        // Cases in last 30 days
        const cases30 = await casesRef
          .where("createdByUid", "==", m.uid)
          .where("createdAt", ">=", thirtyDaysAgo.toISOString())
          .get();
        casesLast30Days = cases30.size;
        
        // Get total messages from all cases
        const allCases = await casesRef
          .where("createdByUid", "==", m.uid)
          .get();
        
        for (const caseDoc of allCases.docs) {
          const messagesSnapshot = await db
            .collection("cases")
            .doc(caseDoc.id)
            .collection("messages")
            .where("role", "==", "user")
            .get();
          totalMessages += messagesSnapshot.size;
        }
      } catch {
        // If Firestore queries fail, return zeros
        casesLast7Days = 0;
        casesLast30Days = 0;
        totalMessages = 0;
      }
      
      return {
        memberId: m.id,
        email: m.email,
        role: m.role,
        status: m.status,
        lastLoginAt,
        casesLast7Days,
        casesLast30Days,
        totalMessages,
        createdAt: m.createdAt,
      };
    });
    
    const activity = await Promise.all(activityPromises);
    
    // Sort by last login (most inactive first - null/oldest first)
    activity.sort((a, b) => {
      if (!a.lastLoginAt && !b.lastLoginAt) return 0;
      if (!a.lastLoginAt) return -1;
      if (!b.lastLoginAt) return 1;
      return new Date(a.lastLoginAt).getTime() - new Date(b.lastLoginAt).getTime();
    });
    
    return NextResponse.json({ activity });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to get activity";
    
    if (message.includes("session") || message.includes("token")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    
    console.error("[API /api/org/activity] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
