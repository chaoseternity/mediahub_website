import type { WebhookMessage, WebhookEventType } from "./types";

interface WebhookDispatchResult {
  success: boolean;
  dispatched: string[];
  error?: string;
}

const EVENT_COLORS: Record<WebhookEventType, number> = {
  "handover.completed": 0x10b981, // Emerald Green
  "reservation.created": 0x3b82f6, // Blue
  "reservation.cancelled": 0xef4444, // Red
  "audit.completed": 0x8b5cf6, // Violet
  "reminder.overdue": 0xd97706, // Amber
  "checkout.created": 0x06b6d4, // Cyan
  "return.completed": 0x10b981, // Green
  "webhook.test": 0x6366f1, // Indigo
};

/**
 * Dispatches rich notification embeds to Discord, Slack, and/or Telegram webhooks.
 * Fails safely without throwing errors to prevent disrupting caller transactions.
 */
export async function sendClubWebhook(message: WebhookMessage): Promise<WebhookDispatchResult> {
  const discordUrl = process.env.DISCORD_WEBHOOK_URL;
  const slackUrl = process.env.SLACK_WEBHOOK_URL;
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.TELEGRAM_CHAT_ID;

  const dispatched: string[] = [];
  const errors: string[] = [];

  const color = message.color ?? EVENT_COLORS[message.event] ?? 0x18181b;
  const timestamp = message.timestamp ?? new Date().toISOString();

  // 1. Discord Webhook
  if (discordUrl) {
    try {
      const discordPayload = {
        username: "MediaHub Inventory",
        avatar_url: "https://raw.githubusercontent.com/chaoseternity/mediahub_website/main/public/favicon.ico",
        embeds: [
          {
            title: message.title,
            description: message.description,
            color,
            timestamp,
            fields: message.fields?.map((f) => ({
              name: f.name,
              value: f.value,
              inline: f.inline ?? true,
            })),
            footer: {
              text: `MediaHub • ${message.event}`,
            },
          },
        ],
      };

      const res = await fetch(discordUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(discordPayload),
      });

      if (res.ok) {
        dispatched.push("discord");
      } else {
        const text = await res.text();
        errors.push(`Discord: HTTP ${res.status} - ${text}`);
      }
    } catch (err) {
      errors.push(`Discord error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2. Slack Webhook
  if (slackUrl) {
    try {
      const colorHex = `#${color.toString(16).padStart(6, "0")}`;
      const slackPayload = {
        text: `*${message.title}*\n${message.description}`,
        attachments: [
          {
            color: colorHex,
            title: message.title,
            text: message.description,
            fields: message.fields?.map((f) => ({
              title: f.name,
              value: f.value,
              short: f.inline ?? true,
            })),
            ts: Math.floor(new Date(timestamp).getTime() / 1000),
          },
        ],
      };

      const res = await fetch(slackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(slackPayload),
      });

      if (res.ok) {
        dispatched.push("slack");
      } else {
        errors.push(`Slack: HTTP ${res.status}`);
      }
    } catch (err) {
      errors.push(`Slack error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3. Telegram Bot
  if (telegramBotToken && telegramChatId) {
    try {
      const fieldsText = message.fields?.map((f) => `• <b>${f.name}</b>: ${f.value}`).join("\n") ?? "";
      const text = `<b>${message.title}</b>\n${message.description}\n\n${fieldsText}`.trim();

      const telegramUrl = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
      const res = await fetch(telegramUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: telegramChatId,
          text,
          parse_mode: "HTML",
        }),
      });

      if (res.ok) {
        dispatched.push("telegram");
      } else {
        errors.push(`Telegram: HTTP ${res.status}`);
      }
    } catch (err) {
      errors.push(`Telegram error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (dispatched.length === 0 && !discordUrl && !slackUrl && (!telegramBotToken || !telegramChatId)) {
    // Log simulated webhook in dev mode
    console.log(`[WEBHOOK SIMULATED] (${message.event}): ${message.title} - ${message.description}`);
    return {
      success: true,
      dispatched: ["console_dev"],
    };
  }

  return {
    success: dispatched.length > 0 || errors.length === 0,
    dispatched,
    error: errors.length > 0 ? errors.join("; ") : undefined,
  };
}
