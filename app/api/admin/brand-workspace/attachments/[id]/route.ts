import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/viewer";
import { POST as upload } from "@/app/api/brand-workspace/attachments/[id]/route";
export const dynamic = "force-dynamic";
/** Local-only bytes transport; cloud uploads go directly to the private staging bucket. */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
  } catch {
    return new NextResponse(null, {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  return upload(request, context);
}
