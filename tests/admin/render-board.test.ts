import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertRenderJob } from '@/lib/renders/repo';
import { FIXTURE_USERS } from '@/scripts/fixtures';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';
import {
  countRecentRenderFailures,
  loadManualPayments,
  loadRenderBoard,
  loadRenderDetail,
  paymentTone,
  renderBoardFilter,
  renderBoardHref,
  renderTone,
} from '@/lib/admin/render-board';

/**
 * docs/ADMIN.md §7.1–7.2 — the render board and the payment check read the real schema, and never
 * carry the person's e-mail, photo, result file or share token.
 */
const NOW = new Date('2026-11-03T09:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const OWNER = FIXTURE_USERS.free.id;
const TEMPLATE = 'neon-alley-dolly';

describe('render board read model', () => {
  let h: PromptHarness;
  let templateId: string;
  const ids = { failed: randomUUID(), paid: randomUUID(), image: randomUUID(), old: randomUUID(), done: randomUUID() };
  const paymentId = randomUUID();

  beforeAll(async () => {
    h = await promptHarness();
    const { rows } = await h.sql.query<{ id: string }>('select id from prompt_items where slug = $1', [TEMPLATE]);
    templateId = rows[0]!.id;
    const add = async (id: string, medium: 'video' | 'image', status: string, created: string, extra = '') => {
      await insertRenderJob(h.sql, { id, userId: OWNER, templateId, templateSlug: TEMPLATE, medium, engine: 'seedance-2.0', aspect: '9:16', locale: 'ko', inputKey: 'private/in.jpg', inputMime: 'image/jpeg' });
      await h.sql.query(`update render_jobs set status = $2, created_at = $3::timestamptz ${extra} where id = $1`, [id, status, created]);
    };
    await add(ids.failed, 'video', 'failed', hoursAgo(1), ", error_code = 'provider_timeout', error_message = 'the provider did not answer', finished_at = now()");
    await add(ids.paid, 'video', 'failed', hoursAgo(2), ", error_code = 'engine_error', cost_usd = 1.25, cost_source = 'estimate', finished_at = now()");
    await add(ids.image, 'image', 'queued', hoursAgo(3));
    await add(ids.done, 'video', 'succeeded', hoursAgo(4), ", cost_usd = 2, result_key = 'private/out.mp4', result_mime = 'video/mp4', share_token = 'secret-token', share_expires_at = now() + interval '1 day', started_at = created_at + interval '10 seconds', finished_at = created_at + interval '3 minutes 12 seconds'");
    await add(ids.old, 'video', 'failed', hoursAgo(24 * 10), ", error_code = 'stalled', finished_at = now()");
    await h.sql.query(
      `insert into billing_payments (id, user_id, environment, amount_krw, status, failure_code, payment_key, template_id, template_slug,
         order_name, aspect, locale, render_ref, input_key, input_mime, render_id, consent_at, approved_at, expires_at)
       values ($1, $2, 'test', 3900, 'refund_pending', 'refund_manual', $3, $4, $5, 'fixture order', '9:16', 'ko', $6,
         'private/input.jpg', 'image/jpeg', $6, now(), now(), now() + interval '1 day')`,
      [paymentId, OWNER, `test-${paymentId}`, templateId, TEMPLATE, ids.paid],
    );
  });
  afterAll(async () => {
    await h.close();
  });

  it('lists every render newest first, with counts by status and a seven-day summary', async () => {
    const board = await loadRenderBoard(h.sql, renderBoardFilter({}), NOW);
    expect(board.rows.map((row) => row.id)).toEqual([ids.failed, ids.paid, ids.image, ids.done, ids.old]);
    expect(board.total).toBe(5);
    expect(board.byStatus).toMatchObject({ failed: 3, queued: 1, succeeded: 1, held: 0, running: 0 });
    expect(board.summary).toMatchObject({ recent: 4, failed: 2, queued: 1, held: 0, running: 0 });
    expect(board.summary.costUsd).toBeCloseTo(3.25);
  });

  it('names the payment behind a render and leaves the rest as other', async () => {
    const board = await loadRenderBoard(h.sql, renderBoardFilter({}), NOW);
    const paid = board.rows.find((row) => row.id === ids.paid)!;
    expect(paid).toMatchObject({ kind: 'payment', paymentStatus: 'refund_pending', paymentFailure: 'refund_manual', costUsd: 1.25 });
    expect(board.rows.find((row) => row.id === ids.failed)).toMatchObject({ kind: 'other', paymentStatus: null, errorCode: 'provider_timeout' });
  });

  it('never carries e-mail, photos, result files or share tokens', async () => {
    const board = await loadRenderBoard(h.sql, renderBoardFilter({}), NOW);
    const detail = await loadRenderDetail(h.sql, ids.done);
    for (const record of [...board.rows, detail!]) {
      const text = JSON.stringify(record);
      expect(text).not.toMatch(/@|secret-token|private\/(in|out|input)/);
      for (const key of ['email', 'inputKey', 'resultKey', 'shareToken']) expect(record).not.toHaveProperty(key);
    }
  });

  it('filters by status, medium and a slug or id fragment, and pages', async () => {
    const failed = await loadRenderBoard(h.sql, renderBoardFilter({ status: 'failed' }), NOW);
    expect(failed.rows.map((row) => row.id)).toEqual([ids.failed, ids.paid, ids.old]);
    const images = await loadRenderBoard(h.sql, renderBoardFilter({ medium: 'image' }), NOW);
    expect(images.rows.map((row) => row.id)).toEqual([ids.image]);
    const byId = await loadRenderBoard(h.sql, renderBoardFilter({ q: ids.done.slice(0, 8) }), NOW);
    expect(byId.rows.map((row) => row.id)).toEqual([ids.done]);
    const bySlug = await loadRenderBoard(h.sql, renderBoardFilter({ q: 'NEON-ALLEY' }), NOW);
    expect(bySlug.total).toBe(5);
    const wildcard = await loadRenderBoard(h.sql, renderBoardFilter({ q: '%' }), NOW);
    expect(wildcard.total).toBe(0);
    const page2 = await loadRenderBoard(h.sql, renderBoardFilter({ page: '2' }), NOW);
    expect(page2.rows).toEqual([]);
    expect(page2.total).toBe(5);
  });

  it('reads one render with its payment, timeline and nothing for a stranger id', async () => {
    const detail = await loadRenderDetail(h.sql, ids.paid);
    expect(detail).toMatchObject({ id: ids.paid, kind: 'payment', costSource: 'estimate', templateSlug: TEMPLATE });
    expect(detail!.payment).toMatchObject({ id: paymentId, status: 'refund_pending', failureCode: 'refund_manual', amountKrw: 3900, refundAttempts: 0 });
    const done = await loadRenderDetail(h.sql, ids.done);
    expect(done!.startedAt).not.toBeNull();
    expect(done!.finishedAt).not.toBeNull();
    expect(done!.payment).toBeNull();
    expect(await loadRenderDetail(h.sql, randomUUID())).toBeNull();
    expect(await loadRenderDetail(h.sql, "x' or '1'='1")).toBeNull();
  });

  it('lists the payments a person must handle and counts last week’s failures', async () => {
    const manual = await loadManualPayments(h.sql);
    expect(manual).toHaveLength(1);
    expect(manual[0]).toMatchObject({ id: paymentId, failureCode: 'refund_manual', amountKrw: 3900, renderId: ids.paid, renderStatus: 'failed' });
    expect(await countRecentRenderFailures(h.sql, NOW)).toBe(2);
  });
});

describe('render board addresses and tones', () => {
  it('drops unknown filter values and keeps the page in range', () => {
    expect(renderBoardFilter({ status: 'deleted', medium: 'gif', page: '-3', q: 'a'.repeat(200) })).toEqual({
      status: null,
      medium: null,
      query: 'a'.repeat(80),
      page: 1,
    });
  });

  it('goes back to page one when a filter changes and keeps the others', () => {
    const filter = renderBoardFilter({ status: 'failed', medium: 'video', q: 'neon', page: '3' });
    expect(renderBoardHref(filter, { page: 4 })).toBe('/admin/renders?status=failed&medium=video&q=neon&page=4');
    expect(renderBoardHref(filter, { status: null })).toBe('/admin/renders?medium=video&q=neon');
    expect(renderBoardHref(renderBoardFilter({}))).toBe('/admin/renders');
  });

  it('draws failure in ink and a payment someone must handle as to-do', () => {
    expect(renderTone('failed')).toBe('fail');
    expect(renderTone('held')).toBe('hold');
    expect(renderTone('running')).toBe('progress');
    expect(renderTone('succeeded')).toBe('done');
    expect(paymentTone('refund_pending', 'refund_manual')).toBe('action');
    expect(paymentTone('paid', 'fulfil_manual')).toBe('action');
    expect(paymentTone('refunded', null)).toBe('done');
    expect(paymentTone('confirming', null)).toBe('progress');
  });
});
