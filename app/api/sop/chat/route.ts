import { auth } from "@/lib/auth";
import { getAllSOPDocuments, getAllEquipment, getAllEvents } from "@/lib/db";
import { askSOPAssistant } from "@/lib/gemini";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const ChatRequestSchema = z
  .object({
    question: z.string().max(4000, "Question must be 4000 characters or less").optional(),
    message: z.string().max(4000, "Message must be 4000 characters or less").optional(),
    history: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string().max(4000, "History message must be 4000 characters or less"),
        })
      )
      .max(50, "History cannot exceed 50 messages")
      .optional(),
  })
  .refine(
    (data) =>
      Boolean(
        (data.question && data.question.trim().length > 0) ||
        (data.message && data.message.trim().length > 0)
      ),
    {
      message: "Please provide a question or message.",
    }
  );

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = ChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.message || "Invalid request. Please provide a question.";
    return NextResponse.json({ error: issue }, { status: 400 });
  }

  try {

    const question = (parsed.data.question || parsed.data.message || "").trim();
    const history = parsed.data.history || [];

    // Fetch SOP documents, live equipment inventory, and events in parallel
    const [sopDocuments, equipmentList, events] = await Promise.all([
      getAllSOPDocuments().catch(() => []),
      getAllEquipment().catch(() => []),
      getAllEvents().catch(() => []),
    ]);

    const result = await askSOPAssistant({
      question,
      history,
      sopDocuments,
      equipmentList,
      events,
    });

    return NextResponse.json({
      reply: result.answer,
      answer: result.answer,
      citations: result.citations || [],
      modelUsed: result.modelUsed,
    });
  } catch (err: unknown) {
    console.error("SOP Chat API Error:", err);
    const message = err instanceof Error ? err.message : "Failed to process chat query";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

