import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { prerender } from 'react-dom/static';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OutcomeBanner } from '@/components/admin/chrome';
import { refusalMessage } from '@/components/admin/prompt-create-feedback';
import { PromptFields } from '@/components/admin/prompt-fields';
import { TemplateStylingHelper } from '@/components/admin/template-styling-helper';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { loadPromptBySlug, type PromptRow } from '@/lib/prompts/repo';
import { lockRefusalCopy } from '@/lib/template-director/locks';
import {
  TEMPLATE_STYLING_DEFAULT_BLOCK,
  checkStylingBlock,
  renderStylingBlock,
  stylingHelperBlock,
  stylingRequiredDetail,
} from '@/lib/template-director/styling';
import { adminHarness, upload, type AdminHarness } from '../helpers/admin';
import { runner } from '../helpers/pglite';

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

import AdminPromptNewPage from '@/app/(admin)/admin/prompts/new/page';

/**
 * docs/PERSONAL-STUDIO.md §3.4.9 — rule 3 on the save side (founder, 2026-11-25: what a template does not specify
 * follows the buyer's photo). A NEW person template (video or image, solo or couple; a pet template has no hair or
 * makeup to declare) must say how its hair and makeup are made: `prompt.create` and every frame of `prompt.createSet`
 * refuse a prompt with no `Template styling:` block (`stylingRequired`). An UPDATE of a template saved without one is
 * not refused: the edit form shows a warning line, and existing templates are declared one by one after review. The
 * admin forms offer a helper that writes the block (photo by default) into the prompt field.
 */

const BASE = 'A woman walks through a neon alley at night while the camera dollies back slowly.';
const ko = getDictionary('ko');
const a = ko.admin;

describe('prompt.create and prompt.createSet require a styling block for a person template', () => {
  let harness: AdminHarness;
  const sql = () => runner(harness.db);
  beforeEach(async () => {
    harness = await adminHarness();
  });
  afterEach(async () => harness.close());

  const authoring = (promptText: string, extra: Record<string, string> = {}) => ({
    title: 'Rule three',
    titleKo: '규칙 셋',
    promptText,
    useCase: 'brand-ad',
    textVisibility: 'public',
    models: ['seedance-2.5'],
    poster: upload('poster.png', 'POSTER-BYTES', 'image/png'),
    ...extra,
  });

  it('refuses a person video, image or couple template without a block, and writes nothing', async () => {
    const cases: Array<Record<string, string>> = [{}, { medium: 'video', runtimeSeconds: '10' }, { medium: 'image' }, { cast: 'couple' }, { cast: 'solo' }];
    for (const extra of cases) {
      expect(await harness.run('prompt.create', authoring(BASE, extra)), JSON.stringify(extra)).toEqual({
        ok: false,
        code: 'stylingRequired',
        detail: 'promptText: template styling: missing',
      });
    }
    expect(await loadPromptBySlug(sql(), 'rule-three')).toBeNull();
    expect(harness.promptsRevalidated).toBe(0);
  });

  it('creates a pet template without one, and a person template with the default block or any valid block', async () => {
    expect(await harness.run('prompt.create', authoring(BASE, { cast: 'pet' }))).toMatchObject({ ok: true, code: 'published' });
    expect((await loadPromptBySlug(sql(), 'rule-three'))!.promptText).toBe(BASE);
    for (const [n, block] of [
      [2, TEMPLATE_STYLING_DEFAULT_BLOCK],
      [3, renderStylingBlock([{ part: 'hair', from: 'template', note: 'a sleek low bun.' }])],
      [4, renderStylingBlock([{ part: 'outfit', from: 'photo' }])],
    ] as const) {
      const text = `${BASE}\n\n${block}`;
      expect(await harness.run('prompt.create', { ...authoring(text), title: `Rule three ${n}` })).toMatchObject({ ok: true });
      expect((await loadPromptBySlug(sql(), `rule-three-${n}`))!.promptText).toBe(text);
    }
  });

  it('a block that does not read is refused as before (invalid, naming the line), not as missing', async () => {
    const outcome = await harness.run('prompt.create', authoring(`${BASE}\n\nTemplate styling:\n- Styled by the template: the shoes — red.`));
    expect(outcome).toMatchObject({ ok: false, code: 'invalid' });
    expect(outcome.detail).toMatch(/^promptText: template styling: line 4 unknown_line/);
  });

  it('an update of a template saved without a block is not refused', async () => {
    expect(await harness.run('prompt.create', authoring(BASE, { cast: 'pet' }))).toMatchObject({ ok: true });
    const row = (await loadPromptBySlug(sql(), 'rule-three'))!;
    // Saved before the rule: a person template without a block.
    await sql().query("update prompt_items set cast_kind = 'solo' where id = $1", [row.id]);
    const edit = {
      id: row.id, slug: row.slug, title: row.title, titleKo: row.titleKo ?? '', promptText: `${BASE} Edited.`, useCase: 'brand-ad',
      handle: '', textVisibility: row.textVisibility, featured: '', models: row.models, cast: 'solo',
    };
    expect(await harness.run('prompt.update', edit)).toMatchObject({ ok: true, code: 'saved' });
    expect((await loadPromptBySlug(sql(), 'rule-three'))!.promptText).toBe(`${BASE} Edited.`);
  });

  it('an image set: every frame the compile reads must declare it; the refusal names the frames', async () => {
    const photo = (n: number) => `Image 1 is the person. Keep their face. Frame ${n}, a quiet studio portrait.`;
    const set = (prompts: [string, string, string]) => ({
      title: 'Three Portraits',
      titleKo: '초상 세 컷',
      engine: 'nano-banana-pro',
      aspect: '4:5',
      frameCount: '3',
      thumbnail: '0',
      frame0Prompt: prompts[0],
      frame1Prompt: prompts[1],
      frame2Prompt: prompts[2],
      frame0Size: '1856x2304',
      frame1Size: '1856x2304',
      frame2Size: '1856x2304',
      frame0: upload('one.webp', 'ONE', 'image/webp'),
      frame1: upload('two.webp', 'TWO', 'image/webp'),
      frame2: upload('three.webp', 'THREE', 'image/webp'),
    });
    const declared = (n: number) => `${photo(n)}\n\n${TEMPLATE_STYLING_DEFAULT_BLOCK}`;
    expect(await harness.run('prompt.createSet', set([photo(1), declared(2), photo(3)]))).toEqual({
      ok: false,
      code: 'stylingRequired',
      detail: 'frame 1: template styling: missing; frame 3: template styling: missing',
    });
    expect(await loadPromptBySlug(sql(), 'three-portraits')).toBeNull();
    expect(await harness.run('prompt.createSet', set([declared(1), declared(2), declared(3)]))).toMatchObject({ ok: true });
  });
});

describe('the refusal is said with the example block', () => {
  it('the detail, the example and the banner', () => {
    expect(stylingRequiredDetail('promptText')).toBe('promptText: template styling: missing');
    expect(TEMPLATE_STYLING_DEFAULT_BLOCK).toBe('Template styling:\n- Taken from the photo: the hairstyle.\n- Taken from the photo: the makeup.');
    expect(checkStylingBlock(TEMPLATE_STYLING_DEFAULT_BLOCK)).toEqual({ state: 'ok', styling: { styled: [], photo: ['hair', 'makeup'] } });
    for (const locale of ['ko', 'en'] as const) {
      const dict = getDictionary(locale).admin;
      const banner = renderToStaticMarkup(createElement(OutcomeBanner, { dict, err: 'stylingRequired', detail: stylingRequiredDetail('promptText') }));
      expect(banner).toContain(dict.errStylingRequired);
    }
    expect(a.errStylingRequired).toBe('헤어와 메이크업을 템플릿이 정하는지, 구매자 사진을 따르는지 적어 주세요.');
  });

  it('the new-template screen (with JS): the message and the example block, on the prompt field', () => {
    const labels = {
      useCase: 'U', poster: 'P', invalid: a.errInvalid, upload: 'UP', session: 'S', uncertain: 'UN', retained: 'R', publishing: 'PB',
      lockCopy: lockRefusalCopy(a), stylingRequired: a.errStylingRequired, stylingExample: TEMPLATE_STYLING_DEFAULT_BLOCK,
    };
    const refusal = refusalMessage({ ok: false, code: 'stylingRequired', field: 'promptText' }, labels);
    expect(refusal).toEqual({ message: a.errStylingRequired, lock: null, example: TEMPLATE_STYLING_DEFAULT_BLOCK });
    // Any other answer keeps its one line and no example.
    expect(refusalMessage({ ok: false, code: 'invalid' }, labels)).toEqual({ message: a.errInvalid, lock: null });
  });

  it('the new-template screen (without JS): the banner and the example block under it', async () => {
    const page = await AdminPromptNewPage({ searchParams: Promise.resolve({ err: 'stylingRequired', detail: stylingRequiredDetail('promptText') }) });
    const html = await new Response((await prerender(page)).prelude).text();
    expect(html).toContain(a.errStylingRequired);
    expect(html).toContain('data-styling-required');
    expect(html).toContain('- Taken from the photo: the hairstyle.');
  });
});

describe('the helper and the warning line in the admin forms', () => {
  const row = (promptText: string, cast: PromptRow['cast'] = 'solo') =>
    ({
      id: '00000000-0000-4000-8000-000000000001', slug: 'rule-three', title: 'Rule three', titleKo: '규칙 셋', promptText, processMd: null,
      processMdKo: null, sourceUrl: null, models: ['seedance-2.5'], useCase: ['brand-ad'], authorHandle: null, textVisibility: 'public',
      featured: false, media: null, medium: 'video', cast, priceCents: 0, priceKrw: 0, price1080Cents: 0, price1080Krw: 0,
      runtimeSeconds: 10, engine: null, aspectDefault: null, source: 'yagi', status: 'published', audience: 'public', authorId: null,
      rejectReason: null, announcedAt: null, createdAt: null, publishedAt: null,
    }) as unknown as PromptRow;
  const fields = (r: PromptRow | null) => renderToStaticMarkup(createElement(PromptFields, { row: r, dict: ko }));

  it('new form: the helper sits above the prompt field', () => {
    const html = fields(null);
    expect(html).toContain('data-styling-helper');
    expect(html.indexOf('data-styling-helper')).toBeLessThan(html.indexOf('name="promptText"'));
    expect(html).not.toContain('data-template-styling="missing"');
  });

  it('edit form: helper and warning for a person template without a block; nothing for a pet or a declared one', () => {
    const plain = fields(row(BASE));
    expect(plain).toContain('data-styling-helper');
    expect(plain).toContain('data-template-styling="missing"');
    expect(plain).toContain(a.templateStylingMissing);
    for (const html of [fields(row(BASE, 'pet')), fields(row(`${BASE}\n\n${TEMPLATE_STYLING_DEFAULT_BLOCK}`))]) {
      expect(html).not.toContain('data-styling-helper');
      expect(html).not.toContain('data-template-styling="missing"');
    }
    // A recipe template's order reads its steps, not this text: the styling panel declares it there instead.
    const recipe = renderToStaticMarkup(createElement(PromptFields, { row: row(BASE), dict: ko, recipeTemplate: true }));
    expect(recipe).not.toContain('data-styling-helper');
    expect(recipe).not.toContain('data-template-styling="missing"');
  });

  it('the helper: two parts, two choices each, photo by default; nothing is posted with the form', () => {
    const html = renderToStaticMarkup(createElement(TemplateStylingHelper, { copy: a.stylingHelper, partLabels: { hair: ko.editSheet.slots.hair, makeup: ko.editSheet.slots.makeup }, initialPrompt: '', initialCast: 'solo' }));
    expect(html).toContain(a.stylingHelper.photo);
    expect(html).toContain(a.stylingHelper.template);
    expect(a.stylingHelper.photo).toBe('사진 따름 (기본)');
    expect(a.stylingHelper.template).toBe('템플릿이 정함');
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(2);
    expect(html).toContain('data-styling-helper-part="hair"');
    expect(html).toContain('data-styling-helper-part="makeup"');
    expect(html).toContain('data-styling-helper-insert');
    // No named control: the helper writes into the prompt field, it posts nothing of its own.
    expect(html).not.toMatch(/\sname="/);
    // A pet template or a prompt that already declares it: no helper.
    // (An empty, hidden anchor stays so the helper can come back when the cast or the prompt changes.)
    for (const [initialPrompt, initialCast] of [['', 'pet'], [`${BASE}\n\n${TEMPLATE_STYLING_DEFAULT_BLOCK}`, 'solo']] as const) {
      const hidden = renderToStaticMarkup(createElement(TemplateStylingHelper, { copy: a.stylingHelper, partLabels: { hair: 'H', makeup: 'M' }, initialPrompt, initialCast }));
      expect(hidden).toBe('<span hidden="" data-styling-anchor="true"></span>');
    }
  });

  it('the block the helper writes: the photo by default, a template style with its description, checked like a save', () => {
    expect(stylingHelperBlock({ hair: { from: 'photo' }, makeup: { from: 'photo' } })).toEqual({ ok: true, block: TEMPLATE_STYLING_DEFAULT_BLOCK });
    const styled = stylingHelperBlock({ hair: { from: 'template', note: '  a sleek   low bun ' }, makeup: { from: 'photo' } });
    expect(styled).toEqual({ ok: true, block: 'Template styling:\n- Styled by the template: the hairstyle — a sleek low bun\n- Taken from the photo: the makeup.' });
    if (styled.ok) expect(checkStylingBlock(styled.block).state).toBe('ok');
    // A description that is missing, too long, carries a handle or talks about the photo is refused, by part.
    expect(stylingHelperBlock({ hair: { from: 'template', note: '' }, makeup: { from: 'photo' } })).toEqual({ ok: false, parts: ['hair'] });
    expect(stylingHelperBlock({ hair: { from: 'photo' }, makeup: { from: 'template', note: 'x'.repeat(121) } })).toEqual({ ok: false, parts: ['makeup'] });
    expect(stylingHelperBlock({ hair: { from: 'template', note: 'from @Image 2' }, makeup: { from: 'template', note: 'as in the photo' } })).toEqual({ ok: false, parts: ['hair', 'makeup'] });
  });
});
