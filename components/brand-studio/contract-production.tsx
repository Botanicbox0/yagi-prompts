/**
 * The contract production section (templates, remaining count, `ProductionCreate`, history), moved
 * out of `app/(brand)/brand/studio/page.tsx` unchanged so the legacy page and the v2 "포맷" tab render
 * the same markup from one place. Server component.
 */
import { ProductionCreate } from "@/components/brand-workspace/production-create";
import { formatBrandTimestamp } from "@/components/brand-workspace/format";
import { studioIdentityHref } from "@/lib/brands/workspace/links";
import type { ProductionContractView, ProductionWorkspace } from "@/lib/brands/production/service";
import type { StudioStage } from "@/lib/brands/production/stage";
import type { Dictionary } from "@/lib/i18n/dictionaries";

type ProductionCopy = Dictionary["brandWorkspace"]["productionStudio"];

export interface ContractProductionProps {
  production: ProductionWorkspace | null;
  contracts: readonly ProductionContractView[];
  stage: StudioStage;
  canCreate: boolean;
  staff: boolean;
  verifyRequired: boolean;
  selfie: string | null;
  orgId: string | undefined;
  historyOrg: string | undefined;
  locale: string;
  brandHost: boolean;
  t: ProductionCopy;
  o: ProductionCopy["onboarding"];
}

export function ContractProduction({
  production,
  contracts,
  stage,
  canCreate,
  staff,
  verifyRequired,
  selfie,
  orgId,
  historyOrg,
  locale,
  brandHost,
  t,
  o,
}: ContractProductionProps) {
  return (
    <>
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
              {!staff && !canCreate && (
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
    </>
  );
}
