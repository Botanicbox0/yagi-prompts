import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { roomAudience, roomSeat, RoomDenied } from '@/lib/brand-rooms/access';
import { buildRoomInviteEmail, loadRoomAccess, runRoomPeopleOperation } from '@/lib/brand-rooms/invites';
import { postRoomEvent } from '@/lib/brand-rooms/events';
import { runRoomOperation } from '@/lib/brand-rooms/messages';
import { runRoomNoticePass } from '@/lib/brand-rooms/notices';
import { loadStoryboardList } from '@/lib/brand-rooms/storyboards';
import { runRoomReviewOperation } from '@/lib/brand-studio/review';
import { acceptBrandInvitation, createBrandInvitation } from '@/lib/brands/workspace/service';
import { invitationLanding } from '@/lib/brands/workspace/selection';
import { createMemoryMediaStore } from '@/lib/brand-studio/media-store';
import { createFakeMailer, type FakeMailer } from '@/lib/notify/mailer-fake';
import type { RoomInviteResult, RoomInviteSent } from '@/lib/brand-rooms/invite-contracts';
import { seedProfile } from '../../helpers/billing';
import { memoryStaging, studioFixture, viewerOf, type StudioFixture } from '../../brand-studio/server/helpers';

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §12 — invitations to a project room: who may issue them, the caps, inviting
 * the same address again, the mail, the acceptance rules (strict for the brand, single-use binding for a
 * project), `can_comment` on every room write, the guest's walls, and removal (access and notices).
 */
let f: StudioFixture;
let mailer: FakeMailer;

function invitesOn(extra: Record<string, string> = {}) {
  vi.stubEnv('BRAND_ROOMS', 'on');
  vi.stubEnv('BRAND_ROOM_INVITES', 'on');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://twings.app');
  for (const [k, v] of Object.entries(extra)) vi.stubEnv(k, v);
}

beforeEach(async () => {
  invitesOn();
  f = await studioFixture({ orgName: 'Lumen Beauty' });
  await f.sql.query("update profiles set display_name = 'Mina Park' where id = $1", [f.ids.owner]);
  mailer = createFakeMailer();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await f.db.close();
});

const deps = (m: FakeMailer | null = mailer) => ({ sql: f.sql, mailer: m });
const send = (by: string, emails: string[], extra: Record<string, unknown> = {}, m: FakeMailer | null = mailer) =>
  runRoomPeopleOperation(deps(m), viewerOf(by), 'invite.send', { organizationId: f.orgId, projectId: f.projectId, emails, requestId: randomUUID(), ...extra });
const tokenOf = (result: RoomInviteResult) => decodeURIComponent(result.link!.split('#token=')[1]!);
const tokenFromMail = (html: string) => decodeURIComponent(/#token=([A-Za-z0-9_%-]+)/.exec(html)![1]!);
const accept = (userId: string, token: string, options: { verifiedEmail?: string; binding?: boolean } = {}) =>
  acceptBrandInvitation(
    { sql: f.sql, verifiedEmail: options.verifiedEmail, projectGuestBinding: options.binding ?? true, roomLanding: options.binding ?? true },
    viewerOf(userId),
    { token },
  );
const pendingRows = async () =>
  (await f.sql.query<{ email: string; revoked_at: Date | null; accepted_at: Date | null; mail_state: string | null }>('select email, revoked_at, accepted_at, mail_state from brand_invites order by created_at')).rows;

async function newAccount(email: string): Promise<string> {
  const id = randomUUID();
  await seedProfile(f.sql, { id, email });
  return id;
}

async function secondProject(sql: SqlRunner): Promise<string> {
  const id = randomUUID();
  await sql.query(
    `insert into brand_projects (id, organization_id, title, objective, production_mode, created_by, request_id, client_visible)
      values ($1, $2, 'Autumn', 'Launch the autumn line', 'creator', $3, $4, true)`,
    [id, f.orgId, f.ids.owner, randomUUID()],
  );
  return id;
}

describe('issuing', () => {
  it('lets owners and editors invite, and nobody else', async () => {
    expect(await send(f.ids.owner, ['a@partner.test'])).toMatchObject({ ok: true });
    expect(await send(f.ids.editor, ['b@partner.test'])).toMatchObject({ ok: true });
    expect(await send(f.ids.viewer, ['c@partner.test'])).toEqual({ ok: false, code: 'forbidden' });
    expect(await send(f.ids.guest, ['d@partner.test'])).toEqual({ ok: false, code: 'forbidden' });
    expect(await send(f.ids.outsider, ['e@partner.test'])).toEqual({ ok: false, code: 'not_found' });
    const rows = (await f.sql.query('select email, role, project_id, issued_by_studio, can_comment from brand_invites order by email')).rows;
    expect(rows).toEqual([
      { email: 'a@partner.test', role: 'viewer', project_id: f.projectId, issued_by_studio: false, can_comment: true },
      { email: 'b@partner.test', role: 'viewer', project_id: f.projectId, issued_by_studio: false, can_comment: true },
    ]);
  });

  it('refuses a project the brand cannot see', async () => {
    await f.sql.query('update brand_projects set client_visible = false where id = $1', [f.projectId]);
    expect(await send(f.ids.owner, ['a@partner.test'])).toEqual({ ok: false, code: 'not_found' });
  });

  it('takes at most 10 addresses at once, folds case and duplicates, and skips members', async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `p${i}@partner.test`);
    expect(await send(f.ids.owner, eleven)).toEqual({ ok: false, code: 'too_many' });
    expect(await send(f.ids.owner, ['not-an-address'])).toEqual({ ok: false, code: 'invalid' });
    const result = (await send(f.ids.owner, ['A@Partner.test', 'a@partner.test', 'editor@example.test'])) as RoomInviteSent;
    expect(result.results.map((r) => [r.email, r.state])).toEqual([
      ['a@partner.test', 'sent'],
      ['editor@example.test', 'already_member'],
    ]);
  });

  it('keeps 20 a day per brand and 20 waiting per project', async () => {
    const batch = (n: number, from: number) => Array.from({ length: n }, (_, i) => `p${from + i}@partner.test`);
    expect(await send(f.ids.owner, batch(10, 0))).toMatchObject({ ok: true });
    expect(await send(f.ids.owner, batch(10, 10))).toMatchObject({ ok: true });
    expect(await send(f.ids.owner, batch(1, 20))).toEqual({ ok: false, code: 'rate_limited' });
    // Two days later the brand's day is free again, but the twenty still wait in this project.
    await f.sql.query("update brand_invites set created_at = now() - interval '2 days', expires_at = now() + interval '1 day'");
    expect(await send(f.ids.owner, batch(1, 20))).toEqual({ ok: false, code: 'project_limit' });
    // Re-inviting an address that is already waiting refreshes it and is not refused by the project cap.
    expect(await send(f.ids.owner, batch(1, 0))).toMatchObject({ ok: true });
    // Another project of the same brand is free of this project's cap, not of the brand's day.
    const other = await secondProject(f.sql);
    const elsewhere = (n: number, from: number) =>
      runRoomPeopleOperation(deps(), viewerOf(f.ids.owner), 'invite.send', { organizationId: f.orgId, projectId: other, emails: batch(n, from), requestId: randomUUID() });
    expect(await elsewhere(10, 100)).toMatchObject({ ok: true });
    expect(await elsewhere(9, 200)).toMatchObject({ ok: true });
    expect(await elsewhere(1, 300)).toEqual({ ok: false, code: 'rate_limited' });
  });

  it('refreshes a waiting invitation to the same address: the old link dies, one stays pending', async () => {
    const first = (await send(f.ids.owner, ['a@partner.test'], {}, null)) as RoomInviteSent;
    const oldToken = tokenOf(first.results[0]!);
    expect(await send(f.ids.owner, ['a@partner.test'])).toMatchObject({ ok: true });
    const rows = await pendingRows();
    expect(rows.filter((r) => !r.revoked_at)).toHaveLength(1);
    expect(rows).toHaveLength(2);
    const someone = await newAccount('someone@gmail.test');
    expect(await accept(someone, oldToken)).toEqual({ ok: false, code: 'not_found' });
    const people = await loadRoomAccess({ sql: f.sql }, viewerOf(f.ids.owner), { organizationId: f.orgId, projectId: f.projectId });
    expect(people.ok && people.pending.map((p) => p.email)).toEqual(['a@partner.test']);
  });

  it('answers a retried send with what the first one stored, never a second token', async () => {
    const requestId = randomUUID();
    const once = await send(f.ids.owner, ['a@partner.test'], { requestId });
    const twice = await send(f.ids.owner, ['a@partner.test'], { requestId });
    expect(once).toMatchObject({ ok: true });
    expect(twice).toMatchObject({ ok: true, results: [{ email: 'a@partner.test', state: 'sent', link: null }] });
    expect(await pendingRows()).toHaveLength(1);
    expect(mailer.sent).toHaveLength(1);
  });
});

describe('the invitation mail', () => {
  it('names the inviter, the brand and the project, carries one button with the token in the fragment, the expiry and the personal line', async () => {
    const result = (await send(f.ids.owner, ['a@partner.test'])) as RoomInviteSent;
    expect(result.results).toEqual([expect.objectContaining({ email: 'a@partner.test', state: 'sent', link: null })]);
    expect(mailer.sent).toHaveLength(1);
    const mail = mailer.sent[0]!;
    const copy = (await import('@/lib/i18n/dictionaries')).getDictionary('ko').roomsShare.mail;
    expect(mail.to).toBe('a@partner.test');
    expect(mail.subject).toBe(copy.subject.replace('{inviter}', 'Mina Park').replace('{project}', 'Spring launch'));
    expect(mail.html).toContain('Lumen Beauty');
    expect(mail.html).toContain('Spring launch');
    expect(mail.html).toContain(copy.personal.replace(/'/g, '&#39;'));
    expect(mail.html).toMatch(/https:\/\/[^"]*\/brand\/invite#token=[A-Za-z0-9_-]{43}/);
    expect(mail.text).toContain(copy.button);
    expect(mail.unsubscribeUrl).toBe('');
    expect(mail.idempotencyKey).toMatch(/^room-invite:/);
    // The token in the mail opens the invitation.
    const guest = await newAccount('person@gmail.test');
    expect(await accept(guest, tokenFromMail(mail.html))).toMatchObject({ ok: true, projectId: f.projectId });
    expect((await pendingRows())[0]).toMatchObject({ mail_state: 'sent' });
  });

  it('builds the mail from the dictionary for both languages, with the comment line only when they may comment', () => {
    const base = { token: 'T'.repeat(43), organizationName: 'Lumen', projectTitle: 'Spring', inviterName: 'Mina', expiresAt: new Date('2026-11-25T03:00:00Z'), env: { NEXT_PUBLIC_APP_URL: 'https://twings.app' } as unknown as NodeJS.ProcessEnv };
    const ko = buildRoomInviteEmail({ ...base, locale: 'ko', canComment: true });
    const view = buildRoomInviteEmail({ ...base, locale: 'ko', canComment: false });
    const en = buildRoomInviteEmail({ ...base, locale: 'en', canComment: true });
    const dict = (locale: 'ko' | 'en') => import('@/lib/i18n/dictionaries').then((m) => m.getDictionary(locale).roomsShare.mail);
    return Promise.all([dict('ko'), dict('en')]).then(([k, e]) => {
      expect(ko.text).toContain(k.bodyComment);
      expect(view.text).not.toContain(k.bodyComment);
      expect(en.text).toContain(e.bodyComment);
      expect(ko.text).toContain('2026년 11월 25일');
      expect(en.text).toContain('November 25, 2026');
      expect(ko.buttonUrl).toBe(`https://brand.twings.app/brand/invite#token=${'T'.repeat(43)}`);
    });
  });

  it('sends nothing without a mailer and hands the link back to pass on', async () => {
    const result = (await send(f.ids.owner, ['a@partner.test'], {}, null)) as RoomInviteSent;
    expect(result.results[0]).toMatchObject({ state: 'skipped' });
    expect(result.results[0]!.link).toMatch(/\/brand\/invite#token=[A-Za-z0-9_-]{43}$/);
    expect((await pendingRows())[0]).toMatchObject({ mail_state: 'skipped' });
  });

  it('records a refused mail as failed, hands the link back, and a re-send mails a fresh link', async () => {
    mailer.failNext({ retryable: false, error: 'bounced' });
    const result = (await send(f.ids.owner, ['a@partner.test'])) as RoomInviteSent;
    expect(result.results[0]).toMatchObject({ state: 'failed' });
    expect(result.results[0]!.link).toBeTruthy();
    const people = await loadRoomAccess({ sql: f.sql }, viewerOf(f.ids.owner), { organizationId: f.orgId, projectId: f.projectId });
    expect(people.ok && people.pending).toEqual([expect.objectContaining({ email: 'a@partner.test', mailState: 'failed' })]);
    const pendingId = people.ok ? people.pending[0]!.id : '';
    const again = (await runRoomPeopleOperation(deps(), viewerOf(f.ids.owner), 'invite.resend', { organizationId: f.orgId, projectId: f.projectId, inviteId: pendingId })) as RoomInviteSent;
    expect(again.results[0]).toMatchObject({ state: 'sent', link: null });
    const someone = await newAccount('x@gmail.test');
    expect(await accept(someone, tokenOf(result.results[0]!))).toEqual({ ok: false, code: 'not_found' });
  });
});

describe('acceptance', () => {
  it('keeps the strict e-mail match for an invitation to the brand, even with invitations on', async () => {
    const issued = await createBrandInvitation({ sql: f.sql }, viewerOf(f.ids.owner), { organizationId: f.orgId, email: 'new@partner.test', role: 'viewer', requestId: randomUUID() });
    if (!issued.ok) throw new Error(issued.code);
    const other = await newAccount('other@gmail.test');
    expect(await accept(other, issued.token, { verifiedEmail: 'other@gmail.test' })).toEqual({ ok: false, code: 'forbidden' });
    const right = await newAccount('new@partner.test');
    expect(await accept(right, issued.token, { verifiedEmail: 'new@partner.test' })).toMatchObject({ ok: true, organizationId: f.orgId });
  });

  it('binds a project invitation to the first account that accepts it, once', async () => {
    const result = (await send(f.ids.owner, ['work@partner.test'], { canComment: false }, null)) as RoomInviteSent;
    const token = tokenOf(result.results[0]!);
    const kakao = await newAccount('person@kakao.test');
    const landed = await accept(kakao, token, { verifiedEmail: 'person@kakao.test' });
    expect(landed).toMatchObject({ ok: true, projectId: f.projectId, projectShared: true, room: { target: null } });
    expect(invitationLanding(landed as never)).toBe(`/brand/rooms/${f.projectId}?organizationId=${f.orgId}`);
    const row = (await f.sql.query('select accepted_by, accepted_email from brand_invites where email = $1', ['work@partner.test'])).rows[0];
    expect(row).toEqual({ accepted_by: kakao, accepted_email: 'person@kakao.test' });
    expect((await f.sql.query('select can_comment, status from brand_project_members where user_id = $1', [kakao])).rows).toEqual([{ can_comment: false, status: 'active' }]);
    // The same account again is a no-op; any other account is turned away.
    expect(await accept(kakao, token, { verifiedEmail: 'person@kakao.test' })).toMatchObject({ ok: true });
    const second = await newAccount('second@gmail.test');
    expect(await accept(second, token, { verifiedEmail: 'second@gmail.test' })).toEqual({ ok: false, code: 'not_found' });
    // The inviter sees who got in.
    const people = await loadRoomAccess({ sql: f.sql }, viewerOf(f.ids.owner), { organizationId: f.orgId, projectId: f.projectId });
    expect(people.ok && people.guests.find((g) => g.userId === kakao)).toMatchObject({ email: 'person@kakao.test', invitedEmail: 'work@partner.test', canComment: false });
  });

  it('lands on the item the invitation was sent from', async () => {
    const boardId = (
      await f.sql.query<{ id: string }>(
        `insert into brand_storyboards (organization_id, project_id, lineage_id, title, version, status, created_by, created_role, source, shared_at)
          values ($1, $2, gen_random_uuid(), 'Board', 1, 'shared', $3, 'studio', 'manual', now()) returning id`,
        [f.orgId, f.projectId, f.ids.admin],
      )
    ).rows[0]!.id;
    expect(await send(f.ids.owner, ['a@partner.test'], { target: { kind: 'storyboard', id: randomUUID() } }, null)).toEqual({ ok: false, code: 'not_found' });
    const result = (await send(f.ids.owner, ['a@partner.test'], { target: { kind: 'storyboard', id: boardId } }, null)) as RoomInviteSent;
    const guest = await newAccount('p@gmail.test');
    const landed = await accept(guest, tokenOf(result.results[0]!));
    expect(invitationLanding(landed as never)).toBe(`/brand/rooms/${f.projectId}?organizationId=${f.orgId}&tab=storyboard&board=${boardId}`);
  });

  it('refuses an expired or a cancelled invitation, and the relaxed rule needs the switch', async () => {
    const one = tokenOf(((await send(f.ids.owner, ['a@partner.test'], {}, null)) as RoomInviteSent).results[0]!);
    const two = (await send(f.ids.owner, ['b@partner.test'], {}, null)) as RoomInviteSent;
    const three = tokenOf(((await send(f.ids.owner, ['c@partner.test'], {}, null)) as RoomInviteSent).results[0]!);
    await f.sql.query("update brand_invites set created_at = now() - interval '8 days', expires_at = now() - interval '1 day' where email = 'a@partner.test'");
    expect(await runRoomPeopleOperation(deps(), viewerOf(f.ids.owner), 'invite.cancel', { organizationId: f.orgId, projectId: f.projectId, inviteId: two.results[0]!.inviteId })).toEqual({ ok: true });
    const guest = await newAccount('p@gmail.test');
    expect(await accept(guest, one)).toEqual({ ok: false, code: 'not_found' });
    expect(await accept(guest, tokenOf(two.results[0]!))).toEqual({ ok: false, code: 'not_found' });
    // Invitations off: a project invitation needs the matching e-mail again, as before.
    expect(await accept(guest, three, { binding: false, verifiedEmail: 'p@gmail.test' })).toEqual({ ok: false, code: 'forbidden' });
  });

  it('dies with its inviter: an editor who has left can no longer bring anyone in', async () => {
    const token = tokenOf(((await send(f.ids.editor, ['a@partner.test'], {}, null)) as RoomInviteSent).results[0]!);
    await f.sql.query("update brand_memberships set status = 'revoked' where user_id = $1", [f.ids.editor]);
    const guest = await newAccount('p@gmail.test');
    expect(await accept(guest, token)).toEqual({ ok: false, code: 'not_found' });
  });
});

describe('a guest invited to view only', () => {
  async function guestWith(canComment: boolean): Promise<string> {
    const token = tokenOf(((await send(f.ids.owner, [`g${canComment}@partner.test`], { canComment }, null)) as RoomInviteSent).results[0]!);
    const id = await newAccount(`g${canComment}@gmail.test`);
    expect(await accept(id, token)).toMatchObject({ ok: true });
    return id;
  }
  const media = createMemoryMediaStore();
  const chat = (userId: string, operation: string, input: Record<string, unknown>) =>
    runRoomOperation({ sql: f.sql, media }, viewerOf(userId), operation, { organizationId: f.orgId, projectId: f.projectId, ...input });

  async function seedReview(): Promise<string> {
    const assetId = (
      await f.sql.query<{ id: string }>(
        `insert into brand_studio_assets (organization_id, kind, name, mime, size_bytes, width, height, storage_key, source, status, created_by)
           values ($1, 'image', 'Cut', 'image/png', 10, 64, 48, $2, 'delivery', 'ready', $3) returning id`,
        [f.orgId, `st/${'c'.repeat(64)}.png`, f.ids.admin],
      )
    ).rows[0]!.id;
    return (
      await f.sql.query<{ id: string }>(
        `insert into brand_studio_reviews (organization_id, asset_id, title, created_by, created_role, project_id, source) values ($1, $2, 'Main film', $3, 'studio', $4, 'delivery') returning id`,
        [f.orgId, assetId, f.ids.admin, f.projectId],
      )
    ).rows[0]!.id;
  }

  it('reads the room but cannot write a line, a reaction, an attachment, an edit or a draft note', async () => {
    const quiet = await guestWith(false);
    const talker = await guestWith(true);
    const reviewId = await seedReview();
    const line = (await chat(talker, 'message.send', { requestId: randomUUID(), body: 'Hello' })).result as { ok: true; message: { id: string } };
    expect(line.ok).toBe(true);
    expect((await chat(quiet, 'message.send', { requestId: randomUUID(), body: 'Hi' })).result).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await chat(quiet, 'reaction.toggle', { messageId: line.message.id, emoji: 'thumbs_up' })).result).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await chat(quiet, 'attachment.reserve', { name: 'a.png', mime: 'image/png', size: 10 })).result).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await chat(quiet, 'attachment.complete', { stagingKey: 'x' })).result).toMatchObject({ ok: false });
    expect((await chat(quiet, 'message.edit', { messageId: line.message.id, body: 'x' })).result).toMatchObject({ ok: false, code: 'forbidden' });
    const review = (userId: string, operation: string, input: Record<string, unknown>) =>
      runRoomReviewOperation({ sql: f.sql, media }, viewerOf(userId), operation, { organizationId: f.orgId, projectId: f.projectId, ...input }).then((o) => o.result);
    expect(await review(quiet, 'comment.add', { reviewId, body: 'Smaller logo', atMs: 1000 })).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await review(quiet, 'comment.add', { reviewId, body: 'x', atMs: null, strokes: [{ tool: 'pen', color: 'blue', points: [[0, 0], [1, 1]] }] })).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await review(quiet, 'review.status', { reviewId, status: 'approved' })).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await review(talker, 'comment.add', { reviewId, body: 'Smaller logo', atMs: 1000 })).toMatchObject({ ok: true });
    // Reading still works, and says what the screen may offer.
    expect((await chat(quiet, 'channel.read', {})).result).toMatchObject({ ok: true });
    const boards = await loadStoryboardList({ sql: f.sql, media, staging: memoryStaging() }, viewerOf(quiet), f.orgId, f.projectId);
    expect(boards).toMatchObject({ ok: true, canTalk: false, canEdit: false });
    expect(await loadStoryboardList({ sql: f.sql, media, staging: memoryStaging() }, viewerOf(talker), f.orgId, f.projectId)).toMatchObject({ ok: true, canTalk: true });
  });

  it('talks again once the inviter allows comments', async () => {
    const quiet = await guestWith(false);
    expect((await chat(quiet, 'message.send', { requestId: randomUUID(), body: 'Hi' })).result).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await runRoomPeopleOperation(deps(), viewerOf(f.ids.owner), 'guest.permission', { organizationId: f.orgId, projectId: f.projectId, userId: quiet, canComment: true })).toEqual({ ok: true });
    expect((await chat(quiet, 'message.send', { requestId: randomUUID(), body: 'Hi' })).result).toMatchObject({ ok: true });
  });

  it('stays read-only with invitations off too: a guest the team invited to view only cannot write', async () => {
    vi.stubEnv('BRAND_ROOM_INVITES', 'off');
    // The fixture guest, made view-only like the team's view-only invitations (0034).
    await f.sql.query('update brand_project_members set can_comment = false where user_id = $1', [f.ids.guest]);
    expect((await chat(f.ids.guest, 'message.send', { requestId: randomUUID(), body: 'Hi' })).result).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await roomSeat(f.sql, f.ids.guest, f.orgId)).toMatchObject({ role: 'guest', canTalk: false, readOnlyProjectIds: [f.projectId] });
    const reviewId = await seedReview();
    const note = await runRoomReviewOperation({ sql: f.sql, media }, viewerOf(f.ids.guest), 'comment.add', { organizationId: f.orgId, projectId: f.projectId, reviewId, body: 'x', atMs: 0 });
    expect(note.result).toMatchObject({ ok: false, code: 'forbidden' });
    // A guest invited with comments, and every member, talk as before.
    await f.sql.query('update brand_project_members set can_comment = true where user_id = $1', [f.ids.guest]);
    expect((await chat(f.ids.guest, 'message.send', { requestId: randomUUID(), body: 'Hi' })).result).toMatchObject({ ok: true });
    for (const member of [f.ids.owner, f.ids.editor, f.ids.viewer]) {
      expect((await chat(member, 'message.send', { requestId: randomUUID(), body: 'Hi' })).result, member).toMatchObject({ ok: true });
    }
  });
});

describe('the team desk list', () => {
  it('shows the project\'s guests and waiting invitations to the team only', async () => {
    const { staffProjectGuests } = await import('@/lib/brand-rooms/invites');
    const token = tokenOf(((await send(f.ids.owner, ['a@partner.test'], { canComment: false }, null)) as RoomInviteSent).results[0]!);
    await send(f.ids.owner, ['b@partner.test'], {}, null);
    const guest = await newAccount('p@gmail.test');
    await accept(guest, token);
    const admin = { ...viewerOf(f.ids.admin), isAdmin: true };
    const list = await staffProjectGuests({ sql: f.sql }, admin, { organizationId: f.orgId, projectId: f.projectId });
    if (!list.ok) throw new Error(list.code);
    expect(list.guests.map((g) => [g.email, g.canComment])).toEqual([
      ['guest@example.test', true],
      ['p@gmail.test', false],
    ]);
    expect(list.guests[1]).toMatchObject({ invitedEmail: 'a@partner.test' });
    expect(list.pending.map((p) => p.email)).toEqual(['b@partner.test']);
    // The admin flag is the database's, not the session's; a project of another brand is not found.
    expect(await staffProjectGuests({ sql: f.sql }, { ...viewerOf(f.ids.owner), isAdmin: true }, { organizationId: f.orgId, projectId: f.projectId })).toEqual({ ok: false, code: 'forbidden' });
    expect(await staffProjectGuests({ sql: f.sql }, admin, { organizationId: randomUUID(), projectId: f.projectId })).toEqual({ ok: false, code: 'not_found' });
  });
});

describe('the guest\'s walls and removal', () => {
  it('opens no other project, not the general channel and not the access list', async () => {
    const token = tokenOf(((await send(f.ids.owner, ['a@partner.test'], {}, null)) as RoomInviteSent).results[0]!);
    const guest = await newAccount('p@gmail.test');
    await accept(guest, token);
    const other = await secondProject(f.sql);
    const media = createMemoryMediaStore();
    expect((await runRoomOperation({ sql: f.sql, media }, viewerOf(guest), 'message.send', { organizationId: f.orgId, projectId: other, requestId: randomUUID(), body: 'x' })).result).toMatchObject({
      ok: false,
      code: 'not_found',
    });
    expect((await runRoomOperation({ sql: f.sql, media }, viewerOf(guest), 'message.send', { organizationId: f.orgId, projectId: 'general', requestId: randomUUID(), body: 'x' })).result).toMatchObject({ ok: false });
    expect(await loadRoomAccess({ sql: f.sql }, viewerOf(guest), { organizationId: f.orgId, projectId: f.projectId })).toEqual({ ok: false, code: 'forbidden' });
    expect(await loadRoomAccess({ sql: f.sql }, viewerOf(guest), { organizationId: f.orgId, projectId: other })).toEqual({ ok: false, code: 'not_found' });
    expect(await send(guest, ['x@partner.test'])).toEqual({ ok: false, code: 'forbidden' });
  });

  it('receives the project\'s notices while seated and none after removal, decided at send time', async () => {
    vi.stubEnv('BRAND_ROOM_NOTIFY', 'on');
    vi.stubEnv('NOTIFY_TOKEN_SECRET', 'test-only-room-notice-secret-0000000000');
    const token = tokenOf(((await send(f.ids.owner, ['a@partner.test'], {}, null)) as RoomInviteSent).results[0]!);
    const guest = await newAccount('p@gmail.test');
    await accept(guest, token);
    expect((await roomAudience(f.sql, f.orgId, f.projectId)).map((m) => m.userId)).toContain(guest);
    expect((await roomAudience(f.sql, f.orgId, null)).map((m) => m.userId)).not.toContain(guest);
    const posted = (event: 'review_posted' | 'storyboard_shared') =>
      postRoomEvent(f.sql, {
        organizationId: f.orgId,
        projectId: f.projectId,
        event,
        ref: event === 'review_posted' ? { kind: 'review', reviewId: randomUUID() } : { kind: 'storyboard', storyboardId: randomUUID() },
        actorId: f.ids.admin,
        actorRole: 'studio',
        detail: { title: 'Main film', version: 2 },
      });
    await posted('review_posted');
    await posted('storyboard_shared');
    const kinds = (await f.sql.query<{ kind: string }>('select kind from brand_room_notices where recipient_id = $1 order by kind', [guest])).rows.map((r) => r.kind);
    expect(kinds).toEqual(['new_version', 'storyboard']);
    // Removed before the pass: nothing reaches them, and every later room request is a 404.
    expect(await runRoomPeopleOperation(deps(), viewerOf(f.ids.owner), 'guest.remove', { organizationId: f.orgId, projectId: f.projectId, userId: guest })).toEqual({ ok: true });
    const passMailer = createFakeMailer();
    await runRoomNoticePass({ sql: f.sql, mailer: passMailer, push: null, now: new Date(Date.now() + 60_000) });
    expect(passMailer.sent.filter((m) => m.to === 'p@gmail.test')).toEqual([]);
    expect((await f.sql.query('select state, skip_reason from brand_room_notices where recipient_id = $1', [guest])).rows).toEqual([
      { state: 'skipped', skip_reason: 'no_access' },
      { state: 'skipped', skip_reason: 'no_access' },
    ]);
    await expect(roomSeat(f.sql, guest, f.orgId)).rejects.toBeInstanceOf(RoomDenied);
    expect((await roomAudience(f.sql, f.orgId, f.projectId)).map((m) => m.userId)).not.toContain(guest);
    // The link that brought them in cannot bring them back.
    expect(await accept(guest, token)).toEqual({ ok: false, code: 'not_found' });
  });

  it('lists members read-only, guests and pending invitations for owners and editors', async () => {
    await send(f.ids.owner, ['a@partner.test'], {}, null);
    const people = await loadRoomAccess({ sql: f.sql }, viewerOf(f.ids.editor), { organizationId: f.orgId, projectId: f.projectId });
    if (!people.ok) throw new Error(people.code);
    expect(people.members.map((m) => [m.role, m.email])).toEqual([
      ['owner', null],
      ['editor', 'editor@example.test'],
      ['viewer', 'viewer@example.test'],
    ]);
    expect(people.guests.map((g) => g.userId)).toEqual([f.ids.guest]);
    expect(people.pending.map((p) => [p.email, p.canComment])).toEqual([['a@partner.test', true]]);
    expect(await loadRoomAccess({ sql: f.sql }, viewerOf(f.ids.viewer), { organizationId: f.orgId, projectId: f.projectId })).toEqual({ ok: false, code: 'forbidden' });
  });
});
