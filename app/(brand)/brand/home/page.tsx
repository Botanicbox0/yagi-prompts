import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { brandContext } from '@/components/brand-workspace/context';
import { brandScope, selectedAccess } from '@/components/brand-workspace/scope';
import { StaffNotice, adminOrganizationHref } from '@/components/brand-workspace/staff-notice';
import { WorkspaceHome } from '@/components/brand-workspace/home/home-view';
import { roomsOpenFor } from '@/components/brand-rooms/room/visibility';
import type { RoomAlertItem } from '@/components/brand-rooms/seams';
import { loadRoomSummary } from '@/lib/brand-rooms/messages';
import { studioEnv } from '@/lib/brand-studio/env';
import { createStudioMediaStore } from '@/lib/brand-studio/media-store';
import { jobsOf, viewsOf } from '@/lib/brand-studio/repo';
import { allowanceView, loadAllowance } from '@/lib/brand-studio/usage';
import { featureDenied, isSandboxedClientOrganization } from '@/lib/brands/features';
import { brandHomeVisible, homeActions, homeResults } from '@/lib/brands/workspace/home';
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
 */
export const dynamic = 'force-dynamic';

const RECENT_JOBS = 24;

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
  const actions = homeActions({ choice, flagOn: true, canRequest, rooms });
  const media = createStudioMediaStore();

  // Every read is scoped to the brand the guard above resolved for this account.
  const [allowance, jobs, summary] = await Promise.all([
    loadAllowance(sql, choice.id, studioEnv()).catch(() => null),
    jobsOf(sql, choice.id, RECENT_JOBS)
      .then((rows) => viewsOf(sql, rows, media))
      .catch(() => []),
    rooms ? loadRoomSummary({ sql }, viewer, choice.id).catch(() => null) : Promise.resolve(null),
  ]);
  const reviews: RoomAlertItem[] = summary && summary.ok ? (summary.alerts ?? []) : [];
  const studioLocale = locale === 'en' ? 'en' : 'ko';

  return (
    <WorkspaceHome
      organizationId={choice.id}
      organizationName={choice.name}
      locale={studioLocale}
      actions={actions}
      grouped={rooms}
      allowance={allowance ? allowanceView(allowance) : null}
      reviews={reviews}
      results={homeResults(jobs, choice.id)}
      readOnly={choice.role === 'viewer'}
      notice={access.staff ? <StaffNotice b={b} manageHref={viewer.isAdmin ? adminOrganizationHref(choice.id, brandHost) : null} /> : null}
      copy={{ home: dict.brandHome, shell: dict.studioShell, roomsNav: dict.roomsShell.nav, inbox: dict.roomsChat.inbox }}
    />
  );
}
