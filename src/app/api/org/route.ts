import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getFirebaseAuth } from "@/lib/firebase-admin";
import { isDevBypassDomainGatingEnabled } from "@/lib/dev-flags";
import {
  createOrganization,
  getOrganizationByDomain,
  getMemberByUid,
  getOrganization,
  isPersonalDomain,
  getEmailDomain,
} from "@/lib/firestore";

const SESSION_COOKIE_NAME = "rv_session";

/**
 * GET /api/org - Get current user's organization
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
      return NextResponse.json({ organization: null, member: null });
    }
    
    // Get organization
    const org = await getOrganization(member.orgId);
    
    return NextResponse.json({
      organization: org,
      member: {
        id: member.id,
        role: member.role,
        status: member.status,
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to get organization";
    
    if (message.includes("session") || message.includes("token")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

type CreateOrgBody = {
  name?: string;
  domains?: string[];
  seatLimit?: number;
};

/**
 * POST /api/org - Create a new organization
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
    const email = decodedClaims.email || "";
    const uid = decodedClaims.uid;
    
    // Check if user already belongs to an org
    const existingMember = await getMemberByUid(uid);
    if (existingMember) {
      return NextResponse.json(
        { error: "You already belong to an organization" },
        { status: 400 }
      );
    }
    
    const body = (await req.json().catch(() => null)) as CreateOrgBody | null;
    
    const name = body?.name?.trim();
    let domains = body?.domains;
    const seatLimit = body?.seatLimit || 5;
    
    if (!name || name.length < 2) {
      return NextResponse.json(
        { error: "Organization name is required (min 2 characters)" },
        { status: 400 }
      );
    }
    
    // If no domains provided, use admin's email domain
    if (!domains || domains.length === 0) {
      const adminDomain = getEmailDomain(email);
      if (!adminDomain) {
        return NextResponse.json(
          { error: "Could not determine email domain" },
          { status: 400 }
        );
      }
      
      // Block personal domains (production behavior)
      // DEV ONLY: allow personal domains to create org in local dev when bypass is enabled.
      const bypassDomainGating = isDevBypassDomainGatingEnabled();
      if (!bypassDomainGating && isPersonalDomain(email)) {
        return NextResponse.json(
          { error: "Personal email domains (gmail, yahoo, etc.) are not allowed. Please use a corporate email." },
          { status: 400 }
        );
      }
      
      domains = [adminDomain];
    }
    
    // Validate domains
    const bypassDomainGating = isDevBypassDomainGatingEnabled();

    for (const domain of domains) {
      if (!bypassDomainGating && isPersonalDomain(`test@${domain}`)) {
        return NextResponse.json(
          { error: `Personal domain "${domain}" is not allowed` },
          { status: 400 }
        );
      }
      
      // Check if domain already belongs to another org
      const existingOrg = await getOrganizationByDomain(domain);
      if (existingOrg) {
        return NextResponse.json(
          { error: `Domain "${domain}" is already registered to another organization` },
          { status: 409 }
        );
      }
    }
    
    // Create organization
    const org = await createOrganization({
      name,
      domains,
      createdByUid: uid,
      createdByEmail: email,
      seatLimit,
    });
    
    return NextResponse.json({ organization: org }, { status: 201 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to create organization";
    
    if (message.includes("session") || message.includes("token")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    
    console.error("[API /api/org POST] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
