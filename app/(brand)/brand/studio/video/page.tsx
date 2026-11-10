import { Explainer, type ExplainerAction } from "@/components/brand-studio/explainer";
import { studioRouteContext } from "@/components/brand-studio/route-context";
import { STUDIO_OPEN_REVERSE } from "@/components/brand-studio/seams";
import { StudioApp } from "@/components/brand-studio/studio-app";
import { VIDEO_INTRO_KEY, VIDEO_REQUESTS_ANCHOR } from "@/components/brand-studio/video/anchors";
import { CampaignPath } from "@/components/brand-studio/video/campaign-path";
import { hasProductionContracts } from "@/components/brand-studio/video/contracts-link";
import { VideoRequests } from "@/components/brand-studio/video/requests";
import { ReversePanel } from "@/components/brand-studio/video/reverse";
import { fillText, reverseModel } from "@/components/brand-studio/video/reverse-model";
import { VideoStarts } from "@/components/brand-studio/video/starts";
import s from "@/components/brand-studio/video/video.module.css";
import { scopedHref } from "@/lib/brands/workspace/selection";

/**
 * `/brand/studio/video` — the video screen (docs/BRAND-STUDIO-V3.md §6): three ways to start, the video
 * gallery and prompt bar, the reference-video drawer (blueprint remakes), the road from a video to a
 * campaign on twings.app, and the three production requests.
 *
 * The route context is the whole gate and runs first: a sandboxed client, a brand whose policy closes
 * generation, a campaign-only invitee and a deployment with the flag off all get a 404 before anything
 * below is read. `?start=reverse` opens the drawer on arrival (`&asset=<id>` picks the clip).
 */
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function StudioVideoPage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[]; start?: string | string[]; asset?: string | string[] }>;
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
  const actions: ExplainerAction[] = [
    { label: t.intro.reverse, event: STUDIO_OPEN_REVERSE, primary: true },
    ...(canRequest ? [{ label: t.intro.request, href: `#${VIDEO_REQUESTS_ANCHOR}` }] : []),
  ];

  return (
    <div className={`bs-page ${s.page}`} data-brand-studio-v2 data-brand-studio-video>
      <header className={`bs-head ${s.head}`}>
        <h1 className="bs-title">{t.title}</h1>
        <div className="bs-head-end">
          {/* The phone's library button is placed here by the studio (studio-app.tsx). */}
          <div className="bs-head-slot" data-studio-head-slot />
        </div>
      </header>
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
      <VideoStarts t={t} requests={canRequest} />
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
      <CampaignPath organizationId={choice.id} locale={locale} copy={dict.brandStudio} video={t} canSend={canRequest} />
      {canRequest && <VideoRequests t={t} choice={choice} locale={locale} />}
      {contracts && (
        <a className={s.contracts} href={scopedHref("/brand/studio?tab=formats", choice)} data-studio-video-contracts>
          {t.contracts}
        </a>
      )}
      <ReversePanel
        organizationId={choice.id}
        locale={locale}
        copy={dict.brandStudio}
        video={t}
        initialOpen={first(params.start) === "reverse"}
        initialAssetId={asset && UUID.test(asset) ? asset : null}
      />
    </div>
  );
}
