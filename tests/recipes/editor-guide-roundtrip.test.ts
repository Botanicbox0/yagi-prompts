import { describe, expect, it } from 'vitest';
import { fromRecipe, toRecipe, type EditorFile } from '@/components/recipes/recipe-editor';
import { exportRecipe, parseRecipe, type Recipe, type RecipeGuideStep } from '@/lib/recipes/schema';

/** Batch 0 — recipe editor preserves display-only `recipe.guide` without changing guideless recipes. */

const label = {
  selfie: '[내 사진]',
  pet: '[반려동물 사진]',
  partner: '[상대방 사진]',
  reference: (n: number) => `[참조 ${n}]`,
  step: (n: number) => `[${n}단계 결과]`,
};

const files: EditorFile[] = [
  { id: `ast_${'1'.repeat(32)}`, role: 'reference', kind: 'image', mime: 'image/jpeg' },
];

const sampleGuide: RecipeGuideStep[] = [
  {
    title: '첫 장면 스틸',
    kind: 'image',
    meta: '4:5 · 정면 조명',
    prompt: '{{selfie}}의 인물이 햇살 드는 창가에 앉아 있는 스틸 사진.',
    note: '표정은 담담하게 유지한다.',
  },
  {
    title: '두 번째 클립',
    kind: 'video',
    prompt: '{{selfie}}의 인물이 고개를 천천히 돌리며 카메라를 바라본다.',
  },
];

function makeBaseRecipe(withGuide: boolean, withNotes = false): Recipe {
  return {
    version: 2,
    slots: {
      selfie: { kind: 'image', source: 'user', required: true },
      ref1: { kind: 'image', source: 'creator', asset: files[0]!.id },
    },
    steps: [
      {
        id: 'step1',
        kind: 'image',
        engine: 'gpt-image-2',
        inputs: ['selfie', 'ref1'],
        prompt: '{{selfie}}의 인물이 {{ref1}} 배경 앞에 서 있는 정면 컷.',
        params: { aspect: '4:5' },
      },
      {
        id: 'step2',
        kind: 'video',
        engine: 'seedance-2.5',
        inputs: ['step1'],
        prompt: '{{step1}}의 인물이 천천히 걸어오며 미소 짓는 짧은 영상.',
        params: { aspect: '9:16', duration: 6, resolution: '720p' },
      },
    ],
    output: { from: 'step2' },
    ...(withNotes ? { notes: { intro: '짧은 소개 문장.', outro: '마무리 안내 문장.' } } : {}),
    ...(withGuide ? { guide: sampleGuide } : {}),
  };
}

describe('recipe editor guide roundtrip', () => {
  it('preserves guide cards across fromRecipe -> toRecipe roundtrip', () => {
    const original = makeBaseRecipe(true, true);
    expect(parseRecipe(original).ok).toBe(true);

    const loaded = fromRecipe(original, files, label);
    expect(loaded).not.toBeNull();
    expect(loaded!.guide).toEqual(sampleGuide);

    const rebuilt = toRecipe(
      loaded!.steps,
      loaded!.medium,
      files,
      label,
      loaded!.notes,
      loaded!.cast,
      loaded!.guide,
    );
    expect(parseRecipe(rebuilt).ok).toBe(true);
    expect(rebuilt).toEqual(original);
    expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(original));
  });

  it('keeps guideless recipes byte-identical including key order and no undefined guide key', () => {
    for (const withNotes of [false, true]) {
      const original = makeBaseRecipe(false, withNotes);
      expect(parseRecipe(original).ok).toBe(true);

      const loaded = fromRecipe(original, files, label);
      expect(loaded).not.toBeNull();
      expect(loaded!.guide).toBeUndefined();

      const rebuilt = toRecipe(
        loaded!.steps,
        loaded!.medium,
        files,
        label,
        loaded!.notes,
        loaded!.cast,
        loaded!.guide,
      );
      const baseline = toRecipe(
        loaded!.steps,
        loaded!.medium,
        files,
        label,
        loaded!.notes,
        loaded!.cast,
      );
      expect('guide' in rebuilt).toBe(false);
      expect(Object.keys(rebuilt)).toEqual(Object.keys(original));
      expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(original));
      expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(baseline));
    }
  });

  it('preserves guide cards and guideless identity through JSON export and import', () => {
    const withGuide = makeBaseRecipe(true);
    const exportedWithGuide = exportRecipe(withGuide);
    const importedWithGuide = fromRecipe(exportedWithGuide, files, label);
    expect(importedWithGuide).not.toBeNull();
    expect(importedWithGuide!.guide).toEqual(sampleGuide);

    const rebuiltWithGuide = toRecipe(
      importedWithGuide!.steps,
      importedWithGuide!.medium,
      files,
      label,
      importedWithGuide!.notes,
      importedWithGuide!.cast,
      importedWithGuide!.guide,
    );
    expect(exportRecipe(rebuiltWithGuide)).toBe(exportedWithGuide);

    const withoutGuide = makeBaseRecipe(false);
    const exportedWithoutGuide = exportRecipe(withoutGuide);
    const importedWithoutGuide = fromRecipe(exportedWithoutGuide, files, label);
    expect(importedWithoutGuide).not.toBeNull();
    expect(importedWithoutGuide!.guide).toBeUndefined();

    const rebuiltWithoutGuide = toRecipe(
      importedWithoutGuide!.steps,
      importedWithoutGuide!.medium,
      files,
      label,
      importedWithoutGuide!.notes,
      importedWithoutGuide!.cast,
      importedWithoutGuide!.guide,
    );
    expect('guide' in rebuiltWithoutGuide).toBe(false);
    expect(exportRecipe(rebuiltWithoutGuide)).toBe(exportedWithoutGuide);
  });
});
