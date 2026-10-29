import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { getStorage } from "@/lib/storage";
import { fail, type AdminOutcome } from "@/lib/admin/context";
import { dispatchAdmin } from "@/lib/admin/dispatch";
import { BACK_FIELD, OP_FIELD, str } from "@/lib/admin/form";
import { brandHostDestination, brandHostOutcomeUrl, isBrandHostStudioOperation, STUDIO_REQUEST_HEADER } from "@/lib/admin/brand-host-studio";
import { recordStudioAction, studioAuditSubject, studioBudgetSpent } from "@/lib/admin/brand-host-audit";
import { resolveRequestUrl } from "@/lib/routing/surfaces";

/**
 * `POST /api/brand-workspace/studio` — the studio's campaign preparation from brand.twings.app
 * (docs/BRAND-STAFF-ACCESS.md "운영자 캠페인 준비", "보안"). In order, and every refusal before the
 * operation is a bare 404 (the door does not confirm it exists):
 *   1. `requireAdmin()`;
 *   2. the browser's own proof of a same-origin request: `Origin` equal to this origin AND
 *      `Sec-Fetch-Site: same-origin`, both required (the shared middleware check tolerates either missing);
 *   3. the operation against the short allowlist;
 *   4. JSON calls carry `x-twings-studio: 1`, which a cross-site form cannot send;
 *   5. this admin's action budget (429 when spent), then an audit row written before the action runs;
 *   6. the registered operation through `dispatchAdmin`, then the result row.
 * The destination is translated to the brand-host page that shows the same campaign.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;
/** The forms this door takes are a few short fields; anything larger is not one of them. */
const MAX_BODY = 64 * 1024;

const notFound = () => new NextResponse(null, { status: 404, headers: NO_STORE });

export async function POST(request: NextRequest): Promise<NextResponse> {
  let viewer;
  try {
    viewer = await requireAdmin();
  } catch {
    return notFound();
  }
  const requestUrl = resolveRequestUrl(new URL(request.url), request.headers);
  if (requestUrl === null || request.headers.get("origin") !== requestUrl.origin || request.headers.get("sec-fetch-site") !== "same-origin") return notFound();
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return new NextResponse(null, { status: 413, headers: NO_STORE });
  const form = await request.formData().catch(() => null);
  if (!form) return notFound();
  const name = str(form, OP_FIELD);
  if (!isBrandHostStudioOperation(name)) return notFound();
  const json = request.headers.get("accept") === "application/json";
  if (json && request.headers.get(STUDIO_REQUEST_HEADER) !== "1") return notFound();

  const answer = (outcome: AdminOutcome, to?: string) => {
    if (json) return outcome.ok
      ? NextResponse.json({ ok: true, to }, { headers: NO_STORE })
      : NextResponse.json({ ok: false, code: outcome.code }, { status: outcome.code === "studioRateLimited" ? 429 : 400, headers: NO_STORE });
    // JS-free forms: 303 back to the page, so a refresh never re-submits.
    return NextResponse.redirect(new URL(brandHostOutcomeUrl(str(form, BACK_FIELD), outcome), requestUrl.origin), { status: 303, headers: NO_STORE });
  };

  const sql = await getSqlRunner();
  if (sql === null) return answer(fail("unknown", "no database is configured on this deployment"));
  const actorId = viewer.userId!;
  if (await studioBudgetSpent(sql, actorId)) return answer(fail("studioRateLimited"));
  const { entityId, details } = studioAuditSubject(form, actorId);
  const entry = { actorId, op: name, entityId, host: requestUrl.host, details };
  // No audit row, no action.
  await recordStudioAction(sql, entry);
  const outcome = await dispatchAdmin(name, form, { sql, storage: await getStorage(), viewer });
  await recordStudioAction(sql, { ...entry, outcome }).catch((error) => console.error("[brand-studio] audit result not written", error));

  if (!outcome.ok || !json) return answer(outcome);
  // A new brand has no page of its own here: land on the campaign form with it selected.
  const organizationId = name === "brandWorkspace.organization"
    ? (await sql.query<{ id: string }>("select id from brand_organizations where created_by=$1 and request_id=$2", [actorId, str(form, "requestId")])).rows[0]?.id
    : null;
  return answer(outcome, brandHostDestination(outcome.to, organizationId ? String(organizationId) : null));
}
