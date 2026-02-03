/**
 * Email Service - MVP Implementation using Resend
 * 
 * Design: Easily swappable to another provider by changing this file only.
 * Currently uses Resend API for transactional emails.
 */

import { Resend } from "resend";

// Initialize Resend client
const resend = new Resend(process.env.RESEND_API_KEY);

// Sender email - use Resend's test domain or your verified domain
const SENDER_EMAIL = process.env.SENDER_EMAIL || "onboarding@resend.dev";
const APP_NAME = process.env.APP_NAME || "RV Service Desk";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "";

export type SendEmailParams = {
  to: string;
  subject: string;
  html: string;
};

/**
 * Send a transactional email
 * Returns email ID on success, throws on failure
 */
export async function sendEmail(params: SendEmailParams): Promise<string> {
  const { to, subject, html } = params;

  console.log(`[Email] Sending to ${to}: "${subject}"`);

  try {
    const { data, error } = await resend.emails.send({
      from: `${APP_NAME} <${SENDER_EMAIL}>`,
      to: [to],
      subject,
      html,
    });

    if (error) {
      console.error("[Email] Resend error:", error);
      throw new Error(error.message || "Failed to send email");
    }

    console.log(`[Email] Sent successfully, id=${data?.id}`);
    return data?.id || "unknown";
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown email error";
    console.error("[Email] Send failed:", message);
    throw new Error(message);
  }
}

/**
 * Send member invitation email
 */
export async function sendInvitationEmail(params: {
  to: string;
  orgName: string;
  inviterEmail?: string;
}): Promise<string> {
  const { to, orgName, inviterEmail } = params;

  // Build simple login/signup URL
  const loginUrl = APP_URL || "https://app.example.com";

  const subject = `You've been invited to join ${orgName}`;

  // Plain, minimal HTML email
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #f9fafb; border-radius: 8px; padding: 32px; text-align: center;">
    <h1 style="margin: 0 0 16px; font-size: 24px; font-weight: 600; color: #111;">
      You've been invited to ${escapeHtml(orgName)}
    </h1>
    
    <p style="margin: 0 0 24px; color: #666; font-size: 16px;">
      ${inviterEmail ? `${escapeHtml(inviterEmail)} has invited you to join their team on ${APP_NAME}.` : `You've been invited to join ${escapeHtml(orgName)} on ${APP_NAME}.`}
    </p>
    
    <a href="${loginUrl}" 
       style="display: inline-block; background: #18181b; color: #fff; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-weight: 500; font-size: 16px;">
      Sign In to Get Started
    </a>
    
    <p style="margin: 24px 0 0; color: #999; font-size: 14px;">
      Use your ${to.split("@")[1]} email address to sign in.
    </p>
  </div>
  
  <p style="margin: 24px 0 0; color: #999; font-size: 12px; text-align: center;">
    If you didn't expect this invitation, you can safely ignore this email.
  </p>
</body>
</html>
`.trim();

  return sendEmail({ to, subject, html });
}

/**
 * Escape HTML to prevent XSS in email content
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
