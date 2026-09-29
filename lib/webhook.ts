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

/** Per-provider request timeout. Webhooks are best-effort and must never stall user requests. */
export const WEBHOOK_TIMEOUT_MS = 5000;

// Provider limits (Discord embed limits; Slack/Telegram practical limits).
const DISCORD_TITLE_MAX = 256;
const DISCORD_DESCRIPTION_MAX = 4096;
const DISCORD_FIELD_NAME_MAX = 256;
const DISCORD_FIELD_VALUE_MAX = 1024;
const DISCORD_MAX_FIELDS = 25;
const DISCORD_FOOTER_MAX = 2048;
const DISCORD_EMBED_TOTAL_MAX = 6000;
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const SLACK_TEXT_MAX = 3000;
const SLACK_FIELD_MAX = 2000;
const TELEGRAM_TEXT_MAX = 4096;

type WebhookField = NonNullable<WebhookMessage["fields"]>[number];

function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}

/** Truncates to at most `max` characters (appending an ellipsis when cut). */
export function truncateText(value: unknown, max: number): string {
  const str = toText(value);
  if (str.length <= max) return str;
  if (max <= 1) return str.slice(0, max);
  return `${str.slice(0, max - 1)}…`;
}

/** Escapes a value for Telegram's parse_mode "HTML" (only &, <, > and " are special). */
export function escapeTelegramHtml(value: unknown): string {
  return toText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Escapes Slack mrkdwn control characters so user-supplied text cannot produce
 * <!channel>/<!here> pings, <@user> mentions or <url|link> links.
 */
export function escapeSlackText(value: unknown): string {
  return toText(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildDiscordPayload(message: WebhookMessage, color: number, timestamp: string) {
  const fields = (message.fields ?? []).slice(0, DISCORD_MAX_FIELDS).map((f: WebhookField) => ({
    // Discord rejects empty field names/values.
    name: truncateText(toText(f.name) || ZERO_WIDTH_SPACE, DISCORD_FIELD_NAME_MAX),
    value: truncateText(toText(f.value) || ZERO_WIDTH_SPACE, DISCORD_FIELD_VALUE_MAX),
    inline: f.inline ?? true,
  }));

  const title = truncateText(message.title, DISCORD_TITLE_MAX);
  const footer = truncateText(`MediaHub • ${message.event}`, DISCORD_FOOTER_MAX);
  // Discord also caps the combined embed text at 6000 characters: drop trailing fields first,
  // then shorten the description.
  const fieldsLength = () => fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
  while (fields.length > 0 && title.length + footer.length + fieldsLength() > DISCORD_EMBED_TOTAL_MAX - 500) {
    fields.pop();
  }
  const descriptionBudget = Math.min(
    DISCORD_DESCRIPTION_MAX,
    Math.max(1, DISCORD_EMBED_TOTAL_MAX - title.length - footer.length - fieldsLength())
  );

  return {
    username: "MediaHub Inventory",
    avatar_url: "https://raw.githubusercontent.com/chaoseternity/mediahub_website/main/public/favicon.ico",
    allowed_mentions: { parse: [] as string[] },
    embeds: [
      {
        title,
        description: truncateText(message.description, descriptionBudget),
        color,
        timestamp,
        fields: fields.length > 0 ? fields : undefined,
        footer: { text: footer },
      },
    ],
  };
}

export function buildSlackPayload(message: WebhookMessage, color: number, timestamp: string) {
  const colorHex = `#${color.toString(16).padStart(6, "0")}`;
  const title = escapeSlackText(truncateText(message.title, 250));
  const description = escapeSlackText(truncateText(message.description, SLACK_TEXT_MAX));
  const tsSeconds = Math.floor(new Date(timestamp).getTime() / 1000);

  return {
    text: `*${title}*\n${description}`,
    attachments: [
      {
        color: colorHex,
        title,
        text: description,
        fields: message.fields?.map((f: WebhookField) => ({
          title: escapeSlackText(truncateText(f.name, 250)),
          value: escapeSlackText(truncateText(f.value, SLACK_FIELD_MAX)),
          short: f.inline ?? true,
        })),
        ts: Number.isFinite(tsSeconds) ? tsSeconds : Math.floor(Date.now() / 1000),
      },
    ],
  };
}

export function buildTelegramText(message: WebhookMessage): string {
  // Truncate the raw values before escaping so entities are never cut in half.
  const fieldsText =
    message.fields
      ?.map((f: WebhookField) => `• <b>${escapeTelegramHtml(truncateText(f.name, 256))}</b>: ${escapeTelegramHtml(truncateText(f.value, 1024))}`)
      .join("\n") ?? "";
  const title = escapeTelegramHtml(truncateText(message.title, 256));
  const description = escapeTelegramHtml(truncateText(message.description, 2048));
  const text = `<b>${title}</b>\n${description}\n\n${fieldsText}`.trim();
  if (text.length <= TELEGRAM_TEXT_MAX) return text;
  // Fall back to title + description only rather than cutting through HTML tags/entities.
  return `<b>${title}</b>\n${description}`.slice(0, TELEGRAM_TEXT_MAX).replace(/&[^;\s]*$/, "");
}

function timeoutSignal(ms: number): { signal: AbortSignal; cancel: () => void } {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return { signal: AbortSignal.timeout(ms), cancel: () => {} };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${ms}ms`)), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

async function postJson(url: string, body: unknown, timeoutMs: number): Promise<Response> {
  const { signal, cancel } = timeoutSignal(timeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } finally {
    cancel();
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") return "request timed out";
    return err.message;
  }
  return String(err);
}

interface ProviderJob {
  name: string;
  run: () => Promise<Response>;
  /** Include the response body in errors (never for Telegram: its URL embeds the bot token). */
  includeBody?: boolean;
}

/**
 * Dispatches rich notification embeds to Discord, Slack, and/or Telegram webhooks.
 * Providers are called in parallel with a per-request timeout. Never throws: failures are
 * logged and reported in the result so caller transactions are not disrupted.
 */
export async function sendClubWebhook(
  message: WebhookMessage,
  options: { timeoutMs?: number } = {}
): Promise<WebhookDispatchResult> {
  try {
    const timeoutMs = options.timeoutMs ?? WEBHOOK_TIMEOUT_MS;
    const discordUrl = process.env.DISCORD_WEBHOOK_URL;
    const slackUrl = process.env.SLACK_WEBHOOK_URL;
    const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;

    const color = message.color ?? EVENT_COLORS[message.event] ?? 0x18181b;
    const timestamp = message.timestamp ?? new Date().toISOString();

    const jobs: ProviderJob[] = [];

    if (discordUrl) {
      jobs.push({
        name: "discord",
        includeBody: true,
        run: () => postJson(discordUrl, buildDiscordPayload(message, color, timestamp), timeoutMs),
      });
    }

    if (slackUrl) {
      jobs.push({
        name: "slack",
        run: () => postJson(slackUrl, buildSlackPayload(message, color, timestamp), timeoutMs),
      });
    }

    if (telegramBotToken && telegramChatId) {
      jobs.push({
        name: "telegram",
        run: () =>
          postJson(
            `https://api.telegram.org/bot${telegramBotToken}/sendMessage`,
            {
              chat_id: telegramChatId,
              text: buildTelegramText(message),
              parse_mode: "HTML",
              disable_web_page_preview: true,
            },
            timeoutMs
          ),
      });
    }

    if (jobs.length === 0) {
      // Log simulated webhook in dev mode
      console.log(`[WEBHOOK SIMULATED] (${message.event}): ${message.title} - ${message.description}`);
      return { success: true, dispatched: ["console_dev"] };
    }

    const results = await Promise.allSettled(
      jobs.map(async (job) => {
        const res = await job.run();
        if (!res.ok) {
          let detail = "";
          if (job.includeBody) {
            detail = await res
              .text()
              .then((t) => (t ? ` - ${truncateText(t, 300)}` : ""))
              .catch(() => "");
          }
          throw new Error(`HTTP ${res.status}${detail}`);
        }
        return job.name;
      })
    );

    const dispatched: string[] = [];
    const errors: string[] = [];
    results.forEach((result, i) => {
      if (result.status === "fulfilled") {
        dispatched.push(result.value);
      } else {
        errors.push(`${jobs[i].name}: ${describeError(result.reason)}`);
      }
    });

    if (errors.length > 0) {
      console.warn(`[WEBHOOK] Delivery failed for ${message.event}: ${errors.join("; ")}`);
    }

    return {
      success: dispatched.length > 0,
      dispatched,
      error: errors.length > 0 ? errors.join("; ") : undefined,
    };
  } catch (err) {
    console.warn("[WEBHOOK] Unexpected dispatch error:", describeError(err));
    return { success: false, dispatched: [], error: describeError(err) };
  }
}
