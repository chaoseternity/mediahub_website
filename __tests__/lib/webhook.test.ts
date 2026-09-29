import {
  buildDiscordPayload,
  buildSlackPayload,
  buildTelegramText,
  escapeSlackText,
  escapeTelegramHtml,
  sendClubWebhook,
} from "@/lib/webhook";
import type { WebhookMessage } from "@/lib/types";

const ENV_KEYS = ["DISCORD_WEBHOOK_URL", "SLACK_WEBHOOK_URL", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"] as const;

describe("lib/webhook", () => {
  const originalFetch = global.fetch;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    jest.restoreAllMocks();
  });

  describe("Telegram HTML escaping", () => {
    test("escapes &, <, > and \" in all interpolated values", () => {
      expect(escapeTelegramHtml('Mic & Stand <b>"x"</b>')).toBe("Mic &amp; Stand &lt;b&gt;&quot;x&quot;&lt;/b&gt;");

      const text = buildTelegramText({
        event: "checkout.created",
        title: "Checkout: Mic & Stand",
        description: 'Notes: <a href="https://evil.example">click</a>',
        fields: [{ name: "Borrower <admin>", value: "Tom & Jerry" }],
      });

      expect(text).toContain("<b>Checkout: Mic &amp; Stand</b>");
      expect(text).toContain("&lt;a href=&quot;https://evil.example&quot;&gt;click&lt;/a&gt;");
      expect(text).toContain("• <b>Borrower &lt;admin&gt;</b>: Tom &amp; Jerry");
      expect(text).not.toContain("<a ");
    });
  });

  describe("Discord truncation", () => {
    test("truncates title/description/field values and coerces non-strings", () => {
      const message = {
        event: "webhook.test",
        title: "T".repeat(400),
        description: "D".repeat(5000),
        fields: [
          { name: "Long", value: "V".repeat(2000) },
          { name: "Number", value: 42 as unknown as string },
          { name: "Empty", value: "" },
        ],
      } as WebhookMessage;

      const payload = buildDiscordPayload(message, 0x123456, "2026-09-29T00:00:00.000Z");
      const embed = payload.embeds[0];

      expect(embed.title.length).toBeLessThanOrEqual(256);
      expect(embed.description.length).toBeLessThanOrEqual(4096);
      expect(embed.fields![0].value.length).toBeLessThanOrEqual(1024);
      expect(embed.fields![1].value).toBe("42");
      expect(embed.fields![2].value.length).toBeGreaterThan(0); // Discord rejects empty values

      const total =
        embed.title.length +
        embed.description.length +
        embed.footer.text.length +
        embed.fields!.reduce((n, f) => n + f.name.length + f.value.length, 0);
      expect(total).toBeLessThanOrEqual(6000);
      expect(payload.allowed_mentions).toEqual({ parse: [] });
    });
  });

  describe("Slack escaping", () => {
    test("escapes mrkdwn control characters so no pings or links can be injected", () => {
      expect(escapeSlackText("<!channel> & <https://evil.example|click>")).toBe(
        "&lt;!channel&gt; &amp; &lt;https://evil.example|click&gt;"
      );

      const payload = buildSlackPayload(
        {
          event: "reservation.created",
          title: "<!here> Reservation",
          description: "Notes: <@U123> <https://evil.example|free stuff>",
          fields: [{ name: "User", value: "<!everyone>" }],
        },
        0x3b82f6,
        "2026-09-29T00:00:00.000Z"
      );

      const serialized = JSON.stringify(payload);
      expect(serialized).not.toMatch(/<!(channel|here|everyone)>/);
      expect(serialized).not.toContain("<@U123>");
      expect(serialized).not.toContain("<https://");
      expect(payload.attachments[0].fields![0].value).toBe("&lt;!everyone&gt;");
    });

    test("truncates very long text", () => {
      const payload = buildSlackPayload(
        { event: "webhook.test", title: "x", description: "y".repeat(10_000) },
        0,
        "2026-09-29T00:00:00.000Z"
      );
      expect(payload.attachments[0].text.length).toBeLessThanOrEqual(3000);
    });
  });

  describe("sendClubWebhook dispatch", () => {
    const message: WebhookMessage = { event: "webhook.test", title: "Hello & welcome", description: "Test" };

    test("a hanging provider times out without throwing, and others still deliver (in parallel)", async () => {
      process.env.DISCORD_WEBHOOK_URL = "https://discord.example/hook";
      process.env.SLACK_WEBHOOK_URL = "https://slack.example/hook";
      process.env.TELEGRAM_BOT_TOKEN = "123:abc";
      process.env.TELEGRAM_CHAT_ID = "42";

      const fetchMock = jest.fn((url: string, init: RequestInit) => {
        if (url.includes("discord")) {
          // Never resolves unless aborted.
          return new Promise<Response>((_, reject) => {
            init.signal?.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "TimeoutError";
              reject(err);
            });
          });
        }
        return Promise.resolve(new Response("ok", { status: 200 }));
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const started = Date.now();
      const result = await sendClubWebhook(message, { timeoutMs: 50 });

      expect(Date.now() - started).toBeLessThan(2000);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(result.dispatched.sort()).toEqual(["slack", "telegram"]);
      expect(result.success).toBe(true);
      expect(result.error).toContain("discord");
      expect(result.error).toContain("timed out");

      const telegramCall = fetchMock.mock.calls.find(([url]) => url.includes("telegram"))!;
      const body = JSON.parse(String(telegramCall[1].body));
      expect(body.text).toContain("Hello &amp; welcome");
      expect(body.parse_mode).toBe("HTML");
    });

    test("never throws when fetch rejects and does not leak the Telegram token", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "999:SECRET";
      process.env.TELEGRAM_CHAT_ID = "42";
      global.fetch = jest.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

      const result = await sendClubWebhook(message);
      expect(result.success).toBe(false);
      expect(result.dispatched).toEqual([]);
      expect(result.error).toContain("network down");
      expect(result.error).not.toContain("SECRET");
    });

    test("reports HTTP failures", async () => {
      process.env.SLACK_WEBHOOK_URL = "https://slack.example/hook";
      global.fetch = jest.fn().mockResolvedValue(new Response("bad", { status: 400 })) as unknown as typeof fetch;

      const result = await sendClubWebhook(message);
      expect(result.success).toBe(false);
      expect(result.error).toContain("slack: HTTP 400");
    });

    test("simulates in dev when no provider is configured", async () => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      const result = await sendClubWebhook(message);
      expect(result).toEqual({ success: true, dispatched: ["console_dev"] });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
