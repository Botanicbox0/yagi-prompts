import { PUBLIC_MEDIA_KEYS } from '@/lib/content/public-media-keys';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { PublicMediaFailure, PublicMediaLedger } from './public-media-sync';

/**
 * `public_media_copies` (migration 0073). The lease and the back-off are one column, moved in one
 * statement, so two runs cannot read the same file from Supabase at once.
 *
 * Fifteen minutes outlasts one file: the largest public video is 48 MB. A run that dies mid-copy leaves
 * nothing verified, and the next run after the lease takes the key again.
 */
const LEASE = "interval '15 minutes'";

/** 1h, 2h, 4h … up to three days, so a file that keeps failing costs little Supabase egress. */
const BACK_OFF = "least(interval '1 hour' * power(2, least(attempts, 12) - 1), interval '3 days')";

/** Bytes that do not match their content address cannot heal, so reading them again is pure egress. */
const PERMANENT: readonly PublicMediaFailure[] = ['name_hash_mismatch'];

export async function readVerifiedPublicMediaKeys(sql: SqlRunner): Promise<string[]> {
  const { rows } = await sql.query<{ key: string }>('select key from public_media_copies where verified_at is not null');
  return rows.map((row) => row.key);
}

export function publicMediaLedger(sql: SqlRunner, codeKeys: ReadonlySet<string> = PUBLIC_MEDIA_KEYS): PublicMediaLedger {
  return {
    async verifiedKeys() {
      return new Set([...codeKeys, ...(await readVerifiedPublicMediaKeys(sql))]);
    },

    async claim(object) {
      const { rows } = await sql.query(
        `insert into public_media_copies (key, mime, size_bytes, attempts, next_attempt_at)
         values ($1, $2, $3, 1, now() + ${LEASE})
         on conflict (key) do update
           set attempts = public_media_copies.attempts + 1,
               next_attempt_at = now() + ${LEASE},
               updated_at = now()
           where public_media_copies.verified_at is null and public_media_copies.next_attempt_at <= now()
         returning key`,
        [object.key, object.mime, object.size],
      );
      return rows.length === 1;
    },

    async markVerified(key) {
      await sql.query(
        'update public_media_copies set verified_at = now(), last_failure = null, updated_at = now() where key = $1',
        [key],
      );
    },

    async markFailed(key, reason) {
      await sql.query(
        `update public_media_copies
           set last_failure = $2,
               next_attempt_at = case when $3::boolean then 'infinity'::timestamptz else now() + ${BACK_OFF} end,
               updated_at = now()
         where key = $1`,
        [key, reason, PERMANENT.includes(reason)],
      );
    },
  };
}
