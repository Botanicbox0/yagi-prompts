import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { brandContext } from "@/components/brand-workspace/context";
import { brandScope } from "@/components/brand-workspace/scope";
import { studioRouteOrShowroom } from "@/components/brand-studio/route-context";
import { StudioShowroom } from "@/components/brand-studio/studio-showroom";
import { studioShowroomVisible, studioV2Visible } from "@/lib/brand-studio/visibility";
import { hasProductionContracts } from "@/components/brand-studio/video/contracts-link";
import { studioEnv } from "@/lib/brand-studio/env";
import { VideoStudioWorkspace } from "@/components/brand-studio/video/workspace";
import s from "@/components/brand-studio/video/video.module.css";
import { scopedHref } from "@/lib/brands/workspace/selection";
import { brandStudioV2Open } from "@/lib/flags";

/**
 * `/brand/studio/video` — Unified Video Studio Workspace (Studio Pro Suite v4, docs/STUDIO-PRO-SUITE-V4.md):
 *   - Full-canvas video gallery wall (`기록`) or 3-step `16:9` looping video guide (`가이드`).
 *   - Bottom floating capsule prompt dock (`<Dock mode="video" ... />`) with unified Seedance 2.5 routing,
 *     `@` multimodal reference autocomplete, AI Director multi-clip planner, and `ClipTrimModal`.
 *   - Right-hand `LibraryRail` (`폴더 / 좋아요 / 업로드`).
 *   - Legacy `?view=request` redirects to `/brand/projects/new`.
 *
 * `studioRouteContext` runs first: sandboxed clients (Morphic/모픽), brands whose policy closes generation,
 * campaign-only invitees, and deployments with the flag off all get a 404 before anything renders.
 */
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

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
  return { title: dict.studioVideo.title };
}

export default async function StudioVideoPage({
  searchParams,
}: {
  searchParams: Promise<{
    organizationId?: string | string[];
    start?: string | string[];
    asset?: string | string[];
    view?: string | string[];
    tab?: string | string[];
    project?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const ctx = await studioRouteOrShowroom(params.organizationId);
  const { choice, access, locale, dict } = ctx;
  if (ctx.kind === "showroom") {
    return (
      <StudioShowroom
        focus="video"
        organizationId={choice.id}
        organizationName={choice.name}
        canRequest={!access.staff && access.canRequest}
        imageHref={scopedHref("/brand/studio", choice)}
        videoHref={scopedHref("/brand/studio/video", choice)}
        projectSpaceHref={scopedHref("/brand", choice)}
        newBriefHref={scopedHref("/brand/projects/new", choice)}
        copy={dict.studioShell.showroom}
      />
    );
  }
  const t = dict.studioVideo;
  const opensReverse = first(params.start) === "reverse";
  if (first(params.view) === "request" && !opensReverse) {
    redirect(scopedHref("/brand/projects/new", choice));
    return null;
  }

  // Owners and editors send briefs and campaigns; viewers and the TWINGS team read.
  const canRequest = !access.staff && access.canRequest;
  const contracts = await hasProductionContracts(ctx.deps.sql, choice.id);
  const asset = first(params.asset);
  const projectParam = first(params.project);
  const opensEdit = !opensReverse && (first(params.tab) === "edit" || first(params.start) === "edit");

  return (
    <div className={`bs-page ${s.page}`} data-brand-studio-v2 data-brand-studio-video>
      <header className={`bs-head ${s.head}`}>
        <h1 className="bs-title">{t.title}</h1>
        <div className={s.headEnd}>
          {contracts && (
            <a className={s.contracts} href={scopedHref("/brand/studio?tab=formats", choice)} data-studio-video-contracts>
              {t.contracts}
            </a>
          )}
          <a
            className="bs-btn"
            data-variant="soft"
            data-size="sm"
            href={scopedHref("/brand/studio/compose", choice)}
            data-studio-video-compose-link
          >
            {t.views.compose}
          </a>
          {canRequest && (
            <a
              className="bs-btn"
              data-variant="soft"
              data-size="sm"
              href={scopedHref("/brand/projects/new", choice)}
              data-studio-video-request-link
            >
              {t.workspace.requestAction}
            </a>
          )}
          {/* Allowance line and mobile asset toggle are placed here by VideoStudioWorkspace. */}
          <div className="bs-head-slot" data-studio-head-slot />
        </div>
      </header>
      <VideoStudioWorkspace
        organizationId={choice.id}
        organizationName={choice.name}
        locale={locale}
        copy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        videoCopy={t}
        initialTab={opensEdit ? "edit" : "create"}
        initialCreateMode={opensReverse ? "blueprint" : "prompt"}
        initialAssetId={asset && UUID.test(asset) ? asset : null}
        initialProjectId={projectParam && UUID.test(projectParam) ? projectParam : null}
        musicGeneration={studioEnv().musicGeneration === true}
      />
    </div>
  );
}
