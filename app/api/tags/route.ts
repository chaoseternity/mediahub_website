import { auth } from "@/lib/auth";
import { getAllTags, createTag } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse, toErrorResponse, validationErrorResponse } from "@/lib/api-errors";
import { z } from "zod";

const CreateTagSchema = z.object({
  name: z.string().trim().min(1, "Tag name is required").max(50, "Tag name cannot exceed 50 characters"),
});

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tags = await getAllTags();
  return NextResponse.json(tags);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = CreateTagSchema.safeParse(body);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }

  try {
    // createTag returns the existing tag on a case-insensitive match: answer 200 then, 201 when new.
    const existingIds = new Set((await getAllTags()).map((t) => t.id));
    const tag = await createTag(parsed.data.name);
    return NextResponse.json(tag, { status: existingIds.has(tag.id) ? 200 : 201 });
  } catch (err: unknown) {
    // Duplicate names surface from the database as a UNIQUE constraint violation.
    if (err instanceof Error && /UNIQUE constraint failed/i.test(err.message)) {
      return errorResponse(409, `A tag named "${parsed.data.name}" already exists.`);
    }
    return toErrorResponse(err, "Failed to create tag");
  }
}
