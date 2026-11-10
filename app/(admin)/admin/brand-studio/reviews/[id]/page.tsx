import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { getLocaleFromHeaders } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { interpolate } from "@/lib/i18n/format";
import { AdminShell, OutcomeBanner } from "@/components/admin/chrome";
import { AdminReviewStage } from "@/components/brand-studio/review/admin-stage";
import { createStudioMediaStore } from "@/lib/brand-studio/media-store";
import { staffReviewDetail } from "@/lib/brand-studio/review";
import { parseReviewTime } from "@/lib/brand-studio/review-contracts";
import { staffListShares } from "@/lib/brand-rooms/shares";
import { AdminShareLinks } from "@/components/brand-rooms/share/admin-links";

/**
 * `/admin/brand-studio/reviews/[id]` — one piece under review, the team's side of the same stage the
 * brand sees (docs/BRAND-STUDIO-V3.md §7). Replies, resolutions and status moves go through the
 * registered `brand_studio.review.*` operations and are stored as the team (`author_role = 'studio'`).
 */
export const dynamic = "force-dynamic";

export default async function StudioReviewDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [viewer, sql, locale, { id }, search] = await Promise.all([requireAdmin(), getSqlRunner(), getLocaleFromHeaders(), params, searchParams]);
  const dict = getDictionary(locale);
  const r = dict.studioReview;
  if (!sql) return <p role="alert">{dict.brandWorkspace.unavailable}</p>;
  const detail = await staffReviewDetail({ sql, media: createStudioMediaStore() }, viewer, id);
  if (!detail.ok) notFound();
  // Rooms (docs/BRAND-ROOMS.md §6): the links the brand made for this draft, with the kill switch.
  const listed = detail.extended ? await staffListShares({ sql, media: createStudioMediaStore() }, viewer, { kind: "review", targetId: detail.review.id }) : null;
  const shares = listed && listed.ok ? listed.shares : null;
  return (
    <AdminShell dict={dict.admin} locale={locale} active="brandWorkspace">
      <OutcomeBanner
        dict={dict.admin}
        ok={typeof search.ok === "string" ? search.ok : undefined}
        err={typeof search.err === "string" ? search.err : undefined}
        detail={typeof search.detail === "string" ? search.detail : undefined}
      />
      <div data-admin-studio-review={detail.review.id}>
        <p>
          <a href="/admin/brand-studio/reviews" className="admin-back">
            ← {r.admin.back}
          </a>
        </p>
        <AdminReviewStage
          review={detail.review}
          comments={detail.comments}
          copy={r}
          locale={locale === "en" ? "en" : "ko"}
          eyebrow={interpolate(r.admin.brandOf, { name: detail.organizationName })}
          initialMs={parseReviewTime(typeof search.t === "string" ? search.t : undefined)}
          extended={detail.extended === true}
          versions={detail.versions}
        />
        {shares && <AdminShareLinks shares={shares} reviewId={detail.review.id} locale={locale === "en" ? "en" : "ko"} copy={dict.roomsReview} />}
      </div>
    </AdminShell>
  );
}
