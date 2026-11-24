import { readFileSync } from 'node:fs';
import { prerender } from 'react-dom/static';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LockRefusalNotice, refusalMessage } from '@/components/admin/prompt-create-feedback';
import { PromptFields } from '@/components/admin/prompt-fields';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { interpolate } from '@/lib/i18n/format';
import { loadPromptBySlug } from '@/lib/prompts/repo';
import {
  LOCK_REFUSAL_COPY_KEYS,
  TEMPLATE_KEEP_LINE_PREFIX,
  TEMPLATE_LOCK_KEY_PHRASES,
  lockRefusalCopy,
  lockRefusalLines,
} from '@/lib/template-director/locks';
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
 * docs/PERSONAL-STUDIO.md §3.3 (C3) — the admin save refuses a `Template locks:` block that would lock everything
 * (malformed) or that would not be read at all (a mistyped header, lock lines with no header), and the template's page
 * says what a saved block locks.
 */

const KEEP = TEMPLATE_KEEP_LINE_PREFIX;
const BASE = 'A woman walks through a neon alley at night while the camera dollies back slowly.';
const VALID = [BASE, '', 'Template locks:', `${KEEP}the product.`, `${KEEP}shots 2–3.`, `${KEEP}the hairstyle — a bright pink chin-length bob.`].join('\n');
const MALFORMED = [BASE, '', 'Template locks:', `${KEEP}the shoes.`, `${KEEP}the product.`].join('\n');
const TYPO = [BASE, '', 'Template lock:', `${KEEP}the product.`].join('\n');

const a = getDictionary('ko').admin;

describe('prompt.create and prompt.update check the lock block', () => {
  let harness: AdminHarness;
  const sql = () => runner(harness.db);
  beforeEach(async () => {
    harness = await adminHarness();
  });
  afterEach(async () => harness.close());

  const authoring = (promptText: string) => ({
    title: 'Lock test',
    titleKo: '잠금 테스트',
    promptText,
    useCase: 'brand-ad',
    textVisibility: 'public',
    models: ['seedance-2.5'],
    poster: upload('poster.png', 'POSTER-BYTES', 'image/png'),
  });

  it('refuses a malformed block on create, naming the line, and writes nothing', async () => {
    expect(await harness.run('prompt.create', authoring(MALFORMED))).toEqual({
      ok: false,
      code: 'invalid',
      detail: `promptText: template locks: line 4 unknown_line — "${KEEP}the shoes."`,
    });
    expect(await loadPromptBySlug(sql(), 'lock-test')).toBeNull();
    expect(harness.promptsRevalidated).toBe(0);
  });

  it('refuses a mistyped header on create, naming the header and the unread lock line', async () => {
    const outcome = await harness.run('prompt.create', authoring(TYPO));
    expect(outcome).toMatchObject({ ok: false, code: 'invalid' });
    expect(outcome.detail).toBe('promptText: template locks: line 3 header_typo, line 4 lock_lines_without_header — "Template lock:"');
    expect(await loadPromptBySlug(sql(), 'lock-test')).toBeNull();
  });

  it('saves a valid block and a prompt with no block exactly as written', async () => {
    expect(await harness.run('prompt.create', authoring(VALID))).toMatchObject({ ok: true, code: 'published' });
    expect((await loadPromptBySlug(sql(), 'lock-test'))!.promptText).toBe(VALID);
    expect(await harness.run('prompt.create', { ...authoring(BASE), title: 'Plain test' })).toMatchObject({ ok: true, code: 'published' });
    expect((await loadPromptBySlug(sql(), 'plain-test'))!.promptText).toBe(BASE);
  });

  it('refuses both kinds on update and keeps the saved text; a valid edit saves', async () => {
    await harness.run('prompt.create', authoring(BASE));
    const row = (await loadPromptBySlug(sql(), 'lock-test'))!;
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

    const malformed = await harness.run('prompt.update', edit(MALFORMED));
    expect(malformed).toMatchObject({ ok: false, code: 'invalid' });
    expect(malformed.detail).toMatch(/^promptText: template locks: line 4 unknown_line/);
    const typo = await harness.run('prompt.update', edit(TYPO));
    expect(typo).toMatchObject({ ok: false, code: 'invalid' });
    expect(typo.detail).toMatch(/^promptText: template locks: line 3 header_typo/);
    expect((await loadPromptBySlug(sql(), 'lock-test'))!.promptText).toBe(BASE);

    expect(await harness.run('prompt.update', edit(VALID))).toMatchObject({ ok: true, code: 'saved' });
    expect((await loadPromptBySlug(sql(), 'lock-test'))!.promptText).toBe(VALID);
  });

  it('checks every frame prompt of an image set the same way', async () => {
    const photo = (n: number) => `Image 1 is the person. Keep their face. Frame ${n}, a quiet studio portrait.`;
    const set = (frame1Prompt: string) => ({
      title: 'Three Quiet Portraits',
      titleKo: '조용한 초상 세 컷',
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
    const refused = await harness.run('prompt.createSet', set(`${photo(2)}\n\nTemplate lock:\n${KEEP}the wardrobe.`));
    expect(refused).toMatchObject({ ok: false, code: 'invalid' });
    expect(refused.detail).toContain('frame 2: template locks: line 3 header_typo, line 4 lock_lines_without_header');
    expect(await loadPromptBySlug(sql(), 'three-quiet-portraits')).toBeNull();

    expect(await harness.run('prompt.createSet', set(`${photo(2)}\n\nTemplate locks:\n${KEEP}the wardrobe.`))).toMatchObject({ ok: true });
  });
});

describe('the template page says what a saved block locks', () => {
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

  async function created(promptText: string, title = 'Lock page'): Promise<string> {
    const outcome = await harness.run('prompt.create', {
      title,
      titleKo: '잠금 페이지',
      promptText,
      useCase: 'brand-ad',
      textVisibility: 'public',
      models: ['seedance-2.5'],
      poster: upload('poster.png', 'POSTER-BYTES', 'image/png'),
    });
    expect(outcome).toMatchObject({ ok: true });
    const slug = title.toLowerCase().replace(/ /g, '-');
    return (await loadPromptBySlug(sql(), slug))!.id;
  }

  async function render(id: string, query: Record<string, string> = {}) {
    const page = await AdminPromptItemPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(query) });
    const { prelude } = await prerender(page);
    return new Response(prelude).text();
  }

  it('lists the locked parts for a valid block', async () => {
    const html = await render(await created(VALID));
    expect(html).toContain('data-template-locks="ok"');
    expect(html).toContain(interpolate(a.templateLocksLine, { parts: '제품 · 헤어 · 2~3번째 컷' }));
  });

  it('adds nothing for a prompt with no block', async () => {
    const html = await render(await created(BASE));
    expect(html).not.toContain('data-template-locks=');
    expect(html).not.toContain('data-lock-refusal');
  });

  it('warns about a block saved before the check that now locks everything, or is not read', async () => {
    const id = await created(BASE);
    await sql().query('update prompt_items set prompt_text = $2 where id = $1', [id, MALFORMED]);
    const malformed = await render(id);
    expect(malformed).toContain('data-template-locks="malformed"');
    expect(malformed).toContain(a.templateLocksAll);

    await sql().query('update prompt_items set prompt_text = $2 where id = $1', [id, TYPO]);
    const typo = await render(id);
    expect(typo).toContain('data-template-locks="header_typo"');
    expect(typo).toContain(a.templateLocksTypo);
  });

  it('turns a refused save into sentences that name the line and the parts an author may lock', async () => {
    const id = await created(BASE);
    const html = await render(id, {
      err: 'invalid',
      detail: `promptText: template locks: line 4 unknown_line, line 9 second_header, too_many_lines 13/12 — "${KEEP}the shoes."`,
    });
    expect(html).toContain('data-lock-refusal');
    expect(html).toContain(a.lockRefused);
    expect(html).toContain(interpolate(a.lockProblemUnknownLine, { line: 4 }));
    expect(html).toContain(interpolate(a.lockProblemSecondHeader, { line: 9 }));
    expect(html).toContain(interpolate(a.lockProblemTooManyLines, { count: 13, max: 12 }));
    expect(html).toContain(`${KEEP}the shoes.`);
    for (const key of TEMPLATE_LOCK_KEY_PHRASES) expect(html).toContain(key);
  });

  it('shows no lock sentences for any other refusal', async () => {
    const html = await render(await created(BASE), { err: 'invalid', detail: 'engine: not a video engine' });
    expect(html).not.toContain('data-lock-refusal');
  });
});

/** Round 2: the new-template screen (enhanced submit) says a lock-block refusal in the edit page's sentences. */
describe('the new-template screen says a lock-block refusal in sentences', () => {
  const copy = lockRefusalCopy(a);
  const labels = {
    useCase: 'U',
    poster: 'P',
    invalid: a.errInvalid,
    upload: 'UP',
    session: 'S',
    uncertain: 'UN',
    retained: 'R',
    publishing: 'PB',
    lockCopy: copy,
  };
  const detail = `promptText: template locks: line 4 unknown_line, line 6 second_header — "${KEEP}the shoes."`;

  it('turns the answer into the same sentences, offending line and rules as the edit page', () => {
    const refusal = refusalMessage({ ok: false, code: 'invalid', field: 'promptText', detail }, labels);
    expect(refusal.message).toBe(a.lockRefused);
    expect(refusal.lock).toEqual(lockRefusalLines(detail, a));
    const html = renderToStaticMarkup(<LockRefusalNotice lines={refusal.lock!} />);
    expect(html).toContain('data-lock-refusal');
    expect(html).toContain(a.lockRefused);
    expect(html).toContain(interpolate(a.lockProblemUnknownLine, { line: 4 }));
    expect(html).toContain(interpolate(a.lockProblemSecondHeader, { line: 6 }));
    expect(html).toContain(`${KEEP}the shoes.`);
    for (const key of TEMPLATE_LOCK_KEY_PHRASES) expect(html).toContain(key);
  });

  it('answers every other refusal exactly as before', () => {
    expect(refusalMessage({ ok: false, code: 'invalid', field: 'poster' }, labels)).toEqual({ message: 'P', lock: null });
    expect(refusalMessage({ ok: false, code: 'invalid', field: 'useCase' }, labels)).toEqual({ message: 'U', lock: null });
    expect(refusalMessage({ ok: false, code: 'invalid' }, labels)).toEqual({ message: a.errInvalid, lock: null });
    expect(refusalMessage({ ok: false, code: 'upload' }, labels)).toEqual({ message: 'UP', lock: null });
    expect(refusalMessage({ ok: false, code: 'unknown' }, labels)).toEqual({ message: 'UN', lock: null });
    // A prompt-field answer that is not a lock refusal, and a page that passes no lock copy, fall back to the generic line.
    expect(refusalMessage({ ok: false, code: 'invalid', field: 'promptText', detail: 'promptText: too short' }, labels)).toEqual({ message: a.errInvalid, lock: null });
    const { lockCopy: _none, ...older } = labels;
    expect(refusalMessage({ ok: false, code: 'invalid', field: 'promptText', detail }, older)).toEqual({ message: a.errInvalid, lock: null });
  });

  it('hands the screen the ten lock strings only, and the create page passes them', () => {
    expect(Object.keys(copy).sort()).toEqual([...LOCK_REFUSAL_COPY_KEYS].sort());
    const page = readFileSync(new URL('../../app/(admin)/admin/prompts/new/page.tsx', import.meta.url), 'utf8');
    expect(page).toContain('lockCopy: lockRefusalCopy(a)');
  });
});

describe('the prompt field carries a lock block example', () => {
  it('is collapsed on both forms and holds a copyable, valid block', () => {
    const dict = getDictionary('ko');
    for (const html of [renderToStaticMarkup(<PromptFields row={null} dict={dict} />)]) {
      const help = /<details[^>]*data-template-locks-help[\s\S]*?<\/details>/.exec(html)?.[0] ?? '';
      expect(help).not.toBe('');
      expect(help).not.toMatch(/<details[^>]*\sopen/);
      expect(help).toContain(dict.admin.templateLocksHelp);
      expect(help).toContain('Template locks:');
      expect(help).toContain(`${KEEP}the product`);
      expect(help).toContain('select-all');
    }
  });
});
