import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { freshDb, runner } from '@/tests/helpers/pglite';

const mocks = vi.hoisted(() => ({ sql: null as SqlRunner | null }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));

import { publicContentUrl } from '@/lib/content/asset-url';
import { PUBLIC_MEDIA_KEYS } from '@/lib/content/public-media-keys';
import { copiedPublicMediaKeys, refreshPublicMediaKeys, resetPublicMediaKeys } from '@/lib/content/public-media-registry';
import { publicMediaLedger } from '@/lib/storage/public-media-ledger';

const SUPABASE = 'https://project.supabase.co';
const MEDIA = 'https://media.twings.app';
const NEW_KEY = `${'b'.repeat(64)}.mp4`;
const OBJECT = { key: NEW_KEY, size: 10, mime: 'video/mp4' };
const supabaseUrl = `${SUPABASE}/storage/v1/object/public/public-content/${NEW_KEY}`;

function configure(): void {
  vi.stubEnv('PLAYBOOK_MODE', 'cloud');
  vi.stubEnv('NEXT_PHASE', '');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE);
  vi.stubEnv('PUBLIC_MEDIA_BASE_URL', MEDIA);
  vi.stubEnv('R2_ACCOUNT_ID', 'account');
  vi.stubEnv('R2_ACCESS_KEY_ID', 'access');
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'secret');
  vi.stubEnv('R2_PUBLIC_BUCKET', 'twings-media-apac');
}

function countingRunner(sql: SqlRunner) {
  const counter = { reads: 0 };
  const counted: SqlRunner = { ...sql, query: (async (text: string, params?: unknown[]) => { counter.reads += 1; return sql.query(text, params); }) as SqlRunner['query'] };
  return { counted, counter };
}

describe('public media registry', () => {
  let db: PGlite;
  let sql: SqlRunner;

  beforeAll(async () => {
    db = await freshDb();
    sql = runner(db);
  });
  afterAll(async () => db.close());
  beforeEach(async () => {
    await db.exec('delete from public_media_copies');
    resetPublicMediaKeys();
    mocks.sql = null;
    configure();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('serves a new key from Supabase before it is verified and from the media host after', async () => {
    const ledger = publicMediaLedger(sql);
    await refreshPublicMediaKeys(sql, { force: true });
    expect(publicContentUrl(NEW_KEY)).toBe(supabaseUrl);

    // Claimed and copied, but not read back yet: still Supabase.
    await ledger.claim(OBJECT);
    await refreshPublicMediaKeys(sql, { force: true });
    expect(publicContentUrl(NEW_KEY)).toBe(supabaseUrl);

    await ledger.markVerified(NEW_KEY);
    await refreshPublicMediaKeys(sql, { force: true });
    expect(publicContentUrl(NEW_KEY)).toBe(`${MEDIA}/${NEW_KEY}`);
  });

  it('keeps a failed key on Supabase', async () => {
    const ledger = publicMediaLedger(sql);
    await ledger.claim(OBJECT);
    await ledger.markFailed(NEW_KEY, 'public_bytes_mismatch');
    await refreshPublicMediaKeys(sql, { force: true });
    expect(publicContentUrl(NEW_KEY)).toBe(supabaseUrl);
  });

  it('keeps every key in the code list when the table is empty', async () => {
    await refreshPublicMediaKeys(sql, { force: true });
    const [first] = [...PUBLIC_MEDIA_KEYS];
    expect(copiedPublicMediaKeys().has(first!)).toBe(true);
  });

  it('follows a removed row, so one key can be sent back to Supabase', async () => {
    const ledger = publicMediaLedger(sql);
    await ledger.claim(OBJECT);
    await ledger.markVerified(NEW_KEY);
    await refreshPublicMediaKeys(sql, { force: true });
    expect(copiedPublicMediaKeys().has(NEW_KEY)).toBe(true);
    await db.exec('delete from public_media_copies');
    await refreshPublicMediaKeys(sql, { force: true });
    expect(copiedPublicMediaKeys().has(NEW_KEY)).toBe(false);
  });

  it('keeps the last answer when the database fails', async () => {
    const ledger = publicMediaLedger(sql);
    await ledger.claim(OBJECT);
    await ledger.markVerified(NEW_KEY);
    await refreshPublicMediaKeys(sql, { force: true });
    const broken: SqlRunner = { ...sql, query: (async () => { throw new Error('private connection detail'); }) as SqlRunner['query'] };
    await expect(refreshPublicMediaKeys(broken, { force: true })).resolves.toBeUndefined();
    expect(copiedPublicMediaKeys().has(NEW_KEY)).toBe(true);
  });

  it('reads at most once a minute unless a cached document is being filled', async () => {
    const { counted, counter } = countingRunner(sql);
    await refreshPublicMediaKeys(counted);
    await refreshPublicMediaKeys(counted);
    expect(counter.reads).toBe(1);
    await refreshPublicMediaKeys(counted, { force: true });
    expect(counter.reads).toBe(2);
  });

  it.each([
    ['R2 keys are absent', () => vi.stubEnv('R2_SECRET_ACCESS_KEY', '')],
    ['the media host is unset', () => vi.stubEnv('PUBLIC_MEDIA_BASE_URL', '')],
    ['the mode is local', () => vi.stubEnv('PLAYBOOK_MODE', 'local')],
    // A statement error costs a pooled connection, and connections are what failed builds ran out of.
    ['next build is running', () => vi.stubEnv('NEXT_PHASE', 'phase-production-build')],
  ])('does not touch the database when %s', async (_name, change) => {
    change();
    const { counted, counter } = countingRunner(sql);
    mocks.sql = counted;
    await refreshPublicMediaKeys(counted, { force: true });
    expect(copiedPublicMediaKeys()).toBe(PUBLIC_MEDIA_KEYS);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(counter.reads).toBe(0);
  });

  it('refreshes in the background from the synchronous read, once per window', async () => {
    const ledger = publicMediaLedger(sql);
    await ledger.claim(OBJECT);
    await ledger.markVerified(NEW_KEY);
    const { counted, counter } = countingRunner(sql);
    mocks.sql = counted;

    // The caller is mid-render and cannot wait: it gets the current answer, which is still correct.
    expect(copiedPublicMediaKeys().has(NEW_KEY)).toBe(false);
    expect(copiedPublicMediaKeys().has(NEW_KEY)).toBe(false);
    await vi.waitFor(() => expect(copiedPublicMediaKeys().has(NEW_KEY)).toBe(true));
    expect(counter.reads).toBe(1);
  });
});
