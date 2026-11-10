import { notFound } from "next/navigation";
import { studioRouteContext } from "@/components/brand-studio/route-context";
import { ReviewApp } from "@/components/brand-studio/review/review-app";
import { createStudioMediaStore } from "@/lib/brand-studio/media-store";
import { loadReviewDetail, loadReviewList } from "@/lib/brand-studio/review";
import { parseReviewTime } from "@/lib/brand-studio/review-contracts";

/**
 * `/brand/studio/review` — the review space (docs/BRAND-STUDIO-V3.md §7). The route context is the
 * whole gate (sandbox, policy, campaign-only access, flag); the service checks the seat again.
 * `?review=<id>&t=<ms>` opens one piece at one moment; without it the newest active piece is open.
 */
export const dynamic = "force-dynamic";

export default async function StudioReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[]; review?: string | string[]; t?: string | string[] }>;
}) {
  const params = await searchParams;
  const ctx = await studioRouteContext(params.organizationId);
  const deps = { sql: ctx.deps.sql, media: createStudioMediaStore() };
  const organizationId = ctx.choice.id;
  const list = await loadReviewList(deps, ctx.viewer, organizationId);
  if (!list.ok) notFound();
  const asked = Array.isArray(params.review) ? params.review[0] : params.review;
  const chosen = (asked && list.reviews.find((r) => r.id === asked)?.id) || list.reviews[0]?.id || null;
  const detail = chosen ? await loadReviewDetail(deps, ctx.viewer, organizationId, chosen) : null;
  return (
    <ReviewApp
      organizationId={organizationId}
      locale={ctx.locale}
      copy={ctx.dict.studioReview}
      initialList={list}
      initialDetail={detail && detail.ok ? detail : null}
      initialMs={chosen && chosen === asked ? parseReviewTime(params.t) : null}
    />
  );
}
