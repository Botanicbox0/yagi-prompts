import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/auth/viewer";
import { getVerifiedEmail } from "@/lib/auth/verified-email";
import { getSqlRunner } from "@/lib/db/connect";
import { getStorage, STAGING_BUCKET } from "@/lib/storage";
import { loadShortlistAvatarAccess } from "@/lib/brands/shortlist/service";
export const dynamic = "force-dynamic";
/**
 * A shortlist candidate's profile picture (docs/BRAND-SHORTLIST.md). Re-authorized on every request:
 * the studio, or someone who can see the campaign once the candidate is shared. The bytes come from
 * the private staging bucket; there is no public copy and no link to where the picture came from.
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
    const avatar = await loadShortlistAvatarAccess({ sql, verifiedEmail: await getVerifiedEmail(viewer.userId) }, viewer, id);
    if (!avatar) return empty();
    const headers = { ...HEADERS, "Content-Type": avatar.mime, "Content-Length": String(avatar.sizeBytes), ETag: `"${avatar.sha256}"` };
    if (head) return new NextResponse(null, { headers });
    const bytes = await (await getStorage()).read(STAGING_BUCKET, avatar.key);
    return new NextResponse(Buffer.from(bytes), { headers });
  } catch {
    return empty(503);
  }
}
export const GET = (_request: NextRequest, context: Context) => read(context, false);
export const HEAD = (_request: NextRequest, context: Context) => read(context, true);
