import type { SqlRunner } from '@/lib/db/sql-runner';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import type { NotifyToggle } from './kinds';

/**
 * PLAN §3.5 — the two preference columns, read and written in one place.
 *
 * Two callers with very different trust levels share it on purpose:
 *   · `/account` server actions, behind a verified session, may set either column either way;
 *   · `/api/notify/unsubscribe`, behind a signed token and NO session, may only ever set one
 *     column to `false` — which is why `disableToggle` exists as its own narrow function rather
 *     than as `savePreferences` with a flag. A capability that can only take something away is a
 *     much smaller thing to leave in someone's inbox for a year.
 *
 * Driver-agnostic `SqlRunner` like every other write since M0, so both paths are exercised against
 * real PGlite in vitest.
 */

export interface NotificationPreferences {
  newPlaybook: boolean;
  updates: boolean;
}

export const PREFERENCES_OFF: NotificationPreferences = { newPlaybook: false, updates: false };

interface PreferenceRow {
  notif_new_playbook: boolean;
  notif_updates: boolean;
  locale: string;
}

export async function loadPreferences(
  sql: SqlRunner,
  userId: string,
): Promise<NotificationPreferences | null> {
  const { rows } = await sql.query<PreferenceRow>(
    'select notif_new_playbook, notif_updates, locale from profiles where id = $1',
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return { newPlaybook: row.notif_new_playbook === true, updates: row.notif_updates === true };
}

/** `/account`. Returns false when the profile does not exist — never creates one. */
export async function savePreferences(
  sql: SqlRunner,
  userId: string,
  preferences: NotificationPreferences,
): Promise<boolean> {
  const { rows } = await sql.query<{ id: string }>(
    `update profiles
        set notif_new_playbook = $2, notif_updates = $3
      where id = $1
      returning id`,
    [userId, preferences.newPlaybook, preferences.updates],
  );
  return rows.length > 0;
}

export interface DisableResult {
  ok: boolean;
  /** The profile's own locale, so the confirmation page answers in the language of the email. */
  locale: Locale;
}

/**
 * The unsubscribe write. Idempotent by construction — setting `false` on a column that is already
 * `false` is the same statement, and the page says the same thing either way. A second click on a
 * forwarded link is not an error state.
 */
export async function disableToggle(
  sql: SqlRunner,
  userId: string,
  toggle: NotifyToggle,
): Promise<DisableResult> {
  // The column name comes from the validated `NotifyToggle` union, never from request text.
  const column = toggle === 'notif_new_playbook' ? 'notif_new_playbook' : 'notif_updates';
  const { rows } = await sql.query<{ locale: string }>(
    `update profiles set ${column} = false where id = $1 returning locale`,
    [userId],
  );
  const row = rows[0];
  if (!row) return { ok: false, locale: DEFAULT_LOCALE };
  return { ok: true, locale: isLocale(row.locale) ? row.locale : DEFAULT_LOCALE };
}
