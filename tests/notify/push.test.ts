import webPush from 'web-push';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import type { SqlRunner } from '@/lib/db/sql-runner';
import {
  createWebPushSender,
  isAllowedPushEndpoint,
  listActivePushSubscriptions,
  parsePushEndpoint,
  parsePushSubscription,
  pushConfigFromEnv,
  pushPublicKey,
  revokePushSubscription,
  savePushSubscription,
  sendPushToUser,
  type PushMessage,
  type WebPushLike,
} from '@/lib/notify/push';
import { freshDb, runner } from '@/tests/helpers/pglite';
import { testPushKeys } from '@/tests/helpers/push';

/**
 * docs/PLATFORM-2.0.md §5.3 — the push wire. Keys come from the environment or push is quietly
 * off; a subscription is only ever an endpoint at a real push service; a 404/410 retires the
 * device; one delivered device is a delivered message.
 */

const KEYS = webPush.generateVAPIDKeys();
const ENV = { WEB_PUSH_PUBLIC_KEY: KEYS.publicKey, WEB_PUSH_PRIVATE_KEY: KEYS.privateKey, WEB_PUSH_SUBJECT: 'mailto:hello@twings.app' };
const { p256dh: P256DH, auth: AUTH } = testPushKeys();
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const MESSAGE: PushMessage = { title: '완성됐어요', body: '결과물이 준비됐어요.', url: '/renders/abc', tag: 'render-abc', topic: 'abc', lang: 'ko' };

const endpoint = (id: string) => `https://fcm.googleapis.com/fcm/send/${id}`;

describe('push configuration (all three keys, or push is off)', () => {
  it('reads the VAPID pair and the contact subject', () => {
    expect(pushConfigFromEnv(ENV)).toEqual({ publicKey: KEYS.publicKey, privateKey: KEYS.privateKey, subject: 'mailto:hello@twings.app' });
    expect(pushPublicKey(ENV)).toBe(KEYS.publicKey);
  });

  it('is off when any key is missing, blank or malformed', () => {
    expect(pushConfigFromEnv({})).toBeNull();
    expect(pushConfigFromEnv({ ...ENV, WEB_PUSH_PRIVATE_KEY: '' })).toBeNull();
    expect(pushConfigFromEnv({ ...ENV, WEB_PUSH_SUBJECT: undefined })).toBeNull();
    expect(pushConfigFromEnv({ ...ENV, WEB_PUSH_PUBLIC_KEY: 'not-a-key' })).toBeNull();
    expect(pushConfigFromEnv({ ...ENV, WEB_PUSH_PRIVATE_KEY: KEYS.publicKey })).toBeNull();
    expect(pushPublicKey({})).toBeNull();
  });

  it('accepts only a mailto: or https: subject, the two web-push allows', () => {
    expect(pushConfigFromEnv({ ...ENV, WEB_PUSH_SUBJECT: 'https://twings.app' })).not.toBeNull();
    expect(pushConfigFromEnv({ ...ENV, WEB_PUSH_SUBJECT: 'hello@twings.app' })).toBeNull();
    expect(pushConfigFromEnv({ ...ENV, WEB_PUSH_SUBJECT: 'http://twings.app' })).toBeNull();
  });
});

describe('subscription input (bounded, push services only)', () => {
  it('admits the push services the browsers actually use', () => {
    for (const url of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/QGuQyavXutnMH',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
    ]) expect(isAllowedPushEndpoint(url), url).toBe(true);
  });

  it('refuses anything that would make the server post somewhere else', () => {
    for (const url of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://localhost/fcm/send/abc',
      'https://169.254.169.254/latest/meta-data',
      'https://fcm.googleapis.com.evil.example/x',
      'https://user:pass@fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com:8443/fcm/send/abc',
      'not a url',
    ]) expect(isAllowedPushEndpoint(url), url).toBe(false);
  });

  it('parses PushSubscription.toJSON() and nothing looser', () => {
    expect(parsePushSubscription({ endpoint: endpoint('a'), expirationTime: null, keys: { p256dh: P256DH, auth: AUTH } })).toEqual({ endpoint: endpoint('a'), p256dh: P256DH, auth: AUTH });
    expect(parsePushSubscription({ endpoint: endpoint('a'), keys: { p256dh: P256DH } })).toBeNull();
    expect(parsePushSubscription({ endpoint: 'https://evil.example/x', keys: { p256dh: P256DH, auth: AUTH } })).toBeNull();
    expect(parsePushSubscription({ endpoint: endpoint('a'), keys: { p256dh: 'has spaces', auth: AUTH } })).toBeNull();
    expect(parsePushSubscription({ endpoint: endpoint('x'.repeat(3000)), keys: { p256dh: P256DH, auth: AUTH } })).toBeNull();
    expect(parsePushSubscription('nope')).toBeNull();
    expect(parsePushEndpoint({ endpoint: endpoint('a') })).toBe(endpoint('a'));
    expect(parsePushEndpoint({ endpoint: 42 })).toBeNull();
  });
});

describe('subscriptions on a real database', () => {
  let db: PGlite;
  let sql: SqlRunner;

  beforeEach(async () => {
    db = await freshDb();
    sql = runner(db);
    for (const id of [USER, OTHER]) {
      await sql.query('insert into auth.users (id) values ($1)', [id]);
      await sql.query(`insert into profiles (id, email, locale) values ($1, $2, 'ko')`, [id, `${id.slice(0, 4)}@twings.test`]);
    }
  });
  afterEach(async () => db.close());

  it('upserts by endpoint: one row per device, keys refreshed, revocation undone', async () => {
    await savePushSubscription(sql, USER, { endpoint: endpoint('a'), p256dh: P256DH, auth: AUTH }, 'Mozilla/5.0 (iPhone)');
    await revokePushSubscription(sql, USER, endpoint('a'));
    const refreshed = testPushKeys().auth;
    await savePushSubscription(sql, USER, { endpoint: endpoint('a'), p256dh: P256DH, auth: refreshed }, 'Mozilla/5.0 (iPhone)');
    const { rows } = await sql.query<{ auth: string; revoked_at: Date | null; user_agent: string }>('select auth, revoked_at, user_agent from push_subscriptions');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ auth: refreshed, revoked_at: null, user_agent: 'Mozilla/5.0 (iPhone)' });
  });

  it('moves a device to whoever subscribes it now (a shared browser after a sign-out)', async () => {
    await savePushSubscription(sql, USER, { endpoint: endpoint('a'), p256dh: P256DH, auth: AUTH }, null);
    await savePushSubscription(sql, OTHER, { endpoint: endpoint('a'), p256dh: P256DH, auth: AUTH }, null);
    expect(await listActivePushSubscriptions(sql, USER)).toEqual([]);
    expect((await listActivePushSubscriptions(sql, OTHER)).map((s) => s.endpoint)).toEqual([endpoint('a')]);
  });

  it('lets only the owner revoke, and keeps the row for the record', async () => {
    await savePushSubscription(sql, USER, { endpoint: endpoint('a'), p256dh: P256DH, auth: AUTH }, null);
    expect(await revokePushSubscription(sql, OTHER, endpoint('a'))).toBe(0);
    expect(await revokePushSubscription(sql, USER, endpoint('a'))).toBe(1);
    expect(await revokePushSubscription(sql, USER, endpoint('a'))).toBe(0);
    expect(await listActivePushSubscriptions(sql, USER)).toEqual([]);
    const { rows } = await sql.query<{ n: number }>('select count(*)::int as n from push_subscriptions');
    expect(rows[0]!.n).toBe(1);
  });

  it('trims a hostile user agent to a bounded, printable line', async () => {
    await savePushSubscription(sql, USER, { endpoint: endpoint('a'), p256dh: P256DH, auth: AUTH }, `x\u0000y${'z'.repeat(2000)}`);
    const { rows } = await sql.query<{ user_agent: string }>('select user_agent from push_subscriptions');
    expect(rows[0]!.user_agent.length).toBeLessThanOrEqual(512);
    expect(rows[0]!.user_agent).not.toContain('\u0000');
  });

  describe('fan-out through an injected web-push', () => {
    const fake = (outcomes: Record<string, number | 'network'>) => {
      const calls: Array<{ endpoint: string; payload: string; options: Record<string, unknown> }> = [];
      const lib: WebPushLike = {
        async sendNotification(subscription, payload, options) {
          calls.push({ endpoint: subscription.endpoint, payload, options: options as unknown as Record<string, unknown> });
          const outcome = outcomes[subscription.endpoint] ?? 201;
          if (outcome === 'network') throw new Error('socket hang up');
          if (outcome >= 300) throw Object.assign(new Error('Received unexpected response code'), { statusCode: outcome });
          return { statusCode: outcome };
        },
      };
      return { lib, calls };
    };

    beforeEach(async () => {
      for (const id of ['ok', 'gone', 'missing', 'busy']) {
        await savePushSubscription(sql, USER, { endpoint: endpoint(id), p256dh: P256DH, auth: AUTH }, null);
      }
    });

    it('sends the message to every live device with the VAPID keys and a 24h TTL', async () => {
      const { lib, calls } = fake({});
      const sender = createWebPushSender(pushConfigFromEnv(ENV)!, lib);
      const fanout = await sendPushToUser({ sql, sender }, USER, MESSAGE);
      expect(fanout).toMatchObject({ attempted: 4, sent: 4, revoked: 0, failed: 0 });
      expect(calls).toHaveLength(4);
      const call = calls[0]!;
      expect(JSON.parse(call.payload)).toEqual({ title: '완성됐어요', body: '결과물이 준비됐어요.', url: '/renders/abc', tag: 'render-abc', lang: 'ko' });
      expect(call.options).toMatchObject({ TTL: 86_400, urgency: 'normal', topic: 'abc', vapidDetails: { publicKey: KEYS.publicKey, privateKey: KEYS.privateKey, subject: 'mailto:hello@twings.app' } });
    });

    it('retires a device the push service no longer knows (410, 404) and counts the rest', async () => {
      const { lib } = fake({ [endpoint('gone')]: 410, [endpoint('missing')]: 404, [endpoint('busy')]: 503 });
      const fanout = await sendPushToUser({ sql, sender: createWebPushSender(pushConfigFromEnv(ENV)!, lib) }, USER, MESSAGE);
      expect(fanout).toMatchObject({ attempted: 4, sent: 1, revoked: 2, failed: 1, retryable: true });
      expect((await listActivePushSubscriptions(sql, USER)).map((s) => s.endpoint).sort()).toEqual([endpoint('busy'), endpoint('ok')]);
      expect(fanout.errors.join(' ')).not.toContain('fcm.googleapis.com/fcm/send');
    });

    it('calls a 4xx final and a network failure retryable', async () => {
      await revokePushSubscription(sql, USER, endpoint('ok'));
      await revokePushSubscription(sql, USER, endpoint('gone'));
      await revokePushSubscription(sql, USER, endpoint('missing'));
      const final = await sendPushToUser({ sql, sender: createWebPushSender(pushConfigFromEnv(ENV)!, fake({ [endpoint('busy')]: 400 }).lib) }, USER, MESSAGE);
      expect(final).toMatchObject({ attempted: 1, sent: 0, failed: 1, retryable: false });
      const flaky = await sendPushToUser({ sql, sender: createWebPushSender(pushConfigFromEnv(ENV)!, fake({ [endpoint('busy')]: 'network' }).lib) }, USER, MESSAGE);
      expect(flaky).toMatchObject({ attempted: 1, sent: 0, failed: 1, retryable: true });
    });

    it('sends nothing to a user with no live device', async () => {
      const { lib, calls } = fake({});
      const fanout = await sendPushToUser({ sql, sender: createWebPushSender(pushConfigFromEnv(ENV)!, lib) }, OTHER, MESSAGE);
      expect(fanout).toMatchObject({ attempted: 0, sent: 0 });
      expect(calls).toEqual([]);
    });
  });
});

describe('the live sender wraps the pinned web-push', () => {
  it('uses the real library by default', () => {
    const spy = vi.spyOn(webPush, 'sendNotification');
    const sender = createWebPushSender(pushConfigFromEnv(ENV)!);
    expect(sender.kind).toBe('web-push');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
