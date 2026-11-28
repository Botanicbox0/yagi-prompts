import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `repo.ts`, `engine.ts` and `provider/requests.ts` are loaded by plain scripts (`npm run db:local`), so they must
 * not import `sound/music-jobs.ts`, which reaches `server-only` modules. The composer v2 predicate they need
 * lives in the dependency-free `sound/v2-job.ts`. This broke once (db:local failed with the server-only error).
 */
const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('composer v2 predicate stays importable from plain scripts', () => {
  it.each(['lib/brand-studio/repo.ts', 'lib/brand-studio/engine.ts', 'lib/brand-studio/provider/requests.ts'])(
    '%s does not import sound/music-jobs',
    (path) => {
      expect(read(path)).not.toMatch(/from\s+['"][^'"]*sound\/music-jobs['"]/);
    },
  );

  it('sound/v2-job.ts has type-only imports', () => {
    const imports = read('lib/brand-studio/sound/v2-job.ts')
      .split('\n')
      .filter((line) => line.startsWith('import'));
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) expect(line.startsWith('import type ')).toBe(true);
  });

  it('music-jobs.ts re-exports the same predicate', async () => {
    const pure = await import('@/lib/brand-studio/sound/v2-job');
    const jobs = await import('@/lib/brand-studio/sound/music-jobs');
    expect(jobs.isV2MusicJob).toBe(pure.isV2MusicJob);
  });
});
