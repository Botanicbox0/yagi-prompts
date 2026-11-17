import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { postRoomEvent } from '@/lib/brand-rooms/events';
import { runRoomOperation } from '@/lib/brand-rooms/messages';
import { disableRoomEmail, saveRoomNoticePrefs } from '@/lib/brand-rooms/notice-prefs';
import { buildRoomNoticeEmail, enqueueNotices, runRoomNoticePass, type RoomNoticePassDeps } from '@/lib/brand-rooms/notices';
import { createFakeMailer, type FakeMailer } from '@/lib/notify/mailer-fake';
import { savePushSubscription } from '@/lib/notify/push';
import { viewerOf } from '../../brand-studio/server/helpers';
import { testPushKeys } from '../../helpers/push';
import { fakePushSender, generalInboxPath, memberLine, minutesFromNow, noticeEnv, noticeFixture, noticeRows, projectRoomPath, teamLine, type NoticeFixture } from './helpers';

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §2.1–§2.2, §10.1 — the pass: what is mailed (one kind per mail), bundled,
 * held back, skipped and retried, what one mail says, and the push that goes out at once. The fake
 * mailer records every mail the provider would have accepted; nothing leaves the machine. The exact
 * confirmed wording per kind is pinned in ./wording.test.ts.
 */
let f: NoticeFixture;
let mailer: FakeMailer;

beforeEach(async () => {
  noticeEnv();
  f = await noticeFixture();
  mailer = createFakeMailer();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await f.db.close();
});

const pass = (now: Date, deps: Partial<RoomNoticePassDeps> = {}) => runRoomNoticePass({ sql: f.sql, mailer, push: null, now, ...deps });
const mailTo = (role: string) => mailer.sent.filter((m) => m.to === `${role}@example.test`);
const intake = (userId: string) => enqueueNotices(f.sql, { type: 'intake', organizationId: f.orgId, projectId: f.projectId, actorId: userId });
const posted = (event: 'review_posted' | 'storyboard_shared', title: string) =>
  postRoomEvent(f.sql, {
    organizationId: f.orgId,
    projectId: f.projectId,
    event,
    ref: event === 'review_posted' ? { kind: 'review', reviewId: randomUUID() } : { kind: 'storyboard', storyboardId: randomUUID() },
    actorId: f.ids.admin,
    actorRole: 'studio',
    detail: { title, version: 2 },
  });

describe('bundled mail', () => {
  it('waits 10 minutes, then mails only the people who have not read the line since', async () => {
    await teamLine(f, 'The first cut is up.');
    expect((await pass(minutesFromNow(1))).mails).toBe(0);
    // The owner opens the conversation before the bundle is due.
    await runRoomOperation(f.deps, viewerOf(f.ids.owner), 'channel.read', { organizationId: f.orgId, projectId: f.projectId });
    const report = await pass(minutesFromNow(11));
    expect(mailTo('owner')).toEqual([]);
    expect(mailTo('editor')).toHaveLength(1);
    expect(report).toMatchObject({ ran: true, mails: 3, sent: 3, skipped: 1 });
    expect((await noticeRows(f.sql)).find((r) => r.recipient_id === f.ids.owner)).toMatchObject({ state: 'skipped', skip_reason: 'read' });
  });

  it('skips a person who switched room mail off (settings or the unsubscribe link)', async () => {
    expect(await saveRoomNoticePrefs(f.sql, viewerOf(f.ids.owner), { organizationId: f.orgId, emailEnabled: false })).toEqual({ ok: true, emailEnabled: false });
    expect(await disableRoomEmail(f.sql, f.ids.guest, f.orgId)).toMatchObject({ ok: true });
    await teamLine(f, 'Hello');
    await pass(minutesFromNow(11));
    expect(mailTo('owner')).toEqual([]);
    expect(mailTo('guest')).toEqual([]);
    expect(mailTo('viewer')).toHaveLength(1);
    const rows = await noticeRows(f.sql);
    expect(rows.filter((r) => r.skip_reason === 'muted').map((r) => r.recipient_id).sort()).toEqual([f.ids.owner, f.ids.guest].sort());
  });

  it('sends at most one bundled mail per person and project every 30 minutes, holding the rest', async () => {
    await teamLine(f, 'First');
    await pass(minutesFromNow(11));
    expect(mailTo('editor')).toHaveLength(1);
    await teamLine(f, 'Second');
    const held = await pass(minutesFromNow(12));
    expect(held).toMatchObject({ mails: 0, deferred: 4 });
    expect(mailTo('editor')).toHaveLength(1);
    expect((await pass(minutesFromNow(30))).mails).toBe(0);
    const later = await pass(minutesFromNow(42));
    expect(later.mails).toBe(4);
    expect(mailTo('editor')).toHaveLength(2);
    expect(mailTo('editor')[1]!.text).toContain('Second');
  });

  it('counts every line in one mail and quotes the first five, with no "and N more" line (§10.1)', async () => {
    for (let i = 1; i <= 7; i += 1) await teamLine(f, `Line ${i}`);
    await pass(minutesFromNow(11));
    const mail = mailTo('owner');
    expect(mail).toHaveLength(1);
    expect(mail[0]!.subject).toBe('7 unread messages in Spring launch');
    expect(mail[0]!.text).toContain('There are 7 unread replies and messages.');
    expect(mail[0]!.text.split('\n').filter((l) => l.startsWith('YAGI team: '))).toEqual(['Line 1', 'Line 2', 'Line 3', 'Line 4', 'Line 5'].map((l) => `YAGI team: ${l}`));
    expect(mail[0]!.text).not.toContain('Line 6');
    expect(mail[0]!.text).not.toContain('more');
  });

  it('labels a team member as "YAGI team · name" in the quote lines', async () => {
    await f.sql.query("update profiles set display_name = 'Jisoo' where id = $1", [f.ids.admin]);
    await teamLine(f, 'The first cut is up.');
    await pass(minutesFromNow(11));
    expect(mailTo('owner')[0]!.text).toContain('YAGI team · Jisoo: The first cut is up.');
  });
});

describe('"now" mail', () => {
  it('sends one mail per notice, each of its own kind and with its own idempotency key (§10.1)', async () => {
    await posted('review_posted', 'Hero film');
    await posted('storyboard_shared', 'Shot list');
    const report = await pass(minutesFromNow(0));
    expect(report).toMatchObject({ mails: 8, sent: 8 });
    const mails = mailTo('viewer');
    expect(mails.map((m) => m.subject).sort()).toEqual(['New version of Hero film for Spring launch', 'Storyboard shared for Spring launch']);
    expect(new Set(mails.map((m) => m.idempotencyKey)).size).toBe(2);
    const rows = (await noticeRows(f.sql)).filter((r) => r.recipient_id === f.ids.viewer);
    expect(new Set(rows.map((r) => r.batch_id)).size).toBe(2);
    const draft = mails.find((m) => m.subject.startsWith('New version'))!;
    expect(draft.text).toContain('The YAGI team has uploaded version 2.');
    expect(draft.text).not.toContain('Shot list');
  });

  it('does not carry due bundled lines in a "now" mail: they keep their own mail', async () => {
    await teamLine(f, 'Waiting line');
    await f.sql.query("update brand_room_notices set due_at = now() - interval '1 minute'");
    await posted('review_posted', 'Hero film');
    await pass(minutesFromNow(0));
    const mails = mailTo('owner');
    expect(mails).toHaveLength(2);
    expect(mails.find((m) => m.subject.startsWith('New version'))!.text).not.toContain('Waiting line');
    expect(mails.find((m) => m.subject === '1 unread message in Spring launch')!.text).toContain('YAGI team: Waiting line');
  });

  it('mails a mention at once, without waiting for the bundle, quoting its line', async () => {
    await memberLine(f, f.ids.owner, 'Can you look at cut 3?', { mentions: [f.ids.editor] });
    await pass(minutesFromNow(0));
    expect(mailTo('editor')).toHaveLength(1);
    const [mail] = mailTo('editor');
    expect(mail!.subject).toBe('owner mentioned you in Spring launch');
    expect(mail!.text).toContain('owner: Can you look at cut 3?');
  });

  it('names a team member who mentions you by their plain name, and quotes them with the team label (ko and en)', async () => {
    await f.sql.query("update profiles set display_name = 'Jisoo' where id = $1", [f.ids.admin]);
    await f.sql.query("update profiles set locale = 'ko' where id = $1", [f.ids.owner]);
    const sender = fakePushSender();
    await savePushSubscription(f.sql, f.ids.owner, { endpoint: 'https://fcm.googleapis.com/fcm/send/owner-device', ...testPushKeys() }, null);
    await teamLine(f, 'Cut 3 is ready for you.', { mentions: [f.ids.owner, f.ids.editor] });
    await pass(minutesFromNow(0), { push: sender });
    const [ko] = mailTo('owner');
    expect(ko!.subject).toBe('[Spring launch] Jisoo님이 불렀어요');
    expect(ko!.text.split('\n')[0]).toBe('Jisoo님이 불렀어요');
    expect(ko!.text).toContain('Jisoo님이 프로젝트 대화에서 불렀어요. 내용을 확인해 주세요.');
    expect(ko!.text).toContain('야기 팀 · Jisoo: Cut 3 is ready for you.');
    expect(sender.calls.find((c) => c.message.lang === 'ko')!.message).toMatchObject({ title: '나를 불렀어요', body: '[Spring launch] Jisoo님이 불렀어요' });
    const [en] = mailTo('editor');
    expect(en!.subject).toBe('Jisoo mentioned you in Spring launch');
    expect(en!.text.split('\n')[0]).toBe('Jisoo mentioned you');
    expect(en!.text).toContain('Jisoo mentioned you in the project conversation. Please check the message.');
    expect(en!.text).toContain('YAGI team · Jisoo: Cut 3 is ready for you.');
  });

  it('names a team member without a name as the team', async () => {
    await f.sql.query("update profiles set locale = 'ko' where id = $1", [f.ids.owner]);
    await teamLine(f, 'Ping', { mentions: [f.ids.owner, f.ids.editor] });
    await pass(minutesFromNow(0));
    expect(mailTo('owner')[0]!.subject).toBe('[Spring launch] 야기 팀님이 불렀어요');
    expect(mailTo('owner')[0]!.text).toContain('야기 팀: Ping');
    expect(mailTo('editor')[0]!.subject).toBe('YAGI team mentioned you in Spring launch');
  });

  it('names a brand colleague who mentions you by their display name (ko and en)', async () => {
    await f.sql.query("update profiles set display_name = 'Mina Park' where id = $1", [f.ids.owner]);
    await f.sql.query("update profiles set locale = 'ko' where id = $1", [f.ids.viewer]);
    await memberLine(f, f.ids.owner, 'Thoughts on the ending?', { mentions: [f.ids.editor, f.ids.viewer] });
    await pass(minutesFromNow(0));
    const [en] = mailTo('editor');
    expect(en!.subject).toBe('Mina Park mentioned you in Spring launch');
    expect(en!.text).toContain('Mina Park: Thoughts on the ending?');
    const [ko] = mailTo('viewer');
    expect(ko!.subject).toBe('[Spring launch] Mina Park님이 불렀어요');
    expect(ko!.text).toContain('Mina Park: Thoughts on the ending?');
  });

  it('marks everything due as no_mailer when no mail provider is configured, without throwing', async () => {
    await intake(f.ids.owner);
    const report = await pass(minutesFromNow(0), { mailer: null });
    expect(report).toMatchObject({ ran: true, mails: 0, skipped: 1 });
    expect(await noticeRows(f.sql)).toEqual([expect.objectContaining({ state: 'skipped', skip_reason: 'no_mailer' })]);
  });

  it('skips a person who has left the brand since the line was queued', async () => {
    await intake(f.ids.viewer);
    await f.sql.query("update brand_memberships set status = 'revoked' where organization_id = $1 and user_id = $2", [f.orgId, f.ids.viewer]);
    await pass(minutesFromNow(0));
    expect(mailer.sent).toEqual([]);
    expect(await noticeRows(f.sql)).toEqual([expect.objectContaining({ state: 'skipped', skip_reason: 'no_access' })]);
  });
});

describe('retries', () => {
  it('tries a failing mail three times with the same idempotency key, then gives up', async () => {
    await intake(f.ids.owner);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      mailer.failNext({ retryable: true, error: 'provider 503' });
      const report = await pass(minutesFromNow(attempt));
      const [row] = await noticeRows(f.sql);
      expect(row).toMatchObject({ attempts: attempt, state: attempt < 3 ? 'pending' : 'failed' });
      expect(report).toMatchObject(attempt < 3 ? { retrying: 1, failed: 0 } : { retrying: 0, failed: 1 });
    }
    await pass(minutesFromNow(5));
    expect(mailer.sent).toEqual([]);
  });

  it('keeps the batch id across a retry, so the provider sees one key', async () => {
    await intake(f.ids.owner);
    mailer.failNext({ retryable: true });
    await pass(minutesFromNow(0));
    const batch = (await noticeRows(f.sql))[0]!.batch_id;
    expect(batch).toMatch(/^[0-9a-f-]{36}$/);
    await pass(minutesFromNow(1));
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.idempotencyKey).toBe(batch);
    expect((await noticeRows(f.sql))[0]).toMatchObject({ state: 'sent', attempts: 2, batch_id: batch });
  });

  it('gives up at once on a refusal that cannot change', async () => {
    await intake(f.ids.owner);
    mailer.failNext({ retryable: false, error: 'invalid address' });
    await pass(minutesFromNow(0));
    expect((await noticeRows(f.sql))[0]).toMatchObject({ state: 'failed', attempts: 1 });
  });

  it('gives back a claim whose sender vanished, once its lease runs out', async () => {
    await intake(f.ids.owner);
    await f.sql.query("update brand_room_notices set state = 'sending', attempts = 1, lease_until = now() - interval '1 minute'");
    await pass(minutesFromNow(0));
    expect(mailer.sent).toHaveLength(1);
    expect((await noticeRows(f.sql))[0]).toMatchObject({ state: 'sent', attempts: 2 });
  });
});

describe('what one mail says', () => {
  it('names the project, quotes 120 characters of the team line, links into the room on the brand host and carries an unsubscribe link', async () => {
    const body = `${'a'.repeat(100)} ${'b'.repeat(19)}TAIL-NOT-SHOWN and more`;
    await teamLine(f, body);
    await pass(minutesFromNow(11));
    const [mail] = mailTo('owner');
    expect(mail).toBeDefined();
    const room = `https://brand.twings.app${projectRoomPath(f)}`;
    expect(mail!.subject).toBe('1 unread message in Spring launch');
    for (const part of [mail!.html, mail!.text]) {
      expect(part).toContain(`${'a'.repeat(100)} ${'b'.repeat(19)}…`);
      expect(part).not.toContain('TAIL-NOT-SHOWN');
      expect(part).toContain(room);
      expect(part).toContain('View Messages');
    }
    expect(mail!.unsubscribeUrl).toMatch(/^https:\/\/twings\.app\/api\/notify\/unsubscribe\?t=/);
    expect(mail!.text).toContain(mail!.unsubscribeUrl);
    for (const banned of ['Slack', '슬랙', 'webhook', 'Webhook']) {
      expect(mail!.subject + mail!.html + mail!.text, banned).not.toContain(banned);
    }
    // The company line every mail carries.
    expect(mail!.text).toContain('YAGI');
  });

  it('writes in the recipient’s language', async () => {
    await f.sql.query("update profiles set locale = 'ko' where id = $1", [f.ids.owner]);
    await posted('review_posted', '메인 영상');
    await pass(minutesFromNow(0));
    const [mail] = mailTo('owner');
    expect(mail!.subject).toBe('[Spring launch] 메인 영상 새 시안이 도착했어요');
    expect(mail!.text).toContain('메인 영상의 새 버전이 올라왔습니다.');
    expect(mail!.text).toContain('야기 팀이 2번째 시안을 준비했어요. 확인하고 의견을 남겨주세요.');
    expect(mail!.text).toContain('시안 확인하기');
    expect(mail!.text).toContain('이 메일은 프로젝트 진행 알림이며, 알림 설정에서 수신 여부를 변경할 수 있습니다. 수신 거부');
  });

  it('builds the receipt mail on its own subject', () => {
    const mail = buildRoomNoticeEmail({
      locale: 'en',
      recipientId: f.ids.owner,
      organizationId: f.orgId,
      projectId: f.projectId,
      projectTitle: 'Spring launch',
      lines: [{ kind: 'intake_received' }],
    });
    expect(mail.subject).toBe('Request received for Spring launch');
    expect(mail.buttonUrl).toBe(`https://brand.twings.app${projectRoomPath(f)}`);
    expect(mail.text).not.toMatch(/reply/i);
  });

  it('keeps links on a local origin when the deployment is not production', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    const mail = buildRoomNoticeEmail({ locale: 'en', recipientId: f.ids.owner, organizationId: f.orgId, projectId: f.projectId, projectTitle: 'P', lines: [{ kind: 'intake_received' }] });
    expect(mail.buttonUrl).toBe(`http://localhost:3000${projectRoomPath(f)}`);
    expect(mail.unsubscribeUrl.startsWith('http://localhost:3000/api/notify/unsubscribe?t=')).toBe(true);
  });
});

describe('push', () => {
  it('pushes once, at once, to the room path with the project as tag — the bundled mail still waits', async () => {
    const sender = fakePushSender();
    await savePushSubscription(f.sql, f.ids.owner, { endpoint: 'https://fcm.googleapis.com/fcm/send/owner-device', ...testPushKeys() }, null);
    await teamLine(f, 'Pushed first');
    const report = await pass(minutesFromNow(0), { push: sender });
    expect(report).toMatchObject({ pushes: 1, mails: 0 });
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]!.message).toMatchObject({
      title: '1 New Message',
      body: 'You have 1 new message from the YAGI team in Spring launch.',
      url: projectRoomPath(f),
      tag: f.projectId,
    });
    const rows = await noticeRows(f.sql);
    expect(rows.find((r) => r.recipient_id === f.ids.owner)).toMatchObject({ push_state: 'sent', state: 'pending' });
    // Nobody else has a device: claimed and left skipped, never retried.
    expect(rows.filter((r) => r.recipient_id !== f.ids.owner).every((r) => r.push_state === 'skipped')).toBe(true);
    await pass(minutesFromNow(1), { push: sender });
    expect(sender.calls).toHaveLength(1);
  });

  it('pushes the team’s lines of one pass once, counting them; each "now" notice on its own, newest last', async () => {
    const sender = fakePushSender();
    await f.sql.query("update profiles set locale = 'ko' where id = $1", [f.ids.owner]);
    await savePushSubscription(f.sql, f.ids.owner, { endpoint: 'https://fcm.googleapis.com/fcm/send/owner-device', ...testPushKeys() }, null);
    await teamLine(f, 'One');
    await teamLine(f, 'Two');
    await posted('review_posted', '메인 영상');
    await pass(minutesFromNow(0), { push: sender });
    expect(sender.calls.map((c) => [c.message.title, c.message.body])).toEqual([
      ['새 메시지 2건', '[Spring launch] 야기 팀이 보낸 메시지가 2건 있습니다.'],
      ['새 시안 도착', '[Spring launch] 메인 영상의 2번째 시안을 확인해 보세요.'],
    ]);
    expect(sender.calls.every((c) => c.message.tag === f.projectId && c.message.lang === 'ko')).toBe(true);
  });

  it('does not push the intake receipt', async () => {
    const sender = fakePushSender();
    await savePushSubscription(f.sql, f.ids.owner, { endpoint: 'https://fcm.googleapis.com/fcm/send/owner-device', ...testPushKeys() }, null);
    await intake(f.ids.owner);
    await pass(minutesFromNow(0), { push: sender });
    expect(sender.calls).toEqual([]);
    expect(mailTo('owner')).toHaveLength(1);
  });
});

describe('the general channel', () => {
  it('skips the people who read the general conversation since, and links the rest to the inbox on the brand host', async () => {
    await teamLine(f, 'We got your question about invoices.', { projectId: 'general' });
    // A read of ANOTHER brand's general channel says nothing about this one.
    const other = randomUUID();
    await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [other, 'Other brand', f.ids.owner, randomUUID()]);
    await f.sql.query("insert into brand_room_reads (organization_id, channel, user_id, last_read_at) values ($1, 'general', $2, now() + interval '1 minute')", [other, f.ids.viewer]);
    await runRoomOperation(f.deps, viewerOf(f.ids.owner), 'channel.read', { organizationId: f.orgId, projectId: 'general' });
    const report = await pass(minutesFromNow(11));
    expect(report).toMatchObject({ mails: 2, skipped: 1 });
    expect(mailTo('owner')).toEqual([]);
    expect(mailTo('viewer')).toHaveLength(1);
    expect((await noticeRows(f.sql)).find((r) => r.recipient_id === f.ids.owner)).toMatchObject({ state: 'skipped', skip_reason: 'read' });
    const [mail] = mailTo('editor');
    const inbox = `https://brand.twings.app${generalInboxPath(f)}`;
    expect(mail!.text).toContain(inbox);
    expect(mail!.html).toContain(inbox.replace('&', '&amp;'));
    // `{project}` is the general conversation's own name (§10.1), never a project's or the brand's.
    expect(mail!.subject).toBe('1 unread message in General');
    expect(mail!.text).toContain('YAGI team: We got your question about invoices.');
    expect(mail!.text).not.toContain('Spring launch');
    expect(mail!.text).not.toContain('Studio fixture brand');
    expect(mail!.text).toContain(`View Messages: ${inbox}`);
  });

  it('names the general conversation in Korean for a Korean reader', async () => {
    await f.sql.query("update profiles set locale = 'ko' where id = $1", [f.ids.owner]);
    await teamLine(f, '세금계산서 문의 확인했어요.', { projectId: 'general' });
    await pass(minutesFromNow(11));
    const [mail] = mailTo('owner');
    expect(mail!.subject).toBe('[일반 문의] 읽지 않은 메시지가 1건 있어요');
    expect(mail!.text).toContain('야기 팀: 세금계산서 문의 확인했어요.');
    expect(mail!.text).toContain(`메시지 확인하기: https://brand.twings.app${generalInboxPath(f)}`);
  });

  it('keeps general and a project apart: two mails, each with its own link', async () => {
    await teamLine(f, 'In general', { projectId: 'general' });
    await teamLine(f, 'In the project');
    await pass(minutesFromNow(11));
    const mails = mailTo('owner');
    expect(mails).toHaveLength(2);
    expect(mails.find((m) => m.text.includes('In general'))!.text).toContain(generalInboxPath(f));
    expect(mails.find((m) => m.text.includes('In the project'))!.text).toContain(projectRoomPath(f));
  });

  it('pushes the general conversation with the organization as tag', async () => {
    const sender = fakePushSender();
    await savePushSubscription(f.sql, f.ids.owner, { endpoint: 'https://fcm.googleapis.com/fcm/send/owner-device', ...testPushKeys() }, null);
    await teamLine(f, 'Ping in general', { projectId: 'general' });
    await pass(minutesFromNow(0), { push: sender });
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]!.message).toMatchObject({
      url: generalInboxPath(f),
      tag: f.orgId,
      title: '1 New Message',
      body: 'You have 1 new message from the YAGI team in General.',
    });
  });
});

describe('a team reply on a draft', () => {
  async function seedComment(body: string): Promise<{ reviewId: string; commentId: string }> {
    const asset = (
      await f.sql.query<{ id: string }>(
        `insert into brand_studio_assets (organization_id, kind, role, storage_key, mime, size_bytes, name, created_by)
         values ($1, 'image', 'product', $2, 'image/png', 10, 'cut.png', $3) returning id::text as id`,
        [f.orgId, `st/${'a'.repeat(64)}.png`, f.ids.admin],
      )
    ).rows[0]!.id;
    const reviewId = (
      await f.sql.query<{ id: string }>("insert into brand_studio_reviews (organization_id, asset_id, title, created_role) values ($1, $2, 'Hero film', 'studio') returning id::text as id", [f.orgId, asset])
    ).rows[0]!.id;
    const commentId = (
      await f.sql.query<{ id: string }>(
        "insert into brand_studio_review_comments (review_id, organization_id, author_id, author_role, body) values ($1, $2, $3, 'studio', $4) returning id::text as id",
        [reviewId, f.orgId, f.ids.admin, body],
      )
    ).rows[0]!.id;
    return { reviewId, commentId };
  }

  it('quotes the reply itself', async () => {
    const { reviewId, commentId } = await seedComment('We moved the logo up by a third.');
    await postRoomEvent(f.sql, {
      organizationId: f.orgId,
      projectId: f.projectId,
      event: 'review_commented',
      ref: { kind: 'review', reviewId, commentId },
      actorId: f.ids.admin,
      actorRole: 'studio',
      detail: { title: 'Hero film', version: 1 },
    });
    await pass(minutesFromNow(11));
    expect(mailTo('owner')[0]!.subject).toBe('1 unread message in Spring launch');
    expect(mailTo('owner')[0]!.text).toContain('YAGI team: We moved the logo up by a third.');
  });

  it('counts but does not quote a reply whose note the team keeps to itself', async () => {
    const { reviewId, commentId } = await seedComment('TEAM-ONLY NOTE');
    await f.sql.query("update brand_studio_review_comments set visibility = 'team' where id = $1", [commentId]);
    await postRoomEvent(f.sql, {
      organizationId: f.orgId,
      projectId: f.projectId,
      event: 'review_commented',
      ref: { kind: 'review', reviewId, commentId },
      actorId: f.ids.admin,
      actorRole: 'studio',
      detail: { title: 'Hero film', version: 1 },
    });
    await pass(minutesFromNow(11));
    const [mail] = mailTo('owner');
    expect(mail!.subject).toBe('1 unread message in Spring launch');
    expect(mail!.text + mail!.html).not.toContain('TEAM-ONLY NOTE');
    expect(mail!.html).not.toContain('<tr>');
  });

  it('does not stumble over a malformed note id in the line', async () => {
    const reviewId = randomUUID();
    const line = (
      await f.sql.query<{ id: string }>(
        `insert into brand_room_messages (organization_id, project_id, channel, author_id, author_role, kind, event, detail, ref, ref_key)
         values ($1, $2::uuid, $6, $3, 'system', 'event', 'review_commented', '{"actorRole":"studio","title":"Hero film"}'::jsonb, $4::jsonb, $5) returning id::text as id`,
        [f.orgId, f.projectId, f.ids.admin, JSON.stringify({ kind: 'review', reviewId, commentId: 'not-a-uuid' }), `review:${reviewId}`, f.projectId],
      )
    ).rows[0]!.id;
    await enqueueNotices(f.sql, { type: 'event', organizationId: f.orgId, projectId: f.projectId, event: 'review_commented', messageId: line, actorId: f.ids.admin, actorRole: 'studio' });
    const report = await pass(minutesFromNow(11));
    expect(report.mails).toBe(4);
    // No readable note: the mail still goes out and counts the reply, with no quote line.
    expect(mailTo('owner')[0]!.subject).toBe('1 unread message in Spring launch');
    expect(mailTo('owner')[0]!.html).not.toContain('<tr>');
  });
});

describe('switched off', () => {
  it('returns at once and leaves every row as it was', async () => {
    await intake(f.ids.owner);
    vi.stubEnv('BRAND_ROOM_NOTIFY', 'off');
    expect(await pass(minutesFromNow(0))).toMatchObject({ ran: false, mails: 0 });
    expect(await noticeRows(f.sql)).toEqual([expect.objectContaining({ state: 'pending', attempts: 0 })]);
  });
});
