import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  addGuideClip,
  duplicateGuideClip,
  guideDraftsToGuideInput,
  guideFromRecipe,
  MAX_GUIDE_CLIPS,
  moveGuideClip,
  removeGuideClip,
  updateGuideClip,
  type GuideCardDraft,
} from '@/components/recipes/guide-editor';
import { fromRecipe, RecipeEditor, toRecipe, type EditorFile } from '@/components/recipes/recipe-editor';
import { displayStepPrompt, parseRecipe } from '@/lib/recipes/schema';
import { en } from '@/messages/en';
import { ko } from '@/messages/ko';

const label = {
  selfie: '[내 사진]',
  pet: '[반려동물 사진]',
  partner: '[상대방 사진]',
  reference: (n: number) => `[참조 ${n}]`,
  step: (n: number) => `[${n}단계 결과]`,
};

const files: EditorFile[] = [
  { id: `ast_${'2'.repeat(32)}`, role: 'reference', kind: 'image', mime: 'image/jpeg' },
];

const baseSteps = [
  {
    kind: 'image' as const,
    engine: 'gpt-image-2',
    text: '[내 사진]의 인물이 [참조 1] 소품 앞에 선 정면 스틸.',
    aspect: '4:5',
    duration: 10,
    resolution: '720p' as const,
  },
  {
    kind: 'video' as const,
    engine: 'seedance-2.5',
    text: '[1단계 결과]의 인물이 천천히 미소 짓는 장면.',
    aspect: '9:16',
    duration: 6,
    resolution: '720p' as const,
  },
];

describe('guide editor pure state → toRecipe', () => {
  it('adds, duplicates, reorders, updates, and removes clips up to 16 and maps cleanly into toRecipe', () => {
    let clips: GuideCardDraft[] = [];
    clips = addGuideClip(clips, 'image');
    clips = updateGuideClip(clips, 0, {
      title: '첫 장면 스틸',
      meta: '이미지 · 4:5',
      prompt: '[내 사진]의 인물이 [참조 1] 소품 옆에 선 첫 장면.',
      note: '인물 시선을 정면으로 둡니다.',
    });

    clips = addGuideClip(clips, 'video');
    clips = updateGuideClip(clips, 1, {
      title: '둘째 장면 움직임',
      meta: '영상 · 4:3 · 5초',
      prompt: '[1단계 결과]의 인물이 천천히 걸어 나오는 짧은 클립.',
    });

    clips = duplicateGuideClip(clips, 1);
    expect(clips).toHaveLength(3);
    expect(clips[2]!.title).toBe('둘째 장면 움직임');
    clips = updateGuideClip(clips, 2, { title: '셋째 장면 클로즈업' });

    // Move clip 3 up to index 1
    clips = moveGuideClip(clips, 2, -1);
    expect(clips.map((c) => c.title)).toEqual(['첫 장면 스틸', '셋째 장면 클로즈업', '둘째 장면 움직임']);

    const recipe = toRecipe(baseSteps, 'video', files, label, undefined, 'solo', guideDraftsToGuideInput(clips));
    const checked = parseRecipe(recipe);
    expect(checked.ok, JSON.stringify(checked)).toBe(true);
    expect(recipe.guide).toEqual([
      {
        title: '첫 장면 스틸',
        kind: 'image',
        meta: '이미지 · 4:5',
        prompt: '{{selfie}}의 인물이 {{ref1}} 소품 옆에 선 첫 장면.',
        note: '인물 시선을 정면으로 둡니다.',
      },
      {
        title: '셋째 장면 클로즈업',
        kind: 'video',
        meta: '영상 · 4:3 · 5초',
        prompt: '{{step1}}의 인물이 천천히 걸어 나오는 짧은 클립.',
      },
      {
        title: '둘째 장면 움직임',
        kind: 'video',
        meta: '영상 · 4:3 · 5초',
        prompt: '{{step1}}의 인물이 천천히 걸어 나오는 짧은 클립.',
      },
    ]);

    // Roundtrip back to readable tokens for the editor workbench, while keeping raw tokens in fromRecipe.
    const reloadedDrafts = guideFromRecipe(recipe, files, label);
    expect(reloadedDrafts.map((c) => c.prompt)).toEqual([
      '[내 사진]의 인물이 [참조 1] 소품 옆에 선 첫 장면.',
      '[1단계 결과]의 인물이 천천히 걸어 나오는 짧은 클립.',
      '[1단계 결과]의 인물이 천천히 걸어 나오는 짧은 클립.',
    ]);
    const batch0Raw = fromRecipe(recipe, files, label)!;
    expect(batch0Raw.guide?.[0]?.prompt).toBe('{{selfie}}의 인물이 {{ref1}} 소품 옆에 선 첫 장면.');

    // Remove all clips → guide key must be absent.
    clips = removeGuideClip(clips, 2);
    clips = removeGuideClip(clips, 1);
    clips = removeGuideClip(clips, 0);
    expect(clips).toHaveLength(0);
    const stripped = toRecipe(baseSteps, 'video', files, label, undefined, 'solo', guideDraftsToGuideInput(clips));
    expect('guide' in stripped).toBe(false);
    expect(parseRecipe(stripped).ok).toBe(true);
  });

  it('enforces the 16-card limit for add and duplicate', () => {
    expect(MAX_GUIDE_CLIPS).toBe(16);
    let clips: GuideCardDraft[] = [];
    for (let i = 0; i < 20; i += 1) {
      clips = addGuideClip(clips, 'video');
    }
    expect(clips).toHaveLength(16);
    clips = duplicateGuideClip(clips, 0);
    expect(clips).toHaveLength(16);
  });

  it('F2: converts only slots used by main steps in guide prompts, keeps unused refs & unknown {{foo}}, and avoids [0단계 결과]', () => {
    const twoFiles: EditorFile[] = [
      files[0]!,
      { id: `ast_${'9'.repeat(32)}`, role: 'reference', kind: 'image', mime: 'image/jpeg' },
    ];
    let clips: GuideCardDraft[] = [];
    clips = addGuideClip(clips, 'image');
    clips = updateGuideClip(clips, 0, {
      title: '본편 참조 사용 클립',
      prompt: '[내 사진]과 [참조 1]을 함께 배치한 클립.',
    });
    clips = addGuideClip(clips, 'video');
    clips = updateGuideClip(clips, 1, {
      title: '미사용 참조 포함 클립',
      prompt: '[내 사진]의 인물이 [참조 2]를 들고 서 있다.',
    });
    clips = addGuideClip(clips, 'video');
    clips = updateGuideClip(clips, 2, {
      title: '모르는 토큰 포함 클립',
      prompt: '[내 사진]과 {{foo}}는 그대로 둔다.',
    });

    const recipe = toRecipe(baseSteps, 'video', twoFiles, label, undefined, 'solo', guideDraftsToGuideInput(clips));
    expect(parseRecipe(recipe).ok).toBe(true);
    expect(Object.keys(recipe.slots)).toEqual(['selfie', 'ref1']);
    expect('ref2' in recipe.slots).toBe(false);

    // Used reference ref1 converts to {{ref1}}; unused [참조 2] and unknown {{foo}} remain verbatim.
    expect(recipe.guide![0]!.prompt).toBe('{{selfie}}과 {{ref1}}을 함께 배치한 클립.');
    expect(recipe.guide![1]!.prompt).toBe('{{selfie}}의 인물이 [참조 2]를 들고 서 있다.');
    expect(recipe.guide![2]!.prompt).toBe('{{selfie}}과 {{foo}}는 그대로 둔다.');

    // displayStepPrompt on clip 2 never produces "[0단계 결과]".
    const shown = displayStepPrompt(recipe, recipe.guide![1]!, {
      selfie: '내 사진',
      reference: '참조 {n}',
      step: '{n}단계 결과',
    });
    expect(shown).toBe('[내 사진]의 인물이 [참조 2]를 들고 서 있다.');
    expect(shown).not.toContain('0단계');

    // Reloading via guideFromRecipe restores [참조 1] and preserves {{foo}} verbatim (never [?]).
    const reloaded = guideFromRecipe(recipe, twoFiles, label);
    expect(reloaded[0]!.prompt).toBe('[내 사진]과 [참조 1]을 함께 배치한 클립.');
    expect(reloaded[1]!.prompt).toBe('[내 사진]의 인물이 [참조 2]를 들고 서 있다.');
    expect(reloaded[2]!.prompt).toBe('[내 사진]과 {{foo}}는 그대로 둔다.');

    // Re-saving preserves {{foo}}.
    const resaved = toRecipe(baseSteps, 'video', twoFiles, label, undefined, 'solo', guideDraftsToGuideInput(reloaded));
    expect(resaved.guide![2]!.prompt).toBe('{{selfie}}과 {{foo}}는 그대로 둔다.');
  });
});

describe('RecipeEditor two-pane steps workbench', () => {
  it('renders the left item list, right edit pane, clip cards, buyer tip copy, and preview-all toggle', () => {
    const recipe = toRecipe(
      baseSteps,
      'video',
      files,
      label,
      undefined,
      'solo',
      [
        {
          title: '클립 하나',
          kind: 'video',
          meta: '영상 · 4:3 · 5초',
          prompt: '{{selfie}}의 인물이 빗길을 천천히 걸어가는 장면.',
          note: '클립 팁 안내.',
        },
      ],
    );

    const html = renderToStaticMarkup(
      <RecipeEditor
        copy={ko.makerRecipe}
        formatId="11111111-1111-4111-8111-111111111111"
        draft={{
          status: 'draft',
          title: 'Nine clips test',
          titleKo: '아홉 클립 시험',
          recipe,
          exampleUrl: null,
          disclosure: { prompts: true, assets: false },
          presentation: 'story-first',
          royaltyKrw: 300,
          testRendersUsed: 0,
          files,
          tests: [],
          revisionOf: null,
        }}
        engines={[
          { id: 'gpt-image-2', label: 'GPT IMAGE 2', kind: 'image' },
          { id: 'seedance-2.5', label: 'SEEDANCE 2.5', kind: 'video', minDuration: 4, maxDuration: 30, resolutions: ['720p', '1080p'] },
        ]}
        aspects={{ image: ['4:5'], video: ['9:16'] }}
        hasSelfie
        selfieHref="/identity/selfie"
        workspaceHref="/creators/workspace"
        testLimit={3}
        locale="ko"
      />,
    );

    expect(html).toContain('data-recipe-steps-workbench');
    expect(html).toContain('data-recipe-steps-list');
    expect(html).toContain('data-recipe-active-pane');
    expect(html).toContain('data-recipe-list-step="1"');
    expect(html).toContain('data-recipe-list-step="2"');
    expect(html).toContain('data-recipe-list-clip="1"');
    expect(html).toContain('클립 하나');
    expect(html).toContain('1 / 16');
    expect(html).toContain('data-recipe-add-clip');
    expect(html).toContain('data-recipe-view-all');
    expect(html).toContain(ko.makerRecipe.note);
    expect(ko.makerRecipe.note).toContain('구매자에게 보이는 팁');
    expect(html).toContain('rows="12"');
    expect(html).toContain('resize-y');
    expect(html).not.toMatch(/name="clip-kind-clip-/);
    expect(en.makerRecipe.clipMetaPlaceholder).not.toMatch(/seedance|kling|gpt|seedream|nano/i);
    expect(ko.makerRecipe.clipMetaPlaceholder).not.toMatch(/seedance|kling|gpt|seedream|nano|시댄스|클링/i);
  });
});
