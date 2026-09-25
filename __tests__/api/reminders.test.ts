import { makeTestDb, setTestDb } from "@/lib/test-db";

jest.mock("@/lib/auth", () => ({
  auth: jest.fn().mockResolvedValue(null),
}));

import {
  processReturnReminders,
  getPendingReturnReminders,
  recordCheckoutReminder,
  getCheckoutReminders,
  createEquipment,
  createCheckout,
  upsertUser,
} from "@/lib/db";
import * as emailModule from "@/lib/email";
import { NextRequest } from "next/server";
import { GET as remindersGetHandler } from "@/app/api/cron/reminders/route";
import { auth } from "@/lib/auth";

describe("Automated Return Reminders", () => {
  let db: any;
  let sendEmailSpy: jest.SpyInstance;

  beforeEach(async () => {
    db = makeTestDb();
    setTestDb(db);
    sendEmailSpy = jest
      .spyOn(emailModule, "sendOverdueReminderEmail")
      .mockResolvedValue({ success: true });
    process.env.CRON_SECRET = "test-cron-secret-12345";
  });

  afterEach(() => {
    sendEmailSpy.mockRestore();
    setTestDb(null);
  });

  test("correctly identifies overdue checkouts and dispatches overdue reminders", async () => {
    const user = await upsertUser({
      name: "Alice Volunteer",
      email: "alice@school.edu",
      google_id: "google_alice",
      image: null,
      provider: "google",
    });

    const eq = await createEquipment({
      name: "Sony FX3 Camera",
      tags: [],
      status: "Available",
      condition: "Working",
      location: "Media Cabinet A",
    });

    // Overdue checkout (expected return yesterday)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await createCheckout({
      equipment_id: eq.id,
      checked_out_by: user.id,
      checked_out_by_name: user.name,
      expected_return_at: yesterday,
      notes: "Filming sports match",
    });

    const result = await processReturnReminders();

    expect(result.totalChecked).toBe(1);
    expect(result.sent).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.reminders[0].type).toBe("overdue");
    expect(result.reminders[0].status).toBe("sent");
    expect(result.reminders[0].recipientEmail).toBe("alice@school.edu");

    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(sendEmailSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        toEmail: "alice@school.edu",
        recipientName: "Alice Volunteer",
        equipmentName: "Sony FX3 Camera",
        isOverdue: true,
      })
    );

    // Verify reminder was logged in checkout_reminders
    const logged = await getCheckoutReminders(result.reminders[0].checkoutId);
    expect(logged.length).toBe(1);
    expect(logged[0].reminder_type).toBe("overdue");
    expect(logged[0].sent_to_email).toBe("alice@school.edu");
  });

  test("correctly identifies due-soon checkouts (within 24h) and dispatches due-soon reminders", async () => {
    const user = await upsertUser({
      name: "Bob Photographer",
      email: "bob@school.edu",
      google_id: "google_bob",
      image: null,
      provider: "google",
    });

    const eq = await createEquipment({
      name: "24-70mm GM Lens",
      tags: [],
      status: "Available",
      condition: "Working",
      location: "Lens Locker",
    });

    // Due in 12 hours
    const in12Hours = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    await createCheckout({
      equipment_id: eq.id,
      checked_out_by: user.id,
      checked_out_by_name: user.name,
      expected_return_at: in12Hours,
    });

    const result = await processReturnReminders();

    expect(result.sent).toBe(1);
    expect(result.reminders[0].type).toBe("due_soon");
    expect(sendEmailSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        toEmail: "bob@school.edu",
        isOverdue: false,
      })
    );
  });

  test("skips checkouts that are due more than 24 hours into the future", async () => {
    const user = await upsertUser({
      name: "Charlie AV",
      email: "charlie@school.edu",
      google_id: "google_charlie",
      image: null,
      provider: "google",
    });

    const eq = await createEquipment({
      name: "Wireless Mic Transmitter",
      tags: [],
      status: "Available",
      condition: "Working",
      location: "Audio Rack",
    });

    // Due in 3 days
    const in3Days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    await createCheckout({
      equipment_id: eq.id,
      checked_out_by: user.id,
      checked_out_by_name: user.name,
      expected_return_at: in3Days,
    });

    const result = await processReturnReminders();

    expect(result.totalChecked).toBe(1);
    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
    expect(sendEmailSpy).not.toHaveBeenCalled();
  });

  test("deduplicates reminders: does not spam due_soon if already sent, nor overdue within 24h", async () => {
    const user = await upsertUser({
      name: "Diana Tech",
      email: "diana@school.edu",
      google_id: "google_diana",
      image: null,
      provider: "google",
    });

    const eq = await createEquipment({
      name: "Tripod Carbon",
      tags: [],
      status: "Available",
      condition: "Working",
      location: "Tripod Corner",
    });

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const ch = await createCheckout({
      equipment_id: eq.id,
      checked_out_by: user.id,
      checked_out_by_name: user.name,
      expected_return_at: yesterday,
    });

    // First run sends overdue reminder
    const firstRun = await processReturnReminders();
    expect(firstRun.sent).toBe(1);

    // Second run immediately after should skip (already reminded in last 24h)
    const secondRun = await processReturnReminders();
    expect(secondRun.sent).toBe(0);
    expect(secondRun.skipped).toBe(1);
    expect(secondRun.reminders[0].reason).toContain("already sent in last 24 hours");

    // With force=true (admin manual override), it allows resending
    const forcedRun = await processReturnReminders({ force: true });
    expect(forcedRun.sent).toBe(1);
  });

  test("gracefully skips items when no borrower email address is found", async () => {
    const eq = await createEquipment({
      name: "HDMI Cable 10m",
      tags: [],
      status: "Available",
      condition: "Working",
      location: "Cables Box",
    });

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    // Checked out to unknown external guest without user account
    await createCheckout({
      equipment_id: eq.id,
      checked_out_by: null,
      checked_out_by_name: "External Guest Speaker",
      expected_return_at: yesterday,
    });

    const result = await processReturnReminders();
    expect(result.totalChecked).toBe(1);
    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.reminders[0].reason).toContain("No email address found");
    expect(sendEmailSpy).not.toHaveBeenCalled();
  });

  test("API route rejects requests without valid cron secret or admin session", async () => {
    const req = new NextRequest("http://localhost:3000/api/cron/reminders");
    const res = await remindersGetHandler(req);
    expect(res.status).toBe(401);
  });

  test("API route executes successfully with Bearer CRON_SECRET", async () => {
    const req = new NextRequest("http://localhost:3000/api/cron/reminders", {
      headers: {
        authorization: "Bearer test-cron-secret-12345",
      },
    });
    const res = await remindersGetHandler(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data).toHaveProperty("totalChecked");
    expect(data).toHaveProperty("sent");
  });

  test("API route executes successfully with x-cron-secret header", async () => {
    const req = new NextRequest("http://localhost:3000/api/cron/reminders", {
      headers: {
        "x-cron-secret": "test-cron-secret-12345",
      },
    });
    const res = await remindersGetHandler(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });
});
