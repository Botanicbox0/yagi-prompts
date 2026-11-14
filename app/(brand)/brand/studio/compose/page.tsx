import type { Metadata } from 'next';
import { brandContext } from '@/components/brand-workspace/context';
import { brandScope } from '@/components/brand-workspace/scope';
import { studioRouteOrShowroom } from '@/components/brand-studio/route-context';
import { StudioShowroom } from '@/components/brand-studio/studio-showroom';
import { VideoComposer } from '@/components/brand-studio/compose/video-composer';
import { studioEnv } from '@/lib/brand-studio/env';
import { loadFolderItems, loadLibrary } from '@/lib/brand-studio/library';
import type { LibraryItemWire } from '@/lib/brand-studio/library-contracts';
import { createStudioMediaStore } from '@/lib/brand-studio/media-store';
import { assetView, assetsOf, jobsOf, viewsOf } from '@/lib/brand-studio/repo';
import { allowanceView, loadAllowance } from '@/lib/brand-studio/usage';
import { studioShowroomVisible, studioV2Visible } from '@/lib/brand-studio/visibility';
import { scopedHref } from '@/lib/brands/workspace/selection';
import { brandStudioV2Open } from '@/lib/flags';

/**
 * `/brand/studio/compose` — simple video composer (`docs/BRAND-VIDEO-COMPOSE-D.md`, Founder Decisions 3 & 5a).
 *
 * First line calls `studioRouteOrShowroom(organizationId)`: Morphic/sandboxed organizations, organizations
 * whose policy denies `generative_media`, campaign-only guests, and environments with `BRAND_STUDIO_V2`
 * off all receive `404` before any query executes. Non-subscribed `project_only` organizations receive
 * `<StudioShowroom focus="video" />`.
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
  if (!choice || (!studioV2Visible(choice, true) && !studioShowroomVisible(choice, true))) return {};
  return { title: dict.studioCompose.title };
}

export default async function StudioComposePage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  const params = await searchParams;
  const ctx = await studioRouteOrShowroom(params.organizationId);
  const { choice, access, locale, dict } = ctx;
  if (ctx.kind === 'showroom') {
    return (
      <StudioShowroom
        focus="video"
        organizationId={choice.id}
        organizationName={choice.name}
        canRequest={!access.staff && access.canRequest}
        imageHref={scopedHref('/brand/studio', choice)}
        videoHref={scopedHref('/brand/studio/video', choice)}
        projectSpaceHref={scopedHref('/brand', choice)}
        newBriefHref={scopedHref('/brand/projects/new', choice)}
        copy={dict.studioShell.showroom}
      />
    );
  }

  const { deps, viewer } = ctx;
  const media = createStudioMediaStore();

  const [rawAssets, rawJobs, allowance, libraryRes] = await Promise.all([
    assetsOf(deps.sql, choice.id, 200),
    jobsOf(deps.sql, choice.id, 60),
    loadAllowance(deps.sql, choice.id, studioEnv()),
    loadLibrary({ sql: deps.sql, media }, viewer, choice.id).catch(() => null),
  ]);
  const assets = rawAssets
    .filter((a) => a.kind === 'video' || a.kind === 'audio' || a.kind === 'image')
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
  const imageOutputs = jobs.flatMap((job) =>
    job.outputs
      .filter((out) => out.kind === 'image')
      .map((out, idx) => ({
        ...out,
        label:
          job.prompt.trim().slice(0, 36) ||
          `${dict.studioCompose.sources.browser.imageTag} ${idx + 1}`,
      })),
  );

  const initialFolders = libraryRes && libraryRes.ok ? libraryRes.folders : [];
  const initialLikedItems = libraryRes && libraryRes.ok ? libraryRes.liked : [];
  const initialLikedKeys = initialLikedItems.map((item) => item.key);

  const initialFolderItems: Record<string, LibraryItemWire[]> = {};
  if (initialFolders.length > 0) {
    const preloaded = await Promise.all(
      initialFolders.slice(0, 12).map(async (folder) => {
        const res = await loadFolderItems({ sql: deps.sql, media }, viewer, choice.id, folder.id).catch(() => null);
        return [folder.id, res && res.ok ? res.items : []] as const;
      }),
    );
    for (const [folderId, items] of preloaded) {
      initialFolderItems[folderId] = items;
    }
  }

  const canCreate = !access.staff && (choice.role === 'owner' || choice.role === 'editor');

  return (
    <VideoComposer
      organizationId={choice.id}
      locale={locale}
      canCreate={canCreate}
      copy={dict.studioCompose}
      videoStudioHref={scopedHref('/brand/studio/video', choice)}
      initialAllowance={allowanceView(allowance)}
      initialAssets={assets}
      initialVideoOutputs={videoOutputs}
      initialImageOutputs={imageOutputs}
      initialFolders={initialFolders}
      initialLikedKeys={initialLikedKeys}
      initialLikedItems={initialLikedItems}
      initialFolderItems={initialFolderItems}
    />
  );
}
