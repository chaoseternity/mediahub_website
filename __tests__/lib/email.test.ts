const sendMailMock = jest.fn();

jest.mock("nodemailer", () => ({
  __esModule: true,
  default: { createTransport: jest.fn(() => ({ sendMail: sendMailMock })) },
}));

import {
  formatEmailTimeRange,
  resolveEmailBaseUrl,
  sendDeploymentInvitationEmail,
  sendOverdueReminderEmail,
} from "@/lib/email";

const ENV_KEYS = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_PORT", "AUTH_URL", "NEXTAUTH_URL", "VERCEL_URL"] as const;

const TOKEN = "super-secret-rsvp-token-0123456789";

const baseInvite = {
  toEmail: "crew@club.test",
  recipientName: "Crew Member",
  eventName: "Open House",
  section: "photo" as const,
  startTime: "2026-10-01T10:00:00Z", // 18:00 SGT
  endTime: "2026-10-01T14:00:00Z", // 22:00 SGT
  location: "Hall A",
  token: TOKEN,
};

describe("lib/email", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    sendMailMock.mockReset().mockResolvedValue({});
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    jest.restoreAllMocks();
  });

  function configureSmtp() {
    process.env.SMTP_HOST = "smtp.test";
    process.env.SMTP_USER = "user";
    process.env.SMTP_PASS = "pass";
  }

  test("formats event times in the app time zone (SGT), not the Worker's UTC", async () => {
    configureSmtp();
    process.env.AUTH_URL = "https://mediahub.example.org";
    jest.spyOn(console, "log").mockImplementation(() => {});

    const result = await sendDeploymentInvitationEmail({
      ...baseInvite,
      hasRehearsal: true,
      rehearsalStartTime: "2026-09-30 11:30:00", // SQLite UTC -> 19:30 SGT
      rehearsalEndTime: "2026-09-30 13:00:00", // -> 21:00 SGT
    });

    expect(result.success).toBe(true);
    const html: string = sendMailMock.mock.calls[0][0].html;
    expect(html).toContain("Thu, 1 Oct 2026, 18:00 – 22:00");
    expect(html).toContain("Wed, 30 Sept 2026, 19:30 – 21:00");
    expect(html).not.toContain("10:00");
    expect(html).toContain(`https://mediahub.example.org/rsvp/${TOKEN}?action=confirm`);
  });

  test("formatEmailTimeRange repeats the end date only when it differs", () => {
    expect(formatEmailTimeRange("2026-10-01T10:00:00Z", "2026-10-01T14:00:00Z")).toBe("Thu, 1 Oct 2026, 18:00 – 22:00");
    expect(formatEmailTimeRange("2026-10-01T10:00:00Z", "2026-10-02T02:00:00Z")).toBe(
      "Thu, 1 Oct 2026, 18:00 – Fri, 2 Oct 2026, 10:00"
    );
  });

  test("reminder dates are formatted in SGT", async () => {
    configureSmtp();
    jest.spyOn(console, "log").mockImplementation(() => {});

    await sendOverdueReminderEmail({
      toEmail: "b@club.test",
      recipientName: "Borrower",
      equipmentId: 1,
      equipmentName: "Sony FX3",
      location: "Media Room",
      checkedOutAt: "2026-09-28 01:00:00", // 09:00 SGT
      expectedReturnAt: "2026-09-29T15:30:00.000Z", // 23:30 SGT
      isOverdue: true,
    });

    const html: string = sendMailMock.mock.calls[0][0].html;
    expect(html).toContain("Mon, 28 Sept 2026, 09:00");
    expect(html).toContain("Tue, 29 Sept 2026, 23:30");
  });

  describe("resolveEmailBaseUrl", () => {
    test("prefers AUTH_URL, then NEXTAUTH_URL, then the request origin", () => {
      process.env.AUTH_URL = "https://auth.example.org/some/path";
      process.env.NEXTAUTH_URL = "https://nextauth.example.org";
      expect(resolveEmailBaseUrl("https://origin.example.org")).toBe("https://auth.example.org");

      delete process.env.AUTH_URL;
      expect(resolveEmailBaseUrl("https://origin.example.org")).toBe("https://nextauth.example.org");

      delete process.env.NEXTAUTH_URL;
      expect(resolveEmailBaseUrl("https://origin.example.org")).toBe("https://origin.example.org");
    });

    test("skips a localhost candidate when a public origin is available", () => {
      process.env.AUTH_URL = "http://localhost:8787";
      expect(resolveEmailBaseUrl("https://mediahub.example.org")).toBe("https://mediahub.example.org");
      expect(resolveEmailBaseUrl("http://localhost:8787")).toBe("http://localhost:8787");
      expect(resolveEmailBaseUrl("javascript:alert(1)")).toBe("http://localhost:8787");
    });
  });

  test("SMTP not configured: skipped result, and no RSVP token or link is logged", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => {})
    );

    const result = await sendDeploymentInvitationEmail({ ...baseInvite, origin: "https://mediahub.example.org" });

    expect(result).toMatchObject({ success: false, skipped: true, reason: "SMTP not configured" });
    expect(result.previewUrl).toBeUndefined();
    expect(sendMailMock).not.toHaveBeenCalled();

    const logged = spies.flatMap((s) => s.mock.calls.flat()).map(String).join("\n");
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain("/rsvp/");
  });

  test("reminder with SMTP not configured is skipped (not reported as sent)", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    const result = await sendOverdueReminderEmail({
      toEmail: "b@club.test",
      recipientName: "Borrower",
      equipmentId: 1,
      equipmentName: "Sony FX3",
      location: "Media Room",
      checkedOutAt: "2026-09-28 01:00:00",
      expectedReturnAt: "2026-09-29",
      isOverdue: false,
    });
    expect(result).toMatchObject({ success: false, skipped: true });
  });

  test("still escapes HTML and strips header-injection newlines", async () => {
    configureSmtp();
    jest.spyOn(console, "log").mockImplementation(() => {});

    await sendDeploymentInvitationEmail({
      ...baseInvite,
      toEmail: "crew@club.test\r\nBcc: victim@evil.test",
      eventName: "Gala\r\nBcc: x@evil.test <script>",
      recipientName: "<img src=x onerror=alert(1)>",
    });

    const mail = sendMailMock.mock.calls[0][0];
    expect(mail.to).not.toMatch(/[\r\n]/);
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.html).not.toContain("<img src=x");
    expect(mail.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});
