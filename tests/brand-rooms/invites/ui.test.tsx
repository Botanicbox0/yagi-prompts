import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { studioFixture, viewerOf, type StudioFixture } from '../../brand-studio/server/helpers';

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §12 — what the screens show. Server render only (no DOM in these tests):
 * the room's "공유" entry for owners and editors with invitations on, the dialog's two sections and its
 * default ("초대한 사람만", no link options, no link), today's link-only dialog untouched when the switch is
 * off, and a guest invited to view only has no message box.
 */
const mocks = vi.hoisted(() => ({ sql: null as SqlRunner | null, viewer: null as Viewer | null }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/auth/viewer', () => ({
  getViewer: async () => mocks.viewer ?? { userId: null, isAdmin: false, tier: 'anon', email: null, locale: null },
}));
vi.mock('@/components/brand-workspace/context', async () => {
  const { getDictionary } = await import('@/lib/i18n/dictionaries');
  return {
    brandContext: async () => {
      const dict = getDictionary('ko');
      return { viewer: mocks.viewer, sql: mocks.sql, verifiedEmail: undefined, brandHost: true, locale: 'ko', dict, b: dict.brandWorkspace };
    },
  };
});

const roomPage = (await import('@/app/(brand)/brand/rooms/[projectId]/page')).default;
const { getDictionary } = await import('@/lib/i18n/dictionaries');
const { ShareButton, ShareDialog } = await import('@/components/brand-rooms/share');
const { InviteShareDialog } = await import('@/components/brand-rooms/share/invite-dialog');
const { RoomShareInvitesProvider } = await import('@/components/brand-rooms/share/invites-context');
const ko = getDictionary('ko');

let f: StudioFixture | null = null;
afterEach(async () => {
  vi.unstubAllEnvs();
  await f?.db.close();
  f = null;
  mocks.sql = null;
  mocks.viewer = null;
});

async function room(invites: 'on' | 'off') {
  vi.stubEnv('BRAND_ROOMS', 'on');
  vi.stubEnv('BRAND_ROOM_INVITES', invites);
  f = await studioFixture({ orgName: 'Lumen Beauty', capKrw: 1_000_000 });
  mocks.sql = f.sql;
  return f;
}
const render = async (fx: StudioFixture, userId: string, query: Record<string, string> = {}) => {
  mocks.viewer = viewerOf(userId);
  return renderToStaticMarkup(
    (await roomPage({ params: Promise.resolve({ projectId: fx.projectId }), searchParams: Promise.resolve({ organizationId: fx.orgId, ...query }) })) as ReactElement,
  );
};

describe('the room header', () => {
  it('offers "공유" for the project to owners and editors only, and only with invitations on', async () => {
    const fx = await room('on');
    expect(await render(fx, fx.ids.owner)).toContain('data-share-open="project"');
    expect(await render(fx, fx.ids.editor)).toContain('data-share-open="project"');
    expect(await render(fx, fx.ids.viewer)).not.toContain('data-share-open="project"');
    expect(await render(fx, fx.ids.guest)).not.toContain('data-share-open="project"');
  });

  it('is exactly today\'s header with invitations off', async () => {
    const fx = await room('off');
    const html = await render(fx, fx.ids.owner);
    expect(html).not.toContain('data-share-open="project"');
    expect(html).not.toContain(ko.roomsShare.people.title);
  });
});

describe('a guest invited to view only', () => {
  // The composers render only after the conversation loads (client side), so the server render cannot show
  // them; the screen hides them from `canTalkIn` (pinned here) and every write API refuses on its own
  // (tests/brand-rooms/invites/service.test.ts).
  it('may talk only where the invitation allows it', async () => {
    const { canTalkIn } = await import('@/lib/brand-rooms/access');
    const project = randomUUID();
    const other = randomUUID();
    expect(canTalkIn({ canTalk: true, readOnlyProjectIds: [project] }, project)).toBe(false);
    expect(canTalkIn({ canTalk: true, readOnlyProjectIds: [project] }, project.toUpperCase())).toBe(false);
    expect(canTalkIn({ canTalk: true, readOnlyProjectIds: [project] }, other)).toBe(true);
    expect(canTalkIn({ canTalk: true, readOnlyProjectIds: [] }, project)).toBe(true);
    expect(canTalkIn({ canTalk: true }, project)).toBe(true);
    expect(canTalkIn({ canTalk: false }, project)).toBe(false);
  });
});

describe('the dialog', () => {
  const invites = { organizationId: randomUUID(), projectId: randomUUID(), locale: 'ko' as const, copy: ko.roomsShare, roles: ko.brandWorkspace.roles };
  const target = { kind: 'review' as const, id: randomUUID() };

  it('opens on people, then link access set to "초대한 사람만" with no link options and no link', () => {
    const html = renderToStaticMarkup(<InviteShareDialog invites={invites} target={target} shareCopy={ko.roomsReview.share} onClose={() => undefined} />);
    expect(html).toContain('data-share-people');
    expect(html).toContain(ko.roomsShare.people.scopeNote);
    expect(html).toContain(ko.roomsShare.people.permComment);
    expect(html).toContain(ko.roomsShare.people.permView);
    expect(html).toContain('data-share-link-access');
    expect(html).toContain('data-link-mode="invited"');
    expect(html).toContain('>초대한 사람만</option>');
    expect(html).toContain('>링크가 있는 누구나</option>');
    expect(html).toContain(ko.roomsShare.link.invitedHelp);
    // The link options and any link appear only after the customer switches to "누구나".
    expect(html).not.toContain('data-share-form');
    expect(html).not.toContain('data-share-link=');
    expect(html).not.toContain(ko.roomsShare.link.recommend);
    // "의견 남기기" is the preselected permission.
    expect(html).toMatch(/<select[^>]*data-invite-permission[^>]*><option value="comment" selected="">/);
  });

  it('has no link access when opened for the whole project', () => {
    const html = renderToStaticMarkup(<InviteShareDialog invites={invites} target={null} shareCopy={ko.roomsReview.share} onClose={() => undefined} />);
    expect(html).toContain('data-share-people');
    expect(html).not.toContain('data-share-link-access');
  });

  it('leaves the share button and today\'s link-only dialog untouched without invitations', () => {
    const props = { organizationId: invites.organizationId, target, locale: 'ko' as const, copy: ko.roomsReview, canEdit: true };
    const plain = renderToStaticMarkup(<ShareButton {...props} />);
    expect(renderToStaticMarkup(<RoomShareInvitesProvider value={null}><ShareButton {...props} /></RoomShareInvitesProvider>)).toBe(plain);
    expect(renderToStaticMarkup(<RoomShareInvitesProvider value={invites}><ShareButton {...props} /></RoomShareInvitesProvider>)).toBe(plain);
    expect(renderToStaticMarkup(<RoomShareInvitesProvider value={invites}><ShareButton {...props} canEdit={false} /></RoomShareInvitesProvider>)).toBe('');
    const old = renderToStaticMarkup(<ShareDialog organizationId={props.organizationId} target={target} locale="ko" copy={ko.roomsReview} onClose={() => undefined} />);
    expect(old).toContain(ko.roomsReview.share.title);
    expect(old).toContain('data-share-form');
    expect(old).toContain('data-share-comments');
    expect(old).toContain('data-share-passphrase');
    expect(old).not.toContain('data-share-people');
    expect(old).not.toContain('data-link-mode');
    expect(old).not.toContain('brh-dialog-wide');
  });
});
