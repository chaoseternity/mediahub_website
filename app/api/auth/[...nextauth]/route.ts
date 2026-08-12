import { handlers } from "@/lib/auth";
import type { NextRequest } from "next/server";

// Wrap NextAuth v5 handlers in explicit (req, _ctx) signatures to satisfy
// Next.js 16's strict route-handler type validator, which requires both args.
export async function GET(
  req: NextRequest,
  _ctx: { params: Promise<{ nextauth: string[] }> }
) {
  return handlers.GET(req);
}

export async function POST(
  req: NextRequest,
  _ctx: { params: Promise<{ nextauth: string[] }> }
) {
  return handlers.POST!(req);
}
