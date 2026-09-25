import nodemailer from "nodemailer";
import type { EventSection } from "./types";

interface SendDeploymentInvitationParams {
  toEmail: string;
  recipientName: string;
  eventName: string;
  eventDescription?: string | null;
  section: EventSection;
  startTime: string;
  endTime: string;
  location: string;
  hasRehearsal?: boolean;
  rehearsalStartTime?: string | null;
  rehearsalEndTime?: string | null;
  attendingRehearsal?: boolean;
  token: string;
  origin?: string;
}

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = process.env.SMTP_SECURE === "true" || port === 465;

  if (host && user && pass) {
    return nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });
  }

  return null;
}

const SECTION_NAMES: Record<EventSection, string> = {
  photo: "Photography",
  video: "Videography",
  av: "Audio / AV",
};

const SECTION_COLORS: Record<EventSection, string> = {
  photo: "#3b82f6", // Blue
  video: "#8b5cf6", // Purple
  av: "#10b981",    // Emerald
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export async function sendDeploymentInvitationEmail({
  toEmail,
  recipientName,
  eventName,
  eventDescription,
  section,
  startTime,
  endTime,
  location,
  hasRehearsal,
  rehearsalStartTime,
  rehearsalEndTime,
  attendingRehearsal,
  token,
  origin,
}: SendDeploymentInvitationParams): Promise<{ success: boolean; previewUrl?: string; error?: string }> {
  try {
    const rawBaseUrl =
      process.env.NEXTAUTH_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : origin) ||
      "http://localhost:3000";

    let baseUrl = "http://localhost:3000";
    try {
      const parsed = new URL(rawBaseUrl);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        baseUrl = parsed.origin;
      }
    } catch {
      baseUrl = "http://localhost:3000";
    }

    const safeToken = encodeURIComponent(token.trim());
    const rsvpUrl = `${baseUrl}/rsvp/${safeToken}`;
    const confirmUrl = `${baseUrl}/rsvp/${safeToken}?action=confirm`;
    const declineUrl = `${baseUrl}/rsvp/${safeToken}?action=decline`;

    const sectionName = SECTION_NAMES[section] || section;
    const sectionColor = SECTION_COLORS[section] || "#7c3aed";

    const safeRecipient = escapeHtml(recipientName);
    const safeEventName = escapeHtml(eventName);
    const safeEventDesc = eventDescription ? escapeHtml(eventDescription) : null;
    const safeLocation = escapeHtml(location);
    const safeSectionName = escapeHtml(sectionName);

    const formattedStart = new Date(startTime).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    const formattedEnd = new Date(endTime).toLocaleString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    let rehearsalHtml = "";
    if (hasRehearsal && rehearsalStartTime && rehearsalEndTime) {
      const formattedRehStart = new Date(rehearsalStartTime).toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      const formattedRehEnd = new Date(rehearsalEndTime).toLocaleString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });

      rehearsalHtml = `
        <div style="margin-top: 14px; padding: 12px; background-color: #fef3c7; border: 1px solid #fde68a; border-radius: 8px;">
          <p style="margin: 0; font-weight: 600; color: #92400e; font-size: 13px;">
            🎭 Rehearsal Scheduled
          </p>
          <p style="margin: 4px 0 0 0; color: #78350f; font-size: 13px;">
            <strong>Time:</strong> ${formattedRehStart} - ${formattedRehEnd}
          </p>
          ${
            attendingRehearsal
              ? `<p style="margin: 4px 0 0 0; color: #166534; font-size: 12px; font-weight: 600;">✓ You are slated to attend this rehearsal.</p>`
              : `<p style="margin: 4px 0 0 0; color: #6b7280; font-size: 12px;">(Rehearsal attendance optional for your role)</p>`
          }
        </div>
      `;
    }

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>MediaHub Event Deployment</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f4f5; margin: 0; padding: 24px; color: #18181b;">
        <div style="max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e4e4e7; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          
          <!-- Header Banner -->
          <div style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 24px; text-align: center; color: #ffffff;">
            <h1 style="margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.02em;">MediaHub Deployment Invitation</h1>
            <p style="margin: 6px 0 0 0; opacity: 0.9; font-size: 14px;">Are you available to crew for this upcoming event?</p>
          </div>

          <!-- Body Container -->
          <div style="padding: 24px;">
            <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.5;">
              Hi <strong>${safeRecipient}</strong>,
            </p>
            <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.5; color: #3f3f46;">
              You have been selected for the <strong>${safeSectionName}</strong> team for the upcoming event:
            </p>

            <!-- Event Card Details -->
            <div style="background-color: #fafafa; border: 1px solid #e4e4e7; border-radius: 10px; padding: 18px; margin-bottom: 24px;">
              <div style="display: inline-block; padding: 4px 10px; background-color: ${sectionColor}; color: #ffffff; font-size: 11px; font-weight: 700; text-transform: uppercase; border-radius: 9999px; margin-bottom: 10px;">
                ${safeSectionName} Deployment
              </div>
              <h2 style="margin: 0 0 10px 0; font-size: 18px; color: #09090b; font-weight: 700;">
                ${safeEventName}
              </h2>
              
              ${safeEventDesc ? `<p style="margin: 0 0 12px 0; font-size: 13px; color: #52525b; line-height: 1.4;">${safeEventDesc}</p>` : ""}

              <div style="font-size: 13px; color: #27272a; line-height: 1.6;">
                <p style="margin: 4px 0;">📅 <strong>Date & Time:</strong> ${formattedStart} – ${formattedEnd}</p>
                <p style="margin: 4px 0;">📍 <strong>Location:</strong> ${safeLocation}</p>
              </div>

              ${rehearsalHtml}
            </div>

            <!-- Action Buttons -->
            <p style="margin: 0 0 14px 0; font-size: 14px; font-weight: 600; text-align: center; color: #18181b;">
              Please indicate your availability:
            </p>
            
            <div style="text-align: center; margin-bottom: 24px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                <tr>
                  <td style="padding: 0 8px;">
                    <a href="${escapeHtml(confirmUrl)}" style="display: inline-block; padding: 12px 24px; background-color: #16a34a; color: #ffffff; font-weight: 600; font-size: 14px; text-decoration: none; border-radius: 8px; box-shadow: 0 2px 4px rgba(22, 163, 74, 0.2);">
                      ✓ I am Free (Confirm)
                    </a>
                  </td>
                  <td style="padding: 0 8px;">
                    <a href="${escapeHtml(declineUrl)}" style="display: inline-block; padding: 12px 24px; background-color: #ef4444; color: #ffffff; font-weight: 600; font-size: 14px; text-decoration: none; border-radius: 8px; box-shadow: 0 2px 4px rgba(239, 68, 68, 0.2);">
                      ✕ Not Free (Decline)
                    </a>
                  </td>
                </tr>
              </table>
            </div>

            <p style="margin: 0; font-size: 12px; text-align: center; color: #71717a;">
              Need to add a note or change your response later? 
              <a href="${escapeHtml(rsvpUrl)}" style="color: #4f46e5; text-decoration: underline;">View the Event RSVP Page</a>
            </p>
          </div>

          <!-- Footer -->
          <div style="background-color: #f4f4f5; padding: 14px 24px; border-top: 1px solid #e4e4e7; text-align: center; font-size: 12px; color: #71717a;">
            Sent automatically by <strong>MediaHub</strong> • Event Operations & Equipment Management
          </div>
        </div>
      </body>
      </html>
    `;

    const transporter = getTransporter();
    const fromAddress = process.env.SMTP_FROM || '"MediaHub Events" <noreply@mediahub.app>';
    const cleanEventName = eventName.replace(/[\r\n]+/g, " ").trim();
    const cleanToEmail = toEmail.replace(/[\r\n]+/g, "").trim();

    if (transporter) {
      await transporter.sendMail({
        from: fromAddress,
        to: cleanToEmail,
        subject: `[Deployment Invitation] ${cleanEventName} — ${sectionName} Team`,
        html: htmlContent,
      });
      console.log(`✓ Sent deployment email to ${cleanToEmail} for event "${cleanEventName}"`);
      return { success: true };
    } else {
      console.log(`[DEV MAIL] SMTP not configured. Simulated invitation to ${cleanToEmail}:`);
      console.log(`   RSVP Link: ${rsvpUrl}`);
      console.log(`   Confirm Link: ${confirmUrl}`);
      console.log(`   Decline Link: ${declineUrl}`);
      return { success: true, previewUrl: rsvpUrl };
    }
  } catch (err: unknown) {
    console.error("Error dispatching deployment invitation email:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to send email",
    };
  }
}
