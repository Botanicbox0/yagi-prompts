import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { createBrandInvitation, BRAND_INVITES_PER_DAY } from '@/lib/brands/workspace/service';
import { runRoomOperation } from '@/lib/brand-rooms/messages';
import { SEND_LIMITS, type SendPosted } from '@/lib/brand-rooms/send-contracts';
import { ROOM_LIMITS } from '@/lib/brand-rooms/message-contracts';
import { as, closeWorld, code, imageResult, libraryPicture, ok, op, openSend, sendWorld, staffViewer, type SendWorld } from '../send/helpers';
import { invitation, openInvites, person, recording, tokenOf, waiting } from './helpers';

/**
 * 초대하고 보내기 (docs/BRAND-PROJECT-SPINE.md §8.5; slice 4c), the send side: `send.post` and `send.reply` with
 * `invites`. The coordinator's decisions 1, 2, 4 and 5:
 *  - who may invite (owner, editor; never a viewer; the rooms' `not_found` for everyone who is not seated), and the
 *    members page's own operation stays owner-only;
 *  - the role is always viewer, and a request cannot name one;
 *  - each address becomes a mention (an active member), waits for a live invitation (reused), is refused (the sender's
 *    own), or gets a new invitation by the existing writer; the line and all of it in one transaction;
 *  - 3 addresses per line, the daily cap shared with the members page, 20 lines per invitation, all checked before
 *    anything is written.
 */
let w: SendWorld;
let file: string;
beforeEach(async () => {
  w = await sendWorld();
  openSend(w.f.orgId);
  openInvites();
  file = (await imageResult(w, w.f.projectId)).outputId;
});
afterEach(async () => {
  await closeWorld(w);
});

const owner = () => as(w.f.ids.owner);
const editor = () => as(w.f.ids.editor);
const postInput = (invites: unknown, extra: Record<string, unknown> = {}) => ({ requestId: randomUUID(), file: { kind: 'output', outputId: file }, body: 'Have a look', invites, ...extra });

const count = async (table: string, where = 'true', params: unknown[] = []) => Number((await w.f.sql.query<{ n: number }>(`select count(*)::int as n from ${table} where ${where}`, params)).rows[0]!.n);
const world = async () => ({
  lines: await count('brand_room_messages'),
  invites: await count('brand_invites'),
  waiting: await count('brand_room_pending_mentions'),
  notices: await count('brand_room_notices'),
});

describe('who may invite through 보내기 (decision 1)', () => {
  it('an owner and an editor may: the line is posted at once with its invitation (viewer, 7 days, the sender invites)', async () => {
    for (const [viewer, email] of [[owner(), 'new1@example.com'], [editor(), 'new2@example.com']] as const) {
      const sent = await ok<SendPosted>(w, viewer, 'send.post', postInput([email]));
      expect(sent.invited).toEqual([{ email, result: 'invited', memberId: null, token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), mailState: null }]);
      const token = sent.invited![0]!.token!;
      const row = (
        await w.f.sql.query<Record<string, unknown>>(
          `select id::text as id, email, role, project_id, can_comment, issued_by_studio, created_by::text as created_by, token_hash, accepted_at, revoked_at,
                  extract(epoch from (expires_at - created_at))::int as seconds
             from brand_invites where email = $1`,
          [email],
        )
      ).rows;
      expect(row).toEqual([
        {
          id: expect.any(String),
          email,
          role: 'viewer',
          project_id: null,
          can_comment: false,
          issued_by_studio: false,
          created_by: viewer.userId,
          token_hash: createHash('sha256').update(token).digest('hex'),
          accepted_at: null,
          revoked_at: null,
          seconds: 7 * 86400,
        },
      ]);
      expect((await w.f.sql.query('select message_id::text as m, invite_id::text as i from brand_room_pending_mentions where invite_id = $1', [row[0]!.id])).rows).toEqual([{ m: sent.message.id, i: row[0]!.id }]);
      // The writer sees the address and its state on the line.
      expect(sent.message.invites).toEqual([{ state: 'pending', email }]);
      expect(sent.thread.root.invites).toEqual([{ state: 'pending', email }]);
    }
  });

  it('a viewer may not (forbidden), whatever the addresses are; nothing is written', async () => {
    const before = await world();
    expect(await code(w, as(w.f.ids.viewer), 'send.post', postInput(['new@example.com']))).toBe('forbidden');
    expect(await code(w, as(w.f.ids.viewer), 'send.post', postInput(['owner@example.test']))).toBe('forbidden');
    const root = (await ok<SendPosted>(w, owner(), 'send.post', postInput([]))).thread.rootId;
    const after = await world();
    expect(await code(w, as(w.f.ids.viewer), 'send.reply', { requestId: randomUUID(), rootId: root, body: 'me too', invites: ['new@example.com'] })).toBe('forbidden');
    expect(await world()).toEqual(after);
    expect(after.lines).toBe(before.lines + 1);
    expect(after.invites).toBe(before.invites);
  });

  it('a project guest, staff who are not members, an outsider, a removed member and another organization’s member: not_found, nothing written', async () => {
    const elsewhere = await person(w.f.sql, 'elsewhere@example.com');
    const otherOrg = randomUUID();
    await w.f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [otherOrg, 'Other brand', elsewhere, randomUUID()]);
    await w.f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [otherOrg, elsewhere]);
    const removed = await person(w.f.sql, 'removed@example.com');
    await w.f.sql.query("insert into brand_memberships (organization_id, user_id, role, status) values ($1, $2, 'editor', 'revoked')", [w.f.orgId, removed]);
    const before = await world();
    for (const viewer of [as(w.f.ids.guest), staffViewer(w), as(w.f.ids.outsider), as(removed), as(elsewhere)]) {
      expect(await code(w, viewer, 'send.post', postInput(['new@example.com'])), viewer.userId!).toBe('not_found');
      expect(await code(w, viewer, 'send.lookup', { email: 'new@example.com' }), viewer.userId!).toBe('not_found');
    }
    expect(await world()).toEqual(before);
  });

  it('the members page’s invitation.create is unchanged: an editor still may not use it, an owner may', async () => {
    const asEditor = await createBrandInvitation({ sql: w.f.sql }, editor(), { organizationId: w.f.orgId, email: 'page@example.com', role: 'viewer', requestId: randomUUID() });
    expect(asEditor).toEqual({ ok: false, code: 'forbidden' });
    const asViewer = await createBrandInvitation({ sql: w.f.sql }, as(w.f.ids.viewer), { organizationId: w.f.orgId, email: 'page@example.com', role: 'viewer', requestId: randomUUID() });
    expect(asViewer).toEqual({ ok: false, code: 'forbidden' });
    expect((await createBrandInvitation({ sql: w.f.sql }, owner(), { organizationId: w.f.orgId, email: 'page@example.com', role: 'editor', requestId: randomUUID() })).ok).toBe(true);
  });
});

describe('the role (decision 2)', () => {
  it('is always viewer; a role anywhere in the request is refused (invalid) and nothing is written', async () => {
    const before = await world();
    expect(await code(w, editor(), 'send.post', postInput(['new@example.com'], { role: 'editor' }))).toBe('invalid');
    expect(await code(w, editor(), 'send.post', postInput([{ email: 'new@example.com', role: 'owner' }]))).toBe('invalid');
    expect(await code(w, owner(), 'send.post', postInput(['new@example.com'], { invitesRole: 'owner' }))).toBe('invalid');
    expect(await world()).toEqual(before);
    await ok(w, owner(), 'send.post', postInput(['new@example.com']));
    expect((await w.f.sql.query('select role from brand_invites where email = $1', ['new@example.com'])).rows).toEqual([{ role: 'viewer' }]);
  });
});

describe('what each address becomes (decision 5)', () => {
  it('an active member is named like any mention: no invitation; the member is told as a mentioned member', async () => {
    const before = await world();
    const sent = await ok<SendPosted>(w, editor(), 'send.post', postInput(['VIEWER@example.test ']));
    expect(sent.invited).toEqual([{ email: 'viewer@example.test', result: 'member', memberId: w.f.ids.viewer, token: null, mailState: null }]);
    expect(sent.message.mentions.map((m) => m.id)).toEqual([w.f.ids.viewer]);
    expect(sent.message.invites).toEqual([]);
    const after = await world();
    expect(after.invites).toBe(before.invites);
    expect(after.waiting).toBe(before.waiting);
    expect((await w.f.sql.query("select kind from brand_room_notices where recipient_id = $1 and message_id = $2", [w.f.ids.viewer, sent.message.id])).rows).toEqual([{ kind: 'mention' }]);
    // Named twice (picked and typed): once.
    const twice = await ok<SendPosted>(w, editor(), 'send.post', postInput(['viewer@example.test'], { mentions: [w.f.ids.viewer] }));
    expect(twice.message.mentions.map((m) => m.id)).toEqual([w.f.ids.viewer]);
  });

  it('a live invitation to this organization is reused: no second invitation, nothing sent, the line waits for it too', async () => {
    const live = await invitation(w.f.sql, { organizationId: w.f.orgId, email: 'waiting@example.com', role: 'editor', createdBy: w.f.ids.owner, token: tokenOf('live') });
    const before = await world();
    const sent = await ok<SendPosted>(w, editor(), 'send.post', postInput(['waiting@example.com']));
    expect(sent.invited).toEqual([{ email: 'waiting@example.com', result: 'reused', memberId: null, token: null, mailState: null }]);
    expect((await world()).invites).toBe(before.invites);
    // The owner chose that invitation's role; 보내기 does not change it.
    expect((await w.f.sql.query('select role, revoked_at from brand_invites where id = $1', [live])).rows).toEqual([{ role: 'editor', revoked_at: null }]);
    expect((await w.f.sql.query('select invite_id::text as i from brand_room_pending_mentions where message_id = $1', [sent.message.id])).rows).toEqual([{ i: live }]);
  });

  it('an expired, withdrawn, accepted or project invitation is not reused: a new one is issued', async () => {
    const accepter = await person(w.f.sql, 'old-accepted@example.com');
    await invitation(w.f.sql, { organizationId: w.f.orgId, email: 'old-expired@example.com', createdBy: w.f.ids.owner, token: tokenOf('e'), ageSeconds: 7 * 86400 + 30, expiresAt: new Date(Date.now() - 60_000).toISOString() });
    const withdrawn = await invitation(w.f.sql, { organizationId: w.f.orgId, email: 'old-withdrawn@example.com', createdBy: w.f.ids.owner, token: tokenOf('r') });
    await w.f.sql.query('update brand_invites set revoked_at = now() where id = $1', [withdrawn]);
    const accepted = await invitation(w.f.sql, { organizationId: w.f.orgId, email: 'old-accepted@example.com', createdBy: w.f.ids.owner, token: tokenOf('a') });
    await w.f.sql.query('update brand_invites set accepted_at = now(), accepted_by = $2 where id = $1', [accepted, accepter]);
    await invitation(w.f.sql, { organizationId: w.f.orgId, email: 'old-guest@example.com', createdBy: w.f.ids.owner, token: tokenOf('g'), projectId: w.f.projectId });
    const sent = await ok<SendPosted>(w, owner(), 'send.post', postInput(['old-expired@example.com', 'old-withdrawn@example.com', 'old-guest@example.com']));
    expect(sent.invited!.map((o) => o.result)).toEqual(['invited', 'invited', 'invited']);
    const sent2 = await ok<SendPosted>(w, owner(), 'send.post', postInput(['old-accepted@example.com']));
    // Accepted but not a member (removed since, or never activated here): a new invitation, like any non-member.
    expect(sent2.invited!.map((o) => o.result)).toEqual(['invited']);
  });

  it('the sender’s own address is refused (invalid), and nothing is written', async () => {
    const before = await world();
    expect(await code(w, editor(), 'send.post', postInput(['editor@example.test']))).toBe('invalid');
    expect(await code(w, editor(), 'send.post', postInput([' Editor@Example.TEST', 'new@example.com']))).toBe('invalid');
    expect(await world()).toEqual(before);
  });

  it('addresses are normalised and duplicates collapse: one invitation', async () => {
    const sent = await ok<SendPosted>(w, owner(), 'send.post', postInput([' New@Example.COM ', 'new@example.com', 'NEW@example.com']));
    expect(sent.invited!.map((o) => [o.email, o.result])).toEqual([['new@example.com', 'invited']]);
    expect(await count('brand_invites', 'email = $1', ['new@example.com'])).toBe(1);
    for (const bad of ['not an address', 'a@b', '', 'x'.repeat(250) + '@example.com']) expect(await code(w, owner(), 'send.post', postInput([bad])), bad).toBe('invalid');
  });

  it('two lines inviting one new address make one invitation and two waiting lines; an inviting line takes 4a’s key-share lock, then the organization’s invitation lock, before it reads anything', async () => {
    const texts: string[] = [];
    const first = await runRoomOperation({ sql: recording(w.f.sql, texts), media: w.deps.media }, editor(), 'send.post', { organizationId: w.f.orgId, ...postInput(['twice@example.com']) });
    const second = await ok<SendPosted>(w, owner(), 'send.post', postInput(['twice@example.com']));
    expect(first.result.ok && (first.result as SendPosted).invited![0]!.result).toBe('invited');
    expect(second.invited![0]!.result).toBe('reused');
    expect(await count('brand_invites', 'email = $1', ['twice@example.com'])).toBe(1);
    expect(await count('brand_room_pending_mentions')).toBe(2);
    // The lock is the first statement after the seat, before any line, file, member or invitation is read: two such lines
    // run one after the other (PGlite has one connection; the order is what makes the cloud's concurrent case the same).
    // 4a's `for key share` (it waits for, and holds off, every invitation writer's `for update`), then the organization's
    // transaction-scoped invitation lock (inviting lines queue behind each other); no other row lock on the organization.
    const keyShare = texts.findIndex((t) => /from brand_organizations where id = \$1 for key share$/.test(t));
    const invitationLock = texts.findIndex((t) => /pg_advisory_xact_lock\(hashtextextended\('brand-send-invite:'/.test(t));
    const firstInviteRead = texts.findIndex((t) => /from brand_invites/.test(t));
    const firstLineRead = texts.findIndex((t) => /brand_room_messages/.test(t));
    expect(keyShare).toBeGreaterThan(-1);
    expect(invitationLock).toBe(keyShare + 1);
    expect(invitationLock).toBeLessThan(firstInviteRead);
    expect(invitationLock).toBeLessThan(firstLineRead);
    expect(texts.some((t) => /brand_organizations.*for (no key )?update/.test(t))).toBe(false);
    // A line that invites nobody takes no invitation lock.
    const plain: string[] = [];
    await runRoomOperation({ sql: recording(w.f.sql, plain), media: w.deps.media }, editor(), 'send.post', { organizationId: w.f.orgId, ...postInput([]) });
    expect(plain.some((t) => /pg_advisory_xact_lock/.test(t))).toBe(false);
  });

  it('an address that became a member between the lookup and the send is named, not invited', async () => {
    expect((await ok(w, editor(), 'send.lookup', { email: 'joiner@example.com' })).status).toBe('invitable');
    const joiner = await person(w.f.sql, 'joiner@example.com');
    await w.f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'viewer')", [w.f.orgId, joiner]);
    const sent = await ok<SendPosted>(w, editor(), 'send.post', postInput(['joiner@example.com']));
    expect(sent.invited).toEqual([{ email: 'joiner@example.com', result: 'member', memberId: joiner, token: null, mailState: null }]);
    expect(await count('brand_invites', 'email = $1', ['joiner@example.com'])).toBe(0);
  });

  it('when the invitation cannot be written, the line is not posted either', async () => {
    await w.f.db.exec(`create function test_refuse_invite() returns trigger language plpgsql as $$ begin raise exception 'refused for the test'; end $$;
      create trigger test_refuse_invite before insert on brand_invites for each row execute function test_refuse_invite();`);
    const before = await world();
    await expect(op(w, owner(), 'send.post', postInput(['new@example.com']))).rejects.toThrow(/refused for the test/);
    expect(await world()).toEqual(before);
  });

  it('a reply may invite too: the reply waits for the invitation', async () => {
    const root = (await ok<SendPosted>(w, owner(), 'send.post', postInput([]))).thread.rootId;
    const sent = await ok<SendPosted>(w, editor(), 'send.reply', { requestId: randomUUID(), rootId: root, body: 'Adding someone', invites: ['replied@example.com'] });
    expect(sent.message.parentId).toBe(root);
    expect(sent.invited![0]!.result).toBe('invited');
    expect(sent.message.invites).toEqual([{ state: 'pending', email: 'replied@example.com' }]);
    expect((await w.f.sql.query('select message_id::text as m from brand_room_pending_mentions')).rows).toEqual([{ m: sent.message.id }]);
  });

  it('a body that carries an invited address is refused: the address never travels in a line’s text', async () => {
    const before = await world();
    expect(await code(w, owner(), 'send.post', postInput(['new@example.com'], { body: '@new@example.com 이 컷 봐 주세요' }))).toBe('invalid');
    expect(await code(w, owner(), 'send.post', postInput(['new@example.com'], { body: 'see NEW@EXAMPLE.COM' }))).toBe('invalid');
    expect(await world()).toEqual(before);
  });

  it('a retried request answers the same line, without a second invitation and without `invited`', async () => {
    const input = postInput(['retry@example.com']);
    const first = await ok<SendPosted>(w, owner(), 'send.post', input);
    const again = await ok<SendPosted>(w, owner(), 'send.post', input);
    expect(again.message.id).toBe(first.message.id);
    expect(again.invited).toBeUndefined();
    expect(again.message.invites).toEqual([{ state: 'pending', email: 'retry@example.com' }]);
    expect(await count('brand_invites', 'email = $1', ['retry@example.com'])).toBe(1);
  });

  it('an unfiled library entry can be sent with an invitation too', async () => {
    const asset = await libraryPicture(w);
    const sent = await ok<SendPosted>(w, owner(), 'send.post', { requestId: randomUUID(), file: { kind: 'asset', assetId: asset }, body: 'Our logo', invites: ['logo@example.com'] });
    expect(sent.thread.file.project).toBeNull();
    expect(sent.invited![0]!.result).toBe('invited');
  });
});

describe('limits (decision 4)', () => {
  it(`at most ${SEND_LIMITS.invitesPerMessage} addresses per line (invalid; an empty list is no invitation)`, async () => {
    const four = ['a1@example.com', 'a2@example.com', 'a3@example.com', 'a4@example.com'];
    expect(await code(w, owner(), 'send.post', postInput(four))).toBe('invalid');
    expect((await ok<SendPosted>(w, owner(), 'send.post', postInput(four.slice(0, 3)))).invited).toHaveLength(3);
    const none = await ok<SendPosted>(w, owner(), 'send.post', postInput([]));
    expect(none.invited).toBeUndefined();
    expect(none.message.invites).toEqual([]);
  });

  it('the daily cap counts the members page’s invitations too: over it, nothing is written and nothing is sent (invite_limit)', async () => {
    for (let i = 0; i < BRAND_INVITES_PER_DAY - 2; i += 1) {
      expect((await createBrandInvitation({ sql: w.f.sql }, owner(), { organizationId: w.f.orgId, email: `page${i}@example.com`, role: 'viewer', requestId: randomUUID() })).ok).toBe(true);
    }
    // A member and a live invitation cost nothing; three new ones would make 21.
    const before = await world();
    expect(await code(w, owner(), 'send.post', postInput(['c1@example.com', 'c2@example.com', 'c3@example.com']))).toBe('invite_limit');
    expect(await world()).toEqual(before);
    const fits = await ok<SendPosted>(w, owner(), 'send.post', postInput(['c1@example.com', 'page0@example.com', 'viewer@example.test']));
    expect(fits.invited!.map((o) => o.result)).toEqual(['invited', 'reused', 'member']);
    expect(await count('brand_invites', "created_at > now() - interval '1 day'")).toBe(BRAND_INVITES_PER_DAY - 1);
    await ok(w, owner(), 'send.post', postInput(['c2@example.com']));
    expect(await code(w, owner(), 'send.post', postInput(['c3@example.com']))).toBe('invite_limit');
    // And the members page counts 보내기's: it is full too.
    expect(await createBrandInvitation({ sql: w.f.sql }, owner(), { organizationId: w.f.orgId, email: 'late@example.com', role: 'viewer', requestId: randomUUID() })).toEqual({ ok: false, code: 'rate_limited' });
  });

  it(`one invitation waits for at most ${SEND_LIMITS.linesPerInvitation} lines (invite_limit)`, async () => {
    const live = await invitation(w.f.sql, { organizationId: w.f.orgId, email: 'busy@example.com', createdBy: w.f.ids.owner, token: tokenOf('busy') });
    for (let i = 0; i < SEND_LIMITS.linesPerInvitation; i += 1) {
      const line = (await ok<SendPosted>(w, owner(), 'send.post', postInput([]))).message.id;
      await waiting(w.f.sql, { organizationId: w.f.orgId, messageId: line, inviteId: live });
      // Stay under the rooms' per-minute rate (ROOM_LIMITS.messagesPerMinute): age the line.
      await w.f.sql.query("update brand_room_messages set created_at = now() - interval '2 minutes' where id = $1", [line]);
    }
    const before = await world();
    expect(await code(w, owner(), 'send.post', postInput(['busy@example.com']))).toBe('invite_limit');
    expect(await world()).toEqual(before);
  });

  it(`the people named plus the people invited fit the rooms’ ${ROOM_LIMITS.mentionsMax} (invalid)`, async () => {
    const many: string[] = [];
    for (let i = 0; i < ROOM_LIMITS.mentionsMax - 1; i += 1) {
      const id = await person(w.f.sql, `m${i}@example.com`);
      await w.f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'viewer')", [w.f.orgId, id]);
      many.push(id);
    }
    expect(await code(w, owner(), 'send.post', postInput(['x1@example.com', 'x2@example.com'], { mentions: many }))).toBe('invalid');
    expect((await ok<SendPosted>(w, owner(), 'send.post', postInput(['x1@example.com'], { mentions: many }))).invited).toHaveLength(1);
  });
});

export type { SqlRunner };
