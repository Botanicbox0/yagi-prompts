import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { RAIL_MODE_COOKIE, parseRailModeCookie, rememberedRailMode, resolveRailMode, type RailMode } from '@/components/brand-workspace/rail-mode';
import { brandContext } from '@/components/brand-workspace/context';
import { brandScope, selectedAccess } from '@/components/brand-workspace/scope';
import { StaffNotice, adminOrganizationHref } from '@/components/brand-workspace/staff-notice';
import { WorkspaceHome } from '@/components/brand-workspace/home/home-view';
import { WorkspaceTeamHome, type TeamHomeProject } from '@/components/brand-workspace/home/team-home';
import { roomsOpenFor } from '@/components/brand-rooms/room/visibility';
import type { RoomAlertItem } from '@/components/brand-rooms/seams';
import { loadRoomSummary } from '@/lib/brand-rooms/messages';
import { loadRoomOverview, roomUnreadCounts } from '@/lib/brand-rooms/overview';
import { studioEnv } from '@/lib/brand-studio/env';
import { createStudioMediaStore } from '@/lib/brand-studio/media-store';
import { jobsOf, viewsOf } from '@/lib/brand-studio/repo';
import { allowanceView, loadAllowance } from '@/lib/brand-studio/usage';
import { featureDenied, isSandboxedClientOrganization } from '@/lib/brands/features';
import { brandHomeVisible, homeDoorPictures, homeLayout, homeResults, teamHomeProjects } from '@/lib/brands/workspace/home';
import { loadBrandWorkspace } from '@/lib/brands/workspace/service';
import { scopedHref } from '@/lib/brands/workspace/selection';
import { brandRoomsOpen, brandStudioV2Open } from '@/lib/flags';

/**
 * `/brand/home` — the workspace home (docs/BRAND-STUDIO-V3.md §12): what this brand can do (one card per
 * screen it actually has) and what is waiting for it (drafts to review in its project rooms, its newest
 * studio results). Where sign-in lands for a brand with the studio (`/brand/start`).
 *
 * The gate runs before any read: a sandboxed client (Morphic), a brand whose policy closes generative
 * media, an address naming a brand this account cannot open and a deployment with studio v2 off all get
 * a 404 that names nothing. A brand without the studio (project-only, a campaign-only guest, no brand
 * yet) is sent to `/brand`, its landing as before.
 *
 * Two homes, one per rail mode (components/brand-workspace/rail-mode.ts, founder 2026-11-20): 직접 만들기
 * gets the making home above; 야기 팀과 gets the team home (team-home.tsx): what waits on the person, the
 * projects with their stage and 새 프로젝트 의뢰, with nothing of the making side. The mode comes from the
 * same cookie the rail reads, on the server, so the page never flips after it loads.
 */
export const dynamic = 'force-dynamic';

const RECENT_JOBS = 24;

/** The rail mode this browser last used for this brand; null when the cookie is missing or unreadable. */
async function rememberedMode(organizationId: string): Promise<RailMode | null> {
  try {
    return rememberedRailMode(parseRailModeCookie((await cookies()).get(RAIL_MODE_COOKIE)?.value), organizationId);
  } catch {
    return null;
  }
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}): Promise<Metadata> {
  if (!brandStudioV2Open()) return {};
  const [{ organizationId }, { sql, viewer, verifiedEmail, dict }] = await Promise.all([searchParams, brandContext()]);
  if (!sql) return {};
  const { choice } = await brandScope({ sql, verifiedEmail }, viewer, organizationId);
  if (!brandHomeVisible(choice, true)) return {};
  return { title: dict.brandHome.title };
}

export default async function BrandWorkspaceHome({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  const [{ organizationId }, { sql, viewer, verifiedEmail, dict, locale, b, brandHost }] = await Promise.all([
    searchParams,
    brandContext(),
  ]);
  if (!sql) notFound();
  const { selection, choice, projectOrganizations } = await brandScope({ sql, verifiedEmail }, viewer, organizationId);
  if (selection.state === 'unavailable') notFound();
  // Sandbox first (hardline): nothing below may run for a sandboxed or generation-closed brand.
  if (choice && (isSandboxedClientOrganization(choice) || featureDenied(choice.denied, 'generative_media'))) notFound();
  if (!brandStudioV2Open()) notFound();
  if (!choice || !brandHomeVisible(choice, true)) redirect(scopedHref('/brand', choice));

  const access = selectedAccess(choice, Object.values(projectOrganizations).filter((o) => o === choice.id));
  const rooms = roomsOpenFor(choice, brandRoomsOpen());
  const canRequest = !access.staff && access.canRequest;
  const layout = homeLayout({ choice, flagOn: true, canRequest, rooms });
  if (!layout) notFound();
  // The rail's mode for this brand (rail-mode.ts): the home is shared by both sides, so the remembered
  // one decides which home this is. The TWINGS team view has no rooms in its rail, so no modes either.
  const modes = rooms && choice.role !== 'studio';
  const remembered = modes ? await rememberedMode(choice.id) : null;
  const mode = resolveRailMode({ studio: true, rooms: modes, path: '/brand/home', remembered }) ?? 'make';
  const viewerNote = choice.role === 'viewer';
  const notice = access.staff ? <StaffNotice b={b} manageHref={viewer.isAdmin ? adminOrganizationHref(choice.id, brandHost) : null} /> : null;

  if (mode === 'team') {
    // Every read is scoped to the brand the guard above resolved for this account. Nothing of the making
    // side is read: no credits, no runs.
    const [summary, workspace] = await Promise.all([
      loadRoomSummary({ sql }, viewer, choice.id).catch(() => null),
      loadBrandWorkspace({ sql, verifiedEmail }, viewer, { organizationId: choice.id }).catch(() => ({ organizations: [], projects: [] })),
    ]);
    const reviews: RoomAlertItem[] = summary && summary.ok ? (summary.alerts ?? []) : [];
    const visible = workspace.projects.filter((p) => p.clientVisible !== false);
    const unread = viewer.userId
      ? await roomUnreadCounts(sql, { organizationId: choice.id, userId: viewer.userId, projectIds: visible.map((p) => p.id) }).catch(() => ({}) as Record<string, number>)
      : ({} as Record<string, number>);
    const waiting: Record<string, number> = { ...unread };
    for (const alert of reviews) waiting[alert.projectId] = (waiting[alert.projectId] ?? 0) + 1;
    const shown = teamHomeProjects(visible, waiting);
    const projects: TeamHomeProject[] = await Promise.all(
      shown.map(async (p) => {
        const overview = await loadRoomOverview(sql, {
          organizationId: choice.id,
          project: { id: p.id, status: p.status, createdAt: p.createdAt, updatedAt: p.updatedAt, title: p.title },
          userId: viewer.userId ?? '',
        }).catch(() => null);
        return {
          id: p.id,
          title: p.title,
          stage: overview?.stage ?? 'requested',
          steps: overview?.steps ?? (['requested', 'storyboard', 'draft', 'revision', 'done'] as const).map((stage, i) => ({ stage, state: i === 0 ? 'current' : 'ahead', at: null }) as const),
          unread: unread[p.id] ?? 0,
        };
      }),
    );
    return (
      <WorkspaceTeamHome
        organizationId={choice.id}
        organizationName={choice.name}
        projects={projects}
        totalProjects={visible.filter((p) => p.status !== 'cancelled').length}
        reviews={reviews}
        canRequest={canRequest}
        viewerNote={viewerNote}
        notice={notice}
        copy={{
          home: dict.brandHome,
          nav: dict.roomsShell.nav,
          space: dict.roomsShell.space,
          overview: dict.roomsShell.overview,
          inbox: dict.roomsChat.inbox,
        }}
      />
    );
  }

  const media = createStudioMediaStore();
  // Every read is scoped to the brand the guard above resolved for this account.
  const [allowance, jobs, summary, workspace] = await Promise.all([
    loadAllowance(sql, choice.id, studioEnv()).catch(() => null),
    jobsOf(sql, choice.id, RECENT_JOBS)
      .then((rows) => viewsOf(sql, rows, media))
      .catch(() => []),
    rooms ? loadRoomSummary({ sql }, viewer, choice.id).catch(() => null) : Promise.resolve(null),
    loadBrandWorkspace({ sql, verifiedEmail }, viewer, { organizationId: choice.id }).catch(() => ({ organizations: [], projects: [] })),
  ]);
  const reviews: RoomAlertItem[] = summary && summary.ok ? (summary.alerts ?? []) : [];
  const activeProjects = workspace.projects.filter((p) => p.status === 'active').length;
  const studioLocale = locale === 'en' ? 'en' : 'ko';
  const dock = dict.brandStudio.dock;

  return (
    <WorkspaceHome
      organizationId={choice.id}
      organizationName={choice.name}
      locale={studioLocale}
      layout={layout}
      allowance={allowance ? allowanceView(allowance) : null}
      doors={homeDoorPictures(jobs, choice.id)}
      reviews={reviews}
      results={homeResults(jobs, choice.id)}
      activeProjects={activeProjects}
      // A viewer and the TWINGS team view cannot create here: no prompt bar. Only a viewer gets the note.
      readOnly={choice.role === 'viewer' || access.staff}
      viewerNote={choice.role === 'viewer'}
      notice={access.staff ? <StaffNotice b={b} manageHref={viewer.isAdmin ? adminOrganizationHref(choice.id, brandHost) : null} /> : null}
      copy={{
        home: dict.brandHome,
        shell: dict.studioShell,
        roomsNav: dict.roomsShell.nav,
        roomTabCounts: dict.roomsShell.room.tabCounts,
        roomStages: dict.roomsShell.overview.stages,
        inbox: dict.roomsChat.inbox,
        prompt: { label: dock.label, placeholder: { image: dock.placeholder, video: dock.placeholderVideo } },
        activeStatus: b.status.active,
      }}
    />
  );
}
