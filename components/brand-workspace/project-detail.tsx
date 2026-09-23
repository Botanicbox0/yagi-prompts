import type {
  BrandProjectDetail,
  BrandPost,
} from "@/lib/brands/workspace/types";
import type { BrandCopy } from "./action-form";
import { ActionForm } from "./action-form";
import { BrandUpload } from "./upload";
import { interpolate } from "@/lib/i18n/format";
import { formatBrandTimestamp } from "./format";
import { ProjectTabs } from './project-tabs';
import { CampaignContracts } from './contracts';
import { CampaignPerformance } from './performance';
import { postHandle, postPresentation } from '@/lib/brands/workspace/performance';
import { unsetDateKey } from '@/lib/brands/workspace/schedule';
import { DecisionFields } from './decision-fields';
import type { ReactNode } from "react";

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
                  {p.origin === "external_import" && <>{b.performance.linkedPost} · </>}
                  {b.verificationLabels[p.verification]}
                  {p.publishedAt === null && <> · {b.performance.publishedUnknown}</>}
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
              <td>{b.sourceLabels[p.metricsSource]}</td>
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
  studioReply,
}: {
  project: BrandProjectDetail;
  b: BrandCopy;
  locale: string;
  studio?: boolean;
  /** The studio's own comment form, rendered where the conversation is instead of a separate panel. */
  studioReply?: ReactNode;
}) {
  const writable = !studio && p.role !== "viewer" && p.status !== "cancelled";
  // Commenting is narrower than editing: invited campaign guests may comment without approving.
  const canComment = !studio && p.canComment && p.status !== "cancelled";
  // "To be agreed" only while the request is open; afterwards an unset date is simply not set.
  const unsetDate = unsetDateKey(p.status) === "pending" ? b.tax.unspecified : b.dateNotSet;
  const newest = new Map<string, number>();
  for (const c of p.contents)
    newest.set(c.slotKey, Math.max(newest.get(c.slotKey) ?? 0, c.version));
  return (
    <div data-brand-project={p.id}>
      <div className={p.coverUrl ? "bw-project-masthead" : undefined}>
      {p.coverUrl && (
        <div className="bw-project-cover" data-project-cover>
          <img src={p.coverUrl} alt={`${b.cover.alt}: ${p.title}`} />
        </div>
      )}
      <div className="bw-heading">
        <div>
          <a href={studio ? "/admin/brand-workspace" : `/brand?organizationId=${p.organizationId}`}>← {b.back}</a>
          <p className="bw-kicker">{p.organizationName}</p>
          <h1>{p.title}</h1>
          <p>
            {b.latestUpdate} {formatBrandTimestamp(p.updatedAt, locale)}
          </p>
        </div>
        <span className="bw-status" data-state={p.status}>
          {b.status[p.status]}
        </span>
      </div>
      </div>
      {p.status === "requested" && <p className="bw-note">{b.requestedNext}</p>}
      <ProjectTabs b={b} comments={p.messages.length}>
      <section id="performance" className="bw-panel">
        <CampaignPerformance project={p} b={b} locale={locale}/>
      </section>
      <div className="bw-note bw-row bw-no-print bw-tab-next">
        <div><strong>{b.performance.nextAction}</strong><p>{p.contents.some(c=>c.version===newest.get(c.slotKey)&&c.decision==='pending')?interpolate(b.performance.reviewAction,{count:p.contents.filter(c=>c.version===newest.get(c.slotKey)&&c.decision==='pending').length}):b.performance.trackingAction}</p></div>
        <a className="bw-button" href={studio?'#studio-actions':'#review'}>{studio?b.performance.studioActions:b.review} →</a>
      </div>
      <div className="bw-grid-wide">
        <div>
          <section id="brief" className="bw-panel">
            <h2>{b.overview}</h2>
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
                  {p.startsOn ?? unsetDate} —{" "}
                  {p.endsOn ?? unsetDate}
                </dd>
              </div>
              <div>
                <dt>{b.production}</dt>
                <dd>{b.productionModes[p.productionMode]}</dd>
              </div>
            </dl>
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
          </section>
          <section id="review" className="bw-panel">
            <h2>{b.review}</h2>
            <p className="bw-muted">{b.approvalNotice}</p>
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
                        <label className="bw-check">
                          <input type="checkbox" required name="confirmed" />
                          {b.approveConfirm}
                        </label>
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
                    {b.period}: {r.periodStart} — {r.periodEnd} ·{" "}
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
                    {Math.ceil(f.sizeBytes / 1024).toLocaleString(locale)} KB ·{" "}
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
      </ProjectTabs>
    </div>
  );
}
