import { brandContext } from "@/components/brand-workspace/context";
import { ActionForm } from "@/components/brand-workspace/action-form";
import { loadBrandSettings } from "@/lib/brands/workspace/service";
import { brandScope } from "@/components/brand-workspace/scope";
import { BrandUnavailable } from "@/components/brand-workspace/brand-unavailable";
import { LogoControl } from "@/components/brand-workspace/logo-control";
import { BrandAvatar } from "@/components/brand-workspace/brand-avatar";
import { scopedHref, sectionVisibility } from "@/lib/brands/workspace/selection";
import { StaffNotice, adminOrganizationHref } from "@/components/brand-workspace/staff-notice";
export default async function BrandSettings({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  const [{ organizationId }, { sql, viewer, verifiedEmail, brandHost, b, locale }] = await Promise.all([
    searchParams,
    brandContext(),
  ]);
  if (!sql) return <p role="alert">{b.unavailable}</p>;
  const { selection, choice } = await brandScope({ sql, verifiedEmail }, viewer, organizationId);
  if (selection.state === "unavailable") return <BrandUnavailable b={b} />;
  // Brand settings are for members of the selected brand; a campaign-only guest has none to open.
  // The TWINGS team reads them here; edits stay with owners and the admin console.
  const org = choice && choice.role !== "guest" ? await loadBrandSettings({ sql, verifiedEmail }, viewer, choice.id) : null,
    c = b.managed,
    showIdentityBridge = Boolean(choice && sectionVisibility(choice).identity);
  return (
    <div data-brand-settings>
      <div className="bw-heading">
        <div>
          <h1>{c.settings}</h1>
          <p>{c.profileHint}</p>
        </div>
        {showIdentityBridge && (
          <a
            href={scopedHref("/brand/identity", choice)}
            className="bw-button"
            data-settings-identity-bridge
          >
            {locale === "en" ? "Brand DNA & AI Style Guide →" : "브랜드 미감 · AI 스타일 설정 →"}
          </a>
        )}
      </div>
      {showIdentityBridge && (
        <aside
          className="bw-note bw-row"
          data-settings-identity-callout
          style={{ marginBottom: "16px", padding: "12px 16px" }}
        >
          <div>
            <strong style={{ fontSize: "13.5px" }}>
              {locale === "en"
                ? "Organization Profile vs. AI Brand Style Guide"
                : "조직 기본 프로필과 AI 브랜드 스타일 가이드가 분리되어 있습니다"}
            </strong>
            <p className="bw-muted" style={{ margin: "2px 0 0", fontSize: "12.5px" }}>
              {locale === "en"
                ? "Manage your official organization name, website, contact email, and primary logo here. To configure AI studio colors, fonts, and Moods A/B/C, open the Brand tab."
                : "이 화면에서는 조직명·웹사이트·담당자 이메일·대표 로고를 관리합니다. 셀프 스튜디오에 적용할 컬러 팔레트·서체·미감 기조(A/B/C)는 [브랜드] 탭에서 설정하세요."}
            </p>
          </div>
          <a href={scopedHref("/brand/identity", choice)} className="bw-button">
            {locale === "en" ? "Open Brand Style →" : "브랜드 탭 열기 →"}
          </a>
        </aside>
      )}
      {!org ? (
        <section className="bw-empty" data-brand-settings-unavailable>
          <p>{!choice || choice.role === "guest" ? b.access.sharedOnly : b.denied}</p>
          <a href={scopedHref("/brand", choice)} className="bw-button">{b.back}</a>
        </section>
      ) : (
        <section className="bw-panel bw-settings-panel">
          {org.role === "studio" ? (
            <StaffNotice b={b} manageHref={viewer.isAdmin ? adminOrganizationHref(org.id, brandHost) : null} />
          ) : org.role !== "owner" && <p className="bw-note" data-brand-settings-read-only>{b.access.ownerOnlySettings}</p>}
          <ActionForm
            operation="organization.update"
            fixed={{ organizationId: org.id, expectedRevision: org.revision }}
            b={b}
            submit={b.save}
            disabled={org.role !== "owner"}
          >
            <fieldset disabled={org.role !== "owner"} className="bw-fields">
              <label>
                {b.organization}
                <input
                  name="name"
                  defaultValue={org.name}
                  minLength={2}
                  maxLength={100}
                  required
                />
              </label>
              <label>
                {c.website}
                <input
                  name="website"
                  type="url"
                  defaultValue={org.website}
                  maxLength={2048}
                  placeholder="https://"
                />
              </label>
              <label>
                {c.description}
                <textarea
                  name="description"
                  defaultValue={org.description}
                  maxLength={2000}
                  rows={4}
                />
              </label>
              <label>
                {c.contactEmail}
                <input
                  name="contactEmail"
                  type="email"
                  defaultValue={org.contactEmail}
                  maxLength={254}
                />
              </label>
            </fieldset>
          </ActionForm>
          <section className="bw-logo-section" aria-labelledby="brand-logo-heading" data-brand-logo>
            <h2 id="brand-logo-heading">{b.identity.logo}</h2>
            {org.role === "owner" ? (
              <LogoControl organizationId={org.id} name={org.name} logoUrl={org.logoUrl} logoRevision={org.logoRevision} b={b} />
            ) : (
              <div className="bw-logo-current">
                <BrandAvatar name={org.name} logoUrl={org.logoUrl} />
                {!org.logoUrl && <p className="bw-muted">{b.identity.logoNone}</p>}
              </div>
            )}
          </section>
        </section>
      )}
    </div>
  );
}
