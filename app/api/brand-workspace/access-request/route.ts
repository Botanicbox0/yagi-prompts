import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth/viewer";
import { getVerifiedEmail } from "@/lib/auth/verified-email";
import { isSandboxedClientOrganization } from "@/lib/brands/features";
import { loadUsageRequestPending } from "@/lib/brands/workspace/home-checklist";
import { loadBrandSettings } from "@/lib/brands/workspace/service";
import { getSqlRunner } from "@/lib/db/connect";

/**
 * `GET /api/brand-workspace/access-request?organizationId=…` → `{ ok: true, requested }`.
 * Whether a studio access request from this organization is still waiting for the team, so the closed
 * studio banner does not ask the customer to send it again (`lib/brands/workspace/home-checklist.ts`
 * `loadUsageRequestPending`: `/brand/home`'s checklist rule, limited to recent requests the team has not
 * answered yet).
 *
 * Access is the sibling `GET /api/brand-workspace`'s: a signed-in viewer with the brand-level read role
 * (active membership, else the TWINGS team's read view) through the workspace service. Everyone else —
 * signed out, outsiders, unknown organizations, malformed ids — gets that route's bare `{ ok: false }` 404,
 * and so does a sandboxed organization (the 404 it gets everywhere in the studio and workspace).
 */
export const dynamic = "force-dynamic";

const HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: HEADERS });
}

export async function GET(request: NextRequest) {
  try {
    const [viewer, sql] = await Promise.all([getViewer(), getSqlRunner()]);
    if (!sql || !viewer.userId) return json({ ok: false }, 404);
    const organizationId = request.nextUrl.searchParams.get("organizationId") ?? "";
    const verifiedEmail = await getVerifiedEmail(viewer.userId);
    const organization = await loadBrandSettings({ sql, verifiedEmail }, viewer, organizationId);
    if (!organization || isSandboxedClientOrganization({ id: organization.id, name: organization.name })) {
      return json({ ok: false }, 404);
    }
    const requested = await loadUsageRequestPending(sql, organization.id);
    return json({ ok: true, requested });
  } catch {
    return json({ ok: false }, 503);
  }
}
