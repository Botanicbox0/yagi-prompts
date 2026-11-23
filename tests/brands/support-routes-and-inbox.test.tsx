import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { prerender } from 'react-dom/static';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, runner } from '@/tests/helpers/pglite';
import { seedProfile } from '@/tests/helpers/billing';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { sendBrandSupport, createStudioOrganization } from '@/lib/brands/workspace/service';
import { recordConsumerEscalation } from '@/lib/support/concierge-service';
import {
  TwingsAiConcierge,
  conciergeEscalatedStorageKey,
  conciergeSeenAtStorageKey,
  isEscalationAcceptedResponse,
  shouldFetchConciergeOnEffect,
} from '@/components/support/twings-ai-concierge';

const mocks = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
  sessionUser: null as { id: string; user_metadata?: Record<string, unknown> } | null,
  viewer: { userId: null, isAdmin: false, tier: 'anon', email: null, locale: 'ko' } as Viewer,
  fallbackFetcher: undefined as typeof fetch | undefined,
}));

vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/supabase/auth-client', () => ({ getSessionUser: async () => mocks.sessionUser }));
vi.mock('@/lib/auth/viewer', () => ({
  getViewer: async () => mocks.viewer,
  requireAdmin: async () => mocks.viewer,
}));
vi.mock('@/lib/i18n/server', () => ({ getLocaleFromHeaders: async () => 'ko' }));
vi.mock('@/lib/routing/request-surface', () => ({
  requestSurface: async () => ({ admin: true }),
  publicHref: (path: string) => `https://twings.app${path}`,
}));
vi.mock('@/lib/support/concierge-service', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/support/concierge-service')>();
  return {
    ...mod,
    sendDirectConsumerEscalationFallback: (
      input: Parameters<typeof mod.sendDirectConsumerEscalationFallback>[0],
      options?: Parameters<typeof mod.sendDirectConsumerEscalationFallback>[1],
    ) =>
      mod.sendDirectConsumerEscalationFallback(input, {
        ...options,
        ...(mocks.fallbackFetcher ? { fetcher: mocks.fallbackFetcher } : {}),
      }),
  };
});

const conciergeRoute = await import('@/app/api/support/concierge/route');
const { default: AdminInquiriesPage } = await import('@/app/(admin)/admin/inquiries/page');

let db: PGlite;
let sql: SqlRunner;
let admin: Viewer;
let memberId: string;

beforeEach(async () => {
  db = await freshDb();
  sql = runner(db);
  mocks.sql = sql;

  const adminId = randomUUID();
  memberId = randomUUID();
  await seedProfile(sql, { id: adminId, email: 'admin@example.test', isAdmin: true });
  await seedProfile(sql, { id: memberId, email: 'member-hidden@example.test', isAdmin: false });
  await sql.query("update profiles set display_name = 'Sample User' where id = $1", [memberId]);

  admin = { userId: adminId, isAdmin: true, tier: 'admin', email: 'admin@example.test', locale: 'ko' };
  mocks.viewer = admin;
  mocks.sessionUser = { id: memberId, user_metadata: { full_name: 'Sample User' } };
});

afterEach(async () => {
  mocks.fallbackFetcher = undefined;
  vi.unstubAllEnvs();
  mocks.sql = null;
  await db.close();
});

describe('support concierge HTTP API and unified /admin/inquiries screen', () => {
  it('stores consumer escalation truthfully, replays studio replies on GET, and refuses pre-0178 unconfigured drops', async () => {
    const reqId = randomUUID();
    const res = await conciergeRoute.POST(
      new NextRequest('https://twings.app/api/support/concierge', {
        method: 'POST',
        headers: {
          host: 'twings.app',
          origin: 'https://twings.app',
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          operation: 'escalate',
          locale: 'ko',
          reason: 'user_requested_human',
          message: '결제 확인 요청합니다',
          pagePath: '/ko/pricing',
          requestId: reqId,
        }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; stored: boolean; id?: string; deliveryStatus?: string };
    expect(body).toMatchObject({ ok: true, stored: true, deliveryStatus: 'pending' });
    expect(body.id).toBeTruthy();

    // Insert studio reply directly and verify GET returns it without mentioning Slack
    await sql.query(
      `insert into consumer_support_messages (user_id, author_role, created_by, request_id, body)
       values ($1, 'studio', $2, $3, '확인 후 안내드립니다.')`,
      [memberId, admin.userId, randomUUID()],
    );

    const getRes = await conciergeRoute.GET(
      new NextRequest('https://twings.app/api/support/concierge?locale=ko', {
        headers: { host: 'twings.app' },
      }),
    );
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as { ok: boolean; replies: Array<{ body: string }> };
    expect(getBody.ok).toBe(true);
    expect(getBody.replies.map((r) => r.body)).toEqual(['확인 후 안내드립니다.']);

    // Deploy-order fallback when tables do not exist and Slack cannot send -> honest 503 { ok: false, stored: false }
    await db.exec('drop table if exists support_synced_replies, consumer_support_messages, team_notice_deliveries;');
    const unavailableRes = await conciergeRoute.POST(
      new NextRequest('https://twings.app/api/support/concierge', {
        method: 'POST',
        headers: {
          host: 'twings.app',
          origin: 'https://twings.app',
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          operation: 'escalate',
          locale: 'ko',
          reason: 'user_requested_human',
          message: 'Unconfigured fallback check',
          requestId: randomUUID(),
        }),
      }),
    );
    expect(unavailableRes.status).toBe(503);
    expect(await unavailableRes.json()).toEqual({ ok: false, stored: false, code: 'delivery_unavailable' });
  });

  it('renders /admin/inquiries?kind=team with sync-mode indicators, status pills, org links, and no consumer email leak', async () => {
    const orgRes = await createStudioOrganization({ sql }, admin, {
      name: 'Acme Brands',
      requestId: randomUUID(),
    });
    if (!orgRes.ok) throw new Error('org');

    const ownerId = randomUUID();
    await seedProfile(sql, { id: ownerId, email: 'brand-owner@example.test', isAdmin: false });
    await sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [
      orgRes.id,
      ownerId,
    ]);
    await sendBrandSupport({ sql }, { userId: ownerId, isAdmin: false, tier: 'free', email: 'brand-owner@example.test', locale: 'ko' }, {
      organizationId: orgRes.id,
      body: 'Brand workspace live inquiry',
      requestId: randomUUID(),
    });

    await sql.query(
      `update team_notice_deliveries
          set status = 'sent', transport = 'bot', slack_channel = 'C0123456789',
              slack_ts = '1796000000.000100', sent_at = now()
        where kind = 'support_message'`,
    );

    const cons = await recordConsumerEscalation(sql, {
      userId: memberId,
      reason: 'ai_unanswered',
      message: 'Failed webhook delivery item',
      requestId: randomUUID(),
    });
    if (!cons.ok || !cons.available) throw new Error('cons');
    await sql.query(
      `update team_notice_deliveries set status = 'failed', attempts = 8, last_error_code = 'http_500' where id = $1::uuid`,
      [cons.deliveryId],
    );

    const { prelude } = await prerender(
      await AdminInquiriesPage({
        searchParams: Promise.resolve({ kind: 'team' }),
      }),
    );
    const html = await new Response(prelude).text();

    expect(html).toContain('data-admin-team-notices');
    // F6: when sender runtime config is paused/unconfigured, shows explicit banner with waiting count
    expect(html).toContain('data-support-sender-banner');
    expect(html).toContain('Acme Brands');
    expect(html).toContain(`/admin/brand-workspace/organizations/${orgRes.id}`);
    expect(html).toContain('data-reply-sync-mode="bot_sync"');
    expect(html).toContain('data-reply-sync-mode="admin_only"');
    expect(html).toContain('value="support.delivery.retry"');
    expect(html).toContain('value="support.slack.connectionTest"');
    expect(html).toContain('value="support.reply"');
    expect(html).not.toContain('member-hidden@example.test');
    expect(html).not.toContain('brand-owner@example.test');
  });

  it('F4 & F8: handles pre-0178 delivered-only UI state with dedupe, reload thread hydration, and launcher unread dot', async () => {
    // F4a: Consumer UI accepts either stored:true OR delivered:true as received
    expect(isEscalationAcceptedResponse(true, { ok: true, stored: true })).toBe(true);
    expect(isEscalationAcceptedResponse(true, { ok: true, stored: false, delivered: true })).toBe(true);
    expect(isEscalationAcceptedResponse(true, { ok: true, stored: false, delivered: false })).toBe(false);
    expect(isEscalationAcceptedResponse(false, { ok: true, stored: true })).toBe(false);

    // F8: GET /api/support/concierge returns hasEscalation and full thread after reload + unread badge when unread > 0
    await recordConsumerEscalation(sql, {
      userId: memberId,
      reason: 'user_requested_human',
      message: 'Reload persistence check',
      requestId: randomUUID(),
    });
    await sql.query(
      `insert into consumer_support_messages (user_id, author_role, created_by, request_id, body)
       values ($1, 'studio', $2, $3, 'Staff reply after reload')`,
      [memberId, admin.userId, randomUUID()],
    );

    const getRes = await conciergeRoute.GET(
      new NextRequest('https://twings.app/api/support/concierge?locale=ko', {
        headers: { host: 'twings.app' },
      }),
    );
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as {
      ok: boolean;
      hasEscalation?: boolean;
      thread?: Array<{ role: string; text: string }>;
    };
    expect(getBody.hasEscalation).toBe(true);
    expect(getBody.thread?.map((m) => [m.role, m.text])).toEqual([
      ['user', 'Reload persistence check'],
      ['human_agent', 'Staff reply after reload'],
    ]);

    const { prelude: launcherPrelude } = await prerender(
      <TwingsAiConcierge locale="ko" defaultOpen={false} initialSignedIn={true} initialUnreadCount={1} />,
    );
    const launcherHtml = await new Response(launcherPrelude).text();
    expect(launcherHtml).toContain('data-concierge-unread-dot');

    // F4b: Pre-0178 fallback refuses un-stubbed fetch under VITEST and works with injected fetcher + dedupes
    await db.exec('drop table if exists support_synced_replies, consumer_support_messages, team_notice_deliveries;');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('SLACK_BRAND_INQUIRIES_ENABLED', 'on');
    vi.stubEnv('SLACK_BRAND_INQUIRIES_WEBHOOK_URL', 'https://hooks.slack.com/services/T1/B1/S1');

    const origFetch = globalThis.fetch;
    let unstubbedCalls = 0;
    globalThis.fetch = (async () => {
      unstubbedCalls += 1;
      throw new Error('UNSTUBBED_FETCH_REACHED');
    }) as typeof fetch;

    const makeReq = (reqId: string) =>
      conciergeRoute.POST(
        new NextRequest('https://twings.app/api/support/concierge', {
          method: 'POST',
          headers: {
            host: 'twings.app',
            origin: 'https://twings.app',
            'sec-fetch-site': 'same-origin',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            operation: 'escalate',
            locale: 'ko',
            reason: 'user_requested_human',
            message: 'Same pre-0178 inquiry text',
            requestId: reqId,
          }),
        }),
      );

    try {
      // Un-stubbed fetch (no injected fetcher) MUST refuse under VITEST even with production creds
      mocks.fallbackFetcher = undefined;
      const blocked = await makeReq(randomUUID());
      expect(blocked.status).toBe(503);
      expect(unstubbedCalls).toBe(0);

      let injectedCalls = 0;
      mocks.fallbackFetcher = async () => {
        injectedCalls += 1;
        return new Response('ok', { status: 200 });
      };

      const first = await makeReq(randomUUID());
      expect(first.status).toBe(200);
      expect(await first.json()).toMatchObject({ ok: true, stored: false, delivered: true });

      const second = await makeReq(randomUUID());
      expect(second.status).toBe(200);
      expect(await second.json()).toMatchObject({ ok: true, stored: false, delivered: true, duplicate: true });
      expect(injectedCalls).toBe(1);
      expect(unstubbedCalls).toBe(0);
    } finally {
      mocks.fallbackFetcher = undefined;
      globalThis.fetch = origFetch;
    }
  });

  it('Round 2 (3) COST: gates background GET /api/support/concierge behind per-user localStorage key', () => {
    const store = new Map<string, string>();
    const getItem = (k: string) => store.get(k) ?? null;

    const keyA = conciergeEscalatedStorageKey('user-key-alpha');
    const keyB = conciergeEscalatedStorageKey('user-key-beta');
    expect(keyA).not.toBe(keyB);
    expect(conciergeSeenAtStorageKey('user-key-alpha')).not.toBe(conciergeSeenAtStorageKey('user-key-beta'));

    // Signed-in user A has NO remembered escalation -> zero background GETs on closed mount
    expect(
      shouldFetchConciergeOnEffect({
        signedIn: true,
        isBrandSurface: false,
        isOpen: false,
        userKey: 'user-key-alpha',
        getItem,
      }),
    ).toBe(false);

    // Even if user B remembered an escalation on the same browser, user A still makes zero GETs
    store.set(keyB, '1');
    expect(
      shouldFetchConciergeOnEffect({
        signedIn: true,
        isBrandSurface: false,
        isOpen: false,
        userKey: 'user-key-alpha',
        getItem,
      }),
    ).toBe(false);
    expect(
      shouldFetchConciergeOnEffect({
        signedIn: true,
        isBrandSurface: false,
        isOpen: false,
        userKey: 'user-key-beta',
        getItem,
      }),
    ).toBe(true);

    // Opening the widget ALWAYS loads for signed-in users even before a local key exists
    expect(
      shouldFetchConciergeOnEffect({
        signedIn: true,
        isBrandSurface: false,
        isOpen: true,
        userKey: 'user-key-alpha',
        getItem,
      }),
    ).toBe(true);

    // Clearing the per-user key once seen/closed stops subsequent page-load GETs
    store.delete(keyB);
    expect(
      shouldFetchConciergeOnEffect({
        signedIn: true,
        isBrandSurface: false,
        isOpen: false,
        userKey: 'user-key-beta',
        getItem,
      }),
    ).toBe(false);
  });
});
