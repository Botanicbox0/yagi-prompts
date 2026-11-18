/**
 * Music generation is closed unless `BRAND_STUDIO_MUSIC_GENERATION=on` (docs/BRAND-EDITING-STUDIO.md §8-5: no
 * commercially cleared music engine yet). Closed, `music.generate` answers like any unavailable studio feature
 * (`feature_unavailable` → 404) before a credit is reserved or a row written; `music.status` stays open so a
 * running job finishes or refunds; sound effects are not affected. Open, music charges exactly as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { studioEnv } from '@/lib/brand-studio/env';
import { generateReferenceMusic, musicCredits, musicKrw, sfxCredits, sfxKrw } from '@/lib/brand-studio/music';
import { studioMonthWindow, usedKrwIn } from '@/lib/brand-studio/usage';
import { brandStudioMusicGenerationOpen } from '@/lib/flags';
import { studioDeps, studioFixture, viewerOf, type StudioFixture } from './server/helpers';

const mocks = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
  viewer: null as Viewer | null,
}));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/auth/viewer', () => ({
  getViewer: async () => mocks.viewer ?? { userId: null, isAdmin: false, tier: 'anon', email: null, locale: null },
}));

const postProdRoute = await import('@/app/api/brand-studio/post-production/route');

const URL_BASE = 'http://localhost:3000/api/brand-studio/post-production';
const postPostProd = (body: unknown) =>
  postProdRoute.POST(
    new NextRequest(URL_BASE, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', host: 'localhost:3000' },
      body: JSON.stringify(body),
    }),
  );

describe('BRAND_STUDIO_MUSIC_GENERATION', () => {
  it('is closed unless the environment says exactly "on"', () => {
    expect(brandStudioMusicGenerationOpen({})).toBe(false);
    expect(brandStudioMusicGenerationOpen({ BRAND_STUDIO_MUSIC_GENERATION: 'ON' })).toBe(false);
    expect(brandStudioMusicGenerationOpen({ BRAND_STUDIO_MUSIC_GENERATION: 'true' })).toBe(false);
    expect(brandStudioMusicGenerationOpen({ BRAND_STUDIO_MUSIC_GENERATION: 'off' })).toBe(false);
    expect(brandStudioMusicGenerationOpen({ BRAND_STUDIO_MUSIC_GENERATION: 'on' })).toBe(true);
    expect(studioEnv({}).musicGeneration).toBe(false);
    expect(studioEnv({ BRAND_STUDIO_MUSIC_GENERATION: 'on' }).musicGeneration).toBe(true);
  });
});

describe('music.generate behind BRAND_STUDIO_MUSIC_GENERATION', () => {
  let f: StudioFixture | null = null;

  beforeEach(async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_STUDIO_PROVIDER', 'fake');
    vi.stubEnv('BRAND_STUDIO_MUSIC_PROVIDER', 'fake');
    vi.stubEnv('BRAND_STUDIO_MUSIC_GENERATION', '');
    f = await studioFixture({ capKrw: 5_000 });
    mocks.sql = f.sql;
    mocks.viewer = viewerOf(f.ids.owner);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await f?.db.close();
    f = null;
    mocks.sql = null;
    mocks.viewer = null;
  });

  const used = () => usedKrwIn(f!.sql, f!.orgId, studioMonthWindow(new Date()));
  const jobRows = async () =>
    Number(
      (await f!.sql.query<{ n: number }>('select count(*)::int as n from brand_studio_jobs where organization_id = $1', [f!.orgId]))
        .rows[0]!.n,
    );
  const musicInput = (requestId: string) => ({ organizationId: f!.orgId, requestId, durationSec: 12, bpm: 120 });

  it('closed: refuses with 404 feature_unavailable before any reservation or job row, through the route and directly', async () => {
    const res = await postPostProd({ operation: 'music.generate', input: musicInput('music_closed_0001') });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, code: 'feature_unavailable' });
    expect(await used()).toBe(0);
    expect(await jobRows()).toBe(0);

    // The service refuses on its own too (any future caller), even with a working provider configured.
    const direct = await generateReferenceMusic(studioDeps(f!.sql), viewerOf(f!.ids.owner), musicInput('music_closed_0002'), {
      env: { BRAND_STUDIO_MUSIC_PROVIDER: 'fake' },
    });
    expect(direct).toEqual({ ok: false, code: 'feature_unavailable' });
    expect(await used()).toBe(0);
    expect(await jobRows()).toBe(0);
  });

  it('closed: sound effects still generate and charge', async () => {
    const res = await postPostProd({
      operation: 'sfx.generate',
      input: { organizationId: f!.orgId, requestId: 'sfx_closed_0001', text: 'crisp glass clink', durationSec: 4 },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, creditsUsed: sfxCredits(4) });
    expect(await used()).toBe(sfxKrw(4));
  });

  it('open: charges as before; after it closes again music.status still answers for that job', async () => {
    vi.stubEnv('BRAND_STUDIO_MUSIC_GENERATION', 'on');
    const res = await postPostProd({ operation: 'music.generate', input: musicInput('music_open_00001') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; jobId: string; creditsUsed: number };
    expect(body.ok).toBe(true);
    expect(body.creditsUsed).toBe(musicCredits(12));
    expect(await used()).toBe(musicKrw(12));

    vi.stubEnv('BRAND_STUDIO_MUSIC_GENERATION', 'off');
    const status = await postPostProd({ operation: 'music.status', input: { organizationId: f!.orgId, jobId: body.jobId } });
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ ok: true, jobId: body.jobId });

    const closedAgain = await postPostProd({ operation: 'music.generate', input: musicInput('music_open_00002') });
    expect(closedAgain.status).toBe(404);
    expect(await used()).toBe(musicKrw(12));
  });
});
