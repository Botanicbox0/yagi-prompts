import webPush from 'web-push';
import { z } from 'zod';
import type { SqlRunner } from '@/lib/db/sql-runner';

/**
 * The completion push — docs/PLATFORM-2.0.md §5.3 (2026-10-22).
 *
 * The installed app (PWA) is the app, and a render that takes minutes ends in a push to every
 * device that said yes on "완성되면 알려드릴까요?". Same seam as the mailer (lib/notify/mailer.ts):
 * the wire is the pinned `web-push` behind `PushSender`, tests inject a fake web-push at that seam,
 * and an unconfigured deployment is inert, never half-working — without all three keys push is
 * simply off and the app says so.
 *
 *   WEB_PUSH_PUBLIC_KEY / WEB_PUSH_PRIVATE_KEY  the VAPID pair (`npx web-push generate-vapid-keys`)
 *   WEB_PUSH_SUBJECT                            `mailto:` contact the push services can reach
 *
 * Only the public key ever reaches a browser (it is what `pushManager.subscribe` needs). No
 * `server-only` guard, like the mailer: tests and the render pass import this directly. Never import
 * it from a client component — it reads the private key and carries web-push.
 */

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** A day: a phone that is off overnight still hears about the render in the morning. */
export const PUSH_TTL_SECONDS = 86_400;
/** A subscription is ~600 bytes of JSON; anything near this is not one. */
export const PUSH_BODY_MAX_BYTES = 4_096;
/** Bounded fan-out: nobody has more phones than this, and each send can wait up to the timeout. */
const MAX_DEVICES = 20;
const SEND_TIMEOUT_MS = 10_000;

function base64UrlBytes(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return null;
  return Buffer.from(value.replace(/=+$/, ''), 'base64url');
}

function validSubject(subject: string): boolean {
  try {
    const url = new URL(subject);
    if (url.protocol === 'mailto:') return subject.includes('@');
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** All three, well formed, or null: a half-set environment is an unconfigured one. */
export function pushConfigFromEnv(env: Record<string, string | undefined> = process.env): PushConfig | null {
  const publicKey = env.WEB_PUSH_PUBLIC_KEY?.trim() ?? '';
  const privateKey = env.WEB_PUSH_PRIVATE_KEY?.trim() ?? '';
  const subject = env.WEB_PUSH_SUBJECT?.trim() ?? '';
  if (!publicKey || !privateKey || !subject) return null;
  // An uncompressed P-256 point and a 32-byte scalar; anything else fails every send.
  const pub = base64UrlBytes(publicKey);
  const priv = base64UrlBytes(privateKey);
  if (pub === null || pub.length !== 65 || pub[0] !== 0x04 || priv === null || priv.length !== 32) return null;
  if (!validSubject(subject)) return null;
  return { publicKey, privateKey, subject };
}

/** What a page hands the browser: the public key, or null when push is off here. */
export function pushPublicKey(env: Record<string, string | undefined> = process.env): string | null {
  return pushConfigFromEnv(env)?.publicKey ?? null;
}

// ---------------------------------------------------------------------------
// subscription input
// ---------------------------------------------------------------------------

/**
 * The push services the browsers subscribe through. The server POSTs to whatever endpoint is
 * stored, so an endpoint anywhere else (an internal address, someone's own server) is refused at
 * the door rather than trusted because it arrived inside a well-formed subscription.
 */
const PUSH_SERVICE_HOSTS = new Set(['fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com']);
const PUSH_SERVICE_SUFFIXES = ['.push.services.mozilla.com', '.push.apple.com', '.notify.windows.com'];

export function isAllowedPushEndpoint(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.has(host) || PUSH_SERVICE_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

const base64url = (min: number, max: number) => z.string().min(min).max(max).regex(/^[A-Za-z0-9_-]+={0,2}$/);
const endpointSchema = z.string().min(9).max(2048).refine(isAllowedPushEndpoint);

/** `PushSubscription.toJSON()` — `{ endpoint, expirationTime, keys: { p256dh, auth } }`. */
const subscriptionSchema = z.object({
  endpoint: endpointSchema,
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: base64url(80, 100), auth: base64url(16, 32) }),
});

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function parsePushSubscription(value: unknown): PushSubscriptionInput | null {
  const parsed = subscriptionSchema.safeParse(value);
  if (!parsed.success) return null;
  return { endpoint: parsed.data.endpoint, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth };
}

/** The DELETE body: `{ endpoint }`. */
export function parsePushEndpoint(value: unknown): string | null {
  const parsed = z.object({ endpoint: endpointSchema }).safeParse(value);
  return parsed.success ? parsed.data.endpoint : null;
}

/** For the record only — never a decision input. Printable, one line, bounded. */
function cleanUserAgent(raw: string | null): string | null {
  if (raw === null) return null;
  const line = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 512);
  return line || null;
}

// ---------------------------------------------------------------------------
// storage (push_subscriptions, 0053)
// ---------------------------------------------------------------------------

/**
 * Upsert by endpoint. The same device subscribing again refreshes its keys and comes back from a
 * revocation; a device subscribed under another account (a shared browser after a sign-out) moves
 * to whoever is signed in and subscribing now.
 */
export async function savePushSubscription(sql: SqlRunner, userId: string, input: PushSubscriptionInput, userAgent: string | null, now: Date = new Date()): Promise<void> {
  await sql.query(
    `insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, created_at, last_seen_at)
     values ($1, $2, $3, $4, $5, $6, $6)
     on conflict (endpoint) do update
        set user_id = excluded.user_id,
            p256dh = excluded.p256dh,
            auth = excluded.auth,
            user_agent = excluded.user_agent,
            last_seen_at = excluded.last_seen_at,
            revoked_at = null`,
    [userId, input.endpoint, input.p256dh, input.auth, cleanUserAgent(userAgent), now],
  );
}

/** Turning push off: the owner's live row gets `revoked_at`. Returns how many rows changed (0 or 1). */
export async function revokePushSubscription(sql: SqlRunner, userId: string, endpoint: string, now: Date = new Date()): Promise<number> {
  const { rows } = await sql.query<{ id: string }>(
    `update push_subscriptions set revoked_at = $3
      where endpoint = $1 and user_id = $2 and revoked_at is null
      returning id`,
    [endpoint, userId, now],
  );
  return rows.length;
}

export interface StoredPushSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function listActivePushSubscriptions(sql: SqlRunner, userId: string): Promise<StoredPushSubscription[]> {
  const { rows } = await sql.query<StoredPushSubscription>(
    `select id, endpoint, p256dh, auth from push_subscriptions
      where user_id = $1 and revoked_at is null
      order by last_seen_at desc
      limit ${MAX_DEVICES}`,
    [userId],
  );
  return rows;
}

async function retirePushSubscription(sql: SqlRunner, id: string, now: Date): Promise<void> {
  await sql.query('update push_subscriptions set revoked_at = $2 where id = $1 and revoked_at is null', [id, now]);
}

// ---------------------------------------------------------------------------
// the wire
// ---------------------------------------------------------------------------

/** What the service worker shows (public/sw.js). `topic` travels as a header, not in the payload. */
export interface PushMessage {
  title: string;
  body: string;
  /** Same-origin path the tap opens — `/renders/{id}`. */
  url: string;
  /** Per render, so a resend replaces the notification instead of stacking. */
  tag: string;
  /** ≤32 URL-safe characters: an undelivered older message with the same topic is replaced. */
  topic?: string;
  lang?: string;
}

/** The slice of the pinned `web-push` the sender calls — what tests replace with a fake. */
export interface WebPushLike {
  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options: {
      vapidDetails: { subject: string; publicKey: string; privateKey: string };
      TTL: number;
      urgency: 'normal' | 'high';
      topic?: string;
      timeout: number;
    },
  ): Promise<{ statusCode: number }>;
}

export type PushAttempt = { ok: true } | { ok: false; statusCode: number | null; error: string };

export interface PushSender {
  /** Which implementation answered — printed by the render pass, like the mailer's kind. */
  readonly kind: string;
  send(target: StoredPushSubscription, message: PushMessage): Promise<PushAttempt>;
}

export function createWebPushSender(config: PushConfig, lib: WebPushLike = webPush, kind = 'web-push'): PushSender {
  return {
    kind,
    async send(target, message) {
      const payload = JSON.stringify({ title: message.title, body: message.body, url: message.url, tag: message.tag, lang: message.lang });
      try {
        await lib.sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          payload,
          {
            vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
            TTL: PUSH_TTL_SECONDS,
            urgency: 'normal',
            topic: message.topic,
            timeout: SEND_TIMEOUT_MS,
          },
        );
        return { ok: true };
      } catch (error) {
        const status = (error as { statusCode?: unknown } | null)?.statusCode;
        const statusCode = typeof status === 'number' ? status : null;
        // Never the endpoint in the message: it is a capability, and errors end up in logs.
        return { ok: false, statusCode, error: statusCode === null ? `push: ${(error as Error)?.message ?? 'network error'}` : `push: HTTP ${statusCode}` };
      }
    },
  };
}

export interface PushFanout {
  /** Live devices the message was sent to. */
  attempted: number;
  sent: number;
  /** Devices the push service no longer knows (404/410), now revoked. */
  revoked: number;
  failed: number;
  /** A failure that a later attempt could fix (network, 429, 5xx). */
  retryable: boolean;
  errors: string[];
}

/** Send one message to every live device of one person. 404/410 retire the device on the spot. */
export async function sendPushToUser(deps: { sql: SqlRunner; sender: PushSender; now?: Date }, userId: string, message: PushMessage): Promise<PushFanout> {
  const now = deps.now ?? new Date();
  const targets = await listActivePushSubscriptions(deps.sql, userId);
  const fanout: PushFanout = { attempted: targets.length, sent: 0, revoked: 0, failed: 0, retryable: false, errors: [] };
  await Promise.all(
    targets.map(async (target) => {
      const attempt = await deps.sender.send(target, message);
      if (attempt.ok) {
        fanout.sent += 1;
        return;
      }
      if (attempt.statusCode === 404 || attempt.statusCode === 410) {
        await retirePushSubscription(deps.sql, target.id, now);
        fanout.revoked += 1;
        return;
      }
      fanout.failed += 1;
      if (attempt.statusCode === null || attempt.statusCode === 429 || attempt.statusCode >= 500) fanout.retryable = true;
      fanout.errors.push(attempt.error);
    }),
  );
  return fanout;
}
