import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prerender } from 'react-dom/static';
import type { ReactNode } from 'react';
import type { SqlRunner } from '@/lib/db/sql-runner';

const db = vi.hoisted(() => ({ sql: null as SqlRunner | null }));
vi.mock('@/lib/auth/viewer', () => ({ requireAdmin: async () => ({ isAdmin: true, userId: 'f0000000-0000-4000-8000-000000000003' }) }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => db.sql }));
vi.mock('@/lib/i18n/server', () => ({ getLocaleFromHeaders: async () => 'ko' }));
vi.mock('@/lib/routing/request-surface', () => ({
  requestSurface: async () => ({ admin: true }),
  publicHref: (path: string) => `https://twings.app${path}`,
}));

import { FIXTURE_USERS } from '@/scripts/fixtures';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';
import { ADMIN_VIEWER } from '@/tests/helpers/admin';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { loadAdminQueues } from '@/lib/admin/queue-load';
import {
  countManualPayments,
  countManualPaymentsByEnvironment,
  defaultPaymentEnvironment,
  loadManualPayments,
  paymentChecksFilter,
} from '@/lib/admin/render-board';
import { insertRenderJob } from '@/lib/renders/repo';
import PaymentChecksPage from '@/app/(admin)/admin/payments/page';
import RenderDetailPage from '@/app/(admin)/admin/renders/[id]/page';

async function html(node: ReactNode | Promise<ReactNode>) {
  const { prelude } = await prerender(await node);
  return new Response(prelude).text();
}

const ko = getDictionary('ko');
const TEMPLATE = 'neon-alley-dolly';

describe('admin payments environment filter and UI controls', () => {
  let h: PromptHarness;
  const liveId = randomUUID();
  const testId = randomUUID();
  const fakeId = randomUUID();

  beforeAll(async () => {
    h = await promptHarness();
    db.sql = h.sql;
    const templateId = (await h.sql.query<{ id: string }>('select id from prompt_items where slug = $1', [TEMPLATE])).rows[0]!.id;

    await h.sql.query(
      `insert into billing_payments (id, user_id, environment, amount_krw, status, failure_code, payment_key, template_id, template_slug,
         order_name, aspect, locale, render_ref, input_key, input_mime, consent_at, approved_at, expires_at)
       values
         ($1, $4, 'live', 4900, 'refund_pending', 'refund_manual', $5, $6, $7, 'live order fixture', '9:16', 'ko', $1, 'p/in.jpg', 'image/jpeg', now(), now(), now() + interval '1 day'),
         ($2, $4, 'test', 3900, 'refund_pending', 'partial_balance', $8, $6, $7, 'test order fixture', '9:16', 'ko', $2, 'p/in.jpg', 'image/jpeg', now(), now(), now() + interval '1 day'),
         ($3, $4, 'fake', 2900, 'paid', 'fulfil_manual', $9, $6, $7, 'fake order fixture', '9:16', 'ko', $3, 'p/in.jpg', 'image/jpeg', now(), now(), now() + interval '1 day')`,
      [liveId, testId, fakeId, FIXTURE_USERS.free.id, `live-${liveId}`, templateId, TEMPLATE, `test-${testId}`, `fake-${fakeId}`],
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    db.sql = null;
    await h.close();
  });

  it('derives default environment from Toss keys or VERCEL_ENV and parses query toggles safely', () => {
    expect(defaultPaymentEnvironment({ TOSS_CLIENT_KEY: 'live_gck_a', TOSS_SECRET_KEY: 'live_gsk_b' })).toBe('live');
    expect(defaultPaymentEnvironment({ TOSS_CLIENT_KEY: 'test_gck_a', TOSS_SECRET_KEY: 'test_gsk_b' })).toBe('test');
    expect(defaultPaymentEnvironment({ VERCEL_ENV: 'production' })).toBe('live');
    expect(defaultPaymentEnvironment({ NODE_ENV: 'test' })).toBe('test');

    expect(paymentChecksFilter({}, { TOSS_CLIENT_KEY: 'live_gck_a', TOSS_SECRET_KEY: 'live_gsk_b' })).toEqual({
      environment: 'live',
      defaultEnvironment: 'live',
    });
    expect(paymentChecksFilter({ env: 'test' }, { TOSS_CLIENT_KEY: 'live_gck_a', TOSS_SECRET_KEY: 'live_gsk_b' })).toEqual({
      environment: 'test',
      defaultEnvironment: 'live',
    });
    expect(paymentChecksFilter({ env: 'invalid' }, { TOSS_CLIENT_KEY: 'live_gck_a', TOSS_SECRET_KEY: 'live_gsk_b' })).toEqual({
      environment: 'live',
      defaultEnvironment: 'live',
    });
  });

  it('scopes loadManualPayments, countManualPayments and admin home queue count by environment', async () => {
    expect(await countManualPaymentsByEnvironment(h.sql)).toEqual({ live: 1, test: 2 });
    expect(await countManualPayments(h.sql, 'live')).toBe(1);
    expect(await countManualPayments(h.sql, 'test')).toBe(2);

    const liveRows = await loadManualPayments(h.sql, 'live');
    expect(liveRows.map((r) => r.id)).toEqual([liveId]);
    expect(liveRows[0]!.environment).toBe('live');

    const testRows = await loadManualPayments(h.sql, 'test');
    expect(testRows.map((r) => r.id).sort()).toEqual([fakeId, testId].sort());

    const liveQueue = await loadAdminQueues(h.sql, ADMIN_VIEWER, new Date('2026-11-20T00:00:00Z'), {
      TOSS_CLIENT_KEY: 'live_gck_probe',
      TOSS_SECRET_KEY: 'live_gsk_probe',
    });
    expect(liveQueue.counts.paymentsManual).toBe(1);

    const testQueue = await loadAdminQueues(h.sql, ADMIN_VIEWER, new Date('2026-11-20T00:00:00Z'), {
      TOSS_CLIENT_KEY: 'test_gck_probe',
      TOSS_SECRET_KEY: 'test_gsk_probe',
    });
    expect(testQueue.counts.paymentsManual).toBe(2);
  });

  it('defaults /admin/payments to the deployment environment with a toggle and renders recheck actions only for matching environment', async () => {
    vi.stubEnv('TOSS_CLIENT_KEY', 'live_gck_probe');
    vi.stubEnv('TOSS_SECRET_KEY', 'live_gsk_probe');

    const liveMarkup = await html(PaymentChecksPage({ searchParams: Promise.resolve({}) }));
    expect(liveMarkup).toContain('data-admin-payments="1"');
    expect(liveMarkup).toContain(`data-payment-row="${liveId}"`);
    expect(liveMarkup).not.toContain(`data-payment-row="${testId}"`);
    expect(liveMarkup).not.toContain(`data-payment-row="${fakeId}"`);
    expect(liveMarkup).toMatch(/data-filter="live"[^>]*aria-current="true"|aria-current="true"[^>]*data-filter="live"/);
    expect(liveMarkup).toContain('href="/admin/payments?env=test"');
    expect(liveMarkup).toContain('name="_op" value="billing.payment.recheck"');
    expect(liveMarkup).toContain(`name="paymentId" value="${liveId}"`);

    // Toggled to test on a live deployment: shows test/fake rows, shows other-env notice, no row recheck form for mismatched env
    const toggledMarkup = await html(PaymentChecksPage({ searchParams: Promise.resolve({ env: 'test' }) }));
    expect(toggledMarkup).toContain('data-admin-payments="2"');
    expect(toggledMarkup).toContain(`data-payment-row="${testId}"`);
    expect(toggledMarkup).toContain(`data-payment-row="${fakeId}"`);
    expect(toggledMarkup).not.toContain(`data-payment-row="${liveId}"`);
    expect(toggledMarkup).toMatch(/data-filter="test"[^>]*aria-current="true"|aria-current="true"[^>]*data-filter="test"/);
    expect(toggledMarkup).toContain(ko.adminConsole.payments.otherEnvNotice);
    expect(toggledMarkup).toContain(ko.adminConsole.payments.recheckOtherEnv);
    expect(toggledMarkup).not.toContain(`name="paymentId" value="${testId}"`);
    expect(toggledMarkup).not.toContain(`name="paymentId" value="${fakeId}"`);
  });

  it('renders outcome banner transitions for paymentRechecked, paymentUnchanged, and errors', async () => {
    vi.stubEnv('TOSS_CLIENT_KEY', 'live_gck_probe');
    vi.stubEnv('TOSS_SECRET_KEY', 'live_gsk_probe');

    const updatedHtml = await html(
      PaymentChecksPage({
        searchParams: Promise.resolve({
          ok: 'paymentRechecked',
          detail: 'paid → CANCELED → refunded',
        }),
      }),
    );
    expect(updatedHtml).toContain(ko.admin.okPaymentRechecked);
    expect(updatedHtml).toContain('paid → CANCELED → refunded');

    const unchangedHtml = await html(
      PaymentChecksPage({
        searchParams: Promise.resolve({
          ok: 'paymentUnchanged',
          detail: 'paid → DONE → paid',
        }),
      }),
    );
    expect(unchangedHtml).toContain(ko.admin.okPaymentUnchanged);
    expect(unchangedHtml).toContain('paid → DONE → paid');

    const cooldownHtml = await html(
      PaymentChecksPage({
        searchParams: Promise.resolve({
          err: 'paymentCooldown',
          detail: '45s',
        }),
      }),
    );
    expect(cooldownHtml).toContain(ko.admin.errPaymentCooldown);
    expect(cooldownHtml).toContain('45s');
  });

  it('shows the recheck button on /admin/renders/[id] only when the payment environment matches the deployment keys', async () => {
    const templateId = (await h.sql.query<{ id: string }>('select id from prompt_items where slug = $1', [TEMPLATE])).rows[0]!.id;
    const renderId = randomUUID();
    const paidOrderId = randomUUID();

    await insertRenderJob(h.sql, {
      id: renderId,
      userId: FIXTURE_USERS.free.id,
      templateId,
      templateSlug: TEMPLATE,
      medium: 'video',
      engine: 'seedance-2.0',
      aspect: '9:16',
      locale: 'ko',
      inputKey: 'private/in.jpg',
      inputMime: 'image/jpeg',
    });
    await h.sql.query(
      `update render_jobs
          set status = 'succeeded',
              result_key = 'private/out.mp4',
              result_mime = 'video/mp4',
              share_token = 'tok-render-env',
              share_expires_at = now() + interval '1 day',
              finished_at = now()
        where id = $1`,
      [renderId],
    );
    await h.sql.query(
      `insert into billing_payments (id, user_id, environment, amount_krw, status, payment_key, template_id, template_slug,
         order_name, aspect, locale, render_ref, input_key, input_mime, render_id, consent_at, approved_at, expires_at)
       values ($1, $2, 'live', 4900, 'paid', $3, $4, $5, 'live render payment', '9:16', 'ko', $6, 'p/in.jpg', 'image/jpeg', $6, now(), now(), now() + interval '1 day')`,
      [paidOrderId, FIXTURE_USERS.free.id, `live-${paidOrderId}`, templateId, TEMPLATE, renderId],
    );

    vi.stubEnv('TOSS_CLIENT_KEY', 'live_gck_probe');
    vi.stubEnv('TOSS_SECRET_KEY', 'live_gsk_probe');
    const matchMarkup = await html(
      RenderDetailPage({
        params: Promise.resolve({ id: renderId }),
        searchParams: Promise.resolve({ ok: 'paymentRechecked', detail: 'paid → CANCELED → refunded' }),
      }),
    );
    expect(matchMarkup).toContain(`data-payment-recheck="${paidOrderId}"`);
    expect(matchMarkup).toContain('name="_op" value="billing.payment.recheck"');
    expect(matchMarkup).toContain(ko.admin.okPaymentRechecked);
    expect(matchMarkup).toContain('paid → CANCELED → refunded');

    vi.stubEnv('TOSS_CLIENT_KEY', 'test_gck_probe');
    vi.stubEnv('TOSS_SECRET_KEY', 'test_gsk_probe');
    const mismatchMarkup = await html(RenderDetailPage({ params: Promise.resolve({ id: renderId }) }));
    expect(mismatchMarkup).not.toContain(`data-payment-recheck="${paidOrderId}"`);
  });
});
