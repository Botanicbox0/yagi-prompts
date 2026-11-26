import { describe, expect, it, vi } from 'vitest';
import {
  PROMPT_IMAGE_ENDPOINT,
  fetchDesignPromptPicture,
  fetchRunPromptPicture,
} from '@/components/brand-studio/api';
import {
  PROMPT_PAGE_RULE,
  PROMPT_PICTURE_FULL_ASPECT,
  PROMPT_PICTURE_FULL_HEIGHT,
  PROMPT_PICTURE_MAX_PAGES,
  PROMPT_PICTURE_MAX_WIDTH,
  clampPage,
  clampPageCount,
  isKnownFullPage,
  pageHeightForLines,
  pagerState,
  pictureCacheKey,
  pictureScopeKey,
  reconcileShieldedDesign,
  sentPromptMode,
  shieldedDesignFromEnhance,
  shieldedDesignFromJob,
  shieldedDesignOf,
  stepPage,
} from '@/components/brand-studio/prompt-pictures/model';
import { ORG, job } from '../ui/fixtures';

describe('sentPromptMode', () => {
  it('takes the legacy path when sent is absent, not_designed when null, pictures when present', () => {
    expect(sentPromptMode(job(1, { kind: 'image', finalPrompt: 'Designed' }))).toEqual({ kind: 'legacy' });
    expect(sentPromptMode(job(2, { kind: 'video', finalPrompt: 'Designed' }))).toEqual({ kind: 'legacy' });
    expect(sentPromptMode(job(3, { kind: 'video', finalPrompt: null, sent: undefined }))).toEqual({ kind: 'legacy' });
    expect(sentPromptMode(job(4, { kind: 'video', finalPrompt: null, sent: null, architect: false }))).toEqual({ kind: 'not_designed' });
    expect(
      sentPromptMode(
        job(5, {
          kind: 'video',
          finalPrompt: null,
          sent: { shielded: true, pages: 3, version: 'ver_abc' },
          architect: true,
        }),
      ),
    ).toEqual({ kind: 'pictures', jobId: job(5).id, pages: 3, version: 'ver_abc' });
  });
});

describe('pager bounds and cache keys', () => {
  it('clamps page counts and navigation within 1..total', () => {
    expect(PROMPT_PAGE_RULE).toEqual({ width: 720, padY: 40, lineHeight: 48, linesPerPage: 24, maxPages: 32 });
    expect(PROMPT_PICTURE_MAX_PAGES).toBe(32);
    expect(PROMPT_PICTURE_MAX_WIDTH).toBe(360);
    expect(PROMPT_PICTURE_FULL_HEIGHT).toBe(1232);
    expect(pageHeightForLines(1)).toBe(128);
    expect(PROMPT_PICTURE_FULL_ASPECT).toBe('720 / 1232');
    expect(clampPageCount(0)).toBe(1);
    expect(clampPageCount(-3)).toBe(1);
    expect(clampPageCount(99)).toBe(PROMPT_PICTURE_MAX_PAGES);
    expect(clampPage(0, 3)).toBe(1);
    expect(clampPage(5, 3)).toBe(3);
    expect(stepPage(1, -1, 3)).toBe(1);
    expect(stepPage(1, 1, 3)).toBe(2);
    expect(stepPage(3, 1, 3)).toBe(3);
    expect(pagerState(1, 1)).toEqual({ page: 1, total: 1, showPager: false, canPrev: false, canNext: false, indicator: '1 / 1' });
    expect(pagerState(2, 3)).toEqual({ page: 2, total: 3, showPager: true, canPrev: true, canNext: true, indicator: '2 / 3' });
    expect(isKnownFullPage(1, 3)).toBe(true);
    expect(isKnownFullPage(3, 3)).toBe(false);
    expect(isKnownFullPage(1, 1)).toBe(false);
  });

  it('builds cache keys with jobId:version:page for runs and token:page for designs', () => {
    const run = { kind: 'run' as const, jobId: 'job-1', version: 'v1', pages: 3 };
    expect(pictureScopeKey(run)).toBe('job-1:v1');
    expect(pictureCacheKey(run, 2)).toBe('job-1:v1:2');
    expect(pictureCacheKey(run, 9)).toBe('job-1:v1:3');

    const design = { kind: 'design' as const, token: 'tok-xyz', pages: 2 };
    expect(pictureScopeKey(design)).toBe('token:tok-xyz');
    expect(pictureCacheKey(design, 1)).toBe('token:tok-xyz:1');
  });
});

describe('shielded dock design helpers', () => {
  it('extracts shielded design from prompt.enhance and ignores legacy or fallback answers', () => {
    expect(shieldedDesignFromEnhance(null, { typed: '병', model: 'seedance-2.5' })).toBeNull();
    expect(shieldedDesignFromEnhance({ ok: true, prompt: 'text', notes: '', source: 'model' }, { typed: '병', model: 'seedance-2.5' })).toBeNull();
    expect(shieldedDesignFromEnhance({ ok: true, source: 'fallback', shielded: true, token: 'tok', pages: 1 }, { typed: '병', model: 'seedance-2.5' })).toBeNull();
    expect(shieldedDesignFromEnhance({ ok: true, source: 'model', shielded: true, token: 'tok-1', pages: 2 }, { typed: '병', model: 'seedance-2.5' })).toEqual({
      kind: 'token',
      token: 'tok-1',
      pages: 2,
      typed: '병',
      model: 'seedance-2.5',
    });
    expect(shieldedDesignOf(true)).toBeNull();
    expect(shieldedDesignOf(false)).toBeNull();
  });

  it('restores reviewed shielded video runs for reuse and leaves unreviewed or closed runs alone', () => {
    const reviewed = job(10, {
      kind: 'video',
      model: 'seedance-2.5',
      prompt: '병이 돈다',
      finalPrompt: null,
      reviewed: true,
      sent: { shielded: true, pages: 2, version: 'ver1' },
      architect: true,
    });
    expect(shieldedDesignFromJob(reviewed, 'seedance-2.5')).toEqual({
      kind: 'fromJob',
      jobId: reviewed.id,
      pages: 2,
      version: 'ver1',
      typed: '병이 돈다',
      model: 'seedance-2.5',
    });
    expect(shieldedDesignFromJob({ ...reviewed, reviewed: false }, 'seedance-2.5')).toBeNull();
    expect(shieldedDesignFromJob({ ...reviewed, sent: null }, 'seedance-2.5')).toBeNull();
    expect(shieldedDesignFromJob({ ...reviewed, kind: 'video_remix' }, 'seedance-2.5')).toBeNull();
  });

  it('drops designed state on typed edit, model change, or kind change', () => {
    const tokenDesign = { kind: 'token' as const, token: 'tok', pages: 1, typed: '원래 문장', model: 'seedance-2.5' };
    expect(reconcileShieldedDesign(tokenDesign, { prompt: '원래 문장', model: 'seedance-2.5', medium: 'video', remix: false })).toEqual({
      design: tokenDesign,
      dropped: null,
    });
    expect(reconcileShieldedDesign(tokenDesign, { prompt: '고친 문장', model: 'seedance-2.5', medium: 'video', remix: false })).toEqual({
      design: null,
      dropped: 'typed_changed',
    });
    expect(reconcileShieldedDesign(tokenDesign, { prompt: '원래 문장', model: 'kling-3.0', medium: 'video', remix: false })).toEqual({
      design: null,
      dropped: 'model_changed',
    });
    expect(reconcileShieldedDesign(tokenDesign, { prompt: '원래 문장', model: 'seedance-2.5', medium: 'video', remix: true })).toEqual({
      design: null,
      dropped: 'kind_changed',
    });
    expect(reconcileShieldedDesign(tokenDesign, { prompt: '원래 문장', model: 'seedream-5.5', medium: 'image', remix: false })).toEqual({
      design: null,
      dropped: 'kind_changed',
    });
  });
});

describe('api picture methods', () => {
  it('calls GET and POST /api/brand-studio/prompt-image and maps PNG or failure codes', async () => {
    const pngBlob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
    const fetcher = vi.fn(async () => new Response(pngBlob, { status: 200, headers: { 'Content-Type': 'image/png' } }));

    const getRes = await fetchRunPromptPicture({ organizationId: ORG, jobId: job(1).id, page: 2 }, { fetch: fetcher });
    expect(getRes.ok).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      `${PROMPT_IMAGE_ENDPOINT}?organizationId=${encodeURIComponent(ORG)}&jobId=${encodeURIComponent(job(1).id)}&page=2`,
      expect.objectContaining({ method: 'GET', credentials: 'same-origin', cache: 'no-store' }),
    );

    const postRes = await fetchDesignPromptPicture({ organizationId: ORG, token: 'tok-1', page: 1 }, { fetch: fetcher });
    expect(postRes.ok).toBe(true);
    expect(fetcher).toHaveBeenLastCalledWith(
      PROMPT_IMAGE_ENDPOINT,
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ organizationId: ORG, token: 'tok-1', page: 1 }),
      }),
    );

    const busyFetcher = vi.fn(async () => new Response(JSON.stringify({ ok: false, code: 'too_many_running' }), { status: 429 }));
    expect(await fetchRunPromptPicture({ organizationId: ORG, jobId: job(1).id, page: 1 }, { fetch: busyFetcher })).toEqual({
      ok: false,
      code: 'too_many_running',
    });

    const failFetcher = vi.fn(async () => new Response(JSON.stringify({ ok: false, code: 'not_found' }), { status: 404 }));
    expect(await fetchDesignPromptPicture({ organizationId: ORG, token: 'bad', page: 1 }, { fetch: failFetcher })).toEqual({
      ok: false,
      code: 'not_found',
    });
  });
});
