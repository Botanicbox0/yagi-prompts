import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prerender } from 'react-dom/static';
import type { ReactNode } from 'react';
import type { SqlRunner } from '@/lib/db/sql-runner';

const db = vi.hoisted(() => ({ sql: null as SqlRunner | null }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => db.sql }));
vi.mock('@/lib/i18n/server', () => ({ getLocaleFromHeaders: async () => 'ko' }));
vi.mock('@/lib/routing/request-surface', () => ({ requestSurface: async () => ({ admin: true }), publicHref: (path: string) => `https://twings.app${path}` }));

import { insertRenderJob } from '@/lib/renders/repo';
import { FIXTURE_USERS } from '@/scripts/fixtures';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';
import { getDictionary } from '@/lib/i18n/dictionaries';
import RenderBoardPage from '@/app/(admin)/admin/renders/page';
import RenderDetailPage from '@/app/(admin)/admin/renders/[id]/page';
import PaymentChecksPage from '@/app/(admin)/admin/payments/page';

async function html(node: ReactNode | Promise<ReactNode>) {
  const { prelude } = await prerender(await node);
  return new Response(prelude).text();
}

const ko = getDictionary('ko').adminConsole;
const TEMPLATE = 'neon-alley-dolly';

/** docs/ADMIN.md §7.1–7.2 — the three new screens, rendered from a real schema. */
describe('render board and payment check screens', () => {
  let h: PromptHarness;
  const failed = randomUUID();
  const paid = randomUUID();
  const paymentId = randomUUID();

  beforeAll(async () => {
    h = await promptHarness();
    db.sql = h.sql;
    const templateId = (await h.sql.query<{ id: string }>('select id from prompt_items where slug = $1', [TEMPLATE])).rows[0]!.id;
    for (const id of [failed, paid]) {
      await insertRenderJob(h.sql, { id, userId: FIXTURE_USERS.free.id, templateId, templateSlug: TEMPLATE, medium: 'video', engine: 'seedance-2.0', aspect: '9:16', locale: 'ko', inputKey: 'private/in.jpg', inputMime: 'image/jpeg' });
      await h.sql.query("update render_jobs set status = 'failed', error_code = 'provider_timeout', finished_at = now() where id = $1", [id]);
    }
    await h.sql.query(
      `insert into billing_payments (id, user_id, environment, amount_krw, status, failure_code, payment_key, template_id, template_slug,
         order_name, aspect, locale, render_ref, input_key, input_mime, render_id, consent_at, approved_at, expires_at)
       values ($1, $2, 'test', 3900, 'refund_pending', 'refund_manual', $3, $4, $5, 'fixture order', '9:16', 'ko', $6,
         'private/input.jpg', 'image/jpeg', $6, now(), now(), now() + interval '1 day')`,
      [paymentId, FIXTURE_USERS.free.id, `test-${paymentId}`, templateId, TEMPLATE, paid],
    );
  });
  afterAll(async () => {
    db.sql = null;
    await h.close();
  });

  it('lists renders with filters as links, the menu entry current, and no personal data', async () => {
    const markup = await html(RenderBoardPage({ searchParams: Promise.resolve({}) }));
    expect(markup).toContain('data-admin-render-board');
    expect(markup.match(/data-render-row=/g)).toHaveLength(2);
    expect(markup).toMatch(/data-admin-nav="renders"[^>]*aria-current="page"|aria-current="page"[^>]*data-admin-nav="renders"/);
    expect(markup).toContain('href="/admin/renders?status=failed"');
    expect(markup).toContain(`href="/admin/renders/${paid}"`);
    expect(markup).toContain(ko.renders.kinds.payment);
    expect(markup).not.toContain('private/');
    expect(markup).not.toContain(FIXTURE_USERS.free.email);
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it('keeps a filter in the address and says so when nothing matches', async () => {
    const images = await html(RenderBoardPage({ searchParams: Promise.resolve({ medium: 'image' }) }));
    expect(images).not.toContain('data-render-row=');
    expect(images).toContain(ko.renders.empty);
    expect(images).toMatch(/data-filter="image"[^>]*aria-current="true"|aria-current="true"[^>]*data-filter="image"/);
  });

  it('shows one render with its payment, timeline and a read-only notice', async () => {
    const markup = await html(RenderDetailPage({ params: Promise.resolve({ id: paid }) }));
    expect(markup).toContain(`data-admin-render-detail="${paid}"`);
    expect(markup).toContain('data-admin-read-only');
    expect(markup).toContain(ko.payments.reasons.refund_manual.label);
    expect(markup).toContain('href="/admin/payments"');
    expect(markup).toContain(ko.renders.timeline.finished);
    // No action posts from this page: retry and re-send wait for docs/ADMIN.md §8.
    expect(markup).not.toMatch(/name="_op" value="render\./);
  });

  it('answers 404 for a render that does not exist', async () => {
    await expect(RenderDetailPage({ params: Promise.resolve({ id: randomUUID() }) })).rejects.toThrow();
  });

  it('lists the payment a person must handle, linked to its render', async () => {
    const markup = await html(PaymentChecksPage());
    expect(markup).toContain('data-admin-payments="1"');
    expect(markup).toContain(`data-payment-row="${paymentId}"`);
    expect(markup).toContain('data-reason="refund_manual"');
    expect(markup).toContain(ko.payments.reasons.refund_manual.hint);
    expect(markup).toContain(`href="/admin/renders/${paid}"`);
    expect(markup).not.toContain(FIXTURE_USERS.free.email);
  });
});
