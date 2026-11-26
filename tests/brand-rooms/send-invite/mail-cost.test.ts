import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { EmailMessage, Mailer } from '@/lib/notify/mailer';
import { acceptBrandInvitation } from '@/lib/brands/workspace/service';
import { buildOrgInviteEmail } from '@/lib/brands/workspace/invite-mail';
import { runRoomOperation } from '@/lib/brand-rooms/messages';
import { sendInviteAcceptHooks } from '@/lib/brand-rooms/send-invite';
import type { SendPosted } from '@/lib/brand-rooms/send-contracts';
import { as, closeWorld, imageResult, libraryPicture, ok, openSend, sendWorld, type SendWorld } from '../send/helpers';
import { invitation, openInvites, person, recording, tokenOf } from './helpers';

/**
 * 초대하고 보내기 (docs/BRAND-PROJECT-SPINE.md §8.5; slice 4c): the mail, and what it costs.
 *  - While `BRAND_ORG_INVITE_EMAIL=on` the one mail a line with one new address sends is the members page's invitation
 *    mail for the same inputs, byte for byte (`buildOrgInviteEmail`), to the invited address only; nothing else is queued
 *    (no notice row, no other mail). Off: nothing is sent, the writer gets the token (copy the link), `mail_state` stays
 *    null, as `invitation.create` with the switch off. A reused invitation sends nothing.
 *  - The statements of a line with one new address, and of an acceptance with N waiting lines (bounded).
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

function fakeMailer(): Mailer & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    kind: 'fake',
    from: 'TWINGS <no-reply@example.com>',
    sent,
    async send(message) {
      sent.push(message);
      return { ok: true, id: `fake-${sent.length}` };
    },
  };
}

const post = (sql: SqlRunner, mailer: Mailer | null, viewer: ReturnType<typeof as>, invites: string[], locale: 'ko' | 'en' = 'ko') =>
  runRoomOperation({ sql, media: w.deps.media, mailer }, { ...viewer, locale }, 'send.post', {
    organizationId: w.f.orgId,
    requestId: randomUUID(),
    file: { kind: 'output', outputId: file },
    body: 'Have a look',
    invites,
  });

describe('the invitation mail', () => {
  for (const locale of ['ko', 'en'] as const) {
    it(`on (${locale}): one mail, the members page’s own for the same inputs, to the invited address; nothing else queued`, async () => {
      vi.stubEnv('BRAND_ORG_INVITE_EMAIL', 'on');
      await w.f.sql.query("update profiles set display_name = 'Editor Lee' where id = $1", [w.f.ids.editor]);
      const mailer = fakeMailer();
      const notices = Number((await w.f.sql.query<{ n: number }>('select count(*)::int as n from brand_room_notices')).rows[0]!.n);
      const { result } = await post(w.f.sql, mailer, as(w.f.ids.editor), ['mailed@example.com'], locale);
      const sent = result as SendPosted;
      expect(sent.invited).toEqual([{ email: 'mailed@example.com', result: 'invited', memberId: null, token: expect.any(String), mailState: 'sent' }]);
      const row = (await w.f.sql.query<{ id: string; expires_at: Date; mail_state: string }>("select id::text as id, expires_at, mail_state from brand_invites where email = 'mailed@example.com'")).rows[0]!;
      expect(row.mail_state).toBe('sent');
      const expected = buildOrgInviteEmail({ locale, token: sent.invited![0]!.token!, organizationName: 'Studio fixture brand', inviterName: 'Editor Lee', role: 'viewer', expiresAt: new Date(String(row.expires_at)) });
      expect(mailer.sent).toEqual([
        { to: 'mailed@example.com', subject: expected.subject, html: expected.html, text: expected.text, idempotencyKey: `org-invite:${row.id}`, unsubscribeUrl: '' },
      ]);
      expect(Number((await w.f.sql.query<{ n: number }>('select count(*)::int as n from brand_room_notices')).rows[0]!.n)).toBe(notices);
    });
  }

  it('off: nothing is sent, the writer gets the token to copy, mail_state stays null; a reused invitation sends nothing either way', async () => {
    const mailer = fakeMailer();
    const { result } = await post(w.f.sql, mailer, as(w.f.ids.owner), ['copy@example.com']);
    expect((result as SendPosted).invited).toEqual([{ email: 'copy@example.com', result: 'invited', memberId: null, token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), mailState: null }]);
    expect((await w.f.sql.query("select mail_state from brand_invites where email = 'copy@example.com'")).rows).toEqual([{ mail_state: null }]);
    vi.stubEnv('BRAND_ORG_INVITE_EMAIL', 'on');
    const reused = await post(w.f.sql, mailer, as(w.f.ids.owner), ['copy@example.com']);
    expect((reused.result as SendPosted).invited![0]).toEqual({ email: 'copy@example.com', result: 'reused', memberId: null, token: null, mailState: null });
    expect(mailer.sent).toEqual([]);
  });

  it('a refused line sends nothing', async () => {
    vi.stubEnv('BRAND_ORG_INVITE_EMAIL', 'on');
    const mailer = fakeMailer();
    const { result } = await post(w.f.sql, mailer, as(w.f.ids.viewer), ['nope@example.com']);
    expect(result).toEqual({ ok: false, code: 'forbidden' });
    const own = await post(w.f.sql, mailer, as(w.f.ids.owner), ['owner@example.test', 'nope@example.com']);
    expect(own.result).toEqual({ ok: false, code: 'invalid' });
    // invite_refused (a removed member named by an editor; an address with an owner's editor invitation): no mail, no
    // invitation, the daily count unchanged.
    const removed = await person(w.f.sql, 'removed.mail@example.com');
    await w.f.sql.query("insert into brand_memberships (organization_id, user_id, role, status) values ($1, $2, 'viewer', 'revoked')", [w.f.orgId, removed]);
    await w.f.sql.query(
      `insert into brand_invites (organization_id, email, role, token_hash, expires_at, created_by, request_id)
         values ($1, 'held.mail@example.com', 'editor', md5('a') || md5('b'), now() + interval '7 days', $2, gen_random_uuid())`,
      [w.f.orgId, w.f.ids.owner],
    );
    const invites = async () => (await w.f.sql.query<{ n: number }>("select count(*)::int as n from brand_invites where created_at > now() - interval '1 day'")).rows[0]!.n;
    const before = await invites();
    for (const email of ['removed.mail@example.com', 'held.mail@example.com']) {
      const refused = await post(w.f.sql, mailer, as(w.f.ids.editor), [email, 'another@example.com']);
      expect(refused.result).toEqual({ ok: false, code: 'invite_refused', refused: [email] });
    }
    expect(await invites()).toBe(before);
    expect(mailer.sent).toEqual([]);
  });
});

describe('what it costs (statements, local recording)', () => {
  it('a line with one new address: an open plain send plus a fixed set (the invitation lock, own address, what the addresses are, daily count, the invitation, the waiting row)', async () => {
    const plain: string[] = [];
    await runRoomOperation({ sql: recording(w.f.sql, plain), media: w.deps.media }, as(w.f.ids.owner), 'send.post', { organizationId: w.f.orgId, requestId: randomUUID(), file: { kind: 'output', outputId: file }, body: 'plain' });
    const inviting: string[] = [];
    await post(recording(w.f.sql, inviting), null, as(w.f.ids.owner), ['cost@example.com']);
    const strip = (texts: string[]) => texts.filter((t) => !/information_schema/.test(t));
    const added = strip(inviting).length - strip(plain).length;
    // the organization's invitation lock (1), own address and seat (1), what the addresses are (1: members, removed
    // members, invitations), the daily count (1), storeInvitation (2: withdraw a stale one, insert), the waiting row (1)
    // = 7. (The root's chips, one statement, are read for any line while open.)
    expect(added).toBe(7);
    expect(strip(inviting).filter((t) => /brand_room_pending_mentions/.test(t))).toHaveLength(2);
  });

  it('an acceptance with N waiting lines: a fixed part plus a bounded part per line', async () => {
    const statementsFor = async (lines: number, email: string): Promise<number> => {
      const live = await invitation(w.f.sql, { organizationId: w.f.orgId, email, createdBy: w.f.ids.owner, token: tokenOf(email) });
      for (let i = 0; i < lines; i += 1) {
        const asset = await libraryPicture(w, w.f.projectId);
        await ok(w, as(w.f.ids.owner), 'send.post', { requestId: randomUUID(), file: { kind: 'asset', assetId: asset }, body: `line ${i}`, invites: [email] });
      }
      expect(Number((await w.f.sql.query<{ n: number }>('select count(*)::int as n from brand_room_pending_mentions where invite_id = $1', [live])).rows[0]!.n)).toBe(lines);
      const invitee = await person(w.f.sql, email);
      const texts: string[] = [];
      const accepted = await acceptBrandInvitation({ sql: recording(w.f.sql, texts), verifiedEmail: email, sendInvites: sendInviteAcceptHooks() }, as(invitee), { token: tokenOf(email) });
      expect(accepted.ok).toBe(true);
      return texts.filter((t) => !/information_schema/.test(t)).length;
    };
    const one = await statementsFor(1, 'n1@example.com');
    const three = await statementsFor(3, 'n3@example.com');
    const perLine = (three - one) / 2;
    expect(Number.isInteger(perLine)).toBe(true);
    // Per line: one mention notice through slice 4a's queue (its savepoint and release, the organization, the sandbox list
    // and the policies of its two features, the members, the insert) = 9 statements, measured; the lines, the update and
    // the delete are one statement each for all lines.
    expect(perLine).toBe(9);
    // The fixed part: slice 4a's acceptance plus the audience check, the lines, the update, the delete and the savepoints.
    expect(one - perLine).toBeLessThan(30);
  });
});
