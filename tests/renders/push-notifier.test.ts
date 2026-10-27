import webPush from 'web-push';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { interpolate } from '@/lib/i18n/format';
import { createWebPushSender, pushConfigFromEnv, savePushSubscription, type WebPushLike } from '@/lib/notify/push';
import {
  createPushRenderNotifier,
  getRenderNotifier,
  renderPushMessage,
  withPushNotifier,
  type RenderNotifier,
  type RenderNotifyInput,
} from '@/lib/renders/notify';
import { loadRenderJob, type RenderJob } from '@/lib/renders/repo';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';
import { testPushKeys } from '@/tests/helpers/push';

/**
 * docs/PLATFORM-2.0.md §5.3 — the `push` channel of `RenderNotifier`. Email always goes; push is
 * added for a reader with a live device. One delivered device makes the message sent, a 410/404
 * retires the device, and with no keys the push half simply does not exist.
 */

const KEYS = webPush.generateVAPIDKeys();
const ENV = { WEB_PUSH_PUBLIC_KEY: KEYS.publicKey, WEB_PUSH_PRIVATE_KEY: KEYS.privateKey, WEB_PUSH_SUBJECT: 'mailto:hello@twings.app' };
const USER = '33333333-3333-4333-8333-333333333333';
const { p256dh: P256DH, auth: AUTH } = testPushKeys();
const endpoint = (id: string) => `https://fcm.googleapis.com/fcm/send/${id}`;

function fakeWebPush(outcomes: Record<string, number> = {}) {
  const payloads: Array<{ endpoint: string; body: Record<string, unknown>; topic: unknown }> = [];
  const lib: WebPushLike = {
    async sendNotification(subscription, payload, options) {
      payloads.push({ endpoint: subscription.endpoint, body: JSON.parse(payload) as Record<string, unknown>, topic: options.topic });
      const status = outcomes[subscription.endpoint] ?? 201;
      if (status >= 300) throw Object.assign(new Error('Received unexpected response code'), { statusCode: status });
      return { statusCode: status };
    },
  };
  return { lib, payloads };
}

function fakeEmail(outcome: Awaited<ReturnType<RenderNotifier['send']>>): RenderNotifier & { calls: number } {
  const notifier = { channel: 'email' as const, kind: 'fake', calls: 0, async send() { notifier.calls += 1; return outcome; } };
  return notifier;
}

describe('the push channel of RenderNotifier', () => {
  let harness: PromptHarness;
  let sql: SqlRunner;
  let job: RenderJob;

  const input = (overrides: Partial<RenderJob> = {}, locale: 'ko' | 'en' = 'ko', failureReason: string | null = null): RenderNotifyInput => ({
    job: { ...job, ...overrides },
    templateTitle: '네온 골목 돌리',
    recipient: { email: null, locale },
    failureReason,
    siteUrl: 'https://twings.test',
    siteName: 'TWINGS',
  });

  beforeEach(async () => {
    harness = await promptHarness();
    sql = harness.sql;
    await sql.query('insert into auth.users (id) values ($1)', [USER]);
    // An email-less Kakao account: exactly the reader push exists for.
    await sql.query(`insert into profiles (id, email, locale) values ($1, null, 'ko')`, [USER]);
    const template = (await sql.query<{ id: string; slug: string }>(`select id, slug from prompt_items order by slug limit 1`)).rows[0]!;
    const inserted = await sql.query<{ id: string }>(
      `insert into render_jobs (user_id, template_id, template_slug, medium, engine, aspect, locale)
       values ($1, $2, $3, 'video', 'seedance-2.0', '9:16', 'ko') returning id`,
      [USER, template.id, template.slug],
    );
    job = (await loadRenderJob(sql, inserted.rows[0]!.id))!;
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await harness.close();
  });

  it('words the message from the dictionary and links the owner page', () => {
    const ready = renderPushMessage(input({ status: 'succeeded' }));
    const ko = getDictionary('ko').appShell.push;
    expect(ready).toEqual({
      title: ko.readyTitle,
      body: interpolate(ko.readyBody, { template: '네온 골목 돌리' }),
      url: `/renders/${job.id}`,
      tag: `render-${job.id}`,
      topic: job.id.replace(/-/g, ''),
      lang: 'ko',
    });
    expect(ready.topic).toHaveLength(32);
    const failed = renderPushMessage(input({ status: 'failed', errorCode: 'moderated' }, 'en', 'The provider declined this photo.'));
    const en = getDictionary('en').appShell.push;
    expect(failed.title).toBe(en.failedTitle);
    expect(failed.body).toBe(interpolate(en.failedBody, { template: '네온 골목 돌리', reason: 'The provider declined this photo.' }));
    expect(failed.body).toContain('The provider declined this photo.');
  });

  it('sends to every live device of the job owner and records push as the channel that reached them', async () => {
    await savePushSubscription(sql, USER, { endpoint: endpoint('phone'), p256dh: P256DH, auth: AUTH }, null);
    await savePushSubscription(sql, USER, { endpoint: endpoint('old-phone'), p256dh: P256DH, auth: AUTH }, null);
    const { lib, payloads } = fakeWebPush({ [endpoint('old-phone')]: 410 });
    const push = createPushRenderNotifier({ sql, sender: createWebPushSender(pushConfigFromEnv(ENV)!, lib) });
    expect(push.channel).toBe('push');

    const outcome = await push.send(input({ status: 'succeeded' }));
    expect(outcome.ok).toBe(true);
    expect(payloads.map((p) => p.endpoint).sort()).toEqual([endpoint('old-phone'), endpoint('phone')]);
    expect(payloads[0]!.body.url).toBe(`/renders/${job.id}`);
    // 410 retired the old phone; the delivered one recorded the channel on the job.
    const subs = (await sql.query<{ endpoint: string; revoked: boolean }>('select endpoint, revoked_at is not null as revoked from push_subscriptions order by endpoint')).rows;
    expect(subs).toEqual([{ endpoint: endpoint('old-phone'), revoked: true }, { endpoint: endpoint('phone'), revoked: false }]);
    expect((await loadRenderJob(sql, job.id))!.notifyChannel).toBe('push');
  });

  it('is a skip, not a failure, for a reader with no live device', async () => {
    const { lib, payloads } = fakeWebPush();
    const push = createPushRenderNotifier({ sql, sender: createWebPushSender(pushConfigFromEnv(ENV)!, lib) });
    expect(await push.deliver(input({ status: 'succeeded' }))).toMatchObject({ status: 'skipped' });
    expect(payloads).toEqual([]);
    expect((await loadRenderJob(sql, job.id))!.notifyChannel).toBe('email');
  });

  it('degrades to a skip when the push table is not there yet (before 0053 reaches the cloud)', async () => {
    await sql.query('drop table push_subscriptions');
    const push = createPushRenderNotifier({ sql, sender: createWebPushSender(pushConfigFromEnv(ENV)!, fakeWebPush().lib) });
    expect(await push.deliver(input({ status: 'succeeded' }))).toMatchObject({ status: 'skipped' });
  });

  describe('email always, push in addition', () => {
    const live = async () => {
      await savePushSubscription(sql, USER, { endpoint: endpoint('phone'), p256dh: P256DH, auth: AUTH }, null);
    };
    const pushWith = (outcomes: Record<string, number> = {}) => createPushRenderNotifier({ sql, sender: createWebPushSender(pushConfigFromEnv(ENV)!, fakeWebPush(outcomes).lib) });

    it('leaves the email outcome untouched when push has nothing to do', async () => {
      const email = fakeEmail({ ok: false, retryable: false, error: 'the profile has no email' });
      const combined = withPushNotifier(email, pushWith());
      expect(await combined.send(input({ status: 'succeeded' }))).toEqual({ ok: false, retryable: false, error: 'the profile has no email' });
      expect(email.calls).toBe(1);
      expect(combined.channel).toBe('email');
    });

    it('still emails when push also lands, and the job reads as sent', async () => {
      await live();
      const email = fakeEmail({ ok: true, id: 'email-1' });
      expect(await withPushNotifier(email, pushWith()).send(input({ status: 'succeeded' }))).toEqual({ ok: true, id: 'email-1' });
      expect(email.calls).toBe(1);
    });

    it('keeps the email outcome when push fails beside it, but leaves a trace in the logs', async () => {
      await live();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const outcome = await withPushNotifier(fakeEmail({ ok: true, id: 'email-2' }), pushWith({ [endpoint('phone')]: 503 })).send(input({ status: 'succeeded' }));
      expect(outcome).toEqual({ ok: true, id: 'email-2' });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`${job.id}: push — push: HTTP 503`));
      warn.mockRestore();
    });

    it('reaches an email-less Kakao reader through push alone', async () => {
      await live();
      const outcome = await withPushNotifier(fakeEmail({ ok: false, retryable: false, error: 'the profile has no email' }), pushWith()).send(input({ status: 'succeeded' }));
      expect(outcome.ok).toBe(true);
    });

    it('fails only when neither wire reached the reader, retrying if either could', async () => {
      await live();
      const outcome = await withPushNotifier(fakeEmail({ ok: false, retryable: false, error: 'the profile has no email' }), pushWith({ [endpoint('phone')]: 503 })).send(input({ status: 'failed', errorCode: 'engine_error' }, 'ko', '엔진 오류'));
      expect(outcome).toMatchObject({ ok: false, retryable: true });
      expect(outcome.ok === false && outcome.error).toContain('the profile has no email');
      expect(outcome.ok === false && outcome.error).toContain('push: HTTP 503');
      expect(outcome.ok === false && outcome.error).not.toContain('push: push');
    });
  });

  describe('getRenderNotifier', () => {
    beforeEach(() => vi.stubEnv('PLAYBOOK_FAKE_MAILER', '1'));

    it('is email only without VAPID keys — push stays silently off', () => {
      const notifier = getRenderNotifier(sql, {});
      expect(notifier?.channel).toBe('email');
      expect(notifier?.kind).toBe('fake');
    });

    it('adds push when the keys are set and a database is at hand', () => {
      expect(getRenderNotifier(sql, ENV)?.kind).toBe('fake+push:web-push');
      expect(getRenderNotifier(null, ENV)?.kind).toBe('fake');
    });

    it('is still null without a mailer: push never replaces the email it rides with', () => {
      vi.stubEnv('PLAYBOOK_FAKE_MAILER', '');
      vi.stubEnv('RESEND_API_KEY', '');
      expect(getRenderNotifier(sql, ENV)).toBeNull();
    });
  });
});
