import { prerender } from 'react-dom/static';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { refusalMessage } from '@/components/admin/prompt-create-feedback';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { interpolate } from '@/lib/i18n/format';
import { loadPromptBySlug } from '@/lib/prompts/repo';
import { TEMPLATE_KEEP_LINE_PREFIX, lockRefusalCopy, lockRefusalLines } from '@/lib/template-director/locks';
import { TEMPLATE_STYLING_KEY_PHRASES } from '@/lib/template-director/styling';
import { adminHarness, upload, type AdminHarness } from '../helpers/admin';
import { runner } from '../helpers/pglite';

const state = vi.hoisted(() => ({ sql: null as unknown }));

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
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => state.sql }));

import AdminPromptItemPage from '@/app/(admin)/admin/prompts/[id]/page';

/**
 * docs/PERSONAL-STUDIO.md §3.4.9 (S1) — the admin save checks a `Template styling:` block where it checks the lock
 * block (`prompt.create`, `prompt.update`, every frame of `prompt.createSet`): a block that does not parse, or that
 * declares a locked part, is refused with the lines named; a valid block saves as written.
 */

const KEEP = TEMPLATE_KEEP_LINE_PREFIX;
const STYLED = '- Styled by the template: ';
const BASE = 'A woman walks through a neon alley at night while the camera dollies back slowly.';
const HAIR = `${STYLED}the hairstyle — a sleek low bun.`;
const VALID = [BASE, '', 'Template styling:', HAIR, `${STYLED}the makeup — 1990s smoky plum eyes and lips.`].join('\n');
const MALFORMED = [BASE, '', 'Template styling:', `${STYLED}the shoes — red heels.`, HAIR].join('\n');
const LOCKED = [BASE, '', 'Template locks:', `${KEEP}the hairstyle.`, '', 'Template styling:', HAIR].join('\n');
const BOTH_BAD = [BASE, '', 'Template locks:', `${KEEP}the shoes.`, '', 'Template styling:', `${STYLED}the shoes — red.`].join('\n');

const a = getDictionary('ko').admin;

describe('prompt.create, prompt.update and prompt.createSet check the styling block', () => {
  let harness: AdminHarness;
  const sql = () => runner(harness.db);
  beforeEach(async () => {
    harness = await adminHarness();
  });
  afterEach(async () => harness.close());

  const authoring = (promptText: string) => ({
    title: 'Styling test',
    titleKo: '스타일 테스트',
    promptText,
    useCase: 'brand-ad',
    textVisibility: 'public',
    models: ['seedance-2.5'],
    poster: upload('poster.png', 'POSTER-BYTES', 'image/png'),
  });

  it('refuses a malformed block and a locked part on create, naming the line, and writes nothing', async () => {
    expect(await harness.run('prompt.create', authoring(MALFORMED))).toEqual({
      ok: false,
      code: 'invalid',
      detail: `promptText: template styling: line 4 unknown_line — "${STYLED}the shoes — red heels."`,
    });
    expect(await harness.run('prompt.create', authoring(LOCKED))).toEqual({
      ok: false,
      code: 'invalid',
      detail: `promptText: template styling: line 7 locked_part — "${HAIR}"`,
    });
    expect(await loadPromptBySlug(sql(), 'styling-test')).toBeNull();
    expect(harness.promptsRevalidated).toBe(0);
  });

  it('refuses a styled description that says to follow the photo, on create, update and the declaration', async () => {
    const tail = 'swept back from the face; colour and length stay as in the photo.';
    const clause = [BASE, '', 'Template styling:', `${STYLED}the hairstyle — ${tail}`].join('\n');
    const created = await harness.run('prompt.create', authoring(clause));
    expect(created).toMatchObject({ ok: false, code: 'invalid' });
    expect(created.detail).toMatch(/^promptText: template styling: line 4 photo_clause — "/);
    expect(await loadPromptBySlug(sql(), 'styling-test')).toBeNull();

    expect(await harness.run('prompt.create', authoring(VALID))).toMatchObject({ ok: true });
    const row = (await loadPromptBySlug(sql(), 'styling-test'))!;
    const refused = await harness.run('prompt.update', {
      id: row.id, slug: row.slug, title: row.title, titleKo: row.titleKo ?? '', promptText: clause, useCase: 'brand-ad',
      handle: '', textVisibility: row.textVisibility, featured: '', models: row.models,
    });
    expect(refused).toMatchObject({ ok: false, code: 'invalid' });
    expect(refused.detail).toMatch(/^promptText: template styling: line 4 photo_clause/);
    const declared = await harness.run('prompt.declareStyling', { id: row.id, block: ['Template styling:', `${STYLED}the hairstyle — ${tail}`].join('\n') });
    expect(declared).toMatchObject({ ok: false, code: 'invalid' });
    expect(declared.detail).toMatch(/^declareStyling: block: template styling: line 2 photo_clause/);
    expect((await loadPromptBySlug(sql(), 'styling-test'))!.promptText).toBe(VALID);
  });

  it('names the lock block first when both are wrong', async () => {
    const outcome = await harness.run('prompt.create', authoring(BOTH_BAD));
    expect(outcome.detail).toMatch(/^promptText: template locks: line 4 unknown_line/);
  });

  it('saves a valid block exactly as written; an update is refused the same way and keeps the saved text', async () => {
    expect(await harness.run('prompt.create', authoring(VALID))).toMatchObject({ ok: true, code: 'published' });
    const row = (await loadPromptBySlug(sql(), 'styling-test'))!;
    expect(row.promptText).toBe(VALID);
    const edit = (promptText: string) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      titleKo: row.titleKo ?? '',
      promptText,
      useCase: 'brand-ad',
      handle: '',
      textVisibility: row.textVisibility,
      featured: '',
      models: row.models,
    });
    const refused = await harness.run('prompt.update', edit(MALFORMED));
    expect(refused).toMatchObject({ ok: false, code: 'invalid' });
    expect(refused.detail).toMatch(/^promptText: template styling: line 4 unknown_line/);
    expect((await loadPromptBySlug(sql(), 'styling-test'))!.promptText).toBe(VALID);
    expect(await harness.run('prompt.update', edit(BASE))).toMatchObject({ ok: true, code: 'saved' });
  });

  it('checks every frame prompt of an image set', async () => {
    const photo = (n: number) => `Image 1 is the person. Keep their face. Frame ${n}, a quiet studio portrait.`;
    const set = (frame1Prompt: string) => ({
      title: 'Three Styled Portraits',
      titleKo: '스타일 초상 세 컷',
      engine: 'nano-banana-pro',
      aspect: '4:5',
      frameCount: '3',
      thumbnail: '0',
      frame0Prompt: photo(1),
      frame1Prompt,
      frame2Prompt: photo(3),
      frame0Size: '1856x2304',
      frame1Size: '1856x2304',
      frame2Size: '1856x2304',
      frame0: upload('one.webp', 'ONE', 'image/webp'),
      frame1: upload('two.webp', 'TWO', 'image/webp'),
      frame2: upload('three.webp', 'THREE', 'image/webp'),
    });
    const refused = await harness.run('prompt.createSet', set(`${photo(2)}\n\nTemplate styling:\n${STYLED}the hairstyle.`));
    expect(refused).toMatchObject({ ok: false, code: 'invalid' });
    expect(refused.detail).toContain('frame 2: template styling: line 4 unknown_line');
    expect(await loadPromptBySlug(sql(), 'three-styled-portraits')).toBeNull();
    expect(await harness.run('prompt.createSet', set(`${photo(2)}\n\nTemplate styling:\n${HAIR}`))).toMatchObject({ ok: true });
  });
});

describe('a refused save is said in sentences', () => {
  let harness: AdminHarness;
  const sql = () => runner(harness.db);
  beforeEach(async () => {
    harness = await adminHarness();
    state.sql = runner(harness.db);
  });
  afterEach(async () => {
    state.sql = null;
    await harness.close();
  });

  it('on the template page', async () => {
    expect(await harness.run('prompt.create', { title: 'Styling page', titleKo: '스타일 페이지', promptText: BASE, useCase: 'brand-ad', textVisibility: 'public', models: ['seedance-2.5'], poster: upload('poster.png', 'POSTER-BYTES', 'image/png') })).toMatchObject({ ok: true });
    const id = (await loadPromptBySlug(sql(), 'styling-page'))!.id;
    const page = await AdminPromptItemPage({
      params: Promise.resolve({ id }),
      searchParams: Promise.resolve({ err: 'invalid', detail: `promptText: template styling: line 4 unknown_line, line 6 duplicate_part — "${STYLED}the shoes — red."` }),
    });
    const html = await new Response((await prerender(page)).prelude).text();
    expect(html).toContain('data-lock-refusal');
    expect(html).toContain(a.stylingRefused);
    expect(html).toContain(interpolate(a.stylingProblemUnknownLine, { line: 4 }));
    expect(html).toContain(interpolate(a.stylingProblemDuplicatePart, { line: 6 }));
    for (const key of TEMPLATE_STYLING_KEY_PHRASES) expect(html).toContain(key);
  });

  it('on the new-template screen', () => {
    const detail = `promptText: template styling: line 7 locked_part — "${HAIR}"`;
    const labels = { useCase: 'U', poster: 'P', invalid: a.errInvalid, upload: 'UP', session: 'S', uncertain: 'UN', retained: 'R', publishing: 'PB', lockCopy: lockRefusalCopy(a) };
    const refusal = refusalMessage({ ok: false, code: 'invalid', field: 'promptText', detail }, labels);
    expect(refusal.message).toBe(a.stylingRefused);
    expect(refusal.lock).toEqual(lockRefusalLines(detail, a));
    expect(refusal.lock!.items).toEqual([interpolate(a.stylingProblemLockedPart, { line: 7 })]);
  });
});
