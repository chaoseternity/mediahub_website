import { auth } from "@/lib/auth";
import { getAllSOPDocuments } from "@/lib/db";
import { askSOPAssistant } from "@/lib/gemini";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const ChatRequestSchema = z.object({
  question: z.string().min(1, "Question cannot be empty"),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })
    )
    .optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = ChatRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { question, history } = parsed.data;

    // Fetch all current SOP documents from PostgreSQL
    const sopDocuments = await getAllSOPDocuments();

    const result = await askSOPAssistant({
      question,
      history,
      sopDocuments,
    });

    return NextResponse.json(result);
  } catch (err: unknown) {
    console.error("SOP Chat API Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to process chat query" },
      { status: 500 }
    );
  }
}
