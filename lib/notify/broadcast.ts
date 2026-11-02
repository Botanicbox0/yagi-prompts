import type { SqlRunner } from '@/lib/db/sql-runner';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import type { NotifyToggle } from './kinds';
import type { Mailer, SendOutcome } from './mailer';
import { unsubscribePath } from './unsubscribe';

/**
 * A broadcast to everyone who switched a toggle on (2026-09-13): the weekly template drop
 * ("새 템플릿 알림" = `notif_new_playbook`) and a campaign opening recruitment ("캠페인 알림" =
 * `notif_updates`). One recipient at a time, a small concurrency, one idempotency key per
 * (event, person) so a retried run cannot double-send, and a one-click unsubscribe link signed
 * for that person and that toggle.
 *
 * No outbox: the two events are rare and the audience is small for now. When either stops being
 * true, this function is the seam an outbox replaces.
 */

export interface Subscriber {
  userId: string;
  email: string;
  locale: Locale;
}

export async function listSubscribers(sql: SqlRunner, toggle: NotifyToggle, limit = 5000): Promise<Subscriber[]> {
  // The column name comes from the validated `NotifyToggle` union, never from request text.
  const column = toggle === 'notif_new_playbook' ? 'notif_new_playbook' : 'notif_updates';
  const { rows } = await sql.query<{ id: string; email: string | null; locale: string | null }>(
    `select id, email, locale from profiles where ${column} = true and email is not null order by id limit $1::int`,
    [limit],
  );
  return rows
    .filter((row): row is { id: string; email: string; locale: string | null } => typeof row.email === 'string' && row.email.includes('@'))
    .map((row) => ({ userId: row.id, email: row.email, locale: isLocale(row.locale) ? row.locale : DEFAULT_LOCALE }));
}

export interface BroadcastMessage {
  subject: string;
  html: string;
  text: string;
}

export interface BroadcastDeps {
  sql: SqlRunner;
  mailer: Mailer | null;
  siteUrl: string;
  /** How many sends run at once. Resend's default rate limit is a handful per second; 2 stays under it. */
  concurrency?: number;
}

export interface BroadcastArgs {
  toggle: NotifyToggle;
  /** `${event}:${userId}` becomes the provider idempotency key. */
  eventKey: string;
  /** Builds the message for one person — their locale and their own unsubscribe link. */
  compose(subscriber: Subscriber, unsubscribeUrl: string): BroadcastMessage;
}

export interface BroadcastResult {
  recipients: number;
  sent: number;
  failed: number;
  skipped: 'no_mailer' | null;
}

export async function broadcast(deps: BroadcastDeps, args: BroadcastArgs): Promise<BroadcastResult> {
  const recipients = await listSubscribers(deps.sql, args.toggle);
  if (deps.mailer === null) return { recipients: recipients.length, sent: 0, failed: 0, skipped: 'no_mailer' };
  const origin = deps.siteUrl.replace(/\/+$/, '');
  const mailer = deps.mailer;
  const concurrency = Math.max(1, deps.concurrency ?? 2);

  let sent = 0;
  let failed = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < recipients.length) {
      const subscriber = recipients[cursor];
      cursor += 1;
      if (!subscriber) break;
      const unsubscribeUrl = `${origin}${unsubscribePath({ userId: subscriber.userId, toggle: args.toggle })}`;
      const message = args.compose(subscriber, unsubscribeUrl);
      const outcome: SendOutcome = await mailer
        .send({
          to: subscriber.email,
          subject: message.subject,
          html: message.html,
          text: message.text,
          idempotencyKey: `${args.eventKey}:${subscriber.userId}`,
          unsubscribeUrl,
        })
        .catch((error: unknown): SendOutcome => ({ ok: false, retryable: false, error: error instanceof Error ? error.message : String(error) }));
      if (outcome.ok) sent += 1;
      else failed += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, recipients.length) }, () => worker()));
  return { recipients: recipients.length, sent, failed, skipped: null };
}
