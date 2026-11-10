/**
 * Live wiring for the routes and the cron: the real intelligence modules (slice S2), the media store,
 * the staging bucket and the provider chosen by the environment. Tests never import this file; they
 * build `StudioDeps` with fakes.
 */
import type { SqlRunner } from '@/lib/db/sql-runner';
import { getStorage } from '@/lib/storage';
import { composeFallbackPrompt, enhancePrompt } from './enhancer';
import { readFilm } from './film-sheet';
import { compositeRegion, cropForEdit, planRegion } from './region-edit';
import { advanceStudioJobsWith, sweepStudio } from './engine';
import { studioEnv } from './env';
import { createStudioMediaStore } from './media-store';
import { selectStudioProvider } from './provider';
import type { StudioDeps, StudioIntel } from './types';

/** Server log only. Event names are stable (`studio_provider_balance` is watched); values never include secrets. */
export function studioLog(event: string, detail: Record<string, unknown> = {}): void {
  console.warn(`[brand-studio] ${event}`, JSON.stringify(detail).slice(0, 600));
}

const intel: StudioIntel = { enhancePrompt, composeFallbackPrompt, readFilm, planRegion, cropForEdit, compositeRegion };

export async function studioRuntimeDeps(sql: SqlRunner, source: Record<string, string | undefined> = process.env): Promise<StudioDeps> {
  const env = studioEnv(source);
  return {
    sql,
    env,
    media: createStudioMediaStore(source),
    staging: await getStorage(),
    provider: selectStudioProvider(env, source, { log: studioLog }),
    intel,
    intelDeps: { fetch: globalThis.fetch, env: source },
    log: studioLog,
  };
}

/** `advanceStudioJobs(sql, { jobIds?, limit? })` with the live dependencies (after(), webhook, poll, lane, cron). */
export async function advanceStudioJobs(sql: SqlRunner, options: { jobIds?: readonly string[]; limit?: number } = {}): Promise<{ advanced: number }> {
  return advanceStudioJobsWith(await studioRuntimeDeps(sql), options);
}

export async function sweepStudioLive(sql: SqlRunner): Promise<Awaited<ReturnType<typeof sweepStudio>>> {
  return sweepStudio(await studioRuntimeDeps(sql));
}
