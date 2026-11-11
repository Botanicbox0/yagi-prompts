import type { Metadata } from 'next';
import { brandContext } from '@/components/brand-workspace/context';
import { brandScope } from '@/components/brand-workspace/scope';
import { studioRouteContext } from '@/components/brand-studio/route-context';
import { VideoComposer } from '@/components/brand-studio/compose/video-composer';
import { createStudioMediaStore } from '@/lib/brand-studio/media-store';
import { assetView, assetsOf, jobsOf, viewsOf } from '@/lib/brand-studio/repo';
import { studioV2Visible } from '@/lib/brand-studio/visibility';
import { scopedHref } from '@/lib/brands/workspace/selection';
import { brandStudioV2Open } from '@/lib/flags';

/**
 * `/brand/studio/compose` — simple video composer (`docs/BRAND-VIDEO-COMPOSE-D.md`).
 *
 * First line calls `studioRouteContext(organizationId)`: Morphic/sandboxed organizations, organizations
 * whose policy denies `generative_media`, campaign-only guests, and environments with `BRAND_STUDIO_V2`
 * off all receive `404` before any query below executes.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}): Promise<Metadata> {
  if (!brandStudioV2Open()) return {};
  const [{ organizationId }, { sql, viewer, verifiedEmail, dict }] = await Promise.all([searchParams, brandContext()]);
  if (!sql) return {};
  const { choice } = await brandScope({ sql, verifiedEmail }, viewer, organizationId);
  if (!choice || !studioV2Visible(choice, true)) return {};
  return { title: dict.studioCompose.title };
}

export default async function StudioComposePage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  const params = await searchParams;
  const ctx = await studioRouteContext(params.organizationId);
  const { choice, access, locale, dict, deps } = ctx;
  const media = createStudioMediaStore();

  const [rawAssets, rawJobs] = await Promise.all([
    assetsOf(deps.sql, choice.id, 200),
    jobsOf(deps.sql, choice.id, 60),
  ]);
  const assets = rawAssets
    .filter((a) => a.kind === 'video' || a.kind === 'audio')
    .map((a) => assetView(a, media));
  const jobs = await viewsOf(deps.sql, rawJobs, media);
  const videoOutputs = jobs.flatMap((job) =>
    job.outputs
      .filter((out) => out.kind === 'video')
      .map((out, idx) => ({
        ...out,
        label:
          job.prompt.trim().slice(0, 36) ||
          `${dict.studioVideo.title} ${idx + 1}`,
      })),
  );

  const canCreate = !access.staff && (choice.role === 'owner' || choice.role === 'editor');

  return (
    <VideoComposer
      organizationId={choice.id}
      locale={locale}
      canCreate={canCreate}
      copy={dict.studioCompose}
      videoStudioHref={scopedHref('/brand/studio/video', choice)}
      initialAssets={assets}
      initialVideoOutputs={videoOutputs}
    />
  );
}
