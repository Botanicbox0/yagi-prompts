import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StudioInquiry } from "@/components/brand-workspace/studio-inquiry";
import { ServiceGuide } from "@/components/brand-workspace/service-guide";
import { featureDenied, isSandboxedClientOrganization } from "@/lib/brands/features";
import {
  assetLibraryMode,
  identityStatusFor,
  needsLiveness,
} from "@/lib/identity/service";
import { brandContext } from "@/components/brand-workspace/context";
import { brandScope, membershipOf, selectedAccess } from "@/components/brand-workspace/scope";
import { BrandUnavailable } from "@/components/brand-workspace/brand-unavailable";
import { scopedHref, sectionVisibility } from "@/lib/brands/workspace/selection";
import { BrandBriefStudio } from "@/components/brand-workspace/brand-brief-studio";
import { ContractProduction } from "@/components/brand-studio/contract-production";
import { brandStudioV2 } from "@/components/brand-studio/v2-page";
import { brandStudioV2Open } from "@/lib/flags";
import { studioV2Visible } from "@/lib/brand-studio/visibility";
import { inferBrandCategoryFromWorkspace } from "@/lib/brands/category-experience";
import {
  confirmedIdentityFor,
  loadBrandIdentityWorkspace,
} from "@/lib/brands/identity/service";
import { loadProductionWorkspace } from "@/lib/brands/production/service";
import { loadBrandSupport } from "@/lib/brands/workspace/service";
import { studioRequestStatus, studioStage } from "@/lib/brands/production/stage";
import { formatBrandTimestamp } from "@/components/brand-workspace/format";
import { StaffNotice, adminOrganizationHref } from "@/components/brand-workspace/staff-notice";
import { StudioHelp, StudioIntro } from "@/components/brand-workspace/studio-onboarding";
import { currentSelfie } from "@/lib/identity/selfie-service";
import { getDictionary } from "@/lib/i18n/dictionaries";

/** Template requests are support messages headed in the sender's language; either heading counts. */
const REQUEST_TITLES = [getDictionary("ko"), getDictionary("en")].map((d) => d.brandWorkspace.studioInquiry.messageTitle);

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
  return { title: dict.brandStudio.title };
}

export default async function BrandStudio({
  searchParams,
}: {
  searchParams: Promise<{
    organizationId?: string | string[];
    projectId?: string | string[];
    track?: string | string[];
    scenario?: string | string[];
    mode?: string | string[];
    tab?: string | string[];
  }>;
}) {
  const [
    { organizationId, projectId, track, scenario, mode: queryMode, tab },
    { sql, viewer, verifiedEmail, brandHost, b, locale },
  ] = await Promise.all([searchParams, brandContext()]);
  const initialProjectId = Array.isArray(projectId) ? projectId[0] : projectId;
  const initialTrack = Array.isArray(track) ? track[0] : track;
  const initialScenario = Array.isArray(scenario) ? scenario[0] : scenario;
  const initialMode = Array.isArray(queryMode) ? queryMode[0] : queryMode;
  if (!sql) return <p role="alert">{b.unavailable}</p>;
  const { selection, choice, projectOrganizations } = await brandScope({ sql, verifiedEmail }, viewer, organizationId);
  if (selection.state === "unavailable") return <BrandUnavailable b={b} />;
  // A brand whose policy closes generative media (or is a sandboxed client) has no studio: not a notice, no page at all.
  if (choice && (isSandboxedClientOrganization(choice) || featureDenied(choice.denied, "generative_media"))) notFound();
  // Role and requests follow the SELECTED brand only. A guest brand has no membership here.
  const organizations = membershipOf(choice),
    access = selectedAccess(choice, Object.values(projectOrganizations).filter((o) => o === choice?.id)),
    orgId = organizations[0]?.id,
    t = b.productionStudio,
    o = t.onboarding;
  // Campaign-only invitees reach this page only by typing the address: no onboarding, no creation.
  if (access.projectScopedOnly)
    return (
      <div data-brand-production data-brand-studio-unavailable>
        <div className="bw-heading">
          <div>
            <p className="bw-kicker">{t.eyebrow}</p>
            <h1>{t.title}</h1>
            <p>{t.subtitle}</p>
          </div>
        </div>
        <section className="bw-empty">
          <p>{b.access.studioSharedOnly}</p>
          <a href={scopedHref("/brand", choice)} className="bw-button">{b.back}</a>
        </section>
      </div>
    );
  // Studio v2 (docs/BRAND-STUDIO-V2.md §5.2): behind its flag, and never for a sandboxed or generation-closed brand.
  if (choice && brandStudioV2Open() && studioV2Visible(choice, true))
    return brandStudioV2({ deps: { sql, verifiedEmail }, viewer, choice, access, locale, brandHost, tab, mode: queryMode });
  // The TWINGS team reads the brand's templates, remaining count and history; it never generates here.
  const staffOrgId = access.staff ? choice?.id : undefined;
  const historyOrg = orgId ?? staffOrgId;
  const production = historyOrg
    ? await loadProductionWorkspace({ sql, verifiedEmail }, viewer, historyOrg)
    : null;
  const contracts = production?.contracts ?? [];
  // Before any contract, a template request already sent changes what the brand should do next.
  const support = !contracts.length && orgId ? await loadBrandSupport({ sql, verifiedEmail }, viewer, orgId) : null;
  const request = support ? studioRequestStatus(support, REQUEST_TITLES) : null;
  const canRequest = !access.staff && (access.canRequest || access.fresh);
  const stage = studioStage({ contracts, canRequest, request });
  // Viewers see templates and history; creating (and so the face setup) is for admins and editors.
  const canCreate = !access.staff && production?.role !== "viewer";
  // The face is asked for only once there is a template to use it with.
  const hasTemplates = contracts.some((c) => c.templates.length > 0);
  const [confirmedIdentity, identityWorkspace] = await Promise.all([
    hasTemplates && historyOrg
      ? confirmedIdentityFor(sql, historyOrg).catch(() => null)
      : Promise.resolve(null),
    hasTemplates && historyOrg
      ? loadBrandIdentityWorkspace(sql, historyOrg).catch(() => null)
      : Promise.resolve(null),
  ]);
  const activeIdentity =
    confirmedIdentity ?? identityWorkspace?.identity?.identity ?? null;
  const brandCategory = inferBrandCategoryFromWorkspace({
    organizationName: choice?.name,
    checklist: activeIdentity?.productChecklist,
    memoryPayloads: identityWorkspace?.memory.map((m) => m.payload),
  });
  const selfie = hasTemplates ? (await currentSelfie(sql, viewer.userId!))?.id ?? null : null;
  const mode = assetLibraryMode();
  const verifyRequired =
    !!selfie &&
    needsLiveness("seedance-2.5", mode) &&
    (await identityStatusFor(sql, viewer.userId!, mode)) !== "active";

  // No contract yet (and not the TWINGS team): the explanation and the request are the page.
  const explaining = !contracts.length && !access.staff;
  const inquiry = (
    // Renders nothing for accounts that cannot send a request (viewer-only, TWINGS team view).
    <StudioInquiry
      organizations={organizations}
      organizationId={orgId}
      b={b}
      allowSetup={access.fresh}
      label={stage === "onboarding" ? undefined : b.studioInquiry.actionMore}
      primary={stage === "onboarding" || stage === "used-up"}
    />
  );
  const guide = <ServiceGuide kind="studio" b={b} showOther={access.canRequest || access.fresh} organizationId={choice?.id} />;
  return (
    <div data-brand-production data-studio-stage={stage}>
      {historyOrg && (
        <BrandBriefStudio
          organizationId={historyOrg}
          organizationName={choice?.name}
          initialCategory={brandCategory}
          locale={locale}
          canWrite={canCreate || Boolean(viewer.isAdmin) || Boolean(choice && choice.role !== "guest")}
          identityConfirmed={Boolean(
            confirmedIdentity ||
              identityWorkspace?.identity?.status === "confirmed",
          )}
          defaultChecklist={activeIdentity?.productChecklist}
          identityHref={undefined}
          initialProjectId={initialProjectId}
          initialTrack={initialTrack}
          initialScenario={initialScenario}
          initialMode={initialMode}
        />
      )}
      <div hidden={Boolean(historyOrg)} style={historyOrg ? { display: "none" } : undefined}>
      <details className="bw-service-disclosure" style={{ marginTop: "12px" }}>
        <summary>
          {locale === "ko"
            ? "전용 인물 템플릿 의뢰 · 계약 제작 내역 열기"
            : "Custom Portrait Templates & Contract History"}
        </summary>
        <div style={{ marginTop: "12px" }}>
          <div className={explaining ? "bw-heading bw-studio-hero" : "bw-heading"}>
            <div>
              <p className="bw-kicker">{t.eyebrow}</p>
              <h1>{t.title}</h1>
              {explaining ? (
                <>
                  <p className="bw-studio-lead">{o.lead}</p>
                  {stage === "onboarding" && <p>{o.next}</p>}
                </>
              ) : (
                <p>{t.subtitle}</p>
              )}
            </div>
            {stage === "onboarding" ? (
              <div className="bw-studio-hero-action" data-studio-onboarding>
                {inquiry}
                <p className="bw-muted">{o.noCommitment}</p>
              </div>
            ) : (
              inquiry
            )}
          </div>
          {access.staff && choice && <StaffNotice b={b} manageHref={viewer.isAdmin ? adminOrganizationHref(choice.id, brandHost) : null} />}
          {stage === "requested" && request && (
            <section className="bw-note bw-studio-status" data-studio-request={request.answered ? "answered" : "waiting"}>
              <h2>{request.answered ? o.answeredTitle : o.requestedTitle}</h2>
              <p>{request.answered ? o.answeredBody : o.requestedBody.replace("{date}", formatBrandTimestamp(request.sentAt, locale) ?? "")}</p>
            </section>
          )}
          {stage === "read-only" && (
            // The request invitation would point at a button a viewer does not have.
            <section className="bw-note bw-studio-status" data-brand-studio-read-only>
              <h2>{b.access.studioViewerTitle}</h2>
              <p>{b.access.studioViewer}</p>
            </section>
          )}
          {stage === "templates-pending" && (
            <section className="bw-note bw-studio-status" data-studio-templates-pending>
              <h2>{o.templatesPendingTitle}</h2>
              <p>{o.templatesPendingBody}</p>
            </section>
          )}
          {stage === "used-up" && (
            <section className="bw-note bw-studio-status" data-studio-used-up>
              <h2>{o.usedUpTitle}</h2>
              <p>{canRequest ? o.usedUpBody : o.usedUpReadOnly}</p>
            </section>
          )}
          {explaining ? (
            <details className="bw-service-disclosure">
              <summary>{o.helpSummary}</summary>
              <StudioIntro t={o} stage={stage} guide={guide} />
            </details>
          ) : (
            <StudioHelp t={o} stage={stage} guide={guide} />
          )}
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
            o={o}
          />
        </div>
      </details>
      </div>
    </div>
  );
}
