import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmailMessage, Mailer } from '@/lib/notify/mailer';
import { brandOrgInviteEmailOpen } from '@/lib/flags';
import { createBrandInvitation } from '@/lib/brands/workspace/service';
import { deliverOrgInviteEmail } from '@/lib/brands/workspace/invite-mail';
import { studioFixture, viewerOf, type StudioFixture } from '@/tests/brand-studio/server/helpers';

const fixtures: StudioFixture[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  while (fixtures.length > 0) {
    await fixtures.pop()!.db.close();
  }
});

function fakeMailer(outcome: { ok: true; id: string | null } | { ok: false; retryable: boolean; error: string }): Mailer & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    kind: 'fake',
    from: 'YAGI <no-reply@twings.app>',
    sent,
    async send(message) {
      sent.push(message);
      return outcome;
    },
  };
}

describe('BRAND_ORG_INVITE_EMAIL', () => {
  it('is off by default and on only for exactly "on"', () => {
    expect(brandOrgInviteEmailOpen({})).toBe(false);
    expect(brandOrgInviteEmailOpen({ BRAND_ORG_INVITE_EMAIL: undefined })).toBe(false);
    expect(brandOrgInviteEmailOpen({ BRAND_ORG_INVITE_EMAIL: 'off' })).toBe(false);
    expect(brandOrgInviteEmailOpen({ BRAND_ORG_INVITE_EMAIL: 'ON' })).toBe(false);
    expect(brandOrgInviteEmailOpen({ BRAND_ORG_INVITE_EMAIL: 'on' })).toBe(true);
  });

  it('off (default): invitation.create leaves mail_state null and sends nothing', async () => {
    const f = await studioFixture();
    fixtures.push(f);
    const created = await createBrandInvitation({ sql: f.sql }, viewerOf(f.ids.owner), {
      organizationId: f.orgId,
      email: 'teammate@example.test',
      role: 'editor',
      requestId: randomUUID(),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const row = (await f.sql.query<{ mail_state: string | null; mail_sent_at: unknown }>('select mail_state, mail_sent_at from brand_invites where id = $1', [created.id])).rows[0];
    expect(row?.mail_state).toBeNull();
    expect(row?.mail_sent_at).toBeNull();
  });

  it('on: delivers transactional invite mail via mailer, records mail_state=sent, and preserves fallback states on failure/skipped', async () => {
    const f = await studioFixture({ orgName: 'Atelier Test' });
    fixtures.push(f);

    // 1) Successful delivery
    const mailerOk = fakeMailer({ ok: true, id: 'msg-1' });
    const inv1 = await createBrandInvitation({ sql: f.sql }, viewerOf(f.ids.owner), {
      organizationId: f.orgId,
      email: 'alice@example.test',
      role: 'editor',
      requestId: randomUUID(),
    });
    expect(inv1.ok).toBe(true);
    if (!inv1.ok) return;

    const res1 = await deliverOrgInviteEmail({
      sql: f.sql,
      mailer: mailerOk,
      inviteId: inv1.id,
      organizationId: f.orgId,
      inviterUserId: f.ids.owner,
      email: 'alice@example.test',
      role: 'editor',
      token: inv1.token,
      locale: 'ko',
    });
    expect(res1).toBe('sent');
    expect(mailerOk.sent).toHaveLength(1);
    expect(mailerOk.sent[0]!.to).toBe('alice@example.test');
    expect(mailerOk.sent[0]!.idempotencyKey).toBe(`org-invite:${inv1.id}`);
    expect(mailerOk.sent[0]!.html).toContain(`/brand/invite#token=${inv1.token}`);
    expect(mailerOk.sent[0]!.text).toContain('Atelier Test');
    const row1 = (await f.sql.query<{ mail_state: string | null; mail_sent_at: unknown }>('select mail_state, mail_sent_at from brand_invites where id = $1', [inv1.id])).rows[0];
    expect(row1?.mail_state).toBe('sent');
    expect(row1?.mail_sent_at).not.toBeNull();

    // 2) Failed delivery -> mail_state='failed'
    const mailerFail = fakeMailer({ ok: false, retryable: true, error: 'smtp_down' });
    const inv2 = await createBrandInvitation({ sql: f.sql }, viewerOf(f.ids.owner), {
      organizationId: f.orgId,
      email: 'bob@example.test',
      role: 'viewer',
      requestId: randomUUID(),
    });
    expect(inv2.ok).toBe(true);
    if (!inv2.ok) return;
    const res2 = await deliverOrgInviteEmail({
      sql: f.sql,
      mailer: mailerFail,
      inviteId: inv2.id,
      organizationId: f.orgId,
      inviterUserId: f.ids.owner,
      email: 'bob@example.test',
      role: 'viewer',
      token: inv2.token,
      locale: 'en',
    });
    expect(res2).toBe('failed');
    const row2 = (await f.sql.query<{ mail_state: string | null }>('select mail_state from brand_invites where id = $1', [inv2.id])).rows[0];
    expect(row2?.mail_state).toBe('failed');

    // 3) Unconfigured mailer (null) -> mail_state='skipped'
    const inv3 = await createBrandInvitation({ sql: f.sql }, viewerOf(f.ids.owner), {
      organizationId: f.orgId,
      email: 'carol@example.test',
      role: 'editor',
      requestId: randomUUID(),
    });
    expect(inv3.ok).toBe(true);
    if (!inv3.ok) return;
    const res3 = await deliverOrgInviteEmail({
      sql: f.sql,
      mailer: null,
      inviteId: inv3.id,
      organizationId: f.orgId,
      inviterUserId: f.ids.owner,
      email: 'carol@example.test',
      role: 'editor',
      token: inv3.token,
      locale: 'ko',
    });
    expect(res3).toBe('skipped');
  });

  it('never fails invitation delivery when mailer hangs past timeout, throws, or DB mail_state update errors (S7)', async () => {
    const f = await studioFixture({ orgName: 'Timeout Brand' });
    fixtures.push(f);
    const inv = await createBrandInvitation({ sql: f.sql }, viewerOf(f.ids.owner), {
      organizationId: f.orgId,
      email: 'hang@example.test',
      role: 'editor',
      requestId: randomUUID(),
    });
    expect(inv.ok).toBe(true);
    if (!inv.ok) return;

    const hangingMailer: Mailer = {
      kind: 'fake',
      from: 'YAGI <no-reply@twings.app>',
      send: () => new Promise(() => {}),
    };
    const timedOut = await deliverOrgInviteEmail({
      sql: f.sql,
      mailer: hangingMailer,
      inviteId: inv.id,
      organizationId: f.orgId,
      inviterUserId: f.ids.owner,
      email: 'hang@example.test',
      role: 'editor',
      token: inv.token,
      locale: 'ko',
      timeoutMs: 25,
    });
    expect(timedOut).toBe('failed');

    const throwingMailer: Mailer = {
      kind: 'fake',
      from: 'YAGI <no-reply@twings.app>',
      send: async () => {
        throw new Error('smtp boom');
      },
    };
    const throwingSql: typeof f.sql = {
      ...f.sql,
      query: (async (text: string, values?: unknown[]) => {
        if (text.includes('update brand_invites')) throw new Error('db write error');
        return f.sql.query(text, values);
      }) as typeof f.sql.query,
    };
    const dbSafe = await deliverOrgInviteEmail({
      sql: throwingSql,
      mailer: throwingMailer,
      inviteId: inv.id,
      organizationId: f.orgId,
      inviterUserId: f.ids.owner,
      email: 'hang@example.test',
      role: 'editor',
      token: inv.token,
      locale: 'ko',
    });
    expect(dbSafe).toBe('failed');
  });
});
