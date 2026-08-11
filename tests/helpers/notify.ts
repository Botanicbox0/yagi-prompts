import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import type { Locale } from '@/lib/i18n/config';

/**
 * Recipients for the §3.5 outbox tests: a real `profiles` row, a real `subscriptions` row, and the
 * two preference columns set explicitly.
 *
 * Deliberately built from the actual tables rather than from a stub, because the properties under
 * test — "one delivery per opted-in Pro user", "preference AND entitlement re-checked at claim
 * time" — are properties of the SQL, not of any TypeScript object.
 */

export interface RecipientSpec {
  email: string;
  locale?: Locale;
  /** Seeds an `active` subscription. `false` seeds none, which is what "free" means (§3.4). */
  entitled?: boolean;
  /** Anything Stripe could report; the entitlement rule is `active | past_due`. */
  status?: string;
  notifNew?: boolean;
  notifUpdates?: boolean;
  isAdmin?: boolean;
}

export async function seedRecipient(db: PGlite, spec: RecipientSpec): Promise<string> {
  const id = randomUUID();
  await db.query('insert into auth.users (id) values ($1) on conflict do nothing', [id]);
  await db.query(
    `insert into profiles (id, email, display_name, locale, plan, is_admin,
                           notif_new_playbook, notif_updates)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      spec.email,
      spec.email,
      spec.locale ?? 'en',
      spec.entitled === false ? 'free' : 'pro',
      spec.isAdmin === true,
      spec.notifNew ?? false,
      spec.notifUpdates ?? false,
    ],
  );
  if (spec.entitled !== false) {
    await db.query(
      `insert into subscriptions
         (user_id, stripe_subscription_id, status, cancel_at_period_end,
          current_period_end, stripe_fetched_at)
       values ($1, $2, $3, false, now() + interval '30 days', now())`,
      [id, `sub_${id.slice(0, 8)}`, spec.status ?? 'active'],
    );
  }
  return id;
}

export interface DeliveryRow {
  job_id: string;
  user_id: string;
  status: string;
  attempts: number;
  claimed_at: string | null;
  sent_at: string | null;
}

export async function deliveries(db: PGlite): Promise<DeliveryRow[]> {
  const { rows } = await db.query<DeliveryRow>(
    'select job_id, user_id, status, attempts, claimed_at, sent_at from notification_deliveries order by user_id',
  );
  return rows;
}

export async function jobs(
  db: PGlite,
): Promise<Array<{ id: string; revision_id: string; kind: string }>> {
  const { rows } = await db.query<{ id: string; revision_id: string; kind: string }>(
    'select id, revision_id, kind from notification_jobs order by created_at, kind',
  );
  return rows;
}

/** Age a delivery's lease so the recovery sweep or the backoff window can be exercised. */
export async function ageClaim(db: PGlite, userId: string, minutes: number): Promise<void> {
  await db.query(
    `update notification_deliveries
        set claimed_at = now() - make_interval(mins => $2::int)
      where user_id = $1`,
    [userId, minutes],
  );
}
