import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { EDITOR_CASTS, castTokens, editorCasts, fromRecipe, toRecipe } from '@/components/recipes/recipe-editor';
import { PromptFields } from '@/components/admin/prompt-fields';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { loadPromptBySlug } from '@/lib/prompts/repo';
import { parseRecipe, recipeCast, recipeMakeInputs } from '@/lib/recipes/schema';
import { adminHarness, upload, type AdminHarness } from '../helpers/admin';
import { runner } from '../helpers/pglite';

/** docs/CAST-CATEGORIES.md §1 — a template can be marked by cast in the admin form and in the creative's recipe editor. */

const label = { selfie: '[내 사진]', pet: '[반려동물 사진]', partner: '[상대방 사진]', reference: (n: number) => `[참조 ${n}]`, step: (n: number) => `[${n}단계 결과]` };

describe('the creative’s recipe editor', () => {
  const prompts: Record<(typeof EDITOR_CASTS)[number], string> = {
    solo: '[내 사진]이 비 오는 골목을 걷는 장면.',
    pet: '[반려동물 사진]이 파란 배경 앞에 앉아 있는 프로필.',
    pet_with_me: '[내 사진]이 [반려동물 사진]과 소파에 앉아 있는 장면.',
    couple: '[내 사진]과 [상대방 사진]이 우산 하나를 함께 쓰는 장면.',
  };

  for (const cast of EDITOR_CASTS) {
    it(`builds a passing recipe for “${cast}”, and reads it back as the same cast`, () => {
      const recipe = toRecipe([{ kind: 'image', engine: 'gpt-image-2', text: prompts[cast], aspect: '4:5', duration: 10, resolution: '720p' }], 'image', [], label, undefined, cast);
      const checked = parseRecipe(recipe);
      expect(checked.ok, JSON.stringify(checked)).toBe(true);
      expect(recipeCast(recipe)).toBe(cast === 'solo' ? 'solo' : cast === 'couple' ? 'couple' : 'pet');
      expect(recipeMakeInputs(recipe).selfie).toBe(cast !== 'pet');
      const back = fromRecipe(recipe, [], label);
      expect(back?.cast).toBe(cast);
      expect(back?.steps[0]!.text).toBe(prompts[cast]);
    });
  }

  it('offers only the casts whose flag is open; solo always', () => {
    expect(editorCasts({ pet: false, couple: false })).toEqual(['solo']);
    expect(editorCasts({ pet: true, couple: false })).toEqual(['solo', 'pet', 'pet_with_me']);
    expect(editorCasts({ pet: false, couple: true })).toEqual(['solo', 'couple']);
  });

  it('offers the insert buttons of the chosen cast only', () => {
    expect(castTokens('solo', label)).toEqual(['[내 사진]']);
    expect(castTokens('pet', label)).toEqual(['[반려동물 사진]']);
    expect(castTokens('couple', label)).toEqual(['[내 사진]', '[상대방 사진]']);
  });
});

describe('the admin template form', () => {
  let harness: AdminHarness;
  const sql = () => runner(harness.db);
  beforeEach(async () => { harness = await adminHarness(); });
  afterEach(async () => harness.close());

  const authoring = {
    title: 'Cast test',
    titleKo: '등장 테스트',
    promptText: 'A long enough prompt text for the authoring schema to accept it as a real prompt body.',
    useCase: 'brand-ad',
    textVisibility: 'public',
    models: ['seedance-2.5'],
    poster: upload('poster.png', 'POSTER-BYTES', 'image/png'),
  };

  it('shows the cast picker, solo by default', () => {
    const html = renderToStaticMarkup(createElement(PromptFields, { row: null, dict: getDictionary('ko') }));
    expect(html).toContain('name="cast"');
    expect(html).toMatch(/<option value="solo" selected="">혼자<\/option>/);
    expect(html).toContain('반려동물');
  });

  it('creates with a cast, and an edit without the field keeps it', async () => {
    expect(await harness.run('prompt.create', { ...authoring, cast: 'pet' } as never)).toMatchObject({ ok: true });
    const row = (await loadPromptBySlug(sql(), 'cast-test'))!;
    expect(row.cast).toBe('pet');
    const base = { id: row.id, slug: row.slug, title: row.title, titleKo: row.titleKo ?? '', promptText: row.promptText, useCase: 'brand-ad', handle: '', textVisibility: row.textVisibility, featured: '', models: row.models };
    expect(await harness.run('prompt.update', base as never)).toMatchObject({ ok: true });
    expect((await loadPromptBySlug(sql(), 'cast-test'))!.cast).toBe('pet');
    expect(await harness.run('prompt.update', { ...base, cast: 'couple' } as never)).toMatchObject({ ok: true });
    expect((await loadPromptBySlug(sql(), 'cast-test'))!.cast).toBe('couple');
  });

  it('refuses an unknown cast', async () => {
    expect(await harness.run('prompt.create', { ...authoring, cast: 'trio' } as never)).toMatchObject({ ok: false });
  });
});
