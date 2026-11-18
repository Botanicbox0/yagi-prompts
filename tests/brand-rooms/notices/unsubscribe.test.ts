import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { renderUnsubscribed, renderUnsubscribeInvalid } from '@/lib/notify/unsubscribe-page';
import { loadRoomNoticePrefs } from '@/lib/brand-rooms/notice-prefs';
import { ROOM_EMAIL_SCOPE, signUnsubscribeToken, unsubscribePath, verifyUnsubscribeToken } from '@/lib/notify/unsubscribe';
import { viewerOf } from '../../brand-studio/server/helpers';
import { noticeEnv, noticeFixture, type NoticeFixture } from './helpers';

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §2.2 — the project room scope of the signed unsubscribe link: it names a
 * person and an organization, can only switch that organization's room mail off, and works without a
 * session. The profile toggles' tokens keep their exact bytes and their behaviour.
 */
const mocks = vi.hoisted(() => ({ sql: null as SqlRunner | null }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
const { GET } = await import('@/app/api/notify/unsubscribe/route');

const SECRET = 'test-only-room-notice-secret-0000000000';
let f: NoticeFixture;

beforeEach(async () => {
  noticeEnv();
  f = await noticeFixture();
  mocks.sql = f.sql;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await f.db.close();
});

const open = (path: string) => GET(new Request(`https://twings.app${path}`));

describe('room mail scope of the unsubscribe token', () => {
  it('round-trips the person and the organization', () => {
    const claims = { userId: f.ids.owner, toggle: ROOM_EMAIL_SCOPE, organizationId: f.orgId };
    expect(verifyUnsubscribeToken(signUnsubscribeToken(claims, SECRET), { secret: SECRET })).toEqual({ ok: true, claims });
  });

  it('refuses a token moved to another organization', () => {
    const token = signUnsubscribeToken({ userId: f.ids.owner, toggle: ROOM_EMAIL_SCOPE, organizationId: f.orgId }, SECRET);
    const [, signature] = token.split('.') as [string, string];
    const forged = Buffer.from(JSON.stringify({ u: f.ids.owner, t: ROOM_EMAIL_SCOPE, o: '00000000-0000-4000-8000-000000000000' })).toString('base64url');
    expect(verifyUnsubscribeToken(`${forged}.${signature}`, { secret: SECRET })).toEqual({ ok: false, reason: 'bad_signature' });
    const noOrg = Buffer.from(JSON.stringify({ u: f.ids.owner, t: ROOM_EMAIL_SCOPE })).toString('base64url');
    const signed = `${noOrg}.${signUnsubscribeToken({ userId: f.ids.owner, toggle: 'notif_updates' }, SECRET).split('.')[1]}`;
    expect(verifyUnsubscribeToken(signed, { secret: SECRET }).ok).toBe(false);
  });

  it('leaves the profile toggles’ tokens byte for byte as they were', () => {
    const token = signUnsubscribeToken({ userId: f.ids.owner, toggle: 'notif_updates' }, SECRET);
    const payload = JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString('utf8'));
    expect(payload).toEqual({ u: f.ids.owner, t: 'notif_updates' });
    expect(verifyUnsubscribeToken(token, { secret: SECRET })).toEqual({ ok: true, claims: { userId: f.ids.owner, toggle: 'notif_updates' } });
  });
});

describe('/api/notify/unsubscribe with the room scope', () => {
  it('switches that organization’s room mail off without a session, and again is the same', async () => {
    await f.sql.query('update profiles set notif_updates = true where id = $1', [f.ids.owner]);
    expect(await loadRoomNoticePrefs(f.sql, viewerOf(f.ids.owner), f.orgId)).toEqual({ ok: true, emailEnabled: true });
    const path = unsubscribePath({ userId: f.ids.owner, toggle: ROOM_EMAIL_SCOPE, organizationId: f.orgId });
    const first = await open(path);
    expect(first.status).toBe(200);
    const html = await first.text();
    // §10.3, as confirmed: the title, the one sentence, and the one link back to the settings.
    expect(html).toContain('>Email notifications turned off</h1>');
    expect(html).toContain('You will no longer receive project emails from this brand. You can turn them back on in notification settings.');
    expect(html).toContain(`<a href="https://brand.twings.app/brand/rooms?organizationId=${f.orgId}#notice-settings" style="color:#0000EE;">Go to notification settings &rarr;</a>`);
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).not.toContain('href="/account"');
    expect(await loadRoomNoticePrefs(f.sql, viewerOf(f.ids.owner), f.orgId)).toEqual({ ok: true, emailEnabled: false });
    expect((await open(path)).status).toBe(200);
    // Nobody else's switch moved, and the profile toggles did not either.
    expect(await loadRoomNoticePrefs(f.sql, viewerOf(f.ids.editor), f.orgId)).toEqual({ ok: true, emailEnabled: true });
    expect((await f.sql.query<{ notif_updates: boolean }>('select notif_updates from profiles where id = $1', [f.ids.owner])).rows[0]!.notif_updates).toBe(true);
  });

  it('answers in the person’s language', async () => {
    await f.sql.query("update profiles set locale = 'ko' where id = $1", [f.ids.owner]);
    const html = await (await open(unsubscribePath({ userId: f.ids.owner, toggle: ROOM_EMAIL_SCOPE, organizationId: f.orgId }))).text();
    // §10.2, as confirmed.
    expect(html).toContain('<title>메일 수신을 거부했습니다 · ');
    expect(html).toContain('>메일 수신을 거부했습니다</h1>');
    expect(html).toContain('이제 이 브랜드의 프로젝트 메일은 발송되지 않아요. 다시 받으려면 알림 설정에서 켤 수 있어요.');
    expect(html).toContain(`href="https://brand.twings.app/brand/rooms?organizationId=${f.orgId}#notice-settings"`);
    expect(html).toContain('>알림 설정으로 가기 &rarr;</a>');
    // Korean wraps between words on a phone ("거부했습/니다" was split at 390px), the title and the sentence both.
    expect(html).toMatch(/<h1 style="[^"]*word-break:keep-all;overflow-wrap:anywhere;[^"]*">메일 수신을 거부했습니다<\/h1>/);
    expect(html).toMatch(/<p style="[^"]*word-break:keep-all;overflow-wrap:anywhere;[^"]*">이제 이 브랜드의/);
  });

  it('leaves the other scopes’ pages byte for byte as they were before §10', () => {
    // sha256 of each page as rendered by the code before this change (checked against that code once).
    const pinned: Record<string, string> = {
      'ko notif_updates': '7f3c5477ce0ccb32cb2cc6e45a70ff398eeb3f62c9410902a882039ccf8c956a',
      'ko notif_new_playbook': '869ec680a7722dd31a6aa693613a0b5ac3941f80b97a73d4757c5a34a1da11a8',
      'ko invalid': '30cbee1ec7a7f217eabc4ba7125f661c68601cd00561560ced0c4a0339f99aad',
      'en notif_updates': '02fed6b133124c983bb07e69d9162ab1fddd4fd43d61e3bcb58822912709a0d8',
      'en notif_new_playbook': 'c6081b010569e5ed8b44e519467695c8913e66fd55fbb035687db0a7142d0f2b',
      'en invalid': '74d617a61b40c65f69b52134230a39cf921a1252e0e3756f53402e9710fac3b4',
    };
    const sha = (html: string) => createHash('sha256').update(html).digest('hex');
    for (const locale of ['ko', 'en'] as const) {
      for (const toggle of ['notif_updates', 'notif_new_playbook'] as const) expect(sha(renderUnsubscribed({ locale, toggle })), `${locale} ${toggle}`).toBe(pinned[`${locale} ${toggle}`]);
      expect(sha(renderUnsubscribeInvalid(locale)), `${locale} invalid`).toBe(pinned[`${locale} invalid`]);
    }
  });

  it('says the link is not valid for an organization that no longer exists', async () => {
    const path = unsubscribePath({ userId: f.ids.owner, toggle: ROOM_EMAIL_SCOPE, organizationId: '00000000-0000-4000-8000-000000000000' });
    expect((await open(path)).status).toBe(400);
  });

  it('still switches the profile toggles off with the old scopes', async () => {
    await f.sql.query('update profiles set notif_updates = true where id = $1', [f.ids.owner]);
    const response = await open(unsubscribePath({ userId: f.ids.owner, toggle: 'notif_updates' }));
    expect(response.status).toBe(200);
    expect((await f.sql.query<{ notif_updates: boolean }>('select notif_updates from profiles where id = $1', [f.ids.owner])).rows[0]!.notif_updates).toBe(false);
    expect(await loadRoomNoticePrefs(f.sql, viewerOf(f.ids.owner), f.orgId)).toEqual({ ok: true, emailEnabled: true });
  });
});
