import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { brandContext } from "@/components/brand-workspace/context";
import { brandScope } from "@/components/brand-workspace/scope";
import { studioRouteOrShowroom } from "@/components/brand-studio/route-context";
import { StudioShowroom } from "@/components/brand-studio/studio-showroom";
import { studioShowroomVisible, studioV2Visible } from "@/lib/brand-studio/visibility";
import { hasProductionContracts } from "@/components/brand-studio/video/contracts-link";
import { studioEnv } from "@/lib/brand-studio/env";
import { createStudioMediaStore } from "@/lib/brand-studio/media-store";
import {
  resolveVideoPageSpine,
  resolveVideoStudioAddress,
  scopeOfOpenProject,
  searchParamEntries,
  type StudioSpineProps,
  type VideoStudioFilmLookup,
} from "@/lib/brand-studio/open-project";
import { includeSelectableProjectForFilm, loadStudioSpine } from "@/lib/brand-studio/open-project-server";
import { studioRuntimeDeps } from "@/lib/brand-studio/runtime";
import { loadStudioState } from "@/lib/brand-studio/service";
import { loadVideoProjects, type VideoProjectDetail, type VideoProjectSummary } from "@/lib/brand-studio/video-projects";
import type { StudioState } from "@/lib/brand-studio/contracts";
import { billingPlanCatalogue } from "@/lib/brands/billing-page-data";
import { ProjectChip, ProjectGoneNotice, ProjectSpineProvider } from "@/components/brand-studio/project-chip";
// Imported here, not through the client module: a server component cannot read a class map a client module exports.
import projectChipStyles from "@/components/brand-studio/project-chip/project-chip.module.css";
import { WorkspaceBell } from "@/components/brand-workspace/bell";
import { pickSendCopy, type ViewerSendProp } from "@/components/brand-send/model";
import { brandSendOpenFor, brandSendSwitchesOn } from "@/lib/brand-rooms/members-channel";
import { brandSendInviteOpenFor } from "@/lib/brand-rooms/send-invite";
import { memberSeesBrandProjects } from "@/lib/brand-studio/brand-projects";
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
    film?: string | string[];
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
  const filmParam = first(params.film);
  const opensEdit = !opensReverse && (first(params.tab) === "edit" || first(params.start) === "edit");

  const spine = await loadStudioSpine({
    sql: ctx.deps.sql,
    viewer: ctx.viewer,
    organizationId: choice.id,
    seat: { staff: access.staff, role: choice.role },
    queryProject: params.project,
  });

  let effectiveSpine: StudioSpineProps | null = null;
  let initialState: StudioState | null | undefined;
  let initialProjects: VideoProjectSummary[] | undefined;
  let initialProjectDetail: VideoProjectDetail | null | undefined;
  let initialProjectId = projectParam && UUID.test(projectParam) ? projectParam : null;

  if (spine) {
    const media = createStudioMediaStore();
    let validFilmId = filmParam && UUID.test(filmParam) ? filmParam : null;
    let filmListFailed = false;
    let films: VideoProjectSummary[] = [];
    let openedFilm: VideoProjectDetail | null = null;

    // G1: `loadVideoProjects(..., filmId)` answers `not_found` for the WHOLE call when `filmId` is stale.
    // Recover by reloading the list without `filmId` and treating the film as absent.
    try {
      const firstLoad = await loadVideoProjects({ sql: ctx.deps.sql, media }, ctx.viewer, choice.id, validFilmId);
      if (firstLoad.ok) {
        films = firstLoad.projects;
        openedFilm = firstLoad.project;
      } else if (validFilmId && firstLoad.code === "not_found") {
        validFilmId = null;
        const retryList = await loadVideoProjects({ sql: ctx.deps.sql, media }, ctx.viewer, choice.id, null);
        if (retryList.ok) {
          films = retryList.projects;
        } else {
          filmListFailed = true;
        }
      } else {
        filmListFailed = true;
      }
    } catch {
      filmListFailed = true;
    }

    // G2: When `?project=` is a UUID not in `spine.projects` and not in the first-100 `films` list,
    // ask once for that specific film id so older films still redirect to `?film=<id>`.
    const trimmedProject = projectParam?.trim() ?? "";
    const inBrandProjects =
      Boolean(trimmedProject) && spine.projects.some((p) => p.id.toLowerCase() === trimmedProject.toLowerCase());
    const inFilmList =
      Boolean(trimmedProject) && films.some((f) => f.id.toLowerCase() === trimmedProject.toLowerCase());
    let filmLookup: VideoStudioFilmLookup | undefined;
    if (!filmListFailed && trimmedProject && UUID.test(trimmedProject) && !inBrandProjects && !inFilmList) {
      try {
        const single = await loadVideoProjects({ sql: ctx.deps.sql, media }, ctx.viewer, choice.id, trimmedProject);
        if (single.ok && single.project) filmLookup = "found";
        else if (!single.ok && single.code === "not_found") filmLookup = "not_found";
        else filmLookup = "error";
      } catch {
        filmLookup = "error";
      }
    }

    // §4.5, G1, G2: disambiguate `?project=` cleanly.
    const decision = resolveVideoStudioAddress({
      pathname: "/brand/studio/video",
      searchParams: searchParamEntries(params),
      projectIds: spine.projects.map((p) => p.id),
      filmIds: films.map((f) => f.id),
      filmLookup,
      filmListFailed,
    });
    if (decision.kind === "redirect_film") {
      redirect(decision.href);
      return null;
    }

    const spineWithFilm =
      openedFilm?.brandProjectId
        ? await includeSelectableProjectForFilm({
            sql: ctx.deps.sql,
            viewer: ctx.viewer,
            organizationId: choice.id,
            seat: { staff: access.staff, role: choice.role },
            spine,
            projectId: openedFilm.brandProjectId,
          }).catch(() => spine)
        : spine;

    effectiveSpine = resolveVideoPageSpine({
      spine: spineWithFilm,
      decision,
      openedFilm,
      hadQueryProject: Boolean(trimmedProject),
    });

    const loadedState = await loadStudioState(await studioRuntimeDeps(ctx.deps.sql), ctx.viewer, choice.id, {
      scope: scopeOfOpenProject(effectiveSpine.open),
    }).catch(() => null);
    initialState = loadedState && loadedState.ok ? loadedState : null;
    initialProjects = films;
    initialProjectDetail = openedFilm;
    initialProjectId = validFilmId;
  }

  const sendBase: ViewerSendProp | null =
    effectiveSpine &&
    brandSendSwitchesOn() &&
    memberSeesBrandProjects({ staff: access.staff, role: choice.role }) &&
    (await brandSendOpenFor(ctx.deps.sql, choice.id).catch(() => false))
      ? { organizationId: choice.id, copy: pickSendCopy(dict) }
      : null;
  const send: ViewerSendProp | null =
    sendBase && (await brandSendInviteOpenFor(ctx.deps.sql, choice.id).catch(() => false))
      ? { ...sendBase, invite: true }
      : sendBase;

  const title = <h1 className="bs-title">{t.title}</h1>;
  const page = (
    <div className={`bs-page ${s.page}`} data-brand-studio-v2 data-brand-studio-video>
      <header className={`bs-head ${s.head}`}>
        {effectiveSpine ? (
          <div className={projectChipStyles.titleGroup}>
            {title}
            <ProjectChip />
          </div>
        ) : (
          title
        )}
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
          <WorkspaceBell />
        </div>
      </header>
      {effectiveSpine ? <ProjectGoneNotice /> : null}
      <VideoStudioWorkspace
        organizationId={choice.id}
        organizationName={choice.name}
        locale={locale}
        copy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        videoCopy={t}
        billingCopy={dict.brandBilling.customer}
        planCatalogue={billingPlanCatalogue()}
        initialTab={opensEdit ? "edit" : "create"}
        initialCreateMode={opensReverse ? "blueprint" : "prompt"}
        initialAssetId={asset && UUID.test(asset) ? asset : null}
        initialProjectId={initialProjectId}
        {...(effectiveSpine
          ? {
              initialState,
              initialProjects,
              initialProjectDetail,
              spine: effectiveSpine,
              spineCopy: dict.projectSpine,
            }
          : {})}
        {...(send ? { send } : {})}
        musicGeneration={studioEnv().musicGeneration === true}
      />
    </div>
  );

  return effectiveSpine ? (
    <ProjectSpineProvider organizationId={choice.id} locale={locale} copy={dict.projectSpine} initial={effectiveSpine}>
      {page}
    </ProjectSpineProvider>
  ) : (
    page
  );
}
