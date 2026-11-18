import "@/app/(brand)/workspace.css";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { brandRoomsOpen } from "@/lib/flags";
import { getLocaleFromHeaders } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { interpolate } from "@/lib/i18n/format";
import { AdminShell, OutcomeBanner } from "@/components/admin/chrome";
import { AdminPageHeader, AdminTable, StatusPill, type AdminTone } from "@/components/admin/patterns";
import { formatAdminTime, formatCount } from "@/lib/admin/format";
import { AdminRoomChannel } from "@/components/brand-rooms/chat/admin";
import { RoomDeskAck, RoomDeskChatButton, RoomDeskFrame } from "@/components/brand-rooms/desk/desk-frame";
import { AdminShareCreate, AdminShareRevoke } from "@/components/brand-rooms/share/admin-create";
import { AdminReviewStage } from "@/components/brand-studio/review/admin-stage";
import { DeliveryUpload } from "@/components/brand-studio/review/delivery-upload";
import { createStudioMediaStore } from "@/lib/brand-studio/media-store";
import { staffProjectStacks, staffReviewDetail } from "@/lib/brand-studio/review";
import { parseReviewTime, type ReviewStatus } from "@/lib/brand-studio/review-contracts";
import { acknowledgementLine, roomAdminPath, staffProjectDesk } from "@/lib/brand-rooms/messages";
import { GENERAL_CHANNEL, ROOM_DESK_TABS, roomDeskPath, type RoomDeskTab } from "@/lib/brand-rooms/message-contracts";
import { staffProjectShares } from "@/lib/brand-rooms/shares";
import type { ShareState } from "@/lib/brand-rooms/share-contracts";
import { staffStoryboardList } from "@/lib/brand-rooms/storyboards";
import { STORYBOARD_ADMIN_PATH, storyboardAdminHref, type StoryboardStatus } from "@/lib/brand-rooms/storyboard-contracts";

/**
 * `/admin/brand-rooms/[organizationId]/[projectId]` — the team's desk for one project
 * (docs/BRAND-ROOMS-FEEDBACK.md §4). Header: the project, its brand, its status, what waits for the team (the
 * customer's lines not answered yet, §3) and 확인함 with who pressed it last.
 *
 * List mode: the project's conversation on the left (the same `AdminRoomChannel`, its feed route and 4-second
 * poll), tabs on the right. 시안 — the deliverable stacks with every version's open notes (brand and team
 * counted apart) and the upload. 스토리보드 — the project's boards, each opening its own admin page. 공유 링크
 * — the project's links with the team's own create and turn-off (`brand_rooms.share.create` / `.revoke`).
 *
 * Review mode (`?review=<version>` on 시안): the version's stage takes the full width in page flow, in the same
 * frame as `/admin/brand-studio/reviews/[id]`, and the conversation is a drawer opened from the header.
 *
 * The tabs, versions and "닫기" move with client-side navigation, and `RoomDeskFrame` keeps the conversation
 * mounted in one place, so its draft, scroll and polling survive. `review` stays in the address on every tab,
 * so coming back to 시안 (or reloading) reopens the version.
 *
 * A sandboxed or generation-closed brand, another brand's project and a project the brand cannot see are
 * all a 404, like the flag being off.
 */
export const dynamic = "force-dynamic";

const REVIEW_TONES: Record<ReviewStatus, AdminTone> = { open: "action", changes_requested: "progress", approved: "done" };
const BOARD_TONES: Record<StoryboardStatus, AdminTone> = { draft: "hold", shared: "action", changes_requested: "progress", approved: "done" };
const SHARE_TONES: Record<ShareState, AdminTone> = { live: "action", expired: "hold", revoked: "done" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function projectTone(status: string): AdminTone {
  return status === "active" ? "action" : status === "requested" ? "progress" : "done";
}

export default async function AdminRoomDesk({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string; projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!brandRoomsOpen()) notFound();
  const [viewer, sql, locale, { organizationId, projectId }, search] = await Promise.all([requireAdmin(), getSqlRunner(), getLocaleFromHeaders(), params, searchParams]);
  const dict = getDictionary(locale);
  const c = dict.roomsChat;
  const d = dict.adminConsole.roomDesk;
  const rr = dict.roomsReview;
  const sr = dict.studioReview;
  const sb = dict.roomsStoryboard;
  if (!sql) return <p role="alert">{dict.brandWorkspace.unavailable}</p>;
  const desk = await staffProjectDesk({ sql }, viewer, organizationId, projectId);
  if (!desk.ok) notFound();
  const org = desk.organization;
  const project = desk.project;
  const roomLocale = locale === "en" ? "en" : "ko";
  const deps = { sql, media: createStudioMediaStore() };

  const askedTab = typeof search.tab === "string" ? search.tab : "drafts";
  const tab: RoomDeskTab = (ROOM_DESK_TABS as readonly string[]).includes(askedTab) ? (askedTab as RoomDeskTab) : "drafts";
  const askedReview = typeof search.review === "string" && UUID.test(search.review) ? search.review.toLowerCase() : null;

  // Every tab's count shows on the tabs, so the three lists are read on every visit (each one is small).
  const [stacked, boarded, linked] = await Promise.all([
    staffProjectStacks(deps, viewer, { organizationId: org.id, projectId: project.id }),
    staffStoryboardList(deps, viewer, { organizationId: org.id, projectId: project.id }),
    staffProjectShares(deps, viewer, { organizationId: org.id, projectId: project.id }),
  ]);
  const stacks = stacked.ok ? stacked.stacks : null;
  const boards = boarded.ok ? boarded.boards.filter((b) => b.projectId.toLowerCase() === project.id) : [];
  const links = linked.ok ? linked.shares : null;

  // The chosen version, only when it is one of this project's drafts. It stays in the address on every tab.
  const remembered = askedReview && stacks?.some((s) => s.versions.some((v) => v.id === askedReview)) ? askedReview : null;
  const detail = tab === "drafts" && remembered ? await staffReviewDetail(deps, viewer, remembered) : null;
  const chosen =
    detail && detail.ok && detail.review.organizationId.toLowerCase() === org.id && String(detail.review.projectId ?? "").toLowerCase() === project.id ? detail : null;
  const review = chosen !== null;

  const here = roomDeskPath(org.id, project.id, { tab, review: remembered });
  const tabs = ROOM_DESK_TABS.map((key) => ({
    key,
    label: d.tabs[key],
    href: roomDeskPath(org.id, project.id, { tab: key, review: remembered }),
    count: key === "drafts" ? (stacks ? stacks.length : null) : key === "storyboards" ? boards.length : links ? links.filter((l) => l.state === "live").length : null,
  }));
  const shareTargets = [
    ...(stacks ?? []).flatMap((s) => s.versions.map((v) => ({ value: `review:${v.id}`, label: interpolate(d.targetDraft, { title: v.title, version: v.version ?? 1 }) }))),
    ...boards.filter((b) => b.status !== "draft").map((b) => ({ value: `storyboard:${b.id}`, label: interpolate(d.targetBoard, { title: b.title, version: b.version }) })),
  ];
  const waitingLabel = interpolate(c.admin.waiting, { count: desk.teamUnread });

  // In review mode the waiting count rides on the "대화" button instead of the title (one number, one place).
  // 확인함 sits in the actions in both modes: what waits is what the team has not answered (§3), and opening
  // the conversation no longer clears it.
  const header = (
    <AdminPageHeader
      back={{ href: "/admin/brand-rooms", label: c.admin.back }}
      eyebrow={org.name}
      title={project.title}
      status={<StatusPill tone={projectTone(project.status)}>{dict.brandWorkspace.status[project.status as keyof typeof dict.brandWorkspace.status] ?? project.status}</StatusPill>}
      {...(!review && desk.teamUnread > 0 ? { count: formatCount(desk.teamUnread, locale), countLabel: waitingLabel } : {})}
      actions={
        <>
          <RoomDeskAck
            organizationId={org.id}
            channel={project.id}
            count={desk.teamUnread}
            back={here}
            acknowledged={acknowledgementLine(desk.acknowledged, d, (at) => formatAdminTime(at, locale))}
            copy={{ button: d.acknowledge, hint: d.acknowledgeHint, failed: d.acknowledgeFailed }}
          />
          <RoomDeskChatButton label={d.conversation} count={desk.teamUnread} countLabel={waitingLabel} />
          <a className="admin-btn" href={roomAdminPath(org.id, GENERAL_CHANNEL)} data-admin-desk-general>
            {d.generalConversation}
          </a>
          <a className="admin-btn" href={`/admin/brand-workspace/${project.id}`}>
            {d.projectPage}
          </a>
        </>
      }
    />
  );

  return (
    <AdminShell dict={dict.admin} locale={locale} active="brandWorkspace">
      <OutcomeBanner
        dict={dict.admin}
        ok={typeof search.ok === "string" ? search.ok : undefined}
        err={typeof search.err === "string" ? search.err : undefined}
        detail={typeof search.detail === "string" ? search.detail : undefined}
      />
      <div data-admin-room-desk={project.id} data-admin-desk-mode={review ? "review" : "list"}>
        <RoomDeskFrame
          review={review}
          header={header}
          labels={{ conversation: d.conversation, close: d.closeVersion }}
          conversation={
            <AdminRoomChannel
              organizationId={org.id}
              channel={project.id}
              locale={roomLocale}
              copy={c}
              channelName={project.title}
              header={
                <div className="brc-pane-head">
                  <div className="brc-pane-title">
                    <h2>{d.conversation}</h2>
                    <p>{c.admin.teamNote}</p>
                  </div>
                </div>
              }
            />
          }
        >
          <nav className="admin-filters" aria-label={d.work} data-admin-desk-tab={tab}>
            <ul>
              {tabs.map((t) => (
                <li key={t.key}>
                  <Link href={t.href} scroll={false} data-filter={t.key} aria-current={t.key === tab ? "true" : undefined}>
                    {t.label}
                    {t.count !== null ? <span className="admin-filter-count">{formatCount(t.count, locale)}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {tab === "drafts" && chosen && (
            <div className="brc-desk-review" data-admin-desk-stage={chosen.review.id}>
              <div className="brc-desk-review-bar">
                <Link className="admin-back" href={roomDeskPath(org.id, project.id)} scroll={false} data-admin-desk-close>
                  ← {d.closeVersion}
                </Link>
                <strong>{chosen.review.title}</strong>
              </div>
              {/* The same frame as /admin/brand-studio/reviews/[id]: the stage's own colours (review.css `.bsv-admin-frame`). */}
              <div className="bsv-admin-frame" data-admin-review-frame>
                <AdminReviewStage
                  key={chosen.review.id}
                  review={chosen.review}
                  comments={chosen.comments}
                  copy={sr}
                  locale={roomLocale}
                  eyebrow={org.name}
                  initialMs={parseReviewTime(typeof search.t === "string" ? search.t : undefined)}
                  extended={chosen.extended === true}
                  versions={chosen.versions}
                  teamCopy={dict.adminConsole.reviewTeam}
                  desk={{ organizationId: org.id, projectId: project.id }}
                />
              </div>
            </div>
          )}

          {tab === "drafts" &&
            !chosen &&
            (!stacks ? (
              <p role="status" data-admin-desk-drafts-unavailable>
                {d.draftsUnavailable}
              </p>
            ) : (
              <>
                {stacks.length > 0 && <p className="bw-muted mt-4">{d.pickVersion}</p>}
                <AdminTable
                  caption={rr.admin.stacksTitle}
                  columns={[
                    { key: "title", label: rr.admin.columns.title },
                    { key: "version", label: rr.admin.columns.version },
                    { key: "status", label: rr.admin.columns.status },
                    { key: "open", label: rr.admin.columns.open, numeric: true },
                    { key: "team", label: dict.adminConsole.reviewTeam.column, numeric: true },
                    { key: "source", label: rr.admin.columns.source },
                  ]}
                  rows={stacks.flatMap((s) =>
                    s.versions.map((v) => ({
                      key: v.id,
                      data: { "data-admin-desk-version": v.id },
                      cells: {
                        title: (
                          <Link href={roomDeskPath(org.id, project.id, { review: v.id })} className="admin-row-link">
                            <span>{v.title}</span>
                          </Link>
                        ),
                        version: `v${v.version ?? 1} / ${s.versions.length}`,
                        status: <StatusPill tone={REVIEW_TONES[v.status]}>{sr.status[v.status]}</StatusPill>,
                        open: `${formatCount(v.commentsOpen, locale)} / ${formatCount(v.commentsTotal, locale)}`,
                        // Team notes counted apart; the brand's numbers never include them.
                        team: `${formatCount(v.teamCommentsOpen ?? 0, locale)} / ${formatCount(v.teamCommentsTotal ?? 0, locale)}`,
                        source: rr.admin.sources[v.source ?? "studio"],
                      },
                    })),
                  )}
                  empty={rr.admin.noStacks}
                />
                <details className="bw-contract-add mt-4" data-admin-desk-upload open={stacks.length === 0}>
                  <summary>{d.uploadTitle}</summary>
                  <DeliveryUpload
                    organizationId={org.id}
                    projectId={project.id}
                    stacks={stacks.map((s) => ({ reviewId: s.versions[0]!.id, title: s.versions[0]!.title, version: s.versions[0]!.version ?? 1 }))}
                    copy={rr.admin}
                    landing="desk"
                  />
                </details>
              </>
            ))}

          {tab === "storyboards" && (
            <>
              <p className="bw-muted mt-4">{d.boardsHint}</p>
              <AdminTable
                caption={d.tabs.storyboards}
                columns={[
                  { key: "title", label: sb.admin.columns.title },
                  { key: "version", label: sb.admin.columns.version },
                  { key: "status", label: sb.admin.columns.status },
                  { key: "cuts", label: sb.admin.columns.cuts, numeric: true },
                  { key: "activity", label: sb.admin.columns.activity },
                ]}
                rows={boards.map((board) => ({
                  key: board.id,
                  data: { "data-admin-desk-storyboard": board.id },
                  cells: {
                    title: (
                      <a href={storyboardAdminHref(board.id)} className="admin-row-link">
                        <span>{board.title}</span>
                      </a>
                    ),
                    version: interpolate(sb.version, { n: board.version }),
                    status: <StatusPill tone={BOARD_TONES[board.status]}>{sb.status[board.status]}</StatusPill>,
                    cuts: formatCount(board.cuts, locale),
                    activity: formatAdminTime(board.updatedAt, locale),
                  },
                }))}
                empty={d.noBoards}
              />
              <p className="mt-4">
                <a className="admin-btn" href={`${STORYBOARD_ADMIN_PATH}?organizationId=${org.id}`}>
                  {d.newBoard}
                </a>
              </p>
            </>
          )}

          {tab === "links" &&
            (!links ? (
              <p role="status" data-admin-desk-links-unavailable>
                {d.linksUnavailable}
              </p>
            ) : (
              <>
                <AdminTable
                  caption={d.linksTitle}
                  columns={[
                    { key: "target", label: d.linkTarget },
                    { key: "state", label: rr.admin.shareColumns.state },
                    { key: "options", label: rr.admin.shareColumns.options },
                    { key: "views", label: rr.admin.shareColumns.views, numeric: true },
                    { key: "expires", label: rr.admin.shareColumns.expires },
                    { key: "by", label: rr.admin.shareColumns.by },
                    { key: "action", label: rr.admin.shareColumns.action },
                  ]}
                  rows={links.map((link) => ({
                    key: link.id,
                    data: { "data-admin-desk-share": link.id, "data-admin-desk-share-state": link.state },
                    cells: {
                      target: interpolate(link.kind === "review" ? d.targetDraft : d.targetBoard, { title: link.targetTitle || "—", version: link.targetVersion ?? 1 }),
                      state: <StatusPill tone={SHARE_TONES[link.state]}>{rr.share.state[link.state]}</StatusPill>,
                      options: [link.hasPassphrase && rr.share.withPassphrase, link.allowComments && rr.share.withComments, link.allowDownload && rr.share.withDownload].filter(Boolean).join(" · ") || "—",
                      views: formatCount(link.views, locale),
                      expires: formatAdminTime(link.expiresAt, locale),
                      by: rr.admin.madeBy[link.createdRole],
                      action:
                        link.state === "live" ? (
                          <AdminShareRevoke shareId={link.id} organizationId={org.id} projectId={project.id} back={here} label={rr.admin.revoke} failed={rr.share.errors.generic} />
                        ) : (
                          "—"
                        ),
                    },
                  }))}
                  empty={d.noLinks}
                />
                <section className="bw-contract-add mt-4" aria-label={d.createTitle}>
                  <h3>{d.createTitle}</h3>
                  <AdminShareCreate organizationId={org.id} projectId={project.id} back={here} targets={shareTargets} copy={rr.share} desk={d} />
                </section>
              </>
            ))}
        </RoomDeskFrame>
      </div>
    </AdminShell>
  );
}
