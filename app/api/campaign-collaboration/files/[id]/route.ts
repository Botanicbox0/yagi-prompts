import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { getStorage } from "@/lib/storage";
import { readParticipantFile } from "@/lib/campaigns/collaboration/service";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
};
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const [{ id }, viewer, sql] = await Promise.all([
      params,
      getViewer(),
      getSqlRunner(),
    ]);
    if (!sql || !viewer.userId)
      return new NextResponse(null, { status: 404, headers });
    const file = await readParticipantFile(
      { sql, storage: await getStorage() },
      viewer,
      id,
    );
    if (!file) return new NextResponse(null, { status: 404, headers });
    return new NextResponse(file.bytes as BodyInit, {
      headers: {
        ...headers,
        "Content-Type": file.mime,
        "Content-Disposition": `attachment; filename="file"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "Content-Length": String(file.bytes.length),
      },
    });
  } catch {
    return new NextResponse(null, { status: 404, headers });
  }
}
