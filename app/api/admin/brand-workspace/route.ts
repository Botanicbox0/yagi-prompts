import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { getStorage } from "@/lib/storage";
import { resolveRequestUrl, sameOriginMutation } from "@/lib/routing/surfaces";
import {
  reserveBrandAttachment,
  completeBrandAttachment,
} from "@/lib/brands/workspace/service";
export const dynamic = "force-dynamic";
const HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};
/** Transport exception, matching /api/admin/staging-url. Business actions stay in /admin/do. */
export async function POST(request: NextRequest) {
  const origin = resolveRequestUrl(new URL(request.url), request.headers);
  if (!origin || !sameOriginMutation(origin, request.headers))
    return new NextResponse(null, { status: 403, headers: HEADERS });
  let viewer;
  try {
    viewer = await requireAdmin();
  } catch {
    return new NextResponse(null, { status: 404, headers: HEADERS });
  }
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 16384)
      return new NextResponse(null, { status: 413, headers: HEADERS });
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 16384)
      return new NextResponse(null, { status: 413, headers: HEADERS });
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return new NextResponse(null, { status: 400, headers: HEADERS });
    }
    const sql = await getSqlRunner();
    if (!sql) return new NextResponse(null, { status: 503, headers: HEADERS });
    const storage = await getStorage();
    if (body?.operation === "attachment.reserve") {
      const result = await reserveBrandAttachment({ sql }, viewer, body.input);
      if (!result.ok)
        return NextResponse.json(result, { status: 400, headers: HEADERS });
      const url = await storage.signedUploadUrl(
        result.storageKey,
        String(body.input.mime),
      );
      if (!url && storage.servesSignedUrls)
        return new NextResponse(null, { status: 503, headers: HEADERS });
      return NextResponse.json(
        {
          ok: true,
          id: result.id,
          direct: url !== null,
          ...(url ? { url } : {}),
        },
        { headers: HEADERS },
      );
    }
    if (body?.operation === "attachment.complete") {
      const result = await completeBrandAttachment(
        { sql, storage },
        viewer,
        typeof body.input?.id === "string" ? body.input.id : "",
      );
      return NextResponse.json(result, {
        status: result.ok ? 200 : 400,
        headers: HEADERS,
      });
    }
    return new NextResponse(null, { status: 400, headers: HEADERS });
  } catch {
    return NextResponse.json(
      { ok: false, code: "storage_unavailable" },
      { status: 503, headers: HEADERS },
    );
  }
}
