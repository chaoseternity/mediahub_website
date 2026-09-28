import { auth } from "@/lib/auth";
import { sendClubWebhook } from "@/lib/webhook";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden: Admin role required to test club webhooks." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const customMessage = body.message?.trim() || "Test notification from MediaHub Inventory System.";

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

  return NextResponse.json(result);
}
