/**
 * The project room mail switch (docs/BRAND-ROOMS-FEEDBACK.md §2.2), one per person and organization
 * (`brand_room_notice_prefs`, 0094). No row means mail is on.
 *
 * Two callers with different trust, the same split as lib/notify/preferences.ts:
 *   · a signed-in member (the settings screen, slice N4): `loadRoomNoticePrefs` / `saveRoomNoticePrefs`,
 *     behind the room seat (lib/brand-rooms/access.ts), may switch either way;
 *   · the unsubscribe link (no session, a signed token naming the person and the organization):
 *     `disableRoomEmail` can only switch mail off.
 * Push is not here: it is per device (`push_subscriptions`), turned on and off in the browser.
 */
import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { RoomDenied, roomSeat, type RoomDeniedCode } from './access';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RoomNoticePrefsResult = { ok: true; emailEnabled: boolean } | { ok: false; code: RoomDeniedCode | 'invalid' };

/** True unless this person switched this organization's room mail off. */
export async function roomEmailEnabled(sql: SqlRunner, userId: string, organizationId: string): Promise<boolean> {
  const row = (
    await sql.query<{ email_enabled: boolean }>('select email_enabled from brand_room_notice_prefs where user_id = $1 and organization_id = $2', [userId, organizationId])
  ).rows[0];
  return row ? row.email_enabled === true : true;
}

async function seated<T>(fn: () => Promise<T>): Promise<T | { ok: false; code: RoomDeniedCode }> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof RoomDenied) return { ok: false, code: error.code };
    throw error;
  }
}

/** The signed-in member's switch for one organization. Same refusals as the room (404 for a closed brand). */
export async function loadRoomNoticePrefs(sql: SqlRunner, viewer: Pick<Viewer, 'userId'>, organizationId: string): Promise<RoomNoticePrefsResult> {
  if (!UUID.test(organizationId)) return { ok: false, code: 'invalid' };
  return seated(() =>
    sql.transaction(async (tx) => {
      const seat = await roomSeat(tx, viewer.userId, organizationId);
      return { ok: true as const, emailEnabled: await roomEmailEnabled(tx, seat.userId, seat.organizationId) };
    }),
  );
}

const SaveSchema = z.object({ organizationId: z.string().regex(UUID), emailEnabled: z.boolean() }).strict();

/** Switch room mail on or off for the signed-in member, behind the room seat. */
export async function saveRoomNoticePrefs(sql: SqlRunner, viewer: Pick<Viewer, 'userId'>, input: unknown): Promise<RoomNoticePrefsResult> {
  const parsed = SaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid' };
  return seated(() =>
    sql.transaction(async (tx) => {
      const seat = await roomSeat(tx, viewer.userId, parsed.data.organizationId);
      await tx.query(
        `insert into brand_room_notice_prefs (user_id, organization_id, email_enabled, updated_at) values ($1, $2, $3, now())
         on conflict (user_id, organization_id) do update set email_enabled = excluded.email_enabled, updated_at = now()`,
        [seat.userId, seat.organizationId, parsed.data.emailEnabled],
      );
      return { ok: true as const, emailEnabled: parsed.data.emailEnabled };
    }),
  );
}

/**
 * The unsubscribe link's write: mail off for this person and organization, nothing else. Idempotent.
 * `ok: false` when the person or the organization no longer exists (the page then says the link is not
 * valid rather than claiming a change it did not make). The person's own locale answers the page.
 */
export async function disableRoomEmail(sql: SqlRunner, userId: string, organizationId: string): Promise<{ ok: boolean; locale: Locale }> {
  if (!UUID.test(userId) || !UUID.test(organizationId)) return { ok: false, locale: DEFAULT_LOCALE };
  const profile = (await sql.query<{ locale: string | null }>('select locale from profiles where id = $1', [userId])).rows[0];
  if (!profile) return { ok: false, locale: DEFAULT_LOCALE };
  const locale = isLocale(profile.locale) ? profile.locale : DEFAULT_LOCALE;
  if (!(await sql.query('select id from brand_organizations where id = $1', [organizationId])).rows[0]) return { ok: false, locale };
  await sql.query(
    `insert into brand_room_notice_prefs (user_id, organization_id, email_enabled, updated_at) values ($1, $2, false, now())
     on conflict (user_id, organization_id) do update set email_enabled = false, updated_at = now()`,
    [userId, organizationId],
  );
  return { ok: true, locale };
}
