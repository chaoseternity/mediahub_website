import { auth } from "@/lib/auth";
import { sendClubWebhook } from "@/lib/webhook";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, toErrorResponse, validationErrorResponse } from "@/lib/api-errors";

const WebhookTestSchema = z.object({
  message: z
    .string({ error: "message must be a string" })
    .max(1000, "message cannot exceed 1000 characters")
    .nullable()
    .optional(),
});

const KNOWN_PROVIDERS = new Set(["discord", "slack", "telegram"]);

/**
 * Summarises provider errors without echoing their response bodies (which can contain
 * provider internals or, for some providers, request details), e.g. "discord: HTTP 404".
 */
function summarizeWebhookError(error: string | undefined): string | undefined {
  if (!error) return undefined;
  const parts = error
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const sep = part.indexOf(":");
      const rawName = sep > 0 ? part.slice(0, sep).trim().toLowerCase() : "";
      const name = KNOWN_PROVIDERS.has(rawName) ? rawName : "webhook";
      const detail = sep > 0 ? part.slice(sep + 1).trim() : part;
      const http = /^HTTP (\d{3})\b/.exec(detail);
      if (http) return `${name}: HTTP ${http[1]}`;
      if (/timed out/i.test(detail)) return `${name}: request timed out`;
      return `${name}: delivery failed`;
    });
  return parts.length > 0 ? parts.join("; ") : "delivery failed";
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden: Admin role required to test club webhooks." }, { status: 403 });
  }

  const body = await readJsonBody(req, { allowEmpty: true });
  if (!body.ok) return body.response;
  const parsed = WebhookTestSchema.safeParse(body.data);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }

  const customMessage = parsed.data.message?.trim() || "Test notification from MediaHub Inventory System.";

  try {
    const result = await sendClubWebhook({
      event: "webhook.test",
      title: "🔔 MediaHub Webhook Test",
      description: customMessage,
      fields: [
        { name: "Initiated By", value: session.user.name || session.user.email || "Admin" },
        { name: "Environment", value: process.env.NODE_ENV || "development" },
        { name: "Status", value: "Operational" },
      ],
    });

    const channels = result.dispatched.filter((c) => c !== "console_dev");
    const errorSummary = summarizeWebhookError(result.error);
    const message = result.success
      ? channels.length > 0
        ? `Delivered to ${channels.join(", ")}${errorSummary ? ` (failed: ${errorSummary})` : ""}.`
        : "No webhook targets are configured; the test notification was logged to the server console."
      : `Delivery failed${errorSummary ? `: ${errorSummary}` : ""}.`;

    if (!result.success) {
      // Every configured provider failed: report a summary (never the provider's response body).
      return NextResponse.json(
        { success: false, dispatched: result.dispatched, channels, message, error: message },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      dispatched: result.dispatched,
      channels,
      message,
      ...(errorSummary ? { failures: errorSummary } : {}),
    });
  } catch (err: unknown) {
    return toErrorResponse(err, "Failed to send test webhook");
  }
}
