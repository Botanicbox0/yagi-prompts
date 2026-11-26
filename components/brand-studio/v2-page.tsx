/**
 * `/brand/studio` when studio v2 is open for the selected brand (docs/BRAND-STUDIO-V3.md §2, §4): the
 * image screen. There is no tab bar any more: video lives at `/brand/studio/video` (an old
 * `?mode=video` link is sent there) and the review room at `/brand/studio/review`. `?tab=formats`
 * still opens the contract templates, but only for an organization that has a contract; that screen is
 * the personal render rail and keeps its own-face checks exactly as they are.
 *
 * The page calls this only after its sandbox/denied `notFound()` and only when
 * `brandStudioV2Open() && studioV2Visible(choice, true)`. All data is awaited here so the tree that
 * comes back is plain markup plus one client island.
 */
import { brandStudioProjectsOpen } from "@/lib/flags";
import type { ReactElement } from "react";
import { redirect } from "next/navigation";
import type { Viewer } from "@/lib/auth/identity";
import type { SqlRunner } from "@/lib/db/sql-runner";
import type { selectedAccess } from "@/components/brand-workspace/scope";
import { membershipOf } from "@/components/brand-workspace/scope";
import { assetLibraryMode, identityStatusFor, needsLiveness } from "@/lib/identity/service";
import { currentSelfie } from "@/lib/identity/selfie-service";
import { loadProductionWorkspace } from "@/lib/brands/production/service";
import { studioStage } from "@/lib/brands/production/stage";
import { scopedHref, type BrandWorkspaceChoice } from "@/lib/brands/workspace/selection";
import { scopeOfOpenProject } from "@/lib/brand-studio/open-project";
import { loadStudioSpine } from "@/lib/brand-studio/open-project-server";
import { studioRuntimeDeps } from "@/lib/brand-studio/runtime";
import { loadStudioState } from "@/lib/brand-studio/service";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { billingPlanCatalogue } from "@/lib/brands/billing-page-data";
import { ContractProduction } from "./contract-production";
import type { StudioLocale } from "./copy";
import { ProjectChip, ProjectGoneNotice, ProjectSpineProvider } from "./project-chip";
// Imported here, not through the client module: a server component cannot read a class map a client module exports.
import projectChipStyles from "./project-chip/project-chip.module.css";
import { WorkspaceBell } from "@/components/brand-workspace/bell";
import { pickSendCopy, type ViewerSendProp } from "@/components/brand-send/model";
import { brandSendOpenFor, brandSendSwitchesOn } from "@/lib/brand-rooms/members-channel";
import { memberSeesBrandProjects } from "@/lib/brand-studio/brand-projects";
import { StudioApp } from "./studio-app";

export type StudioTab = "create" | "formats";
export const studioTab = (value: string | string[] | undefined): StudioTab =>
  (Array.isArray(value) ? value[0] : value) === "formats" ? "formats" : "create";

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export interface StudioV2Input {
  deps: { sql: SqlRunner; verifiedEmail?: string };
  viewer: Viewer;
  choice: BrandWorkspaceChoice;
  access: ReturnType<typeof selectedAccess>;
  locale: StudioLocale;
  brandHost: boolean;
  tab: string | string[] | undefined;
  mode: string | string[] | undefined;
  project?: string | string[] | undefined;
}

export async function brandStudioV2(input: StudioV2Input): Promise<ReactElement> {
  const { choice, locale } = input;
  // The video screen has its own address now; old links land there.
  if (first(input.mode) === "video") redirect(scopedHref("/brand/studio/video", choice));
  const dict = getDictionary(locale);
  const copy = dict.brandStudio;
  if (studioTab(input.tab) === "formats") {
    const formats = await formatsTab(input);
    // Without a contract there is nothing on that screen: the image screen is the studio.
    if (!formats) redirect(scopedHref("/brand/studio", choice));
    return (
      <div className="bs-page" data-brand-studio-v2 data-studio-tab="formats">
        <header className="bs-head">
          <h1 className="bs-title">{copy.formats.title}</h1>
          <a className="bs-btn" data-variant="ghost" data-size="sm" href={scopedHref("/brand/studio", choice)} data-studio-back>
            {copy.formats.back}
          </a>
          <WorkspaceBell />
        </header>
        {formats}
      </div>
    );
  }
  const spine = await loadStudioSpine({
    sql: input.deps.sql,
    viewer: input.viewer,
    organizationId: choice.id,
    seat: { staff: input.access.staff, role: choice.role },
    queryProject: input.project,
  });
  const initialState = spine
    ? await loadStudioState(await studioRuntimeDeps(input.deps.sql), input.viewer, choice.id, {
        scope: scopeOfOpenProject(spine.open),
      })
        .then((loaded) => (loaded.ok ? loaded : null))
        .catch(() => null)
    : undefined;
  const send: ViewerSendProp | null =
    spine &&
    brandSendSwitchesOn() &&
    memberSeesBrandProjects({ staff: input.access.staff, role: choice.role }) &&
    (await brandSendOpenFor(input.deps.sql, choice.id).catch(() => false))
      ? { organizationId: choice.id, copy: pickSendCopy(dict) }
      : null;

  const title = <h1 className="bs-title">{copy.title}</h1>;
  const page = (
    <div className="bs-page" data-brand-studio-v2 data-studio-tab="create" data-studio-screen="image">
      <header className="bs-head">
        {spine ? (
          <div className={projectChipStyles.titleGroup}>
            {title}
            <ProjectChip />
          </div>
        ) : (
          title
        )}
        {/* The credits line and the phone's library button are placed here by the studio (studio-app.tsx). */}
        <div className="bs-head-slot" data-studio-head-slot />
        <WorkspaceBell />
      </header>
      {spine ? <ProjectGoneNotice /> : null}
      <StudioApp
        organizationId={choice.id}
        organizationName={choice.name}
        locale={locale}
        copy={copy}
        billingCopy={dict.brandBilling.customer}
        planCatalogue={billingPlanCatalogue()}
        mode="image"
        libraryCopy={dict.studioLibrary}
        {...(!spine && brandStudioProjectsOpen() ? { projectsCopy: dict.studioVideo.workspace.projects } : {})}
        layersCopy={dict.studioLayers}
        {...(spine ? { initialState, spine } : {})}
        {...(send ? { send } : {})}
      />
    </div>
  );

  return spine ? (
    <ProjectSpineProvider organizationId={choice.id} locale={locale} copy={dict.projectSpine} initial={spine}>
      {page}
    </ProjectSpineProvider>
  ) : (
    page
  );
}

/** The contract templates (unchanged personal render rail), or null when the organization has no contract. */
async function formatsTab({ deps, viewer, choice, access, locale, brandHost }: StudioV2Input): Promise<ReactElement | null> {
  const dict = getDictionary(locale);
  const t = dict.brandWorkspace.productionStudio;
  const orgId = membershipOf(choice)[0]?.id;
  const historyOrg = orgId ?? (access.staff ? choice.id : undefined);
  const production = historyOrg ? await loadProductionWorkspace(deps, viewer, historyOrg) : null;
  const contracts = production?.contracts ?? [];
  if (!contracts.length) return null;
  const canRequest = !access.staff && (access.canRequest || access.fresh);
  const stage = studioStage({ contracts, canRequest, request: null });
  const canCreate = !access.staff && production?.role !== "viewer";
  const hasTemplates = contracts.some((c) => c.templates.length > 0);
  const selfie = hasTemplates ? ((await currentSelfie(deps.sql, viewer.userId!))?.id ?? null) : null;
  const libraryMode = assetLibraryMode();
  const verifyRequired =
    !!selfie && needsLiveness("seedance-2.5", libraryMode) && (await identityStatusFor(deps.sql, viewer.userId!, libraryMode)) !== "active";
  return (
    <section className="bs-formats" data-studio-formats="contracts">
      <ContractProduction
        production={production}
        contracts={contracts}
        stage={stage}
        canCreate={canCreate}
        staff={access.staff}
        verifyRequired={verifyRequired}
        selfie={selfie}
        orgId={orgId}
        historyOrg={historyOrg}
        locale={locale}
        brandHost={brandHost}
        t={t}
        o={t.onboarding}
      />
    </section>
  );
}
