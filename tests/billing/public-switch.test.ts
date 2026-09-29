import { describe, expect, it } from 'vitest';
import { renderPipelinePublic } from '@/lib/flags';

/**
 * The public-sales switch (docs/qa/toss-checkout/README.md "운영 개시"). Going live is an
 * environment change in Vercel, not a code deploy — and production refuses to open on Toss TEST
 * keys, because a test key there would hand every visitor a free film.
 */

const LIVE = { TOSS_CLIENT_KEY: 'live_gck_example', TOSS_SECRET_KEY: 'live_gsk_example' };
const TEST = { TOSS_CLIENT_KEY: 'test_gck_example', TOSS_SECRET_KEY: 'test_gsk_example' };

describe('renderPipelinePublic', () => {
  it('is closed unless the environment says exactly on', () => {
    expect(renderPipelinePublic({})).toBe(false);
    expect(renderPipelinePublic({ ...LIVE, VERCEL_ENV: 'production' })).toBe(false);
    expect(renderPipelinePublic({ ...LIVE, VERCEL_ENV: 'production', RENDER_PIPELINE_PUBLIC: 'yes' })).toBe(false);
    expect(renderPipelinePublic({ ...LIVE, VERCEL_ENV: 'production', RENDER_PIPELINE_PUBLIC: ' ON ' })).toBe(true);
  });

  it('opens production only on live Toss keys, both of them', () => {
    expect(renderPipelinePublic({ ...TEST, VERCEL_ENV: 'production', RENDER_PIPELINE_PUBLIC: 'on' })).toBe(false);
    expect(renderPipelinePublic({ TOSS_CLIENT_KEY: LIVE.TOSS_CLIENT_KEY, VERCEL_ENV: 'production', RENDER_PIPELINE_PUBLIC: 'on' })).toBe(false);
    expect(renderPipelinePublic({ ...LIVE, TOSS_SECRET_KEY: TEST.TOSS_SECRET_KEY, VERCEL_ENV: 'production', RENDER_PIPELINE_PUBLIC: 'on' })).toBe(false);
  });

  it('lets a preview or a local run open on test keys, for QA', () => {
    expect(renderPipelinePublic({ ...TEST, VERCEL_ENV: 'preview', RENDER_PIPELINE_PUBLIC: 'on' })).toBe(true);
    expect(renderPipelinePublic({ ...TEST, RENDER_PIPELINE_PUBLIC: 'on' })).toBe(true);
  });
});
