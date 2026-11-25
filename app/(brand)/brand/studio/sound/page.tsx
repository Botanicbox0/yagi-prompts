import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { brandContext } from '@/components/brand-workspace/context';
import { brandScope } from '@/components/brand-workspace/scope';
import { studioRouteContext } from '@/components/brand-studio/route-context';
import { SoundStudio } from '@/components/brand-studio/sound/sound-studio';
import { ProjectSpineProvider } from '@/components/brand-studio/project-chip';
import { createStudioMediaStore } from '@/lib/brand-studio/media-store';
import { soundTabParam } from '@/lib/brand-studio/sound/library';
import { loadSoundStudio } from '@/lib/brand-studio/sound/load';
import { memberSeesBrandProjects } from '@/lib/brand-studio/brand-projects';
import { loadStudioSpine } from '@/lib/brand-studio/open-project-server';
import { studioEnv } from '@/lib/brand-studio/env';
import { soundStudioVisible } from '@/lib/brand-studio/visibility';
import { STUDIO_LIMITS } from '@/lib/brand-studio/contracts';
import { billingPlanCatalogue } from '@/lib/brands/billing-page-data';
import { assertBrandFeature, BrandFeatureDenied } from '@/lib/brands/entitlements';
import { scopedHref } from '@/lib/brands/workspace/selection';
import { brandSoundStudioOpen, brandStudioV2Open } from '@/lib/flags';

/**
 * `/brand/studio/sound` — the sound studio (docs/BRAND-SOUND-STUDIO.md §4, §7.3, slice SS1).
 *
 * Gate order, as every studio screen: the studio route guard first (a sandboxed organization, a brand whose
 * policy closes generative media or the self-serve studio, a project-only guest and a deployment with
 * `BRAND_STUDIO_V2` off all 404 there), then this page's own flag `BRAND_SOUND_STUDIO` (default off), then
 * the `sound` group of the feature policy. Any of them closed: 404, the same answer as a missing page.
 *
 * SS1 lists the brand's audio, plays it, and sends it to the editing studio or a video studio project. SS2 adds
 * music by description: the composer, its runs and their versions (§7.4).
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}): Promise<Metadata> {
  if (!brandStudioV2Open() || !brandSoundStudioOpen()) return {};
  const [{ organizationId }, { sql, viewer, verifiedEmail, dict }] = await Promise.all([searchParams, brandContext()]);
  if (!sql) return {};
  const { choice } = await brandScope({ sql, verifiedEmail }, viewer, organizationId);
  if (!soundStudioVisible(choice, true, true)) return {};
  return { title: dict.studioSound.title };
}

export default async function StudioSoundPage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[]; tab?: string | string[]; project?: string | string[] }>;
}) {
  const params = await searchParams;
  const { choice, access, locale, dict, deps, viewer } = await studioRouteContext(params.organizationId);
  if (!brandSoundStudioOpen()) notFound();
  if (!soundStudioVisible(choice, true, true)) notFound();
  try {
    await assertBrandFeature(deps.sql, choice.id, 'sound');
  } catch (error) {
    if (error instanceof BrandFeatureDenied) notFound();
    throw error;
  }

  const media = createStudioMediaStore();
  // `brandProjectId` on runs only for a member seen as themselves; staff browsing a brand get none.
  const member = memberSeesBrandProjects({ staff: access.staff, role: choice.role });
  const [data, spine] = await Promise.all([
    loadSoundStudio(deps.sql, media, studioEnv(), choice.id, viewer.userId ?? null, { member }),
    loadStudioSpine({
      sql: deps.sql,
      viewer,
      organizationId: choice.id,
      seat: { staff: access.staff, role: choice.role },
      queryProject: params.project,
    }),
  ]);
  const canCreate = !access.staff && (choice.role === 'owner' || choice.role === 'editor');

  const studio = (
    <SoundStudio
      organizationId={choice.id}
      organizationName={choice.name}
      locale={locale}
      copy={dict.studioSound}
      billingCopy={dict.brandBilling.customer}
      planCatalogue={billingPlanCatalogue()}
      initialTab={soundTabParam(params.tab)}
      creditsCopy={dict.brandStudio.credits}
      initialTracks={data.tracks}
      initialJobs={data.jobs}
      initialVideos={data.videos}
      initialAllowance={data.allowance}
      maxMode={studioEnv().soundMaxMode === true}
      canCreate={canCreate}
      audioMaxMb={Math.round(STUDIO_LIMITS.audioBytesMax / 1_000_000)}
      hrefs={{
        page: scopedHref('/brand/studio/sound', choice),
        compose: scopedHref('/brand/studio/compose', choice),
        video: scopedHref('/brand/studio/video', choice),
      }}
      {...(spine ? { spine, useFilmParam: true } : {})}
    />
  );

  return spine ? (
    <ProjectSpineProvider organizationId={choice.id} locale={locale} copy={dict.projectSpine} initial={spine}>
      {studio}
    </ProjectSpineProvider>
  ) : (
    studio
  );
}
