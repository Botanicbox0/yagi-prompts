import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { studioEnv } from '@/lib/brand-studio/env';
import { loadStudioState } from '@/lib/brand-studio/service';
import { brandStudioReviseV2Open } from '@/lib/flags';
import { studioDeps, studioFixture, viewerOf, type StudioFixture } from './helpers';

/**
 * `BRAND_STUDIO_REVISE_V2` (docs/BRAND-STUDIO-VIDEO-REMIX.md §3, slice D1): the clip edit panel as a
 * conversation. Off unless the environment says exactly "on"; it reaches the screen only through the
 * studio state, and only for members who can make. Nothing on the server changes with it.
 */
describe('BRAND_STUDIO_REVISE_V2', () => {
  it('is off unless the environment says exactly "on"', () => {
    expect(brandStudioReviseV2Open({})).toBe(false);
    expect(brandStudioReviseV2Open({ BRAND_STUDIO_REVISE_V2: 'ON' })).toBe(false);
    expect(brandStudioReviseV2Open({ BRAND_STUDIO_REVISE_V2: 'true' })).toBe(false);
    expect(brandStudioReviseV2Open({ BRAND_STUDIO_REVISE_V2: 'on' })).toBe(true);
    expect(studioEnv({}).reviseV2).toBe(false);
    expect(studioEnv({ BRAND_STUDIO_REVISE_V2: 'on' }).reviseV2).toBe(true);
  });
});

describe('BRAND_STUDIO_REVISE_V2 in the studio state', () => {
  let f: StudioFixture;
  beforeEach(async () => {
    f = await studioFixture();
  });
  afterEach(async () => {
    await f.db.close();
  });

  it('carries reviseV2 only when the flag is on, for members who can make', async () => {
    const load = async (env: Record<string, string>, who = f.ids.owner) => {
      const deps = { ...studioDeps(f.sql), env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', ...env }) };
      const state = await loadStudioState(deps, viewerOf(who), f.orgId);
      if (!state.ok) throw new Error(state.code);
      return state;
    };
    expect(await load({})).not.toHaveProperty('reviseV2');
    expect((await load({ BRAND_STUDIO_REVISE_V2: 'on' })).reviseV2).toBe(true);
    expect(await load({ BRAND_STUDIO_REVISE_V2: 'on' }, f.ids.viewer)).not.toHaveProperty('reviseV2');
  });

  it('stays closed to a sandboxed organization exactly as before', async () => {
    const sandbox = await studioFixture({ orgName: 'Morphic' });
    try {
      const deps = { ...studioDeps(sandbox.sql), env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_REVISE_V2: 'on' }) };
      const state = await loadStudioState(deps, viewerOf(sandbox.ids.owner), sandbox.orgId);
      expect(state).toMatchObject({ ok: false, code: 'feature_unavailable' });
    } finally {
      await sandbox.db.close();
    }
  });
});
