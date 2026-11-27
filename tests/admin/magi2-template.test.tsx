import { renderToStaticMarkup } from 'react-dom/server';
import { prerender } from 'react-dom/static';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/i18n/server', () => ({ getLocaleFromHeaders: async () => 'ko' }));
vi.mock('@/lib/routing/request-surface', () => ({
  requestSurface: async () => ({ admin: true, brand: false, workspace: true, origin: 'https://admin.twings.app' }),
  publicHref: (path: string, admin: boolean) => (admin ? `https://twings.app${path}` : path),
}));
vi.mock('@/lib/auth/viewer', () => ({
  requireAdmin: async () => ({ tier: 'admin', userId: 'u', email: null, isAdmin: true, locale: 'ko' }),
  getViewer: async () => ({ tier: 'admin', userId: 'u', email: null, isAdmin: true, locale: 'ko' }),
}));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => null }));

import AdminPromptNewPage from '@/app/(admin)/admin/prompts/new/page';
import { PromptFields } from '@/components/admin/prompt-fields';
import { PromptLengthRefusalNote, PromptLengthStatus } from '@/components/admin/prompt-length-status';
import { refusalMessage } from '@/components/admin/prompt-create-feedback';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { loadPromptBySlug } from '@/lib/prompts/repo';
import { buildRenderPrompt } from '@/lib/renders/prompt';
import { TEMPLATE_STYLING_DEFAULT_BLOCK } from '@/lib/template-director/styling';
import { adminHarness, upload, type AdminHarness } from '../helpers/admin';
import { runner } from '../helpers/pglite';

const LINE = buildRenderPrompt({ promptText: 'A woman walks.', medium: 'video', hasPhoto: true }).text.length - 'A woman walks.'.length;
const fill = (total: number): string => {
  const head = 'A woman walks through a white studio while the camera pushes in slowly on her face. ';
  const tail = `\n\n${TEMPLATE_STYLING_DEFAULT_BLOCK}`;
  return `${head}${'x'.repeat(total - LINE - head.length - tail.length)}${tail}`;
};

async function renderPage(node: React.ReactElement): Promise<string> {
  const { prelude } = await prerender(node);
  return new Response(prelude).text();
}

describe('admin MAGI-2 form & validation', () => {
  const ko = getDictionary('ko');
  const en = getDictionary('en');
  let harness: AdminHarness;
  const sql = () => runner(harness.db);

  beforeEach(async () => {
    harness = await adminHarness();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await harness.close();
  });

  it('hides MAGI-2 in PromptFields and /admin/prompts/new when the flag is off, and shows the labeled option + hint when on', async () => {
    const closedHtml = renderToStaticMarkup(<PromptFields row={null} dict={ko} />);
    expect(closedHtml).not.toContain('value="magi-2"');
    expect(closedHtml).not.toContain('MAGI-2');
    expect(closedHtml).not.toContain('data-admin-engine-hint="magi-2"');

    const closedPage = await renderPage(await AdminPromptNewPage({ searchParams: Promise.resolve({}) }));
    expect(closedPage).not.toContain('value="magi-2"');
    expect(closedPage).not.toContain('data-admin-engine-hint="magi-2"');

    const openKo = renderToStaticMarkup(<PromptFields row={null} dict={ko} magi2Open />);
    expect(openKo).toContain('<option value="magi-2">영상 · MAGI-2</option>');
    expect(openKo).not.toContain('>영상 · magi-2<');
    expect(openKo).toContain('data-admin-engine-hint="magi-2"');
    expect(openKo).toContain('1080p');

    const openEn = renderToStaticMarkup(<PromptFields row={null} dict={en} magi2Open />);
    expect(openEn).toContain('<option value="magi-2">Video · MAGI-2</option>');
    expect(openEn).toContain('data-admin-engine-hint="magi-2"');
    expect(openEn).toContain('1080p');

    vi.stubEnv('TWINGS_PERSONAL_SUNRA_FACES', 'on');
    vi.stubEnv('TWINGS_PERSONAL_MAGI2', 'on');
    const openPage = await renderPage(await AdminPromptNewPage({ searchParams: Promise.resolve({}) }));
    expect(openPage).toContain('value="magi-2"');
    expect(openPage).toContain('data-admin-engine-hint="magi-2"');
  });

  it('refuses magi-2 in prompt.create & prompt.update when flag is off, matching unknown-engine refusal', async () => {
    const base = {
      title: 'Magi flag off',
      titleKo: '마기 플래그 끔',
      promptText: fill(300),
      useCase: 'brand-ad',
      textVisibility: 'public',
      models: ['seedance-2.5'],
      medium: 'video',
      runtimeSeconds: 10,
      priceCents: 200,
      priceKrw: 2000,
      poster: upload('poster.png', 'POSTER-BYTES', 'image/png'),
    };
    const unknownOutcome = await harness.run('prompt.create', { ...base, engine: 'not-a-real-engine' });
    const offOutcome = await harness.run('prompt.create', { ...base, engine: 'magi-2' });
    expect(offOutcome).toEqual(unknownOutcome);
    expect(offOutcome).toEqual({ ok: false, code: 'invalid', detail: 'engine: not a video engine' });

    vi.stubEnv('TWINGS_PERSONAL_MAGI2', 'on');
    expect(await harness.run('prompt.create', { ...base, engine: 'magi-2' })).toEqual(unknownOutcome);
  });

  it('accepts magi-2 when both flags are on, requires single price only (refuses price_1080), and names MAGI-2 in length refusals', async () => {
    vi.stubEnv('TWINGS_PERSONAL_SUNRA_FACES', 'on');
    vi.stubEnv('TWINGS_PERSONAL_MAGI2', 'on');

    const base = {
      title: 'Magi open test',
      titleKo: '마기 테스트',
      promptText: fill(15_000),
      useCase: 'brand-ad',
      textVisibility: 'public',
      models: ['seedance-2.5'],
      medium: 'video',
      engine: 'magi-2',
      runtimeSeconds: 10,
      priceCents: 200,
      priceKrw: 2000,
      poster: upload('poster.png', 'POSTER-BYTES', 'image/png'),
    };

    const twoPrices = await harness.run('prompt.create', { ...base, price1080Cents: 300, price1080Krw: 3000 });
    expect(twoPrices).toMatchObject({ ok: false, code: 'invalid', detail: expect.stringMatching(/price1080Krw/) });

    const created = await harness.run('prompt.create', base);
    expect(created).toMatchObject({ ok: true, code: 'published' });
    const row = (await loadPromptBySlug(sql(), 'magi-open-test'))!;
    expect(row.engine).toBe('magi-2');
    expect(row.priceKrw).toBe(2000);
    expect(row.price1080Krw).toBe(0);

    const floorHtml = renderToStaticMarkup(<PromptFields row={row} dict={ko} magi2Open />);
    const costFloorEl = /<p data-cost-floor=[^>]*>.*?<\/p>/.exec(floorHtml)?.[0] ?? '';
    expect(costFloorEl).toContain('1080p');
    expect(costFloorEl).not.toContain('720p');

    const editBadPrice = await harness.run('prompt.update', {
      id: row.id,
      slug: row.slug,
      title: row.title,
      titleKo: row.titleKo ?? '',
      promptText: row.promptText,
      useCase: 'brand-ad',
      handle: '',
      textVisibility: row.textVisibility,
      featured: '',
      models: row.models,
      medium: 'video',
      engine: 'magi-2',
      runtimeSeconds: 10,
      priceCents: 200,
      priceKrw: 2000,
      price1080Cents: 400,
      price1080Krw: 4000,
    });
    expect(editBadPrice).toMatchObject({ ok: false, code: 'invalid', detail: expect.stringMatching(/price1080Krw/) });

    const tooLong = await harness.run('prompt.create', { ...base, title: 'Magi over limit', promptText: fill(15_001) });
    expect(tooLong).toEqual({
      ok: false,
      code: 'invalid',
      detail: 'promptText: prompt length: clip 1 is 15,001 characters; MAGI-2 takes up to 15,000 per clip',
    });
    expect(tooLong.detail).not.toContain('Seedance 2.5');

    const noteHtml = renderToStaticMarkup(<PromptLengthRefusalNote detail={tooLong.detail} dict={ko} />);
    expect(noteHtml).toContain('MAGI-2');
    expect(noteHtml).not.toContain('Seedance 2.5');

    const statusHtml = renderToStaticMarkup(
      <PromptLengthStatus clips={[{ clip: 1, stepId: null, chars: 15_001, limit: 15_000 }]} dict={ko} engine="magi-2" />,
    );
    expect(statusHtml).toContain('MAGI-2');
    expect(statusHtml).not.toContain('Seedance 2.5');

    const fb = refusalMessage(
      { ok: false, code: 'invalid', field: 'promptText', detail: tooLong.detail },
      {
        useCase: 'u',
        poster: 'p',
        invalid: ko.admin.errInvalid,
        upload: 'up',
        session: 's',
        uncertain: 'x',
        retained: 'r',
        publishing: 'pb',
        lengthCopy: ko.admin.promptLengthRefusal,
        lengthCopyForEngine: ko.admin.promptLengthRefusalForEngine,
      },
    );
    expect(fb.message).toContain('MAGI-2');
    expect(fb.message).not.toContain('Seedance 2.5');
  });

  it('preserves stored magi-2 engine in the edit select and allows unrelated edits even after the flag is turned off', async () => {
    vi.stubEnv('TWINGS_PERSONAL_SUNRA_FACES', 'on');
    vi.stubEnv('TWINGS_PERSONAL_MAGI2', 'on');
    await harness.run('prompt.create', {
      title: 'Magi preserved',
      titleKo: '마기 유지',
      promptText: fill(300),
      useCase: 'brand-ad',
      textVisibility: 'public',
      models: ['seedance-2.5'],
      medium: 'video',
      engine: 'magi-2',
      runtimeSeconds: 10,
      priceCents: 200,
      priceKrw: 2000,
      poster: upload('poster.png', 'POSTER-BYTES', 'image/png'),
    });
    const stored = (await loadPromptBySlug(sql(), 'magi-preserved'))!;

    vi.unstubAllEnvs();

    const closedEditHtmlKo = renderToStaticMarkup(<PromptFields row={stored} dict={ko} magi2Open={false} />);
    expect(closedEditHtmlKo).toContain(`<option value="magi-2" selected="">영상 · MAGI-2 (${ko.admin.templateEngineOff})</option>`);
    expect(closedEditHtmlKo).not.toContain('data-admin-engine-hint="magi-2"');

    const closedEditHtmlEn = renderToStaticMarkup(<PromptFields row={stored} dict={en} magi2Open={false} />);
    expect(closedEditHtmlEn).toContain(`<option value="magi-2" selected="">Video · MAGI-2 (${en.admin.templateEngineOff})</option>`);

    const unrelatedEdit = await harness.run('prompt.update', {
      id: stored.id,
      slug: stored.slug,
      title: 'Magi preserved updated title',
      titleKo: '마기 유지 제목 수정',
      promptText: stored.promptText,
      useCase: 'brand-ad',
      handle: '',
      textVisibility: stored.textVisibility,
      featured: '',
      models: stored.models,
      medium: 'video',
      engine: 'magi-2',
      runtimeSeconds: 10,
      priceCents: 200,
      priceKrw: 2000,
      price1080Cents: 0,
      price1080Krw: 0,
    });
    expect(unrelatedEdit).toMatchObject({ ok: true, code: 'saved' });
    const after = (await loadPromptBySlug(sql(), stored.slug))!;
    expect(after.title).toBe('Magi preserved updated title');
    expect(after.engine).toBe('magi-2');

    // Switching from an offered engine to unoffered magi-2, or from magi-2 to an unknown engine, is still refused.
    const badChange = await harness.run('prompt.update', {
      id: stored.id,
      slug: stored.slug,
      title: stored.title,
      titleKo: stored.titleKo ?? '마기 유지',
      promptText: stored.promptText,
      useCase: 'brand-ad',
      handle: '',
      textVisibility: stored.textVisibility,
      featured: '',
      models: stored.models,
      medium: 'video',
      engine: 'not-a-real-engine',
      runtimeSeconds: 10,
      priceCents: 200,
      priceKrw: 2000,
    });
    expect(badChange).toEqual({ ok: false, code: 'invalid', detail: 'engine: not a video engine' });

    await harness.run('prompt.update', {
      id: stored.id,
      slug: stored.slug,
      title: stored.title,
      titleKo: stored.titleKo ?? '마기 유지',
      promptText: stored.promptText,
      useCase: 'brand-ad',
      handle: '',
      textVisibility: stored.textVisibility,
      featured: '',
      models: stored.models,
      medium: 'video',
      engine: 'seedance-2.0',
      runtimeSeconds: 10,
      priceCents: 200,
      priceKrw: 2000,
    });
    const cannotSwitchBack = await harness.run('prompt.update', {
      id: stored.id,
      slug: stored.slug,
      title: stored.title,
      titleKo: stored.titleKo ?? '마기 유지',
      promptText: stored.promptText,
      useCase: 'brand-ad',
      handle: '',
      textVisibility: stored.textVisibility,
      featured: '',
      models: stored.models,
      medium: 'video',
      engine: 'magi-2',
      runtimeSeconds: 10,
      priceCents: 200,
      priceKrw: 2000,
    });
    expect(cannotSwitchBack).toEqual({ ok: false, code: 'invalid', detail: 'engine: not a video engine' });
  });
});
