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
import { ProductionCreate } from "@/components/brand-workspace/production-create";
import { BrandBriefStudio } from "@/components/brand-workspace/brand-brief-studio";
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
import { studioIdentityHref } from "@/lib/brands/workspace/links";
import { currentSelfie } from "@/lib/identity/selfie-service";
import { getDictionary } from "@/lib/i18n/dictionaries";

/** Template requests are support messages headed in the sender's language; either heading counts. */
const REQUEST_TITLES = [getDictionary("ko"), getDictionary("en")].map((d) => d.brandWorkspace.studioInquiry.messageTitle);

export default async function BrandStudio({
  searchParams,
}: {
  searchParams: Promise<{
    organizationId?: string | string[];
    projectId?: string | string[];
    track?: string | string[];
    scenario?: string | string[];
    mode?: string | string[];
  }>;
}) {
  const [
    { organizationId, projectId, track, scenario, mode: queryMode },
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
          canWrite={canCreate || Boolean(viewer.isAdmin)}
          identityConfirmed={Boolean(
            confirmedIdentity ||
              identityWorkspace?.identity?.status === "confirmed",
          )}
          defaultChecklist={activeIdentity?.productChecklist}
          identityHref={
            choice && sectionVisibility(choice).identity
              ? scopedHref("/brand/identity", choice)
              : undefined
          }
          initialProjectId={initialProjectId}
          initialTrack={initialTrack}
          initialScenario={initialScenario}
          initialMode={initialMode}
        />
      )}
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
        </div>
      </details>
      {production && contracts.length > 0 && (
        <>
          {stage === "ready" && canCreate && (
            <aside className="bw-note bw-production-identity">
              <div>
                <strong>
                  {verifyRequired
                    ? t.verifyRequired
                    : selfie
                      ? t.identityReady
                      : t.identityNeeded}
                </strong>
                <p>{t.identityHint}</p>
              </div>
              <a
                className="bw-button"
                href={studioIdentityHref(verifyRequired ? "verify" : "selfie", locale, brandHost)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {verifyRequired ? t.verifyAction : t.identityAction} ↗
              </a>
            </aside>
          )}
          {!access.staff && !canCreate && (
            <p className="bw-note" data-studio-viewer-note>{o.viewerCannotCreate}</p>
          )}
          {contracts.map((c) => (
            <section key={c.id} className="bw-production-contract">
              <div className="bw-row">
                <div>
                  <h2>{c.title}</h2>
                  <p className="bw-muted">
                    {formatBrandTimestamp(c.startsAt, locale)} —{" "}
                    {formatBrandTimestamp(c.endsAt, locale)}
                  </p>
                </div>
                <div className="bw-production-remaining">
                  <strong>{c.remaining}</strong>
                  <span>{t.remaining}</span>
                  <small>
                    {t.total} {c.limit}
                  </small>
                </div>
              </div>
              {!c.active ? (
                <p className="bw-note">{t.inactive}</p>
              ) : c.remaining < 1 ? (
                <p className="bw-note" data-contract-exhausted>{t.exhausted}</p>
              ) : null}
              <div className="bw-production-grid">
                {c.templates.map((v) => (
                  <article
                    key={v.id}
                    className="bw-panel bw-production-template"
                  >
                    {v.previewUrl ? (
                      <div className="bw-production-preview">
                        {v.previewMime?.startsWith("video/") ? (
                          <video
                            src={v.previewUrl.includes("#") ? v.previewUrl : `${v.previewUrl}#t=0.1`}
                            controls
                            playsInline
                            preload="metadata"
                            aria-label={locale === "ko" ? v.titleKo : v.title}
                          />
                        ) : (
                          <img
                            src={v.previewUrl}
                            alt={locale === "ko" ? v.titleKo : v.title}
                            loading="lazy"
                          />
                        )}
                        <span>
                          {v.seconds}
                          {t.secondsUnit} · {v.aspect}
                        </span>
                      </div>
                    ) : (
                      <div className="bw-production-format">
                        <span data-preview-pending>{t.previewPending}</span>
                        <strong>{v.aspect}</strong>
                        <span>
                          {v.seconds}
                          {t.secondsUnit}
                        </span>
                      </div>
                    )}
                    <h3>{locale === "ko" ? v.titleKo : v.title}</h3>
                    <p>{t.oneUse}</p>
                    <ProductionCreate
                      contractId={c.id}
                      organizationId={orgId ?? null}
                      templateId={v.id}
                      selfieId={selfie}
                      locale={locale}
                      t={t}
                      disabled={
                        verifyRequired ||
                        !c.active ||
                        c.remaining < 1 ||
                        !selfie ||
                        production.role === "viewer" ||
                        production.role === "studio"
                      }
                    />
                  </article>
                ))}
              </div>
              {!c.templates.length && (
                <p className="bw-note">{t.templatesPending}</p>
              )}
            </section>
          ))}
          <section className="bw-panel" id="studio-history">
            <h2>{t.history}</h2>
            <ul className="bw-list">
              {production.jobs.map((j) => (
                <li className="bw-row" key={j.id}>
                  <a href={`/brand/studio/${j.id}?organizationId=${historyOrg}&locale=${locale}`}>
                    {locale === "ko" ? j.titleKo : j.title}
                  </a>
                  <span>
                    {t.states[j.status as keyof typeof t.states]}
                    {j.released ? ` · ${t.restoredShort}` : ""}
                  </span>
                  <time>{formatBrandTimestamp(j.createdAt, locale)}</time>
                </li>
              ))}
            </ul>
            {!production.jobs.length && (
              <p className="bw-muted">{t.noHistory}</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
