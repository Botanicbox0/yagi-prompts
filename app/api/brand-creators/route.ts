import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getViewer } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { resolveRequestUrl, sameOriginMutation } from "@/lib/routing/surfaces";
import { readBoundedBody } from "@/lib/creator-subscriptions/http";
import { influencersOpen } from "@/lib/influencers/rules";
import { issueInvitation } from "@/lib/campaigns/collaboration/service";
import { notifyCampaignInvitation } from "@/lib/campaigns/notify";
import { getMailer } from "@/lib/notify/service";
import { siteUrl } from "@/lib/seo/site-url";

/**
 * The creator pool's one action (docs/PLATFORM-2.0.md §17.3): invite a pool member to one of this
 * brand's recruiting campaigns. `issueInvitation` with `socialAccountId` adds them to
 * campaign_targets and binds the link to their account. The link is not returned: the invited
 * person gets it by mail (campaign mail on only), after this response, and only for a new
 * invitation. Closed while TWINGS_INFLUENCERS is off; the TWINGS team acts through /admin/do.
 */
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
const Body = z.object({ campaignId: z.string().uuid(), socialAccountId: z.string().uuid(), requestId: z.string().uuid() }).strict();
const STATUS: Record<string, number> = { unavailable: 503, invalid: 400, not_found: 404, sign_in_required: 401, rate_limited: 429, forbidden: 403 };

export async function POST(request: NextRequest) {
  if (!influencersOpen()) return json({ ok: false, code: "not_found" }, 404);
  const origin = resolveRequestUrl(new URL(request.url), request.headers);
  if (!origin || !sameOriginMutation(origin, request.headers)) return json({ ok: false, code: "forbidden" }, 403);
  const viewer = await getViewer();
  if (!viewer.userId) return json({ ok: false, code: "sign_in_required" }, 401);
  if (viewer.isAdmin) return json({ ok: false, code: "forbidden" }, 403);
  try {
    const bytes = await readBoundedBody(request, 2000);
    if (!bytes || request.headers.get("content-type") !== "application/json") return json({ ok: false, code: "invalid" }, 400);
    let parsed: unknown;
    try { parsed = JSON.parse(new TextDecoder().decode(bytes)); } catch { return json({ ok: false, code: "invalid" }, 400); }
    const input = Body.safeParse(parsed);
    if (!input.success) return json({ ok: false, code: "invalid" }, 400);
    const sql = await getSqlRunner();
    if (!sql) return json({ ok: false, code: "unavailable" }, 503);
    const result = await issueInvitation({ sql }, viewer, input.data);
    if (!result.ok) return json(result, STATUS[result.code] ?? 409);
    const { id, token, invitee } = result;
    if (invitee) {
      after(async () => {
        try {
          await notifyCampaignInvitation(
            { sql, mailer: getMailer(), siteUrl: siteUrl() },
            { campaignId: input.data.campaignId, userId: invitee, invitationId: id, token },
          );
        } catch {
          console.error(`[brand-creators] invitation mail ${id} failed`);
        }
      });
    }
    return json({ ok: true, id });
  } catch {
    return json({ ok: false, code: "unavailable" }, 503);
  }
}
