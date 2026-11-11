import type { Metadata } from "next";
import { brandContext } from "@/components/brand-workspace/context";
import { brandScope } from "@/components/brand-workspace/scope";
import { Explainer, type ExplainerAction } from "@/components/brand-studio/explainer";
import { studioRouteContext } from "@/components/brand-studio/route-context";
import { STUDIO_OPEN_REVERSE } from "@/components/brand-studio/seams";
import { StudioApp } from "@/components/brand-studio/studio-app";
import { studioV2Visible } from "@/lib/brand-studio/visibility";
import { VIDEO_INTRO_KEY } from "@/components/brand-studio/video/anchors";
import { CampaignPath } from "@/components/brand-studio/video/campaign-path";
import { hasProductionContracts } from "@/components/brand-studio/video/contracts-link";
import { VideoRequests } from "@/components/brand-studio/video/requests";
import { ReversePanel } from "@/components/brand-studio/video/reverse";
import { fillText, reverseModel } from "@/components/brand-studio/video/reverse-model";
import { VideoStarts } from "@/components/brand-studio/video/starts";
import s from "@/components/brand-studio/video/video.module.css";
import { scopedHref } from "@/lib/brands/workspace/selection";
import { brandStudioV2Open } from "@/lib/flags";

/**
 * `/brand/studio/video` — the video screen (docs/BRAND-STUDIO-V3.md §6), in two views.
 * 만들기 (default): three ways to start, the video gallery and prompt bar, the reference-video drawer
 * (blueprint remakes). 제작 의뢰 (`?view=request`): the road from a video to a campaign on twings.app and
 * the three production requests. They are separate views because the prompt bar floats over the page
 * and would cover the request cards on one long page.
 *
 * The route context is the whole gate and runs first: a sandboxed client, a brand whose policy closes
 * generation, a campaign-only invitee and a deployment with the flag off all get a 404 before anything
 * below is read. `?start=reverse` opens the drawer on arrival (`&asset=<id>` picks the clip).
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
  if (!choice || !studioV2Visible(choice, true)) return {};
  return { title: dict.studioVideo.title };
}

export default async function StudioVideoPage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[]; start?: string | string[]; asset?: string | string[]; view?: string | string[] }>;
}) {
  const params = await searchParams;
  const ctx = await studioRouteContext(params.organizationId);
  const { choice, access, locale, dict } = ctx;
  const t = dict.studioVideo;
  // Owners and editors send briefs and campaigns; viewers and the TWINGS team read.
  const canRequest = !access.staff && access.canRequest;
  const contracts = await hasProductionContracts(ctx.deps.sql, choice.id);
  const model = reverseModel();
  const asset = first(params.asset);
  const limits = { min: model.referenceVideoSeconds.min, max: model.referenceVideoSeconds.max };
  const opensReverse = first(params.start) === "reverse";
  const view = first(params.view) === "request" && !opensReverse ? "request" : "make";
  const requestHref = scopedHref("/brand/studio/video?view=request", choice);
  const views = [
    { key: "make" as const, href: scopedHref("/brand/studio/video", choice), label: t.views.make },
    { key: "request" as const, href: requestHref, label: t.views.request },
  ];
  const actions: ExplainerAction[] = [
    { label: t.intro.reverse, event: STUDIO_OPEN_REVERSE, primary: true },
    ...(canRequest ? [{ label: t.intro.request, href: requestHref }] : []),
  ];
  const contractsLink = contracts && (
    <a className={s.contracts} href={scopedHref("/brand/studio?tab=formats", choice)} data-studio-video-contracts>
      {t.contracts}
    </a>
  );

  return (
    <div className={`bs-page ${s.page}`} data-brand-studio-v2 data-brand-studio-video data-studio-video-view={view}>
      <header className={`bs-head ${s.head}`}>
        <h1 className="bs-title">{t.title}</h1>
        <nav className={s.views} aria-label={t.views.label}>
          {views.map((v) => (
            <a key={v.key} className={s.view} href={v.href} aria-current={view === v.key ? "page" : undefined} data-studio-video-view-link={v.key}>
              {v.label}
            </a>
          ))}
        </nav>
        <div className="bs-head-end">
          {/* The phone's library button is placed here by the studio (studio-app.tsx). */}
          {view === "make" && <div className="bs-head-slot" data-studio-head-slot />}
        </div>
      </header>
      {view === "make" ? (
        <>
          <Explainer
            storageKey={VIDEO_INTRO_KEY}
            title={t.intro.title}
            line={t.intro.line}
            actions={actions}
            stepsTitle={t.intro.stepsTitle}
            steps={t.intro.steps.map((step) => ({ title: step.title, line: fillText(step.line, limits) }))}
            dismissLabel={t.intro.dismiss}
            reopenLabel={t.intro.reopen}
          />
          <VideoStarts t={t} requestHref={canRequest ? requestHref : null} />
          <div data-studio-video-gallery>
            <StudioApp
              organizationId={choice.id}
              locale={locale}
              copy={dict.brandStudio}
              mode="video"
              libraryCopy={dict.studioLibrary}
              layersCopy={dict.studioLayers}
              videoCopy={t}
            />
          </div>
          {contractsLink}
          <ReversePanel
            organizationId={choice.id}
            locale={locale}
            copy={dict.brandStudio}
            video={t}
            initialOpen={opensReverse}
            initialAssetId={asset && UUID.test(asset) ? asset : null}
          />
        </>
      ) : (
        <>
          <CampaignPath organizationId={choice.id} locale={locale} copy={dict.brandStudio} video={t} canSend={canRequest} />
          {canRequest && <VideoRequests t={t} choice={choice} locale={locale} />}
          {contractsLink}
        </>
      )}
    </div>
  );
}
