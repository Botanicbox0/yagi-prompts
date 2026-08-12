import { describe, expect, it } from 'vitest';
import {
  describeRuntimeSelection,
  explicitRuntimeMode,
  publicStorageBaseUrl,
  resolveRuntimeMode,
  selectDbDriver,
  selectStorageDriver,
  type EnvLike,
} from '@/lib/runtime-mode';

/**
 * M7 — the selection matrix.
 *
 * This exists because of one concrete accident it has to make impossible: `.env.local` now carries
 * live Supabase credentials, and `next dev`/`build`/`start` all read it. Everything that proves
 * this repo works — the PGlite snapshot, the fixture identities, `npm run sweep:anon`, CI — has to
 * keep running against local fixtures on that same machine. So the rule is not "prefer local", it
 * is "`PLAYBOOK_MODE=local` OVERRIDES a present DATABASE_URL", and that is what the table below
 * pins in both directions.
 *
 * Pure functions over an injected env bag: no `process.env` mutation, no module mocking, so these
 * cases cannot leak into each other or into any other suite.
 */

const CLOUD: EnvLike = {
  DATABASE_URL: 'postgresql://postgres:pw@db.example.supabase.co:5432/postgres',
  NEXT_PUBLIC_SUPABASE_URL: 'https://proj.supabase.co',
};

describe('resolveRuntimeMode', () => {
  it('infers from DATABASE_URL when the switch is unset (M0–M6 behaviour, unchanged)', () => {
    expect(resolveRuntimeMode({})).toBe('local');
    expect(resolveRuntimeMode(CLOUD)).toBe('cloud');
    // Whitespace is not a connection string.
    expect(resolveRuntimeMode({ DATABASE_URL: '   ' })).toBe('local');
  });

  it('lets the switch beat the inference, in BOTH directions', () => {
    expect(resolveRuntimeMode({ ...CLOUD, PLAYBOOK_MODE: 'local' })).toBe('local');
    expect(resolveRuntimeMode({ PLAYBOOK_MODE: 'cloud' })).toBe('cloud');
  });

  it('accepts case and padding, because a .env file is typed by a human', () => {
    expect(explicitRuntimeMode({ PLAYBOOK_MODE: ' LOCAL ' })).toBe('local');
    expect(explicitRuntimeMode({ PLAYBOOK_MODE: 'Cloud' })).toBe('cloud');
  });

  it('treats an unknown value as unset rather than taking a deployment down', () => {
    expect(explicitRuntimeMode({ PLAYBOOK_MODE: 'prod' })).toBeNull();
    expect(resolveRuntimeMode({ ...CLOUD, PLAYBOOK_MODE: 'prod' })).toBe('cloud');
    expect(resolveRuntimeMode({ PLAYBOOK_MODE: 'prod' })).toBe('local');
  });
});

describe('selectDbDriver', () => {
  it('cloud mode uses pg', () => {
    expect(selectDbDriver(CLOUD)).toEqual({
      driver: 'pg',
      connectionString: CLOUD.DATABASE_URL,
    });
  });

  it('local mode IGNORES DATABASE_URL — the whole point of the switch', () => {
    expect(selectDbDriver({ ...CLOUD, PLAYBOOK_MODE: 'local' })).toEqual({
      driver: 'pglite-snapshot',
      path: '.pglite/catalog.tar.gz',
    });
  });

  it('local mode prefers the durable directory, and remembers the snapshot fallback', () => {
    expect(
      selectDbDriver({ ...CLOUD, PLAYBOOK_MODE: 'local', PLAYBOOK_LOCAL_DB_DIR: '.pglite/dev' }),
    ).toEqual({ driver: 'pglite-dir', dir: '.pglite/dev', snapshotPath: '.pglite/catalog.tar.gz' });
  });

  it('honours a custom snapshot path', () => {
    expect(selectDbDriver({ PLAYBOOK_LOCAL_DB: 'tmp/other.tar.gz' })).toEqual({
      driver: 'pglite-snapshot',
      path: 'tmp/other.tar.gz',
    });
  });

  it('cloud mode without DATABASE_URL selects nothing (build must not crash)', () => {
    const selection = selectDbDriver({ PLAYBOOK_MODE: 'cloud' });
    expect(selection.driver).toBe('none');
  });
});

describe('selectStorageDriver', () => {
  it('follows the mode', () => {
    expect(selectStorageDriver({})).toBe('local');
    expect(selectStorageDriver(CLOUD)).toBe('supabase');
    expect(selectStorageDriver({ ...CLOUD, PLAYBOOK_MODE: 'local' })).toBe('local');
    expect(selectStorageDriver({ PLAYBOOK_MODE: 'cloud' })).toBe('supabase');
  });

  it('STORAGE_DRIVER is the explicit escape hatch and wins over the mode', () => {
    expect(selectStorageDriver({ ...CLOUD, STORAGE_DRIVER: 'local' })).toBe('local');
    expect(selectStorageDriver({ PLAYBOOK_MODE: 'local', STORAGE_DRIVER: 'supabase' })).toBe(
      'supabase',
    );
  });

  it('ignores a garbage override rather than inventing a third driver', () => {
    expect(selectStorageDriver({ ...CLOUD, STORAGE_DRIVER: 's3' })).toBe('supabase');
  });
});

describe('publicStorageBaseUrl', () => {
  /**
   * The subtle one. In local mode the published objects live under `.storage/` and were NEVER
   * copied to the cloud bucket — so emitting a project URL would render a card pointing at an
   * object that does not exist there. `undefined` routes the caller to the gateway fallback.
   */
  it('is undefined in local mode even with a real project URL present', () => {
    expect(publicStorageBaseUrl({ ...CLOUD, PLAYBOOK_MODE: 'local' })).toBeUndefined();
  });

  it('is the project URL in cloud mode', () => {
    expect(publicStorageBaseUrl(CLOUD)).toBe('https://proj.supabase.co');
  });

  it('is undefined when there is no project at all', () => {
    expect(publicStorageBaseUrl({ PLAYBOOK_MODE: 'cloud' })).toBeUndefined();
  });
});

describe('describeRuntimeSelection', () => {
  it('is one line a script banner can print', () => {
    expect(describeRuntimeSelection({ ...CLOUD, PLAYBOOK_MODE: 'local' })).toBe(
      'local · db:pglite-snapshot · storage:local',
    );
    expect(describeRuntimeSelection(CLOUD)).toBe('cloud · db:pg · storage:supabase');
  });
});
