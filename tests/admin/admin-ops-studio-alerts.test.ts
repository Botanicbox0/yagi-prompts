import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isAccountLaneStale,
  loadBrandStudioOps,
  runBrandStudioOpsAlertPass,
  studioOpsFilter,
} from '@/lib/admin/brand-studio-ops';
import { loadAdminQueues } from '@/lib/admin/queue-load';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import { setPlanAssignment } from '@/lib/brands/plans';
import { draftBrandInvoice, issueBrandInvoice } from '@/lib/brands/billing';
import {
  deterministicNoticeSourceId,
  enqueueTeamNotice,
  opsAlertKindAllowed,
} from '@/lib/brands/team-notice-outbox';
import { ADMIN_VIEWER } from '@/tests/helpers/admin';
import { seedProfile } from '@/tests/helpers/billing';
import { freshDb, runner } from '@/tests/helpers/pglite';
import { studioDeps, viewerOf } from '@/tests/brand-studio/server/helpers';

const openClosers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (openClosers.length > 0) {
    const close = openClosers.pop();
    if (close) await close();
  }
});

async function setupStudioDb() {
  const db = await freshDb();
  openClosers.push(() => db.close());
  const sql = runner(db);
  const deps = studioDeps(sql);
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  await seedProfile(sql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: 'studio-admin@yagiworkshop.xyz' });
  await seedProfile(sql, { id: ownerA, email: 'owner-m@example.test' });
  await seedProfile(sql, { id: ownerB, email: 'owner-n@example.test' });

  const orgA = randomUUID();
  const orgB = randomUUID();
  await sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [
    orgA,
    'Monsoon Studios',
    ownerA,
    randomUUID(),
  ]);
  await sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [
    orgB,
    'Nimbus Retail',
    ownerB,
    randomUUID(),
  ]);
  await sql.query('insert into brand_memberships (organization_id, user_id, role) values ($1, $2, $3)', [
    orgA,
    ownerA,
    'owner',
  ]);
  await sql.query('insert into brand_memberships (organization_id, user_id, role) values ($1, $2, $3)', [
    orgB,
    ownerB,
    'owner',
  ]);
  await sql.query('insert into brand_studio_allowances (organization_id, monthly_cap_krw) values ($1, 5000000)', [orgA]);
  await sql.query('insert into brand_studio_allowances (organization_id, monthly_cap_krw) values ($1, 5000000)', [orgB]);

  return { db, sql, deps, ownerA, ownerB, orgA, orgB };
}

async function seedJob(
  sql: ReturnType<typeof runner>,
  deps: ReturnType<typeof studioDeps>,
  orgId: string,
  userId: string,
  opts: {
    status: 'failed' | 'succeeded' | 'queued' | 'held' | 'running';
    lane?: 'sunra_api' | 'sunra_mcp' | null;
    errorCode?: string | null;
    errorDetail?: string | null;
    estimateKrw?: number;
    usageKrw?: number | null;
    createdAt: string;
    finishedAt?: string | null;
  },
) {
  const created = await createStudioJob(deps, viewerOf(userId), {
    kind: 'image',
    organizationId: orgId,
    requestId: randomUUID(),
    model: 'seedream-5.5',
    prompt: 'studio asset',
    aspect: '1:1',
    resolution: '2K',
    count: 1,
  });
  if (!created.ok) throw new Error(`failed to seed job: ${created.code}`);
  await sql.query(
    `update brand_studio_jobs
        set status = $2,
            lane = $3,
            error_code = $4,
            error_detail = $5,
            estimate_krw = coalesce($6, estimate_krw),
            usage_krw = $7,
            created_at = $8::timestamptz,
            finished_at = $9::timestamptz
      where id = $1`,
    [
      created.job.id,
      opts.status,
      opts.lane ?? null,
      opts.errorCode ?? null,
      opts.errorDetail ?? null,
      opts.estimateKrw ?? null,
      opts.usageKrw === undefined ? (opts.status === 'failed' ? 0 : 70) : opts.usageKrw,
      opts.createdAt,
      opts.finishedAt ?? (opts.status === 'failed' || opts.status === 'succeeded' ? opts.createdAt : null),
    ],
  );
  return created.job.id;
}

describe('brand studio ops, home queue counters & 10-minute ops alerts', () => {
  it('loads 7d failed jobs across orgs, filters, hourly rates, and account-lane staleness', async () => {
    const { sql, deps, ownerA, ownerB, orgA, orgB } = await setupStudioDb();
    const now = new Date('2026-11-20T06:00:00.000Z');
    const twentyMinAgoDate = new Date(now.getTime() - 20 * 60_000);
    const twentyMinAgo = twentyMinAgoDate.toISOString();
    const twoHoursAgo = new Date(now.getTime() - 2 * 3_600_000).toISOString();

    await seedJob(sql, deps, orgA, ownerA, {
      status: 'failed',
      lane: 'sunra_mcp',
      errorCode: 'provider_unavailable',
      errorDetail: 'Timed out after 180s',
      estimateKrw: 3500,
      usageKrw: 0,
      createdAt: twentyMinAgo,
    });
    await seedJob(sql, deps, orgB, ownerB, {
      status: 'succeeded',
      lane: 'sunra_api',
      estimateKrw: 70,
      usageKrw: 70,
      createdAt: twentyMinAgo,
    });
    await seedJob(sql, deps, orgB, ownerB, {
      status: 'failed',
      lane: 'sunra_api',
      errorCode: 'provider_rejected',
      errorDetail: 'Upstream 502',
      estimateKrw: 1200,
      usageKrw: 0,
      createdAt: twoHoursAgo,
    });
    // Waiting queued job on sunra_mcp with stale heartbeat
    await seedJob(sql, deps, orgA, ownerA, {
      status: 'queued',
      lane: 'sunra_mcp',
      createdAt: twentyMinAgo,
    });
    await sql.query(
      `insert into brand_studio_lanes (lane, seen_at, info) values ('sunra_mcp', $1::timestamptz, '{}'::jsonb)
       on conflict (lane) do update set seen_at = excluded.seen_at`,
      [twoHoursAgo],
    );

    const ops = await loadBrandStudioOps(sql, ADMIN_VIEWER, studioOpsFilter({}), now);
    expect(ops).not.toBeNull();
    if (!ops) return;

    expect(ops.available).toBe(true);
    expect(ops.hourlyStats.finished1h).toBe(2);
    expect(ops.hourlyStats.failed1h).toBe(1);
    expect(ops.hourlyStats.succeeded1h).toBe(1);
    expect(ops.hourlyStats.failureRate1h).toBe(0.5);
    expect(ops.hourlyStats.failed24h).toBe(2);
    expect(ops.failedTotal7d).toBe(2);
    expect(ops.accountLaneStale).toBe(true);

    const mcp = ops.lanes.find((l) => l.lane === 'sunra_mcp');
    expect(mcp?.queuedCount).toBe(1);
    expect(mcp?.stale).toBe(true);

    // Filtering by errorCode & org search
    const filteredCode = await loadBrandStudioOps(
      sql,
      ADMIN_VIEWER,
      studioOpsFilter({ errorCode: 'provider_unavailable' }),
      now,
    );
    expect(filteredCode?.failedJobs).toHaveLength(1);
    expect(filteredCode?.failedJobs[0]?.organizationName).toBe('Monsoon Studios');
    expect(filteredCode?.failedJobs[0]?.returnedKrw).toBe(3500);

    const filteredSearch = await loadBrandStudioOps(sql, ADMIN_VIEWER, studioOpsFilter({ q: 'nimbus' }), now);
    expect(filteredSearch?.failedJobs.map((j) => j.organizationName)).toEqual(['Nimbus Retail']);

    // Non-admin refusal
    expect(await loadBrandStudioOps(sql, viewerOf(ownerA), studioOpsFilter({}), now)).toBeNull();

    // Pure staleness unit checks (F12: always requires a job waiting >= 15 minutes AND stale heartbeat)
    expect(isAccountLaneStale(null, now, { waitingCount: 0 })).toBe(false);
    expect(isAccountLaneStale(null, now, { waitingCount: 2, oldestWaitingAt: new Date(now.getTime() - 5 * 60_000) })).toBe(false);
    expect(isAccountLaneStale(null, now, { waitingCount: 2, oldestWaitingAt: twentyMinAgoDate })).toBe(true);
    expect(isAccountLaneStale(new Date(now.getTime() - 30_000), now, { waitingCount: 2, oldestWaitingAt: twentyMinAgoDate })).toBe(false);
    expect(isAccountLaneStale(new Date(now.getTime() - 10 * 60_000), now, { waitingCount: 0 })).toBe(false);
    expect(isAccountLaneStale(new Date(now.getTime() - 10 * 60_000), now, { waitingCount: 1, oldestWaitingAt: new Date(now.getTime() - 5 * 60_000) })).toBe(false);
    expect(isAccountLaneStale(new Date(now.getTime() - 10 * 60_000), now, { waitingCount: 1, oldestWaitingAt: twentyMinAgoDate })).toBe(true);
  });

  it('populates home queue counters accurately and returns null when tables are missing', async () => {
    const { sql, deps, ownerA, orgA, orgB } = await setupStudioDb();
    const now = new Date('2026-11-20T06:00:00.000Z');

    // Healthy / empty counters are 0 — even if heartbeat is > 90s old with NO waiting jobs (F12)
    await sql.query(
      `insert into brand_studio_lanes (lane, seen_at, info) values ('sunra_mcp', $1::timestamptz, '{}'::jsonb)
       on conflict (lane) do update set seen_at = excluded.seen_at`,
      [new Date(now.getTime() - 10 * 60_000).toISOString()],
    );
    // F8: plain support message and question-intent plan_request must NOT increment brandWaitingForPlan
    await sql.query(
      `insert into brand_support_messages (organization_id, created_by, request_id, author_role, body)
       values ($1, $2, $3, 'brand', 'Plain support inquiry')`,
      [orgB, ownerA, randomUUID()],
    );
    await enqueueTeamNotice(sql, 'plan_request', {
      organizationId: orgB,
      sourceTable: 'brand_organizations',
      sourceId: randomUUID(),
      surface: 'billing:plan_question:billing_page',
      actorLabel: 'Nimbus owner',
      preview: 'Just asking about invoice timing',
      adminPath: `/admin/brand-workspace/organizations/${orgB}`,
    });

    const initial = await loadAdminQueues(sql, ADMIN_VIEWER, now);
    expect(initial.counts.brandStudioLaneStale).toBe(0);
    expect(initial.counts.brandStudioFailures).toBe(0);
    expect(initial.counts.brandOverdueInvoices).toBe(0);
    expect(initial.counts.brandWaitingForPlan).toBe(0);

    // Young held job (5 min old) with stale heartbeat still must NOT mark lane stale (F12: >= 15 min)
    const youngHeldId = await seedJob(sql, deps, orgA, ownerA, {
      status: 'held',
      lane: null,
      createdAt: new Date(now.getTime() - 5 * 60_000).toISOString(),
    });
    expect((await loadAdminQueues(sql, ADMIN_VIEWER, now)).counts.brandStudioLaneStale).toBe(0);
    await sql.query('delete from brand_studio_jobs where id = $1', [youngHeldId]);

    // Create 1 stale queued job without fresh heartbeat + 1 failed job in 24h
    const thirtyMinAgo = new Date(now.getTime() - 30 * 60_000).toISOString();
    await seedJob(sql, deps, orgA, ownerA, {
      status: 'queued',
      lane: 'sunra_mcp',
      createdAt: thirtyMinAgo,
    });
    await seedJob(sql, deps, orgA, ownerA, {
      status: 'failed',
      lane: 'sunra_api',
      errorCode: 'failed',
      createdAt: thirtyMinAgo,
    });

    // Org A has paid plan & an overdue invoice; Org B has no plan + plan_request notice
    await setPlanAssignment({ sql }, ADMIN_VIEWER, {
      organizationId: orgA,
      planId: 'b2b_29',
      billingMode: 'invoice',
      startedOn: '2026-10-01',
      expectedRevision: 0,
    });
    const inv = await draftBrandInvoice({ sql, now: () => now }, ADMIN_VIEWER, {
      organizationId: orgA,
      period: '2026-10',
      prorate: false,
    });
    if (inv.ok) {
      await issueBrandInvoice({ sql, now: () => now }, ADMIN_VIEWER, { invoiceId: inv.invoice.id });
      await sql.query(`update brand_invoices set issued_at = $2::timestamptz where id = $1`, [
        inv.invoice.id,
        '2026-11-01T00:00:00.000Z',
      ]);
    }
    await enqueueTeamNotice(sql, 'plan_request', {
      organizationId: orgB,
      sourceTable: 'brand_organizations',
      sourceId: deterministicNoticeSourceId('plan_request', orgB),
      surface: 'brand_home',
      actorLabel: 'Nimbus owner',
      preview: 'Requesting plan activation',
      adminPath: `/admin/brand-workspace/organizations/${orgB}`,
    });

    const populated = await loadAdminQueues(sql, ADMIN_VIEWER, now);
    expect(populated.counts.brandStudioLaneStale).toBe(1);
    expect(populated.counts.brandStudioFailures).toBe(1);
    expect(populated.counts.brandOverdueInvoices).toBe(1);
    expect(populated.counts.brandWaitingForPlan).toBe(1);

    // Fresh heartbeat resets stale lane counter back to 0
    await sql.query(
      `insert into brand_studio_lanes (lane, seen_at, info) values ('sunra_mcp', $1::timestamptz, '{}'::jsonb)
       on conflict (lane) do update set seen_at = excluded.seen_at`,
      [now.toISOString()],
    );
    const recovered = await loadAdminQueues(sql, ADMIN_VIEWER, now);
    expect(recovered.counts.brandStudioLaneStale).toBe(0);

    // Missing tables -> null (never false 0)
    await sql.query('drop table if exists brand_studio_jobs, brand_invoices, brand_plan_assignments cascade');
    const missing = await loadAdminQueues(sql, ADMIN_VIEWER, now);
    expect(missing.counts.brandStudioLaneStale).toBeNull();
    expect(missing.counts.brandStudioFailures).toBeNull();
    expect(missing.counts.brandOverdueInvoices).toBeNull();
    expect(missing.counts.brandWaitingForPlan).toBeNull();
  });

  it('fires mass-failure and stale-lane ops alerts with thresholds, 60m cooldown, zero customer data, and skips cleanly pre-0180', async () => {
    const { sql, deps, ownerA, ownerB, orgA, orgB } = await setupStudioDb();
    const now = new Date('2026-11-20T06:00:00.000Z');
    const tenMinAgo = new Date(now.getTime() - 10 * 60_000).toISOString();
    const twentyMinAgo = new Date(now.getTime() - 20 * 60_000).toISOString();

    // Below threshold: 4 failed, 1 succeeded -> < 5 failures
    for (let i = 0; i < 4; i++) {
      await seedJob(sql, deps, orgA, ownerA, {
        status: 'failed',
        lane: 'sunra_api',
        errorCode: 'failed',
        createdAt: tenMinAgo,
      });
    }
    await seedJob(sql, deps, orgB, ownerB, {
      status: 'succeeded',
      lane: 'sunra_api',
      createdAt: tenMinAgo,
    });

    const below = await runBrandStudioOpsAlertPass(sql, now);
    expect(below.enqueued).toEqual([]);

    // 5th failure (5 / 6 = 83% >= 50%) + stale lane with held job -> triggers BOTH alerts
    await seedJob(sql, deps, orgB, ownerB, {
      status: 'failed',
      lane: 'sunra_api',
      errorCode: 'failed',
      createdAt: tenMinAgo,
    });
    await seedJob(sql, deps, orgA, ownerA, {
      status: 'held',
      lane: null,
      createdAt: twentyMinAgo,
    });
    await sql.query(
      `insert into brand_studio_lanes (lane, seen_at, info) values ('sunra_mcp', $1::timestamptz, '{}'::jsonb)
       on conflict (lane) do update set seen_at = excluded.seen_at`,
      [twentyMinAgo],
    );

    const fired = await runBrandStudioOpsAlertPass(sql, now);
    expect(fired.available).toBe(true);
    expect(fired.kindAllowed).toBe(true);
    expect(fired.enqueued.sort()).toEqual(['lane_stale', 'mass_failure']);

    const { rows: alerts } = await sql.query<{
      organization_id: string | null;
      preview: string;
      admin_path: string;
      surface: string;
    }>("select organization_id, preview, admin_path, surface from team_notice_deliveries where kind = 'ops_alert'");
    expect(alerts).toHaveLength(2);
    for (const a of alerts) {
      expect(a.organization_id).toBeNull();
      expect(a.admin_path).toBe('/admin/brand-studio');
      expect(a.preview).not.toContain('Monsoon');
      expect(a.preview).not.toContain('Nimbus');
      expect(a.preview).not.toContain(orgA);
      expect(a.preview).not.toContain(orgB);
    }

    // Cooldown within 60m prevents re-enqueue
    const withinCooldown = await runBrandStudioOpsAlertPass(sql, new Date(now.getTime() + 20 * 60_000));
    expect(withinCooldown.enqueued).toEqual([]);
    expect(withinCooldown.skippedCooldown.sort()).toEqual(['lane_stale', 'mass_failure']);

    // F12: stale heartbeat + YOUNG held job (< 15m waiting) must NOT fire lane_stale alert
    await sql.query("delete from team_notice_deliveries where kind = 'ops_alert'");
    await sql.query("delete from brand_studio_jobs");
    const fiveMinAgo = new Date(now.getTime() - 5 * 60_000).toISOString();
    await seedJob(sql, deps, orgA, ownerA, { status: 'held', lane: null, createdAt: fiveMinAgo });
    const youngJobAlert = await runBrandStudioOpsAlertPass(sql, now);
    expect(youngJobAlert.laneStale).toBeNull();
    expect(youngJobAlert.enqueued).toEqual([]);

    // Pre-0180 constraint check skips quietly without throwing
    await sql.query("delete from team_notice_deliveries where kind = 'ops_alert'");
    await sql.query(`
      do $$
      declare r record;
      begin
        for r in select oid, conname from pg_constraint where conrelid = 'team_notice_deliveries'::regclass and contype = 'c'
        loop
          if pg_get_constraintdef(r.oid) like '%kind%' then
            execute format('alter table team_notice_deliveries drop constraint %I', r.conname);
          end if;
        end loop;
        alter table team_notice_deliveries add constraint team_notice_deliveries_kind_check
          check (kind in ('support_message', 'concierge_escalation', 'project_request', 'room_message', 'storyboard_approval', 'review_comment', 'share_guest_note', 'org_created', 'allowance_request', 'plan_request'));
      end
      $$;
    `);
    expect(await opsAlertKindAllowed(sql)).toBe(false);
    const skippedPre0180 = await runBrandStudioOpsAlertPass(sql, new Date(now.getTime() + 90 * 60_000));
    expect(skippedPre0180.kindAllowed).toBe(false);
    expect(skippedPre0180.enqueued).toEqual([]);
  });

  it('wires opsAlerts pass cleanly inside /api/brand-rooms/notices/tick', async () => {
    const { sql, deps, ownerA, orgA } = await setupStudioDb();
    const recent = new Date(Date.now() - 20 * 60_000).toISOString();
    await seedJob(sql, deps, orgA, ownerA, { status: 'held', lane: null, createdAt: recent });

    const prevSecret = process.env.CRON_SECRET;
    const prevNotify = process.env.BRAND_ROOM_NOTIFY;
    process.env.CRON_SECRET = 'test-ops-tick-secret';
    process.env.BRAND_ROOM_NOTIFY = 'off';

    vi.resetModules();
    vi.doMock('@/lib/db/connect', () => ({ getSqlRunner: async () => sql }));

    try {
      const { GET } = await import('@/app/api/brand-rooms/notices/tick/route');
      const res = await GET(
        new Request('http://localhost/api/brand-rooms/notices/tick', {
          headers: { authorization: 'Bearer test-ops-tick-secret' },
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        passes: { opsAlerts?: { ok: boolean; enqueued?: number; kindAllowed?: boolean } };
      };
      expect(body.ok).toBe(true);
      expect(body.passes.opsAlerts).toMatchObject({ ok: true, enqueued: 1, kindAllowed: true });
    } finally {
      vi.doUnmock('@/lib/db/connect');
      vi.resetModules();
      if (prevSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prevSecret;
      if (prevNotify === undefined) delete process.env.BRAND_ROOM_NOTIFY;
      else process.env.BRAND_ROOM_NOTIFY = prevNotify;
    }
  });
});
