import 'server-only';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { CampaignListRooms } from '@/components/brand-workspace/campaign-list';
import { brandContext } from '@/components/brand-workspace/context';
import { brandScope, selectedAccess } from '@/components/brand-workspace/scope';
import { roomUnreadCounts } from '@/lib/brand-rooms/overview';
import { campaignOpsOpenForViewer } from '@/lib/brands/workspace/campaign-ops';
import { loadBrandWorkspace } from '@/lib/brands/workspace/service';
import { brandRoomsOpen, brandStudioV2Open } from '@/lib/flags';
import { splitProjectsByKind, type CampaignOpsKind } from './model';
import { CampaignOpsPageView } from './page-view';

export async function getCampaignOpsMetadata(
  kind: CampaignOpsKind,
  searchParams: Promise<{ organizationId?: string | string[] }>,
): Promise<Metadata> {
  if (!brandStudioV2Open() || !brandRoomsOpen()) return {};
  const [{ organizationId }, { sql, viewer, verifiedEmail, dict }] = await Promise.all([
    searchParams,
    brandContext(),
  ]);
  if (!sql) return {};
  const { selection, choice } = await brandScope({ sql, verifiedEmail }, viewer, organizationId);
  if (selection.state === 'unavailable' || !campaignOpsOpenForViewer(choice)) {
    return {};
  }
  return { title: dict.campaignOps.rail[kind] };
}

export async function renderCampaignOpsPage(
  kind: CampaignOpsKind,
  searchParams: Promise<{ organizationId?: string | string[] }>,
) {
  if (!brandStudioV2Open() || !brandRoomsOpen()) return notFound();
  const [{ organizationId }, { sql, viewer, verifiedEmail, b, dict, locale }] = await Promise.all([
    searchParams,
    brandContext(),
  ]);
  if (!sql) return notFound();
  const { selection, choice } = await brandScope({ sql, verifiedEmail }, viewer, organizationId);
  if (selection.state === 'unavailable' || !choice || !campaignOpsOpenForViewer(choice)) {
    return notFound();
  }

  const workspace = await loadBrandWorkspace({ sql, verifiedEmail }, viewer, { organizationId: choice.id });
  const access = selectedAccess(choice, workspace.projects);
  const items = splitProjectsByKind(workspace.projects, kind);
  const unread =
    items.length > 0
      ? await roomUnreadCounts(sql, {
          organizationId: choice.id,
          userId: viewer.userId ?? '',
          projectIds: items.map((p) => p.id),
        })
      : {};
  const rooms: CampaignListRooms = {
    organizationId: choice.id,
    unread,
    copy: dict.roomsShell.entry,
    list: dict.roomsShell.space.list,
  };

  return (
    <CampaignOpsPageView
      kind={kind}
      organizationId={choice.id}
      projects={items}
      canRequest={access.canRequest}
      locale={locale === 'en' ? 'en' : 'ko'}
      copy={dict.campaignOps}
      b={b}
      rooms={rooms}
      trackLabels={dict.roomsShell.room.tracks}
    />
  );
}
