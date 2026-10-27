import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * docs/PLATFORM-2.0.md §3.2-4·5 and §15.3-6 — the wait and the result. The wait is three named
 * stages with a measured estimate and a calmer poll; the result leads with the object and offers
 * exactly three things to do with it; the 3-day link carries a share card (§12 "공유 카드").
 */

const state = vi.hoisted(() => ({
  job: null as Record<string, unknown> | null,
  shared: 'ok' as 'ok' | 'expired' | 'not_found',
  catalog: { video: [] as unknown[], image: [] as unknown[] },
  extras: { finishingAt: null as string | null, posterKey: null as string | null, ready: true },
  frames: [] as Array<{ frame: number; view: string; download: string; filename: string }>,
}));

const JOB_ID = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'a'.repeat(43);

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: () => undefined }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => ({ userId: 'u', email: 'a@b.c', isAdmin: false, tier: 'free', locale: 'ko' }) }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => ({}) }));
vi.mock('@/lib/i18n/server', () => ({ getLocaleFromHeaders: async () => 'ko', getRequestLocale: async () => 'ko' }));
vi.mock('@/lib/renders/runtime', () => ({ runLiveRenderPass: vi.fn() }));
vi.mock('@/app/actions/locale', () => ({ setLocaleAction: async () => undefined }));
// The poll's rhythm is tested below through `startRefreshLoop`; the component needs a mounted router.
vi.mock('@/components/renders/auto-refresh', () => ({ AutoRefresh: ({ since }: { since?: string }) => <i data-auto-refresh={since ?? ''} /> }));
vi.mock('@/lib/renders/eta', async (orig) => ({
  ...(await orig<typeof import('@/lib/renders/eta')>()),
  estimateRenderMinutes: async () => ({ minutes: 4, source: 'measured', samples: 12 }),
}));
vi.mock('@/lib/renders/service', () => ({
  failureReason: () => '엔진이 이번 요청을 처리하지 못했습니다.',
  loadOwnRender: async () => ({ templateTitle: 'Neon alley', templateTitleKo: '네온 골목', job: state.job }),
  loadSharedRender: async () =>
    state.shared === 'not_found' ? { status: 'not_found' } : { status: state.shared, view: { templateTitle: 'Neon alley', templateTitleKo: '네온 골목', job: state.job } },
}));
vi.mock('@/lib/renders/feedback', () => ({
  FEEDBACK_REASONS: ['face', 'playback', 'mismatch', 'other'],
  loadRenderFeedback: async () => null,
  submitRenderFeedback: async () => ({ ok: false, code: 'unavailable' }),
  notifyRenderFeedback: vi.fn(),
}));
vi.mock('@/lib/renders/extras', () => ({ loadRenderExtras: async () => state.extras }));
vi.mock('@/lib/renders/frames', () => ({ loadRenderFrames: async () => state.frames }));
// A client island that renders nothing; the marker says the page mounted it.
vi.mock('@/components/renders/poster-capture', () => ({ PosterCapture: ({ renderId }: { renderId: string }) => <i data-poster-capture={renderId} /> }));
vi.mock('@/lib/prompts/public-catalog', () => ({ getPromptCatalog: async () => ({ yagi: [], community: [], ...state.catalog }) }));

import RenderPage from '@/app/(app)/renders/[id]/page';
import SharedRenderPage, { generateMetadata as sharedMetadata } from '@/app/(app)/r/[id]/[token]/page';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { renderStage, stageSteps } from '@/components/renders/stage';
import { REFRESH_FAST_MS, REFRESH_SLOW_AFTER_MS, REFRESH_SLOW_MS, refreshDelay, startRefreshLoop } from '@/components/renders/refresh-schedule';
import { pickWaitCards } from '@/components/renders/wait-browse';
import { shareOrCopy } from '@/components/renders/share-result';
import { shareImageSource } from '@/lib/renders/share';
import { ETA_DEFAULT_SECONDS, ETA_MIN_SAMPLES, etaFromSamples, medianOf } from '@/lib/renders/eta';

const ko = getDictionary('ko');

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID, status: 'running', medium: 'video', aspect: '9:16', templateSlug: 'neon-alley-dolly', templateId: 't1',
    engine: 'seedance-2.5', locale: 'ko', createdAt: new Date().toISOString(), providerTaskId: 'cgt-123', resultMime: null,
    shareToken: null, shareExpiresAt: null, errorCode: null, finishedAt: null,
    ...overrides,
  };
}

function catalogCard(slug: string, medium: 'video' | 'image' = 'video') {
  return {
    id: `id-${slug}`, slug, title: slug, titleKo: null, authorHandle: null, source: 'yagi', models: [], modelLabels: [],
    useCase: ['cinematic'], medium, priceCents: 0, priceKrw: 0, price1080Cents: 0, price1080Krw: 0, runtimeSeconds: 15,
    engine: null, aspectDefault: '9:16', poster: { source: 'public', src: `https://media.example.test/${slug}.jpg`, mime: 'image/jpeg', w: 1080, h: 1350 },
    video: null, lock: null, featured: false, publishedAt: '2026-01-01T00:00:00.000Z',
  };
}

const renderPage = async () => renderToStaticMarkup(await RenderPage({ params: Promise.resolve({ id: JOB_ID }), searchParams: Promise.resolve({}) }));
const sharedPage = async () => renderToStaticMarkup(await SharedRenderPage({ params: Promise.resolve({ id: JOB_ID, token: TOKEN }) }));

beforeEach(() => {
  state.job = job();
  state.shared = 'ok';
  state.extras = { finishingAt: null, posterKey: null, ready: true };
  state.frames = [];
  state.catalog = { video: ['neon-alley-dolly', 'a', 'b', 'c', 'd', 'e'].map((slug) => catalogCard(slug)), image: [catalogCard('portrait', 'image')] };
});

describe('wait stages (photo check → making → finishing)', () => {
  it('maps every live status onto one of three stages', () => {
    expect(renderStage({ status: 'held', providerTaskId: null })).toBe('check');
    expect(renderStage({ status: 'queued', providerTaskId: null })).toBe('check');
    expect(renderStage({ status: 'running', providerTaskId: 'asset:abc' })).toBe('check');
    expect(renderStage({ status: 'running', providerTaskId: 'cgt-1' })).toBe('make');
    expect(renderStage({ status: 'running', providerTaskId: null })).toBe('make');
    expect(renderStage({ status: 'succeeded', providerTaskId: 'cgt-1' })).toBe('finish');
    expect(renderStage({ status: 'failed', providerTaskId: null })).toBeNull();
  });

  it('reads "finishing" once the pass recorded the provider’s done (0055 finishing_at)', () => {
    const at = '2026-10-23T08:00:00.000Z';
    expect(renderStage({ status: 'running', providerTaskId: 'cgt-1', finishingAt: at })).toBe('finish');
    expect(renderStage({ status: 'running', providerTaskId: 'cgt-1', finishingAt: null })).toBe('make');
    // Only a running job: a requeued or failed one is not finishing, whatever was recorded.
    expect(renderStage({ status: 'queued', providerTaskId: null, finishingAt: at })).toBe('check');
    expect(renderStage({ status: 'failed', providerTaskId: 'cgt-1', finishingAt: at })).toBeNull();
  });

  it('shows the third stage on the wait page, with "soon" instead of the minutes', async () => {
    state.extras = { finishingAt: new Date().toISOString(), posterKey: null, ready: true };
    const html = await renderPage();
    expect(html).toContain('data-render-stage="finish"');
    expect(html).toContain('data-stage-step="make" data-stage-state="done"');
    expect(html).toContain('data-stage-step="finish" data-stage-state="current"');
    expect(html).toContain(ko.renders.wait.body.finish);
    expect(html).toContain(ko.renders.wait.finishEta);
    expect(html).not.toContain('보통 4분쯤 걸려요');
    expect(/<[^>]*role="progressbar"[^>]*>/.exec(html)?.[0]).toContain('aria-valuenow="3"');
  });

  it('marks earlier steps done, the current one current, later ones to do', () => {
    expect(stageSteps('make')).toEqual([
      { key: 'check', state: 'done' },
      { key: 'make', state: 'current' },
      { key: 'finish', state: 'todo' },
    ]);
    expect(stageSteps('check').map((s) => s.state)).toEqual(['current', 'todo', 'todo']);
  });

  it('renders the stage, the estimate and the steps on the wait page, keeping the notify choice', async () => {
    const html = await renderPage();
    expect(html).toContain('data-render-stage="make"');
    expect(html).toContain('data-stage-step="check" data-stage-state="done"');
    expect(html).toContain('data-stage-step="make" data-stage-state="current"');
    expect(html).toContain('data-stage-step="finish" data-stage-state="todo"');
    expect(html).toContain(ko.renders.wait.steps.make);
    expect(html).toContain('보통 4분쯤 걸려요');
    expect(html).toContain('data-notify-choice');
    const bar = /<[^>]*role="progressbar"[^>]*>/.exec(html)?.[0] ?? '';
    expect(bar).toContain(`aria-label="${ko.renders.progressLabel}"`);
    expect(bar).toContain('aria-valuenow="2"');
    expect(bar).toContain('aria-valuemax="3"');
  });

  it('says "photo check" while the face asset is being made', async () => {
    state.job = job({ providerTaskId: 'asset:42' });
    expect(await renderPage()).toContain('data-render-stage="check"');
    state.job = job({ status: 'queued', providerTaskId: null });
    expect(await renderPage()).toContain('data-render-stage="check"');
  });

  it('offers three or four other formats to browse while waiting, never the one being made', async () => {
    const html = await renderPage();
    const browse = html.slice(html.indexOf('data-render-browse'));
    expect(html).toContain(ko.renders.wait.browseTitle);
    expect(browse).not.toContain('data-prompt-card="neon-alley-dolly"');
    expect((browse.match(/data-prompt-card="/g) ?? []).length).toBe(4);
    expect(browse).toContain('href="/ko/video"');
  });

  it('picks same-medium formats first and tops up from the other medium', () => {
    const catalog = { video: [catalogCard('x'), catalogCard('y')], image: [catalogCard('i1', 'image'), catalogCard('i2', 'image')] } as never;
    expect(pickWaitCards(catalog, { medium: 'video', exclude: 'x' }).map((c) => c.slug)).toEqual(['y', 'i1', 'i2']);
    expect(pickWaitCards(catalog, { medium: 'image', exclude: 'none', limit: 3 }).map((c) => c.slug)).toEqual(['i1', 'i2', 'x']);
  });

  it('a failure says why and that the money comes back, in full contrast', async () => {
    state.job = job({ status: 'failed', errorCode: 'engine_error', providerTaskId: null });
    const html = await renderPage();
    expect(html).toContain('data-render-failed');
    expect(html).toContain('엔진이 이번 요청을 처리하지 못했습니다.');
    expect(html).toMatch(new RegExp(`data-render-refund[^>]*>[^<]*${ko.renders.notCharged}`));
    expect(html).not.toContain('data-render-stage');
    expect(html).not.toMatch(/opacity-45/);
  });
});

describe('the poll (6s while visible, 15s after two minutes, nothing while hidden)', () => {
  afterEach(() => vi.useRealTimers());

  it('backs off after two minutes', () => {
    expect(refreshDelay(0)).toBe(REFRESH_FAST_MS);
    expect(refreshDelay(REFRESH_SLOW_AFTER_MS - 1)).toBe(REFRESH_FAST_MS);
    expect(refreshDelay(REFRESH_SLOW_AFTER_MS)).toBe(REFRESH_SLOW_MS);
    expect([REFRESH_FAST_MS, REFRESH_SLOW_MS, REFRESH_SLOW_AFTER_MS]).toEqual([6_000, 15_000, 120_000]);
  });

  function host() {
    let hidden = false;
    const listeners = new Set<() => void>();
    return {
      setHidden(value: boolean) { hidden = value; for (const l of listeners) l(); },
      api: {
        isHidden: () => hidden,
        onVisibilityChange: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
        now: () => Date.now(),
      },
    };
  }

  it('refreshes every 6s while visible, stops while hidden, catches up on return', () => {
    vi.useFakeTimers({ now: 0 });
    const refresh = vi.fn();
    const h = host();
    const stop = startRefreshLoop(refresh, h.api, 0);
    vi.advanceTimersByTime(6_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(6_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    h.setHidden(true);
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    h.setHidden(false);
    expect(refresh).toHaveBeenCalledTimes(3);
    stop();
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('waits 15s between refreshes once the job is two minutes old', () => {
    vi.useFakeTimers({ now: 200_000 });
    const refresh = vi.fn();
    const stop = startRefreshLoop(refresh, host().api, 200_000 - REFRESH_SLOW_AFTER_MS);
    vi.advanceTimersByTime(14_999);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it('a page opened hidden does not poll until it is shown', () => {
    vi.useFakeTimers({ now: 0 });
    const refresh = vi.fn();
    const h = host();
    h.setHidden(true);
    const stop = startRefreshLoop(refresh, h.api, 0);
    vi.advanceTimersByTime(30_000);
    expect(refresh).not.toHaveBeenCalled();
    stop();
  });
});

describe('the estimate (median of recent finished jobs, engine defaults below ten)', () => {
  it('takes the median', () => {
    expect(medianOf([])).toBeNull();
    expect(medianOf([300, 100, 200])).toBe(200);
    expect(medianOf([100, 200, 300, 400])).toBe(250);
  });

  it('falls back to 2 minutes for an image and 5 for a film below ten samples', () => {
    expect(ETA_MIN_SAMPLES).toBe(10);
    expect(ETA_DEFAULT_SECONDS).toEqual({ image: 120, video: 300 });
    expect(etaFromSamples(Array(9).fill(60), 'video')).toEqual({ minutes: 5, source: 'default', samples: 9 });
    expect(etaFromSamples([], 'image')).toEqual({ minutes: 2, source: 'default', samples: 0 });
    expect(etaFromSamples(Array(10).fill(200), 'video')).toEqual({ minutes: 3, source: 'measured', samples: 10 });
    // Never "0분": a fast engine still reads as about a minute.
    expect(etaFromSamples(Array(10).fill(10), 'image').minutes).toBe(1);
  });
});

describe('the result page (object first, then download · share · one more)', () => {
  beforeEach(() => {
    state.job = job({
      status: 'succeeded', resultMime: 'video/mp4', shareToken: TOKEN,
      shareExpiresAt: new Date(Date.now() + 86_400_000).toISOString(), finishedAt: new Date().toISOString(),
    });
  });

  it('puts the result above the title and the three actions right under it', async () => {
    const html = await renderPage();
    const media = html.indexOf('data-result-media');
    expect(media).toBeGreaterThan(-1);
    expect(media).toBeLessThan(html.indexOf('<h1'));
    const actions = html.slice(html.indexOf('data-result-actions'));
    const order = ['download', 'share', 'again'].map((a) => actions.indexOf(`data-result-action="${a}"`));
    expect(order.every((i) => i > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toMatch(/data-result-action="download"[^>]*href="\/api\/renders\/media\/[^"]*download=1"|href="\/api\/renders\/media\/[^"]*download=1"[^>]*data-result-action="download"/);
    expect(html).toMatch(/href="\/ko\/video"[^>]*data-result-action="again"|data-result-action="again"[^>]*href="\/ko\/video"/);
    expect(html).toContain(ko.renders.oneMore);
    // Feedback and rating still follow.
    expect(html.indexOf('data-render-feedback')).toBeGreaterThan(html.indexOf('data-result-actions'));
  });

  it('fits a portrait film to the screen height', async () => {
    const html = await renderPage();
    expect(html).toMatch(/data-result-media="video"[^>]*style="[^"]*100svh/);
  });

  it('captures the film’s frame once: only while it has none and the columns exist', async () => {
    expect(await renderPage()).toContain(`data-poster-capture="${JOB_ID}"`);
    state.extras = { finishingAt: null, posterKey: `${JOB_ID}/poster.jpg`, ready: true };
    expect(await renderPage()).not.toContain('data-poster-capture');
    state.extras = { finishingAt: null, posterKey: null, ready: false };
    expect(await renderPage()).not.toContain('data-poster-capture');
    state.extras = { finishingAt: null, posterKey: null, ready: true };
    state.job = { ...state.job!, resultMime: 'image/png', medium: 'image' };
    expect(await renderPage()).not.toContain('data-poster-capture');
  });

  it('drops the share action when there is no link', async () => {
    state.job = { ...state.job!, shareToken: null, shareExpiresAt: null };
    const html = await renderPage();
    expect(html).not.toContain('data-result-action="share"');
    expect(html).toContain('data-result-action="again"');
  });

  it('shares with the system sheet when there is one, else copies the 3-day link', async () => {
    const url = `https://twings.app/r/${JOB_ID}/${TOKEN}`;
    const share = vi.fn(async () => {});
    expect(await shareOrCopy({ share, clipboard: { writeText: vi.fn() } }, url, 'T')).toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: 'T', url });
    const writeText = vi.fn(async () => {});
    expect(await shareOrCopy({ clipboard: { writeText } }, url, 'T')).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(url);
    const abort = Object.assign(new Error('cancel'), { name: 'AbortError' });
    expect(await shareOrCopy({ share: async () => { throw abort; } }, url, 'T')).toBe('cancelled');
    expect(await shareOrCopy({ clipboard: { writeText: async () => { throw new Error('denied'); } } }, url, 'T')).toBe('failed');
    expect(await shareOrCopy({}, url, 'T')).toBe('failed');
  });
});

describe('a set of pictures (an image recipe with several frames)', () => {
  const frames = (share?: string) =>
    [1, 2, 3, 4, 5].map((frame) => {
      const s = share ? `s=${share}&` : '';
      return { frame, view: `/api/renders/media/${JOB_ID}?${s}frame=${frame}`, download: `/api/renders/media/${JOB_ID}?${s}frame=${frame}&download=1`, filename: `twings-bridal-${JOB_ID.slice(0, 8)}-${frame}.jpg` };
    });
  beforeEach(() => {
    state.job = job({
      status: 'succeeded', resultMime: 'image/jpeg', medium: 'image', aspect: '3:4', templateSlug: 'bridal', shareToken: TOKEN,
      shareExpiresAt: new Date(Date.now() + 86_400_000).toISOString(), finishedAt: new Date().toISOString(),
    });
  });

  it('shows every picture in order on the result page, each with its own save, and "save all" first', async () => {
    state.frames = frames();
    const html = await renderPage();
    expect(html).toContain('data-result-frames="5"');
    expect(html).not.toContain('data-result-media');
    const order = [1, 2, 3, 4, 5].map((n) => html.indexOf(`data-result-frame="${n}"`));
    expect(order.every((i) => i > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain(`src="/api/renders/media/${JOB_ID}?frame=5"`);
    expect(html).toContain(`href="/api/renders/media/${JOB_ID}?frame=3&amp;download=1"`);
    expect(html).toContain(`download="twings-bridal-${JOB_ID.slice(0, 8)}-3.jpg"`);
    expect(html).toContain('5장 모두 저장');
    expect(html).toContain('data-save-frames="5"');
    expect(html).toContain('사진 5장 · 3:4');
    expect(html).toContain('옆으로 넘기면 5장을 모두 볼 수 있어요.');
    // Still three actions, in the same order, under the pictures.
    const actions = html.slice(html.indexOf('data-result-actions'));
    expect(['download', 'share', 'again'].map((a) => actions.indexOf(`data-result-action="${a}"`)).every((i) => i > -1)).toBe(true);
    expect(html.indexOf('data-result-frames')).toBeLessThan(html.indexOf('<h1'));
  });

  it('keeps one result exactly as before', async () => {
    const html = await renderPage();
    expect(html).toContain('data-result-media="image"');
    expect(html).not.toContain('data-result-frames');
    expect(html).not.toContain('data-save-frames');
  });

  it('opens every picture behind the 3-day token on the share page; the card is the first', async () => {
    state.frames = frames(TOKEN);
    const html = await sharedPage();
    expect(html).toContain('data-result-frames="5"');
    expect(html).toContain(`src="/api/renders/media/${JOB_ID}?s=${TOKEN}&amp;frame=4"`);
    expect(html).toContain('data-save-frames="5"');
    expect(html).toContain('사진 5장');
    const og = (await sharedMetadata({ params: Promise.resolve({ id: JOB_ID, token: TOKEN }) })).openGraph as { images: Array<{ url: string }> };
    expect(og.images[0]!.url).toContain(`/api/renders/media/${JOB_ID}?s=${TOKEN}`);
    expect(og.images[0]!.url).not.toContain('frame=');
  });
});

describe('the share card on /r/{id}/{token} (§12: their frame + "make yours")', () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_APP_URL;
  beforeAll(() => { process.env.NEXT_PUBLIC_APP_URL = 'https://twings.app'; });
  afterAll(() => { if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_APP_URL; else process.env.NEXT_PUBLIC_APP_URL = ORIGINAL; });
  beforeEach(() => {
    state.job = job({
      status: 'succeeded', resultMime: 'image/png', shareToken: TOKEN, aspect: '4:5', medium: 'image',
      shareExpiresAt: new Date(Date.now() + 86_400_000).toISOString(), finishedAt: new Date().toISOString(),
    });
  });
  const meta = () => sharedMetadata({ params: Promise.resolve({ id: JOB_ID, token: TOKEN }) });

  it('an image result is its own card image', async () => {
    const m = await meta();
    expect(m.title).toBe('내 얼굴로 만든 네온 골목');
    const og = m.openGraph as { title: string; images: Array<{ url: string }> };
    expect(og.title).toBe('내 얼굴로 만든 네온 골목');
    expect(og.images[0]!.url).toBe(`https://twings.app/api/renders/media/${JOB_ID}?s=${TOKEN}`);
    expect((m.twitter as { card: string }).card).toBe('summary_large_image');
    expect(m.robots).toEqual({ index: false, follow: false });
  });

  it('a film uses the template poster until its owner’s browser sent a frame', async () => {
    state.job = { ...state.job!, resultMime: 'video/mp4', medium: 'video', aspect: '9:16' };
    const og = (await meta()).openGraph as { images: Array<{ url: string }> };
    expect(og.images[0]!.url).toBe('https://media.example.test/neon-alley-dolly.jpg');
  });

  it('a film with a captured frame uses it, behind the same token', async () => {
    state.job = { ...state.job!, resultMime: 'video/mp4', medium: 'video', aspect: '9:16' };
    state.extras = { finishingAt: null, posterKey: `${JOB_ID}/poster.jpg`, ready: true };
    const og = (await meta()).openGraph as { images: Array<{ url: string }> };
    expect(og.images[0]!.url).toBe(`https://twings.app/api/renders/media/${JOB_ID}?s=${TOKEN}&poster=1`);
    expect(await sharedPage()).toContain(`poster="/api/renders/media/${JOB_ID}?s=${TOKEN}&amp;poster=1"`);
  });

  it('picks the card image: an image result, else the film’s frame, else the template', () => {
    expect(shareImageSource('image/png', null)).toBe('result');
    expect(shareImageSource('image/png', 'x/poster.jpg')).toBe('result');
    expect(shareImageSource('video/mp4', 'x/poster.jpg')).toBe('frame');
    expect(shareImageSource('video/mp4', null)).toBe('template');
    expect(shareImageSource(null, 'x/poster.jpg')).toBe('template');
  });

  it('an expired or unknown link carries no card and stays out of the index', async () => {
    state.shared = 'expired';
    const expired = await meta();
    expect(expired.openGraph).toBeUndefined();
    expect(expired.robots).toEqual({ index: false, follow: false });
    state.shared = 'not_found';
    expect((await meta()).openGraph).toBeUndefined();
  });

  it('ends with "make yours" pointing at the template page', async () => {
    const html = await sharedPage();
    expect(html).toContain('data-make-yours');
    expect(html).toMatch(/href="\/ko\/t\/neon-alley-dolly"[^>]*data-make-yours|data-make-yours[^>]*href="\/ko\/t\/neon-alley-dolly"/);
    expect(html.indexOf('data-make-yours')).toBeGreaterThan(html.indexOf('data-result-media'));
    expect(html).toContain('내 얼굴로 만든 네온 골목');
  });
});
