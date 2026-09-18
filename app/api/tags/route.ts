import { auth } from "@/lib/auth";
import { getAllTags, createTag } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const CreateTagSchema = z.object({
  name: z.string().min(1).max(50),
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

  const body = await req.json();
  const parsed = CreateTagSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const tag = await createTag(parsed.data.name);
    return NextResponse.json(tag, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create tag";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
