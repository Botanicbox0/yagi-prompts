import { notFound } from "next/navigation";
import { roomRouteContext } from "@/components/brand-rooms/route-context";
import { RoomChannel } from "@/components/brand-rooms/chat";
import { ProjectFilesTab } from "@/components/brand-rooms/files";
import { RoomHeader, RoomTabs, type RoomTabLink } from "@/components/brand-rooms/room/room-header";
import { RoomOverview } from "@/components/brand-rooms/room/room-overview";
import { RoomRequestedLine } from "@/components/brand-rooms/room/room-requested";
import { roomHref } from "@/components/brand-rooms/room/visibility";
import {
  VISIBLE_ROOM_TABS,
  loadRoomBriefFiles,
  loadRoomOverview,
  loadRoomPeople,
  loadRoomProject,
  roomTab,
  type RoomTab,
} from "@/lib/brand-rooms/overview";
import { parseReviewTime } from "@/lib/brand-studio/review-contracts";
import { isProjectOnlyArchived, studioShowroomVisible } from "@/lib/brand-studio/visibility";
import { PROJECT_ONLY_RETENTION_DAYS } from "@/lib/brands/plans";
import { loadOrganizationStorageSummary } from "@/lib/brands/storage-quota";
import { scopedHref } from "@/lib/brands/workspace/selection";
import { brandStudioV2Open } from "@/lib/flags";

/**
 * `/brand/rooms/[projectId]` — one project's room (docs/BRAND-ROOMS.md §3, §7, slice H).
 *
 * The gate, in order: `roomRouteContext` (flag, sign-in, seat, the sandbox hardline and the generation
 * policy — each a 404), then this project: it belongs to the selected brand, the brand may see it, and a
 * campaign-only invitee was invited to it. Anything else is the same 404. The TWINGS team view follows
 * rooms from its own console, so it gets the 404 here too.
 *
 * Tabs by `?tab=`: 개요 (default) · 스토리보드 · 시안 · 대화. `?board=&frame=` open a cut, `?review=&t=` a
 * deliverable at a moment; they are handed to the tab that owns them.
 */
export const dynamic = "force-dynamic";

type Query = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined): string | undefined => {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && /^[0-9a-f-]{36}$/i.test(raw) ? raw : undefined;
};

export default async function ProjectRoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Query>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const ctx = await roomRouteContext(query.organizationId);
  const { choice, access, invitedProjectIds, dict, locale } = ctx;
  if (choice.role === "studio") notFound();
  // A campaign-only invitee is kept to the rooms of the campaigns they were invited to.
  if ((choice.role === "guest" || access.projectScopedOnly) && !invitedProjectIds.includes(projectId)) notFound();
  const sql = ctx.deps.sql;
  const project = await loadRoomProject(sql, choice.id, projectId);
  if (!project) notFound();

  const isProjectOnlyOrg = studioShowroomVisible(choice, true);
  const [people, overview, briefFiles, storageSummary] = await Promise.all([
    loadRoomPeople(sql, choice.id, project.id),
    loadRoomOverview(sql, { organizationId: choice.id, project, userId: ctx.userId }),
    loadRoomBriefFiles(sql, choice.id, project.id),
    isProjectOnlyOrg ? loadOrganizationStorageSummary(sql, choice.id).catch(() => null) : Promise.resolve(null),
  ]);
  const tab = roomTab(query.tab);
  const activeTab: RoomTab = tab === "storyboard" || tab === "review" ? "files" : tab;
  const retentionDays = storageSummary?.retentionDays ?? PROJECT_ONLY_RETENTION_DAYS;
  const archivedReadOnly = isProjectOnlyOrg && isProjectOnlyArchived(project, retentionDays);
  const canEdit = !archivedReadOnly && (choice.role === "owner" || choice.role === "editor");
  // Everyone seated in the room talks unless a project-only project has entered post-90d read-only archive mode.
  const canTalk = !archivedReadOnly;
  const href = (target: RoomTab, extra: Record<string, string> = {}) => roomHref(project.id, choice.id, target, extra);
  const counts: Record<RoomTab, number> = {
    overview: 0,
    files: overview.counts.storyboard + overview.counts.review,
    storyboard: overview.counts.storyboard,
    review: overview.counts.review,
    chat: overview.counts.chat,
  };
  const tabs: RoomTabLink[] = VISIBLE_ROOM_TABS.map((t) => ({ tab: t, href: href(t), count: counts[t] }));
  const shell = dict.roomsShell;

  const boardId = one(query.board);
  const frameId = one(query.frame);
  const reviewId = one(query.review);
  const commentId = one(query.comment);
  const atMs = parseReviewTime(query.t);
  // `?category=brief` opens 파일 on 기획서 (the overview's "낸 내용 보기").
  const briefCategory = (Array.isArray(query.category) ? query.category[0] : query.category) === "brief";
  const initialCategory =
    tab === "storyboard" || boardId ? "storyboard" : tab === "review" || reviewId ? "drafts" : briefCategory ? "brief" : "all";
  // The retention note matters once the work is delivered: a project-only room shows it only when completed.
  const retentionNotice = isProjectOnlyOrg && project.status === "completed";

  return (
    <div className="brr-room" data-project-room={project.id} data-room-tab-current={activeTab}>
      <RoomHeader
        project={project}
        people={people}
        copy={shell.room}
        statusLabel={dict.brandWorkspace.status[project.status]}
        backHref={scopedHref("/brand", choice)}
        detailHref={project.track === "creator_campaign" ? scopedHref(`/brand/projects/${project.id}`, choice) : null}
      />
      {retentionNotice && (
        <section
          className="bw-note"
          data-project-only-retention-notice
          data-project-only-archived={archivedReadOnly ? "true" : "false"}
        >
          <p style={{ margin: 0 }}>
            {archivedReadOnly ? shell.space.archivedNotice : shell.space.retentionNotice}{" "}
            {brandStudioV2Open() && choice.role !== "guest" && (
              <a href={scopedHref("/brand/studio", choice)} style={{ fontWeight: 600, color: "var(--ys-ink)", textDecoration: "underline", textUnderlineOffset: "3px" }}>
                {shell.space.retentionCta}
              </a>
            )}
          </p>
        </section>
      )}
      <RoomTabs tabs={tabs} current={activeTab} copy={shell.room} />
      <section className="brr-panel" data-room-panel={tab}>
        {activeTab === "overview" ? (
          <RoomOverview overview={overview} copy={shell.overview} locale={locale} href={href} />
        ) : activeTab === "files" ? (
          <ProjectFilesTab
            organizationId={choice.id}
            project={project}
            briefFiles={briefFiles}
            locale={locale}
            filesCopy={shell.files}
            intakeCopy={dict.intakeBrief}
            storyboardCopy={dict.roomsStoryboard}
            reviewCopy={dict.roomsReview}
            studioReviewCopy={dict.studioReview}
            chatCopy={dict.roomsChat}
            canEdit={canEdit}
            canTalk={canTalk}
            initialCategory={initialCategory}
            initialStoryboard={{ ...(boardId ? { boardId } : {}), ...(frameId ? { frameId } : {}) }}
            initialReview={{
              ...(reviewId ? { reviewId } : {}),
              ...(atMs !== null ? { atMs } : {}),
              ...(commentId ? { commentId } : {}),
            }}
          />
        ) : (
          <>
            <RoomRequestedLine project={project} copy={shell.overview} locale={locale} briefHref={href("files", { category: "brief" })} />
            <RoomChannel
              organizationId={choice.id}
              projectId={project.id}
              locale={locale}
              copy={dict.roomsChat}
              canTalk={canTalk}
              layout="flow"
            />
          </>
        )}
      </section>
    </div>
  );
}
