import type {
  BrandProjectDetail,
  BrandPost,
} from "@/lib/brands/workspace/types";
import type { BrandCopy } from "./action-form";
import { ActionForm } from "./action-form";
import { BrandUpload } from "./upload";
import { interpolate } from "@/lib/i18n/format";
import { formatBrandDate, formatBrandTimestamp, formatFileSize } from "./format";
import { ProjectTabs } from './project-tabs';
import { CampaignContracts } from './contracts';
import { CampaignPerformance } from './performance';
import { metricProvenance, postHandle, postPresentation } from '@/lib/brands/workspace/performance';
import { unsetDateKey } from '@/lib/brands/workspace/schedule';
import { DecisionFields } from './decision-fields';
import { StaffNotice } from './staff-notice';
import { campaignListReturnPath } from '@/lib/brands/workspace/navigation';
import { CreatorCampaignProgress } from './creator-campaign';
import { projectNextAction } from './next-action';
import { campaignTimeline } from '@/lib/brands/workspace/timeline';
import { CampaignTimelineView } from './campaign-sections';
import { CampaignTermsSummary } from './campaign-terms-summary';
import { SecondaryUsage } from './secondary-usage';
import { AestheticEngine } from './aesthetic-engine';
import { ReviewStage } from './review-stage';
import { BriefConcierge } from './brief-concierge';
import { HumanHandoff } from './human-handoff';
import { AmbientBleed } from './ambient-bleed';
import { IntakeBriefSummary } from './intake-brief-summary';
import type { BrandUsageView } from "@/lib/brands/usage/types";
import type { ReactNode } from "react";

/** With a cover, its main colour glows softly behind the masthead (brand host only, see workspace.css). */
function Masthead({ cover, children }: { cover: boolean; children: ReactNode }) {
  return cover ? <AmbientBleed className="bw-project-masthead">{children}</AmbientBleed> : <div>{children}</div>;
}

export function PostTable({
  posts,
  b,
  locale,
}: {
  posts: BrandPost[];
  b: BrandCopy;
  locale: string;
}) {
  if (!posts.length) return <p className="bw-muted">{b.noPosts}</p>;
  const value = (n: number | null) =>
    n === null ? b.notMeasured : n.toLocaleString(locale);
  return (
    <div className="bw-table-wrap">
      <table className="bw-table">
        <thead>
          <tr>
            <th>{b.posts}</th>
            <th>{b.views}</th>
            <th>{b.likes}</th>
            <th>{b.comments}</th>
            <th>{b.shares}</th>
            <th>{b.saves}</th>
            <th>{b.source}</th>
            <th>{b.measuredAt}</th>
          </tr>
        </thead>
        <tbody>
          {posts.map((p) => (
            <tr key={p.id}>
              <td>
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={b.external}
                >
                  {/* Never the raw platform post code: handle, display name, or the generic platform post. */}
                  {postHandle(p) ?? postPresentation(p).displayName ?? b.platforms[p.platform]} ↗
                </a>
                <p className="bw-muted">
                  {(postHandle(p) || postPresentation(p).displayName) && <>{b.platforms[p.platform]} · </>}
                  {p.publishedAt === null ? b.performance.publishedUnknown : interpolate(b.performance.publishedOn, { date: formatBrandTimestamp(p.publishedAt, locale)! })}
                </p>
              </td>
              <td data-approximate={p.viewsApproximate && p.views !== null ? "true" : undefined}>
                {p.viewsApproximate && p.views !== null
                  ? interpolate(b.performance.approxValue, { value: p.views.toLocaleString(locale) })
                  : value(p.views)}
              </td>
              <td>{value(p.likes)}</td>
              <td>{value(p.comments)}</td>
              <td>{value(p.shares)}</td>
              <td>{value(p.saves)}</td>
              <td>{metricProvenance(p).map((x) => x.kind === "source" ? b.sourceLabels[x.value] : b.verificationLabels[x.value]).join(" · ")}</td>
              <td>
                {formatBrandTimestamp(p.measuredAt, locale) ?? b.notMeasured}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProjectDetail({
  project: p,
  b,
  locale,
  studio = false,
  generativeMediaAllowed = true,
  backHref,
  studioReply,
  staffManageHref = null,
  usage = null,
  applicants = null,
  payments = null,
  shortlist = null,
  shortlistCount = 0,
  formatTitle = null,
  staffTools = null,
  roomEntry = null,
}: {
  project: BrandProjectDetail;
  b: BrandCopy;
  locale: string;
  studio?: boolean;
  /** False when the organization's feature policy closes generative studio production (e.g. Morphic). */
  generativeMediaAllowed?: boolean;
  /** Validated list context; checked again against the loaded project before rendering. */
  backHref?: string;
  /** The studio's own comment form, rendered where the conversation is instead of a separate panel. */
  studioReply?: ReactNode;
  /** Existing admin page for this campaign, offered to DB admins in the TWINGS team view only. */
  staffManageHref?: string | null;
  /** Secondary usage (docs/SECONDARY-USAGE.md): null hides the tab (campaign guests, or not loaded). */
  usage?: BrandUsageView | null;
  /**
   * The applicants and payment tabs (docs/PLATFORM-2.0.md §16.4), rendered by the customer page for
   * brand members only, after it authorized this project. null: no such tabs (guests, the admin view).
   */
  applicants?: ReactNode;
  payments?: ReactNode;
  /** The creator shortlist (docs/BRAND-SHORTLIST.md) and how many shared candidates it holds; 0 hides the tab. */
  shortlist?: ReactNode;
  shortlistCount?: number;
  /** The requested template's title, looked up by the page; null shows the slug. */
  formatTitle?: string | null;
  /** DB admins in the TWINGS team view only: the studio's own panels for this campaign (the shortlist). */
  staffTools?: ReactNode;
  /**
   * "룸 열기" (docs/BRAND-ROOMS.md §3), beside the status. Given only while rooms are open for this brand;
   * null keeps the header exactly as before.
   */
  roomEntry?: ReactNode;
}) {
  // `role: "studio"` outside /admin is the TWINGS team's read-only view: it is not the customer's seat.
  const staffView = !studio && p.role === "studio";
  const writable = !studio && (p.role === "owner" || p.role === "editor") && p.status !== "cancelled";
  // Commenting is narrower than editing: invited campaign guests may comment without approving.
  const canComment = !studio && !staffView && p.canComment && p.status !== "cancelled";
  // "To be agreed" only while the request is open; afterwards an unset date is simply not set.
  const unsetDate = unsetDateKey(p.status) === "pending" ? b.tax.unspecified : b.dateNotSet;
  const newest = new Map<string, number>();
  for (const c of p.contents)
    newest.set(c.slotKey, Math.max(newest.get(c.slotKey) ?? 0, c.version));
  // Decided by state and role (release review): a requested or empty campaign never asks for results.
  const next = projectNextAction(p, studio ? "studio" : writable ? "approver" : "reader", b);
  return (
    <div data-brand-project={p.id}>
      <Masthead cover={Boolean(p.coverUrl)}>
      {p.coverUrl && (
        <div className="bw-project-cover" data-project-cover>
          <img src={p.coverUrl} alt={`${b.cover.alt}: ${p.title}`} />
        </div>
      )}
      <div className="bw-heading">
        <div>
          <a href={campaignListReturnPath(backHref, p.organizationId, studio)}>← {b.back}</a>
          <div className="ys-project-track-row">
            <p className="bw-kicker">{p.organizationName}</p>
            <span className="ys-track-pill" data-track={generativeMediaAllowed ? p.productionMode : "creator"}>
              {generativeMediaAllowed && p.productionMode === "studio"
                ? locale === "en"
                  ? "Studio Film Production"
                  : "스튜디오 영상 제작"
                : locale === "en"
                  ? "Creator Seeding Campaign"
                  : "크리에이터 캠페인"}
            </span>
          </div>
          <h1>{p.title}</h1>
          <p>
            {b.latestUpdate} {formatBrandTimestamp(p.updatedAt, locale)}
          </p>
        </div>
        {roomEntry ? (
          <div className="brr-head-actions" data-project-room-entry>
            <span className="bw-status" data-state={p.status}>
              {b.status[p.status]}
            </span>
            {roomEntry}
          </div>
        ) : (
          <span className="bw-status" data-state={p.status}>
            {b.status[p.status]}
          </span>
        )}
      </div>
      </Masthead>
      {staffView && <StaffNotice b={b} manageHref={staffManageHref} />}
      {staffView && p.clientVisible === false && <p className="bw-note" data-project-unshared>{b.managed.prepared}</p>}
      {staffView && staffTools}
      {p.status === "requested" && <p className="bw-note">{b.requestedNext}</p>}
      {/* Above the tabs, so it is seen whichever tab is open; its link switches to that tab. */}
      {next && (
        <div className="bw-note bw-row bw-no-print bw-tab-next" data-project-next-action={next.kind}>
          <div><strong>{b.performance.nextAction}</strong><p>{next.text}</p></div>
          <div className="bw-row">
            {next.href && <a className="bw-button" href={next.href}>{next.label} →</a>}
            {generativeMediaAllowed && p.productionMode === "studio" && (
              <a
                className="bw-button bw-primary"
                href={`/brand/studio?organizationId=${encodeURIComponent(p.organizationId)}`}
                data-studio-commission-handoff
              >
                {locale === "en" ? "Self Studio →" : "셀프 스튜디오 →"}
              </a>
            )}
          </div>
        </div>
      )}
      {generativeMediaAllowed && !next && p.productionMode === "studio" && (
        <div
          className="bw-note bw-row bw-no-print"
          data-studio-commission-handoff
          style={{ padding: "10px 16px" }}
        >
          <span style={{ fontSize: "13.5px", fontWeight: 600 }}>
            {locale === "en"
              ? "Review cuts in the Review tab or open Self Studio."
              : "콘텐츠 확인 탭에서 시사본을 검수하거나 셀프 스튜디오에서 직접 제작할 수 있습니다."}
          </span>
          <div className="bw-row">
            <a className="bw-button" href="#review">
              {locale === "en" ? "Open Review Room →" : "시사 룸 열기 →"}
            </a>
            <a
              className="bw-button bw-primary"
              href={`/brand/studio?organizationId=${encodeURIComponent(p.organizationId)}`}
            >
              {locale === "en" ? "Self Studio →" : "셀프 스튜디오 →"}
            </a>
          </div>
        </div>
      )}
      {generativeMediaAllowed && (
        <HumanHandoff
          organizationId={p.organizationId}
          projectId={p.id}
          locale={locale}
          refCount={Math.max(p.referenceLinks.length, 3)}
        />
      )}
      <ProjectTabs b={b} pendingReviews={p.status === "active" ? p.contents.filter(c => c.version === newest.get(c.slotKey) && c.decision === "pending").length : 0} comments={p.messages.length} usage={usage !== null} campaign={applicants !== null} shortlist={shortlist ? shortlistCount : 0}>
      <section id="performance" className="bw-panel">
        <CampaignTimelineView timeline={campaignTimeline(p)} b={b} />
        <CampaignPerformance project={p} b={b} locale={locale} showUnready={studio} usageCta={Boolean(usage?.eligible.some((s) => s.kind === "post"))}/>
        <CreatorCampaignProgress participation={p.participation ?? []} copy={b.creatorCampaign} locale={locale} />
      </section>
      {shortlist}
      {applicants}
      {payments}
      <div className="bw-grid-wide">
        <div>
          <section id="brief" className="bw-panel">
            <h2>{b.overview}</h2>
            {p.intakeBrief && (
              <>
                <h3>{locale === "en" ? "Project intake brief" : "접수된 프로젝트 기획 요약"}</h3>
                <IntakeBriefSummary brief={p.intakeBrief} locale={locale} />
              </>
            )}
            {p.campaignTerms && (
              <>
                <h3>{b.timeline.terms}</h3>
                <CampaignTermsSummary t={b.wizard} b={b} locale={locale} title={p.title} objective={p.objective} terms={p.campaignTerms} formatTitle={formatTitle} />
              </>
            )}
            <h3>{b.objective}</h3>
            <p className="bw-prose">{p.objective}</p>
            <dl className="bw-meta">
              <div>
                <dt>{b.audience}</dt>
                <dd className="bw-prose">{p.audience || b.tax.unspecified}</dd>
              </div>
              <div>
                <dt>{b.budget}</dt>
                <dd>
                  {p.budgetKrw === null
                    ? b.tax.unspecified
                    : new Intl.NumberFormat(locale, {
                        style: "currency",
                        currency: "KRW",
                        maximumFractionDigits: 0,
                      }).format(p.budgetKrw)}{" "}
                  · {b.tax[p.budgetTaxBasis]}
                </dd>
              </div>
              <div>
                <dt>
                  {b.startsOn} / {b.endsOn}
                </dt>
                <dd>
                  {formatBrandDate(p.startsOn, locale) ?? unsetDate} —{" "}
                  {formatBrandDate(p.endsOn, locale) ?? unsetDate}
                </dd>
              </div>
              <div>
                <dt>{b.production}</dt>
                <dd>{b.productionModes[p.productionMode]}</dd>
              </div>
            </dl>
            {/* A wizard brief states platforms and followers in its terms above; the old criteria block would repeat them. */}
            {!p.campaignTerms && (<>
            <h3>{b.criteria}</h3>
            <p className="bw-muted">{b.criteriaHint}</p>
            <dl className="bw-meta">
              <div>
                <dt>{b.platformLabel}</dt>
                <dd>
                  {p.criteria.platforms.map((x) => b.platforms[x]).join(", ") ||
                    b.tax.unspecified}
                </dd>
              </div>
              <div>
                <dt>
                  {b.minFollowers} / {b.maxFollowers}
                </dt>
                <dd>
                  {p.criteria.minFollowers?.toLocaleString(locale) ??
                    b.tax.unspecified}{" "}
                  —{" "}
                  {p.criteria.maxFollowers?.toLocaleString(locale) ??
                    b.tax.unspecified}
                </dd>
              </div>
              <div>
                <dt>{b.primaryMetric}</dt>
                <dd>{b.metricNames[p.criteria.primaryMetric]}</dd>
              </div>
              <div>
                <dt>{b.targetValue}</dt>
                <dd>
                  {p.criteria.targetValue?.toLocaleString(locale) ??
                    b.tax.unspecified}
                </dd>
              </div>
            </dl>
            </>)}
            {p.referenceLinks.length > 0 && (
              <>
                <h3>{b.references}</h3>
                <ul className="bw-list">
                  {p.referenceLinks.map((r, i) => (
                    <li key={i}>
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={b.external}
                        className="bw-prose"
                      >
                        {r.url} ↗
                      </a>
                      <p className="bw-prose bw-muted">{r.note}</p>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {generativeMediaAllowed && (
              <>
                <BriefConcierge
                  brandName={p.organizationName}
                  projectTitle={p.title}
                  objective={p.objective}
                  organizationId={p.organizationId}
                  projectId={p.id}
                  locale={locale}
                />
                <AestheticEngine locale={locale} referenceLinks={p.referenceLinks} />
                {!studio && (
                  <div
                    className="bw-note bw-row"
                    data-project-direction-card
                    data-project-id={p.id}
                  >
                    <div>
                      <strong>
                        {locale === "en"
                          ? "Project-Specific Mood & Direction"
                          : "이 프로젝트 전용 무드 · 스튜디오 연동"}
                      </strong>
                      <p className="bw-muted">
                        {locale === "en"
                          ? "Keep your brand essentials (logos, products, and guidelines) while tailoring the lighting, framing, and mood specifically for this project."
                          : "브랜드 로고·제품·핵심 원칙은 유지하면서, 이번 프로젝트에 맞는 조명·구도·분위기만 골라 스튜디오에서 바로 제작합니다."}
                      </p>
                    </div>
                    <a
                      className="bw-button"
                      data-project-direction-studio-link
                      href={`/brand/studio?organizationId=${encodeURIComponent(p.organizationId)}&projectId=${encodeURIComponent(p.id)}`}
                    >
                      {locale === "en"
                        ? "Open Project Direction in Studio →"
                        : "이 프로젝트 전용 연출로 스튜디오 열기 →"}
                    </a>
                  </div>
                )}
              </>
            )}
          </section>
          <section id="review" className="bw-panel">
            <h2>{b.review}</h2>
            <p className="bw-muted">{b.approvalNotice}</p>
            <ReviewStage
              projectId={p.id}
              contents={p.contents}
              messages={p.messages}
              decisions={p.decisions}
              locale={locale}
              generativeMediaAllowed={generativeMediaAllowed}
              productionMode={p.productionMode}
            />
            {p.contents.length === 0 ? (
              <p className="bw-note">{b.noContent}</p>
            ) : (
              p.contents.map((c) => (
                <article
                  className="bw-message"
                  key={c.id}
                  data-content-version={c.id}
                >
                  <div className="bw-row">
                    <h3>
                      {c.title} ·{" "}
                      {interpolate(b.version, { number: c.version })}
                    </h3>
                    <span className="bw-status" data-state={c.decision}>
                      {b.decisionStates[c.decision]}
                    </span>
                  </div>
                  <a
                    className="bw-button"
                    href={c.mediaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {b.openContent} ↗
                  </a>
                  <dl className="bw-meta">
                    <div>
                      <dt>{b.caption}</dt>
                      <dd className="bw-prose">{c.caption}</dd>
                    </div>
                    <div>
                      <dt>{b.usage}</dt>
                      <dd className="bw-prose">{c.usageRights}</dd>
                    </div>
                  </dl>
                  {usage?.eligible.some((s) => s.kind === "content_version" && s.id === c.id) && (
                    <a className="bw-button bw-usage-cta" data-usage-cta={`content_version:${c.id}`} href={`#usage=content_version:${c.id}`} title={b.secondaryUsage.ctaHint}>
                      {b.secondaryUsage.cta}
                    </a>
                  )}
                  {writable &&
                    p.status === "active" &&
                    newest.get(c.slotKey) === c.version &&
                    c.decision === "pending" && (
                      <ActionForm
                        operation="content.decide"
                        fixed={{
                          projectId: p.id,
                          contentVersionId: c.id,
                          expectedRevision: c.reviewRevision,
                        }}
                        b={b}
                        submit={b.save}
                      >
                        <DecisionFields b={b} />
                      </ActionForm>
                    )}
                  {p.decisions
                    .filter((d) => d.contentVersionId === c.id)
                    .map((d) => (
                      <div className="bw-note" key={d.id}>
                        <strong>{b.decisionStates[d.decision]}</strong> ·{" "}
                        {formatBrandTimestamp(d.createdAt, locale)}
                        <p className="bw-prose">{d.comment}</p>
                      </div>
                    ))}
                </article>
              ))
            )}
          </section>
          <section id="reports" className="bw-panel">
            <h2>{b.reports}</h2>
            <p className="bw-muted">{b.metricsNote}</p>
            {!p.reports.length ? (
              <p className="bw-note">{b.noReports}</p>
            ) : (
              p.reports.map((r) => (
                <article
                  key={r.id}
                  className="bw-message"
                  data-report-version={r.version}
                >
                  <h3>{interpolate(b.reportCount, { number: r.version })}</h3>
                  <a className="bw-button" href={`${studio?'/admin/brand-workspace':'/brand/projects'}/${p.id}/reports/${r.id}`}>{b.performance.reportLink} →</a>
                  <p className="bw-muted">
                    {b.period}: {formatBrandDate(r.periodStart, locale)} — {formatBrandDate(r.periodEnd, locale)} ·{" "}
                    {b.publishedAt}: {formatBrandTimestamp(r.createdAt, locale)}
                  </p>
                  <div className="bw-stats">
                    <div>
                      <small>{b.totalViews}</small>
                      <strong>
                        {r.snapshot.viewsTotal === null
                          ? b.notMeasured
                          : r.snapshot.viewsTotalApproximate
                            ? interpolate(b.performance.approxValue, { value: r.snapshot.viewsTotal.toLocaleString(locale) })
                            : r.snapshot.viewsTotal.toLocaleString(locale)}
                      </strong>
                    </div>
                    <div>
                      <small>{b.coverage}</small>
                      <strong>
                        {r.snapshot.measuredPosts} / {r.snapshot.totalPosts}
                      </strong>
                    </div>
                    <div>
                      <small>{b.posts}</small>
                      <strong>{r.snapshot.totalPosts}</strong>
                    </div>
                  </div>
                  <p className="bw-prose">{r.summary}</p>
                  {r.snapshot.viewsTotalApproximate && (
                    <p className="bw-note" data-approximate-views>
                      {interpolate(b.performance.approxNote, {
                        count: r.snapshot.posts.filter((x) => x.viewsApproximate).length,
                      })}
                    </p>
                  )}
                  {r.snapshot.posts.some((x) => x.publishedAt === null) && (
                    <p className="bw-note">
                      {interpolate(b.performance.reportUndated, {
                        count: r.snapshot.posts.filter((x) => x.publishedAt === null).length,
                      })}
                    </p>
                  )}
                  <PostTable posts={r.snapshot.posts} b={b} locale={locale} />
                </article>
              ))
            )}
          </section>
        </div>
        <div>
          <section id="conversation" className="bw-panel" data-comments={canComment || studio ? "open" : "read-only"}>
            <h2>{b.conversation}</h2>
            <p className="bw-muted">{b.commentsHint}</p>
            {!p.messages.length && <p className="bw-muted">{studio ? b.noStudioMessages : b.noMessages}</p>}
            {p.messages.map((m) => (
              <article
                className="bw-message"
                key={m.id}
                data-author={m.authorRole}
              >
                <header>
                  <strong>
                    {m.authorRole === "studio" ? b.studioAuthor : b.brandAuthor}
                  </strong>
                  <time dateTime={m.createdAt}>
                    {formatBrandTimestamp(m.createdAt, locale)}
                  </time>
                </header>
                <p className="bw-prose">{m.body}</p>
              </article>
            ))}
            {canComment && (
              <ActionForm
                operation="message.send"
                fixed={{ projectId: p.id }}
                b={b}
                submit={b.sendComment}
              >
                <label>
                  {b.message}
                  <textarea name="body" required maxLength={4000} />
                </label>
              </ActionForm>
            )}
            {!studio && !canComment && p.status !== "cancelled" && (
              <p className="bw-note" data-comments-read-only>{b.commentsReadOnly}</p>
            )}
            {studio && studioReply}
          </section>
          <section id="files" className="bw-panel">
            <h2>{b.files}</h2>
            {!p.attachments.length && <p className="bw-muted">{b.noFiles}</p>}
            <ul className="bw-list">
              {p.attachments.map((f) => (
                <li key={f.id}>
                  <a
                    href={`/api/brand-workspace/attachments/${f.id}`}
                    rel="noreferrer"
                    target="_blank"
                    className="bw-prose"
                  >
                    {f.name} ↗
                  </a>
                  <p className="bw-muted">
                    {formatFileSize(f.sizeBytes, locale)} ·{" "}
                    {formatBrandTimestamp(f.createdAt, locale)}
                  </p>
                </li>
              ))}
            </ul>
            {writable && <BrandUpload projectId={p.id} b={b} />}
          </section>
        </div>
      </div>
      <CampaignContracts project={p} b={b} locale={locale} studio={studio}/>
      {usage && <SecondaryUsage view={usage} projectId={p.id} b={b} locale={locale} project={p} />}
      </ProjectTabs>
    </div>
  );
}
