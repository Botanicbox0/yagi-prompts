import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';
import { migratedDb } from '@/tests/helpers/pglite';

declare module 'vitest' {
  interface ProvidedContext {
    /** Path of the migrated-empty data directory dump `freshDb()` restores from. */
    pgliteTemplate: string;
  }
}

/**
 * vitest globalSetup: migrate ONE empty database per run and hand every suite a copy of it.
 *
 * Before this, `freshDb()` booted PGlite, ran initdb and replayed every core migration for each
 * suite — often for each test — which was most of CI's test minutes (2026-10-21: the month's free
 * Actions minutes ran out). The template is built by the very same `migratedDb()` path, so a
 * broken migration still fails the run; the suites that test migrations themselves keep calling
 * `migratedDb()` directly.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const db = await migratedDb();
  const dump = await db.dumpDataDir('none');
  await db.close();

  const dir = await mkdtemp(join(tmpdir(), 'twings-pglite-'));
  const path = join(dir, 'template.tar');
  await writeFile(path, new Uint8Array(await dump.arrayBuffer()));
  project.provide('pgliteTemplate', path);

  return () => rm(dir, { recursive: true, force: true });
}
