import { ManagedForm } from '@/components/brand-workspace/managed-form';
import "@/app/(brand)/workspace.css";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { getLocaleFromHeaders } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { loadStudioProject } from "@/lib/brands/workspace/service";
import { AdminShell, OpForm, OutcomeBanner } from "@/components/admin/chrome";
import type { AdminOperationName } from "@/lib/admin/operations";
import { ProjectDetail } from "@/components/brand-workspace/project-detail";
import { BrandUpload } from "@/components/brand-workspace/upload";
import { CollectionConsole } from "@/components/brand-workspace/collection-console";
import type { ReactNode } from "react";
export const dynamic = "force-dynamic";
export default async function StudioBrandProject({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, viewer, sql, locale, search] = await Promise.all([
    params,
    requireAdmin(),
    getSqlRunner(),
    getLocaleFromHeaders(),
    searchParams,
  ]);
  const dict = getDictionary(locale),
    b = dict.brandWorkspace;
  if (!sql) return <p role="alert">{b.unavailable}</p>;
  const p = await loadStudioProject({ sql }, viewer, id);
  if (!p) notFound();
  const Form = ({
    op,
    submit,
    children,
    revision = p.revision,
  }: {
    op: AdminOperationName;
    submit: string;
    children: ReactNode;
    revision?: number;
  }) => (
    <OpForm op={op} back={`/admin/brand-workspace/${id}`} className="bw-form">
      <input type="hidden" name="projectId" value={id} />
      <input type="hidden" name="requestId" value={randomUUID()} />
      <input type="hidden" name="expectedRevision" value={revision} />
      {children}
      <button className="bw-button bw-primary" type="submit">
        {submit}
      </button>
    </OpForm>
  );
  return (
    <AdminShell dict={dict.admin} locale={locale} active="brandWorkspace">
      <OutcomeBanner
        dict={dict.admin}
        ok={typeof search.ok === "string" ? search.ok : undefined}
        err={typeof search.err === "string" ? search.err : undefined}
      />
      <section className="bw-panel bw-sharing" data-managed-sharing>
        <div><strong>{p.clientVisible?b.managed.visible:b.managed.prepared}</strong><p className="bw-muted">{b.managed.visibilityHint}</p></div>
        <ManagedForm op="brandWorkspace.visibility" b={b} submit={p.clientVisible?b.managed.hide:b.managed.publish}><input type="hidden" name="projectId" value={p.id}/><input type="hidden" name="expectedRevision" value={p.revision}/><input type="hidden" name="visible" value={String(!p.clientVisible)}/></ManagedForm>
        <a className="bw-button" href={`/admin/brand-workspace/organizations/${p.organizationId}`}>{b.managed.access}</a><details><summary>{b.managed.invite}</summary><p className="bw-muted">{b.managed.inviteHint}</p><ManagedForm op="brandWorkspace.invite" b={b} submit={b.managed.invite}>
          <input type="hidden" name="organizationId" value={p.organizationId}/><label>{b.managed.email}<input type="email" name="email" required/></label>
          <label>{b.managed.scope}<select name="projectId"><option value={p.id}>{b.managed.scopeProject}</option><option value="">{b.managed.scopeBrand}</option></select></label><input type="hidden" name="role" value="viewer"/>
        </ManagedForm></details>
      </section>
      <ProjectDetail project={p} b={b} locale={locale} studio />
      <section className="bw-panel">
        <h2>{b.files}</h2>
        <BrandUpload projectId={id} b={b} studio />
      </section>
      <section id="studio-actions" className="bw-panel">
        <h2>{b.studioTitle}</h2>
        <div className="bw-grid">
          <Form op="brandWorkspace.status" submit={b.save}>
            <label>
              {b.projectStatus}
              <select
                name="status"
                defaultValue={p.status === "requested" ? "active" : "completed"}
              >
                <option value="active">{b.activate}</option>
                <option value="completed">{b.complete}</option>
                <option value="cancelled">{b.close}</option>
              </select>
            </label>
          </Form>
          <Form op="brandWorkspace.message" submit={b.send}>
            <label>
              {b.studioMessage}
              <textarea name="body" required maxLength={4000} />
            </label>
          </Form>
        </div>
      </section>
      {p.status === "active" && (
        <section className="bw-panel">
          <h2>{b.addContent}</h2>
          <Form op="brandWorkspace.content" submit={b.publishContent}>
            <div className="bw-grid">
              <label>
                {b.slotKey}
                <input
                  name="slotKey"
                  required
                  maxLength={60}
                  pattern="[a-zA-Z0-9_-]+"
                />
                <span className="bw-muted">{b.slotHint}</span>
              </label>
              <label>
                {b.contentTitle}
                <input name="title" required maxLength={120} />
              </label>
            </div>
            <label>
              {b.files}
              <select name="attachmentId" required>
                <option value="">{b.upload}</option>
                {p.attachments.map((a) => (
                  <option value={a.id} key={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {b.caption}
              <textarea name="caption" maxLength={4000} />
            </label>
            <label>
              {b.usage}
              <textarea name="usageRights" required maxLength={2000} />
            </label>
            {p.productionMode === "studio" && (
              <label className="bw-check">
                <input
                  type="checkbox"
                  name="creatorConsentConfirmed"
                  required
                />
                {b.consent}
              </label>
            )}
          </Form>
        </section>
      )}
      {p.status === "active" && <section className="bw-panel">
        <h2>{b.recordPost}</h2>
        <p className="bw-note">{b.postHint}</p>
        <Form op="brandWorkspace.post" submit={b.recordMetrics}>
          <label>
            {b.contentVersion}
            <select name="contentVersionId" required>
              <option value="">{b.contentVersion}</option>
              {p.contents
                .filter((c) => c.decision === "approved")
                .map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.title} ·{" "}
                    {b.version.replace("{number}", String(c.version))}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {b.postUrl}
            <input name="url" type="url" required maxLength={2048} />
          </label>
          <label>
            {b.postPublishedAt} · {b.koreaTime}
            <input name="publishedAt" type="datetime-local" required />
          </label>
          <div className="bw-grid">
            <label>
              {b.verification}
              <select name="verification">
                <option value="unverified">
                  {b.verificationLabels.unverified}
                </option>
                <option value="manual">{b.verificationLabels.manual}</option>
              </select>
            </label>
            <label>
              {b.source}
              <select name="metricsSource">
                <option value="unavailable">
                  {b.sourceLabels.unavailable}
                </option>
                <option value="creator_evidence">
                  {b.sourceLabels.creator_evidence}
                </option>
                <option value="studio_review">
                  {b.sourceLabels.studio_review}
                </option>
              </select>
            </label>
          </div>
          <label>
            {b.measuredAt} · {b.koreaTime}
            <input name="measuredAt" type="datetime-local" />
          </label>
          <div className="bw-grid">
            {(["views", "likes", "comments", "shares", "saves"] as const).map(
              (k) => (
                <label key={k}>
                  {b[k]}
                  <input name={k} type="number" min={0} step={1} />
                </label>
              ),
            )}
          </div>
        </Form>
      </section>}
      <CollectionConsole
        projectId={id}
        status={p.status}
        posts={p.posts}
        b={b}
        locale={locale}
      />
      {/* The single operation stays for a genuinely historical measurement time. It is frozen with
          the console, so it is not offered once the campaign is no longer active. */}
      {p.status === "active" && p.posts.map((post) => (
        <details className="bw-panel" key={post.id}>
          <summary>
            {b.collectionHistorical} · {post.platform}
          </summary>
          <h2>{b.updateMetrics}</h2>
          <p>
            <a href={post.url} target="_blank" rel="noopener noreferrer">
              {post.url} ↗
            </a>
          </p>
          <p className="bw-note">{b.collectionHistoricalHint}</p>
          <p className="bw-note">{b.postHint}</p>
          <Form
            op="brandWorkspace.metrics"
            submit={b.recordMetrics}
            revision={post.metricRevision}
          >
            <input type="hidden" name="postId" value={post.id} />
            <div className="bw-grid">
              <label>
                {b.verification}
                <select name="verification" defaultValue={post.verification}>
                  <option value="unverified">
                    {b.verificationLabels.unverified}
                  </option>
                  <option value="manual">{b.verificationLabels.manual}</option>
                </select>
              </label>
              <label>
                {b.source}
                <select name="metricsSource" defaultValue={post.metricsSource}>
                  <option value="unavailable">
                    {b.sourceLabels.unavailable}
                  </option>
                  <option value="creator_evidence">
                    {b.sourceLabels.creator_evidence}
                  </option>
                  <option value="studio_review">
                    {b.sourceLabels.studio_review}
                  </option>
                </select>
              </label>
            </div>
            <label>
              {b.measuredAt} · {b.koreaTime}
              <input
                name="measuredAt"
                type="datetime-local"
                defaultValue={
                  post.measuredAt
                    ? new Date(+new Date(post.measuredAt) + 9 * 3600000)
                        .toISOString()
                        .slice(0, 16)
                    : ""
                }
              />
            </label>
            <div className="bw-grid">
              {(["views", "likes", "comments", "shares", "saves"] as const).map(
                (k) => (
                  <label key={k}>
                    {b[k]}
                    <input
                      name={k}
                      type="number"
                      min={0}
                      step={1}
                      defaultValue={post[k] ?? ""}
                    />
                  </label>
                ),
              )}
            </div>
          </Form>
        </details>
      ))}
      <section className="bw-panel">
        <h2>{b.publishReport}</h2>
        <p className="bw-note">{b.reportNotice}</p>
        <Form op="brandWorkspace.report" submit={b.publishReport}>
          <label>
            {b.reportSummary}
            <textarea name="summary" maxLength={4000} required />
          </label>
          <div className="bw-grid">
            <label>
              {b.reportStart}
              <input name="periodStart" type="date" required />
            </label>
            <label>
              {b.reportEnd}
              <input name="periodEnd" type="date" required />
            </label>
          </div>
        </Form>
      </section>
    </AdminShell>
  );
}
