import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { getStorage, STAGING_BUCKET } from "@/lib/storage";
import {
  loadBrandAttachmentAccess,
  loadBrandAttachmentUploadAccess,
} from "@/lib/brands/workspace/service";
import { resolveRequestUrl, sameOriginMutation } from "@/lib/routing/surfaces";
export const dynamic = "force-dynamic";
const HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "sandbox; default-src 'none'",
};
type Context = { params: Promise<{ id: string }> };
const unavailable = (status = 404) =>
  new NextResponse(null, { status, headers: HEADERS });
async function read(request: NextRequest, context: Context, head: boolean) {
  try {
    const [{ id }, viewer, sql] = await Promise.all([
      context.params,
      getViewer(),
      getSqlRunner(),
    ]);
    if (!viewer.userId || !sql) return unavailable();
    const file = await loadBrandAttachmentAccess({ sql }, viewer, id);
    if (!file) return unavailable();
    const headers = {
      ...HEADERS,
      "Content-Type": file.mime,
      "Content-Disposition": `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    };
    if (head)
      return new NextResponse(null, {
        headers: { ...headers, "Content-Length": String(file.sizeBytes) },
      });
    const storage = await getStorage();
    if (storage.servesSignedUrls && !file.contract) {
      const url = await storage.signedStagingUrl?.(file.key, 60);
      return url
        ? new NextResponse(null, {
            status: 302,
            headers: { ...headers, Location: url },
          })
        : unavailable(503);
    }
    const bytes = new Uint8Array(await storage.read(STAGING_BUCKET, file.key));
    // Contracts keep authorization on the app route. Stream bounded chunks rather than a
    // buffered 20MB response (Vercel's buffered payload limit is smaller than the PDF limit).
    if (file.contract) {
      let offset = 0;
      return new NextResponse(new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset >= bytes.length) { controller.close(); return; }
          const end = Math.min(offset + 64 * 1024, bytes.length);
          controller.enqueue(bytes.subarray(offset, end)); offset = end;
        },
      }), { headers });
    }
    return new NextResponse(Buffer.from(bytes), { headers });
  } catch {
    return unavailable(503);
  }
}
export const GET = (request: NextRequest, context: Context) =>
  read(request, context, false);
export const HEAD = (request: NextRequest, context: Context) =>
  read(request, context, true);
export async function POST(request: NextRequest, context: Context) {
  const origin = resolveRequestUrl(new URL(request.url), request.headers);
  if (!origin || !sameOriginMutation(origin, request.headers))
    return unavailable(403);
  try {
    const [{ id }, viewer, sql] = await Promise.all([
      context.params,
      getViewer(),
      getSqlRunner(),
    ]);
    if (!viewer.userId || !sql) return unavailable();
    const file = await loadBrandAttachmentUploadAccess({ sql }, viewer, id);
    if (!file) return unavailable();
    const storage = await getStorage();
    if (storage.servesSignedUrls) return unavailable(405);
    if (
      request.headers.get("content-type") !== file.mime ||
      Number(request.headers.get("content-length") ?? file.sizeBytes) >
        file.sizeBytes
    )
      return unavailable(400);
    const chunks: Uint8Array[] = [];
    let length = 0;
    const reader = request.body?.getReader();
    if (!reader) return unavailable(400);
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > file.sizeBytes) {
        await reader.cancel();
        return unavailable(413);
      }
      chunks.push(next.value);
    }
    if (
      length !== file.sizeBytes ||
      !(await loadBrandAttachmentUploadAccess({ sql }, viewer, id))
    )
      return unavailable(400);
    await storage.putStaging(file.key, Buffer.concat(chunks), file.mime);
    return NextResponse.json({ ok: true }, { headers: HEADERS });
  } catch {
    return unavailable(503);
  }
}
