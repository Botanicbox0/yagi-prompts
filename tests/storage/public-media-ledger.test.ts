import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { publicMediaLedger, readVerifiedPublicMediaKeys } from '@/lib/storage/public-media-ledger';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { freshDb, runner } from '@/tests/helpers/pglite';

const KEY = `${'a'.repeat(64)}.mp4`;
const CODE_KEY = `${'c'.repeat(64)}.jpg`;
const OBJECT = { key: KEY, size: 10, mime: 'video/mp4' };

describe('public media ledger', () => {
  let db: PGlite;
  let sql: SqlRunner;

  beforeAll(async () => {
    db = await freshDb();
    sql = runner(db);
  });
  afterAll(async () => db.close());
  beforeEach(async () => { await db.exec('delete from public_media_copies'); });

  const ledger = () => publicMediaLedger(sql, new Set([CODE_KEY]));
  const expire = () => db.exec("update public_media_copies set next_attempt_at = now() - interval '1 second'");
  const row = async () => (await db.query<{ attempts: number; last_failure: string | null; wait: number | null; verified_at: Date | null }>(
    "select attempts, last_failure, verified_at, case when next_attempt_at = 'infinity' then null else extract(epoch from next_attempt_at - now()) end as wait from public_media_copies where key = $1",
    [KEY],
  )).rows[0];

  it('lets one worker hold a new key until its lease runs out', async () => {
    expect(await ledger().claim(OBJECT)).toBe(true);
    expect(await ledger().claim(OBJECT)).toBe(false);
    expect((await row())?.attempts).toBe(1);
    await expire();
    expect(await ledger().claim(OBJECT)).toBe(true);
    expect((await row())?.attempts).toBe(2);
  });

  it('does not count a key as verified until it is marked', async () => {
    await ledger().claim(OBJECT);
    expect(await readVerifiedPublicMediaKeys(sql)).toEqual([]);
    expect((await ledger().verifiedKeys()).has(KEY)).toBe(false);
    await ledger().markVerified(KEY);
    expect(await readVerifiedPublicMediaKeys(sql)).toEqual([KEY]);
    expect((await ledger().verifiedKeys()).has(KEY)).toBe(true);
  });

  it('counts the keys in the code list as verified too, so they are never read again', async () => {
    expect((await ledger().verifiedKeys()).has(CODE_KEY)).toBe(true);
  });

  it('never claims a verified key again, even past its retry time', async () => {
    await ledger().claim(OBJECT);
    await ledger().markVerified(KEY);
    await expire();
    expect(await ledger().claim(OBJECT)).toBe(false);
  });

  it('clears the failure once a retry passes', async () => {
    await ledger().claim(OBJECT);
    await ledger().markFailed(KEY, 'public_read_failed');
    await expire();
    await ledger().claim(OBJECT);
    await ledger().markVerified(KEY);
    expect((await row())?.last_failure).toBeNull();
  });

  it('backs off a failure, so a broken file is not read from Supabase on every run', async () => {
    await ledger().claim(OBJECT);
    await ledger().markFailed(KEY, 'copy_error');
    expect(await ledger().claim(OBJECT)).toBe(false);
    const first = await row();
    expect(first?.last_failure).toBe('copy_error');
    expect(Number(first?.wait)).toBeGreaterThan(50 * 60);
    expect(Number(first?.wait)).toBeLessThan(61 * 60);

    await expire();
    await ledger().claim(OBJECT);
    await ledger().markFailed(KEY, 'copy_error');
    expect(Number((await row())?.wait)).toBeGreaterThan(110 * 60);
  });

  it('caps the back-off at three days', async () => {
    await ledger().claim(OBJECT);
    await db.exec('update public_media_copies set attempts = 40');
    await ledger().markFailed(KEY, 'copy_error');
    const wait = Number((await row())?.wait);
    expect(wait).toBeGreaterThan(71 * 3600);
    expect(wait).toBeLessThanOrEqual(72 * 3600);
  });

  it('never retries a file whose bytes do not match its name, because content-addressed bytes cannot heal', async () => {
    await ledger().claim(OBJECT);
    await ledger().markFailed(KEY, 'name_hash_mismatch');
    expect((await row())?.wait).toBeNull();
    expect(await ledger().claim(OBJECT)).toBe(false);
  });

  it('refuses a key that is not content-addressed at the database too', async () => {
    await expect(ledger().claim({ ...OBJECT, key: 'temp-dm/clip.mp4' })).rejects.toThrow();
  });
});
