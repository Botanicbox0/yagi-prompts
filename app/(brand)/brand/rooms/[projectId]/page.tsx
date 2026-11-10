import { notFound } from "next/navigation";
import { roomRouteContext } from "@/components/brand-rooms/route-context";
import { RoomChannel } from "@/components/brand-rooms/chat";
import { StoryboardTab } from "@/components/brand-rooms/storyboard";
import { ProjectReviewTab } from "@/components/brand-rooms/review";
import { RoomHeader, RoomTabs, type RoomTabLink } from "@/components/brand-rooms/room/room-header";
import { RoomOverview } from "@/components/brand-rooms/room/room-overview";
import { roomHref } from "@/components/brand-rooms/room/visibility";
import { ROOM_TABS, loadRoomOverview, loadRoomPeople, loadRoomProject, roomTab, type RoomTab } from "@/lib/brand-rooms/overview";
import { parseReviewTime } from "@/lib/brand-studio/review-contracts";
import { scopedHref } from "@/lib/brands/workspace/selection";

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

  const [people, overview] = await Promise.all([
    loadRoomPeople(sql, choice.id, project.id),
    loadRoomOverview(sql, { organizationId: choice.id, project, userId: ctx.userId }),
  ]);
  const tab = roomTab(query.tab);
  const canEdit = choice.role === "owner" || choice.role === "editor";
  // Everyone seated in the room talks: owners, editors, viewers and invited guests (BRAND-ROOMS §9-1).
  const canTalk = true;
  const href = (target: RoomTab, extra: Record<string, string> = {}) => roomHref(project.id, choice.id, target, extra);
  const counts: Record<RoomTab, number> = {
    overview: 0,
    storyboard: overview.counts.storyboard,
    review: overview.counts.review,
    chat: overview.counts.chat,
  };
  const tabs: RoomTabLink[] = ROOM_TABS.map((t) => ({ tab: t, href: href(t), count: counts[t] }));
  const shell = dict.roomsShell;

  const boardId = one(query.board);
  const frameId = one(query.frame);
  const reviewId = one(query.review);
  const atMs = parseReviewTime(query.t);

  return (
    <div className="brr-room" data-project-room={project.id} data-room-tab-current={tab}>
      <RoomHeader
        project={project}
        people={people}
        copy={shell.room}
        statusLabel={dict.brandWorkspace.status[project.status]}
        backHref={scopedHref("/brand", choice)}
        detailHref={scopedHref(`/brand/projects/${project.id}`, choice)}
      />
      <RoomTabs tabs={tabs} current={tab} copy={shell.room} />
      <section className="brr-panel" data-room-panel={tab}>
        {tab === "overview" ? (
          <RoomOverview overview={overview} copy={shell.overview} locale={locale} href={href} />
        ) : tab === "storyboard" ? (
          <StoryboardTab
            organizationId={choice.id}
            projectId={project.id}
            locale={locale}
            copy={dict.roomsStoryboard}
            chatCopy={dict.roomsChat}
            shareCopy={dict.roomsReview}
            canEdit={canEdit}
            canTalk={canTalk}
            initial={{ ...(boardId ? { boardId } : {}), ...(frameId ? { frameId } : {}) }}
          />
        ) : tab === "review" ? (
          <ProjectReviewTab
            organizationId={choice.id}
            projectId={project.id}
            locale={locale}
            copy={dict.roomsReview}
            reviewCopy={dict.studioReview}
            chatCopy={dict.roomsChat}
            canEdit={canEdit}
            canTalk={canTalk}
            initial={{ ...(reviewId ? { reviewId } : {}), ...(atMs !== null ? { atMs } : {}) }}
          />
        ) : (
          <RoomChannel
            organizationId={choice.id}
            projectId={project.id}
            locale={locale}
            copy={dict.roomsChat}
            canTalk={canTalk}
            layout="flow"
          />
        )}
      </section>
    </div>
  );
}
