import { ProductionAdmin } from '@/components/brand-workspace/production-admin';
import { loadProductionWorkspace } from '@/lib/brands/production/service';
import { loadStudioWorkspace } from '@/lib/brands/workspace/service';
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
import {
  AdminPageHeader,
  MetricStrip,
  SectionJumpBar,
  StatusPill,
} from "@/components/admin/patterns";
import { ManagedForm } from "@/components/brand-workspace/managed-form";
import { formatBrandTimestamp } from "@/components/brand-workspace/format";
import { BrandAvatar } from "@/components/brand-workspace/brand-avatar";
import { interpolate } from "@/lib/i18n/format";
import { BRAND_FEATURES } from "@/lib/brands/features";
import { loadFeaturePolicy } from "@/lib/brands/entitlements";
import {
  listLooks,
  listMemory,
  loadBrandIdentity,
  twingsDefaultIdentity,
} from "@/lib/brands/identity/service";
import {
  BRAND_BILLING_MODES,
  BRAND_PLAN_IDS,
  BRAND_PLANS,
  loadPlanAssignment,
} from "@/lib/brands/plans";
import { MICRO_ROI_MODES } from "@/lib/brands/finish/micro-roi";
import { BRAND_LOOK_PRESET_IDS } from "@/lib/brands/finish/color-grading";
import { resolveCategoryExperienceProfile } from "@/lib/brands/category-experience";
import { BrandStudioAllowancePanel } from "@/lib/admin/brand-studio-allowance-panel";

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
    c = b.managed,
    be = dict.adminConsole.brandEngine;
  if (!sql) return <p role="alert">{b.unavailable}</p>;
  const org = await loadStudioBrandAccess({ sql }, viewer, id);
  if (!org) notFound();
  const messages = (await loadBrandSupport({ sql }, viewer, id, true)) ?? [];
  const previews = (
    await sql.query<{ id: string; project_id: string; name: string }>(
      "select id,project_id,name from brand_attachments where organization_id=$1 and status='ready' and access_scope='workspace' and (mime like 'image/%' or mime like 'video/%')",
      [id]
    )
  ).rows;
  const production = await loadProductionWorkspace({ sql }, viewer, id, true);
  const projects = (await loadStudioWorkspace({ sql }, viewer)).projects.filter(
    (p) => p.organizationId === id
  );
  // docs/BRAND-PRODUCT.md — the brand engine's studio controls: the deny-list, the plan, and the identity layer.
  const [policy, plan, brandIdentity, looks, memoryEvents] = await Promise.all([
    loadFeaturePolicy(sql, id),
    loadPlanAssignment(sql, id),
    loadBrandIdentity(sql, id),
    listLooks(sql, id),
    listMemory(sql, id, 12),
  ]);
  const activeIdentity = brandIdentity?.identity ?? twingsDefaultIdentity();
  const categoryProfile = resolveCategoryExperienceProfile({ organizationName: org.name });
  const krw = new Intl.NumberFormat("ko-KR");
  const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  return (
    <AdminShell dict={dict.admin} locale={locale} active="brandWorkspace">
      <AdminPageHeader
        back={{ href: "/admin/brand-workspace", label: b.back }}
        title={org.name}
        status={
          <StatusPill
            tone={
              brandIdentity?.status === "confirmed"
                ? "action"
                : brandIdentity
                  ? "progress"
                  : "hold"
            }
          >
            {brandIdentity
              ? `${be.dnaStatus[brandIdentity.status]} · r${brandIdentity.revision}`
              : be.dnaStatus.none}
          </StatusPill>
        }
        lede={c.access}
      />

      <SectionJumpBar
        label={dict.adminConsole.location}
        items={[
          { id: "brand-dna-inspector", label: be.sections.overview },
          {
            id: "brand-entitlements",
            label: be.sections.entitlements,
            count: policy.denied.length,
            tone: policy.denied.length > 0 ? "hold" : "done",
          },
          { id: "brand-identity-editor", label: be.sections.identity },
          {
            id: "brand-members",
            label: be.sections.members,
            count: org.members.length + org.invitations.length,
          },
          {
            id: "support",
            label: c.supportTitle,
            count: messages.length,
          },
        ]}
      />

      <MetricStrip
        label={be.inspectorHeading}
        items={[
          {
            key: "plan",
            label: be.columns.plan,
            value: plan ? b.planNames[plan.planId] : be.planUnassigned,
            sub: plan
              ? `₩${krw.format(BRAND_PLANS[plan.planId].monthlyKrw)} · ${b.billingModes[plan.billingMode]}`
              : c.planNone,
            tone: plan ? "action" : "hold",
          },
          {
            key: "policy",
            label: be.columns.blocked,
            value:
              policy.denied.length === 0
                ? be.allOpen
                : interpolate(be.blockedCount, {
                    count: String(policy.denied.length),
                  }),
            sub:
              policy.denied.length > 0
                ? policy.denied.map((f) => b.features[f]).join(", ")
                : c.featurePolicyOpen,
          },
          {
            key: "identity",
            label: be.columns.identity,
            value: brandIdentity
              ? be.dnaStatus[brandIdentity.status]
              : be.dnaStatus.none,
            sub: brandIdentity
              ? `v${brandIdentity.version} · rev ${brandIdentity.revision}`
              : c.identityNone,
          },
          {
            key: "engine",
            label: be.pipelineReadiness,
            value: `${looks.length + BRAND_LOOK_PRESET_IDS.length} looks · ${MICRO_ROI_MODES.length} ROI modes`,
            sub: `${memoryEvents.length} ${be.memoryEvents.toLowerCase()}`,
          },
        ]}
      />

      {/* S1–S5 Structured Brand Engine & Identity DNA Inspector */}
      <section
        id="brand-dna-inspector"
        className="admin-spec-card"
        data-brand-identity-inspector
      >
        <div className="admin-spec-head">
          <div>
            <h2>{be.inspectorHeading}</h2>
            <p className="admin-field-hint mt-1">{be.inspectorLede}</p>
          </div>
          <StatusPill
            tone={brandIdentity?.status === "confirmed" ? "action" : "progress"}
          >
            {brandIdentity
              ? `${be.dnaStatus[brandIdentity.status]} (r${brandIdentity.revision})`
              : `${be.dnaStatus.none} (TWINGS Default)`}
          </StatusPill>
        </div>

        <div className="admin-card-grid">
          <div className="admin-subcard" data-dna-colour-world>
            <h3>{be.colourWorld}</h3>
            <div className="admin-swatch-row">
              {(
                [
                  ["Paper", activeIdentity.colour.paper],
                  ["Canvas", activeIdentity.colour.canvas],
                  ["Ink", activeIdentity.colour.ink],
                  ["Accent", activeIdentity.colour.accent],
                ] as const
              ).map(([name, hex]) => (
                <span key={name} className="admin-swatch">
                  <span
                    className="admin-swatch-chip"
                    style={{ backgroundColor: hex }}
                    aria-hidden="true"
                  />
                  <span>
                    {name} <code>{hex}</code>
                  </span>
                </span>
              ))}
            </div>
            <p className="mt-2.5">
              Hue {activeIdentity.world.ownedHue[0]}°–
              {activeIdentity.world.ownedHue[1]}° · Warm max{" "}
              {activeIdentity.world.warmPerScreen} · Skin lock{" "}
              {String(activeIdentity.world.skinProtected)}
            </p>
          </div>

          <div className="admin-subcard" data-dna-hardlines>
            <h3>{be.hardlines}</h3>
            <p>
              <strong>{be.forbiddenWords}:</strong>{" "}
              {activeIdentity.rules.forbiddenTerms.length > 0
                ? activeIdentity.rules.forbiddenTerms.join(", ")
                : "—"}
            </p>
            <p>
              <strong>Never:</strong>{" "}
              {activeIdentity.rules.never.length > 0
                ? activeIdentity.rules.never.join(" · ")
                : "—"}
            </p>
            <p>
              <strong>Logo:</strong> min {activeIdentity.rules.logo.minSizePx}px
              · clear {activeIdentity.rules.logo.clearSpace} · faces consented
              only
            </p>
          </div>

          <div className="admin-subcard" data-dna-model-roles>
            <h3>{be.modelRouting}</h3>
            <p>
              <strong>Category Profile:</strong> {categoryProfile.labelKo} ({categoryProfile.category}) · {categoryProfile.compiler.defaultOledLookId} ({categoryProfile.compiler.defaultLightColourK}K)
            </p>
            <p>
              <strong>Editorial:</strong> {activeIdentity.modelRoles.editorial}
            </p>
            <p>
              <strong>Reference & Face:</strong>{" "}
              {activeIdentity.modelRoles.referenceExact} /{" "}
              {activeIdentity.modelRoles.faceAndEdit}
            </p>
            <p>
              <strong>Film:</strong> {activeIdentity.modelRoles.film}
            </p>
            <p>
              <strong>Swap:</strong> {activeIdentity.modelRoles.swap}
            </p>
          </div>

          <div className="admin-subcard" data-dna-pipeline-readiness>
            <h3>{be.pipelineReadiness}</h3>
            <p>
              <strong>{be.microRoiModes}:</strong> {MICRO_ROI_MODES.length}{" "}
              modes ({MICRO_ROI_MODES.slice(0, 3).join(", ")}…)
            </p>
            <p>
              <strong>{be.savedLooks}:</strong> {looks.length} custom +{" "}
              {BRAND_LOOK_PRESET_IDS.length} presets
            </p>
            <p>
              <strong>{be.memoryEvents}:</strong> {memoryEvents.length} recorded
              {memoryEvents[0] ? ` (latest: ${memoryEvents[0].kind})` : ""}
            </p>
          </div>
        </div>
      </section>

      {/* The brand's own logo, before or without any campaign. Same inspected, private path as owners use. */}
      <section className="bw-panel bw-logo-section" data-brand-logo>
        <h2>{b.identity.logo}</h2>
        <div className="bw-logo-current">
          <BrandAvatar name={org.name} logoUrl={org.logoUrl} />
          {!org.logoUrl && <p className="bw-muted">{b.identity.logoNone}</p>}
        </div>
        <ManagedForm op="brandWorkspace.logo" b={b} submit={b.identity.logoUpload}>
          <input type="hidden" name="organizationId" value={id} />
          <input type="hidden" name="expectedRevision" value={org.logoRevision} />
          <label>
            {b.identity.logoFile}
            <input name="file" type="file" accept="image/png,image/jpeg,image/webp" required />
          </label>
          <p className="bw-muted">{b.identity.logoHint}</p>
        </ManagedForm>
        {org.logoUrl && (
          <ManagedForm
            op="brandWorkspace.logoRemove"
            b={b}
            submit={b.identity.logoRemove}
            tone="danger"
            confirm={{ prompt: b.identity.logoRemoveConfirm, action: b.identity.logoRemove }}
          >
            <input type="hidden" name="organizationId" value={id} />
            <input type="hidden" name="expectedRevision" value={org.logoRevision} />
          </ManagedForm>
        )}
      </section>
      <div id="brand-members" className="bw-grid-wide">
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
                    {m.projectId && <> · {m.canComment ? c.canComment : c.readOnly}</>}
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
                    {i.projectId && <> · {i.canComment ? c.canComment : c.readOnly}</>}
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
      <div id="brand-entitlements" className="bw-grid-wide">
        <section className="bw-panel" data-brand-feature-policy>
          <h2>{c.featurePolicy}</h2>
          <p className="bw-muted">{c.featurePolicyHint}</p>
          <p data-brand-feature-policy-state={policy.denied.length}>
            {policy.denied.length === 0 ? c.featurePolicyOpen : interpolate(c.featurePolicyClosed, { count: String(policy.denied.length) })}
          </p>
          <ManagedForm op="brandEngine.featurePolicy" b={b} submit={c.featurePolicySave}>
            <input type="hidden" name="organizationId" value={id} />
            <input type="hidden" name="expectedRevision" value={policy.revision} />
            <fieldset className="bw-fields">
              {BRAND_FEATURES.map((feature) => (
                <label key={feature} className="bw-check">
                  <input type="checkbox" name="denied" value={feature} defaultChecked={policy.denied.includes(feature)} />
                  {b.features[feature]}
                </label>
              ))}
            </fieldset>
            <label>
              {c.featurePolicyNote}
              <input name="note" defaultValue={policy.note} maxLength={500} />
            </label>
          </ManagedForm>
        </section>
        <section className="bw-panel" data-brand-plan>
          <h2>{c.plan}</h2>
          <p className="bw-muted">{c.planHint}</p>
          <p data-brand-plan-state={plan?.planId ?? "none"}>
            {plan
              ? `${interpolate(c.planCurrent, { plan: b.planNames[plan.planId], price: krw.format(BRAND_PLANS[plan.planId].monthlyKrw), billing: b.billingModes[plan.billingMode], from: plan.startedOn })}${plan.endsOn ? ` · ${interpolate(c.planUntil, { until: plan.endsOn })}` : ""}`
              : c.planNone}
          </p>
          <ManagedForm op="brandEngine.plan" b={b} submit={c.planSave}>
            <input type="hidden" name="organizationId" value={id} />
            <input type="hidden" name="expectedRevision" value={plan?.revision ?? 0} />
            <label>
              {c.planId}
              <select name="planId" defaultValue={plan?.planId ?? "b2b_29"}>
                {BRAND_PLAN_IDS.map((planId) => (
                  <option key={planId} value={planId}>
                    {b.planNames[planId]} · {krw.format(BRAND_PLANS[planId].monthlyKrw)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {c.billingMode}
              <select name="billingMode" defaultValue={plan?.billingMode ?? "invoice"}>
                {BRAND_BILLING_MODES.map((mode) => (
                  <option key={mode} value={mode}>{b.billingModes[mode]}</option>
                ))}
              </select>
            </label>
            <label>
              {c.startedOn}
              <input name="startedOn" type="date" defaultValue={plan?.startedOn ?? today} required />
            </label>
            <label>
              {c.endsOn}
              <input name="endsOn" type="date" defaultValue={plan?.endsOn ?? ""} />
            </label>
            <label>
              {c.seats}
              <input name="seats" type="number" min={1} max={1000} defaultValue={plan?.seats ?? ""} />
            </label>
            <label>
              {c.planNote}
              <input name="note" defaultValue={plan?.note ?? ""} maxLength={500} />
            </label>
          </ManagedForm>
        </section>
        <BrandStudioAllowancePanel sql={sql} organizationId={id} b={b} locale={locale} />
      </div>
      <section id="brand-identity-editor" className="bw-panel" data-brand-identity-admin>
        <h2>{c.identityTitle}</h2>
        <p className="bw-muted">{c.identityHint}</p>
        <p data-brand-identity-state={brandIdentity?.status ?? "none"}>
          {brandIdentity
            ? interpolate(c.identityCurrent, {
                status:
                  brandIdentity.status === "confirmed"
                    ? b.identityLayer.statusConfirmed
                    : b.identityLayer.statusDraft,
                version: brandIdentity.version,
                revision: String(brandIdentity.revision),
              })
            : c.identityNone}
        </p>
        {brandIdentity && (
          <details className="bw-details">
            <summary>{c.identityJsonSummary}</summary>
            <pre className="bw-code">
              {JSON.stringify(brandIdentity.identity, null, 2)}
            </pre>
          </details>
        )}
        <div className="bw-form-actions">
          <ManagedForm op="brandEngine.identityDraft" b={b} submit={c.identityDraftCta}>
            <input type="hidden" name="organizationId" value={id} />
            <input type="hidden" name="expectedRevision" value={brandIdentity?.revision ?? 0} />
          </ManagedForm>
          {brandIdentity && brandIdentity.status !== "confirmed" && (
            <ManagedForm op="brandEngine.identityConfirm" b={b} submit={c.identityConfirmCta}>
              <input type="hidden" name="organizationId" value={id} />
              <input type="hidden" name="expectedRevision" value={brandIdentity.revision} />
            </ManagedForm>
          )}
        </div>
      </section>
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
