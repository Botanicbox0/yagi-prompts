import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, runner } from '@/tests/helpers/pglite';
import { seedProfile } from '@/tests/helpers/billing';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { AdminContext } from '@/lib/admin/context';
import {
  TEAM_NOTICE_MAX_ATTEMPTS,
  deterministicSlackMessageUuid,
  enqueueTeamNotice,
  formatTeamNoticeSlackText,
  mirrorAdminReplyToSlackThread,
  resolveTeamNoticeConfig,
  runLiveTeamNoticeDeliveryPass,
  runTeamNoticeDeliveryPass,
  sendTeamNoticePayload,
  syncSlackSupportReplies,
  tableExists,
} from '@/lib/brands/team-notice-outbox';
import {
  notifySlackBrandConcierge,
  notifySlackBrandProjectRequest,
} from '@/lib/brands/concierge-slack';
import {
  acceptBrandInvitation,
  createBrandOrganization,
  createBrandProject,
  createStudioInvitation,
  createStudioOrganization,
  loadBrandSupport,
  sendBrandSupport,
} from '@/lib/brands/workspace/service';
import {
  loadConsumerSupportReplies,
  loadConsumerSupportThread,
  purgeExpiredConsumerTranscripts,
  recordConsumerEscalation,
  sendDirectConsumerEscalationFallback,
} from '@/lib/support/concierge-service';
import { requestAccountDeletion, deleteAccountNow } from '@/lib/account/deletion';
import { dispatchAdmin } from '@/lib/admin/dispatch';
import { loadAdminQueues } from '@/lib/admin/queue-load';
import { loadOrganizationSupportSyncMode, loadTeamNoticeInbox } from '@/lib/brands/team-notice-inbox';
import { runReviewOperation } from '@/lib/brand-studio/review';
import {
  runStoryboardOperation,
  staffCreateStoryboard,
  staffReplaceFrames,
  staffShareStoryboard,
} from '@/lib/brand-rooms/storyboards';
import { createShare, guestComment } from '@/lib/brand-rooms/shares';
import { runRoomOperation } from '@/lib/brand-rooms/messages';
import { studioDeps, seedImageAsset, pngBytes, memoryStaging } from '../brand-studio/server/helpers';
import { ADMIN_OPERATIONS } from '@/lib/admin/operations';
import { runSupportReplyOperation, runSupportSlackConnectionTest } from '@/lib/admin/support-operations';

const mkViewer = (userId: string, email: string, isAdmin = false): Viewer => ({
  userId,
  isAdmin,
  tier: isAdmin ? 'admin' : 'free',
  email,
  locale: 'ko',
});

let db: PGlite;
let sql: SqlRunner;
let admin: Viewer;
let owner: Viewer;
let orgViewer: Viewer;
let consumer: Viewer;
let outsider: Viewer;

const botEnv = {
  VERCEL_ENV: 'production',
  SLACK_BRAND_CONCIERGE_BOT_TOKEN: 'xoxb-test-token',
  SLACK_BRAND_CONCIERGE_CHANNEL_ID: 'C0123456789',
};

const webhookFallbackEnv = {
  VERCEL_ENV: 'production',
  SLACK_BRAND_INQUIRIES_ENABLED: 'on',
  SLACK_BRAND_INQUIRIES_WEBHOOK_URL: 'https://hooks.slack.com/services/T01/B01/SECRET1',
};

beforeEach(async () => {
  db = await freshDb();
  sql = runner(db);
  admin = mkViewer(randomUUID(), 'admin@example.test', true);
  owner = mkViewer(randomUUID(), 'owner@example.test', false);
  orgViewer = mkViewer(randomUUID(), 'viewer@example.test', false);
  consumer = mkViewer(randomUUID(), 'consumer-secret@example.test', false);
  outsider = mkViewer(randomUUID(), 'outsider@example.test', false);

  for (const [v, name] of [
    [admin, 'Studio PD'],
    [owner, 'Kim Owner'],
    [orgViewer, 'Lee Viewer'],
    [consumer, 'Park Member'],
    [outsider, 'Outsider'],
  ] as const) {
    await seedProfile(sql, { id: v.userId!, email: v.email!, isAdmin: v.isAdmin });
    await sql.query('update profiles set display_name = $2 where id = $1', [v.userId, name]);
  }
});

afterEach(async () => {
  await db.close();
});

async function seedBrandWithMembers() {
  const created = await createStudioOrganization({ sql }, admin, {
    name: 'Acme Fashion',
    requestId: randomUUID(),
  });
  if (!created.ok) throw new Error(created.code);
  const orgId = created.id;

  const invOwner = await createStudioInvitation({ sql }, admin, {
    organizationId: orgId,
    projectId: null,
    email: owner.email,
    role: 'owner',
    canComment: false,
    requestId: randomUUID(),
  });
  if (!invOwner.ok) throw new Error(invOwner.code);
  await acceptBrandInvitation({ sql, verifiedEmail: owner.email! }, owner, { token: invOwner.token });

  const invViewer = await createStudioInvitation({ sql }, admin, {
    organizationId: orgId,
    projectId: null,
    email: orgViewer.email,
    role: 'viewer',
    canComment: false,
    requestId: randomUUID(),
  });
  if (!invViewer.ok) throw new Error(invViewer.code);
  await acceptBrandInvitation({ sql, verifiedEmail: orgViewer.email! }, orgViewer, { token: invViewer.token });

  return orgId;
}

describe('durable team notice outbox (S1)', () => {
  it('enqueues atomically with customer writes and rolls back both when outbox insert fails', async () => {
    const orgId = await seedBrandWithMembers();

    await db.exec(`
      create or replace function fail_outbox_insert() returns trigger as $$
      begin
        raise exception 'simulated_outbox_failure';
      end;
      $$ language plpgsql;
      create trigger trg_fail_outbox before insert on team_notice_deliveries
      for each row execute function fail_outbox_insert();
    `);

    await expect(
      sendBrandSupport({ sql }, owner, {
        organizationId: orgId,
        body: 'Must roll back cleanly',
        requestId: randomUUID(),
      }),
    ).rejects.toThrow(/simulated_outbox_failure/);

    expect((await sql.query('select id from brand_support_messages')).rows).toHaveLength(0);

    await expect(
      createBrandOrganization({ sql }, consumer, { name: 'Rollback Org', requestId: randomUUID() }),
    ).rejects.toThrow(/simulated_outbox_failure/);
    expect((await sql.query("select id from brand_organizations where name = 'Rollback Org'")).rows).toHaveLength(0);

    await expect(
      recordConsumerEscalation(sql, {
        userId: consumer.userId!,
        reason: 'user_requested_human',
        message: 'Rollback consumer check',
        requestId: randomUUID(),
      }),
    ).rejects.toThrow(/simulated_outbox_failure/);
    expect((await sql.query('select id from consumer_support_messages')).rows).toHaveLength(0);
  });

  it('allows viewer-role members to send support.send, enqueues org_created & project_request, and supports allowance/plan kinds', async () => {
    const custOrgRes = await createBrandOrganization({ sql }, owner, {
      name: 'Sample Apparel',
      requestId: randomUUID(),
    });
    expect(custOrgRes.ok).toBe(true);
    if (!custOrgRes.ok) throw new Error(custOrgRes.code);

    const viewerMsg = await sendBrandSupport({ sql }, orgViewer, {
      organizationId: custOrgRes.id,
      body: 'Viewer question on deliverables',
      requestId: randomUUID(),
      surface: 'human_handoff',
    });
    // Viewer belongs to Acme Fashion, not Sample Apparel yet; seed viewer into Sample Apparel or Acme Fashion
    expect(viewerMsg).toMatchObject({ ok: false, code: 'not_found' });

    const orgId = await seedBrandWithMembers();
    const viewerOk = await sendBrandSupport({ sql }, orgViewer, {
      organizationId: orgId,
      body: 'Viewer member question',
      requestId: randomUUID(),
      surface: 'human_handoff',
    });
    expect(viewerOk.ok).toBe(true);
    expect(await sendBrandSupport({ sql }, outsider, { organizationId: orgId, body: 'Blocked', requestId: randomUUID() })).toMatchObject({
      ok: false,
    });

    // Studio reply must NOT enqueue a customer-to-team alert
    expect(
      await sendBrandSupport({ sql }, admin, { organizationId: orgId, body: 'Studio note', requestId: randomUUID() }, 'studio'),
    ).toMatchObject({ ok: true });

    const projRes = await createBrandProject({ sql }, owner, {
      organizationId: orgId,
      title: 'Winter Launch',
      objective: 'Hero launch film',
      audience: '20s fashion shoppers',
      budgetKrw: null,
      startsOn: null,
      endsOn: null,
      productionMode: 'creator',
      referenceLinks: [],
      requestId: randomUUID(),
    });
    expect(projRes.ok).toBe(true);

    // Direct helper check for reserved future kinds (`allowance_request`, `plan_request`) & duplicate safety
    const allowId = randomUUID();
    const firstAllow = await enqueueTeamNotice(sql, 'allowance_request', {
      organizationId: orgId,
      sourceTable: 'brand_studio_allowances',
      sourceId: allowId,
      actorUserId: owner.userId!,
      surface: 'studio_allowance',
      preview: 'Requesting 100 more monthly runs',
      adminPath: `/admin/brand-workspace/organizations/${orgId}`,
    });
    expect(firstAllow).toMatchObject({ available: true, enqueued: true });

    const dupAllow = await enqueueTeamNotice(sql, 'allowance_request', {
      organizationId: orgId,
      sourceTable: 'brand_studio_allowances',
      sourceId: allowId,
    });
    expect(dupAllow).toMatchObject({ available: true, enqueued: false, id: null });

    const planRes = await enqueueTeamNotice(sql, 'plan_request', {
      organizationId: orgId,
      sourceTable: 'brand_plan_assignments',
      sourceId: randomUUID(),
      actorUserId: owner.userId!,
      surface: 'plan_upgrade',
      preview: 'Upgrade to b2b_49',
      adminPath: `/admin/brand-workspace/organizations/${orgId}`,
    });
    expect(planRes).toMatchObject({ available: true, enqueued: true });

    const kinds = (
      await sql.query<{ kind: string }>('select kind from team_notice_deliveries order by created_at asc, id asc')
    ).rows.map((r) => r.kind);
    expect(kinds).toEqual(['org_created', 'support_message', 'project_request', 'allowance_request', 'plan_request']);
  });

  it('prevents double post under concurrent passes and falls back cleanly to webhook Amendment vs bot mode', async () => {
    const orgId = await seedBrandWithMembers();
    await sendBrandSupport({ sql }, owner, {
      organizationId: orgId,
      body: 'Hello <!channel> <@U123> & test',
      requestId: randomUUID(),
      surface: 'support_drawer',
    });

    // 1. Concurrent passes under webhook fallback Amendment (prod only)
    const calls: Array<{ url: string; body: string }> = [];
    const webhookFetcher: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body ?? '') });
      await new Promise((r) => setTimeout(r, 15));
      return new Response('ok', { status: 200 });
    };

    const [p1, p2] = await Promise.all([
      runTeamNoticeDeliveryPass({ sql, env: webhookFallbackEnv, fetcher: webhookFetcher }),
      runTeamNoticeDeliveryPass({ sql, env: webhookFallbackEnv, fetcher: webhookFetcher }),
    ]);
    expect(p1.sent + p2.sent).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(webhookFallbackEnv.SLACK_BRAND_INQUIRIES_WEBHOOK_URL);

    const payload = JSON.parse(calls[0]!.body) as { text: string; unfurl_links: boolean; unfurl_media: boolean };
    expect(payload.unfurl_links).toBe(false);
    expect(payload.unfurl_media).toBe(false);
    expect(payload.text).toContain('&lt;!channel&gt; &lt;@U123&gt; &amp; test');
    expect(payload.text).not.toContain('<!channel>');
    expect(payload.text).not.toContain(owner.email!);
    expect(payload.text).toContain(`https://admin.twings.app/admin/brand-workspace/organizations/${orgId}#support`);

    const dbRow = (
      await sql.query<{ status: string; transport: string; slack_channel: string | null; slack_ts: string | null }>(
        'select status, transport, slack_channel, slack_ts from team_notice_deliveries limit 1',
      )
    ).rows[0]!;
    expect(dbRow).toEqual({
      status: 'sent',
      transport: 'webhook',
      slack_channel: null,
      slack_ts: null,
    });

    // 2. Subsequent send under bot mode records slack_channel + slack_ts
    await sendBrandSupport({ sql }, orgViewer, {
      organizationId: orgId,
      body: 'Follow-up in bot mode',
      requestId: randomUUID(),
    });
    const botFetcher: typeof fetch = async (url) => {
      expect(String(url)).toBe('https://slack.com/api/chat.postMessage');
      return new Response(
        JSON.stringify({ ok: true, channel: 'C0123456789', ts: '1795000001.000200' }),
        { status: 200 },
      );
    };
    const botPass = await runTeamNoticeDeliveryPass({ sql, env: botEnv, fetcher: botFetcher });
    expect(botPass).toMatchObject({ sent: 1, transport: 'bot' });
    const botRow = (
      await sql.query<{ transport: string; slack_channel: string; slack_ts: string }>(
        "select transport, slack_channel, slack_ts from team_notice_deliveries where preview like '%Follow-up%'",
      )
    ).rows[0]!;
    expect(botRow).toEqual({
      transport: 'bot',
      slack_channel: 'C0123456789',
      slack_ts: '1795000001.000200',
    });
  });

  it('F6: leaves pending rows untouched (no skipped sink) outside production, on kill switch, and when incomplete', async () => {
    const orgId = await seedBrandWithMembers();
    const fetcher = vi.fn();

    await sendBrandSupport({ sql }, owner, { organizationId: orgId, body: 'Preview msg', requestId: randomUUID() });
    const nonProd = await runTeamNoticeDeliveryPass({
      sql,
      env: { ...botEnv, VERCEL_ENV: 'preview' },
      fetcher: fetcher as never,
    });
    expect(nonProd).toMatchObject({ skipped: 0, claimed: 0, configuration: 'non_production', sent: 0 });
    expect(fetcher).not.toHaveBeenCalled();

    const killed = await runTeamNoticeDeliveryPass({
      sql,
      env: { ...botEnv, SLACK_BRAND_CONCIERGE_ENABLED: 'off' },
      fetcher: fetcher as never,
    });
    expect(killed).toMatchObject({ skipped: 0, claimed: 0, configuration: 'disabled' });

    const missingChan = await runTeamNoticeDeliveryPass({
      sql,
      env: { VERCEL_ENV: 'production', SLACK_BRAND_CONCIERGE_BOT_TOKEN: 'xoxb-only' },
      fetcher: fetcher as never,
    });
    expect(missingChan).toMatchObject({ skipped: 0, claimed: 0, configuration: 'missing_channel_id' });
    expect(fetcher).not.toHaveBeenCalled();

    // Row stays pending with 0 attempts so production sender delivers it once enabled
    const persisted = (
      await sql.query<{ status: string; attempts: number }>('select status, attempts from team_notice_deliveries limit 1')
    ).rows[0]!;
    expect(persisted).toEqual({ status: 'pending', attempts: 0 });

    const prodSent = await runTeamNoticeDeliveryPass({
      sql,
      env: botEnv,
      fetcher: async () =>
        new Response(JSON.stringify({ ok: true, channel: 'C0123456789', ts: '1795000000.000100' }), { status: 200 }),
    });
    expect(prodSent).toMatchObject({ sent: 1 });
    const sentRow = (
      await sql.query<{ status: string; attempts: number }>(
        'select status, attempts from team_notice_deliveries limit 1',
      )
    ).rows[0]!;
    expect(sentRow).toEqual({ status: 'sent', attempts: 1 });
  });

  it('retries transient failures with backoff up to 8 attempts -> failed and recovers expired sending claims', async () => {
    const orgId = await seedBrandWithMembers();
    await sendBrandSupport({ sql }, owner, { organizationId: orgId, body: 'Flaky delivery', requestId: randomUUID() });

    const failingFetcher: typeof fetch = async () => new Response('upstream error', { status: 500 });
    let clock = new Date('2026-11-23T00:00:00.000Z');

    for (let attempt = 1; attempt < TEAM_NOTICE_MAX_ATTEMPTS; attempt += 1) {
      const rep = await runTeamNoticeDeliveryPass({
        sql,
        env: botEnv,
        fetcher: failingFetcher,
        now: clock,
      });
      expect(rep).toMatchObject({ claimed: 1, deferred: 1, failed: 0 });
      clock = new Date(clock.getTime() + 7200_000);
    }

    const eighth = await runTeamNoticeDeliveryPass({
      sql,
      env: botEnv,
      fetcher: failingFetcher,
      now: clock,
    });
    expect(eighth).toMatchObject({ claimed: 1, deferred: 0, failed: 1 });

    const failedRow = (
      await sql.query<{ status: string; attempts: number; last_error_code: string; next_attempt_at: string | null }>(
        'select status, attempts, last_error_code, next_attempt_at from team_notice_deliveries limit 1',
      )
    ).rows[0]!;
    expect(failedRow).toEqual({
      status: 'failed',
      attempts: TEAM_NOTICE_MAX_ATTEMPTS,
      last_error_code: 'http_500',
      next_attempt_at: null,
    });

    // Stale sending claim (> 5 minutes) recovers and sends on next tick
    const staleId = randomUUID();
    await enqueueTeamNotice(sql, 'org_created', {
      organizationId: orgId,
      sourceTable: 'brand_organizations',
      sourceId: staleId,
    });
    await sql.query(
      `update team_notice_deliveries
          set status = 'sending',
              claimed_at = $2::timestamptz,
              claim_token = $3::uuid
        where source_id = $1::uuid`,
      [staleId, new Date(clock.getTime() - 6 * 60_000).toISOString(), randomUUID()],
    );

    const okFetcher: typeof fetch = async () =>
      new Response(JSON.stringify({ ok: true, channel: 'C0123456789', ts: '1795000010.000100' }), { status: 200 });
    const recoveredPass = await runTeamNoticeDeliveryPass({ sql, env: botEnv, fetcher: okFetcher, now: clock });
    expect(recoveredPass).toMatchObject({ recovered: 1, sent: 1 });
  });

  it('syncs only valid thread replies within 7 days, ignores bots/non-threads/other threads, and records API errors', async () => {
    const orgId = await seedBrandWithMembers();
    const otherOrgId = (
      await createStudioOrganization({ sql }, admin, { name: 'Other Org', requestId: randomUUID() })
    );
    if (!otherOrgId.ok) throw new Error('otherOrg');

    const sentMsg = await sendBrandSupport({ sql }, owner, {
      organizationId: orgId,
      body: 'Waiting for thread sync',
      requestId: randomUUID(),
    });
    if (!sentMsg.ok) throw new Error('sentMsg');

    // The thread is read in time order and a synced reply takes its time from the Slack timestamp. Derive the clock and
    // the Slack timestamps from the real time, so the customer's message (written just above) always comes first. With
    // fixed values the order flipped once the calendar passed them (2026-11-24T06:00Z).
    const now = new Date();
    const slackBase = Math.floor(now.getTime() / 1000) + 60;
    const slackTs = (offsetSeconds: number) => `${slackBase + offsetSeconds}.000100`;
    const postFetcher: typeof fetch = async () =>
      new Response(JSON.stringify({ ok: true, channel: 'C0123456789', ts: slackTs(0) }), { status: 200 });
    await runTeamNoticeDeliveryPass({ sql, env: botEnv, fetcher: postFetcher, now });

    // Also insert a stale (>7 day) bot thread and a webhook-only sent row: neither should be polled
    const oldSrc = randomUUID();
    await enqueueTeamNotice(sql, 'support_message', {
      organizationId: otherOrgId.id,
      sourceTable: 'brand_support_messages',
      sourceId: oldSrc,
    });
    await sql.query(
      `update team_notice_deliveries
          set status = 'sent', transport = 'bot', slack_channel = 'C0123456789',
              slack_ts = '1790000000.000100', sent_at = $2::timestamptz
        where source_id = $1::uuid`,
      [oldSrc, new Date(now.getTime() - 8 * 86_400_000).toISOString()],
    );

    const polledUrls: string[] = [];
    const repliesFetcher: typeof fetch = async (url) => {
      polledUrls.push(String(url));
      return new Response(
        JSON.stringify({
          ok: true,
          messages: [
            // Parent message -> ignore
            { ts: slackTs(0), thread_ts: slackTs(0), text: 'parent' },
            // Bot message -> ignore
            { ts: slackTs(1), thread_ts: slackTs(0), bot_id: 'B1', text: 'bot echo' },
            // Wrong thread_ts -> ignore
            { ts: slackTs(2), thread_ts: '1799999999.000100', text: 'wrong thread' },
            // Non-thread message -> ignore
            { ts: slackTs(3), text: 'top level chatter' },
            // Valid staff reply -> keep once
            { ts: slackTs(4), thread_ts: slackTs(0), text: '<@U11> 안내드립니다!' },
          ],
        }),
        { status: 200 },
      );
    };

    const res = await syncSlackSupportReplies(sql, { env: botEnv, fetcher: repliesFetcher, now, force: true });
    expect(res).toEqual({ available: true, skipped: false, checked: 1, synced: 1, errors: [] });
    expect(polledUrls).toHaveLength(1);
    expect(polledUrls[0]).toContain(`ts=${slackTs(0)}`);

    // Poll again -> idempotent (synced: 0)
    const repeat = await syncSlackSupportReplies(sql, { env: botEnv, fetcher: repliesFetcher, now, force: true });
    expect(repeat).toEqual({ available: true, skipped: false, checked: 1, synced: 0, errors: [] });

    const msgs = await loadBrandSupport({ sql }, owner, orgId);
    expect(msgs?.map((m) => [m.authorRole, m.body])).toEqual([
      ['brand', 'Waiting for thread sync'],
      ['studio', '안내드립니다!'],
    ]);

    // Ensure errors are recorded, never swallowed
    const errRes = await syncSlackSupportReplies(sql, {
      env: botEnv,
      fetcher: async () => new Response(JSON.stringify({ ok: false, error: 'ratelimited' }), { status: 200 }),
      now,
      force: true,
    });
    expect(errRes.errors).toHaveLength(1);
    expect(errRes.errors[0]!.code).toBe('ratelimited');
  });

  it('runs admin retry, connectionTest (prod gate + cooldown), support.reply mirroring, queues, and deploy-order fallback', async () => {
    const orgId = await seedBrandWithMembers();
    await sendBrandSupport({ sql }, owner, {
      organizationId: orgId,
      body: 'Brand awaiting reply',
      requestId: randomUUID(),
    });
    const cons = await recordConsumerEscalation(sql, {
      userId: consumer.userId!,
      reason: 'account_or_billing_check',
      message: 'Consumer awaiting reply',
      requestId: randomUUID(),
    });
    if (!cons.ok || !cons.available) throw new Error('expected consumer escalation');

    // Before reply: queues show 2 awaitingReply, 0 failed
    const q1 = await loadAdminQueues(sql, admin);
    expect(q1.counts.supportAwaitingReply).toBe(2);
    expect(q1.counts.supportDeliveryFailed).toBe(0);

    // Deliver the brand thread in bot mode, consumer thread in webhook mode
    const brandRow = (
      await sql.query<{ id: string }>("select id::text as id from team_notice_deliveries where kind = 'support_message'")
    ).rows[0]!;
    await runTeamNoticeDeliveryPass({
      sql,
      env: botEnv,
      deliveryId: brandRow.id,
      fetcher: async () =>
        new Response(JSON.stringify({ ok: true, channel: 'C0123456789', ts: '1796000000.000100' }), { status: 200 }),
    });
    await runTeamNoticeDeliveryPass({
      sql,
      env: webhookFallbackEnv,
      deliveryId: cons.deliveryId!,
      fetcher: async () => new Response('ok', { status: 200 }),
    });

    // Per-thread sync indicators differ: bot_sync vs admin_only
    expect(await loadOrganizationSupportSyncMode(sql, orgId)).toMatchObject({ mode: 'bot_sync' });
    const inbox = await loadTeamNoticeInbox(sql, { env: botEnv });
    expect(inbox.available).toBe(true);
    expect(inbox.rows.find((r) => r.kind === 'support_message')?.replySyncMode).toBe('bot_sync');
    expect(inbox.rows.find((r) => r.kind === 'concierge_escalation')?.replySyncMode).toBe('admin_only');

    // Mark consumer delivery failed and an unrelated org delivery skipped; retry via real dispatchAdmin guard
    await sql.query("update team_notice_deliveries set status = 'failed', attempts = 8 where id = $1::uuid", [
      cons.deliveryId,
    ]);
    expect((await loadAdminQueues(sql, admin)).counts.supportDeliveryFailed).toBe(1);

    // F14: non-admin refused via dispatchAdmin before parsing/execution
    const retryForm = new FormData();
    retryForm.set('scope', 'all');
    expect(
      await dispatchAdmin('support.delivery.retry', retryForm, { sql, viewer: owner } as unknown as AdminContext),
    ).toMatchObject({ ok: false, code: 'forbidden' });

    // Valid admin retry re-queues both failed & skipped when scope=all
    await sql.query(
      `insert into team_notice_deliveries (kind, source_table, source_id, status)
       values ('plan_request', 'brand_plan_assignments', $1, 'skipped')`,
      [randomUUID()],
    );
    const retryOutcome = await dispatchAdmin('support.delivery.retry', retryForm, {
      sql,
      viewer: admin,
    } as unknown as AdminContext);
    expect(retryOutcome).toMatchObject({ ok: true, detail: 'retried:2' });
    expect((await loadAdminQueues(sql, admin)).counts.supportDeliveryFailed).toBe(0);

    // F14: route support.reply through dispatchAdmin (non-admin refused, valid admin succeeds)
    const replyBrandForm = new FormData();
    replyBrandForm.set('targetType', 'brand');
    replyBrandForm.set('organizationId', orgId);
    replyBrandForm.set('deliveryId', brandRow.id);
    replyBrandForm.set('body', 'Studio official reply');
    replyBrandForm.set('requestId', randomUUID());
    expect(
      await dispatchAdmin('support.reply', replyBrandForm, { sql, viewer: orgViewer } as unknown as AdminContext),
    ).toMatchObject({ ok: false, code: 'forbidden' });
    expect(
      await dispatchAdmin('support.reply', replyBrandForm, { sql, viewer: admin } as unknown as AdminContext),
    ).toMatchObject({ ok: true });

    // F12: test direct mirror helper with wrong-org deliveryId must refuse to mirror into another org's thread!
    const otherOrgRes = await createStudioOrganization({ sql }, admin, {
      name: 'Separate Brand',
      requestId: randomUUID(),
    });
    if (!otherOrgRes.ok) throw new Error('otherOrg');
    const badMirrorBodies: string[] = [];
    const wrongMirror = await mirrorAdminReplyToSlackThread(
      sql,
      {
        targetType: 'brand',
        organizationId: otherOrgRes.id,
        deliveryId: brandRow.id,
        body: 'Cross-tenant leak attempt',
      },
      {
        env: botEnv,
        fetcher: async (_url, init) => {
          badMirrorBodies.push(String(init?.body ?? ''));
          return new Response(JSON.stringify({ ok: true, ts: '1.1' }), { status: 200 });
        },
      },
    );
    expect(wrongMirror).toMatchObject({ mirrored: false, code: 'no_bot_thread' });
    expect(badMirrorBodies).toHaveLength(0);

    const mirroredBodies: string[] = [];
    const replyBrandOut = await runSupportReplyOperation(
      { sql, viewer: admin } as unknown as AdminContext,
      {
        targetType: 'brand',
        organizationId: orgId,
        userId: '',
        deliveryId: brandRow.id,
        body: 'Studio mirrored reply',
        requestId: randomUUID(),
      },
      {
        env: botEnv,
        fetcher: async (_url, init) => {
          mirroredBodies.push(String(init?.body ?? ''));
          return new Response(JSON.stringify({ ok: true, ts: '1796000010.000100' }), { status: 200 });
        },
      },
    );
    expect(replyBrandOut).toMatchObject({ ok: true });
    expect(mirroredBodies).toHaveLength(1);
    expect(mirroredBodies[0]).toContain('1796000000.000100');

    const replyConsumerForm = new FormData();
    replyConsumerForm.set('targetType', 'consumer');
    replyConsumerForm.set('userId', consumer.userId!);
    replyConsumerForm.set('deliveryId', cons.deliveryId!);
    replyConsumerForm.set('body', 'Consumer official reply');
    replyConsumerForm.set('requestId', randomUUID());
    expect(
      await dispatchAdmin('support.reply', replyConsumerForm, { sql, viewer: admin } as unknown as AdminContext),
    ).toMatchObject({ ok: true });
    expect((await loadConsumerSupportReplies(sql, consumer.userId!)).map((r) => r.body)).toEqual([
      'Consumer official reply',
    ]);
    expect((await loadAdminQueues(sql, admin)).counts.supportAwaitingReply).toBe(0);

    // F14 + F12: route connectionTest through dispatchAdmin (non-admin refused) and verify audit details when forced
    const testForm = new FormData();
    testForm.set('force', 'false');
    expect(
      await dispatchAdmin('support.slack.connectionTest', testForm, { sql, viewer: owner } as unknown as AdminContext),
    ).toMatchObject({ ok: false, code: 'forbidden' });

    const connCtx = { sql, viewer: admin } as unknown as AdminContext;
    expect(
      await dispatchAdmin('support.slack.connectionTest', testForm, connCtx),
    ).toMatchObject({ ok: false, detail: 'slackTestNonProduction' });

    const okTest = await runSupportSlackConnectionTest(
      connCtx,
      { force: true },
      {
        env: { ...botEnv, VERCEL_ENV: 'preview' },
        fetcher: async () => new Response(JSON.stringify({ ok: true, ts: '1.1' }), { status: 200 }),
      },
    );
    expect(okTest).toMatchObject({ ok: true, detail: 'slackTestSent:bot' });

    const auditRows = (
      await sql.query<{ action: string; details: Record<string, unknown> }>(
        "select action, details from platform_audit where action like 'support.slack.connectionTest%' order by created_at asc",
      )
    ).rows;
    expect(auditRows.length).toBeGreaterThanOrEqual(2);
    expect(auditRows[0]!.details).toMatchObject({
      forced: true,
      forcedByActorId: admin.userId,
      vercelEnv: 'preview',
      environmentCheck: 'non_production_forced',
    });

    expect(
      await runSupportSlackConnectionTest(connCtx, { force: true }, { env: botEnv }),
    ).toMatchObject({ ok: false, detail: 'slackTestCooldown' });

    // Webhook-only mirror safety check
    expect(
      await mirrorAdminReplyToSlackThread(
        sql,
        { targetType: 'brand', organizationId: orgId, body: 'hi' },
        { env: webhookFallbackEnv, fetcher: async () => new Response('ok', { status: 200 }) },
      ),
    ).toMatchObject({
      mirrored: false,
      code: 'webhook_only',
    });

    // Deploy-order safety: dropping 0178 tables leaves existing writes, loaders, sync, and queues graceful
    await db.exec('drop table if exists support_synced_replies, consumer_support_messages, team_notice_deliveries;');
    expect(await tableExists(sql, 'team_notice_deliveries')).toBe(false);
    expect(
      await sendBrandSupport({ sql }, owner, { organizationId: orgId, body: 'Pre-0178 still works', requestId: randomUUID() }),
    ).toMatchObject({ ok: true });
    expect(
      await recordConsumerEscalation(sql, {
        userId: consumer.userId!,
        reason: 'user_requested_human',
        message: 'Pre-0178 escalation',
      }),
    ).toEqual({ ok: true, available: false });
    expect(await runTeamNoticeDeliveryPass({ sql, env: botEnv })).toMatchObject({ available: false, sent: 0 });
    expect(await syncSlackSupportReplies(sql, { env: botEnv })).toMatchObject({ available: false, synced: 0 });
    expect(await loadTeamNoticeInbox(sql, { env: botEnv })).toMatchObject({ available: false, rows: [] });
    expect(await loadOrganizationSupportSyncMode(sql, orgId)).toMatchObject({ mode: 'admin_only' });
    expect((await loadAdminQueues(sql, admin)).counts.supportDeliveryFailed).toBeNull();
  });

  it('checks static config helper resolution for unused/malformed webhook and token forms', () => {
    expect(
      resolveTeamNoticeConfig({
        VERCEL_ENV: 'production',
        SLACK_TEAM_NOTICE_WEBHOOK_URL: 'https://evil.example/services/a/b/c',
      }),
    ).toEqual({ status: 'skipped', code: 'misconfigured_webhook' });
    expect(resolveTeamNoticeConfig({ VERCEL_ENV: 'production', SLACK_BOT_TOKEN: 'bad-token' })).toEqual({
      status: 'skipped',
      code: 'invalid_token',
    });
    expect(
      formatTeamNoticeSlackText({
        kind: 'org_created',
        organizationName: 'Test Co',
        actorDisplayName: 'Founder',
        adminPath: '/admin/brand-workspace/organizations/123',
        transport: 'webhook',
      }),
    ).toContain('https://admin.twings.app/admin/brand-workspace/organizations/123');
    expect(deterministicSlackMessageUuid('C1', '1.2')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('F1 & F10: repeated storyboard/review decisions create separate notices, escaped once with one admin link', async () => {
    const orgId = await seedBrandWithMembers();
    const projectId = randomUUID();
    await sql.query(
      `insert into brand_projects (id, organization_id, title, objective, production_mode, created_by, request_id, client_visible)
       values ($1, $2, 'Spring', 'Goal', 'creator', $3, $4, true)`,
      [projectId, orgId, owner.userId, randomUUID()],
    );
    const sDeps = studioDeps(sql);
    const assetId = await seedImageAsset(sDeps, orgId, admin.userId!);

    // Repeated storyboard decision: changes_requested -> shared -> changes_requested
    const sbCreated = await staffCreateStoryboard(sDeps, admin, {
      projectId,
      title: 'Title <!channel> & "cut"',
    });
    if (!sbCreated.ok) throw new Error(sbCreated.code);
    await staffReplaceFrames(sDeps, admin, {
      storyboardId: sbCreated.board.id,
      frames: [{ picture: await pngBytes(30, 40), text: { scene: '1', shot: '1', description: 'Shot 1' } }],
    });
    await staffShareStoryboard(sDeps, admin, { storyboardId: sbCreated.board.id });

    await runStoryboardOperation(sDeps, owner, 'board.status', {
      organizationId: orgId,
      projectId,
      storyboardId: sbCreated.board.id,
      status: 'changes_requested',
    });
    await runStoryboardOperation(sDeps, owner, 'board.status', {
      organizationId: orgId,
      projectId,
      storyboardId: sbCreated.board.id,
      status: 'shared',
    });
    await runStoryboardOperation(sDeps, owner, 'board.status', {
      organizationId: orgId,
      projectId,
      storyboardId: sbCreated.board.id,
      status: 'changes_requested',
    });

    // Repeated review decision: changes_requested -> open -> changes_requested
    const revCreated = await runReviewOperation(sDeps, owner, 'review.create', {
      organizationId: orgId,
      assetId,
      title: 'Review <@U1> & Cut',
    });
    if (!revCreated.result.ok || !('review' in revCreated.result)) throw new Error('revCreate');
    const reviewId = revCreated.result.review.id;
    await runReviewOperation(sDeps, owner, 'review.status', {
      organizationId: orgId,
      reviewId,
      status: 'changes_requested',
    });
    await runReviewOperation(sDeps, owner, 'review.status', {
      organizationId: orgId,
      reviewId,
      status: 'open',
    });
    await runReviewOperation(sDeps, owner, 'review.status', {
      organizationId: orgId,
      reviewId,
      status: 'changes_requested',
    });

    // Guest share comment & room message double-escape / duplicate link check
    const shareRes = await createShare(
      { sql, media: sDeps.media },
      owner,
      { organizationId: orgId, kind: 'review', targetId: reviewId, allowComments: true },
    );
    if (!shareRes.ok) throw new Error('share');
    await guestComment(
      { sql, media: sDeps.media },
      { token: shareRes.token, name: 'Guest', body: 'Fix <!channel> & <brightness>' },
      { get: () => undefined },
    );
    await runRoomOperation(
      { sql, media: sDeps.media },
      owner,
      'message.send',
      { organizationId: orgId, projectId, body: 'Room <!here> & check', requestId: randomUUID() },
    );

    const posted: string[] = [];
    const pass = await runTeamNoticeDeliveryPass({
      sql,
      env: webhookFallbackEnv,
      limit: 20,
      fetcher: async (_u, init) => {
        posted.push((JSON.parse(String(init?.body)) as { text: string }).text);
        return new Response('ok', { status: 200 });
      },
    });
    expect(pass.sent).toBeGreaterThanOrEqual(6);

    const sbRows = await sql.query<{ id: string }>(
      "select id from team_notice_deliveries where kind = 'storyboard_approval' and status = 'sent'",
    );
    expect(sbRows.rows).toHaveLength(2);
    const revRows = await sql.query<{ id: string }>(
      "select id from team_notice_deliveries where kind = 'review_comment' and status = 'sent'",
    );
    // changes_requested -> open -> changes_requested all deliver distinctly rather than collapsing on source_id
    expect(revRows.rows).toHaveLength(3);

    for (const msg of posted) {
      expect(msg).not.toContain('&amp;lt;');
      expect(msg).not.toContain('&amp;amp;');
      expect(msg).not.toContain('<!channel>');
      expect(msg).not.toContain('<!here>');
      expect(msg.match(/관리자 화면/g)?.length ?? 0).toBe(1);
    }
  });

  it('F3, F5, F11: marks retries (재전송), never sends user id prefixes, scrubs deleted user notices, and purges old transcripts', async () => {
    const cons = await recordConsumerEscalation(sql, {
      userId: consumer.userId!,
      displayName: 'Park Member',
      reason: 'user_requested_human',
      message: 'Please help me',
      pagePath: '/ko/pricing',
      transcript: [{ role: 'user', text: 'Sensitive chat transcript' }],
      requestId: randomUUID(),
    });
    if (!cons.ok || !cons.available) throw new Error('cons');

    // Privacy: outbox preview stores only short first message, never multi-turn transcript excerpts
    const initialOutboxRow = (
      await sql.query<{ preview: string }>('select preview from team_notice_deliveries where id = $1::uuid', [
        cons.deliveryId,
      ])
    ).rows[0]!;
    expect(initialOutboxRow.preview).toContain('Please help me');
    expect(initialOutboxRow.preview).not.toContain('Sensitive chat transcript');

    const seenTexts: string[] = [];
    let failOnce = true;
    const flakyFetcher: typeof fetch = async (_u, init) => {
      const payload = JSON.parse(String(init?.body)) as { text: string };
      seenTexts.push(payload.text);
      if (failOnce) {
        failOnce = false;
        return new Response('err', { status: 500 });
      }
      return new Response('ok', { status: 200 });
    };

    const t0 = new Date('2026-11-23T00:00:00.000Z');
    await runTeamNoticeDeliveryPass({ sql, env: webhookFallbackEnv, fetcher: flakyFetcher, now: t0 });
    await runTeamNoticeDeliveryPass({
      sql,
      env: webhookFallbackEnv,
      fetcher: flakyFetcher,
      now: new Date(t0.getTime() + 120_000),
    });

    expect(seenTexts).toHaveLength(2);
    // Attempt 1 does NOT say (재전송), attempt 2 DOES say (재전송)
    expect(seenTexts[0]).not.toContain('(재전송)');
    expect(seenTexts[1]).toContain('(재전송)');
    // F11: ZERO 8-char userId prefix anywhere in Slack payload
    expect(seenTexts[0]).not.toContain(consumer.userId!.slice(0, 8));
    expect(seenTexts[1]).not.toContain(consumer.userId!.slice(0, 8));
    expect(seenTexts[1]).toContain(cons.deliveryId!.slice(0, 8));

    // F5b + Round 2 (2): 365-day retention purge clears BOTH transcript AND consumer outbox preview + actor_label
    const noPurge = await purgeExpiredConsumerTranscripts(sql, { now: t0 });
    expect(noPurge.purged).toBe(0);
    await sql.query(
      "update consumer_support_messages set created_at = now() - interval '366 days' where id = $1::uuid",
      [cons.id],
    );
    await sql.query(
      "update team_notice_deliveries set created_at = now() - interval '366 days' where id = $1::uuid",
      [cons.deliveryId],
    );
    const purged = await purgeExpiredConsumerTranscripts(sql, { now: new Date() });
    expect(purged.purged).toBe(1);
    const afterPurge = (
      await sql.query<{ transcript: unknown[]; body: string }>(
        'select transcript, body from consumer_support_messages where id = $1::uuid',
        [cons.id],
      )
    ).rows[0]!;
    expect(afterPurge).toEqual({ transcript: [], body: 'Please help me' });
    const afterPurgeDelivery = (
      await sql.query<{ preview: string; actor_label: string }>(
        'select preview, actor_label from team_notice_deliveries where id = $1::uuid',
        [cons.deliveryId],
      )
    ).rows[0]!;
    expect(afterPurgeDelivery).toEqual({ preview: '', actor_label: '' });

    // Staff profile deletion preserves customer-visible 'studio' replies (created_by becomes null)
    const departedStaffId = randomUUID();
    await seedProfile(sql, { id: departedStaffId, email: 'departed-staff@example.test', isAdmin: false });
    const replyId = randomUUID();
    await sql.query(
      `insert into consumer_support_messages (id, user_id, author_role, created_by, request_id, body)
       values ($1, $2, 'studio', $3, $4, 'Reply survives staff deletion')`,
      [replyId, consumer.userId!, departedStaffId, randomUUID()],
    );
    await sql.query('delete from profiles where id = $1', [departedStaffId]);
    const survivedRow = (
      await sql.query<{ created_by: string | null; body: string }>(
        'select created_by, body from consumer_support_messages where id = $1::uuid',
        [replyId],
      )
    ).rows[0];
    expect(survivedRow).toEqual({ created_by: null, body: 'Reply survives staff deletion' });
    const threadView = await loadConsumerSupportThread(sql, consumer.userId!, 'ko');
    expect(threadView.replies.map((r) => r.body)).toContain('Reply survives staff deletion');

    // F5a: account deletion scrubs preview + actor_label + actor_user_id on team_notice_deliveries & deletes consumer rows
    const req = await requestAccountDeletion(
      sql,
      consumer,
      true,
      new Date('2026-11-01T00:00:00Z'),
      0,
    );
    expect(req.ok).toBe(true);
    if (!req.ok) throw new Error('delreq');
    const delOut = await deleteAccountNow(
      {
        sql,
        files: { deleteFolder: async () => undefined },
        auth: { deleteUser: async () => undefined },
        provider: null,
      },
      req.request.id,
      { now: new Date('2026-11-10T00:00:00Z'), force: true, actorId: admin.userId },
    );
    expect(delOut).toMatchObject({ ok: true });

    const delRow = (
      await sql.query<{ preview: string; actor_label: string; actor_user_id: string | null }>(
        'select preview, actor_label, actor_user_id from team_notice_deliveries where id = $1::uuid',
        [cons.deliveryId],
      )
    ).rows[0]!;
    expect(delRow).toEqual({ preview: '', actor_label: '', actor_user_id: null });
    expect((await sql.query('select id from consumer_support_messages')).rows).toHaveLength(0);
  });

  it('F7 & F13: round-robins >20 threads with cursor paging, exempts synced replies from 30/hr limit, and ignores author change', async () => {
    const orgId = await seedBrandWithMembers();
    const secondAdmin = mkViewer(randomUUID(), 'admin2@example.test', true);
    await seedProfile(sql, { id: secondAdmin.userId!, email: secondAdmin.email!, isAdmin: true });

    // Seed 24 active bot threads in last 7 days so >20 threads require round-robin across 2 ticks
    const threads: Array<{ id: string; ts: string }> = [];
    for (let i = 0; i < 24; i += 1) {
      const srcId = randomUUID();
      const ts = `179600${String(i).padStart(4, '0')}.000100`;
      await sql.query(
        `insert into team_notice_deliveries
           (kind, organization_id, source_table, source_id, status, transport, slack_channel, slack_ts, sent_at, preview)
         values ('support_message', $1, 'brand_support_messages', $2, 'sent', 'bot', 'C0123456789', $3, now() - interval '1 hour', $4)`,
        [orgId, srcId, ts, `Thread ${i}`],
      );
      threads.push({ id: srcId, ts });
    }

    const polledTs: string[] = [];
    const pagingFetcher: typeof fetch = async (url) => {
      const u = new URL(String(url));
      const ts = u.searchParams.get('ts')!;
      const cursor = u.searchParams.get('cursor');
      polledTs.push(`${ts}:${cursor ?? 'first'}`);
      if (ts === threads[23]!.ts && !cursor) {
        return new Response(
          JSON.stringify({
            ok: true,
            messages: [
              { ts, thread_ts: ts, text: 'root' },
              ...Array.from({ length: 20 }, (_, k) => ({
                ts: `${ts.split('.')[0]}.${String(k + 200).padStart(6, '0')}`,
                thread_ts: ts,
                text: `Batch 1 msg ${k}`,
              })),
            ],
            response_metadata: { next_cursor: 'page2' },
          }),
          { status: 200 },
        );
      }
      if (ts === threads[23]!.ts && cursor === 'page2') {
        return new Response(
          JSON.stringify({
            ok: true,
            messages: Array.from({ length: 16 }, (_, k) => ({
              ts: `${ts.split('.')[0]}.${String(k + 300).padStart(6, '0')}`,
              thread_ts: ts,
              text: `Batch 2 msg ${k}`,
            })),
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ ok: true, messages: [{ ts, thread_ts: ts, text: 'root' }] }), {
        status: 200,
      });
    };

    const tick1 = await syncSlackSupportReplies(sql, { env: botEnv, fetcher: pagingFetcher, force: true, limit: 15 });
    const tick2 = await syncSlackSupportReplies(sql, { env: botEnv, fetcher: pagingFetcher, force: true, limit: 15 });
    expect(tick1.checked).toBe(15);
    expect(tick2.checked).toBe(15);
    // Across 2 ticks of limit=15, all 24 threads were visited round-robin!
    const uniqueThreadsVisited = new Set(polledTs.map((x) => x.split(':')[0]));
    expect(uniqueThreadsVisited.size).toBe(24);
    expect(tick1.synced + tick2.synced).toBe(36);

    // Cursor was stored on thread 23 so a 3rd poll requests oldest=1796000023.000315
    const storedCursor = (
      await sql.query<{ reply_sync_cursor: string | null }>(
        'select reply_sync_cursor from team_notice_deliveries where source_id = $1::uuid',
        [threads[23]!.id],
      )
    ).rows[0]!;
    expect(storedCursor.reply_sync_cursor).toBe('1796000023.000315');

    // F13a: Admin who holds synced Slack attribution can STILL send manual studio reply even after >30 synced messages!
    const manualAfter36Synced = await sendBrandSupport(
      { sql },
      admin,
      { organizationId: orgId, body: 'Manual studio follow-up after 36 Slack syncs', requestId: randomUUID() },
      'studio',
    );
    expect(manualAfter36Synced).toMatchObject({ ok: true });

    // F13b: Changing resolved staff system author on re-poll of the SAME Slack ts does NOT collide on PK (id)
    await sql.query('delete from support_synced_replies where slack_ts = $1', ['1796000023.000315']);
    const pollChangedAuthor = await syncSlackSupportReplies(sql, {
      env: { ...botEnv, SLACK_SYNC_SYSTEM_USER_ID: secondAdmin.userId! },
      fetcher: async () =>
        new Response(
          JSON.stringify({
            ok: true,
            messages: [
              {
                ts: '1796000023.000315',
                thread_ts: threads[23]!.ts,
                text: 'Duplicate after author switch',
              },
            ],
          }),
          { status: 200 },
        ),
      force: true,
      limit: 30,
    });
    expect(pollChangedAuthor.errors).toEqual([]);
    expect(pollChangedAuthor.synced).toBe(0);
  });

  it('F9: applies filters in SQL before LIMIT and paginates accurately over >100 rows', async () => {
    const orgId = await seedBrandWithMembers();
    for (let i = 0; i < 105; i += 1) {
      await enqueueTeamNotice(sql, i === 0 ? 'plan_request' : 'org_created', {
        organizationId: orgId,
        sourceTable: 'brand_organizations',
        sourceId: randomUUID(),
        preview: i === 0 ? 'UniqueNeedle105' : `Row ${i}`,
      });
    }

    // Back-date row #0 so it sits at position #105 (beyond LIMIT 100 in unfiltered DESC order!)
    await sql.query(
      "update team_notice_deliveries set created_at = now() - interval '2 days' where kind = 'plan_request'",
    );

    const filtered = await loadTeamNoticeInbox(sql, {
      noticeKind: 'plan_request',
      query: 'UniqueNeedle105',
      env: botEnv,
    });
    expect(filtered.rows).toHaveLength(1);
    expect(filtered.totalFiltered).toBe(1);

    const page2 = await loadTeamNoticeInbox(sql, { page: 2, pageSize: 50, env: botEnv });
    expect(page2.rows).toHaveLength(50);
    expect(page2.totalFiltered).toBe(105);
    expect(page2.page).toBe(2);
    expect(page2.totalPages).toBe(3);
  });

  it('Round 2 (1) SAFETY: blocks un-stubbed fetch under VITEST/NODE_ENV=test across every sender entry point even with production creds', async () => {
    const orgId = await seedBrandWithMembers();
    const sentMsg = await sendBrandSupport(
      { sql },
      owner,
      { organizationId: orgId, body: 'Must stay queued safely in test', requestId: randomUUID() },
    );
    if (!sentMsg.ok) throw new Error(sentMsg.code);
    await sql.query(
      `insert into team_notice_deliveries (
         kind, organization_id, source_table, source_id, actor_user_id, actor_label,
         preview, admin_path, status, transport, slack_channel, slack_ts, sent_at
       ) values (
         'concierge_escalation', null, 'consumer_support_messages', $1, $2, 'Park',
         'Thread check', '/admin/inquiries', 'sent', 'bot', 'C0123456789', '1795000000.000001', now()
       )`,
      [randomUUID(), consumer.userId!],
    );

    const originalFetch = globalThis.fetch;
    let unstubbedCalls = 0;
    globalThis.fetch = (async () => {
      unstubbedCalls += 1;
      throw new Error('UNSTUBBED_FETCH_MUST_NEVER_BE_CALLED');
    }) as typeof fetch;

    const forcedProdBotEnv = {
      ...botEnv,
      NODE_ENV: 'test',
      SLACK_TEAM_NOTICE_FORCE_TEST: 'on',
      SLACK_BRAND_CONCIERGE_FORCE_TEST: 'on',
    };
    try {
      const fb = await sendDirectConsumerEscalationFallback(
        { userId: consumer.userId!, message: 'Should block' },
        { env: { ...webhookFallbackEnv, NODE_ENV: 'test', SLACK_TEAM_NOTICE_FORCE_TEST: 'on' } },
      );
      expect(fb).toEqual({ sent: false });

      const directPayload = await sendTeamNoticePayload(
        { status: 'configured', transport: 'bot', token: 'xoxb-secret', channelId: 'C0123456789' },
        'Must not post',
        { env: forcedProdBotEnv },
      );
      expect(directPayload).toEqual({ status: 'failed', code: 'test_env_blocked' });

      const passRep = await runTeamNoticeDeliveryPass({ sql, env: forcedProdBotEnv });
      expect(passRep).toMatchObject({ claimed: 0, sent: 0 });

      const liveRep = await runLiveTeamNoticeDeliveryPass(sql, { env: forcedProdBotEnv });
      expect(liveRep).toMatchObject({ claimed: 0, sent: 0 });

      const syncRep = await syncSlackSupportReplies(sql, { env: forcedProdBotEnv, force: true });
      expect(syncRep).toMatchObject({ skipped: true, checked: 0, synced: 0 });

      const mirrorRep = await mirrorAdminReplyToSlackThread(
        sql,
        { targetType: 'consumer', userId: consumer.userId!, body: 'admin reply' },
        { env: forcedProdBotEnv },
      );
      expect(mirrorRep).toEqual({ mirrored: false, code: 'test_env_blocked' });

      await db.exec('drop table if exists support_synced_replies, consumer_support_messages, team_notice_deliveries;');
      const compatConcierge = await notifySlackBrandConcierge(
        sql,
        { organizationId: orgId, userId: owner.userId!, body: 'pre-0178', messageId: sentMsg.id },
        { env: forcedProdBotEnv },
      );
      expect(compatConcierge).toEqual({ sent: false });

      const compatProj = await notifySlackBrandProjectRequest(
        sql,
        { organizationId: orgId, projectId: randomUUID(), title: 'Pre-0178' },
        { env: forcedProdBotEnv },
      );
      expect(compatProj).toEqual({ sent: false });

      expect(unstubbedCalls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('Round 2 (4) BUDGET: stops claiming next delivery row and next sync pass on time budget expiry with zero rows left in sending', async () => {
    const orgId = await seedBrandWithMembers();
    const m1 = await sendBrandSupport(
      { sql },
      owner,
      { organizationId: orgId, body: 'First queued notice', requestId: randomUUID() },
    );
    const m2 = await sendBrandSupport(
      { sql },
      owner,
      { organizationId: orgId, body: 'Second queued notice', requestId: randomUUID() },
    );
    if (!m1.ok || !m2.ok) throw new Error('sendBrandSupport');

    let fakeNowMs = 1_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => fakeNowMs);
    try {
      const deadlineAtMs = 1_001_000;
      const slowFetcher: typeof fetch = async () => {
        fakeNowMs += 5_000; // exceed deadline after delivering first row
        return new Response('ok', { status: 200 });
      };
      const pass = await runTeamNoticeDeliveryPass({
        sql,
        env: webhookFallbackEnv,
        fetcher: slowFetcher,
        deadlineAtMs,
        limit: 10,
      });
      expect(pass).toMatchObject({ claimed: 1, sent: 1, budgetExhausted: true });

      const statuses = (
        await sql.query<{ source_id: string; status: string; attempts: number }>(
          'select source_id::text as source_id, status, attempts from team_notice_deliveries where source_id = any($1::uuid[])',
          [[m1.id, m2.id]],
        )
      ).rows;
      expect(statuses.find((r) => r.source_id === m1.id)).toMatchObject({ status: 'sent', attempts: 1 });
      expect(statuses.find((r) => r.source_id === m2.id)).toMatchObject({ status: 'pending', attempts: 0 });
      const sendingRows = await sql.query("select id from team_notice_deliveries where status = 'sending'");
      expect(sendingRows.rows).toHaveLength(0);

      // Subsequent pass sharing the exhausted deadline stops without claiming or calling Slack
      let syncCalls = 0;
      const syncPass = await syncSlackSupportReplies(sql, {
        env: botEnv,
        fetcher: async () => {
          syncCalls += 1;
          return new Response(JSON.stringify({ ok: true, messages: [] }), { status: 200 });
        },
        deadlineAtMs,
        force: true,
      });
      expect(syncPass).toMatchObject({ checked: 0, synced: 0, budgetExhausted: true });
      expect(syncCalls).toBe(0);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
