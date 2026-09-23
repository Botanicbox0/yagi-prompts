import { StudioInquiry } from "@/components/brand-workspace/studio-inquiry";
import { ServiceGuide } from "@/components/brand-workspace/service-guide";
import {
  assetLibraryMode,
  identityStatusFor,
  needsLiveness,
} from "@/lib/identity/service";
import { brandContext } from "@/components/brand-workspace/context";
import { brandScope, membershipOf, selectedAccess } from "@/components/brand-workspace/scope";
import { BrandUnavailable } from "@/components/brand-workspace/brand-unavailable";
import { scopedHref } from "@/lib/brands/workspace/selection";
import { ProductionCreate } from "@/components/brand-workspace/production-create";
import { loadProductionWorkspace } from "@/lib/brands/production/service";
import { formatBrandTimestamp } from "@/components/brand-workspace/format";
import { StaffNotice, adminOrganizationHref } from "@/components/brand-workspace/staff-notice";
export default async function BrandStudio({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  const [{ organizationId }, { sql, viewer, verifiedEmail, brandHost, b, locale }] = await Promise.all([
    searchParams,
    brandContext(),
  ]);
  if (!sql) return <p role="alert">{b.unavailable}</p>;
  const { selection, choice, projectOrganizations } = await brandScope({ sql, verifiedEmail }, viewer, organizationId);
  if (selection.state === "unavailable") return <BrandUnavailable b={b} />;
  // Role and requests follow the SELECTED brand only. A guest brand has no membership here.
  const organizations = membershipOf(choice),
    access = selectedAccess(choice, Object.values(projectOrganizations).filter((o) => o === choice?.id)),
    orgId = organizations[0]?.id,
    t = b.productionStudio;
  const heading = (
    <div className="bw-heading">
      <div>
        <p className="bw-kicker">TWINGS STUDIO</p>
        <h1>{t.title}</h1>
        <p>{t.subtitle}</p>
      </div>
      {/* Renders nothing for accounts that cannot send a request (viewer-only, campaign-only). */}
      <StudioInquiry organizations={organizations} organizationId={orgId} b={b} allowSetup={access.fresh} />
    </div>
  );
  // Campaign-only invitees reach this page only by typing the address: no onboarding, no creation.
  if (access.projectScopedOnly)
    return (
      <div data-brand-production data-brand-studio-unavailable>
        {heading}
        <section className="bw-empty">
          <p>{b.access.studioSharedOnly}</p>
          <a href={scopedHref("/brand", choice)} className="bw-button">{b.back}</a>
        </section>
      </div>
    );
  const selectedRole = organizations[0]?.role;
  // The TWINGS team reads the brand's templates, remaining count and history; it never generates here.
  const staffOrgId = access.staff ? choice?.id : undefined;
  const production = orgId ?? staffOrgId
    ? await loadProductionWorkspace({ sql, verifiedEmail }, viewer, (orgId ?? staffOrgId)!)
    : null;
  const historyOrg = orgId ?? staffOrgId;
  const portrait =
    (
      await sql.query<{ attempt_id: string }>(
        "select s.attempt_id from identity_portrait_selections s join identity_portrait_attempts a on a.id=s.attempt_id and a.user_id=s.user_id where s.user_id=$1 and a.status='succeeded'",
        [viewer.userId],
      )
    ).rows[0]?.attempt_id ?? null;
  const mode = assetLibraryMode();
  const verifyRequired =
    !!portrait &&
    needsLiveness("seedance-2.5", mode) &&
    (await identityStatusFor(sql, viewer.userId!, mode)) !== "active";
  return (
    <div data-brand-production>
      {heading}
      {access.staff && choice && <StaffNotice b={b} manageHref={viewer.isAdmin ? adminOrganizationHref(choice.id, brandHost) : null} />}
      <ServiceGuide kind="studio" b={b} showOther={access.canRequest || access.fresh} organizationId={choice?.id} />
      {!production || !production.contracts.length ? (
        selectedRole === "viewer" || access.staff ? (
          // The request invitation would point at a button a viewer does not have.
          <section className="bw-panel bw-production-empty" data-brand-studio-read-only>
            <h2>{b.access.studioViewerTitle}</h2>
            <p>{b.access.studioViewer}</p>
          </section>
        ) : (
          <section className="bw-panel bw-production-empty">
            <h2>{t.emptyTitle}</h2>
            <p>{t.emptyHint}</p>
          </section>
        )
      ) : (
        <>
          {!access.staff && <aside className="bw-note bw-production-identity">
            <div>
              <strong>
                {verifyRequired
                  ? t.verifyRequired
                  : portrait
                    ? t.identityReady
                    : t.identityNeeded}
              </strong>
              <p>{t.identityHint}</p>
            </div>
            <a
              className="bw-button"
              href={`https://twings.app/identity/${verifyRequired ? "verify" : "portrait"}?locale=${locale}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {verifyRequired ? t.verifyAction : t.identityAction} ↗
            </a>
          </aside>}
          {production.contracts.map((c) => (
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
              {!c.active && <p className="bw-note">{t.inactive}</p>}
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
                            src={v.previewUrl}
                            controls
                            playsInline
                            preload="metadata"
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
                        <span>SEEDANCE 2.5</span>
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
                      templateId={v.id}
                      portraitId={portrait}
                      locale={locale}
                      t={t}
                      disabled={
                        verifyRequired ||
                        !c.active ||
                        c.remaining < 1 ||
                        !portrait ||
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
          <section className="bw-panel">
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
