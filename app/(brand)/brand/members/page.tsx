import { brandContext } from "@/components/brand-workspace/context";
import { ActionForm } from "@/components/brand-workspace/action-form";
import { loadBrandMembers } from "@/lib/brands/workspace/service";
import { formatBrandTimestamp } from "@/components/brand-workspace/format";
import { interpolate } from "@/lib/i18n/format";
import { brandScope } from "@/components/brand-workspace/scope";
import { BrandUnavailable } from "@/components/brand-workspace/brand-unavailable";
import { scopedHref } from "@/lib/brands/workspace/selection";
import { StaffNotice, adminOrganizationHref } from "@/components/brand-workspace/staff-notice";
import { MemberUsageSection } from "@/components/brand-workspace/rail-usage";
import { brandStudioV2Open } from "@/lib/flags";
import { studioV2Visible } from "@/lib/brand-studio/visibility";
import { studioEnv } from "@/lib/brand-studio/env";
import { allowanceView, allowanceWindow, loadAllowance } from "@/lib/brand-studio/usage";
import { memberUsage } from "@/lib/brand-studio/member-usage";
import type { SqlRunner } from "@/lib/db/sql-runner";

/**
 * "이번 달 크레딧 사용" (docs/BRAND-STUDIO-V3.md §3): only while studio v2 is visible for this brand (flag
 * on, not sandboxed, generation allowed) and its monthly allowance is above 0. The caller has already
 * authorized the team view. A database without the studio tables hides the section instead of the page.
 */
async function teamCreditUsage(sql: SqlRunner, choice: { id: string; name: string; denied?: readonly string[] }) {
  if (!(brandStudioV2Open() && studioV2Visible(choice, true))) return null;
  try {
    const now = new Date();
    const allowance = await loadAllowance(sql, choice.id, studioEnv(), now);
    if (!(allowance.capKrw > 0)) return null;
    return { allowance: allowanceView(allowance), rows: await memberUsage(sql, choice.id, now, allowanceWindow(allowance, now)) };
  } catch (error) {
    console.warn("[brand-members] credit usage unavailable", error instanceof Error ? error.message.slice(0, 160) : "unknown");
    return null;
  }
}

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  const [{ organizationId }, { sql, viewer, verifiedEmail, brandHost, b, locale, dict }] = await Promise.all([
    searchParams,
    brandContext(),
  ]);
  const isKo = locale === "ko";
  if (!sql) return <p role="alert">{b.unavailable}</p>;
  const { selection, choice } = await brandScope({ sql, verifiedEmail }, viewer, organizationId);
  if (selection.state === "unavailable") return <BrandUnavailable b={b} />;
  // Team management follows the role in the SELECTED brand, never ownership of another one.
  // The TWINGS team reads the list; inviting and revoking stay with owners and the admin console.
  const staff = choice?.role === "studio";
  const team = choice?.role === "owner" || staff ? await loadBrandMembers({ sql, verifiedEmail }, viewer, choice!.id) : null;
  const activeMembers = team ? team.members.filter((m) => m.status === "active") : [];
  const creditUsage = team && choice ? await teamCreditUsage(sql, choice) : null;
  const orgInitial = (team?.organization.name ?? "B").trim().slice(0, 1).toUpperCase() || "B";
  return (
    <div data-brand-members className="bw-sota-team-shell">
      <div className="bw-heading">
        <div>
          <h1>{b.members}</h1>
          <p>{b.teamHint}</p>
        </div>
        {team && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <a href={scopedHref("/brand", choice)} className="bw-button">{b.back}</a>
          </div>
        )}
      </div>
      {!team ? (
        // Reaching this page without ownership is an expected state, not an error: say who can act.
        <section className="bw-empty" data-brand-members-unavailable>
          <p>
            {!choice || choice.role === "guest"
              ? b.access.sharedOnly
              : choice.role !== "owner"
                ? b.access.ownerOnlyTeam
                : b.denied}
          </p>
          <a href={scopedHref("/brand", choice)} className="bw-button">{b.back}</a>
        </section>
      ) : (
        <>
          {staff && <StaffNotice b={b} manageHref={viewer.isAdmin ? adminOrganizationHref(team.organization.id, brandHost) : null} />}

          {/* 1. SOTA Workspace Seat & Security Summary Bar */}
          <section
            className="bw-panel"
            data-team-summary-bar
            style={{
              padding: "12px 16px",
              marginBottom: 0,
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span className="bw-sota-avatar" aria-hidden="true">
                {orgInitial}
              </span>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <strong style={{ fontSize: "13.5px", color: "var(--ys-ink)" }}>
                    {team.organization.name}
                  </strong>
                  <span className="bw-pill">
                    {isKo ? `활동 멤버 ${activeMembers.length}명` : `${activeMembers.length} active`}
                  </span>
                  {team.invitations.length > 0 && (
                    <span className="bw-pill">
                      {isKo ? `초대 내역 ${team.invitations.length}건` : `${team.invitations.length} invites`}
                    </span>
                  )}
                </div>
                <p className="bw-muted" style={{ margin: "2px 0 0", fontSize: "11.5px" }}>
                  {isKo
                    ? "팀원을 초대해 에셋·스튜디오·캠페인을 역할별 권한으로 안전하게 공동 운영하세요."
                    : "Collaborate across your Assets, Studio, and Campaigns with role-scoped access."}
                </p>
              </div>
            </div>
            <span
              style={{
                padding: "4px 10px",
                borderRadius: "999px",
                background: "var(--ys-panel)",
                color: "var(--ys-ink-secondary)",
                fontSize: "11px",
                fontWeight: 600,
              }}
            >
              {b.inviteExpiry}
            </span>
          </section>

          {/* 2. SOTA Quick Invite Composer + Role Capabilities Matrix */}
          {!staff && (
            <section
              id="invite-composer"
              className="bw-panel"
              data-sota-invite-composer
              style={{ marginBottom: 0 }}
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                  marginBottom: "10px",
                }}
              >
                <div>
                  <h2 style={{ margin: 0 }}>{b.createInvite}</h2>
                  <p className="bw-muted" style={{ margin: "2px 0 0", fontSize: "11.5px" }}>
                    {b.inviteExpiry}
                  </p>
                </div>
                <span
                  style={{
                    fontSize: "11px",
                    color: "var(--ys-ink-secondary)",
                    fontFamily: "var(--ys-mono)",
                  }}
                >
                  {isKo ? "역할별 권한 안내" : "Role Permissions"}
                </span>
              </div>
              <ActionForm
                operation="invitation.create"
                fixed={{ organizationId: team.organization.id }}
                b={b}
                submit={b.createInvite}
              >
                <div className="bw-sota-invite-bar">
                  <label style={{ margin: 0 }}>
                    {b.inviteEmail}
                    <input
                      name="email"
                      type="email"
                      required
                      maxLength={254}
                      autoComplete="email"
                      placeholder="colleague@brand.com"
                    />
                  </label>
                  <label style={{ margin: 0 }}>
                    {b.role}
                    <select name="role">
                      <option value="editor">{b.roles.editor}</option>
                      <option value="viewer">{b.roles.viewer}</option>
                    </select>
                  </label>
                </div>
              </ActionForm>

              {/* Role Permission Matrix */}
              <div className="bw-sota-role-matrix" data-team-role-matrix>
                {(
                  [
                    {
                      roleKey: "owner",
                      title: b.roles.owner,
                      badgeKo: "전체 권한",
                      badgeEn: "Full Control",
                      permsKo: "스튜디오 생성 · 에셋 관리 · 캠페인 의뢰 · 팀원 초대 및 권한 관리",
                      permsEn: "Studio generation · Asset management · Campaign briefs · Team invite & revoke",
                    },
                    {
                      roleKey: "editor",
                      title: b.roles.editor,
                      badgeKo: "실무 제작·편집",
                      badgeEn: "Create & Edit",
                      permsKo: "스튜디오 이미지·영상 생성 · 1080p 업스케일 · 캠페인 시안 검수 및 피드백",
                      permsEn: "Studio image & video generation · 1080p mastering · Campaign review & feedback",
                    },
                    {
                      roleKey: "viewer",
                      title: b.roles.viewer,
                      badgeKo: "열람·다운로드",
                      badgeEn: "View & Export",
                      permsKo: "콘텐츠 보관함 열람 · 1080p 마스터 다운로드 · 캠페인 성과 리포트 확인 (생성·설정 제외)",
                      permsEn: "Content library viewing · 1080p master download · Campaign ROI reports (read-only)",
                    },
                  ] as const
                ).map((r) => (
                  <div
                    key={r.roleKey}
                    style={{
                      padding: "9px 11px",
                      borderRadius: "9px",
                      background: "var(--ys-subtle-bg)",
                      boxShadow: "inset 0 0 0 1px var(--ys-hairline)",
                      display: "grid",
                      gap: "3px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
                      <span style={{ fontSize: "11.5px", fontWeight: 700, color: "var(--ys-ink)" }}>{r.title}</span>
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 600,
                          color: "var(--ys-ink)",
                          background: "var(--ys-surface)",
                          padding: "2px 8px",
                          borderRadius: "999px",
                        }}
                      >
                        {isKo ? r.badgeKo : r.badgeEn}
                      </span>
                    </div>
                    <span style={{ fontSize: "11px", color: "var(--ys-ink-secondary)", lineHeight: 1.4 }}>
                      {isKo ? r.permsKo : r.permsEn}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 3. Active Members Directory */}
          <section className="bw-panel" style={{ marginBottom: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
              <h2 style={{ margin: 0 }}>{team.organization.name}</h2>
              <span className="bw-muted" style={{ fontSize: "11px" }}>
                {isKo ? `총 ${activeMembers.length}명` : `${activeMembers.length} members`}
              </span>
            </div>
            <ul className="bw-list">
              {activeMembers.map((m) => (
                <li className="bw-row" key={m.id}>
                  <div>
                    {/* Another owner's address stays private; the label alone says who it is. */}
                    <strong>{m.email ?? b.otherOwner}</strong>
                    {m.email !== null && <p className="bw-muted">{b.roles[m.role]}</p>}
                  </div>
                  {!staff && m.role !== "owner" && (
                    <ActionForm
                      operation="member.revoke"
                      fixed={{
                        organizationId: team.organization.id,
                        userId: m.userId,
                      }}
                      b={b}
                      submit={b.revoke}
                      tone="danger"
                      confirm={{ prompt: b.confirm.revokeMember, action: b.confirm.revokeMemberAction }}
                    />
                  )}
                </li>
              ))}
            </ul>
          </section>

          {/* Credits each member used this month (studio v2 brands with an allowance only). */}
          {creditUsage && (
            <MemberUsageSection
              rows={creditUsage.rows}
              members={team.members}
              allowance={creditUsage.allowance}
              copy={dict.studioShell.usage}
              otherOwner={b.otherOwner}
              locale={isKo ? "ko" : "en"}
            />
          )}

          {/* 4. Pending & Sent Invitations */}
          {team.invitations.length > 0 && (
            <section className="bw-panel" style={{ marginBottom: 0 }}>
              <h2>{b.invitations}</h2>
              <ul className="bw-list">
                {team.invitations.map((i) => (
                  <li key={i.id} className="bw-row">
                    <div>
                      {i.email ?? b.otherOwner}
                      <p className="bw-muted">
                        {i.project
                          ? i.project.title !== null ? interpolate(b.invitationCampaign, { title: i.project.title }) : b.invitationCampaignPending
                          : b.roles[i.role]}{" "}
                        · {b.expiresAt}{" "}
                        {formatBrandTimestamp(i.expiresAt, locale)}
                      </p>
                    </div>
                    <span className="bw-status">
                      {b.invitationStates[i.status]}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
