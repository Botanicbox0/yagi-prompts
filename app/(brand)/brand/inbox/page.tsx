import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SendInboxPage } from '@/components/brand-send/inbox-page';
import { pickSendCopy } from '@/components/brand-send/model';
import { brandContext } from '@/components/brand-workspace/context';
import { brandScope } from '@/components/brand-workspace/scope';
import { brandSendOpenFor, brandSendSwitchesOn } from '@/lib/brand-rooms/members-channel';
import { brandSendInviteOpenFor } from '@/lib/brand-rooms/send-invite';
import { runSendOperation } from '@/lib/brand-rooms/send';
import type { SendInboxPage as SendInboxPageData, SendInboxView, SendThreadPage } from '@/lib/brand-rooms/send-contracts';
import { memberSeesBrandProjects } from '@/lib/brand-studio/brand-projects';
import { createStudioMediaStore } from '@/lib/brand-studio/media-store';
import { studioV2Visible } from '@/lib/brand-studio/visibility';
import { brandStudioV2Open } from '@/lib/flags';

/**
 * `/brand/inbox` — the workspace 알림함 (docs/BRAND-PROJECT-SPINE.md §8; slice 4b).
 * Opens only when studio v2, member project spine, and `brandSendOpenFor` are all open for the
 * chosen brand organization and active member seat; otherwise answers 404.
 */
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function firstParam(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}): Promise<Metadata> {
  if (!brandStudioV2Open() || !brandSendSwitchesOn()) return {};
  const [{ organizationId }, { sql, viewer, verifiedEmail, dict }] = await Promise.all([searchParams, brandContext()]);
  if (!sql) return {};
  const { choice } = await brandScope({ sql, verifiedEmail }, viewer, organizationId);
  if (!choice || !studioV2Visible(choice, true) || !memberSeesBrandProjects(choice)) return {};
  if (!(await brandSendOpenFor(sql, choice.id))) return {};
  return { title: dict.brandSend.inboxTitle };
}

export default async function BrandInboxPage({
  searchParams,
}: {
  searchParams: Promise<{
    organizationId?: string | string[];
    thread?: string | string[];
    view?: string | string[];
  }>;
}) {
  const [{ organizationId, thread, view }, { sql, viewer, verifiedEmail, dict, locale }] = await Promise.all([
    searchParams,
    brandContext(),
  ]);
  if (!sql) notFound();

  const { selection, choice } = await brandScope({ sql, verifiedEmail }, viewer, organizationId);
  if (selection.state === 'unavailable' || !choice) notFound();
  if (!studioV2Visible(choice, brandStudioV2Open())) notFound();
  if (!memberSeesBrandProjects(choice)) notFound();
  if (!(await brandSendOpenFor(sql, choice.id))) notFound();

  const rawView = firstParam(view)?.trim();
  const initialView: SendInboxView = rawView === 'mentions' ? 'mentions' : 'all';

  const rawThread = firstParam(thread)?.trim();
  const initialThreadId = rawThread && UUID_RE.test(rawThread) ? rawThread.toLowerCase() : null;

  const deps = { sql, media: createStudioMediaStore() };

  let initialThread: SendThreadPage | null = null;
  let initialThreadGone = false;
  if (initialThreadId) {
    const threadRes = await runSendOperation(deps, viewer, 'send.thread', {
      organizationId: choice.id,
      rootId: initialThreadId,
      markRead: false,
    });
    if (threadRes.ok && 'thread' in threadRes && 'replies' in threadRes) {
      initialThread = threadRes;
    } else if (!threadRes.ok && threadRes.code === 'not_found') {
      initialThreadGone = true;
    }
  }

  let initialInbox: SendInboxPageData | null = null;
  const inboxRes = await runSendOperation(deps, viewer, 'send.inbox', {
    organizationId: choice.id,
    view: initialView,
  });
  if (inboxRes.ok && 'threads' in inboxRes && 'view' in inboxRes) {
    initialInbox = inboxRes;
  }

  const copy = pickSendCopy(dict);
  const inviteOpen = await brandSendInviteOpenFor(sql, choice.id).catch(() => false);
  const sendProp = inviteOpen ? { organizationId: choice.id, invite: true } : { organizationId: choice.id };

  return (
    <SendInboxPage
      send={sendProp}
      initialThreadId={initialThreadId}
      initialView={initialView}
      locale={locale}
      copy={copy}
      initialInbox={initialInbox}
      initialThread={initialThread}
      initialThreadGone={initialThreadGone}
    />
  );
}
