import { describe, expect, it } from 'vitest';
import { enhancePrompt } from '@/lib/brand-studio/enhancer';
import { buildSystemInstruction, planSkin, skinVariantOf } from '@/lib/brand-studio/enhancer/profiles';
import { skinRules, type SkinPlan } from '@/lib/brand-studio/enhancer/profiles/skin';
import { bindReferences } from '@/lib/brand-studio/enhancer/references';
import type { EnhanceInput } from '@/lib/brand-studio/enhancer';
import { ENV, input, mockGemini, sentBody } from './helpers';

const plan = (prompt: string, over: Partial<Parameters<typeof planSkin>[0]> = {}) => planSkin({ kind: 'image', prompt, references: [], ...over });
const person = [{ kind: 'image' as const, role: 'person' }];
const product = [{ kind: 'image' as const, role: 'product' }];

describe('planSkin: who is in the picture and what skin is asked for', () => {
  it.each([
    ['여성 모델이 향수병을 들고 웃는 광고 컷', 'base'],
    ['20대 여성 두 명이 카페에서 웃으며 대화', 'base'],
    ['두 친구가 공원 벤치에서 음료를 마시는 장면', 'base'],
    ['손이 크림을 짜는 클로즈업, 피부결 살려서', 'realism'],
    ['30대 남성이 셔츠를 입고 창가에 앉은 사진, 실사 느낌으로', 'realism'],
    ['모델 뷰티 클로즈업, 모공 보이게', 'realism'],
    ['보정 없이 진짜 사람처럼 찍은 인물 사진', 'realism'],
    ['생얼 느낌의 리얼한 피부로 모델 전신', 'realism'],
    ['A woman holding a serum, unretouched, real skin', 'realism'],
    ['Portrait of a man in his sixties, visible pores', 'realism'],
    ['Two friends laughing on a bench', 'base'],
  ])('%s -> %s', (prompt, mode) => {
    expect(plan(prompt).mode).toBe(mode);
  });

  it.each([
    '실사처럼 보이는 제품 사진, 병이 욕실 선반 위에',
    '피부 크림 제품 컷, 사람 없이 병만',
    '피부결이 느껴지는 크림 텍스처 매크로, 사람 없음',
    'A photoreal product shot of a glass bottle on marble',
    'Skin cream jar, no people, soft daylight',
    '보습 단계 3가지를 아이콘으로 보여 주는 인포그래픽',
  ])('no person, no skin rule: %s', (prompt) => {
    expect(plan(prompt).mode).toBe('off');
  });

  it('a person reference counts as a person, and realism with it turns the tone rule on', () => {
    expect(plan('이미지 1 셔츠 색만 흰색으로', { references: person })).toMatchObject({ mode: 'base', toneMatch: false });
    expect(plan('이미지 1 모델 클로즈업, 피부결 살려서', { references: person })).toMatchObject({ mode: 'realism', toneMatch: true });
    expect(plan('이미지 1 모델 피부톤 그대로 유지해서 광고', { references: person })).toMatchObject({ mode: 'base', toneMatch: true });
    expect(plan('Match her skin tone from image 1', { references: person }).toneMatch).toBe(true);
    // Saying there is nobody wins over a stale role.
    expect(plan('사람 없이 병만', { references: person }).mode).toBe('off');
    // A product reference is not a person; tone needs a person reference.
    expect(plan('피부톤 그대로 광고', { references: product })).toMatchObject({ mode: 'off', toneMatch: false });
  });

  it('a brand rule asking for real skin raises a person shot to realism', () => {
    expect(plan('모델이 크림을 바르는 장면', { brandRules: ['인물은 보정 없는 실사 피부로 보여 준다'] }).mode).toBe('realism');
    expect(plan('병이 욕실 선반 위에', { brandRules: ['인물은 보정 없는 실사 피부로 보여 준다'] }).mode).toBe('off');
    expect(plan('모델이 크림을 바르는 장면', { brandRules: ['로고는 오른쪽 아래'] }).mode).toBe('base');
  });

  it('a partial edit on a face gets the in-place restore sentence; a logo fix does not', () => {
    expect(plan('얼굴 피부가 AI 같아요, 피부결만 살려 주세요', { kind: 'region_edit' })).toMatchObject({ mode: 'realism', restore: true });
    expect(plan('흐린 로고를 선명하게', { kind: 'region_edit' })).toMatchObject({ mode: 'off', restore: false });
  });

  it('a picture without a role may show a person: the base line comes as a condition', () => {
    expect(plan('이미지 1을 대리석 위에', { references: [{ kind: 'image', role: null }] })).toMatchObject({ mode: 'off', maybePerson: true });
  });

  it('video keeps the Seedance profile’s own people rules', () => {
    expect(plan('모델이 걸어가는 장면, 실사', { kind: 'video' }).mode).toBe('off');
  });
});

describe('skinRules: per-model wording', () => {
  const realism: SkinPlan = { mode: 'realism', toneMatch: true, restore: false, maybePerson: false };

  it('realism names the zones, the light that shows relief, the distance rule and no fake texture', () => {
    for (const profile of ['seedream', 'nano-banana', 'gpt-image'] as const) {
      const text = skinRules({ profile, plan: realism, variant: 'short', personTokens: ['image 1'] });
      expect(text).toMatch(/forehead, nose and inner cheeks/);
      expect(text).toMatch(/vellus hair/);
      expect(text).toMatch(/broad soft light from one side/);
      expect(text).toMatch(/hands, arms and neck/);
      expect(text).toMatch(/never ask for film grain, noise or extra sharpening/);
      expect(text).toMatch(/healthy but locally varied skin/);
    }
    expect(skinRules({ profile: 'gpt-image', plan: realism, variant: 'short', personTokens: [] })).toContain('No glamorization, no heavy retouching, no over-sharpened skin.');
    expect(skinRules({ profile: 'nano-banana', plan: realism, variant: 'short', personTokens: [] })).toMatch(/"a real photograph"/);
    expect(skinRules({ profile: 'seedream', plan: realism, variant: 'short', personTokens: [] })).toMatch(/200-word ceiling/);
  });

  it('the base rule bans beauty words; Nano Banana phrases skin positively', () => {
    const base: SkinPlan = { mode: 'base', toneMatch: false, restore: false, maybePerson: false };
    expect(skinRules({ profile: 'seedream', plan: base, variant: 'short', personTokens: [] })).toMatch(/Never write beauty or perfection words/);
    const nb = skinRules({ profile: 'nano-banana', plan: base, variant: 'short', personTokens: [] });
    expect(nb).toMatch(/Phrase the skin positively/);
    expect(nb).not.toMatch(/add no freckles/);
    expect(skinRules({ profile: 'gpt-image', plan: base, variant: 'short', personTokens: [] })).toMatch(/how each person is framed and where they look/);
    expect(skinRules({ profile: 'seedream', plan: { ...base, mode: 'off' }, variant: 'short', personTokens: [] })).toBe('');
  });

  it('three tone variants: role only, depth + undertone, the full reading', () => {
    const none = skinRules({ profile: 'seedream', plan: realism, variant: 'none', personTokens: ['Image 1'] });
    const short = skinRules({ profile: 'seedream', plan: realism, variant: 'short', personTokens: ['Image 1'] });
    const full = skinRules({ profile: 'seedream', plan: realism, variant: 'full', personTokens: ['Image 1'] });
    expect(none).toMatch(/Image 1 supplies the person's face, hair, build and skin as they are; state that role and add no description of the skin's colour/);
    expect(short).toMatch(/name the skin of the person in Image 1 in one clause .* depth .* undertone/);
    expect(full).toMatch(/surface \(matte or satin/);
    expect(full).toMatch(/freckles, moles or marks and where they sit/);
    expect(full).toMatch(/how the light in that picture sits on it/);
    expect(skinRules({ profile: 'nano-banana', plan: realism, variant: 'full', personTokens: ['image 1'] })).toMatch(/keep them exactly as they are/);
  });

  it('the variant comes from the env for testing, else the model default (short)', () => {
    expect(skinVariantOf('seedream-5.5', {})).toBe('short');
    expect(skinVariantOf('nano-banana-2.1', { BRAND_STUDIO_ENHANCER_SKIN_VARIANT: 'full' })).toBe('full');
    expect(skinVariantOf(undefined, { BRAND_STUDIO_ENHANCER_SKIN_VARIANT: 'NONE' })).toBe('none');
    expect(skinVariantOf('gpt-image-2.6-flare', { BRAND_STUDIO_ENHANCER_SKIN_VARIANT: 'extreme' })).toBe('short');
  });
});

describe('the people rules reach the prompt writer', () => {
  const closeUp = (over: Partial<EnhanceInput> = {}): EnhanceInput =>
    input({
      model: 'seedream-5.5',
      prompt: '이미지 1 모델이 이미지 2 세럼을 든 클로즈업, 피부결 살려서',
      references: [
        { index: 1, kind: 'image', label: '이미지 1', role: 'person' },
        { index: 2, kind: 'image', label: '이미지 2', role: 'product' },
      ],
      ...over,
    });

  it('a realism close-up gets the zones and the tone rule with the person token', () => {
    const i = closeUp();
    const system = buildSystemInstruction(i, bindReferences(i), null, [], { skinVariant: 'short' });
    expect(system).toMatch(/Skin realism/);
    expect(system).toMatch(/name the skin of the person in Image 1/);
  });

  it('a product shot gets no people rules', () => {
    const i = input({ model: 'seedream-5.5', prompt: '실사처럼 보이는 제품 사진', references: [{ index: 1, kind: 'image', label: '이미지 1', role: 'product' }] });
    expect(buildSystemInstruction(i, bindReferences(i), null, [])).not.toMatch(/People:|Skin realism/);
  });

  it('the env variant is used for the run and recorded on the result', async () => {
    const fetchMock = mockGemini({ prompt: 'A beauty close-up of the woman in Image 1 holding the serum from Image 2; keep the exact label, cap, proportions and colours of Image 2. Her light, warm skin keeps its fine texture across the forehead and cheeks.', notes: '피부를 구체적으로 적었어요.' });
    const result = await enhancePrompt(closeUp(), { fetch: fetchMock as unknown as typeof fetch, env: { ...ENV, BRAND_STUDIO_ENHANCER_SKIN_VARIANT: 'full' } });
    expect(result.source).toBe('model');
    expect(sentBody(fetchMock).systemInstruction.parts[0]!.text).toMatch(/read the skin of the person in Image 1/);
    expect(result.meta).toMatchObject({ skinMode: 'realism', toneMatch: true, skinVariant: 'full', profile: 'seedream' });
  });
});
