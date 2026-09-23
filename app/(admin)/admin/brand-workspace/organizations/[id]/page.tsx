import { ProductionAdmin } from '@/components/brand-workspace/production-admin';
import {loadProductionWorkspace} from '@/lib/brands/production/service';
import {loadStudioWorkspace} from '@/lib/brands/workspace/service';
import "@/app/(brand)/workspace.css";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { getLocaleFromHeaders } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import {
  loadStudioBrandAccess,
  loadBrandSupport,
} from "@/lib/brands/workspace/service";
import { AdminShell } from "@/components/admin/chrome";
import { ManagedForm } from "@/components/brand-workspace/managed-form";
import { formatBrandTimestamp } from "@/components/brand-workspace/format";
export const dynamic = "force-dynamic";
export default async function StudioOrganization({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, viewer, sql, locale] = await Promise.all([
    params,
    requireAdmin(),
    getSqlRunner(),
    getLocaleFromHeaders(),
  ]);
  const dict = getDictionary(locale),
    b = dict.brandWorkspace,
    c = b.managed;
  if (!sql) return <p role="alert">{b.unavailable}</p>;
  const org = await loadStudioBrandAccess({ sql }, viewer, id);
  if (!org) notFound();
  const messages = (await loadBrandSupport({ sql }, viewer, id, true)) ?? [];
  const previews=(await sql.query<{id:string;project_id:string;name:string}>("select id,project_id,name from brand_attachments where organization_id=$1 and status='ready' and access_scope='workspace' and (mime like 'image/%' or mime like 'video/%')",[id])).rows;
  const production=await loadProductionWorkspace({sql},viewer,id,true);
  const projects=(await loadStudioWorkspace({sql},viewer)).projects.filter(p=>p.organizationId===id);
  return (
    <AdminShell dict={dict.admin} locale={locale} active="brandWorkspace">
      <div className="bw-heading">
        <div>
          <a href="/admin/brand-workspace">← {b.back}</a>
          <h1>{org.name}</h1>
          <p>{c.access}</p>
        </div>
      </div>
      <div className="bw-grid-wide">
        <section className="bw-panel">
          <h2>{b.members}</h2>
          <ul className="bw-list">
            {org.members.map((m) => (
              <li className="bw-row" key={`${m.userId}:${m.projectId}`}>
                <div>
                  <strong>{m.email}</strong>
                  <p className="bw-muted">
                    {m.projectTitle ?? c.scopeBrand} ·{" "}
                    {b.roles[m.role as keyof typeof b.roles]} ·{" "}
                    {m.status === "active" ? c.active : c.cancelled}
                  </p>
                </div>
                {m.status === "active" && (
                  <ManagedForm
                    op="brandWorkspace.revokeAccess"
                    b={b}
                    submit={c.revoke}
                    tone="danger"
                    confirm={{ prompt: b.confirm.revokeMember, action: b.confirm.revokeMemberAction }}
                  >
                    <input type="hidden" name="organizationId" value={id} />
                    <input
                      type="hidden"
                      name="projectId"
                      value={m.projectId ?? ""}
                    />
                    <input type="hidden" name="userId" value={m.userId} />
                  </ManagedForm>
                )}
              </li>
            ))}
          </ul>
          <h2>{b.invitations}</h2>
          <ul className="bw-list">
            {org.invitations.map((i) => (
              <li className="bw-row" key={i.id}>
                <div>
                  <strong>{i.email}</strong>
                  <p className="bw-muted">
                    {i.projectTitle ?? c.scopeBrand} ·{" "}
                    {b.invitationStates[i.state]} ·{" "}
                    {formatBrandTimestamp(i.expiresAt, locale)}
                  </p>
                </div>
                {i.state === "pending" && (
                  <ManagedForm
                    op="brandWorkspace.revokeInvite"
                    b={b}
                    submit={c.revokeInvite}
                    tone="danger"
                    confirm={{ prompt: b.confirm.revokeInvite, action: b.confirm.revokeInviteAction }}
                  >
                    <input type="hidden" name="organizationId" value={id} />
                    <input type="hidden" name="invitationId" value={i.id} />
                  </ManagedForm>
                )}
              </li>
            ))}
          </ul>
        </section>
        <section className="bw-panel">
          <h2>{c.invite}</h2>
          <p className="bw-muted">{c.inviteHint}</p>
          <ManagedForm op="brandWorkspace.invite" b={b} submit={c.invite}>
            <input type="hidden" name="organizationId" value={id} />
            <label>
              {c.email}
              <input name="email" type="email" required />
            </label>
            <label>
              {c.scope}
              <select name="role">
                <option value="owner">{b.roles.owner}</option>
                <option value="editor">{b.roles.editor}</option>
                <option value="viewer">{b.roles.viewer}</option>
              </select>
              <span className="bw-muted">{c.scopeBrand}</span>
            </label>
          </ManagedForm>
        </section>
      </div>
      <ProductionAdmin organizationId={id} projects={projects} previews={previews} workspace={production} b={b}/>
      <section className="bw-panel" id="support">
        <h2>{c.supportTitle}</h2>
        <div className="bw-support-history">
          {messages.map((m) => (
            <article
              className="bw-support-bubble"
              data-author={m.authorRole}
              key={m.id}
            >
              <strong>
                {m.authorRole === "studio" ? b.dashboard.studio : org.name}
              </strong>
              <p>{m.body}</p>
              <time>{formatBrandTimestamp(m.createdAt, locale)}</time>
            </article>
          ))}
        </div>
        <ManagedForm op="brandWorkspace.support" b={b} submit={c.reply}>
          <input type="hidden" name="organizationId" value={id} />
          <label>
            {c.message}
            <textarea name="body" required maxLength={4000} />
          </label>
        </ManagedForm>
      </section>
    </AdminShell>
  );
}
