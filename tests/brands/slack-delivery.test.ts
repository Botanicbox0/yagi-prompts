import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readMigration } from '@/lib/db/migrations';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { freshDb, runner } from '@/tests/helpers/pglite';
import { submitBrandInquiry } from '@/lib/brands/service';
import { runBrandInquiryDeliveryPass } from '@/lib/brands/slack-delivery';
import { createSlackInquirySender, slackInquiryConfigFromEnv, type SlackInquirySender } from '@/lib/brands/slack';

const now = new Date('2026-10-07T03:00:00Z');
const good = {
  company: 'Private Company', contactName: 'Private Person', email: 'private@example.test',
  phone: '010-0000-0000', budgetBand: 'undecided', templateSlug: '', timing: '',
  message: 'This private message must stay in the admin inbox.', consent: true, locale: 'ko', website: '',
};
const webhookUrl = 'https://hooks.slack.com/services/TTEST/BTEST/test-only-secret';
const enabled = { SLACK_BRAND_INQUIRIES_ENABLED: 'on', SLACK_BRAND_INQUIRIES_WEBHOOK_URL: webhookUrl };

describe('Slack inquiry transport', () => {
  it('requires explicit server opt-in and accepts only a Slack HTTPS webhook', () => {
    expect(slackInquiryConfigFromEnv({})).toEqual({ status: 'disabled' });
    expect(slackInquiryConfigFromEnv({ SLACK_BRAND_INQUIRIES_ENABLED: 'on' })).toEqual({ status: 'unconfigured' });
    for (const url of ['http://hooks.slack.com/services/T/B/S', 'https://evil.test/services/T/B/S', 'https://hooks.slack.com.evil.test/services/T/B/S', `${webhookUrl}?secret=other`, 'https://user:secret@hooks.slack.com/services/T/B/S']) {
      expect(slackInquiryConfigFromEnv({ ...enabled, SLACK_BRAND_INQUIRIES_WEBHOOK_URL: url })).toEqual({ status: 'misconfigured' });
    }
    expect(slackInquiryConfigFromEnv(enabled)).toEqual({ status: 'configured', webhookUrl });
    for (const VERCEL_ENV of ['preview', 'development']) {
      expect(slackInquiryConfigFromEnv({ ...enabled, VERCEL_ENV })).toEqual({ status: 'disabled' });
    }
    expect(slackInquiryConfigFromEnv({ ...enabled, VERCEL_ENV: 'production' })).toEqual({ status: 'configured', webhookUrl });
  });

  it('posts only the id, fixed inquiry type and authenticated admin link; disables unfurling and redirects', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok'));
    const sender = createSlackInquirySender({ webhookUrl, fetcher });
    const outcome = await sender.send({ inquiryId: '11b533c4-93c9-4818-adf6-52f4ea368899', inquiryType: 'production' });
    expect(outcome).toEqual({ status: 'sent' });
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe(webhookUrl);
    expect(options?.redirect).toBe('error');
    const payload = JSON.parse(String(options?.body));
    expect(payload.text).toContain('11b533c4-93c9-4818-adf6-52f4ea368899');
    expect(payload.text).toContain('production');
    expect(payload.text).toContain('https://admin.twings.app/admin/inquiries');
    expect(payload).toMatchObject({ unfurl_links: false, unfurl_media: false });
    for (const value of [good.company, good.contactName, good.email, good.phone, good.message]) expect(JSON.stringify(payload)).not.toContain(value);
  });

  it('retries only a known rate-limit rejection, keeping provider errors and secrets out of the outcome', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429, headers: { 'Retry-After': '120' } }))
      .mockResolvedValueOnce(new Response(webhookUrl, { status: 403 }))
      .mockResolvedValueOnce(new Response(webhookUrl, { status: 500 }))
      .mockResolvedValueOnce(new Response('unexpected success body'))
      .mockRejectedValueOnce(new Error(`request failed ${webhookUrl}`));
    const sender = createSlackInquirySender({ webhookUrl, fetcher });
    const input = { inquiryId: '11b533c4-93c9-4818-adf6-52f4ea368899', inquiryType: 'campaign' as const };
    expect(await sender.send(input)).toEqual({ status: 'retry', code: 'rate_limited', retryAfterSeconds: 120 });
    expect(await sender.send(input)).toEqual({ status: 'failed', code: 'http_403' });
    expect(await sender.send(input)).toEqual({ status: 'uncertain', code: 'http_500' });
    expect(await sender.send(input)).toEqual({ status: 'uncertain', code: 'unexpected_response' });
    expect(await sender.send(input)).toEqual({ status: 'uncertain', code: 'transport_error' });
  });

  it('bounds hanging requests and body reads, aborts them, and marks delivery uncertain', async () => {
    let signal: AbortSignal | null | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
      signal = options?.signal;
      return new Response(new ReadableStream({ start() { /* response body never completes */ } }));
    });
    const sender = createSlackInquirySender({ webhookUrl, fetcher, timeoutMs: 20 });
    expect(await sender.send({ inquiryId: '11b533c4-93c9-4818-adf6-52f4ea368899', inquiryType: 'campaign' })).toEqual({ status: 'uncertain', code: 'timeout' });
    expect(signal?.aborted).toBe(true);
  });
});

describe('durable brand inquiry Slack delivery', () => {
  let db: PGlite;
  let sql: SqlRunner;
  beforeAll(async () => { db = await freshDb(); sql = runner(db); });
  beforeEach(async () => { await sql.query('delete from brand_inquiries'); });
  afterAll(async () => { await db.close(); });

  const enqueue = async (extra: Record<string, unknown> = {}) => {
    const result = await submitBrandInquiry({ sql, now }, { ...good, ...extra }, null);
    if (!result.ok || !result.inquiry) throw new Error('fixture inquiry failed');
    return result.inquiry;
  };
  const state = async () => (await sql.query('select * from brand_inquiry_deliveries')).rows;
  const sent = () => ({ send: vi.fn<SlackInquirySender['send']>().mockResolvedValue({ status: 'sent' }) });

  it('stores compatible defaults and atomically creates one durable notification without copying personal data', async () => {
    const inquiry = await enqueue();
    expect(inquiry).toMatchObject({ inquiryType: 'campaign', useCase: 'undecided' });
    expect(await state()).toMatchObject([{ inquiry_id: inquiry.id, status: 'pending', attempts: 0 }]);
    expect(JSON.stringify(await state())).not.toContain(good.email);
    await expect(sql.query('insert into brand_inquiry_deliveries (inquiry_id) values ($1)', [inquiry.id])).rejects.toThrow();
    await sql.query('delete from brand_inquiries where id = $1', [inquiry.id]);
    expect(await state()).toEqual([]);
  });

  it('rolls back inquiry acceptance if durable enqueue fails', async () => {
    await db.exec(`create function test_reject_delivery() returns trigger language plpgsql as $$ begin raise exception 'fixture enqueue failure'; end $$;
      create trigger test_reject_delivery before insert on brand_inquiry_deliveries for each row execute function test_reject_delivery();`);
    try {
      await expect(enqueue()).rejects.toThrow('fixture enqueue failure');
      expect((await sql.query('select id from brand_inquiries')).rows).toEqual([]);
    } finally {
      await db.exec('drop trigger test_reject_delivery on brand_inquiry_deliveries; drop function test_reject_delivery();');
    }
  });

  it('stores explicit intent, validates selections, and drops honeypots without enqueueing', async () => {
    expect(await enqueue({ inquiryType: 'filter', useCase: 'beauty_fashion' })).toMatchObject({ inquiryType: 'filter', useCase: 'beauty_fashion' });
    expect(await submitBrandInquiry({ sql }, { ...good, inquiryType: 'injected' }, null)).toMatchObject({ ok: false, field: 'inquiryType' });
    expect(await submitBrandInquiry({ sql }, { ...good, useCase: 'injected' }, null)).toMatchObject({ ok: false, field: 'useCase' });
    expect(await submitBrandInquiry({ sql }, { ...good, website: 'spam' }, null)).toEqual({ ok: true, inquiry: null });
    expect(await state()).toHaveLength(1);
  });

  it('deduplicates concurrent submissions and returns the original before applying the daily cap', async () => {
    const requestId = 'ee9f8d1a-23ed-43a2-bad1-23bec6fe0525';
    const results = await Promise.all([1, 2].map(() => submitBrandInquiry({ sql }, { ...good, requestId }, null)));
    expect(results.every(result => result.ok && result.inquiry)).toBe(true);
    expect(new Set(results.map(result => result.ok ? result.inquiry?.id : null)).size).toBe(1);
    expect(results.filter(result => result.ok && result.replayed)).toHaveLength(1);
    await enqueue();
    await enqueue();
    const replay = await submitBrandInquiry({ sql }, { ...good, requestId }, null);
    expect(replay).toMatchObject({ ok: true, replayed: true });
    expect(await state()).toHaveLength(3);
  });

  it('keeps the pending record untouched when the server transport is unconfigured', async () => {
    await enqueue();
    expect(await runBrandInquiryDeliveryPass({ sql, sender: null, configuration: 'unconfigured', now })).toMatchObject({ configuration: 'unconfigured', claimed: 0, sent: 0 });
    expect(await state()).toMatchObject([{ status: 'pending', attempts: 0 }]);
  });

  it('claims only once across concurrent workers and subsequent retries', async () => {
    const inquiry = await enqueue({ inquiryType: 'production' });
    const sender = sent();
    const reports = await Promise.all([1, 2].map(() => runBrandInquiryDeliveryPass({ sql, sender, now })));
    expect(reports.reduce((n, r) => n + r.sent, 0)).toBe(1);
    expect(sender.send).toHaveBeenCalledExactlyOnceWith({ inquiryId: inquiry.id, inquiryType: 'production' });
    expect(await runBrandInquiryDeliveryPass({ sql, sender, now })).toMatchObject({ claimed: 0 });
    expect(await state()).toMatchObject([{ status: 'sent', attempts: 1 }]);
  });

  it('waits for Retry-After, then retries the same inquiry without duplicating the outbox row', async () => {
    await enqueue();
    const sender = { send: vi.fn<SlackInquirySender['send']>()
      .mockResolvedValueOnce({ status: 'retry', code: 'rate_limited', retryAfterSeconds: 120 })
      .mockResolvedValue({ status: 'sent' }) };
    expect(await runBrandInquiryDeliveryPass({ sql, sender, now })).toMatchObject({ deferred: 1 });
    expect(await runBrandInquiryDeliveryPass({ sql, sender, now: new Date(now.getTime() + 60_000) })).toMatchObject({ claimed: 0 });
    expect(await runBrandInquiryDeliveryPass({ sql, sender, now: new Date(now.getTime() + 120_000) })).toMatchObject({ sent: 1 });
    expect(sender.send).toHaveBeenCalledTimes(2);
    expect(await state()).toMatchObject([{ status: 'sent', attempts: 2 }]);
  });

  it('quarantines timeouts and abandoned claims so automatic recovery cannot duplicate a possible receipt', async () => {
    await enqueue();
    const sender = { send: vi.fn<SlackInquirySender['send']>().mockResolvedValue({ status: 'uncertain', code: 'timeout' }) };
    expect(await runBrandInquiryDeliveryPass({ sql, sender, now })).toMatchObject({ uncertain: 1 });
    expect(await runBrandInquiryDeliveryPass({ sql, sender, now: new Date(now.getTime() + 600_000) })).toMatchObject({ claimed: 0 });
    await enqueue({ email: 'second@example.test' });
    await sql.query("update brand_inquiry_deliveries set status = 'sending', claimed_at = $1, attempts = 1, claim_token = gen_random_uuid() where status = 'pending'", [now.toISOString()]);
    expect(await runBrandInquiryDeliveryPass({ sql, sender, now: new Date(now.getTime() + 600_000) })).toMatchObject({ recoveredUncertain: 1, claimed: 0 });
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect((await state()).every(row => row.status === 'uncertain')).toBe(true);
  });

  it('leaves an accepted but unrecorded Slack receipt sending until recovery, never reposting it', async () => {
    await enqueue();
    const sender = sent();
    const faultySql: SqlRunner = { ...sql, query: async (text, params) => {
      if (text.includes('set status = $3')) throw new Error('DB disconnected after send');
      return sql.query(text, params);
    } };
    await expect(runBrandInquiryDeliveryPass({ sql: faultySql, sender, now })).rejects.toThrow('DB disconnected');
    expect(await runBrandInquiryDeliveryPass({ sql, sender, now: new Date(now.getTime() + 600_000) })).toMatchObject({ recoveredUncertain: 1, claimed: 0 });
    expect(sender.send).toHaveBeenCalledTimes(1);
  });

  it('denies browser roles both inquiry and delivery access', async () => {
    await db.exec('create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;');
    await db.exec(readMigration('0125_glue_brand_inquiry_delivery_rls.sql'));
    await enqueue();
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      try { await expect(sql.query('select * from brand_inquiry_deliveries')).rejects.toThrow(/permission denied/); }
      finally { await db.exec('reset role'); }
    }
  });
});
