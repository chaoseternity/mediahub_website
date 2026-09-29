import nodemailer from "nodemailer";
import type { EventSection } from "./types";
import { formatDate, formatLongDateTime, formatTime, parseDbDate } from "./timezone";

export interface EmailSendResult {
  success: boolean;
  previewUrl?: string;
  error?: string;
  /** True when nothing was sent because email delivery is not configured. */
  skipped?: boolean;
  reason?: string;
}

const SMTP_NOT_CONFIGURED = "SMTP not configured";

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".localhost");
}

function toHttpOrigin(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.origin;
  } catch {
    // ignore malformed values
  }
  return null;
}

/**
 * Public base URL for links in emails. Prefers the configured AUTH_URL (set in wrangler.toml),
 * then NEXTAUTH_URL, then the request origin passed by the caller, then VERCEL_URL. A localhost
 * candidate is only used if nothing better is available, so production mail never links to it.
 */
export function resolveEmailBaseUrl(origin?: string | null): string {
  const candidates = [
    process.env.AUTH_URL,
    process.env.NEXTAUTH_URL,
    origin,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
  ]
    .map(toHttpOrigin)
    .filter((o): o is string => !!o);

  const nonLocal = candidates.find((o) => !isLocalHost(new URL(o).hostname));
  return nonLocal ?? candidates[0] ?? "http://localhost:3000";
}

/** "Tue, 1 Oct 2026, 18:00 – 22:00" (end date repeated only when it differs), in APP_TIMEZONE. */
export function formatEmailTimeRange(start: string, end: string | null | undefined): string {
  const startText = formatLongDateTime(start, start);
  if (!end) return startText;
  const startDate = parseDbDate(start);
  const endDate = parseDbDate(end);
  if (!startDate || !endDate) return `${startText} – ${end}`;
  const sameDay = formatDate(startDate) === formatDate(endDate);
  return `${startText} – ${sameDay ? formatTime(endDate) : formatLongDateTime(endDate)}`;
}

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
}: SendDeploymentInvitationParams): Promise<EmailSendResult> {
  try {
    const baseUrl = resolveEmailBaseUrl(origin);

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

    const formattedRange = escapeHtml(formatEmailTimeRange(startTime, endTime));

    let rehearsalHtml = "";
    if (hasRehearsal && rehearsalStartTime && rehearsalEndTime) {
      const formattedRehearsal = escapeHtml(formatEmailTimeRange(rehearsalStartTime, rehearsalEndTime));

      rehearsalHtml = `
        <div style="margin-top: 14px; padding: 12px; background-color: #fef3c7; border: 1px solid #fde68a; border-radius: 8px;">
          <p style="margin: 0; font-weight: 600; color: #92400e; font-size: 13px;">
            🎭 Rehearsal Scheduled
          </p>
          <p style="margin: 4px 0 0 0; color: #78350f; font-size: 13px;">
            <strong>Time:</strong> ${formattedRehearsal}
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
                <p style="margin: 4px 0;">📅 <strong>Date &amp; Time:</strong> ${formattedRange}</p>
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
      // Never log the RSVP link: it embeds a bearer token that would persist in log storage.
      console.warn(`[MAIL] ${SMTP_NOT_CONFIGURED}; deployment invitation for "${cleanEventName}" was not sent.`);
      return { success: false, skipped: true, reason: SMTP_NOT_CONFIGURED, error: SMTP_NOT_CONFIGURED };
    }
  } catch (err: unknown) {
    console.error("Error dispatching deployment invitation email:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to send email",
    };
  }
}

export interface SendOverdueReminderParams {
  toEmail: string;
  recipientName: string;
  equipmentId: number;
  equipmentName: string;
  serialNumber?: string | null;
  location: string;
  checkedOutAt: string;
  expectedReturnAt: string;
  notes?: string | null;
  isOverdue: boolean;
  origin?: string;
}

export async function sendOverdueReminderEmail({
  toEmail,
  recipientName,
  equipmentId: _equipmentId,
  equipmentName,
  serialNumber,
  location,
  checkedOutAt,
  expectedReturnAt,
  notes,
  isOverdue,
  origin,
}: SendOverdueReminderParams): Promise<EmailSendResult> {
  try {
    const baseUrl = resolveEmailBaseUrl(origin);

    const cleanEquipmentName = equipmentName.replace(/[\r\n]+/g, " ").trim();
    const cleanToEmail = toEmail.replace(/[\r\n]+/g, "").trim();

    const themeColor = isOverdue ? "#dc2626" : "#d97706";
    const badgeText = isOverdue ? "OVERDUE RETURN" : "DUE SOON";
    const subjectPrefix = isOverdue ? "[OVERDUE] Please return" : "[Return Reminder]";
    const headerTitle = isOverdue ? "Equipment Return is Overdue" : "Equipment Due for Return Soon";

    const fmtDate = (d: string) => escapeHtml(formatLongDateTime(d, d));

    const dashboardUrl = `${baseUrl}/dashboard`;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${escapeHtml(headerTitle)}</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f4f5; margin: 0; padding: 24px; color: #18181b;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e4e4e7; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <!-- Header Banner -->
          <div style="background-color: ${themeColor}; padding: 24px 32px; color: #ffffff;">
            <div style="display: inline-block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; background-color: rgba(255, 255, 255, 0.2); padding: 4px 10px; border-radius: 9999px; margin-bottom: 8px;">
              ${badgeText}
            </div>
            <h1 style="margin: 0; font-size: 22px; font-weight: 700; line-height: 1.3;">${escapeHtml(headerTitle)}</h1>
            <p style="margin: 6px 0 0 0; font-size: 14px; opacity: 0.9;">MediaHub Inventory Operations</p>
          </div>

          <!-- Body Content -->
          <div style="padding: 28px 32px;">
            <p style="font-size: 15px; line-height: 1.5; margin: 0 0 16px 0;">
              Hi <strong>${escapeHtml(recipientName)}</strong>,
            </p>
            <p style="font-size: 15px; line-height: 1.5; margin: 0 0 20px 0; color: #3f3f46;">
              ${
                isOverdue
                  ? `This is an urgent reminder that the following equipment was scheduled to be returned on <strong>${fmtDate(expectedReturnAt)}</strong> and is now marked <strong>overdue</strong>. Please return it to the media room or your Section In-Charge promptly so other team members can access it.`
                  : `This is a friendly reminder that the following equipment is scheduled to be returned on <strong>${fmtDate(expectedReturnAt)}</strong>. Please prepare to return it on time.`
              }
            </p>

            <!-- Equipment Card -->
            <div style="background-color: #fafafa; border-radius: 8px; border: 1px solid #e4e4e7; padding: 18px; margin-bottom: 24px;">
              <h2 style="margin: 0 0 12px 0; font-size: 17px; font-weight: 600; color: #18181b;">
                ${escapeHtml(cleanEquipmentName)}
              </h2>
              <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                ${
                  serialNumber
                    ? `<tr>
                        <td style="padding: 6px 0; color: #71717a; width: 140px;">Equipment ID:</td>
                        <td style="padding: 6px 0; font-family: monospace; font-weight: 600; color: #18181b;">${escapeHtml(serialNumber)}</td>
                      </tr>`
                    : ""
                }
                <tr>
                  <td style="padding: 6px 0; color: #71717a; width: 140px;">Return Location:</td>
                  <td style="padding: 6px 0; font-weight: 500; color: #18181b;">${escapeHtml(location || "Media Room")}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #71717a; width: 140px;">Checked Out:</td>
                  <td style="padding: 6px 0; color: #3f3f46;">${fmtDate(checkedOutAt)}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #71717a; width: 140px;">Scheduled Return:</td>
                  <td style="padding: 6px 0; font-weight: 600; color: ${themeColor};">${fmtDate(expectedReturnAt)}</td>
                </tr>
                ${
                  notes
                    ? `<tr>
                        <td style="padding: 6px 0; color: #71717a; width: 140px;">Checkout Notes:</td>
                        <td style="padding: 6px 0; color: #52525b; font-style: italic;">"${escapeHtml(notes)}"</td>
                      </tr>`
                    : ""
                }
              </table>
            </div>

            <!-- Call to Action -->
            <div style="text-align: center; margin: 28px 0 16px 0;">
              <a href="${escapeHtml(dashboardUrl)}" style="display: inline-block; background-color: #18181b; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 14px; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);">
                Open MediaHub Dashboard
              </a>
            </div>

            <p style="margin: 0; font-size: 13px; text-align: center; color: #71717a;">
              Need an extension or have questions? Contact your Section In-Charge or an Admin.
            </p>
          </div>

          <!-- Footer -->
          <div style="background-color: #f4f4f5; padding: 14px 24px; border-top: 1px solid #e4e4e7; text-align: center; font-size: 12px; color: #71717a;">
            Sent automatically by <strong>MediaHub</strong> • Equipment Operations
          </div>
        </div>
      </body>
      </html>
    `;

    const transporter = getTransporter();
    const fromAddress = process.env.SMTP_FROM || '"MediaHub Reminders" <noreply@mediahub.app>';

    if (transporter) {
      await transporter.sendMail({
        from: fromAddress,
        to: cleanToEmail,
        subject: `${subjectPrefix} ${cleanEquipmentName} — MediaHub`,
        html: htmlContent,
      });
      console.log(`✓ Sent ${badgeText} reminder to ${cleanToEmail} for "${cleanEquipmentName}"`);
      return { success: true };
    } else {
      console.warn(`[MAIL] ${SMTP_NOT_CONFIGURED}; ${badgeText} reminder for "${cleanEquipmentName}" was not sent.`);
      return { success: false, skipped: true, reason: SMTP_NOT_CONFIGURED, error: SMTP_NOT_CONFIGURED };
    }
  } catch (err: unknown) {
    console.error("Error dispatching return reminder email:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to send reminder email",
    };
  }
}

