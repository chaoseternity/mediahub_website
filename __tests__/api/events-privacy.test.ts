import { makeTestDb, setTestDb } from "@/lib/test-db";

jest.mock("@/lib/auth", () => ({
  auth: jest.fn().mockResolvedValue(null),
}));

import { upsertUser, createEvent, addDeploymentToEventSection } from "@/lib/db";
import { GET as listEventsRoute } from "@/app/api/events/route";
import { GET as getEventRoute } from "@/app/api/events/[id]/route";
import { GET as rsvpGet, POST as rsvpPost } from "@/app/api/rsvp/route";
import { auth } from "@/lib/auth";
import { NextRequest } from "next/server";

const HOUR = 3600 * 1000;

describe("Event data privacy & RSVP tokens", () => {
  beforeEach(() => {
    setTestDb(makeTestDb());
  });

  afterEach(() => {
    setTestDb(null);
  });

  async function seed(startOffsetMs: number, endOffsetMs: number) {
    const admin = await upsertUser({
      name: "Admin Ada",
      email: "ada@school.edu",
      google_id: "google_ada",
      image: null,
      provider: "google",
      role: "admin",
    });
    const member = await upsertUser({
      name: "Member Max",
      email: "max@school.edu",
      google_id: "google_max",
      image: null,
      provider: "google",
      role: "verified",
    });
    const event = await createEvent({
      name: "Open Day",
      start_time: new Date(Date.now() + startOffsetMs).toISOString(),
      end_time: new Date(Date.now() + endOffsetMs).toISOString(),
      location: "Hall",
      created_by: admin.id,
      oic_user_ids: [admin.id],
      photo_ic_ids: [member.id],
    });
    const { token } = await addDeploymentToEventSection(event.id, member.id, "photo", false, admin.id);
    (auth as jest.Mock).mockResolvedValue({
      user: { id: String(member.id), email: member.email, name: member.name, role: "viewer" },
    });
    return { admin, member, event, token };
  }

  function expectNoSecrets(payload: unknown, token: string) {
    const text = JSON.stringify(payload);
    expect(text).not.toContain(token);
    expect(text).not.toContain("response_token");
    expect(text).not.toContain("@school.edu");
    expect(text).not.toContain("google_id");
    expect(text).not.toContain('"email"');
  }

  test("GET /api/events and /api/events/[id] expose no RSVP token, email or google_id", async () => {
    const { event, token, member } = await seed(24 * HOUR, 26 * HOUR);

    const listRes = await listEventsRoute();
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list[0].section_deployments.photo[0].id).toBe(member.id);
    expectNoSecrets(list, token);

    const oneRes = await getEventRoute(new NextRequest(`http://localhost/api/events/${event.id}`), {
      params: Promise.resolve({ id: String(event.id) }),
    });
    expect(oneRes.status).toBe(200);
    expectNoSecrets(await oneRes.json(), token);
  });

  test("GET /api/rsvp does not return the member's email", async () => {
    const { token } = await seed(24 * HOUR, 26 * HOUR);
    const res = await rsvpGet(new NextRequest(`http://localhost/api/rsvp?token=${token}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userName).toBe("Member Max");
    expect(body.userEmail).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("@school.edu");
    expect(body.eventEnded).toBe(false);
  });

  test("RSVP works before the event ends and is rejected afterwards", async () => {
    const upcoming = await seed(24 * HOUR, 26 * HOUR);
    const ok = await rsvpPost(
      new NextRequest("http://localhost/api/rsvp", {
        method: "POST",
        body: JSON.stringify({ token: upcoming.token, status: "confirmed" }),
      })
    );
    expect(ok.status).toBe(200);

    setTestDb(makeTestDb());
    const ended = await seed(-26 * HOUR, -24 * HOUR);
    const info = await (await rsvpGet(new NextRequest(`http://localhost/api/rsvp?token=${ended.token}`))).json();
    expect(info.eventEnded).toBe(true);

    const closed = await rsvpPost(
      new NextRequest("http://localhost/api/rsvp", {
        method: "POST",
        body: JSON.stringify({ token: ended.token, status: "confirmed" }),
      })
    );
    expect(closed.status).toBe(410);
    const after = await (await rsvpGet(new NextRequest(`http://localhost/api/rsvp?token=${ended.token}`))).json();
    expect(after.responseStatus).toBe("pending");
  });
});
