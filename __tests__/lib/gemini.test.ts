import { extractCitations, selectUpcomingEvents } from "@/lib/gemini";
import type { AppEvent } from "@/lib/types";

function ev(id: number, start: string, end: string): AppEvent {
  return {
    id,
    name: `Event ${id}`,
    description: null,
    start_time: start,
    end_time: end,
    location: "Hall",
    created_by: null,
    created_at: "2026-01-01 00:00:00",
    updated_at: "2026-01-01 00:00:00",
    has_rehearsal: false,
    rehearsal_start_time: null,
    rehearsal_end_time: null,
    oics: [],
    section_ics: {} as AppEvent["section_ics"],
    section_equipment: {} as AppEvent["section_equipment"],
    section_deployments: {} as AppEvent["section_deployments"],
    section_rehearsals: {} as AppEvent["section_rehearsals"],
    status: "Upcoming",
  };
}

describe("lib/gemini helpers", () => {
  describe("selectUpcomingEvents", () => {
    const now = new Date("2026-09-29T12:00:00Z");

    test("drops ended events, keeps ongoing ones, sorts nearest first", () => {
      // Input in DB order: start_time DESC
      const events = [
        ev(5, "2026-12-01T10:00:00Z", "2026-12-01T12:00:00Z"),
        ev(4, "2026-10-05T10:00:00Z", "2026-10-05T12:00:00Z"),
        ev(3, "2026-09-30 01:00:00", "2026-09-30 03:00:00"), // SQLite UTC format
        ev(2, "2026-09-29T10:00:00Z", "2026-09-29T14:00:00Z"), // ongoing
        ev(1, "2026-09-01T10:00:00Z", "2026-09-01T12:00:00Z"), // past
      ];
      expect(selectUpcomingEvents(events, now).map((e) => e.id)).toEqual([2, 3, 4, 5]);
    });

    test("takes the 10 nearest upcoming events, not the 10 latest", () => {
      const events: AppEvent[] = [];
      for (let i = 20; i >= 1; i--) {
        const day = String(i).padStart(2, "0");
        events.push(ev(i, `2026-10-${day}T10:00:00Z`, `2026-10-${day}T12:00:00Z`));
      }
      events.push(ev(99, "2026-01-01T10:00:00Z", "2026-01-01T12:00:00Z")); // past
      const selected = selectUpcomingEvents(events, now);
      expect(selected.map((e) => e.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });
  });

  describe("extractCitations", () => {
    const sent = [
      { id: 101, title: "Damage & Return SOP" },
      { id: 202, title: "Camera Handling" },
    ];

    test("keeps only citations whose document_id was actually sent, using the real title", () => {
      const text = `Answer body.

\`\`\`json_citations
[
  { "document_id": 202, "document_title": "Hallucinated Title", "section_title": "Lenses", "snippet": "Cap the lens." },
  { "document_id": 999, "document_title": "Not sent", "snippet": "x" },
  { "document_id": "101", "document_title": "Damage & Return SOP", "snippet": "Notify IC." },
  { "document_id": "abc", "snippet": "y" },
  { "document_title": "no id" }
]
\`\`\``;

      const { answer, citations } = extractCitations(text, sent);
      expect(answer).toBe("Answer body.");
      expect(citations).toEqual([
        { document_id: 202, document_title: "Camera Handling", section_title: "Lenses", snippet: "Cap the lens." },
        { document_id: 101, document_title: "Damage & Return SOP", section_title: undefined, snippet: "Notify IC." },
      ]);
    });

    test("an invalid id does not fall back to another document", () => {
      const text = '```json_citations\n[{ "document_id": 7, "document_title": "X", "snippet": "s" }]\n```';
      expect(extractCitations(text, sent).citations).toEqual([]);
    });

    test("malformed JSON yields no citations but still strips the block", () => {
      jest.spyOn(console, "warn").mockImplementation(() => {});
      const { answer, citations } = extractCitations("Hi\n```json_citations\n[{bad json\n```", sent);
      expect(answer).toBe("Hi");
      expect(citations).toEqual([]);
      jest.restoreAllMocks();
    });

    test("no block: answer unchanged", () => {
      expect(extractCitations("Plain answer", sent)).toEqual({ answer: "Plain answer", citations: [] });
    });
  });
});
