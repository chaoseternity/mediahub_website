import { auth } from "@/lib/auth";
import { getAllSOPDocuments, getAllEquipment, getAllEvents } from "@/lib/db";
import { askSOPAssistant } from "@/lib/gemini";
import { NextRequest, NextResponse } from "next/server";
import { ChatRequestSchema } from "./schema";

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
    const rawQuestion = (parsed.data.question || parsed.data.message || "").trim();
    const image = parsed.data.image;
    const question = rawQuestion || (image ? "Please inspect this image and provide relevant equipment, operational, or SOP guidance." : "");
    const history = parsed.data.history || [];

    // Fetch SOP documents, live equipment inventory, and events in parallel
    const [sopDocuments, equipmentList, events] = await Promise.all([
      getAllSOPDocuments().catch(() => []),
      getAllEquipment().catch(() => []),
      getAllEvents().catch(() => []),
    ]);

    const result = await askSOPAssistant({
      question,
      image,
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
    // Model/provider errors can contain upstream details — log them, return a generic message.
    console.error("SOP Chat API Error:", err);
    if (err instanceof Error && /GEMINI_API_KEY/.test(err.message)) {
      return NextResponse.json({ error: "The SOP assistant is not configured on this server." }, { status: 503 });
    }
    return NextResponse.json(
      { error: "The SOP assistant could not answer right now. Please try again in a moment." },
      { status: 502 }
    );
  }
}

