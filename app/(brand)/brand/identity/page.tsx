import { notFound } from "next/navigation";
import { ActionForm } from "@/components/brand-workspace/action-form";
import { BrandOnboardingWizard } from "@/components/brand-workspace/brand-onboarding-wizard";
import { BrandUnavailable } from "@/components/brand-workspace/brand-unavailable";
import { brandContext } from "@/components/brand-workspace/context";
import { formatBrandTimestamp } from "@/components/brand-workspace/format";
import { brandScope } from "@/components/brand-workspace/scope";
import {
  StaffNotice,
  adminOrganizationHref,
} from "@/components/brand-workspace/staff-notice";
import { featureDenied } from "@/lib/brands/features";
import {
  BRAND_LOOK_SOURCES,
  BRAND_MEMORY_KINDS,
  loadBrandIdentityWorkspace,
  twingsDefaultIdentity,
} from "@/lib/brands/identity/service";
import { scopedHref } from "@/lib/brands/workspace/selection";
import { contrast } from "@/lib/design/identity";
import { interpolate } from "@/lib/i18n/format";

const COLOUR_KEYS = [
  ["paper", "colourPaper"],
  ["canvas", "colourCanvas"],
  ["sky", "colourSky"],
  ["ink", "colourInk"],
  ["body", "colourBody"],
  ["muted", "colourMuted"],
  ["line", "colourLine"],
  ["lineStrong", "colourLineStrong"],
  ["accent", "colourAccent"],
] as const;

export default async function BrandIdentityPage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  const [{ organizationId }, { sql, viewer, verifiedEmail, brandHost, b, locale }] =
    await Promise.all([searchParams, brandContext()]);
  if (!sql) return <p role="alert">{b.unavailable}</p>;

  const { selection, choice } = await brandScope(
    { sql, verifiedEmail },
    viewer,
    organizationId
  );
  if (selection.state === "unavailable") return <BrandUnavailable b={b} />;
  if (
    choice &&
    (featureDenied(choice.denied, "brand_learning") ||
      featureDenied(choice.denied, "generative_media"))
  ) {
    notFound();
  }

  const t = b.identityLayer;

  if (!choice || choice.role === "guest") {
    return (
      <div data-brand-identity data-brand-identity-unavailable>
        <div className="bw-heading">
          <div>
            <p className="bw-kicker">{t.eyebrow}</p>
            <h1>{t.title}</h1>
            <p>{t.subtitle}</p>
          </div>
        </div>
        <section className="bw-empty">
          <p>{b.access.sharedOnly}</p>
          <a href={scopedHref("/brand", choice)} className="bw-button">
            {b.back}
          </a>
        </section>
      </div>
    );
  }

  const { identity: record, looks, memory } = await loadBrandIdentityWorkspace(
    sql,
    choice.id
  );
  const current = record?.identity ?? twingsDefaultIdentity();
  const isOwner = choice.role === "owner" || Boolean(viewer.isAdmin);
  const canEditMemory =
    choice.role === "owner" ||
    choice.role === "editor" ||
    Boolean(viewer.isAdmin);
  const accentContrast = contrast("#ffffff", current.colour.accent).toFixed(2);
  const statusLabel = record
    ? record.status === "confirmed"
      ? t.statusConfirmed
      : t.statusDraft
    : t.statusNone;

  return (
    <div
      data-brand-identity
      data-brand-identity-status={record?.status ?? "none"}
    >
      <div className="bw-heading">
        <div>
          <p className="bw-kicker">{t.eyebrow}</p>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
        <div className="bw-row">
          <span className="bw-badge" data-identity-status-badge>
            {statusLabel}
          </span>
          {record && (
            <span className="bw-muted">
              {interpolate(t.revisionBadge, {
                revision: String(record.revision),
              })}
            </span>
          )}
        </div>
      </div>

      {choice.role === "studio" ? (
        <StaffNotice
          b={b}
          manageHref={
            viewer.isAdmin ? adminOrganizationHref(choice.id, brandHost) : null
          }
        />
      ) : (
        !isOwner && (
          <p className="bw-note" data-brand-identity-read-only>
            {t.ownerOnlyHint}
          </p>
        )
      )}

      {!record && (
        <section className="bw-panel" data-brand-identity-empty>
          <h2>{t.emptyTitle}</h2>
          <p className="bw-muted">{t.emptyLead}</p>
          {isOwner && (
            <ActionForm
              operation="identity.draftDefaults"
              fixed={{ organizationId: choice.id, expectedRevision: 0 }}
              b={b}
              submit={t.startDraftCta}
              successNotice={t.savedNotice}
            />
          )}
        </section>
      )}

      {record && record.status === "draft" && isOwner && (
        <section className="bw-panel" data-brand-identity-confirm-bar>
          <div className="bw-row">
            <div>
              <strong>{t.statusDraft}</strong>
              <p className="bw-muted">{t.subtitle}</p>
            </div>
            <ActionForm
              operation="identity.confirm"
              fixed={{
                organizationId: choice.id,
                expectedRevision: record.revision,
              }}
              b={b}
              submit={t.confirmCta}
              successNotice={t.confirmedNotice}
            />
          </div>
        </section>
      )}

      <BrandOnboardingWizard
        organizationId={choice.id}
        organizationName={choice.name}
        locale={locale}
        isOwner={isOwner}
        currentStatus={record?.status ?? "none"}
        currentRevision={record?.revision ?? 0}
        studioHref={scopedHref("/brand/studio", choice)}
      />

      <section className="bw-panel" data-brand-identity-form>
        <ActionForm
          operation="identity.save"
          fixed={{
            organizationId: choice.id,
            expectedRevision: record?.revision ?? 0,
          }}
          b={b}
          submit={t.saveDraftCta}
          disabled={!isOwner}
          successNotice={t.savedNotice}
        >
          <div className="bw-fields">
            <h2>{t.colourSection}</h2>
            <p className="bw-muted">
              {t.colourHint} ·{" "}
              <strong data-accent-contrast>
                {interpolate(t.contrastLabel, { ratio: accentContrast })}
              </strong>
            </p>
            <div className="bw-grid-wide">
              {COLOUR_KEYS.map(([key, fieldName]) => (
                <label key={key}>
                  <span>
                    <span
                      aria-hidden="true"
                      style={{
                        display: "inline-block",
                        width: 12,
                        height: 12,
                        borderRadius: 3,
                        marginRight: 6,
                        verticalAlign: "middle",
                        backgroundColor: current.colour[key],
                        border: "1px solid #cfd5df",
                      }}
                    />
                    {t.colourFields[key]}
                  </span>
                  <input
                    name={fieldName}
                    defaultValue={current.colour[key]}
                    pattern="^#[0-9a-fA-F]{6}$"
                    maxLength={7}
                    required
                  />
                </label>
              ))}
            </div>

            <h2>{t.typeSection}</h2>
            <p className="bw-muted">{t.typeHint}</p>
            <div className="bw-grid-wide">
              <label>
                {t.typeSans}
                <input
                  name="typeSans"
                  defaultValue={current.type.sans}
                  maxLength={240}
                  required
                />
              </label>
              <label>
                {t.typeMono}
                <input
                  name="typeMono"
                  defaultValue={current.type.mono}
                  maxLength={240}
                  required
                />
              </label>
            </div>
            <div className="bw-grid-wide">
              <label>
                {t.displayScale}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                  <input
                    name="displayWeight"
                    type="number"
                    min={300}
                    max={900}
                    defaultValue={current.type.display.weight}
                    required
                  />
                  <input
                    name="displayTracking"
                    defaultValue={current.type.display.tracking}
                    maxLength={32}
                    required
                  />
                  <input
                    name="displayLeading"
                    type="number"
                    step="0.01"
                    min={0.85}
                    max={2.4}
                    defaultValue={current.type.display.leading}
                    required
                  />
                </div>
              </label>
              <label>
                {t.headingScale}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                  <input
                    name="headingWeight"
                    type="number"
                    min={300}
                    max={900}
                    defaultValue={current.type.heading.weight}
                    required
                  />
                  <input
                    name="headingTracking"
                    defaultValue={current.type.heading.tracking}
                    maxLength={32}
                    required
                  />
                  <input
                    name="headingLeading"
                    type="number"
                    step="0.01"
                    min={0.85}
                    max={2.4}
                    defaultValue={current.type.heading.leading}
                    required
                  />
                </div>
              </label>
              <label>
                {t.bodyScale}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                  <input
                    name="bodyWeight"
                    type="number"
                    min={300}
                    max={900}
                    defaultValue={current.type.body.weight}
                    required
                  />
                  <input
                    name="bodyTracking"
                    defaultValue={current.type.body.tracking}
                    maxLength={32}
                    required
                  />
                  <input
                    name="bodyLeading"
                    type="number"
                    step="0.01"
                    min={0.85}
                    max={2.4}
                    defaultValue={current.type.body.leading}
                    required
                  />
                </div>
              </label>
            </div>

            <h2>{t.worldSection}</h2>
            <p className="bw-muted">{t.worldHint}</p>
            <div className="bw-grid-wide">
              <label>
                {t.ownedHueMin}
                <input
                  name="ownedHueMin"
                  type="number"
                  min={0}
                  max={360}
                  defaultValue={current.world.ownedHue[0]}
                  required
                />
              </label>
              <label>
                {t.ownedHueMax}
                <input
                  name="ownedHueMax"
                  type="number"
                  min={0}
                  max={360}
                  defaultValue={current.world.ownedHue[1]}
                  required
                />
              </label>
              <label>
                {t.warmPerScreen}
                <input
                  name="warmPerScreen"
                  type="number"
                  min={0}
                  max={5}
                  defaultValue={current.world.warmPerScreen}
                  required
                />
              </label>
            </div>
            <p className="bw-muted">{t.skinProtectedBadge}</p>

            <h2>{t.rulesSection}</h2>
            <p className="bw-muted">{t.rulesHint}</p>
            <div className="bw-grid-wide">
              <label>
                {t.logoMinSize}
                <input
                  name="logoMinSizePx"
                  type="number"
                  min={12}
                  max={400}
                  defaultValue={current.rules.logo.minSizePx}
                  required
                />
              </label>
              <label>
                {t.logoClearSpace}
                <input
                  name="logoClearSpace"
                  defaultValue={current.rules.logo.clearSpace}
                  maxLength={80}
                  required
                />
              </label>
              <label>
                {t.logoPlacement}
                <input
                  name="logoPlacement"
                  defaultValue={current.rules.logo.placement.join(", ")}
                  required
                />
              </label>
            </div>
            <label className="bw-check">
              <input
                type="checkbox"
                name="paletteOnly"
                defaultChecked={current.rules.paletteOnly}
              />
              {t.paletteOnly}
            </label>
            <p className="bw-muted">{t.consentedFacesOnly}</p>
            <div className="bw-grid-wide">
              <label>
                {t.forbiddenTerms}
                <textarea
                  name="forbiddenTerms"
                  rows={3}
                  defaultValue={current.rules.forbiddenTerms.join("\n")}
                />
              </label>
              <label>
                {t.competitorExclusions}
                <textarea
                  name="competitorExclusions"
                  rows={3}
                  defaultValue={current.rules.competitorExclusions.join("\n")}
                />
              </label>
            </div>
            <label>
              {t.neverRules}
              <textarea
                name="neverRules"
                rows={3}
                defaultValue={current.rules.never.join("\n")}
              />
            </label>

            <h2>{t.referencesSection}</h2>
            <p className="bw-muted">{t.referencesHint}</p>
            <ul className="bw-list">
              {current.references.map((ref, idx) => (
                <li key={`${ref.role}-${idx}`} className="bw-row">
                  <div>
                    <strong>{t.referenceRoleLabels[ref.role]}</strong>
                    <p className="bw-muted">
                      {t.referenceLend}: {ref.lend}
                    </p>
                    <p className="bw-muted">
                      {t.referenceNot}: {ref.not}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <input
              type="hidden"
              name="referencesJson"
              defaultValue={JSON.stringify(current.references)}
            />

            <h2>{t.checklistSection}</h2>
            <p className="bw-muted">{t.checklistHint}</p>
            <label>
              {t.checklistSection}
              <textarea
                name="productChecklist"
                rows={4}
                defaultValue={current.productChecklist.join("\n")}
              />
            </label>

            <h2>{t.voiceSection}</h2>
            <div className="bw-grid-wide">
              <label>
                {t.voiceTone}
                <textarea
                  name="voiceTone"
                  rows={2}
                  defaultValue={current.voice.tone}
                  maxLength={400}
                  required
                />
              </label>
              <label>
                {t.voiceForbidden}
                <textarea
                  name="voiceForbiddenWords"
                  rows={2}
                  defaultValue={current.voice.forbiddenWords.join(", ")}
                />
              </label>
            </div>
          </div>
        </ActionForm>
      </section>

      <div className="bw-grid-wide">
        {!featureDenied(choice.denied, "color_grading") && (
        <section className="bw-panel" data-brand-looks>
          <h2>{t.looksSection}</h2>
          <p className="bw-muted">{t.looksHint}</p>
          {looks.length === 0 ? (
            <p className="bw-muted">{t.looksEmpty}</p>
          ) : (
            <ul className="bw-list">
              {looks.map((look) => (
                <li key={look.id} className="bw-row">
                  <div>
                    <strong>{look.title}</strong>
                    <p className="bw-muted">
                      {t.lookSources[look.source]} ·{" "}
                      {Math.round(look.intensity * 100)}%
                      {look.lutKey ? ` · ${look.lutKey}` : ""}
                      {look.skinProtect ? ` · ${t.lookSkinProtect}` : ""}
                    </p>
                  </div>
                  <time className="bw-muted">
                    {formatBrandTimestamp(look.createdAt, locale)}
                  </time>
                </li>
              ))}
            </ul>
          )}
          {canEditMemory && (
            <ActionForm
              operation="look.save"
              fixed={{ organizationId: choice.id }}
              b={b}
              submit={t.addLookCta}
            >
              <div className="bw-fields">
                <label>
                  {t.lookTitle}
                  <input name="title" maxLength={120} required />
                </label>
                <div className="bw-grid-wide">
                  <label>
                    {t.lookSource}
                    <select name="source" defaultValue="preset">
                      {BRAND_LOOK_SOURCES.map((src) => (
                        <option key={src} value={src}>
                          {t.lookSources[src]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t.lookIntensity}
                    <input
                      name="intensity"
                      type="number"
                      step="0.05"
                      min={0}
                      max={1}
                      defaultValue={1}
                      required
                    />
                  </label>
                </div>
                <label>
                  {t.lookLutKey}
                  <input name="lutKey" maxLength={160} />
                </label>
                <label className="bw-check">
                  <input type="checkbox" name="skinProtect" defaultChecked />
                  {t.lookSkinProtect}
                </label>
              </div>
            </ActionForm>
          )}
        </section>
        )}

        <section className="bw-panel" data-brand-memory>
          <h2>{t.memorySection}</h2>
          <p className="bw-muted">{t.memoryHint}</p>
          {memory.length === 0 ? (
            <p className="bw-muted">{t.memoryEmpty}</p>
          ) : (
            <ul className="bw-list">
              {memory.map((item) => {
                const summary =
                  typeof item.payload.summary === "string" &&
                  item.payload.summary
                    ? item.payload.summary
                    : JSON.stringify(item.payload);
                return (
                  <li key={item.id} className="bw-row">
                    <div>
                      <strong>{t.memoryKinds[item.kind]}</strong>
                      <p className="bw-muted">{summary}</p>
                    </div>
                    <time className="bw-muted">
                      {formatBrandTimestamp(item.createdAt, locale)}
                    </time>
                  </li>
                );
              })}
            </ul>
          )}
          {canEditMemory && (
            <ActionForm
              operation="memory.record"
              fixed={{ organizationId: choice.id }}
              b={b}
              submit={t.addMemoryCta}
            >
              <div className="bw-fields">
                <label>
                  {t.memoryKind}
                  <select name="kind" defaultValue="note">
                    {BRAND_MEMORY_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {t.memoryKinds[kind]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t.memorySummary}
                  <input name="summary" maxLength={400} required />
                </label>
              </div>
            </ActionForm>
          )}
        </section>
      </div>
    </div>
  );
}
