import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { studioEnv } from '@/lib/brand-studio/env';
import { loadStudioState } from '@/lib/brand-studio/service';
import { brandStudioOutpaintOpen } from '@/lib/flags';
import { studioDeps, studioFixture, viewerOf, type StudioFixture } from './helpers';

/**
 * "빈 곳 채우기" in the layer editor is built but not proven with a real model, so it ships switched
 * off: the server says it is on only when `BRAND_STUDIO_OUTPAINT=on`, and the editor renders nothing
 * unless the studio state carries `canFillEmpty`.
 */
describe('BRAND_STUDIO_OUTPAINT', () => {
  it('is off unless the environment says exactly "on"', () => {
    expect(brandStudioOutpaintOpen({})).toBe(false);
    expect(brandStudioOutpaintOpen({ BRAND_STUDIO_OUTPAINT: 'ON' })).toBe(false);
    expect(brandStudioOutpaintOpen({ BRAND_STUDIO_OUTPAINT: '1' })).toBe(false);
    expect(brandStudioOutpaintOpen({ BRAND_STUDIO_OUTPAINT: 'true' })).toBe(false);
    expect(brandStudioOutpaintOpen({ BRAND_STUDIO_OUTPAINT: 'on' })).toBe(true);
    expect(studioEnv({}).outpaint).toBe(false);
    expect(studioEnv({ BRAND_STUDIO_OUTPAINT: 'on' }).outpaint).toBe(true);
  });
});

describe('studio state', () => {
  let f: StudioFixture;
  beforeEach(async () => {
    f = await studioFixture();
  });
  afterEach(async () => {
    await f.db.close();
  });

  const load = async (env: Record<string, string>, who = f.ids.owner) => {
    const base = studioDeps(f.sql);
    const deps = { ...base, env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api', ...env }) };
    const state = await loadStudioState(deps, viewerOf(who), f.orgId);
    if (!state.ok) throw new Error(state.code);
    return state;
  };

  it('carries no fill capability by default', async () => {
    const state = await load({});
    expect(state).not.toHaveProperty('canFillEmpty');
  });

  it('carries it when the flag is on, for members who can create', async () => {
    expect((await load({ BRAND_STUDIO_OUTPAINT: 'on' })).canFillEmpty).toBe(true);
    expect((await load({ BRAND_STUDIO_OUTPAINT: 'on' }, f.ids.editor)).canFillEmpty).toBe(true);
    expect(await load({ BRAND_STUDIO_OUTPAINT: 'on' }, f.ids.viewer)).not.toHaveProperty('canFillEmpty');
  });
});
