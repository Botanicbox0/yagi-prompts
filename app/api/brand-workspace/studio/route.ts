import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { getStorage } from "@/lib/storage";
import { fail, type AdminOutcome } from "@/lib/admin/context";
import { dispatchAdmin } from "@/lib/admin/dispatch";
import { BACK_FIELD, OP_FIELD, str } from "@/lib/admin/form";
import { brandHostDestination, brandHostOutcomeUrl, isBrandHostStudioOperation } from "@/lib/admin/brand-host-studio";
import { SHORTLIST_IMPORT_MAX_BODY } from "@/lib/brands/shortlist/schema";
import { resolveRequestUrl, sameOriginMutation } from "@/lib/routing/surfaces";

/**
 * `POST /api/brand-workspace/studio` — the studio's campaign preparation from brand.twings.app
 * (docs/BRAND-STAFF-ACCESS.md "운영자 캠페인 준비"). Same order as `/admin/do`: `requireAdmin()` first,
 * a 404 for anyone else (the door does not confirm it exists), then the same-origin check, then the
 * operation name against a short allowlist, then the registered operation through `dispatchAdmin`.
 * The destination is translated to the brand-host page that shows the same campaign.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;
/** A shortlist file (4 MB) plus the multipart envelope; anything larger is not one of these forms. */
const MAX_BODY = SHORTLIST_IMPORT_MAX_BODY + 64 * 1024;

const notFound = () => new NextResponse(null, { status: 404, headers: NO_STORE });

export async function POST(request: NextRequest): Promise<NextResponse> {
  let viewer;
  try {
    viewer = await requireAdmin();
  } catch {
    return notFound();
  }
  const requestUrl = resolveRequestUrl(new URL(request.url), request.headers);
  if (requestUrl === null || !sameOriginMutation(requestUrl, request.headers)) return notFound();
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return new NextResponse(null, { status: 413, headers: NO_STORE });
  const form = await request.formData().catch(() => null);
  if (!form) return notFound();
  const name = str(form, OP_FIELD);
  if (!isBrandHostStudioOperation(name)) return notFound();

  const sql = await getSqlRunner();
  const outcome: AdminOutcome = sql === null
    ? fail("unknown", "no database is configured on this deployment")
    : await dispatchAdmin(name, form, { sql, storage: await getStorage(), viewer });

  if (request.headers.get("accept") === "application/json") {
    if (!outcome.ok) return NextResponse.json({ ok: false, code: outcome.code }, { status: 400, headers: NO_STORE });
    // A new brand has no page of its own here: land on the campaign form with it selected.
    const organizationId = name === "brandWorkspace.organization" && sql
      ? (await sql.query<{ id: string }>("select id from brand_organizations where created_by=$1 and request_id=$2", [viewer.userId, str(form, "requestId")])).rows[0]?.id
      : null;
    return NextResponse.json({ ok: true, to: brandHostDestination(outcome.to, organizationId ? String(organizationId) : null) }, { headers: NO_STORE });
  }
  // JS-free forms (the shortlist panel): 303 back to the page, so a refresh never re-submits.
  return NextResponse.redirect(new URL(brandHostOutcomeUrl(str(form, BACK_FIELD), outcome), requestUrl.origin), { status: 303, headers: NO_STORE });
}
