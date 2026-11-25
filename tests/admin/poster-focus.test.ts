import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { MediaDrop } from '@/components/admin/media-drop';
import { mediaDropLabels } from '@/components/admin/prompt-fields';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { dragPosterFocus, formatPosterFocus, parsePosterFocus } from '@/lib/prompts/poster-focus';
import { loadPromptById, loadPromptBySlug } from '@/lib/prompts/repo';
import { parsePromptMedia } from '@/lib/prompts/schemas';
import { shapePromptMedia } from '@/lib/prompts/shape';
import { adminHarness, upload, type AdminHarness } from '../helpers/admin';
import { runner } from '../helpers/pglite';
import { TEMPLATE_STYLING_DEFAULT_BLOCK } from '@/lib/template-director/styling';

describe('poster focus values', () => {
  it('reads only a position inside the image', () => {
    expect(parsePosterFocus('20,75.5')).toEqual({ x: 20, y: 75.5 });
    expect(parsePosterFocus(formatPosterFocus({ x: 0, y: 100 }))).toEqual({ x: 0, y: 100 });
    for (const bad of ['', '50', '101,50', '50,-1', 'a,b', '1e2,50', '50,50,50']) expect(parsePosterFocus(bad), bad).toBeNull();
  });

  it('moves along the overflowing side only, against the drag, and stops at the edges', () => {
    // 1600x900 in a 300px frame renders 533⅓ wide: 233⅓px of overflow, so -70px is +30%.
    const wide = { w: 1600, h: 900 };
    expect(dragPosterFocus({ x: 50, y: 50 }, -70, 40, wide, 300)).toEqual({ x: 80, y: 50 });
    expect(dragPosterFocus({ x: 50, y: 50 }, -5000, 0, wide, 300).x).toBe(100);
    // 900x1600 overflows vertically instead.
    const tall = { w: 900, h: 1600 };
    expect(dragPosterFocus({ x: 50, y: 50 }, 40, 70, tall, 300)).toEqual({ x: 50, y: 20 });
    // A square has nothing to move.
    expect(dragPosterFocus({ x: 50, y: 50 }, 40, 40, { w: 500, h: 500 }, 300)).toEqual({ x: 50, y: 50 });
  });

  it('never fails the whole media object on a bad stored value', () => {
    const poster = { staging_key: 'k', sha256: 'a'.repeat(64), mime: 'image/png' };
    const parsed = parsePromptMedia({ poster, posterFocus: { x: 900, y: 'no' } });
    expect(parsed.poster).toBeDefined();
    expect(parsed.posterFocus).toBeUndefined();
  });

  it('stays out of the public projection', () => {
    const poster = { staging_key: 'k', sha256: 'a'.repeat(64), mime: 'image/png', published_key: 'a.png', bucket: 'public-content' };
    const plain = shapePromptMedia('id', { poster });
    expect(shapePromptMedia('id', { poster, posterFocus: { x: 10, y: 50 } })).toEqual(plain);
  });

  it('ships the saved position with the form, centred by default', () => {
    const labels = mediaDropLabels(getDictionary('ko').admin);
    const props = { videoName: 'video', posterName: 'poster', labels };
    expect(renderToStaticMarkup(createElement(MediaDrop, props))).toContain('name="posterFocus"');
    expect(renderToStaticMarkup(createElement(MediaDrop, { ...props, existingPosterFocus: { x: 20, y: 50 } }))).toMatch(/name="posterFocus" value="20,50"/);
  });
});

describe('saving the poster focus', () => {
  let harness: AdminHarness;
  const sql = () => runner(harness.db);

  const authoring = {
    title: 'Focus test',
    titleKo: '위치 테스트',
    // A new person template declares its hair and makeup (docs/PERSONAL-STUDIO.md §3.4.9, rule 3).
    promptText: `A long enough prompt text for the authoring schema to accept it as a real prompt body.\n\n${TEMPLATE_STYLING_DEFAULT_BLOCK}`,
    useCase: 'brand-ad',
    textVisibility: 'public',
    models: ['seedance-2.5'],
    video: upload('clip.mp4', 'VIDEO-BYTES', 'video/mp4'),
    poster: upload('poster.png', 'POSTER-BYTES', 'image/png'),
  };

  async function created(fields: Record<string, unknown> = {}) {
    const outcome = await harness.run('prompt.create', { ...authoring, ...fields } as never);
    expect(outcome).toMatchObject({ ok: true });
    return (await loadPromptBySlug(sql(), 'focus-test'))!;
  }

  function edit(row: NonNullable<Awaited<ReturnType<typeof loadPromptById>>>, fields: Record<string, unknown>) {
    return harness.run('prompt.update', {
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
      ...fields,
    } as never);
  }

  const focusOf = async (id: string) => parsePromptMedia((await loadPromptById(sql(), id))!.media).posterFocus;

  beforeEach(async () => {
    harness = await adminHarness();
  });
  afterEach(async () => harness.close());

  it('stores the position from the create and the edit form, and keeps it through an unrelated edit', async () => {
    const row = await created({ posterFocus: '30,50' });
    expect(await focusOf(row.id)).toEqual({ x: 30, y: 50 });

    expect(await edit(row, { posterFocus: '70,50' })).toMatchObject({ ok: true });
    expect(await focusOf(row.id)).toEqual({ x: 70, y: 50 });

    expect(await edit(row, {})).toMatchObject({ ok: true });
    expect(await focusOf(row.id)).toEqual({ x: 70, y: 50 });
  });

  it('forgets the old position when the poster is replaced without a new one', async () => {
    const row = await created({ posterFocus: '30,50' });
    expect(await edit(row, { poster: upload('other.png', 'OTHER-BYTES', 'image/png') })).toMatchObject({ ok: true });
    expect(await focusOf(row.id)).toBeUndefined();
  });

  it('ignores a malformed position and still saves', async () => {
    const row = await created({ posterFocus: '30,50' });
    expect(await edit(row, { posterFocus: '900,nope' })).toMatchObject({ ok: true });
    expect(await focusOf(row.id)).toEqual({ x: 30, y: 50 });
  });
});
