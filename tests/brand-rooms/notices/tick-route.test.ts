import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { createFakeMailer, type FakeMailer } from '@/lib/notify/mailer-fake';
import { enqueueNotices } from '@/lib/brand-rooms/notices';
import { enqueueTeamNotice } from '@/lib/brands/team-notice-outbox';
import { recordConsumerEscalation } from '@/lib/support/concierge-service';
import { seedProfile } from '@/tests/helpers/billing';
import { noticeEnv, noticeFixture, noticeRows, type NoticeFixture } from './helpers';

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §2.2 — the 10-minute tick: private behind `CRON_SECRET` like the other
 * ticks, inert with the flag off, one pass otherwise (fake mailer, nothing leaves the machine).
 */
const mocks = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
  mailer: null as FakeMailer | null,
  outboxFetcher: undefined as typeof fetch | undefined,
}));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/notify/service', () => ({ getMailer: () => mocks.mailer }));
vi.mock('@/lib/brands/team-notice-outbox', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/brands/team-notice-outbox')>();
  return {
    ...mod,
    runLiveTeamNoticeDeliveryPass: (
      sqlArg: SqlRunner,
      opts?: Parameters<typeof mod.runLiveTeamNoticeDeliveryPass>[1],
    ) => mod.runLiveTeamNoticeDeliveryPass(sqlArg, { ...opts, fetcher: mocks.outboxFetcher ?? opts?.fetcher }),
    syncSlackSupportReplies: (sqlArg: SqlRunner, opts?: Parameters<typeof mod.syncSlackSupportReplies>[1]) =>
      mod.syncSlackSupportReplies(sqlArg, { ...opts, fetcher: mocks.outboxFetcher ?? opts?.fetcher }),
  };
});
const { GET, POST } = await import('@/app/api/brand-rooms/notices/tick/route');

const TICK_URL = 'https://twings.app/api/brand-rooms/notices/tick';
let f: NoticeFixture;

beforeEach(async () => {
  noticeEnv({ CRON_SECRET: 'fixture-cron-secret', WEB_PUSH_PUBLIC_KEY: '', WEB_PUSH_PRIVATE_KEY: '', WEB_PUSH_SUBJECT: '' });
  f = await noticeFixture();
  mocks.sql = f.sql;
  mocks.mailer = createFakeMailer();
  mocks.outboxFetcher = undefined;
});
afterEach(async () => {
  mocks.outboxFetcher = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await f.db.close();
});

const authorized = () => new Request(TICK_URL, { headers: { authorization: 'Bearer fixture-cron-secret' } });

describe('/api/brand-rooms/notices/tick', () => {
  it('refuses without the cron secret configured, without a bearer and with a wrong one', async () => {
    await enqueueNotices(f.sql, { type: 'intake', organizationId: f.orgId, projectId: f.projectId, actorId: f.ids.owner });
    vi.stubEnv('CRON_SECRET', '');
    expect((await GET(authorized())).status).toBe(503);
    vi.stubEnv('CRON_SECRET', 'fixture-cron-secret');
    expect((await GET(new Request(TICK_URL))).status).toBe(401);
    expect((await GET(new Request(TICK_URL, { headers: { authorization: 'Bearer wrong' } }))).status).toBe(401);
    expect((await POST(new Request(TICK_URL, { method: 'POST', headers: { authorization: 'fixture-cron-secret' } }))).status).toBe(401);
    expect(mocks.mailer!.sent).toEqual([]);
    expect((await noticeRows(f.sql))[0]).toMatchObject({ state: 'pending' });
  });

  it('returns at once with the flag off', async () => {
    await enqueueNotices(f.sql, { type: 'intake', organizationId: f.orgId, projectId: f.projectId, actorId: f.ids.owner });
    vi.stubEnv('BRAND_ROOM_NOTIFY', 'off');
    const response = await GET(authorized());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, ran: false });
    expect(mocks.mailer!.sent).toEqual([]);
  });

  it('runs one pass with the right bearer, counts only in the answer', async () => {
    await enqueueNotices(f.sql, { type: 'intake', organizationId: f.orgId, projectId: f.projectId, actorId: f.ids.owner });
    const response = await GET(authorized());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, ran: true, mails: 1, sent: 1 });
    expect(JSON.stringify(body)).not.toContain('@');
    expect(mocks.mailer!.sent).toHaveLength(1);
    expect(mocks.mailer!.sent[0]!.to).toBe('owner@example.test');
  });

  it('F2/F5: isolates throwing room pass so team notices and 365-day transcript retention still run cleanly', async () => {
    // Seed a consumer escalation with an expired (> 365 days) transcript and a queued team notice
    const userId = randomUUID();
    await seedProfile(f.sql, { id: userId, email: 'old-transcript@example.test' });
    const esc = await recordConsumerEscalation(f.sql, {
      userId,
      displayName: 'Old Member Name',
      reason: 'user_requested_human',
      message: 'Old escalation transcript check',
      transcript: [{ role: 'user', text: 'Should be purged after 365d' }],
      requestId: randomUUID(),
    });
    expect(esc).toMatchObject({ ok: true, available: true });
    if (!esc.ok || !esc.available) throw new Error('expected esc');
    await f.sql.query(
      "update consumer_support_messages set created_at = now() - interval '370 days' where id = $1::uuid",
      [esc.id],
    );
    await f.sql.query(
      "update team_notice_deliveries set status = 'sent', transport = 'webhook', sent_at = now() - interval '370 days', created_at = now() - interval '370 days' where id = $1::uuid",
      [esc.deliveryId],
    );

    const queuedNotice = await enqueueTeamNotice(f.sql, 'project_request', {
      organizationId: f.orgId,
      sourceTable: 'brand_projects',
      sourceId: randomUUID(),
      actorUserId: f.ids.owner,
      preview: 'New urgent campaign brief',
      adminPath: `/admin/brand-rooms/${f.orgId}`,
    });

    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('SLACK_TEAM_NOTICE_WEBHOOK_URL', 'https://hooks.slack.com/services/T1/B1/S1');
    const deliveredPayloads: string[] = [];
    mocks.outboxFetcher = async (_u, init) => {
      deliveredPayloads.push(String(init?.body ?? ''));
      return new Response('ok', { status: 200 });
    };

    // Cause room notices pass to throw while team_notice_deliveries & consumer_support_messages succeed
    await f.db.exec('alter table brand_room_notices rename to brand_room_notices_broken');

    const res = await GET(authorized());
    // Room pass failed, but isolated team notice + retention passes succeeded -> overall 200 (not 503!)
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      passes?: {
        rooms?: { ok: boolean };
        teamNotices?: { ok: boolean; claimed?: number; sent?: number };
        retention?: { purged: number };
      };
      retention?: { purged: number };
    };
    expect(body.ok).toBe(true);
    expect(body.passes?.rooms?.ok).toBe(false);
    expect(body.passes?.teamNotices).toMatchObject({ ok: true, claimed: 1, sent: 1 });
    expect(body.retention?.purged).toBe(1);
    expect(deliveredPayloads).toHaveLength(1);
    expect(deliveredPayloads[0]).toContain('New urgent campaign brief');

    const queuedRow = (
      await f.sql.query<{ status: string }>('select status from team_notice_deliveries where id = $1::uuid', [
        queuedNotice.id,
      ])
    ).rows[0]!;
    expect(queuedRow.status).toBe('sent');

    const purged = (
      await f.sql.query<{ transcript: unknown[] }>('select transcript from consumer_support_messages where id = $1::uuid', [
        esc.id,
      ])
    ).rows[0]!;
    expect(purged.transcript).toEqual([]);

    const scrubbedNotice = (
      await f.sql.query<{ preview: string; actor_label: string }>(
        'select preview, actor_label from team_notice_deliveries where id = $1::uuid',
        [esc.deliveryId],
      )
    ).rows[0]!;
    expect(scrubbedNotice).toEqual({ preview: '', actor_label: '' });
  });

  it('Round 2 (4): stops subsequent passes under 45s tick budget and leaves zero rows in sending', async () => {
    const first = await enqueueTeamNotice(f.sql, 'project_request', {
      organizationId: f.orgId,
      sourceTable: 'brand_projects',
      sourceId: randomUUID(),
      actorUserId: f.ids.owner,
      preview: 'First notice before budget exhaustion',
      adminPath: `/admin/brand-rooms/${f.orgId}`,
    });
    const second = await enqueueTeamNotice(f.sql, 'project_request', {
      organizationId: f.orgId,
      sourceTable: 'brand_projects',
      sourceId: randomUUID(),
      actorUserId: f.ids.owner,
      preview: 'Second notice after budget exhaustion',
      adminPath: `/admin/brand-rooms/${f.orgId}`,
    });

    const userId = randomUUID();
    await seedProfile(f.sql, { id: userId, email: 'budget-retention@example.test' });
    const esc = await recordConsumerEscalation(f.sql, {
      userId,
      reason: 'user_requested_human',
      message: 'Budget retention should wait when tick time is exhausted',
      transcript: [{ role: 'user', text: 'Should wait until next tick' }],
      requestId: randomUUID(),
    });
    if (!esc.ok || !esc.available) throw new Error('expected esc');
    await f.sql.query(
      "update consumer_support_messages set created_at = now() - interval '370 days' where id = $1::uuid",
      [esc.id],
    );
    await f.sql.query(
      "update team_notice_deliveries set status = 'sent', transport = 'webhook', sent_at = now() - interval '370 days', created_at = now() - interval '370 days' where id = $1::uuid",
      [esc.deliveryId],
    );

    vi.stubEnv('BRAND_ROOM_NOTIFY', 'off');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('SLACK_TEAM_NOTICE_WEBHOOK_URL', 'https://hooks.slack.com/services/T1/B1/S1');

    let fakeNowMs = 2_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => fakeNowMs);
    mocks.outboxFetcher = async () => {
      // Simulate slow Slack pass consuming the entire 45s tick budget on the 1st row
      fakeNowMs += 46_000;
      return new Response('ok', { status: 200 });
    };

    const res = await GET(authorized());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      passes?: {
        teamNotices?: { ok: boolean; claimed?: number; sent?: number; budgetExhausted?: boolean };
        retention?: { purged: number };
      };
    };
    expect(body.ok).toBe(true);
    expect(body.passes?.teamNotices).toMatchObject({ ok: true, claimed: 1, sent: 1, budgetExhausted: true });
    expect(body.passes?.retention?.purged).toBe(0);

    const rows = (
      await f.sql.query<{ id: string; status: string; attempts: number }>(
        'select id::text as id, status, attempts from team_notice_deliveries where id = any($1::uuid[])',
        [[first.id, second.id]],
      )
    ).rows;
    expect(rows.find((r) => r.id === first.id)).toMatchObject({ status: 'sent', attempts: 1 });
    expect(rows.find((r) => r.id === second.id)).toMatchObject({ status: 'pending', attempts: 0 });
    const sendingRows = await f.sql.query("select id from team_notice_deliveries where status = 'sending'");
    expect(sendingRows.rows).toHaveLength(0);
  });
});
