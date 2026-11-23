import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/auth/viewer";
import { getVerifiedEmail } from "@/lib/auth/verified-email";
import { getSqlRunner } from "@/lib/db/connect";
import { getStorage, STAGING_BUCKET } from "@/lib/storage";
import {
  BRAND_LOGO_MAX_BYTES,
  loadBrandOrganizationLogoAccess,
  storeBrandOrganizationLogo,
} from "@/lib/brands/workspace/service";
import { resolveRequestUrl, sameOriginMutation } from "@/lib/routing/surfaces";
export const dynamic = "force-dynamic";
/**
 * A brand's private logo. GET re-authorizes on every request (member, shared-campaign guest or
 * the TWINGS team) and streams the bytes from the private staging bucket; there is no public copy. POST
 * takes the raw image body (<= 2 MiB, well under the platform body limit) from an owner or the studio.
 */
const HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "sandbox; default-src 'none'",
};
type Context = { params: Promise<{ id: string }> };
const empty = (status = 404) => new NextResponse(null, { status, headers: HEADERS });

async function read(context: Context, head: boolean) {
  try {
    const [{ id }, viewer, sql] = await Promise.all([context.params, getViewer(), getSqlRunner()]);
    if (!viewer.userId || !sql) return empty();
    const logo = await loadBrandOrganizationLogoAccess({ sql, verifiedEmail: await getVerifiedEmail(viewer.userId) }, viewer, id);
    if (!logo) return empty();
    const headers = { ...HEADERS, "Content-Type": logo.mime, "Content-Length": String(logo.sizeBytes), ETag: `"${logo.sha256}"` };
    if (head) return new NextResponse(null, { headers });
    const bytes = await (await getStorage()).read(STAGING_BUCKET, logo.key);
    return new NextResponse(Buffer.from(bytes), { headers });
  } catch {
    return empty(503);
  }
}
export const GET = (_request: NextRequest, context: Context) => read(context, false);
export const HEAD = (_request: NextRequest, context: Context) => read(context, true);

const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: HEADERS });
export async function POST(request: NextRequest, context: Context) {
  const origin = resolveRequestUrl(new URL(request.url), request.headers);
  if (!origin || !sameOriginMutation(origin, request.headers)) return json({ ok: false, code: "forbidden" }, 403);
  try {
    const [{ id }, viewer, sql] = await Promise.all([context.params, getViewer(), getSqlRunner()]);
    if (!viewer.userId) return json({ ok: false, code: "sign_in_required" }, 401);
    if (!sql) return json({ ok: false, code: "storage_unavailable" }, 503);
    if (Number(request.headers.get("content-length") ?? 0) > BRAND_LOGO_MAX_BYTES) return json({ ok: false, code: "invalid" }, 413);
    const reader = request.body?.getReader();
    if (!reader) return json({ ok: false, code: "invalid" }, 400);
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > BRAND_LOGO_MAX_BYTES) {
        await reader.cancel();
        return json({ ok: false, code: "invalid" }, 413);
      }
      chunks.push(next.value);
    }
    const params = request.nextUrl.searchParams;
    const declared = request.headers.get("content-type")?.split(";")[0]?.trim();
    const result = await storeBrandOrganizationLogo({ sql, storage: await getStorage() }, viewer, {
      organizationId: id,
      requestId: params.get("requestId") ?? "",
      expectedRevision: Number(params.get("expectedRevision") ?? NaN),
      bytes: Buffer.concat(chunks),
      ...(declared ? { mime: declared } : {}),
    });
    if (result.ok) return json(result);
    return json(result, result.code === "conflict" ? 409 : result.code === "not_found" ? 404 : result.code === "forbidden" ? 403 : result.code === "storage_quota_exceeded" ? 413 : result.code === "storage_unavailable" ? 503 : 400);
  } catch {
    return json({ ok: false, code: "storage_unavailable" }, 503);
  }
}
